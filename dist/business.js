import {
  accountApi,
  discoverAccountConfig,
  businessRequest,
} from "./account.js";
import { parseBusinessCsv } from "./business-csv.js";

const FEATURES = [
  ["group_play", "グループプレイ"],
  ["solo_play", "ソロプレイ"],
  ["theme_mix", "テーマミックス"],
  ["audio", "効果音"],
  ["theme_tags", "テーマタグ"],
];
const CONTENT_FLAGS = [
  ["businessActivities", "法人アクティビティ"],
  ["customQuiz", "会社を知るクイズ"],
  ["generalQuiz", "一般クイズ"],
];
const state = {
  user: null,
  orgs: [],
  orgId: "",
  workspace: null,
  tab: "overview",
  busy: false,
  error: "",
  notice: "",
  otpEmail: "",
  otpSent: false,
  csv: null,
  csvErrors: [],
  epoch: 0,
  authEpoch: 0,
};
const app = document.querySelector("#business-app");
const esc = (v = "") =>
  String(v).replace(
    /[&<>"']/g,
    (x) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        x
      ],
  );
const roleLabel = (v) =>
  ({ owner: "オーナー", admin: "管理者", member: "メンバー" })[v] ||
  v ||
  "メンバー";
const statusLabel = (v) =>
  ({ pending: "初回ログイン待ち", active: "利用中", suspended: "停止中" })[v] ||
  v ||
  "—";
const errText = (e) =>
  ({
    UNAUTHENTICATED: "ログインが必要です。",
    FORBIDDEN: "この操作を行う権限がありません。",
    FEATURE_DISABLED: "この機能は組織で無効です。",
    THEME_NOT_ALLOWED: "許可されていないテーマです。",
    BUSINESS_MIGRATION_UNAVAILABLE: "企業スペースは現在準備中です。",
    INVALID_REQUEST: "入力内容を確認してください。",
    ORG_CONFLICT: "同名の組織が既に存在します。",
  })[e?.code] ||
  e?.message ||
  "読み込みに失敗しました。";
function setMessage(notice = "", error = "") {
  state.notice = notice;
  state.error = error;
}
function mutationContext(orgId = state.orgId) {
  return { orgId, authEpoch: state.authEpoch };
}
function mutationCurrent(ctx) {
  return ctx.authEpoch === state.authEpoch && ctx.orgId === state.orgId;
}
function template() {
  const blob = new Blob(
    [
      "\uFEFFemail,display_name,department\r\nexample@example.com,山田 太郎,営業\r\n",
    ],
    { type: "text/csv;charset=utf-8" },
  );
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "mingle-business-members-template.csv";
  a.click();
  URL.revokeObjectURL(a.href);
}
function parseCsv(raw) {
  if (!(raw instanceof Uint8Array) || raw.byteLength > 256 * 1024)
    throw new Error("CSVは256KiB以内にしてください。");
  const rows = parseBusinessCsv(raw);
  const errors = [],
    seen = new Set();
  if (rows.length > 500) errors.push("CSVは500行以内にしてください。");
  rows.forEach((row, index) => {
    const line = index + 2;
    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email) ||
      row.email.length > 254 ||
      /[\u0000-\u001f\u007f]/u.test(row.email)
    )
      errors.push(`${line}行目: メールアドレスが不正です`);
    if (
      !row.display_name ||
      row.display_name.length > 80 ||
      /[\u0000-\u001f\u007f]/u.test(row.display_name)
    )
      errors.push(`${line}行目: display_name は1〜80文字で入力してください`);
    if (
      (row.department || "").length > 80 ||
      /[\u0000-\u001f\u007f]/u.test(row.department || "")
    )
      errors.push(`${line}行目: department は80文字以内で入力してください`);
    const email = row.email.toLowerCase();
    if (seen.has(email))
      errors.push(`${line}行目: メールアドレスが重複しています`);
    seen.add(email);
  });
  return { rows, errors };
}
function loginView() {
  return `<div class="modal"><section class="modal-card"><h2>企業スペースにログイン</h2><p class="muted">登録済みのメールアドレスへ確認コードを送ります。</p><form class="stack" data-login><label>メールアドレス<input type="email" name="email" autocomplete="email" required value="${esc(state.otpEmail)}"></label>${state.otpSent ? '<label>確認コード<input name="token" inputmode="numeric" autocomplete="one-time-code" required></label>' : ""}<div class="actions"><button class="primary" type="submit">${state.otpSent ? "確認してログイン" : "確認コードを送る"}</button><button type="button" data-login-cancel>戻る</button></div><p class="muted">${esc(state.error || state.notice)}</p></form></section></div>`;
}
function shell(body) {
  app.innerHTML = `<div class="shell"><header class="topbar"><a class="brand" href="https://mingle.cards/">Mingle.Cards</a><span>企業スペース</span><span class="spacer"></span><span class="muted">${esc(state.user?.email || "")}</span><button data-logout type="button">ログアウト</button></header>${state.notice ? `<div class="notice">${esc(state.notice)}</div>` : ""}${state.error ? `<div class="notice error" role="alert">${esc(state.error)}</div>` : ""}${body}</div>`;
  bind();
  bindDangerous();
}
function createView() {
  shell(
    `<section class="panel"><h1>企業スペースを作成</h1><p class="muted">組織を作成すると、メンバーと利用テーマを管理できます。</p><form class="stack" data-create-org><label>組織名<input name="name" maxlength="120" required></label><label>組織ID（URL用）<input name="slug" pattern="[a-z0-9-]+" maxlength="64" placeholder="example-company" required></label><button class="primary" type="submit">組織を作成</button></form></section>`,
  );
}
function orgIdOf(o) {
  return o.organizationId || o.organization_id || o.id || "";
}
function nav() {
  const admin = ["owner", "admin"].includes(state.workspace?.role);
  return `<nav class="toolbar" aria-label="企業スペース"><select data-org><option value="">組織を選択</option>${state.orgs
    .map((o) => {
      const id = orgIdOf(o);
      return `<option value="${esc(id)}" ${id === state.orgId ? "selected" : ""}>${esc(o.name || id)}（${roleLabel(o.role)}）</option>`;
    })
    .join(
      "",
    )}</select>${state.workspace ? ["overview", ...(admin ? ["members", "themes"] : [])].map((t) => `<button type="button" data-tab="${t}" class="${state.tab === t ? "primary" : ""}">${{ overview: "概要", members: "メンバー", themes: "テーマ・機能" }[t]}</button>`).join("") : ""}<button type="button" data-new-org>＋組織を作成</button></nav>`;
}
function overview() {
  const w = state.workspace || {};
  const deletion =
    w.role === "owner"
      ? `<details><summary>組織設定</summary><p class="muted">組織名を入力すると組織とメンバー登録を削除します。個人アカウントは削除されません。</p><form class="stack" data-delete-org><label>組織名<input name="name" required></label><button class="danger" type="submit">組織を削除</button></form></details>`
      : "";
  const hasActivityHub = w.contentFlags?.businessActivities !== false || w.contentFlags?.customQuiz !== false || w.contentFlags?.generalQuiz !== false;
  return `<section class="panel"><h1>${esc(w.organization?.name || "企業スペース")}</h1><p class="muted">権限: ${roleLabel(w.role)}</p><div class="grid"><div class="panel half"><h2>利用テーマ</h2><strong>${Array.isArray(w.themes) ? w.themes.length : "—"}</strong><p class="muted">組織で選んだテーマ</p></div><div class="panel half"><h2>有効な機能</h2><strong>${Object.values(w.featureFlags || {}).filter(Boolean).length} / ${FEATURES.length}</strong><p class="muted">組織ポリシーに従って表示されます</p></div></div><div class="actions"><a href="/business-play.html?orgId=${encodeURIComponent(state.orgId)}" class="primary" style="display:inline-block;padding:.65rem .9rem;text-decoration:none;color:#fff;background:#17233b">カードプレイを開始</a>${hasActivityHub ? `<a href="/business-activities.html?orgId=${encodeURIComponent(state.orgId)}" style="display:inline-block;padding:.65rem .9rem;text-decoration:none">法人アクティビティ・クイズ</a>` : ""}<a href="/business-marketplace.html?orgId=${encodeURIComponent(state.orgId)}" style="display:inline-block;padding:.65rem .9rem;text-decoration:none">法人カード</a></div>${deletion}</section>`;
}
function members() {
  const rows = Array.isArray(state.workspace?.members)
    ? state.workspace.members
    : [];
  const canManage = ["owner", "admin"].includes(state.workspace?.role);
  const isOwner = state.workspace?.role === "owner";
  return `<section class="panel"><h2>メンバー</h2><p class="muted">社員のメール・表示名・部署をCSVで登録できます。社員は登録したメールでログインすると参加できます。招待メールは自動送信されません。</p><div class="drop"><label>CSVを選択<input type="file" accept=".csv,text/csv" data-csv></label><div class="actions"><button type="button" data-template>CSVテンプレートをダウンロード</button>${state.csv ? `<button class="primary" type="button" data-import ${state.csvErrors.length ? "disabled" : ""}>検証済み${state.csv.rows.length}件を登録</button>` : ""}</div></div>${
    state.csv
      ? `<p class="hint">${state.csvErrors.length ? `エラー ${state.csvErrors.length}件（修正して再選択してください）` : `登録可能 ${state.csv.rows.length}件`}</p>${
          state.csvErrors.length
            ? `<ul>${state.csvErrors
                .slice(0, 8)
                .map(esc)
                .map((x) => `<li>${x}</li>`)
                .join("")}</ul>`
            : ""
        }<div class="table-wrap"><table class="table"><thead><tr><th>email</th><th>display_name</th><th>department</th></tr></thead><tbody>${state.csv.rows
          .slice(0, 20)
          .map(
            (r) =>
              `<tr><td>${esc(r.email)}</td><td>${esc(r.display_name)}</td><td>${esc(r.department)}</td></tr>`,
          )
          .join("")}</tbody></table></div>`
      : ""
  }${rows.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>表示名</th><th>メール</th><th>部署</th><th>状態</th><th>権限</th><th>操作</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${esc(r.display_name)}</td><td>${esc(r.email_normalized || r.email)}</td><td>${esc(r.department || "")}</td><td class="status-${esc(r.status)}">${statusLabel(r.status)}</td><td>${roleLabel(r.role)}</td><td>${r.role === "owner" || !canManage || (state.workspace?.role === "admin" && r.role === "admin") ? "—" : `<button type="button" data-member="${esc(r.id)}" data-status="${r.status === "suspended" ? "active" : "suspended"}">${r.status === "suspended" ? "再開" : "停止"}</button>`}</td></tr>`).join("")}</tbody></table></div>` : '<p class="muted">登録されたメンバーはいません。</p>'}</section>`;
}
function themes() {
  const w = state.workspace || {},
    allowed = new Set((w.themes || []).map((t) => t.id)),
    flags = {
      ...Object.fromEntries(FEATURES.map(([k]) => [k, true])),
      ...(w.featureFlags || {}),
    };
  const canEdit = ["owner", "admin"].includes(w.role);
  const catalog = Array.isArray(w.catalog)
    ? w.catalog.filter(
        (theme) => !theme.r18 && !String(theme.id).includes("r18"),
      )
    : [];
  return `<section class="panel"><h2>提供テーマ</h2><p class="muted">R18テーマは企業スペースでは選択できません。</p><div class="theme-grid">${catalog
    .map(
      (d) =>
        `<label class="theme-option"><input type="checkbox" data-theme value="${esc(d.id)}" ${allowed.has(d.id) ? "checked" : ""} ${canEdit ? "" : "disabled"}><span>${esc(d.name || d.title || d.id)}<small>${d.cardCount || 0}枚</small></span></label>`,
    )
    .join(
      "",
    )}</div><h2>使える機能</h2><div class="checks">${FEATURES.map(([k, label]) => `<label class="check"><input type="checkbox" data-feature="${k}" ${flags[k] ? "checked" : ""} ${canEdit ? "" : "disabled"}> ${label}</label>`).join("")}</div><h2>法人コンテンツ</h2><div class="checks">${CONTENT_FLAGS.map(([k, label]) => `<label class="check"><input type="checkbox" data-content-flag="${k}" ${(w.contentFlags?.[k] !== false) ? "checked" : ""} ${canEdit ? "" : "disabled"}> ${label}</label>`).join("")}</div>${canEdit ? '<div class="actions"><button class="primary" type="button" data-save-policy>設定を保存</button></div>' : '<p class="muted">管理者のみ設定を変更できます。</p>'}</section>`;
}
function render() {
  if (!state.user) {
    shell(
      '<section class="panel"><h1>企業スペース</h1><p>ログインして企業用のテーマとメンバーを管理します。</p><button class="primary" type="button" data-login-open>ログイン</button></section>',
    );
    return;
  }
  if (!state.orgs.length) {
    createView();
    return;
  }
  if (state.workspace?.role === "member") state.tab = "overview";
  if (!state.workspace) {
    shell(
      state.busy
        ? `<section class="panel"><h1>企業スペース</h1><p class="muted">組織情報を読み込み中…</p></section>`
        : `<section class="panel"><h1>企業スペースを読み込めません</h1><p class="muted">時間をおいて、もう一度お試しください。</p><button type="button" data-retry>再試行</button></section>`,
    );
    app.querySelector("[data-retry]")?.addEventListener("click", loadWorkspace);
    return;
  }
  shell(
    `${nav()}${state.tab === "members" ? members() : state.tab === "themes" ? themes() : overview()}`,
  );
}
async function loadWorkspace() {
  if (!state.orgId) return;
  const id = state.orgId,
    epoch = ++state.epoch,
    authEpoch = state.authEpoch;
  state.busy = true;
  try {
    const workspace = await businessRequest(
      `/organizations/${encodeURIComponent(id)}/workspace`,
    );
    if (
      epoch !== state.epoch ||
      authEpoch !== state.authEpoch ||
      id !== state.orgId
    )
      return;
    state.workspace = workspace;
    state.error = "";
  } catch (e) {
    if (
      epoch !== state.epoch ||
      authEpoch !== state.authEpoch ||
      id !== state.orgId
    )
      return;
    state.workspace = null;
    state.error = errText(e);
  } finally {
    if (epoch === state.epoch && authEpoch === state.authEpoch) {
      state.busy = false;
      render();
    }
  }
}
async function load() {
  const epoch = ++state.epoch;
  const authEpoch = state.authEpoch;
  try {
    const me = await accountApi.me();
    if (epoch !== state.epoch || authEpoch !== state.authEpoch) return;
    state.user = me.user || null;
    if (!state.user) {
      render();
      return;
    }
    const data = await businessRequest("/organizations");
    if (epoch !== state.epoch || authEpoch !== state.authEpoch) return;
    state.orgs = data.organizations || [];
    const wanted = new URLSearchParams(location.search).get("orgId");
    if (wanted) {
      if (!state.orgs.some((org) => orgIdOf(org) === wanted))
        throw Object.assign(new Error("指定された組織を利用できません。"), {
          code: "FORBIDDEN",
        });
      state.orgId = wanted;
    } else if (!state.orgId && state.orgs[0])
      state.orgId = orgIdOf(state.orgs[0]);
    if (state.orgId) await loadWorkspace();
    else render();
  } catch (e) {
    if (epoch !== state.epoch || authEpoch !== state.authEpoch) return;
    state.workspace = null;
    state.csv = null;
    state.csvErrors = [];
    state.error = errText(e);
    render();
  }
}
async function onLogin(e) {
  e.preventDefault();
  const f = new FormData(e.currentTarget);
  state.otpEmail = String(f.get("email") || "").trim();
  try {
    if (!state.otpSent) {
      await accountApi.sendOtp(state.otpEmail);
      state.otpSent = true;
      setMessage("確認コードをメールで送りました。", "");
      const modal = app.querySelector(".modal");
      if (modal) {
        modal.outerHTML = loginView();
        app.querySelector("[data-login]")?.addEventListener("submit", onLogin);
        app
          .querySelector("[data-login-cancel]")
          ?.addEventListener("click", render);
      }
    } else {
      await accountApi.verifyOtp(
        state.otpEmail,
        String(f.get("token") || "").trim(),
      );
      state.otpSent = false;
      setMessage("", "");
      await load();
    }
  } catch (x) {
    state.error = errText(x);
    const modal = app.querySelector(".modal");
    if (modal) {
      modal.outerHTML = loginView();
      app.querySelector("[data-login]")?.addEventListener("submit", onLogin);
      app
        .querySelector("[data-login-cancel]")
        ?.addEventListener("click", render);
    } else render();
  }
}
async function bindImport(file) {
  const orgId = state.orgId;
  const authEpoch = state.authEpoch;
  const epoch = state.epoch;
  try {
    const parsed = parseCsv(new Uint8Array(await file.arrayBuffer()));
    if (
      orgId !== state.orgId ||
      authEpoch !== state.authEpoch ||
      epoch !== state.epoch
    )
      return;
    state.csv = parsed;
    state.csvErrors = parsed.errors;
    setMessage(
      parsed.errors.length
        ? "CSVを修正してください。"
        : `CSVを検証しました（${parsed.rows.length}件）。`,
      "",
    );
  } catch (e) {
    if (
      orgId !== state.orgId ||
      authEpoch !== state.authEpoch ||
      epoch !== state.epoch
    )
      return;
    state.csv = null;
    const message =
      e.code === "CSV_INVALID"
        ? "CSVの形式が正しくありません。UTF-8、email,display_name,departmentの3列を確認してください。"
        : e.message;
    state.csvErrors = [message || "CSVを読み込めませんでした。"];
    setMessage("", state.csvErrors[0]);
  }
  render();
}
function bind() {
  app.querySelector("[data-login-open]")?.addEventListener("click", () => {
    app.insertAdjacentHTML("beforeend", loginView());
    app.querySelector("[data-login]")?.addEventListener("submit", onLogin);
    app.querySelector("[data-login-cancel]")?.addEventListener("click", render);
  });
  app.querySelector("[data-logout]")?.addEventListener("click", async () => {
    await accountApi.logout();
    state.authEpoch += 1;
    state.epoch += 1;
    state.user = null;
    state.orgs = [];
    state.orgId = "";
    state.workspace = null;
    state.csv = null;
    state.csvErrors = [];
    state.notice = "ログアウトしました。";
    render();
  });
  app.querySelector("[data-login]")?.addEventListener("submit", onLogin);
  app.querySelector("[data-org]")?.addEventListener("change", (e) => {
    state.epoch += 1;
    state.orgId = e.currentTarget.value;
    state.tab = "overview";
    state.csv = null;
    state.csvErrors = [];
    state.notice = "";
    state.error = "";
    state.workspace = null;
    state.busy = true;
    history.replaceState(
      {},
      "",
      `/business.html?orgId=${encodeURIComponent(state.orgId)}`,
    );
    render();
    loadWorkspace();
  });
  app.querySelectorAll("[data-tab]").forEach((b) =>
    b.addEventListener("click", () => {
      state.tab = b.dataset.tab;
      setMessage("", "");
      render();
    }),
  );
  app.querySelector("[data-new-org]")?.addEventListener("click", () => {
    state.orgId = "";
    createView();
  });
  app
    .querySelector("[data-create-org]")
    ?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const ctx = mutationContext("");
      const f = new FormData(e.currentTarget);
      try {
        const r = await businessRequest("/organizations", {
          method: "POST",
          body: { name: f.get("name"), slug: f.get("slug") },
        });
        if (!mutationCurrent(ctx)) return;
        state.orgId = r.organization.id;
        state.orgs.push({
          organizationId: r.organization.id,
          name: r.organization.name,
          slug: r.organization.slug,
          role: "owner",
        });
        state.tab = "overview";
        history.replaceState(
          {},
          "",
          `/business.html?orgId=${encodeURIComponent(state.orgId)}`,
        );
        await loadWorkspace();
      } catch (x) {
        if (!mutationCurrent(ctx)) return;
        setMessage("", errText(x));
        render();
      }
    });
  app.querySelector("[data-template]")?.addEventListener("click", template);
  app
    .querySelector("[data-csv]")
    ?.addEventListener(
      "change",
      (e) => e.target.files[0] && bindImport(e.target.files[0]),
    );
  app.querySelector("[data-import]")?.addEventListener("click", async () => {
    const ctx = mutationContext();
    try {
      const r = await businessRequest(
        `/organizations/${encodeURIComponent(state.orgId)}/members/import`,
        { method: "POST", body: { rows: state.csv.rows } },
      );
      if (!mutationCurrent(ctx)) return;
      setMessage(
        `登録しました（新規 ${r.result?.created ?? 0}件、スキップ ${r.result?.skipped ?? 0}件）。`,
        "",
      );
      state.csv = null;
      state.csvErrors = [];
      await loadWorkspace();
    } catch (e) {
      if (!mutationCurrent(ctx)) return;
      setMessage("", errText(e));
      render();
    }
  });
  app.querySelectorAll("[data-member]").forEach((b) =>
    b.addEventListener("click", async () => {
      const ctx = mutationContext();
      try {
        await businessRequest(
          `/organizations/${encodeURIComponent(state.orgId)}/members/${encodeURIComponent(b.dataset.member)}`,
          { method: "PATCH", body: { status: b.dataset.status } },
        );
        if (!mutationCurrent(ctx)) return;
        await loadWorkspace();
      } catch (e) {
        if (!mutationCurrent(ctx)) return;
        setMessage("", errText(e));
        render();
      }
    }),
  );
  app
    .querySelector("[data-save-policy]")
    ?.addEventListener("click", async () => {
      const ctx = mutationContext();
      const allowed = [...app.querySelectorAll("[data-theme]:checked")].map(
        (x) => x.value,
      );
      const featureFlags = Object.fromEntries(
        FEATURES.map(([k]) => [
          k,
          app.querySelector(`[data-feature="${k}"]`).checked,
        ]),
      );
      const contentFlags = Object.fromEntries(
        CONTENT_FLAGS.map(([k]) => [k, app.querySelector(`[data-content-flag="${k}"]`).checked]),
      );
      try {
        await businessRequest(
          `/organizations/${encodeURIComponent(state.orgId)}/policy`,
          { method: "PUT", body: { allowedThemeIds: allowed, featureFlags, contentFlags } },
        );
        if (!mutationCurrent(ctx)) return;
        setMessage("組織ポリシーを保存しました。", "");
        await loadWorkspace();
      } catch (e) {
        if (!mutationCurrent(ctx)) return;
        setMessage("", errText(e));
        render();
      }
    });
}
function bindDangerous() {
  const members = state.workspace?.members || [];
  const isOwner = state.workspace?.role === "owner";
  app.querySelectorAll("[data-member]").forEach((b) => {
    const id = b.dataset.member,
      row = members.find((x) => x.id === id);
    if (!row || row.role === "owner") return;
    const cell = b.parentElement;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "danger";
    remove.dataset.removeMember = id;
    remove.textContent = "登録解除";
    cell.append(" ", remove);
    if (isOwner) {
      const select = document.createElement("select");
      select.dataset.role = id;
      select.innerHTML = `<option value="member">${roleLabel("member")}</option><option value="admin">${roleLabel("admin")}</option>`;
      select.value = row.role || "member";
      cell.append(" ", select);
    }
  });
  app.querySelectorAll("[data-remove-member]").forEach((b) =>
    b.addEventListener("click", async () => {
      const row = state.workspace?.members?.find(
        (x) => x.id === b.dataset.removeMember,
      );
      if (
        !row ||
        !confirm(
          `${row.email_normalized || row.email || "このメンバー"}の組織登録だけを解除します。個人アカウントは削除されません。続けますか？`,
        )
      )
        return;
      const ctx = mutationContext();
      try {
        await businessRequest(
          `/organizations/${encodeURIComponent(state.orgId)}/members/${encodeURIComponent(b.dataset.removeMember)}`,
          { method: "DELETE" },
        );
        if (!mutationCurrent(ctx)) return;
        await loadWorkspace();
      } catch (e) {
        if (!mutationCurrent(ctx)) return;
        setMessage("", errText(e));
        render();
      }
    }),
  );
  app.querySelectorAll("[data-role]").forEach((s) =>
    s.addEventListener("change", async () => {
      const ctx = mutationContext();
      try {
        await businessRequest(
          `/organizations/${encodeURIComponent(state.orgId)}/members/${encodeURIComponent(s.dataset.role)}`,
          { method: "PATCH", body: { role: s.value } },
        );
        if (!mutationCurrent(ctx)) return;
        await loadWorkspace();
      } catch (e) {
        if (!mutationCurrent(ctx)) return;
        setMessage("", errText(e));
        render();
      }
    }),
  );
  app
    .querySelector("[data-delete-org]")
    ?.addEventListener("submit", async (e) => {
      e.preventDefault();
      const name = new FormData(e.currentTarget).get("name");
      if (String(name).trim() !== (state.workspace?.organization?.name || "")) {
        setMessage("", "組織名が一致しません。");
        render();
        return;
      }
      if (
        !confirm(
          "組織とメンバー登録を削除します。個人アカウントは削除されません。続けますか？",
        )
      )
        return;
      const ctx = mutationContext();
      try {
        await businessRequest(
          `/organizations/${encodeURIComponent(state.orgId)}`,
          { method: "DELETE" },
        );
        if (!mutationCurrent(ctx)) return;
        state.orgs = state.orgs.filter((o) => orgIdOf(o) !== state.orgId);
        state.orgId = "";
        state.workspace = null;
        state.tab = "overview";
        history.replaceState({}, "", "/business.html");
        await load();
      } catch (x) {
        if (!mutationCurrent(ctx)) return;
        setMessage("", errText(x));
        render();
      }
    });
}
async function init() {
  try {
    await discoverAccountConfig();
    accountApi.onAuthStateChange?.((event, session) => {
      if (event === "SIGNED_OUT") {
        state.authEpoch += 1;
        state.epoch += 1;
        state.user = null;
        state.orgs = [];
        state.orgId = "";
        state.workspace = null;
        state.csv = null;
        state.csvErrors = [];
        state.notice = "ログアウトしました。";
        render();
      } else if (
        (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") &&
        session?.user?.id &&
        state.user?.id &&
        session.user.id !== state.user.id
      ) {
        state.authEpoch += 1;
        state.epoch += 1;
        state.user = null;
        state.orgs = [];
        state.orgId = "";
        state.workspace = null;
        state.csv = null;
        state.csvErrors = [];
        render();
        load();
      } else if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
        load();
      }
    });
    await load();
  } catch (error) {
    state.error = errText(error);
    shell(
      `<section class="panel"><h1>企業スペース</h1><p class="notice error">${esc(state.error)}</p><button type="button" data-retry>再試行</button></section>`,
    );
    app.querySelector("[data-retry]")?.addEventListener("click", init);
  }
}
init();

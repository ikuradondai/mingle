import {
  accountApi,
  businessRequest,
  discoverAccountConfig,
} from "./account.js";
import {
  isCardAudioEnabled,
  playFlipSound,
  toggleCardAudio,
} from "./card-audio.js";
import {
  displayQuestionText,
  participantCountAllowed,
  participantRuleForDeck,
} from "./participant-rule.js";
import {
  themeExplorerBookmarks,
  themeExplorerExperienced,
  toggleThemeExplorerBookmark,
  toggleThemeExplorerExperienced,
} from "./theme-explorer.js";

const root = document.querySelector("#business-play-app");
const state = {
  orgs: [],
  orgId: "",
  userId: "",
  workspace: null,
  count: 2,
  names: ["", ""],
  themeIds: [],
  audio: isCardAudioEnabled(),
  tagsEnabled: false,
  mix: false,
  bookmarks: [],
  experienced: [],
  session: null,
  index: 0,
  error: "",
  busy: false,
  blocked: false,
  authGeneration: 0,
  loadGeneration: 0,
};
const esc = (v = "") =>
  String(v).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const failText = (e) =>
  ({
    UNAUTHENTICATED: "ログインが必要です。",
    FORBIDDEN: "この組織では利用できません。",
    FEATURE_DISABLED: "この機能は組織で無効です。",
    THEME_NOT_ALLOWED: "許可されていないテーマです。",
    PARTICIPANT_COUNT_INVALID: "このテーマでは現在の人数で遊べません。",
  })[e?.code] ||
  e?.message ||
  "開始できませんでした。";
const flags = () => ({
  group_play: true,
  solo_play: true,
  theme_mix: false,
  audio: true,
  theme_tags: false,
  ...(state.workspace?.featureFlags || {}),
});
const namesReady = () =>
  state.names.length === state.count &&
  state.names.every((name) => name.trim());
const themeAllowed = (id) =>
  (state.workspace?.themes || []).some((theme) => theme.id === id);
const tagOwner = () => `org:${state.orgId}:${state.userId}`;
function syncPolicy() {
  const p = flags();
  state.tagsEnabled = p.theme_tags === true;
  if (!state.tagsEnabled) {
    state.bookmarks = [];
    state.experienced = [];
  }
  if (!p.audio) state.audio = false;
  if (state.count === 1 && !p.solo_play) state.count = 2;
  if (state.count > 1 && !p.group_play) state.count = 1;
  state.names = Array.from(
    { length: state.count },
    (_, i) => state.names[i] || "",
  );
  state.themeIds = state.themeIds
    .filter(themeAllowed)
    .filter((id) => themeFits((state.workspace?.themes || []).find((theme) => theme.id === id) || { id }))
    .slice(0, p.theme_mix ? 3 : 1);
}
function themeFits(theme) {
  const rule = theme.participantRule || participantRuleForDeck(theme.id);
  return participantCountAllowed(rule, state.count);
}
function base(content) {
  root.innerHTML = `<style>.speaker-fade{animation:business-speaker-fade .22s ease-out}@keyframes business-speaker-fade{from{opacity:.45;transform:translateY(3px)}to{opacity:1;transform:none}}@media(prefers-reduced-motion:reduce){.speaker-fade{animation:none}}</style><div class="shell play"><header class="topbar"><a class="brand" href="/business.html?orgId=${encodeURIComponent(state.orgId)}">Mingle.Cards</a><span>企業プレイ</span><span class="spacer"></span><a href="/business.html?orgId=${encodeURIComponent(state.orgId)}">管理へ戻る</a></header>${state.error ? `<div class="notice error" role="alert">${esc(state.error)}</div>` : ""}${content}</div>`;
  bind();
}
function tags(themeId) {
  if (!state.tagsEnabled) return "";
  const b = state.bookmarks.includes(themeId),
    x = state.experienced.includes(themeId);
  return `<span class="actions"><button class="text" type="button" data-bookmark="${esc(themeId)}">${b ? "★ 保存済み" : "☆ 保存"}</button><button class="text" type="button" data-experienced="${esc(themeId)}">${x ? "✓ 体験済み" : "体験済みにする"}</button></span>`;
}
function setup() {
  syncPolicy();
  const p = flags(),
    mode = state.count === 1 ? "solo" : "group";
  const themes = (state.workspace?.themes || [])
    .filter(themeFits)
    .map(
      (t) =>
        `<div class="theme-option"><label><input type="checkbox" data-theme value="${esc(t.id)}" ${state.themeIds.includes(t.id) ? "checked" : ""} ${state.busy ? "disabled" : ""}><span>${esc(t.name)}<small>${t.cardCount || 0}枚</small></span></label>${tags(t.id)}</div>`,
    )
    .join("");
  const names = state.names
    .map(
      (name, i) =>
        `<label>呼び名（${i + 1}人目）<input data-name="${i}" maxlength="80" value="${esc(name)}" required ${state.busy ? "disabled" : ""}></label>`,
    )
    .join("");
  const disabled =
    state.busy ||
    !namesReady() ||
    !state.themeIds.length ||
    (mode === "solo" ? !p.solo_play : !p.group_play);
  base(
    `<section class="panel"><h1>${mode === "solo" ? "ひとりで遊ぶ" : "みんなで遊ぶ"}</h1><p class="muted">${mode === "solo" ? "自分をもっとよく知るための質問が出てくるよ。" : "呼び名を入力して、みんなで質問を読み上げてください。"}回答の入力や録音は行いません。</p><label>人数<div class="actions"><button type="button" data-count="down" ${state.busy || state.count <= (p.solo_play ? 1 : 2) ? "disabled" : ""}>−</button><strong>${state.count}人</strong><button type="button" data-count="up" ${state.busy || state.count >= (p.group_play ? 8 : 1) ? "disabled" : ""}>＋</button></div></label><h2>許可されたテーマ</h2><p class="hint">${p.theme_mix ? "テーマミックス（最大3テーマ）が使えます。" : "テーマは1つ選択できます。"}</p><div class="theme-grid">${themes || '<p class="muted">この人数で利用できるテーマがありません。</p>'}</div><h2>呼び名</h2><div class="names-grid">${names}</div>${p.audio ? `<label class="check"><input type="checkbox" data-audio ${state.audio ? "checked" : ""} ${state.busy ? "disabled" : ""}> 効果音を使う</label>` : ""}<button class="primary" type="button" data-start ${disabled ? "disabled" : ""}>開始する</button></section>`,
  );
}
function play() {
  const cards = (state.session?.themes || []).flatMap((t) => t.cards || []);
  if (state.index >= cards.length) {
    base(
      '<section class="panel"><h1>おつかれさまでした</h1><p class="muted">回答の入力や録音は行いません。</p><button class="primary" data-restart type="button">もう一度設定する</button></section>',
    );
    return;
  }
  const card = cards[state.index],
    speaker = state.names[state.index % state.names.length] || "",
    other = state.names.length === 2 ? state.names[(state.index + 1) % 2] : "",
    sourceTheme = state.session.themes.find((theme) => theme.id === card?.sourceDeckId) || state.session.themes[0],
    rule = sourceTheme?.participantRule || participantRuleForDeck(card?.sourceDeckId || sourceTheme?.id),
    text = displayQuestionText(card?.text || "質問を読み込めませんでした。", {
      participants: state.names,
      participantIndex: state.index % state.names.length,
      rule,
    });
  base(
    `<section class="panel"><p class="muted">${esc(state.session.themes.map((t) => t.name).join(" / "))} · ${state.index + 1} / ${cards.length}</p><article class="play-card speaker-fade"><p class="muted">${esc(speaker)}の番${other ? ` · ${esc(other)}に聞いてみよう` : ""}</p><p class="question">${esc(text)}</p></article><div class="play-controls"><button type="button" data-prev ${state.index ? "" : "disabled"}>前へ</button><button class="primary" type="button" data-next>次のカード</button></div><p class="muted">回答の入力や録音は行いません。</p></section>`,
  );
}
function render() {
  state.session ? play() : setup();
}
async function load() {
  const generation = ++state.loadGeneration;
  try {
    const me = await accountApi.me();
    if (generation !== state.loadGeneration) return;
    state.userId = me.user?.id || "";
    if (!state.userId)
      throw Object.assign(new Error("ログインが必要です。"), {
        code: "UNAUTHENTICATED",
      });
    const d = await businessRequest("/organizations");
    if (generation !== state.loadGeneration) return;
    state.orgs = d.organizations || [];
    const wanted = new URLSearchParams(location.search).get("orgId");
    if (wanted) {
      if (
        !state.orgs.some(
          (o) => (o.organizationId || o.organization_id) === wanted,
        )
      )
        throw Object.assign(new Error("指定された組織を利用できません。"), {
          code: "FORBIDDEN",
        });
      state.orgId = wanted;
    } else {
      state.orgId =
        state.orgs[0]?.organizationId || state.orgs[0]?.organization_id || "";
    }
    if (!state.orgId)
      throw Object.assign(new Error("組織がありません"), { code: "FORBIDDEN" });
    const workspace = await businessRequest(
      `/organizations/${encodeURIComponent(state.orgId)}/workspace`,
    );
    if (generation !== state.loadGeneration) return;
    state.workspace = workspace;
    if (!flags().audio) state.audio = false;
    state.tagsEnabled = flags().theme_tags === true;
    state.bookmarks = state.tagsEnabled
      ? themeExplorerBookmarks(tagOwner())
      : [];
    state.experienced = state.tagsEnabled
      ? themeExplorerExperienced(tagOwner())
      : [];
    syncPolicy();
    render();
  } catch (e) {
    if (generation !== state.loadGeneration) return;
    state.error = failText(e);
    base(
      `<section class="panel"><h1>企業プレイ</h1><p>${esc(state.error)}</p><a href="/business.html">企業スペースへ戻る</a></section>`,
    );
  }
}
async function start() {
  if (
    !namesReady() ||
    !state.themeIds.length ||
    (!flags().theme_mix && state.themeIds.length > 1)
  ) {
    state.error = "人数・呼び名・テーマを確認してください。";
    render();
    return;
  }
  const generation = state.authGeneration;
  const count = state.count;
  const themeIds = [...state.themeIds];
  state.busy = true;
  state.audio = root.querySelector("[data-audio]")?.checked !== false;
  render();
  try {
    const session = await businessRequest(
      `/organizations/${encodeURIComponent(state.orgId)}/sessions`,
      {
        method: "POST",
        body: {
          mode: count === 1 ? "solo" : "group",
          themeIds,
          participantCount: count,
        },
      },
    );
    if (generation !== state.authGeneration) return;
    state.session = session;
    if (session.features) state.workspace = { ...state.workspace, featureFlags: session.features };
    if (!flags().audio) state.audio = false;
    state.index = 0;
    state.error = "";
  } catch (e) {
    if (generation !== state.authGeneration) return;
    state.error = failText(e);
  } finally {
    if (generation === state.authGeneration) { state.busy = false; render(); }
  }
}
async function recheck() {
  if (!state.session) return;
  const generation = state.authGeneration;
  const session = state.session;
  try {
    const w = await businessRequest(
        `/organizations/${encodeURIComponent(state.orgId)}/workspace`,
      ),
      p = { ...flags(), ...(w.featureFlags || {}) },
      allowed = new Set((w.themes || []).map((t) => t.id));
    if (generation !== state.authGeneration || state.session !== session) return;
    state.workspace = w;
    syncPolicy();
    if (
      !p[state.session.mode === "solo" ? "solo_play" : "group_play"] ||
      state.session.themes.some((t) => !allowed.has(t.id)) ||
      (state.session.themes.length > 1 && !p.theme_mix)
    )
      throw new Error("組織ポリシーが変更されたためプレイを停止しました。");
    state.tagsEnabled = p.theme_tags === true;
    if (!p.audio) state.audio = false;
    if (!state.tagsEnabled) {
      state.bookmarks = [];
      state.experienced = [];
    }
  } catch (e) {
    if (generation !== state.authGeneration || state.session !== session) return;
    state.session = null;
    state.workspace = null;
    state.blocked = true;
    state.error = failText(e);
    base(
      '<section class="panel"><h1>プレイを停止しました</h1><p class="muted">組織の利用ポリシーを再確認できません。企業スペースで確認してから再開してください。</p><a href="/business.html">企業スペースへ戻る</a></section>',
    );
  }
}
function bind() {
  const audio = root.querySelector("[data-audio]");
  audio?.addEventListener("change", (event) => {
    if (state.busy) return;
    if (event.target.checked !== isCardAudioEnabled()) toggleCardAudio();
    state.audio = event.target.checked;
  });
  root.querySelectorAll("[data-count]").forEach((b) =>
    b.addEventListener("click", () => {
      if (state.busy) return;
      const p = flags(),
        min = p.solo_play ? 1 : 2,
        max = p.group_play ? 8 : 1;
      state.count = Math.min(
        max,
        Math.max(min, state.count + (b.dataset.count === "up" ? 1 : -1)),
      );
      syncPolicy();
      render();
    }),
  );
  root.querySelectorAll("[data-name]").forEach((i) =>
    i.addEventListener("input", () => {
      state.names[Number(i.dataset.name)] = i.value;
      const startButton = root.querySelector("[data-start]");
      if (startButton)
        startButton.disabled =
          !namesReady() || !state.themeIds.length || state.busy;
    }),
  );
  root.querySelectorAll("[data-theme]").forEach((i) =>
    i.addEventListener("change", () => {
      if (state.busy) return;
      if (i.checked && !flags().theme_mix) state.themeIds = [i.value];
      else if (i.checked && state.themeIds.length >= 3) i.checked = false;
      else if (i.checked) state.themeIds.push(i.value);
      else state.themeIds = state.themeIds.filter((id) => id !== i.value);
      render();
    }),
  );
  root.querySelector("[data-start]")?.addEventListener("click", start);
  root.querySelectorAll("[data-next]").forEach((b) =>
    b.addEventListener("click", () => {
      if (flags().audio && state.audio) playFlipSound();
      state.index += 1;
      render();
    }),
  );
  root.querySelector("[data-prev]")?.addEventListener("click", () => {
    state.index = Math.max(0, state.index - 1);
    render();
  });
  root.querySelector("[data-restart]")?.addEventListener("click", () => {
    state.session = null;
    state.index = 0;
    render();
  });
  root.querySelectorAll("[data-bookmark]").forEach((b) =>
    b.addEventListener("click", () => {
      if (!state.tagsEnabled) return;
      const id = b.dataset.bookmark;
      toggleThemeExplorerBookmark(id, tagOwner());
      state.bookmarks = themeExplorerBookmarks(tagOwner());
      render();
    }),
  );
  root.querySelectorAll("[data-experienced]").forEach((b) =>
    b.addEventListener("click", () => {
      if (!state.tagsEnabled) return;
      const id = b.dataset.experienced;
      toggleThemeExplorerExperienced(id, tagOwner());
      state.experienced = themeExplorerExperienced(tagOwner());
      render();
    }),
  );
}
setInterval(recheck, 30000);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) recheck();
});
async function init() {
  await discoverAccountConfig();
  accountApi.onAuthStateChange?.((event, session) => {
    const nextUserId = session?.user?.id || "";
    if (event === "SIGNED_IN" && nextUserId && nextUserId !== state.userId) {
      state.authGeneration += 1;
      state.loadGeneration += 1;
      state.userId = "";
      state.orgs = [];
      state.orgId = "";
      state.names = ["", ""];
      state.themeIds = [];
      state.bookmarks = [];
      state.experienced = [];
      state.tagsEnabled = false;
      state.audio = isCardAudioEnabled();
      state.count = 2;
      state.index = 0;
      state.session = null;
      state.workspace = null;
      state.busy = false;
      state.blocked = false;
      state.error = "";
      base(
        '<section class="panel"><h1>読み込み中</h1><p class="muted">企業スペースを確認しています。</p></section>',
      );
      void load();
      return;
    }
    if (event === "SIGNED_OUT") {
      state.authGeneration += 1;
      state.loadGeneration += 1;
      state.userId = "";
      state.orgs = [];
      state.orgId = "";
      state.names = [];
      state.themeIds = [];
      state.bookmarks = [];
      state.experienced = [];
      state.tagsEnabled = false;
      state.audio = false;
      state.index = 0;
      state.session = null;
      state.workspace = null;
      state.error = "ログアウトしました。";
      base(
        '<section class="panel"><h1>ログアウトしました</h1><a href="/business.html">企業スペースへ戻る</a></section>',
      );
    }
  });
  await load();
}
init();

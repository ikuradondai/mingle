import { accountApi, discoverAccountConfig } from "./account.js";
import { toDataURL } from "./vendor/qr.js";
import { playFlipSound } from "./card-audio.js";
import { consumeOchiAuthIntent, saveOchiAuthIntent } from "./ochi-auth-intent.js";
const app = document.querySelector("#ochi-app");
const query = new URLSearchParams(location.search);
const roomId = query.get("room");
const invite = query.get("invite");
const venue = query.get("venue") || "";
const authReturn = consumeOchiAuthIntent();
const state = {
  roomId,
  invite,
  token: "",
  data: null,
  host: query.get("host") === "1" || query.get("create") === "1" || Boolean(venue),
  name: authReturn?.name || "",
  busy: false,
  error: "",
  timer: 0,
  poll: 1000,
  failures: 0,
  requestEpoch: 0,
  creating: !roomId,
  viewKey: "",
  focusKey: "",
  terminal: false,
  receivedAt: 0,
  warnedTurn: 0,
  confirmFinish: false,
};
const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const gameOf = (data) => data?.ochi || {};
const memberOf = (data) => data?.member || {};
const credentialKey = (id) => `mingle.ochi.room:${id}`;
const CREDENTIAL_TTL = 24 * 60 * 60 * 1000;
const quote = (text) => `…${text}`;
function storage() {
  try {
    return globalThis.sessionStorage;
  } catch {
    return null;
  }
}
function saveCredential() {
  if (!state.roomId || !state.token) return;
  const store = storage();
  if (!store) return;
  const createdAt = Date.now();
  const serverExpiry = Date.parse(state.data?.room?.expiresAt || "");
  const expiresAt = Number.isFinite(serverExpiry) ? Math.min(serverExpiry, createdAt + CREDENTIAL_TTL) : createdAt + CREDENTIAL_TTL;
  try {
    store.setItem(credentialKey(state.roomId), JSON.stringify({ schema: 1, roomId: state.roomId, invite: state.invite, token: state.token, createdAt, expiresAt }));
  } catch {}
}
function restoreCredential() {
  const store = storage();
  if (!store || !state.roomId) return;
  try {
    const value = JSON.parse(store.getItem(credentialKey(state.roomId)) || "null");
    const now = Date.now();
    if (
      value?.schema === 1 &&
      value.roomId === state.roomId &&
      /^[0-9a-f-]{16,64}$/i.test(value.roomId) &&
      /^[A-Za-z0-9_-]{43}$/.test(value.token) &&
      Number.isFinite(value.createdAt) &&
      Number.isFinite(value.expiresAt) &&
      value.createdAt <= now &&
      value.expiresAt >= now &&
      value.expiresAt - value.createdAt <= CREDENTIAL_TTL
    ) {
      state.token = value.token;
      state.invite ||= value.invite || "";
    } else store.removeItem(credentialKey(state.roomId));
  } catch {
    try {
      store.removeItem(credentialKey(state.roomId));
    } catch {}
  }
}
function clearCredential() {
  try {
    storage()?.removeItem(credentialKey(state.roomId));
  } catch {}
  state.token = "";
}
let memoryJoinSecret = "";
function newJoinSecret() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function joinSecret() {
  if (memoryJoinSecret) return memoryJoinSecret;
  try {
    const value = storage()?.getItem(`mingle.ochi.join:${state.roomId}`);
    if (/^[A-Za-z0-9_-]{43}$/.test(value || "")) return (memoryJoinSecret = value);
  } catch {}
  return (memoryJoinSecret = newJoinSecret());
}
function saveJoinSecret(value) {
  memoryJoinSecret = value;
  try {
    storage()?.setItem(`mingle.ochi.join:${state.roomId}`, value);
  } catch {}
}
function clearJoinSecret() {
  memoryJoinSecret = "";
  try {
    storage()?.removeItem(`mingle.ochi.join:${state.roomId}`);
  } catch {}
}
function shell(body) {
  const venueOk = /^[A-Za-z0-9_-]{32}$/.test(venue);
  const homeHref = venueOk ? `/?venue=${encodeURIComponent(venue)}` : "/";
  app.innerHTML = `<header class="ochi-brand"><a href="${homeHref}"><img src="/assets/mingle-cards-masthead.png" alt="Mingle.Cards"></a><a href="${homeHref}">${venueOk ? "店舗へ戻る" : "トップへ戻る"}</a></header>${body}`;
}
function err() {
  return state.error ? `<p class="ochi-error" role="alert">${esc(state.error)}</p>` : "";
}
const INTRO = "各自に、話の最後の一文（オチ）が秘密で配られます。実話でも作り話でもOK。60秒で、そのオチに着地する話をしてみてください。聞き手は「実話か、作り話か」を予想します。";
function createView() {
  shell(
    `<section class="ochi-card"><h1>オチから話して</h1><p class="ochi-note">${INTRO}</p><p class="ochi-note">2〜8人で遊べます（3人以上がおすすめ）。</p><form class="ochi-form" data-create><label>代表者の呼び名<input name="name" maxlength="40" required autocomplete="nickname" value="${esc(state.name)}"></label><label>遊ぶ長さ<select name="laps"><option value="1">1周（全員が1回ずつ話す）</option><option value="2">2周（全員が2回ずつ話す）</option></select></label><button class="primary-button" type="submit" ${state.busy ? "disabled" : ""}>${state.busy ? "作成中…" : "ルームを作る"}</button>${err()}</form></section>`,
  );
}
function joinView() {
  shell(
    `<section class="ochi-card"><h1>オチから話して に参加</h1><p class="ochi-note">${INTRO}</p><form class="ochi-form" data-join><label>呼び名<input name="name" maxlength="40" required autocomplete="nickname" value="${esc(state.name)}"></label><button class="primary-button" type="submit" ${state.busy ? "disabled" : ""}>${state.busy ? "参加中…" : "参加する"}</button>${err()}</form></section>`,
  );
}
function joinUrl() {
  return `${location.origin}/ochi-room.html?room=${encodeURIComponent(state.roomId)}&invite=${encodeURIComponent(state.invite || "")}`;
}
function qr() {
  return `<div class="ochi-qr"><img data-qr alt="参加用QRコード"><input readonly value="${esc(joinUrl())}" aria-label="参加用URL"><button type="button" class="secondary-button" data-copy>URLをコピー</button></div>`;
}
function remainingMs(game) {
  const deadline = Date.parse(game.tellDeadline || "");
  const serverNow = Date.parse(game.serverNow || "");
  if (!Number.isFinite(deadline) || !Number.isFinite(serverNow)) return null;
  return deadline - serverNow - (performance.now() - state.receivedAt);
}
// a host may finish a telling for the speaker only this long after the 60 seconds ran out (mirrors the RPC)
const PROXY_FINISH_GRACE_MS = 15000;
function timerView(game) {
  const ms = remainingMs(game);
  if (ms === null) return { text: "時間を確認中…", cls: "" };
  if (ms >= 0) return { text: `${Math.ceil(ms / 1000)}`, cls: ms <= 10000 ? "is-warn" : "" };
  return { text: `時間です！オチをどうぞ +${Math.max(1, Math.ceil(-ms / 1000))}秒`, cls: "is-over" };
}
function secret(text) {
  return `<div class="ochi-secret is-masked" data-mask>オチは本人だけに表示されます</div><div class="ochi-secret" data-secret hidden>${esc(quote(text))}</div><button type="button" class="secondary-button" data-hold>押している間だけオチを見る</button>`;
}
const guessLabel = (guess) => ({ real: "実話", fiction: "作り話", pass: "わからない" })[guess] || "未投票";
const act = (name, label, cls = "primary-button", extra = "") => `<button type="button" class="${cls}" data-act="${name}" ${extra}>${label}</button>`;
function finishFooter() {
  if (!state.host) return "";
  return state.confirmFinish
    ? `<div class="ochi-proxy"><p class="ochi-note">ゲームを終了しますか？ 配られたオチや投票は消えます。</p><div class="ochi-actions">${act("finish", "終了する", "secondary-button")}<button type="button" class="secondary-button" data-cancel-finish>やめる</button></div></div>`
    : `<div class="ochi-proxy"><button type="button" class="secondary-button" data-ask-finish>ゲームを終了</button></div>`;
}
function view(data) {
  const room = data.room || {};
  const game = gameOf(data);
  const members = room.members || [];
  const me = memberOf(data).id;
  const phase = game.phase || "lobby";
  const nameOf = (id) => members.find((m) => m.id === id)?.name || "";
  const speakerName = nameOf(game.speakerId);
  const iAmSpeaker = Boolean(me) && game.speakerId === me;
  const host = state.host;
  const chips = (highlight) =>
    `<ul class="ochi-members">${(game.order?.length ? game.order : members.map((m) => m.id)).map((id) => `<li class="${highlight && id === game.speakerId ? "is-speaker" : ""}">${esc(nameOf(id))}${id === game.speakerId && highlight ? "（話し手）" : ""}</li>`).join("")}</ul>`;
  const progress = game.turnNo ? `<p class="ochi-progress">第${game.turnNo}話 / 全${game.totalTurns}話</p>` : `<p class="ochi-progress">参加者 ${members.length} / 8人</p>`;
  let body = progress;
  if (phase === "lobby") {
    body += `<ul class="ochi-members">${members.map((m) => `<li>${esc(m.name)}${m.role === "host" ? "（代表者）" : ""}</li>`).join("")}</ul>`;
    body += host
      ? `${act("start", "ゲームを始める", "primary-button", members.length < 2 ? "disabled" : "")}<p class="ochi-note">${members.length < 2 ? "2人以上で開始できます。" : members.length < 3 ? "3人以上だとさらに盛り上がります。" : "全員がそろったら始めましょう。"}</p>${qr()}`
      : '<p class="ochi-note">代表者が開始するまでお待ちください。</p>';
  } else if (phase === "deal") {
    body += `<h1>あなたのオチ</h1><p class="ochi-note">他の人に見せずに確認して、覚えたら「覚えた」を押してください。</p>${game.myOchi ? secret(game.myOchi) : ""}${game.mySwapAvailable ? act("swap", "別のオチにする（1回だけ）", "secondary-button") : ""}${game.confirmed ? '<p class="ochi-note">確認済みです。ほかの人を待っています。</p>' : act("confirm", "覚えた")}<p class="ochi-progress">確認済み ${game.confirmedCount} / ${game.memberCount}人</p>${host ? `<div class="ochi-proxy">${act("force_ready", "全員を待たずに進める", "secondary-button")}</div>` : ""}`;
  } else if (phase === "ready") {
    body += `<h1>${iAmSpeaker ? "あなたの番です" : `${esc(speakerName)}さんの番`}</h1>${chips(true)}`;
    if (iAmSpeaker) body += `<p class="ochi-note">オチをもう一度確認して、準備ができたら話しはじめましょう。</p>${game.myOchi ? secret(game.myOchi) : ""}<div class="ochi-actions">${act("begin_tell", "話しはじめる（60秒）")}${game.mySwapAvailable ? act("swap", "別のオチにする（1回だけ）", "secondary-button") : ""}${act("skip", "今回は聞く側にまわる", "secondary-button")}</div>`;
    else body += `<p class="ochi-note">${esc(speakerName)}さんがオチを準備中…</p>`;
    if (host && !iAmSpeaker) body += `<div class="ochi-proxy"><p class="ochi-note">${esc(speakerName)}さんが操作できないときは、代わりに進められます。</p><div class="ochi-actions">${act("begin_tell", "代わりに話しはじめる", "secondary-button")}${act("skip", `${esc(speakerName)}さんは今回パス`, "secondary-button")}</div></div>`;
  } else if (phase === "telling") {
    const t = timerView(game);
    body += `<h1>${iAmSpeaker ? "話してみよう" : `${esc(speakerName)}さんが話しています`}</h1><div class="ochi-timer ${t.cls}" data-timer aria-live="off">${esc(t.text)}</div>`;
    if (iAmSpeaker) body += `<p class="ochi-note">実話でも作り話でもOK。オチに着地したら「話し終えた」を押してください。</p>${game.myOchi ? secret(game.myOchi) : ""}<div class="ochi-actions">${act("finish_tell:real", "話し終えた：実話だった")}${act("finish_tell:fiction", "話し終えた：作り話だった")}${act("skip", "やっぱりパス", "secondary-button")}</div>`;
    else body += '<p class="ochi-note">最後のオチを予想しながら聞いてみましょう。実話か、作り話か…。</p>';
    if (host && !iAmSpeaker) body += `<div class="ochi-proxy"><p class="ochi-note">${esc(speakerName)}さんが操作できないときは、時間が過ぎて15秒後から代わりに進められます。</p><div class="ochi-actions">${act("finish_tell", "話し終わった（代理で進める）", "secondary-button", `data-proxy-finish ${(remainingMs(game) ?? 0) <= -PROXY_FINISH_GRACE_MS ? "" : "disabled"}`)}${act("skip", `${esc(speakerName)}さんは今回パス`, "secondary-button")}</div></div>`;
  } else if (phase === "vote") {
    body += `<h1>どっちだと思う？</h1><div class="ochi-secret">${esc(quote(game.turnOchi || ""))}</div><p class="ochi-note">${esc(speakerName)}さんの話は、実話？ それとも作り話？</p>`;
    if (iAmSpeaker) body += `<p class="ochi-note">みんなが予想しています…。</p>${game.myTruthLocked === false ? `<p class="ochi-note">代表者が代わりに進めたので、正解をここで登録してください（まだ誰にも見えません）。</p><div class="ochi-actions">${act("lock_truth:real", "実話だった", "secondary-button")}${act("lock_truth:fiction", "作り話だった", "secondary-button")}</div>` : ""}`;
    else if (game.memberHasVoted) body += '<p class="ochi-note">投票しました。ほかの人を待っています。</p>';
    else body += `<div class="ochi-votes"><button type="button" data-guess="real">実話だと思う</button><button type="button" data-guess="fiction">作り話だと思う</button><button type="button" data-guess="pass">わからない（パス）</button></div>`;
    body += `<p class="ochi-progress">投票済み ${game.votedCount} / ${game.voterCount}人</p>`;
    if (host) body += `<div class="ochi-proxy">${act("close_vote", "投票を締め切る", "secondary-button")}</div>`;
  } else if (phase === "reveal") {
    body += `<h1>正解は…？</h1><div class="ochi-secret">${esc(quote(game.turnOchi || ""))}</div>`;
    const reveal = [];
    if (iAmSpeaker || host) {
      if (game.myTruthLocked) reveal.push(act("reveal", iAmSpeaker ? "正解を明かす" : `${esc(speakerName)}さんの代わりに明かす`, iAmSpeaker ? "primary-button" : "secondary-button"));
      else reveal.push(`<p class="ochi-note">${iAmSpeaker ? "実話だった？ 作り話だった？" : `${esc(speakerName)}さんが口で伝えた正解を選んでください。`}</p>${act("reveal:real", "実は実話！", iAmSpeaker ? "primary-button" : "secondary-button")}${act("reveal:fiction", "実は作り話！", iAmSpeaker ? "primary-button" : "secondary-button")}`);
    }
    if (iAmSpeaker) body += `<p class="ochi-note">みんなの予想がそろいました。</p><div class="ochi-actions">${reveal.join("")}</div>`;
    else {
      body += `<p class="ochi-drum">${esc(speakerName)}さんが正解を明かします…</p>`;
      if (host) body += `<div class="ochi-proxy"><div class="ochi-actions">${reveal.join("")}</div></div>`;
    }
  } else if (phase === "result") {
    const r = game.result || { tally: { real: 0, fiction: 0, pass: 0 }, guesses: {}, myDelta: 0 };
    const mine = r.guesses?.[me];
    // only my own gain is ever sent: nobody else's points are shown
    const verdict = iAmSpeaker
      ? r.myDelta ? "みんなを惑わせました！ +1" : "今回は+0でした"
      : mine === undefined ? "" : mine === "pass" ? "パスでした（0点）" : mine === r.truth ? "当たり！ +1" : "惜しい！";
    const rows = members.filter((m) => m.id !== game.speakerId).map((m) => `<li><span>${esc(m.name)}：${esc(guessLabel(r.guesses?.[m.id]))}</span></li>`).join("");
    const last = game.turnNo >= game.totalTurns;
    body += `<h1>${esc(speakerName)}さんの話</h1><div class="ochi-secret">${esc(quote(game.turnOchi || ""))}</div><div class="ochi-answer"><small>正解は</small>${r.truth === "real" ? "実話！" : "作り話！"}</div><ul class="ochi-tally"><li>実話 ${r.tally?.real ?? 0}票</li><li>作り話 ${r.tally?.fiction ?? 0}票</li><li>わからない ${r.tally?.pass ?? 0}人</li></ul>${verdict ? `<p class="ochi-note"><strong>${esc(verdict)}</strong></p>` : ""}<ul class="ochi-rows">${rows}<li><span>${esc(speakerName)}さん（話し手）</span></li></ul>`;
    body += host ? act("next_turn", last ? "結果発表へ" : "次の話へ") : '<p class="ochi-note">代表者が次へ進めます。</p>';
  } else if (phase === "skipped") {
    body += `<h1>${esc(speakerName)}さんは今回、聞く側にまわります</h1><p class="ochi-note">OK！ 次へ進みましょう。</p>`;
    body += host ? act("next_turn", game.turnNo >= game.totalTurns ? "結果発表へ" : "次の話へ") : '<p class="ochi-note">代表者が次へ進めます。</p>';
  } else if (phase === "final") {
    const titles = game.titles || {};
    const names = (ids) => (ids || []).map((id) => esc(nameOf(id))).join("、");
    // titles for everyone; points only for me (the server sends nobody else's score)
    const own = game.myScore;
    body += `<h1>結果発表</h1><div class="ochi-titles">${titles.detective?.length ? `<div><strong>名探偵</strong>${names(titles.detective)}</div>` : ""}${titles.mysterious?.length ? `<div><strong>ミステリアス賞</strong>${names(titles.mysterious)}</div>` : ""}${!titles.detective?.length && !titles.mysterious?.length ? '<p class="ochi-note">今回は称号なし。みんなで楽しみました。</p>' : ""}</div>${own ? `<p class="ochi-note ochi-own-score"><strong>あなたの得点</strong>　聞き手 ${own.listener}点 ／ 話し手 ${own.teller}点</p>` : ""}<p class="ochi-note">結果は数分で消去されます。やっぱり、人って面白い。</p>`;
  } else if (phase === "ended") {
    body += '<h1>ゲーム終了</h1><p class="ochi-note">おつかれさまでした。配られたオチや投票は消去されました。</p>';
  }
  if (game.myOchi && !iAmSpeaker && ["ready", "telling", "vote", "reveal", "result", "skipped"].includes(phase)) body += `<div class="ochi-proxy"><p class="ochi-note">あなたのオチ（自分の番まで、ここでいつでも確認できます）</p>${secret(game.myOchi)}</div>`;
  if (host && !["lobby", "final", "ended"].includes(phase)) body += finishFooter();
  shell(`<section class="ochi-card">${body}${err()}</section>`);
  const panel = app.querySelector(".ochi-card");
  if (panel && state.busy) {
    panel.setAttribute("aria-busy", "true");
    panel.insertAdjacentHTML("beforeend", '<p class="ochi-note" role="status">反映中…</p>');
    app.querySelectorAll("[data-act],[data-guess]").forEach((button) => {
      button.disabled = true;
    });
  }
  bindHold();
  if (phase === "lobby" && state.host) {
    toDataURL(joinUrl(), { margin: 4, width: 180 })
      .then((src) => {
        const image = app.querySelector("[data-qr]");
        if (image) image.src = src;
      })
      .catch(() => {});
    app.querySelector("[data-copy]")?.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(joinUrl());
        state.error = "URLをコピーしました。";
      } catch {
        state.error = "コピーできませんでした。";
      }
      render();
    });
  }
}
// The ending is shown only while the button is held (or the key is down), so it never lingers on screen.
function bindHold() {
  app.querySelectorAll("[data-hold]").forEach((button) => {
    const set = (visible) => {
      const root = button.parentElement;
      const mask = root.querySelector("[data-mask]");
      const secretBox = root.querySelector("[data-secret]");
      if (mask) mask.hidden = visible;
      if (secretBox) secretBox.hidden = !visible;
    };
    button.addEventListener("pointerdown", () => set(true));
    for (const type of ["pointerup", "pointercancel", "pointerleave", "blur"]) button.addEventListener(type, () => set(false));
    button.addEventListener("keydown", (event) => {
      if (event.key === " " || event.key === "Enter") set(true);
    });
    button.addEventListener("keyup", () => set(false));
    button.addEventListener("contextmenu", (event) => event.preventDefault());
  });
}
function render() {
  const game = gameOf(state.data);
  const phaseKey = state.data ? `${game.phase}:${game.turnNo}` : state.creating ? "create" : "join";
  if (state.data) view(state.data);
  else if (state.creating) createView();
  else joinView();
  if (state.focusKey !== phaseKey) {
    state.focusKey = phaseKey;
    requestAnimationFrame(() => {
      const heading = app.querySelector("h1");
      if (heading) {
        heading.tabIndex = -1;
        heading.focus({ preventScroll: true });
      }
    });
  }
}
function tick() {
  const game = gameOf(state.data);
  if (game.phase !== "telling") return;
  const proxy = app.querySelector("[data-proxy-finish]");
  if (proxy && !state.busy) proxy.disabled = (remainingMs(game) ?? 0) > -PROXY_FINISH_GRACE_MS;
  const node = app.querySelector("[data-timer]");
  if (!node) return;
  const t = timerView(game);
  node.textContent = t.text;
  node.className = `ochi-timer ${t.cls}`;
  const ms = remainingMs(game);
  if (ms !== null && ms <= 10000 && ms > 0 && state.warnedTurn !== game.turnNo) {
    state.warnedTurn = game.turnNo;
    try {
      playFlipSound();
    } catch {}
  }
}
setInterval(tick, 250);
// a shared line (store wifi) can hit 429: back off 2s, 4s, 8s, 15s and return to the normal interval on success
const pollDelay = () => (state.failures ? Math.min(15000, 1000 * 2 ** Math.min(state.failures, 4)) : state.poll);
async function load() {
  if (!state.roomId || !state.token) return;
  if (state.busy) {
    clearTimeout(state.timer);
    state.timer = setTimeout(load, pollDelay());
    return;
  }
  const epoch = ++state.requestEpoch;
  try {
    const data = await accountApi.groupState(state.roomId, state.token);
    if (epoch !== state.requestEpoch) return;
    const game = gameOf(data);
    // the result is kept only briefly on the server: once this device has the closing screen it keeps it, even if a later read says 'ended'
    if (game.phase === "ended" && gameOf(state.data).phase === "final") {
      state.terminal = true;
      return;
    }
    const nextKey = JSON.stringify([data.room?.revision, game.phase, game.turnNo, game.confirmed, game.memberHasVoted, game.mySwapAvailable, game.myTruthLocked, game.votedCount, game.confirmedCount, data.room?.members?.length]);
    const hadError = Boolean(state.error);
    state.data = data;
    state.receivedAt = performance.now();
    state.host = data.host === true;
    state.terminal = game.phase === "ended" || game.phase === "final";
    if (game.phase === "ended") clearCredential();
    state.failures = 0;
    state.error = "";
    if (nextKey !== state.viewKey || hadError) {
      state.viewKey = nextKey;
      render();
    } else tick();
  } catch (error) {
    if (epoch !== state.requestEpoch) return;
    if ([401, 403, 404, 410].includes(Number(error?.status))) {
      clearCredential();
      state.data = null;
      state.host = false;
      state.terminal = true;
    } else state.failures += 1;
    state.error = "ルームを読み込めません。利用準備中か、期限切れの可能性があります。";
    render();
  } finally {
    clearTimeout(state.timer);
    if (!state.terminal && state.roomId && state.token && !document.hidden) state.timer = setTimeout(load, pollDelay());
  }
}
async function doAction(name) {
  if (state.busy || !state.data) return;
  const [action, argument] = name.split(":");
  const payload = argument ? (action === "vote" ? { guess: argument } : { truth: argument }) : {};
  await send(action, payload);
}
async function send(action, payload = {}) {
  if (state.busy || !state.data) return;
  state.busy = true;
  state.confirmFinish = false;
  render();
  const epoch = ++state.requestEpoch;
  const game = gameOf(state.data);
  let refetch = false;
  try {
    const data = await accountApi.ochiAction(state.roomId, state.token, action, state.data.room?.revision, { turnNo: Number(game.turnNo || 0), ...payload });
    if (epoch === state.requestEpoch) {
      state.data = data;
      state.receivedAt = performance.now();
      state.host = data.host === true;
      state.error = "";
      saveCredential();
    }
  } catch (e) {
    const status = Number(e?.status);
    // 409 = the screen was a step behind (someone else moved the game on): no error banner, just refetch right away
    refetch = status === 409;
    state.error = status === 409 ? "" : status === 403 ? "この操作はできません。" : status === 500 || status === 502 ? "このゲームは現在利用準備中です。" : "操作を反映できませんでした。";
  } finally {
    state.busy = false;
    state.viewKey = "";
    render();
    clearTimeout(state.timer);
    state.timer = setTimeout(load, pollDelay());
    if ((refetch || state.error) && state.terminal === false) load();
  }
}
app.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (state.busy) return;
  const form = event.target;
  const formData = new FormData(form);
  state.name = String(formData.get("name") || "").trim();
  state.busy = true;
  render();
  try {
    if (form.matches("[data-create]")) {
      const laps = Number(formData.get("laps")) === 2 ? 2 : 1;
      const result = await accountApi.createOchiRoom(state.name, venue, laps);
      state.roomId = result.room.id;
      state.invite = result.inviteToken;
      state.token = result.memberToken;
      state.host = true;
      history.replaceState({}, "", `/ochi-room.html?room=${encodeURIComponent(state.roomId)}&invite=${encodeURIComponent(state.invite)}&host=1${venue ? `&venue=${encodeURIComponent(venue)}` : ""}`);
      state.data = result;
      state.receivedAt = performance.now();
      saveCredential();
    } else {
      const memberSecret = joinSecret();
      saveJoinSecret(memberSecret);
      const result = await accountApi.joinGroupRoom(state.roomId, state.invite, state.name, false, memberSecret, false);
      state.token = result.memberToken;
      state.host = false;
      state.data = result;
      state.receivedAt = performance.now();
      clearJoinSecret();
      saveCredential();
    }
  } catch (e) {
    if (form.matches("[data-create]") && (Number(e?.status) === 401 || e?.message === "UNAUTHENTICATED")) {
      if (saveOchiAuthIntent({ venueToken: venue, name: state.name })) location.assign("/?ochiAuth=1");
      else state.error = "認証復帰の準備に失敗しました。もう一度お試しください。";
      return;
    }
    state.error = Number(e?.status) === 500 ? "このゲームは現在利用準備中です。" : Number(e?.status) === 409 ? "このルームには参加できません（満員か、すでに開始しています）。" : "参加できませんでした。入力と招待URLを確認してください。";
  } finally {
    state.busy = false;
    render();
    if (state.roomId && state.token) load();
  }
});
app.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.matches("[data-ask-finish]")) { state.confirmFinish = true; render(); return; }
  if (button.matches("[data-cancel-finish]")) { state.confirmFinish = false; render(); return; }
  if (button.dataset.guess) return send("vote", { guess: button.dataset.guess });
  if (button.dataset.act) return doAction(button.dataset.act);
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) load();
  else clearTimeout(state.timer);
});
await discoverAccountConfig();
restoreCredential();
if (state.roomId && state.token) load();
else if (!state.roomId) createView();
else render();

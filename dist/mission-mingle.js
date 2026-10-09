import { accountApi, discoverAccountConfig } from "./account.js";
import { toDataURL } from "./vendor/qr.js";
import { playFlipSound } from "./card-audio.js";
import { consumeMissionAuthIntent, saveMissionAuthIntent } from "./mission-mingle-auth-intent.js";

// 「ミッション・ミングル」: the whole gathering is the game. The phone stays in the pocket; the default screen is a dark
// page showing only the end time. Missions appear only while the screen is long-pressed (and hide again after 5 seconds
// of no touch, when the page loses focus, or when it goes to the background).
const app = document.querySelector("#mission-app");
const query = new URLSearchParams(location.search);
const roomId = query.get("room");
const invite = query.get("invite");
const venue = query.get("venue") || "";
const authReturn = consumeMissionAuthIntent();
const state = {
  roomId,
  invite,
  token: "",
  data: null,
  host: query.get("host") === "1" || query.get("create") === "1" || Boolean(venue),
  name: authReturn?.name || "",
  busy: false,
  pending: new Set(),
  error: "",
  timer: 0,
  failures: 0,
  requestEpoch: 0,
  creating: !roomId,
  viewKey: "",
  focusKey: "",
  terminal: false,
  revealMemo: [],
  receivedAt: 0,
  loading: false,
  lastLoadAt: 0,
  // pocket / long-press
  showMissions: false,
  idleTimer: 0,
  menuOpen: false,
  confirm: "",
  introStep: 0,
  confirmPass: "",
  cred: null,
  endTimer: 0,
  endNotifiedFor: "",
  closed: "",
};
const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const gameOf = (data) => data?.mission || {};
const memberOf = (data) => data?.member || {};
const DURATIONS = [30, 60, 120];
const PRESETS = [
  ["easy", "ゆるめ"],
  ["standard", "ふつう"],
  ["hard", "攻め"],
];
const SCENES = [
  ["party", "飲み会"],
  ["mixer", "合コン・街コン"],
  ["business", "懇親会"],
];
const labelOf = (list, id) => list.find(([key]) => key === id)?.[1] || "";
const DIFFICULTY = { 1: "かんたん", 2: "ふつう", 3: "むずかしい" };
const RULES = [
  "指令は、会話の中で自然にこなす。",
  "聞かれた人は答えなくてOK。無理に聞き出さない。",
  "嘘をつく・困らせる・お酒をすすめる・体に触れる・写真を撮る・連絡先を聞く、は指令の外。",
  "答えた内容はアプリに入力しません（入力欄はありません）。",
];
const IDLE_MS = 5000;
const HOLD_MS = 500;
const credentialKey = (id) => `mingle.mission.room:${id}`;
const CREDENTIAL_TTL = 24 * 60 * 60 * 1000;

// The game can stay in a pocket for two hours, so the credentials live in localStorage (not sessionStorage) -- expiring with the room.
function persistent() {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
}
function session() {
  try {
    return globalThis.sessionStorage;
  } catch {
    return null;
  }
}
function writeCredential() {
  if (!state.roomId || !state.token) return;
  const store = persistent();
  if (!store) return;
  const now = Date.now();
  const serverExpiry = Date.parse(state.data?.room?.expiresAt || "");
  const createdAt = state.cred?.createdAt ?? now;
  const limit = createdAt + CREDENTIAL_TTL;
  const expiresAt = state.cred?.expiresAt ?? (Number.isFinite(serverExpiry) ? Math.min(serverExpiry, limit) : limit);
  state.cred = { createdAt, expiresAt, introSeen: state.cred?.introSeen === true };
  try {
    store.setItem(credentialKey(state.roomId), JSON.stringify({ schema: 1, roomId: state.roomId, invite: state.invite, token: state.token, createdAt, expiresAt, introSeen: state.cred.introSeen }));
  } catch {}
}
const saveCredential = writeCredential;
function restoreCredential() {
  const store = persistent();
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
      state.cred = { createdAt: value.createdAt, expiresAt: value.expiresAt, introSeen: value.introSeen === true };
    } else store.removeItem(credentialKey(state.roomId));
  } catch {
    try {
      store.removeItem(credentialKey(state.roomId));
    } catch {}
  }
}
// the stored record goes as soon as the room is known to be over; the in-memory token stays so the summary can still be finished
function forgetStored() {
  try {
    persistent()?.removeItem(credentialKey(state.roomId));
  } catch {}
}
function clearCredential() {
  forgetStored();
  state.token = "";
}
// whether the one-time "your three missions" screen was shown already: kept in the credential record, so it expires with it
function introSeen() {
  return state.cred?.introSeen === true;
}
function markIntroSeen() {
  state.cred = { createdAt: state.cred?.createdAt ?? Date.now(), expiresAt: state.cred?.expiresAt ?? Date.now() + CREDENTIAL_TTL, introSeen: true };
  writeCredential();
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
    const value = session()?.getItem(`mingle.mission.join:${state.roomId}`);
    if (/^[A-Za-z0-9_-]{43}$/.test(value || "")) return (memoryJoinSecret = value);
  } catch {}
  return (memoryJoinSecret = newJoinSecret());
}
function saveJoinSecret(value) {
  memoryJoinSecret = value;
  try {
    session()?.setItem(`mingle.mission.join:${state.roomId}`, value);
  } catch {}
}
function clearJoinSecret() {
  memoryJoinSecret = "";
  try {
    session()?.removeItem(`mingle.mission.join:${state.roomId}`);
  } catch {}
}

// ---------------------------------------------------------------------------
// time
// ---------------------------------------------------------------------------
function serverNow() {
  const base = Date.parse(gameOf(state.data).serverNow || "");
  return Number.isFinite(base) ? base + (performance.now() - state.receivedAt) : Date.now();
}
const clockText = (ms) => {
  const t = new Date(ms);
  return `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
};
const endsAtMs = (game) => Date.parse(game.endsAt || "");

// ---------------------------------------------------------------------------
// views
// ---------------------------------------------------------------------------
function shell(body, { dark = false } = {}) {
  document.body.classList.toggle("mm-dark", dark);
  const venueOk = /^[A-Za-z0-9_-]{32}$/.test(venue);
  const homeHref = venueOk ? `/?venue=${encodeURIComponent(venue)}` : "/";
  app.innerHTML = dark ? body : `<header class="mm-brand"><a href="${homeHref}"><img src="/assets/mingle-cards-masthead.png" alt="Mingle.Cards"></a><a href="${homeHref}">${venueOk ? "店舗へ戻る" : "トップへ戻る"}</a></header>${body}`;
}
const err = () => (state.error ? `<p class="mm-error" role="alert">${esc(state.error)}</p>` : "");
const act = (name, label, cls = "primary-button", extra = "") => `<button type="button" class="${cls}" data-act="${esc(name)}" data-fid="act:${esc(name)}" ${state.busy ? "disabled" : ""} ${extra}>${label}</button>`;
const INTRO = "集まり全体がゲームです。各自に、秘密の「相手を知る指令」が3つ届きます。スマホはしまって、いつも通り会話してください。達成したら、こっそりタップ。終了時刻に全員の指令を公開して、答え合わせをします。";
const rulesList = () => `<ul class="mm-rules">${RULES.map((rule) => `<li>${esc(rule)}</li>`).join("")}</ul>`;
function createView() {
  shell(
    `<section class="mm-card"><h1>ミッション・ミングル</h1><p class="mm-note">${INTRO}</p>${rulesList()}<p class="mm-note">3〜8人で遊べます。時間・難易度などは、次の画面で選べます。</p><form class="mm-form" data-create><label>代表者の呼び名<input name="name" maxlength="40" required autocomplete="nickname" value="${esc(state.name)}"></label><button class="primary-button" type="submit" ${state.busy ? "disabled" : ""}>${state.busy ? "作成中…" : "ルームを作る"}</button>${err()}</form></section>`,
  );
}
function joinView() {
  shell(
    `<section class="mm-card"><h1>ミッション・ミングル に参加</h1><p class="mm-note">${INTRO}</p>${rulesList()}<form class="mm-form" data-join><label>呼び名<input name="name" maxlength="40" required autocomplete="nickname" value="${esc(state.name)}"></label><button class="primary-button" type="submit" ${state.busy ? "disabled" : ""}>${state.busy ? "参加中…" : "参加する"}</button>${err()}</form></section>`,
  );
}
function unavailableView(message) {
  shell(`<section class="mm-card"><h1>参加できません</h1><p class="mm-note">${esc(message)}</p><a class="secondary-button mm-link" href="/">トップへ戻る</a></section>`);
}
function joinUrl() {
  return `${location.origin}/mission-mingle.html?room=${encodeURIComponent(state.roomId)}&invite=${encodeURIComponent(state.invite || "")}`;
}
function qr() {
  return `<div class="mm-qr"><img data-qr alt="参加用QRコード" width="180" height="180"><input readonly value="${esc(joinUrl())}" aria-label="参加用URL"><button type="button" class="secondary-button" data-copy>URLをコピー</button></div>`;
}
const settingsSummary = (settings) => `${settings.durationMinutes || 60}分 · ${labelOf(PRESETS, settings.preset) || "ふつう"} · ${labelOf(SCENES, settings.scene) || "飲み会"}${settings.seatMode ? " · 席あり" : ""}`;
function seg(key, options, current) {
  return `<div class="mm-seg" role="group" aria-label="${esc(key)}">${options.map(([value, label]) => `<button type="button" class="mm-seg-btn" data-set-key="${esc(key)}" data-set-value="${esc(value)}" data-fid="set:${esc(key)}:${esc(value)}" aria-pressed="${String(value) === String(current)}" ${state.busy ? "disabled" : ""}>${esc(label)}</button>`).join("")}</div>`;
}
function lobbyView(data) {
  const room = data.room || {};
  const game = gameOf(data);
  const members = room.members || [];
  const settings = game.settings || {};
  let body = `<p class="mm-progress">参加者 ${members.length} / 8人</p><ul class="mm-members">${members.map((m) => `<li>${esc(m.name)}${m.role === "host" ? "（代表者）" : ""}</li>`).join("")}</ul>`;
  if (state.host) {
    const minutes = settings.durationMinutes || 60;
    body += `<div class="mm-settings"><h2>設定</h2><div class="mm-field"><span>時間</span>${seg("durationMinutes", DURATIONS.map((m) => [m, `${m}分`]), settings.durationMinutes)}</div><div class="mm-field"><span>難易度</span>${seg("preset", PRESETS, settings.preset)}</div><div class="mm-field"><span>場面</span>${seg("scene", SCENES, settings.scene)}</div><label class="mm-switch"><input type="checkbox" data-seat ${settings.seatMode ? "checked" : ""} ${state.busy ? "disabled" : ""}><span>席が決まっている（テーブル席）</span></label><p class="mm-note">ONにすると「右隣の人の〜」のような席に関わる指令も配られます。</p></div>`;
    body += `${act("start", "開始する", "primary-button", members.length < 3 ? "disabled" : "")}<p class="mm-note">${members.length < 3 ? "3人以上で開始できます。" : "全員がそろったら始めましょう。"} スマホのタイマーを${minutes}分にセットしておくと安心です。</p>${qr()}`;
  } else {
    body += `<p class="mm-summary">${esc(settingsSummary(settings))}</p><p class="mm-note">代表者が開始するまでお待ちください。開始すると、あなただけに指令が3つ届きます。</p>${rulesList()}`;
  }
  shell(`<section class="mm-card"><h1>ミッション・ミングル</h1>${body}${err()}</section>`);
  bindLobby();
}
function bindLobby() {
  if (state.host) {
    toDataURL(joinUrl(), { margin: 4, width: 180 })
      .then((src) => {
        const image = app.querySelector("[data-qr]");
        if (image) image.src = src;
      })
      .catch(() => {});
    app.querySelector("[data-copy]")?.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(joinUrl());
        toast("URLをコピーしました");
      } catch {
        toast("コピーできませんでした");
      }
    });
  }
}
function difficultyBadge(level) {
  return `<span class="mm-level" data-level="${esc(level)}">${esc(DIFFICULTY[level] || "")}</span>`;
}
function missionCard(item, { canSwap, canAct }) {
  const key = item.assignmentId;
  const wait = state.pending.has(key) ? "disabled" : "";
  let controls = "";
  if (!canAct) controls = "";
  else if (item.status === "achieved") controls = `<span class="mm-stamp">✓ 達成</span><button type="button" class="mm-mini" data-mission="unachieve" data-id="${esc(key)}" data-fid="m:unachieve:${esc(key)}" ${wait}>取り消す</button>`;
  else if (item.status === "passed") controls = '<span class="mm-passed">パスしました</span>';
  else if (state.confirmPass === key) controls = `<span class="mm-passed">パスしますか？</span><button type="button" class="mm-mini" data-mission="pass" data-id="${esc(key)}" data-fid="m:pass-yes:${esc(key)}" ${wait}>パスする</button><button type="button" class="mm-mini" data-cancel-pass data-fid="m:pass-no:${esc(key)}">やめる</button>`;
  else controls = `<button type="button" class="mm-do" data-mission="achieve" data-id="${esc(key)}" data-fid="m:achieve:${esc(key)}" ${wait}>できた</button><button type="button" class="mm-mini" data-ask-pass="${esc(key)}" data-fid="m:pass:${esc(key)}" ${wait}>パス</button>${canSwap ? `<button type="button" class="mm-mini" data-mission="swap" data-id="${esc(key)}" data-fid="m:swap:${esc(key)}" ${wait}>交換（残り1回）</button>` : ""}`;
  return `<article class="mm-mission is-${esc(item.status)}">${difficultyBadge(item.difficulty)}<p class="mm-text">${esc(item.text)}</p><div class="mm-controls">${controls}</div></article>`;
}
function missionList(game, { canSwap }) {
  const list = game.myMissions || [];
  if (!list.length) return '<p class="mm-note">指令を読み込み中です…</p>';
  return list.map((item) => missionCard(item, { canSwap: canSwap && game.swapsLeft > 0 && item.status === "active", canAct: true })).join("");
}
const TAKE_NOTE = "聞かれた人は、答えなくてOK。相手が答えたくなさそうなら、その指令はパスか交換を。";
function introView(game) {
  if (state.introStep === 0) {
    shell(`<section class="mm-card mm-secret"><h1>指令が3つ届きました</h1><p class="mm-note">他の人に見られないように、画面を隠して確認してください。何も触らないと5秒で隠れます。</p>${act("intro-next", "見る")}</section>`);
    return;
  }
  shell(`<section class="mm-card mm-secret"><h1>あなたの指令</h1>${(game.myMissions || []).map((item) => `<article class="mm-mission">${difficultyBadge(item.difficulty)}<p class="mm-text">${esc(item.text)}</p></article>`).join("")}<p class="mm-note">${TAKE_NOTE}</p><p class="mm-note">${esc(clockText(endsAtMs(game)))} まで。スマホはしまって、会話を楽しんでください。長押しすると、いつでも指令を確認できます。何も触らないと5秒で隠れます。</p>${act("intro-done", "覚えた！スマホをしまう")}</section>`);
}
function pocketView(data) {
  const game = gameOf(data);
  const host = state.host;
  const ends = endsAtMs(game);
  let menu = "";
  if (host && state.menuOpen) {
    const minutesLeft = Math.max(0, Math.ceil((ends - serverNow()) / 60000));
    const confirm = state.confirm;
    menu = `<div class="mm-menu" data-menu><p class="mm-menu-time">終了 ${esc(clockText(ends))}（あと${minutesLeft}分）</p>
      ${confirm === "end_now" ? `<p class="mm-menu-note">今すぐ答え合わせに進みますか？</p><div class="mm-menu-row">${act("end_now", "進める", "mm-menu-btn")}<button type="button" class="mm-menu-btn" data-cancel-confirm>やめる</button></div>` : confirm === "finish" ? `<p class="mm-menu-note">ゲームを終了しますか？</p><div class="mm-menu-row">${act("finish", "終了する", "mm-menu-btn")}<button type="button" class="mm-menu-btn" data-cancel-confirm>やめる</button></div>` : `<button type="button" class="mm-menu-btn" data-confirm="end_now">今すぐ答え合わせ</button>${act("extend", `延長 +15分（あと${game.extensionsLeft ?? 0}回）`, "mm-menu-btn", game.extensionsLeft > 0 ? "" : "disabled")}<button type="button" class="mm-menu-btn" data-confirm="finish">ゲームを終了</button>`}
      <button type="button" class="mm-menu-close" data-menu-toggle>閉じる</button>${state.error ? `<p class="mm-menu-note" role="alert">${esc(state.error)}</p>` : ""}</div>`;
  }
  // only the end time: no title, no logo, no wording that hints at what is behind the screen
  shell(
    `<main class="mm-pocket mm-secret" data-pocket-zone tabindex="0" aria-label="長押し"><p class="mm-pocket-time">${esc(clockText(ends))} まで</p>${host && !state.menuOpen ? '<button type="button" class="mm-menu-open" data-menu-toggle aria-label="メニュー">…</button>' : ""}${menu}</main>`,
    { dark: true },
  );
  bindPocket();
}
function missionScreenView(game) {
  shell(`<section class="mm-card mm-secret" data-missions><h1>あなたの指令</h1>${missionList(game, { canSwap: true })}<p class="mm-note">${TAKE_NOTE}</p><p class="mm-note">${esc(clockText(endsAtMs(game)))} まで。何も触らないと5秒で隠れます。</p><button type="button" class="secondary-button" data-hide>隠す</button></section>`);
}
function readyView(data) {
  const game = gameOf(data);
  const open = Date.parse(game.revealOpenAt || "");
  const lateOk = Number.isFinite(open) && serverNow() >= open;
  // the last-chance recording is behind a long press, exactly like during the game: nothing unachieved is left on screen
  const check = state.showMissions
    ? `<div class="mm-secret" data-missions>${missionList(game, { canSwap: false })}<button type="button" class="secondary-button" data-hide>隠す</button></div>`
    : '<div class="mm-pocket-lite mm-secret" data-pocket-zone tabindex="0" aria-label="長押し"><p class="mm-note">記録し忘れはありませんか？（長押しで確認）</p></div>';
  let body = `<h1>時間です！</h1><p class="mm-note">スマホを出して、答え合わせを待ちましょう。</p>${check}`;
  if (state.host) body += `${act("reveal_start", "答え合わせスタート")}`;
  else body += `<p class="mm-note">代表者が答え合わせを始めます。</p><div data-late-start ${lateOk ? "" : "hidden"}><p class="mm-note">代表者が操作できないときは、あなたが始められます。</p>${act("reveal_start", "答え合わせスタート", "secondary-button")}</div>`;
  shell(`<section class="mm-card">${body}${err()}</section>`);
  bindPocket();
}
// anybody may drive the reveal / the finish once the real end time + 3 minutes has passed (the representative may have left)
function lateReveal() {
  const open = Date.parse(gameOf(state.data).revealOpenAt || "");
  return Number.isFinite(open) && serverNow() >= open;
}
function revealView(data) {
  const game = gameOf(data);
  const reveal = game.reveal || {};
  const current = reveal.current;
  const last = Number(reveal.cursor) + 1 >= Number(reveal.total);
  const missions = current?.missions || [];
  const cards = missions.length
    ? missions.map((item, index) => `<article class="mm-reveal-card" style="--i:${index}">${difficultyBadge(item.difficulty)}<p class="mm-text">${esc(item.text)}</p><span class="mm-stamp">達成！</span>${item.note ? `<small>${esc(item.note)}</small>` : ""}</article>`).join("")
    : '<p class="mm-quiet-result">今回は会話を楽しみました</p>';
  const body = `<p class="mm-progress">${Number(reveal.cursor) + 1} / ${reveal.total}人目</p><h1>あの質問、指令だったの！？</h1><h2 class="mm-who">${esc(current?.name || "")}さんの指令は…</h2><div class="mm-reveal">${cards}</div>${state.host ? act("reveal_next", last ? "まとめへ" : "次の人へ") : `<p class="mm-note">代表者が次へ進めます。盛り上がってください。</p><div data-late-start ${lateReveal() ? "" : "hidden"}><p class="mm-note">代表者が操作できないときは、あなたが進められます。</p>${act("reveal_next", last ? "まとめへ" : "次の人へ", "secondary-button")}</div>`}`;
  shell(`<section class="mm-card">${body}${err()}</section>`);
}
function summaryView(data) {
  const game = gameOf(data);
  const summary = game.summary || {};
  const titles = summary.myTitles || [];
  // the server no longer keeps anyone's missions at the summary: the recap is what this device saw during the reveal (if it saw any)
  const recap = (state.revealMemo || []).map((person) => `<li><strong>${esc(person.name)}</strong>${person.missions.length ? `<ul>${person.missions.map((item) => `<li>${esc(item.text)}</li>`).join("")}</ul>` : '<span class="mm-quiet-result">会話を楽しみました</span>'}</li>`).join("");
  const body = `<h1>みんなで${Number(summary.achievedTotal || 0)}個達成！</h1><div class="mm-titles"><h2>あなたの称号</h2>${titles.length ? titles.map((t) => `<span class="mm-title">${esc(t)}</span>`).join("") : '<p class="mm-note">今回は会話をたっぷり楽しみました。</p>'}</div>${recap ? `<details class="mm-recap"><summary>みんなの答え合わせをふりかえる</summary><ul>${recap}</ul></details>` : ""}<p class="mm-note">この結果は数分で消去されます。</p><img class="mm-logo" src="/assets/mingle-cards-masthead.png" alt="Mingle.Cards。やっぱり人って面白い。" width="320" height="226">${state.host ? `<div class="mm-actions"><a class="primary-button mm-link" href="/mission-mingle.html?create=1${venue ? `&venue=${encodeURIComponent(venue)}` : ""}">新しいルームを作る</a><a class="secondary-button mm-link" href="/">トップへ戻る</a></div>` : '<a class="secondary-button mm-link" href="/">トップへ戻る</a>'}`;
  shell(`<section class="mm-card">${body}${err()}</section>`);
}
function endedView() {
  const newRoom = `/mission-mingle.html?create=1${venue ? `&venue=${encodeURIComponent(venue)}` : ""}`;
  shell(`<section class="mm-card"><h1>ゲーム終了</h1><p class="mm-note">おつかれさまでした。配られた指令は消去されました。</p>${state.host ? `<a class="primary-button mm-link" href="${newRoom}">新しいルームを作る</a>` : ""}<a class="secondary-button mm-link" href="/">トップへ戻る</a></section>`);
}
function view(data) {
  const game = gameOf(data);
  const phase = game.phase || "lobby";
  if (phase === "lobby") return lobbyView(data);
  if (phase === "mission") {
    if (!introSeen() && (game.myMissions || []).length) return introView(game);
    return state.showMissions ? missionScreenView(game) : pocketView(data);
  }
  document.body.classList.remove("mm-dark");
  if (phase === "reveal_ready") return readyView(data);
  if (phase === "reveal") return revealView(data);
  if (phase === "summary") return summaryView(data);
  return endedView();
}

// ---------------------------------------------------------------------------
// pocket: long press to look, auto-hide
// ---------------------------------------------------------------------------
// a screen that shows mission text: the one-time intro, or the long-press view (mission / time-is-up phases)
function introActive() {
  const game = gameOf(state.data);
  return Boolean(state.data) && game.phase === "mission" && !introSeen() && (game.myMissions || []).length > 0;
}
const secretShown = () => state.showMissions || introActive();
function resetIdle() {
  clearTimeout(state.idleTimer);
  state.idleTimer = secretShown() ? setTimeout(hideSecret, IDLE_MS) : 0;
}
function hideSecret() {
  clearTimeout(state.idleTimer);
  state.idleTimer = 0;
  state.confirmPass = "";
  if (introActive()) {
    // nobody looked in time: the intro counts as shown, the missions stay one long press away
    markIntroSeen();
    state.introStep = 0;
    render();
    return;
  }
  if (!state.showMissions) return;
  state.showMissions = false;
  render();
}
const hideMissions = hideSecret;
function revealMissions() {
  if (!["mission", "reveal_ready"].includes(gameOf(state.data).phase)) return;
  state.showMissions = true;
  state.menuOpen = false;
  render();
  resetIdle();
}
function bindPocket() {
  const zone = app.querySelector("[data-pocket-zone]");
  if (!zone) return;
  let hold = 0;
  const start = (event) => {
    if (event.target.closest("button,[data-menu]")) return;
    clearTimeout(hold);
    hold = setTimeout(revealMissions, HOLD_MS);
  };
  const stop = () => clearTimeout(hold);
  zone.addEventListener("pointerdown", start);
  for (const type of ["pointerup", "pointercancel", "pointerleave"]) zone.addEventListener(type, stop);
  zone.addEventListener("contextmenu", (event) => event.preventDefault());
  zone.addEventListener("keydown", (event) => {
    if ((event.key === " " || event.key === "Enter") && !event.repeat && !event.target.closest("button")) {
      event.preventDefault();
      start(event);
    }
  });
  zone.addEventListener("keyup", stop);
}
// every touch while the missions are on screen keeps them there another 5 seconds
document.addEventListener("pointerdown", () => {
  if (secretShown()) resetIdle();
});
document.addEventListener("keydown", () => {
  if (secretShown()) resetIdle();
});
window.addEventListener("blur", hideMissions);

// ---------------------------------------------------------------------------
// toast
// ---------------------------------------------------------------------------
let toastNode = null;
let toastTimer = 0;
function toast(message, { vibrate = false } = {}) {
  if (!toastNode) {
    toastNode = document.createElement("div");
    toastNode.className = "mm-toast";
    toastNode.setAttribute("role", "status");
    toastNode.setAttribute("aria-live", "polite");
    document.body.append(toastNode);
  }
  toastNode.textContent = message;
  toastNode.classList.add("is-on");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastNode?.classList.remove("is-on"), 1800);
  if (vibrate) {
    try {
      navigator.vibrate?.(30);
    } catch {}
  }
}

// ---------------------------------------------------------------------------
// render / focus
// ---------------------------------------------------------------------------
function render() {
  const game = gameOf(state.data);
  const phaseKey = state.data ? `${game.phase}:${game.reveal?.cursor ?? ""}:${state.showMissions}:${introSeen()}:${state.introStep}` : state.creating ? "create" : "join";
  const active = document.activeElement?.dataset?.fid || "";
  if (state.data) view(state.data);
  else if (state.creating) createView();
  else if (state.closed) unavailableView(state.closed);
  else joinView();
  if (secretShown() && !state.idleTimer) resetIdle();
  else if (!secretShown()) { clearTimeout(state.idleTimer); state.idleTimer = 0; }
  const panel = app.querySelector(".mm-card");
  if (panel && state.busy) panel.setAttribute("aria-busy", "true");
  if (state.focusKey !== phaseKey) {
    state.focusKey = phaseKey;
    requestAnimationFrame(() => {
      const heading = app.querySelector("h1");
      if (heading) {
        heading.tabIndex = -1;
        heading.setAttribute("data-focus", "");
        heading.focus({ preventScroll: true });
      }
    });
  } else if (active) app.querySelector(`[data-fid="${CSS.escape(active)}"]`)?.focus({ preventScroll: true });
}
// anything that changes what is on screen -- but not the clock or the poll hint
function keyOf(data) {
  const { serverNow: _now, pollMs: _poll, ...game } = gameOf(data);
  return JSON.stringify([data.room?.revision, data.room?.members?.length, data.host, game]);
}
function applyData(data) {
  state.data = data;
  state.receivedAt = performance.now();
  state.host = data.host === true;
  const phase = gameOf(data).phase;
  if (phase === "reveal" && gameOf(data).reveal?.revealed) state.revealMemo = gameOf(data).reveal.revealed;
  state.terminal = phase === "ended" || Number(gameOf(data).pollMs) === 0;
  // the room ends when the summary starts: the stored credential goes, the token stays in memory for the summary's finish
  if (data.room?.status === "ended") forgetStored();
  if (phase === "ended") clearCredential();
  if (phase !== "mission" && phase !== "reveal_ready") {
    state.showMissions = false;
    state.menuOpen = false;
    clearTimeout(state.idleTimer);
  }
  armEnd();
}

// ---------------------------------------------------------------------------
// the representative's end-of-mission cue (no Web Push: the end time is shared on screen, this device chimes, everyone catches up on open)
// ---------------------------------------------------------------------------
function armEnd() {
  clearTimeout(state.endTimer);
  const game = gameOf(state.data);
  if (game.phase !== "mission") return;
  const wait = endsAtMs(game) - serverNow();
  if (!Number.isFinite(wait)) return;
  state.endTimer = setTimeout(onEnd, Math.max(0, Math.min(wait + 400, 2 ** 31 - 1)));
}
function onEnd() {
  const game = gameOf(state.data);
  if (game.phase !== "mission") return;
  if (serverNow() < endsAtMs(game)) return armEnd();
  const mark = `${state.roomId}:${game.endsAt}`;
  if (state.host && state.endNotifiedFor !== mark && !document.hidden) {
    state.endNotifiedFor = mark;
    toast("時間です！ 答え合わせに進みましょう");
    try {
      playFlipSound();
    } catch {}
  }
  load();
}

// ---------------------------------------------------------------------------
// polling: the server hints the interval (30s on a mission, 5s in the last minute, 1s otherwise); hidden tabs do not poll
// ---------------------------------------------------------------------------
function nextDelay() {
  const hint = Number(gameOf(state.data).pollMs);
  const base = hint > 0 ? hint : 1000;
  return state.failures ? Math.min(15000, 1000 * 2 ** Math.min(state.failures, 4)) : base;
}
function schedule(delay = nextDelay()) {
  clearTimeout(state.timer);
  if (!state.terminal && state.roomId && state.token && !document.hidden) state.timer = setTimeout(load, delay);
}
async function load() {
  if (!state.roomId || !state.token) return;
  if (state.busy || state.loading) return schedule(1000);
  state.loading = true;
  state.lastLoadAt = Date.now();
  const epoch = ++state.requestEpoch;
  try {
    const data = await accountApi.groupState(state.roomId, state.token);
    if (epoch !== state.requestEpoch) return;
    const hadError = Boolean(state.error);
    // the summary is kept only briefly on the server: once this device has it, it keeps it, even if a later read says 'ended'
    if (gameOf(data).phase === "ended" && gameOf(state.data).phase === "summary") {
      state.terminal = true;
      return;
    }
    const changed = !state.data || keyOf(data) !== state.viewKey;
    applyData(data);
    state.failures = 0;
    state.error = "";
    if (changed || hadError) {
      state.viewKey = keyOf(data);
      render();
    } else tickClock();
  } catch (error) {
    if (epoch !== state.requestEpoch) return;
    if ([401, 403, 404, 410].includes(Number(error?.status))) {
      clearCredential();
      state.data = null;
      state.host = false;
      state.terminal = true;
      state.closed = "ルームを読み込めません。終了したか、期限切れの可能性があります。";
      state.error = state.closed;
      render();
    } else {
      state.failures += 1;
      state.error = "接続できません。つながり次第、自動で再読み込みします。";
      if (!state.showMissions && gameOf(state.data).phase !== "mission") render();
    }
  } finally {
    state.loading = false;
    schedule();
  }
}
// the late-start button for guests appears by the clock, not by a poll
function tickClock() {
  const game = gameOf(state.data);
  if (state.host || !["reveal_ready", "reveal", "summary"].includes(game.phase)) return;
  const ok = lateReveal();
  app.querySelectorAll("[data-late-start]").forEach((node) => {
    node.hidden = !ok;
  });
}
setInterval(tickClock, 1000);

// ---------------------------------------------------------------------------
// actions
// ---------------------------------------------------------------------------
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// 409 means the room moved on while this request was in flight (a time-out, a double tap): reload quietly, no wording
function errorText(status) {
  if (status === 409) return "";
  if (status === 403) return "この操作はできません。";
  if (status === 429) return "混み合っています。少し待ってからもう一度お試しください。";
  if (status === 500 || status === 502 || status === 503) return "このゲームは現在利用準備中です。";
  return "操作を反映できませんでした。";
}
const MISSION_TOASTS = { achieve: "記録しました", unachieve: "取り消しました", pass: "パスしました", swap: "指令を交換しました" };
// One in-flight request per assignment (double taps collapse into one); a 429 is retried after 2-5 seconds.
async function mission(action, id) {
  if (!state.data || state.pending.has(id)) return;
  state.pending.add(id);
  render();
  let applied = false;
  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const epoch = ++state.requestEpoch;
        const data = await accountApi.missionAction(state.roomId, state.token, action, state.data.room?.revision, { assignmentId: id });
        if (epoch === state.requestEpoch) {
          applyData(data);
          state.viewKey = keyOf(data);
          applied = true;
        }
        state.error = "";
        toast(MISSION_TOASTS[action] || "記録しました", { vibrate: action === "achieve" });
        break;
      } catch (error) {
        const status = Number(error?.status);
        if (status === 429 && attempt < 2) {
          toast("記録中…");
          await wait(2000 + Math.random() * 3000);
          continue;
        }
        state.error = errorText(status);
        if (state.error) toast(state.error);
        break;
      }
    }
  } finally {
    state.pending.delete(id);
    if (!applied) state.viewKey = "";
    render();
    resetIdle();
    if (!applied) load();
  }
}
async function send(action, payload = {}) {
  if (state.busy || !state.data) return false;
  state.busy = true;
  state.confirm = "";
  render();
  const epoch = ++state.requestEpoch;
  let ok = false;
  try {
    const data = await accountApi.missionAction(state.roomId, state.token, action, state.data.room?.revision, payload);
    if (epoch === state.requestEpoch) {
      applyData(data);
      state.viewKey = keyOf(data);
      state.error = "";
      saveCredential();
      ok = true;
    }
  } catch (error) {
    state.error = errorText(Number(error?.status));
  } finally {
    state.busy = false;
    state.viewKey = "";
    render();
    clearTimeout(state.timer);
    state.timer = setTimeout(load, 300);
  }
  return ok;
}
async function doAct(name) {
  if (name === "intro-next") {
    state.introStep = 1;
    return render();
  }
  if (name === "intro-done") {
    markIntroSeen();
    state.introStep = 0;
    return render();
  }
  if (name === "extend") return send("extend", { minutes: 15 });
  if (name === "reveal_next") return send("reveal_next", { cursor: Number(gameOf(state.data).reveal?.cursor) });
  return send(name, {});
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
      const result = await accountApi.createMissionRoom(state.name, venue);
      state.roomId = result.room.id;
      state.invite = result.inviteToken;
      state.token = result.memberToken;
      state.host = true;
      state.creating = false;
      history.replaceState({}, "", `/mission-mingle.html?room=${encodeURIComponent(state.roomId)}&invite=${encodeURIComponent(state.invite)}&host=1${venue ? `&venue=${encodeURIComponent(venue)}` : ""}`);
      applyData(result);
      saveCredential();
    } else {
      const memberSecret = joinSecret();
      saveJoinSecret(memberSecret);
      const result = await accountApi.joinGroupRoom(state.roomId, state.invite, state.name, false, memberSecret, false);
      state.token = result.memberToken;
      state.host = false;
      applyData(result);
      clearJoinSecret();
      saveCredential();
    }
    state.error = "";
  } catch (e) {
    if (form.matches("[data-create]") && (Number(e?.status) === 401 || e?.message === "UNAUTHENTICATED")) {
      if (saveMissionAuthIntent({ venueToken: venue, name: state.name })) location.assign("/?missionAuth=1");
      else state.error = "認証復帰の準備に失敗しました。もう一度お試しください。";
      state.busy = false;
      render();
      return;
    }
    state.error = Number(e?.status) === 500 ? "このゲームは現在利用準備中です。" : Number(e?.status) === 409 ? "このルームには参加できません（満員か、すでに開始しています）。" : "参加できませんでした。入力と招待URLを確認してください。";
  } finally {
    state.busy = false;
    state.viewKey = "";
    render();
    if (state.roomId && state.token) load();
  }
});
app.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.matches("[data-hide]")) return hideMissions();
  if (button.matches("[data-menu-toggle]")) {
    state.menuOpen = !state.menuOpen;
    state.confirm = "";
    return render();
  }
  if (button.dataset.confirm) {
    state.confirm = button.dataset.confirm;
    return render();
  }
  if (button.matches("[data-cancel-confirm]")) {
    state.confirm = "";
    return render();
  }
  if (button.dataset.setKey) {
    const key = button.dataset.setKey;
    const raw = button.dataset.setValue;
    return send("configure", { settings: { [key]: key === "durationMinutes" ? Number(raw) : raw } });
  }
  if (button.dataset.askPass) {
    state.confirmPass = button.dataset.askPass;
    resetIdle();
    return render();
  }
  if (button.matches("[data-cancel-pass]")) {
    state.confirmPass = "";
    return render();
  }
  if (button.dataset.mission) {
    state.confirmPass = "";
    return mission(button.dataset.mission, button.dataset.id);
  }
  if (button.dataset.act) return doAct(button.dataset.act);
});
// a long press must not open the browser's own menu on the secret screens
app.addEventListener("contextmenu", (event) => {
  if (event.target.closest?.(".mm-secret")) event.preventDefault();
});
app.addEventListener("change", (event) => {
  if (event.target.matches("[data-seat]")) send("configure", { settings: { seatMode: event.target.checked } });
});
function catchUp() {
  if (document.hidden) return;
  if (Date.now() - state.lastLoadAt < 400) return;
  load();
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    clearTimeout(state.timer);
    hideMissions();
  } else catchUp();
});
window.addEventListener("focus", catchUp);
window.addEventListener("online", catchUp);

await discoverAccountConfig();
document.title = "Mingle.Cards";
restoreCredential();
if (state.roomId && state.token) load();
else if (!state.roomId) createView();
else if (state.invite) {
  try {
    await accountApi.previewGroupRoom(state.roomId, state.invite);
    render();
  } catch (error) {
    state.closed = Number(error?.status) === 409 ? "このルームはすでに開始しています。開始後の参加はできません。" : "このルームは見つかりません。招待URLを確認してください。";
    render();
  }
} else render();

import { accountApi, discoverAccountConfig } from "./account.js";
import { toDataURL } from "./vendor/qr.js";
import { consumeOneCutAuthIntent, saveOneCutAuthIntent } from "./one-cut-auth-intent.js";
import { addClockSample, bestClockOffset, makeClockSample, pendingCues, serverNowFrom, stageAt } from "./one-cut-timeline.js";
import { cancelCues, getSoundPreference, isAudioSupported, isAudioUnlocked, saveSoundPreference, scheduleCues, unlockAudio } from "./one-cut-audio.js";

// 「ワンカット」room screen. The server decides every instant of the shoot; this page only replays them against a
// server-time estimate. Nothing about the answer, votes or likes is stored here (only the room credential and the sound choice).
const app = document.querySelector("#one-cut-app");
const query = new URLSearchParams(location.search);
const roomId = query.get("room");
const invite = query.get("invite");
const venue = query.get("venue") || "";
const authReturn = consumeOneCutAuthIntent();
const LABELS = ["A", "B", "C", "D", "E", "F"];
const state = {
  roomId,
  invite,
  token: "",
  data: null,
  host: query.get("host") === "1" || query.get("create") === "1" || Boolean(venue),
  name: authReturn?.name || "",
  busy: false,
  failures: 0,
  error: "",
  timer: 0,
  requestEpoch: 0,
  creating: !roomId,
  viewKey: "",
  focusKey: "",
  terminal: false,
  confirmFinish: false,
  // the representative's phone is also the shared monitor: private actions happen under a cover that is closed again afterwards
  cover: null, // null | "brief" | "vote" | "like"
  coverKey: "",
  coverDone: "",
  clockSamples: [],
  clockOffset: null,
  soundOn: false,
  soundTouched: false,
  cuesFor: "",
  vibratedFor: 0,
  catchupFor: 0,
  wake: null,
  wakePending: false,
  retrySoon: false,
};
const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const gameOf = (data) => data?.oneCut || {};
const memberOf = (data) => data?.member || {};
const credentialKey = (id) => `mingle.oneCut.room:${id}`;
const CREDENTIAL_TTL = 24 * 60 * 60 * 1000;

// ---- credentials (same shape as the other group games) -------------------------------------------------------------
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
    const value = storage()?.getItem(`mingle.oneCut.join:${state.roomId}`);
    if (/^[A-Za-z0-9_-]{43}$/.test(value || "")) return (memoryJoinSecret = value);
  } catch {}
  return (memoryJoinSecret = newJoinSecret());
}
function saveJoinSecret(value) {
  memoryJoinSecret = value;
  try {
    storage()?.setItem(`mingle.oneCut.join:${state.roomId}`, value);
  } catch {}
}
function clearJoinSecret() {
  memoryJoinSecret = "";
  try {
    storage()?.removeItem(`mingle.oneCut.join:${state.roomId}`);
  } catch {}
}

// ---- server clock ---------------------------------------------------------------------------------------------------
const nowServer = () => serverNowFrom(performance.now(), state.clockOffset);
function recordClock(sentAt, receivedAt, game) {
  const serverNowMs = Date.parse(game?.serverNow || "");
  state.clockSamples = addClockSample(state.clockSamples, makeClockSample({ sentAt, receivedAt, serverNowMs }));
  state.clockOffset = bestClockOffset(state.clockSamples);
}

// ---- sound ----------------------------------------------------------------------------------------------------------
function applySoundDefault() {
  if (state.soundTouched) return;
  state.soundOn = getSoundPreference(state.host);
}
function toggleSound() {
  state.soundTouched = true;
  state.soundOn = !state.soundOn;
  saveSoundPreference(state.soundOn);
  if (state.soundOn) unlockAudio().then(render);
  else cancelCues();
  render();
}
function scheduleTakeCues(game) {
  if (game.phase !== "take" || !state.soundOn || !isAudioUnlocked() || state.clockOffset === null) return;
  const key = `${game.takeNo}:${game.takeStartedAt}`;
  if (state.cuesFor === key) return;
  state.cuesFor = key;
  scheduleCues(pendingCues(game, nowServer()));
}

// ---- keeping the screen awake from the brief to the vote ------------------------------------------------------------
async function applyWake(phase) {
  const want = ["brief", "take", "vote"].includes(phase) && !document.hidden;
  try {
    if (want && !state.wake && !state.wakePending && navigator.wakeLock?.request) {
      state.wakePending = true;
      try {
        const lock = await navigator.wakeLock.request("screen");
        // the screen may have left the shoot while we waited: give the lock straight back
        if (!["brief", "take", "vote"].includes(gameOf(state.data).phase) || document.hidden) await lock.release();
        else {
          state.wake = lock;
          lock.addEventListener?.("release", () => {
            if (state.wake === lock) state.wake = null;
          });
        }
      } finally {
        state.wakePending = false;
      }
    } else if (!want && state.wake) {
      const lock = state.wake;
      state.wake = null;
      await lock.release();
    }
  } catch {
    state.wake = null;
  }
}

// ---- views ----------------------------------------------------------------------------------------------------------
function shell(body) {
  const venueOk = /^[A-Za-z0-9_-]{32}$/.test(venue);
  const homeHref = venueOk ? `/?venue=${encodeURIComponent(venue)}` : "/";
  const soundButton =
    state.data && !state.terminal
      ? `<button type="button" class="oc-sound" data-sound aria-pressed="${state.soundOn}">${state.soundOn ? "音 ON" : "音 OFF"}</button>`
      : "";
  app.innerHTML = `<header class="oc-brand"><a href="${homeHref}"><img src="/assets/mingle-cards-masthead.png" alt="Mingle.Cards"></a><span class="oc-brand-side">${soundButton}<a href="${homeHref}">${venueOk ? "店舗へ戻る" : "トップへ戻る"}</a></span></header>${body}`;
}
function err() {
  return state.error ? `<p class="oc-error" role="alert">${esc(state.error)}</p>` : "";
}
const INTRO =
  "主演が、お題の「その一瞬の顔」だけで演じます。ほかの人は、A〜Fのどの瞬間かを当てましょう。声も身ぶりも使いません。写真や録音は残りません。";
function createView() {
  shell(
    `<section class="oc-card"><h1>ワンカット</h1><p class="oc-note">${INTRO}</p><p class="oc-note">2〜8人で遊べます。1人ずつ順番に主演になります。</p><form class="oc-form" data-create><label>代表者の呼び名<input name="name" maxlength="40" required autocomplete="nickname" value="${esc(state.name)}"></label><label>遊ぶ長さ<select name="laps"><option value="auto">おまかせ（2〜4人は2周、5〜8人は1周）</option><option value="1">1周（全員が1回ずつ主演）</option><option value="2">2周</option><option value="3">3周</option></select></label><button class="primary-button" type="submit" ${state.busy ? "disabled" : ""}>${state.busy ? "作成中…" : "ルームを作る"}</button>${err()}</form></section>`,
  );
}
function joinView() {
  shell(
    `<section class="oc-card"><h1>ワンカット に参加</h1><p class="oc-note">${INTRO}</p><form class="oc-form" data-join><label>呼び名<input name="name" maxlength="40" required autocomplete="nickname" value="${esc(state.name)}"></label><button class="primary-button" type="submit" ${state.busy ? "disabled" : ""}>${state.busy ? "参加中…" : "参加する"}</button>${err()}</form></section>`,
  );
}
function joinUrl() {
  return `${location.origin}/one-cut.html?room=${encodeURIComponent(state.roomId)}&invite=${encodeURIComponent(state.invite || "")}`;
}
function qr() {
  return `<div class="oc-qr"><img data-qr alt="参加用QRコード"><input readonly value="${esc(joinUrl())}" aria-label="参加用URL"><button type="button" class="secondary-button" data-copy>URLをコピー</button></div>`;
}
const act = (name, label, cls = "primary-button", extra = "") => `<button type="button" class="${cls}" data-act="${name}" ${extra}>${label}</button>`;
function optionList(options) {
  return `<ol class="oc-options">${(options || []).map((option) => `<li><b>${esc(option.label)}</b><span>${esc(option.text)}</span></li>`).join("")}</ol>`;
}
function choiceButtons(options) {
  return `<div class="oc-choices">${(options || []).map((option, index) => `<button type="button" data-choice="${index}"><b>${esc(option.label)}</b><span>${esc(option.text)}</span></button>`).join("")}<button type="button" class="oc-pass" data-choice="pass">わからない（パス）</button></div>`;
}
function finishFooter() {
  if (!state.host) return "";
  return state.confirmFinish
    ? `<div class="oc-proxy"><p class="oc-note">撮影を終了しますか？ 配られたお題や投票は消え、得点は結果発表のために5分だけ残ります。</p><div class="oc-actions">${act("finish", "終了する", "secondary-button")}<button type="button" class="secondary-button" data-cancel-finish>やめる</button></div></div>`
    : `<div class="oc-proxy"><button type="button" class="secondary-button" data-ask-finish>撮影終了</button></div>`;
}
// "ふたりで◯点" for a pair, everyone's points otherwise (no ranks, no worst).
function scoreBoard(members, scores) {
  const values = members.map((m) => Number(scores?.[m.id] ?? 0));
  const pair = members.length === 2 ? `<p class="oc-pair-score">ふたりで ${values[0] + values[1]}点</p>` : "";
  return `${pair}<ul class="oc-rows">${members.map((m, i) => `<li><span>${esc(m.name)}</span><span class="oc-points">${values[i]}点</span></li>`).join("")}</ul>`;
}
function remainingText(game) {
  const ms = Date.parse(game.voteDeadline || "") - nowServer();
  return Number.isFinite(ms) ? `あと${Math.max(0, Math.ceil(ms / 1000))}秒で締め切り` : "";
}
function secretBlock(game) {
  const scene = game.myScene;
  if (!scene) return '<p class="oc-note">お題を確認中です…</p>';
  // the scene text is written into the page only while the button is held (see bindHold)
  return `<div class="oc-secret is-masked" data-mask>お題は押している間だけ表示されます</div><div class="oc-secret" data-secret hidden></div><button type="button" class="secondary-button oc-hold" data-hold>長押しでお題を見る</button>`;
}
function awardBanner(game, nameOf) {
  const takesPerLap = Number(game.takesInLap || 0);
  if (!takesPerLap || game.lap < 2 || game.takeNo !== (game.lap - 1) * takesPerLap + 1) return "";
  const award = (game.awards || []).find((item) => item.lap === game.lap - 1);
  if (!award?.memberIds?.length) return "";
  return `<p class="oc-award">ラウンド${game.lap - 1}の主演賞：${award.memberIds.map((id) => `${esc(nameOf(id))}さん`).join("、")}</p>`;
}

function view(data) {
  const room = data.room || {};
  const game = gameOf(data);
  const members = room.members || [];
  const me = memberOf(data).id;
  const phase = game.phase || "lobby";
  const nameOf = (id) => members.find((m) => m.id === id)?.name || "";
  const actorName = nameOf(game.actorMemberId);
  const isActor = game.isActor === true;
  const host = state.host;
  const sceneHead = phase === "final" ? "" : game.takeNo ? `<p class="oc-progress">シーン${game.takeNo} ・ ラウンド${game.lap}${game.lapsTotal ? ` / ${game.lapsTotal}` : ""}</p>` : `<p class="oc-progress">参加者 ${members.length} / 8人</p>`;
  let body = sceneHead;
  let cover = "";
  if (phase === "lobby") {
    body += `<ul class="oc-members">${members.map((m) => `<li>${esc(m.name)}${m.role === "host" ? "（代表者）" : ""}</li>`).join("")}</ul><ol class="oc-howto"><li>主演の人にだけ、A〜Fのうち1つの担当お題が伝わります。</li><li>「アクション！」の合図から3秒、そのお題の一瞬の顔だけで演じます。</li><li>ほかの人は、どの瞬間かを当てて投票します。</li></ol>`;
    body += host
      ? `${act("start", "撮影開始", "primary-button", members.length < 2 ? "disabled" : "")}<p class="oc-note">${members.length < 2 ? "2人以上で開始できます。" : "全員がそろったら始めましょう。"}</p><p class="oc-note">音を出す端末：この端末（右上の「音」で切り替え）。このスマホをテーブルの中央に置くと、みんなで画面を見られます。</p>${qr()}`
      : '<p class="oc-note">代表者が撮影を始めるまでお待ちください。音を鳴らしたいときは右上の「音」を押してください。</p>';
  } else if (phase === "brief") {
    body += awardBanner(game, nameOf);
    if (host && isActor) {
      body += `<h1>代表者がお題を確認します</h1><p class="oc-note">スマホを手に取ってください。確認が終わったらテーブルの中央に戻します。</p>${optionList(game.options)}${act("open-cover:brief", "お題を確認する（手に取って）")}`;
      if (state.cover === "brief")
        cover = `<div class="oc-cover" role="dialog" aria-modal="true" aria-label="代表者のお題確認"><h1>確認中…みんなは見ないでね</h1>${secretBlock(game)}<div class="oc-actions">${act("ready", "準備OK（テーブルに置く）")}${act("skip", "このテイクはパス", "secondary-button")}</div></div>`;
    } else if (isActor) {
      body += `<h1>あなたが主演！</h1>${optionList(game.options)}${secretBlock(game)}<div class="oc-actions">${act("ready", "準備OK")}${act("skip", "このテイクはパス", "secondary-button")}</div>`;
    } else {
      body += `<h1>主演は ${esc(actorName)}さん</h1><p class="oc-note">先にA〜Fを読んでおきましょう。${esc(actorName)}さんが準備できるまで待機します。</p>${optionList(game.options)}`;
      if (host) body += `<div class="oc-proxy"><p class="oc-note">${esc(actorName)}さんが操作できないときは、代わりに進められます。</p><div class="oc-actions">${act("ready", "代わりに準備OK", "secondary-button")}${act("skip", `${esc(actorName)}さんは今回パス`, "secondary-button")}</div></div>`;
    }
  } else if (phase === "take") {
    const watcher = !isActor && !host;
    body += `<div class="oc-stage${watcher ? " is-watcher" : ""}" data-stage-root data-stage="standby">${watcher ? `<p class="oc-watch">${esc(actorName)}さんの顔を見て！</p>` : ""}<div class="oc-stage-main"><div class="oc-slate" aria-hidden="true"><span></span></div><p class="oc-stage-text" data-stage-text>スタンバイ…</p><p class="oc-stage-sub" data-stage-sub>シーン${game.takeNo}　テイク1</p><svg class="oc-ring" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="44" class="oc-ring-bg"/><circle cx="50" cy="50" r="44" class="oc-ring-fg" data-ring/></svg></div></div>`;
    if (isActor) body += '<p class="oc-note">「アクション！」の合図で、お題のその一瞬の顔をしてみましょう（3秒間）。</p>';
    if (host) body += finishFooter();
  } else if (phase === "vote") {
    body += `<h1>${isActor ? "みんなが推理中…" : "どの瞬間だった？"}</h1>`;
    if (host) {
      body += `${optionList(game.options)}<p class="oc-progress">推理中… 投票 ${game.votedCount} / ${game.voterCount}人</p><p class="oc-note" data-vote-timer>${esc(remainingText(game))}</p>`;
      if (!isActor) body += game.memberHasVoted ? '<p class="oc-note">代表者は投票済みです。</p>' : act("open-cover:vote", "代表者の投票（手に取って）", "secondary-button");
      body += `<div class="oc-proxy">${act("close_vote", "締め切る", "secondary-button")}</div>`;
      if (state.cover === "vote" && !isActor)
        cover = `<div class="oc-cover" role="dialog" aria-modal="true" aria-label="代表者の投票">${state.coverDone ? `<h1>${esc(state.coverDone)}</h1>` : `<h1>代表者の投票</h1><p class="oc-note">選んだら、画面をテーブルに戻します。</p>${choiceButtons(game.options)}`}</div>`;
    } else if (isActor) {
      body += `<p class="oc-note">みんなが投票しています。</p><p class="oc-progress">投票 ${game.votedCount} / ${game.voterCount}人</p><p class="oc-note" data-vote-timer>${esc(remainingText(game))}</p>`;
    } else if (game.memberHasVoted) {
      body += `<p class="oc-note">投票しました。ほかの人を待っています。</p><p class="oc-progress">投票 ${game.votedCount} / ${game.voterCount}人</p><p class="oc-note" data-vote-timer>${esc(remainingText(game))}</p>`;
    } else {
      body += `<p class="oc-note">${esc(actorName)}さんが演じたのは、どれ？</p>${choiceButtons(game.options)}<p class="oc-note" data-vote-timer>${esc(remainingText(game))}</p>`;
    }
  } else if (phase === "result") {
    const r = game.result || { tally: [], passCount: 0, correctMemberIds: [], gained: {} };
    const gained = r.gained || {};
    const correctNames = (r.correctMemberIds || []).map((id) => esc(nameOf(id)));
    const verdict = isActor ? `みんなに伝わった人数：${r.correctMemberIds?.length || 0}人（あなた +${gained[me] || 0}）` : r.myVerdict === "correct" ? "当たり！ +1" : r.myVerdict === "wrong" ? "おしい！" : r.myVerdict === "pass" ? "パスでした（0点）" : "";
    const lastOfLap = game.takeNo % Math.max(1, game.takesInLap) === 0;
    const tallyRows = (game.options || []).map((option, index) => `<li class="${index === LABELS.indexOf(r.answerLabel) ? "is-answer" : ""}"><b>${esc(option.label)}</b><span>${esc(option.text)}</span><em>${r.tally?.[index] ?? 0}票</em></li>`).join("");
    body += `<h1>正解は ${esc(r.answerLabel || "")}！</h1><div class="oc-answer"><small>${esc(actorName)}さんが演じたのは</small>${esc(r.answerText || "")}</div><ul class="oc-tally">${tallyRows}</ul><p class="oc-note">わからない ${r.passCount ?? 0}人</p>`;
    body += `<p class="oc-note">${correctNames.length ? `正解したのは ${correctNames.join("、")}（それぞれ +1）` : "今回の正解者はいませんでした。"}</p><p class="oc-note">主演の ${esc(actorName)}さんは +${gained[game.actorMemberId] || 0}</p>${verdict ? `<p class="oc-note"><strong>${esc(verdict)}</strong></p>` : ""}${scoreBoard(members, game.scores)}`;
    body += `<p class="oc-talk">${esc(actorName)}さん、実際にこんな瞬間あった？</p>`;
    const nextLabel = lastOfLap ? "ラウンドの振り返りへ" : "次のシーンへ";
    body += isActor || host ? `<div class="oc-actions">${act("next", `話した！${nextLabel}`)}${act("next", `パスして${nextLabel}`, "secondary-button")}</div>` : `<p class="oc-note">${esc(actorName)}さんが話し終えたら、次へ進みます。</p>`;
  } else if (phase === "break") {
    const info = game.break || { lap: game.lap, takes: [], myLikeTargetId: null, likedCount: 0 };
    const performed = [...new Map(info.takes.filter((t) => !t.skipped).map((t) => [t.actorMemberId, t])).keys()];
    const lastLap = game.lapsTotal !== null && info.lap >= game.lapsTotal;
    const likeable = members.length >= 3;
    body += `<h1>ラウンド${info.lap} 終了</h1><ul class="oc-rows">${info.takes.map((t) => `<li><span>シーン${t.takeNo}　${esc(nameOf(t.actorMemberId))}さん</span><span>${t.skipped ? "パス" : esc(t.sceneText || "")}</span></li>`).join("")}</ul>${scoreBoard(members, game.scores)}`;
    if (likeable) {
      body += `<p class="oc-note">いいね済み ${info.likedCount} / ${members.length}人</p>`;
      if (host) body += act("open-cover:like", "代表者のいいね（手に取って）", "secondary-button");
      else body += `<h2 class="oc-sub">印象に残った主演にいいね（自分以外・1人）</h2><div class="oc-likes">${performed.filter((id) => id !== me).map((id) => `<button type="button" data-like="${esc(id)}" class="${info.myLikeTargetId === id ? "is-picked" : ""}" aria-pressed="${info.myLikeTargetId === id}">${esc(nameOf(id))}さん</button>`).join("") || '<p class="oc-note">いいねできる人がいません。</p>'}</div>`;
    }
    if (host) {
      body += `<div class="oc-actions">${act("continue", lastLap ? "結果発表へ" : "次のラウンドへ")}</div><p class="oc-note">${likeable ? "押すと、このラウンドの主演賞を発表します。" : ""}</p>`;
      if (state.cover === "like" && likeable)
        cover = `<div class="oc-cover" role="dialog" aria-modal="true" aria-label="代表者のいいね">${state.coverDone ? `<h1>${esc(state.coverDone)}</h1>` : `<h1>代表者のいいね</h1><p class="oc-note">自分以外の1人を選んでください。</p><div class="oc-likes">${performed.filter((id) => id !== me).map((id) => `<button type="button" data-like="${esc(id)}">${esc(nameOf(id))}さん</button>`).join("")}</div>`}</div>`;
    } else body += '<p class="oc-note">代表者が次へ進めます。</p>';
  } else if (phase === "ended") {
    const homeHref = /^[A-Za-z0-9_-]{32}$/.test(venue) ? `/?venue=${encodeURIComponent(venue)}` : "/";
    body += `<h1>撮影終了</h1><p class="oc-note">おつかれさまでした。得点や記録は消去されました。</p><div class="oc-actions">${host ? `<a class="primary-button oc-link" href="/one-cut.html?create=1${/^[A-Za-z0-9_-]{32}$/.test(venue) ? `&venue=${encodeURIComponent(venue)}` : ""}">新しいルームを作る</a>` : ""}<a class="secondary-button oc-link" href="${homeHref}">トップへ</a></div>`;
  } else if (phase === "final") {
    const awards = game.awards || [];
    const homeHref = /^[A-Za-z0-9_-]{32}$/.test(venue) ? `/?venue=${encodeURIComponent(venue)}` : "/";
    body += `<h1>オールアップ！</h1>${scoreBoard(members, game.scores)}${awards.length ? `<div class="oc-titles">${awards.map((a) => `<div><strong>ラウンド${a.lap}の主演賞</strong>${(a.memberIds || []).map((id) => `${esc(nameOf(id))}さん`).join("、")}</div>`).join("")}</div>` : ""}<p class="oc-note">撮影した顔や票は残していません。得点も数分で消去されます。やっぱり人って面白い。</p><div class="oc-actions">${host ? `<a class="primary-button oc-link" href="/one-cut.html?create=1${/^[A-Za-z0-9_-]{32}$/.test(venue) ? `&venue=${encodeURIComponent(venue)}` : ""}">もう一度（新しいルーム）</a>` : ""}<a class="secondary-button oc-link" href="${homeHref}">トップへ</a></div>`;
  }
  if (host && ["lobby", "brief", "vote", "result", "break"].includes(phase)) body += finishFooter();
  const banner = state.soundOn && phase !== "final" && isAudioSupported() && !isAudioUnlocked() ? '<p class="oc-banner" data-unlock>タップして音を有効に</p>' : "";
  shell(`${banner}<section class="oc-card" data-phase="${esc(phase)}">${body}${err()}</section>${cover}`);
  const panel = app.querySelector(".oc-card");
  if (panel && state.busy) {
    panel.setAttribute("aria-busy", "true");
    panel.insertAdjacentHTML("beforeend", '<p class="oc-note" role="status">反映中…</p>');
    app.querySelectorAll("[data-act],[data-choice],[data-like]").forEach((button) => {
      button.disabled = true;
    });
  }
  bindHold(game);
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
// The scene is shown only while the button is held (or the key is down). Its text lives in the page only for that time.
function bindHold(game) {
  app.querySelectorAll("[data-hold]").forEach((button) => {
    const root = button.parentElement;
    const set = (visible) => {
      const mask = root.querySelector("[data-mask]");
      const box = root.querySelector("[data-secret]");
      if (mask) mask.hidden = visible;
      if (box) {
        box.hidden = !visible;
        box.textContent = visible && game.myScene ? `あなたは ${game.myScene.label}：${game.myScene.text}` : "";
      }
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
  const phaseKey = state.data ? `${game.phase}:${game.takeNo}:${state.cover || ""}` : state.creating ? "create" : "join";
  if (state.data) view(state.data);
  else if (state.creating) createView();
  else joinView();
  if (state.focusKey !== phaseKey) {
    state.focusKey = phaseKey;
    requestAnimationFrame(() => {
      const heading = app.querySelector(".oc-cover h1") || app.querySelector("h1");
      if (heading) {
        heading.tabIndex = -1;
        heading.focus({ preventScroll: true });
      }
    });
  }
  tick();
}

// ---- the shooting sequence, replayed every 100 ms against the server clock -------------------------------------------
const STAGE_TEXT = { standby: "スタンバイ…", slate: "", yoi: "よーい…", action: "アクション！", cut: "カット！", vote: "みんなが推理中…" };
function tick() {
  const game = gameOf(state.data);
  if (game.phase === "vote") {
    const node = app.querySelector("[data-vote-timer]");
    if (node) node.textContent = remainingText(game);
    return;
  }
  if (game.phase !== "take") return;
  const root = app.querySelector("[data-stage-root]");
  if (!root || state.clockOffset === null) return;
  const result = stageAt(game, nowServer());
  const text = root.querySelector("[data-stage-text]");
  const sub = root.querySelector("[data-stage-sub]");
  const ring = root.querySelector("[data-ring]");
  root.dataset.stage = result.stage;
  if (text) text.textContent = result.stage === "count" ? String(result.count) : result.stage === "slate" ? `シーン${game.takeNo}` : STAGE_TEXT[result.stage] || "";
  if (sub) sub.textContent = result.stage === "slate" ? "テイク1" : result.stage === "count" ? "" : result.stage === "standby" ? `シーン${game.takeNo}　テイク1` : "";
  if (ring) {
    const progress = result.stage === "count" && Number.isFinite(result.nextInMs) ? 1 - result.nextInMs / 1000 : result.stage === "action" || result.stage === "cut" ? 1 : 0;
    ring.style.strokeDashoffset = String(276.5 * (1 - Math.max(0, Math.min(1, progress))));
  }
  if (result.stage === "action" && game.isActor && state.vibratedFor !== game.takeNo) {
    state.vibratedFor = game.takeNo;
    try {
      navigator.vibrate?.(200);
    } catch {}
  }
  // the cut has passed: ask for the vote screen right away instead of waiting for the next poll
  if (result.stage === "vote" && state.catchupFor !== game.takeNo) {
    state.catchupFor = game.takeNo;
    clearTimeout(state.timer);
    state.timer = setTimeout(load, 150);
  }
}
setInterval(tick, 100);

// ---- polling --------------------------------------------------------------------------------------------------------
// 750ms during brief/take (the show is synced by serverNow, not by poll rate); a shared line (store wifi) can hit 429: back off 2s, 4s, 8s, 15s, back to normal on success
const pollMs = () => (state.failures ? Math.min(15000, 1000 * 2 ** Math.min(state.failures, 4)) : ["brief", "take"].includes(gameOf(state.data).phase) ? 750 : 1000);
async function load() {
  if (!state.roomId || !state.token) return;
  if (state.busy) {
    clearTimeout(state.timer);
    state.timer = setTimeout(load, pollMs());
    return;
  }
  const epoch = ++state.requestEpoch;
  try {
    const sentAt = performance.now();
    const data = await accountApi.groupState(state.roomId, state.token);
    const receivedAt = performance.now();
    if (epoch !== state.requestEpoch) return;
    const game = gameOf(data);
    // the result is kept only briefly on the server: once this device has the closing screen it keeps it, even if a later read says 'ended'
    if (game.phase === "ended" && gameOf(state.data).phase === "final") {
      state.terminal = true;
      return;
    }
    recordClock(sentAt, receivedAt, game);
    const nextKey = JSON.stringify([data.room?.revision, data.host === true, game.isActor, game.phase, game.takeNo, game.memberHasVoted, game.myScene?.label, game.votedCount, game.break?.myLikeTargetId, game.break?.likedCount, data.room?.members?.length, game.lapsTotal, state.cover, state.coverDone]);
    const hadError = Boolean(state.error);
    state.data = data;
    state.host = data.host === true;
    applySoundDefault();
    state.terminal = game.phase === "final" || game.phase === "ended";
    if (state.terminal) {
      clearCredential();
      cancelCues();
    }
    // a private cover belongs to one phase of one take: close it when the room moves on
    const coverKey = `${game.phase}:${game.takeNo}`;
    if (state.cover && state.coverKey !== coverKey) closeCover();
    state.failures = 0;
    state.error = "";
    scheduleTakeCues(game);
    if (game.phase !== "take") cancelCues();
    applyWake(game.phase);
    if (nextKey !== state.viewKey || hadError) {
      state.viewKey = nextKey;
      render();
    } else tick();
  } catch (error) {
    if (epoch !== state.requestEpoch) return;
    // a 409 on a read is only a momentary stale view: say nothing and read again right away
    if (Number(error?.status) === 409) {
      state.retrySoon = true;
      return;
    }
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
    const soon = state.retrySoon;
    state.retrySoon = false;
    if (!state.terminal && state.roomId && state.token && !document.hidden) state.timer = setTimeout(load, soon ? 200 : pollMs());
  }
}
function openCover(kind) {
  const game = gameOf(state.data);
  state.cover = kind;
  state.coverKey = `${game.phase}:${game.takeNo}`;
  state.coverDone = "";
  render();
}
function closeCover() {
  state.cover = null;
  state.coverKey = "";
  state.coverDone = "";
  render();
}

// ---- actions --------------------------------------------------------------------------------------------------------
async function send(action, payload = {}) {
  if (state.busy || !state.data) return;
  state.busy = true;
  state.confirmFinish = false;
  render();
  const epoch = ++state.requestEpoch;
  const game = gameOf(state.data);
  const hadCover = state.cover;
  let ok = false;
  try {
    const data = await accountApi.oneCutAction(state.roomId, state.token, action, state.data.room?.revision, { takeNo: Number(game.takeNo || 0), lapNo: Number(game.lap || 0), ...payload });
    if (epoch === state.requestEpoch) {
      state.data = data;
      state.host = data.host === true;
      state.error = "";
      ok = true;
      saveCredential();
    }
  } catch (e) {
    const status = Number(e?.status);
    state.error = status === 409 ? "状況が更新されました。画面を確認して、もう一度お試しください。" : status === 403 ? "この操作はできません。" : status === 500 || status === 502 ? "このゲームは現在利用準備中です。" : "操作を反映できませんでした。";
  } finally {
    state.busy = false;
    state.viewKey = "";
    if (ok && hadCover && (action === "vote" || action === "like")) {
      // the private choice is acknowledged for a moment, then the cover goes away so the shared screen shows nothing of it
      state.coverDone = action === "vote" ? "投票しました" : "送りました";
      setTimeout(() => {
        if (state.coverDone) closeCover();
      }, 1000);
    } else if (hadCover && ok) {
      closeCover();
      clearTimeout(state.timer);
      state.timer = setTimeout(load, pollMs());
      return;
    }
    render();
    clearTimeout(state.timer);
    state.timer = setTimeout(load, pollMs());
  }
}
function doAct(name) {
  if (state.busy || !state.data) return;
  if (name.startsWith("open-cover:")) return openCover(name.slice("open-cover:".length));
  if (name === "start" && state.soundOn) unlockAudio();
  return send(name);
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
      const raw = String(formData.get("laps") || "auto");
      const lapsTotal = ["1", "2", "3"].includes(raw) ? Number(raw) : undefined;
      const result = await accountApi.createOneCutRoom(state.name, venue, lapsTotal);
      state.roomId = result.room.id;
      state.invite = result.inviteToken;
      state.token = result.memberToken;
      state.host = true;
      history.replaceState({}, "", `/one-cut.html?room=${encodeURIComponent(state.roomId)}&invite=${encodeURIComponent(state.invite)}&host=1${venue ? `&venue=${encodeURIComponent(venue)}` : ""}`);
      state.data = result;
      applySoundDefault();
      saveCredential();
    } else {
      const memberSecret = joinSecret();
      saveJoinSecret(memberSecret);
      const result = await accountApi.joinGroupRoom(state.roomId, state.invite, state.name, false, memberSecret, false);
      state.token = result.memberToken;
      state.host = false;
      state.data = result;
      applySoundDefault();
      clearJoinSecret();
      saveCredential();
    }
  } catch (e) {
    if (form.matches("[data-create]") && (Number(e?.status) === 401 || e?.message === "UNAUTHENTICATED")) {
      if (saveOneCutAuthIntent({ venueToken: venue, name: state.name })) location.assign("/?oneCutAuth=1");
      else state.error = "認証復帰の準備に失敗しました。もう一度お試しください。";
      state.busy = false;
      render();
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
  // the first tap on a reloaded page is what lets the browser play sound again
  if (state.soundOn && isAudioSupported() && !isAudioUnlocked()) unlockAudio().then(render);
  const button = event.target.closest("button");
  if (!button) return;
  if (button.matches("[data-sound]")) return toggleSound();
  if (button.matches("[data-ask-finish]")) { state.confirmFinish = true; render(); return; }
  if (button.matches("[data-cancel-finish]")) { state.confirmFinish = false; render(); return; }
  if (button.dataset.choice !== undefined) return send("vote", { choice: button.dataset.choice === "pass" ? null : Number(button.dataset.choice) });
  if (button.dataset.like) return send("like", { targetId: button.dataset.like });
  if (button.dataset.act) return doAct(button.dataset.act);
});
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    state.cuesFor = "";
    load();
  } else {
    clearTimeout(state.timer);
    cancelCues();
  }
  applyWake(gameOf(state.data).phase);
});
await discoverAccountConfig();
restoreCredential();
if (state.roomId && state.token) load();
else if (!state.roomId) createView();
else render();

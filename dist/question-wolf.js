import { accountApi, discoverAccountConfig } from "./account.js";
import { toDataURL } from "./vendor/qr.js";
import {
  consumeQuestionWolfAuthIntent,
  saveQuestionWolfAuthIntent,
} from "./question-wolf-auth-intent.js";
const app = document.querySelector("#question-wolf-app");
const query = new URLSearchParams(location.search);
const roomId = query.get("room");
const invite = query.get("invite");
const venue = query.get("venue") || "";
const authReturn = consumeQuestionWolfAuthIntent();
const state = {
  roomId,
  invite,
  token: "",
  data: null,
  host:
    query.get("host") === "1" || query.get("create") === "1" || Boolean(venue),
  name: authReturn?.name || "",
  busy: false,
  error: "",
  timer: 0,
  poll: 1000,
  requestEpoch: 0,
  showQuestion: false,
  creating: !roomId,
  questionRound: null,
  viewKey: "",
  focusKey: "",
  terminal: false,
};
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const gameOf = (data) => data?.questionWolf || {};
const memberOf = (data) => data?.member || {};
const credentialKey = (id) => `mingle.question-wolf.room:${id}`;
const CREDENTIAL_TTL = 24 * 60 * 60 * 1000;
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
  const expiresAt = Number.isFinite(serverExpiry)
    ? Math.min(serverExpiry, createdAt + CREDENTIAL_TTL)
    : createdAt + CREDENTIAL_TTL;
  try {
    store.setItem(
      credentialKey(state.roomId),
      JSON.stringify({
        schema: 1,
        roomId: state.roomId,
        invite: state.invite,
        token: state.token,
        createdAt,
        expiresAt,
      }),
    );
  } catch {}
}
function restoreCredential() {
  const store = storage();
  if (!store || !state.roomId) return;
  try {
    const value = JSON.parse(
      store.getItem(credentialKey(state.roomId)) || "null",
    );
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
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}
function joinSecret() {
  if (memoryJoinSecret) return memoryJoinSecret;
  try {
    const value = storage()?.getItem(
      `mingle.question-wolf.join:${state.roomId}`,
    );
    if (/^[A-Za-z0-9_-]{43}$/.test(value || ""))
      return (memoryJoinSecret = value);
  } catch {}
  return (memoryJoinSecret = newJoinSecret());
}
function saveJoinSecret(value) {
  memoryJoinSecret = value;
  try {
    storage()?.setItem(`mingle.question-wolf.join:${state.roomId}`, value);
  } catch {}
}
function clearJoinSecret() {
  memoryJoinSecret = "";
  try {
    storage()?.removeItem(`mingle.question-wolf.join:${state.roomId}`);
  } catch {}
}
function shell(body) {
  const homeHref = /^[A-Za-z0-9_-]{32}$/.test(venue)
    ? `/?venue=${encodeURIComponent(venue)}`
    : "/";
  const homeLabel = /^[A-Za-z0-9_-]{32}$/.test(venue)
    ? "店舗へ戻る"
    : "トップへ戻る";
  app.innerHTML = `<header class="wolf-brand"><a href="${homeHref}"><img src="/assets/mingle-cards-masthead.png" alt="Mingle.Cards"></a><a href="${homeHref}">${homeLabel}</a></header>${body}`;
}
function err() {
  return state.error
    ? `<p class="wolf-error" role="alert">${esc(state.error)}</p>`
    : "";
}
function createView() {
  shell(
    `<section class="wolf-card"><h1>質問ウルフ</h1><p class="wolf-note">1人だけ違う質問が配られます。自分が少数派かは分かりません。順番に答え、2分話し合って投票します。</p><form class="wolf-form" data-create><label>代表者の呼び名<input name="name" maxlength="40" required autocomplete="nickname" value="${esc(state.name)}"></label><button class="primary-button" type="submit" ${state.busy ? "disabled" : ""}>${state.busy ? "作成中…" : "ルームを作る"}</button>${err()}</form></section>`,
  );
}
function joinView() {
  shell(
    `<section class="wolf-card"><h1>質問ウルフに参加</h1><p class="wolf-note">1人だけ違う質問が配られます。自分が少数派かは分かりません。順番に答え、2分話し合って投票します。</p><form class="wolf-form" data-join><label>呼び名<input name="name" maxlength="40" required autocomplete="nickname" value="${esc(state.name)}"></label><button class="primary-button" type="submit" ${state.busy ? "disabled" : ""}>${state.busy ? "参加中…" : "参加する"}</button>${err()}</form></section>`,
  );
}
function qr() {
  const url = `${location.origin}/question-wolf.html?room=${encodeURIComponent(state.roomId)}&invite=${encodeURIComponent(state.invite || "")}`;
  return `<div class="wolf-qr"><img data-qr alt="参加用QRコード"><input readonly value="${esc(url)}" aria-label="参加用URL"><button type="button" class="secondary-button" data-copy>URLをコピー</button></div>`;
}
function view(data) {
  const room = data.room || {};
  const game = gameOf(data);
  const members = room.members || data.members || [];
  const phase = game.phase || room.phase || "lobby";
  if (state.questionRound !== game.round) {
    state.questionRound = game.round;
    state.showQuestion = false;
  }
  let body = `<p class="wolf-progress">参加者 ${members.length} / 8人${game.round ? `・第${game.round}ラウンド / 6` : ""}</p><ul class="wolf-members">${members.map((m) => `<li>${esc(m.name)}${m.role === "host" ? "（代表者）" : ""}</li>`).join("")}</ul>`;
  if (phase === "lobby")
    body += state.host
      ? `<button class="primary-button" data-act="start" ${members.length < 3 ? "disabled" : ""}>ゲームを始める</button>${members.length < 3 ? '<p class="wolf-note">3人以上で開始できます。</p>' : ""}${qr()}`
      : '<p class="wolf-note">代表者が開始するまでお待ちください。</p>';
  else if (phase === "confirm")
    body += `<h1>自分だけの質問を確認</h1><p class="wolf-note">自分の質問だけを見て、全員が確認したら次へ。</p>${state.showQuestion && game.myQuestion ? `<div class="wolf-secret">${esc(game.myQuestion)}</div><button class="secondary-button" data-hide-question>隠す</button>` : '<div class="wolf-secret">質問は本人だけに表示されます</div><button class="secondary-button" data-show-question>質問を見る</button>'}${game.confirmed ? '<p class="wolf-note">確認済みです。ほかの人を待っています。</p>' : '<button class="primary-button" data-act="confirm">確認した</button>'}`;
  else if (phase === "answer") {
    const answerer = members.find((m) => m.id === game.answeredMemberId);
    body += `<h1>回答タイム</h1><div class="wolf-answering">${esc(answerer?.name || "回答する人")}の番</div><p class="wolf-note">質問文は読まず、答えだけを声で伝えてください。回答内容は記録しません。</p>${answerer?.id === memberOf(data).id || state.host ? '<button class="primary-button" data-act="answer">答えた・次へ</button>' : '<p class="wolf-note">本人が答え終わるまでお待ちください。</p>'}`;
  } else if (phase === "discussion") {
    const deadline = Date.parse(game.discussionDeadline || "");
    const serverNow = Date.parse(game.serverNow || "");
    const remaining =
      Number.isFinite(deadline) && Number.isFinite(serverNow)
        ? Math.max(0, deadline - serverNow)
        : Infinity;
    body += `<h1>話し合い</h1><div class="wolf-timer" aria-live="polite">${Number.isFinite(remaining) ? `${Math.ceil(remaining / 1000)}秒` : "時間を確認中…"}</div><p class="wolf-note">2分後に自動で投票へ進みます。少数派だと思う人を話し合ってください。</p>`;
  } else if (phase === "vote") {
    const choices = game.memberHasVoted
      ? '<p class="wolf-note">投票しました。全員の投票を待っています。</p>'
      : members
          .filter((m) => m.id !== memberOf(data).id)
          .map(
            (m) =>
              `<button type="button" data-vote="${esc(m.id)}">${esc(m.name)}に投票</button>`,
          )
          .join("");
    body += `<h1>秘密投票</h1><p class="wolf-note">少数派だと思う人を1人選んでください。</p><div class="wolf-votes">${choices}</div>`;
  } else if (phase === "result") {
    const questions = game.questions || {};
    const tally = Object.entries(game.tally || {})
      .map(
        ([id, count]) =>
          `${esc(members.find((m) => m.id === id)?.name || id)}：${count}票`,
      )
      .join(" / ");
    body += `<h1>${game.outcome === "majority_win" ? "多数派の勝ち" : game.outcome === "minority_win" ? "少数派の勝ち" : "引き分け"}</h1><div class="wolf-result"><strong>少数派：${esc(members.find((m) => m.id === game.minorityMemberId)?.name || game.minorityMemberId || "—")}</strong><span>${tally || "票を集計中"}</span><div class="wolf-question-pair"><div>多数派の質問<br><strong>${esc(questions.majority || game.majorityQuestion || "—")}</strong></div><div>少数派の質問<br><strong>${esc(questions.minority || game.minorityQuestion || "—")}</strong></div></div></div>${state.host && Number(game.round || 0) < 6 ? '<button class="primary-button" data-act="next_round">次のラウンド</button>' : state.host ? '<button class="secondary-button" data-act="finish">ゲームを終了</button>' : ""}`;
  } else if (phase === "ended")
    body += '<h1>ゲーム終了</h1><p class="wolf-note">6ラウンド遊びました。</p>';
  if (["answer", "discussion", "vote"].includes(phase) && game.myQuestion)
    body += state.showQuestion
      ? `<div class="wolf-secret">${esc(game.myQuestion)}</div><button class="secondary-button" data-hide-question>質問を隠す</button>`
      : '<button class="secondary-button" data-show-question>自分の質問を見る</button>';
  shell(`<section class="wolf-card">${body}${err()}</section>`);
  const panel = app.querySelector(".wolf-card");
  if (panel && state.busy) {
    panel.setAttribute("aria-busy", "true");
    panel.insertAdjacentHTML(
      "beforeend",
      '<p class="wolf-note" role="status">反映中…</p>',
    );
    app.querySelectorAll("[data-act],[data-vote]").forEach((button) => {
      button.disabled = true;
    });
  }
  if (phase === "lobby" && state.host) {
    const url = `${location.origin}/question-wolf.html?room=${encodeURIComponent(state.roomId)}&invite=${encodeURIComponent(state.invite || "")}`;
    toDataURL(url, { margin: 4, width: 180 })
      .then((src) => {
        const image = app.querySelector("[data-qr]");
        if (image) image.src = src;
      })
      .catch(() => {});
    app.querySelector("[data-copy]")?.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(url);
        state.error = "URLをコピーしました。";
        render();
      } catch {
        state.error = "コピーできませんでした。";
        render();
      }
    });
  }
}
function render() {
  const phaseKey = state.data
    ? `${gameOf(state.data).phase}:${gameOf(state.data).round}:${gameOf(state.data).answeredMemberId || ""}`
    : state.creating
      ? "create"
      : "join";
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
function updateTimer(data) {
  const game = gameOf(data);
  if (game.phase !== "discussion") return;
  const deadline = Date.parse(game.discussionDeadline || "");
  const serverNow = Date.parse(game.serverNow || "");
  const node = app.querySelector(".wolf-timer");
  if (!node || !Number.isFinite(deadline) || !Number.isFinite(serverNow))
    return;
  node.textContent = `${Math.ceil(Math.max(0, deadline - serverNow) / 1000)}秒`;
}
async function load() {
  if (!state.roomId || !state.token) return;
  if (state.busy) {
    clearTimeout(state.timer);
    state.timer = setTimeout(load, state.poll);
    return;
  }
  const epoch = ++state.requestEpoch;
  try {
    const data = await accountApi.groupState(state.roomId, state.token);
    if (epoch !== state.requestEpoch) return;
    const nextKey = JSON.stringify([
      data.room?.revision,
      gameOf(data).phase,
      gameOf(data).round,
      gameOf(data).answeredMemberId,
      gameOf(data).confirmed,
      gameOf(data).memberHasVoted,
      gameOf(data).outcome,
      gameOf(data).tally,
    ]);
    const hadError = Boolean(state.error);
    state.data = data;
    state.host = data.host === true;
    state.terminal = gameOf(data).phase === "ended";
    if (state.terminal) clearCredential();
    state.error = "";
    if (nextKey !== state.viewKey || hadError) {
      state.viewKey = nextKey;
      render();
    } else updateTimer(data);
  } catch (error) {
    if (epoch !== state.requestEpoch) return;
    if ([401, 403, 404, 410].includes(Number(error?.status))) {
      clearCredential();
      state.data = null;
      state.host = false;
      state.terminal = true;
    }
    state.error =
      "ルームを読み込めません。利用準備中か、期限切れの可能性があります。";
    render();
  } finally {
    clearTimeout(state.timer);
    if (!state.terminal && state.roomId && state.token && !document.hidden)
      state.timer = setTimeout(load, state.poll);
  }
}
async function act(action, payload = {}) {
  if (state.busy || !state.data) return;
  state.busy = true;
  render();
  const epoch = ++state.requestEpoch;
  const currentGame = gameOf(state.data);
  try {
    const data = await accountApi.questionWolfAction(
      state.roomId,
      state.token,
      action,
      state.data.room?.revision,
      { roundNo: Number(currentGame.round || 0), ...payload },
    );
    if (epoch === state.requestEpoch) {
      state.data = data;
      state.host = data.host === true;
      state.error = "";
      saveCredential();
    }
  } catch (e) {
    state.error =
      Number(e?.status) === 500
        ? "このゲームは現在利用準備中です。"
        : "操作を反映できませんでした。";
  } finally {
    state.busy = false;
    render();
    clearTimeout(state.timer);
    state.timer = setTimeout(load, state.poll);
  }
}
app.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (state.busy) return;
  const form = event.target;
  state.name = String(new FormData(form).get("name") || "").trim();
  state.busy = true;
  render();
  try {
    if (form.matches("[data-create]")) {
      const result = await accountApi.createQuestionWolfRoom(state.name, venue);
      state.roomId = result.room.id;
      state.invite = result.inviteToken;
      state.token = result.memberToken;
      state.host = true;
      history.replaceState(
        {},
        "",
        `/question-wolf.html?room=${encodeURIComponent(state.roomId)}&invite=${encodeURIComponent(state.invite)}&host=1${venue ? `&venue=${encodeURIComponent(venue)}` : ""}`,
      );
      state.data = result;
      saveCredential();
    } else {
      const memberSecret = joinSecret();
      saveJoinSecret(memberSecret);
      const result = await accountApi.joinGroupRoom(
        state.roomId,
        state.invite,
        state.name,
        false,
        memberSecret,
        false,
      );
      state.token = result.memberToken;
      state.host = false;
      state.data = result;
      clearJoinSecret();
      saveCredential();
    }
  } catch (e) {
    if (
      form.matches("[data-create]") &&
      (Number(e?.status) === 401 || e?.message === "UNAUTHENTICATED")
    ) {
      if (saveQuestionWolfAuthIntent({ venueToken: venue, name: state.name }))
        location.assign("/?questionWolfAuth=1");
      else
        state.error = "認証復帰の準備に失敗しました。もう一度お試しください。";
      return;
    }
    state.error =
      Number(e?.status) === 500
        ? "このゲームは現在利用準備中です。"
        : "参加できませんでした。入力と招待URLを確認してください。";
  } finally {
    state.busy = false;
    render();
    if (state.roomId && state.token) load();
  }
});
app.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.matches("[data-show-question]")) {
    state.showQuestion = true;
    render();
    return;
  }
  if (button.matches("[data-hide-question]")) {
    state.showQuestion = false;
    render();
    return;
  }
  if (button.dataset.vote)
    return act("vote", { targetId: button.dataset.vote });
  if (button.dataset.act) return act(button.dataset.act);
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

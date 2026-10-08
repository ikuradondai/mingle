import {
  socialGames,
  matchPrompts,
  choicePrompts,
} from "./data/social-games.js";
import {
  readSocialGameIntent,
  saveSocialGameIntent,
  socialGameHomeHref,
} from "./social-game-intent.js";
import {
  createMatchGame,
  matchAction,
  createChoiceGame,
  choiceAction,
  nextUsedPromptIds,
} from "./social-game-state.js";

const root = document.querySelector("#social-game-app");
const gameId = new URLSearchParams(location.search).get("game");
const meta = socialGames.find((game) => game.id === gameId);
const intent = readSocialGameIntent();
const validIntent = intent && intent.gameId === gameId;
let game = null;
let usedIds = [];
let countdownTimer = null;

function esc(value) {
  const div = document.createElement("div");
  div.textContent = value == null ? "" : String(value);
  return div.innerHTML;
}
function focusHeading() {
  requestAnimationFrame(() => root.querySelector("[data-focus]")?.focus());
}
function promptText() {
  return game?.prompts?.[game.cursor]?.text || "";
}
function title() {
  return meta?.title || "みんなで遊ぶ";
}
function shell(body) {
  clearTimeout(countdownTimer);
  const href = socialGameHomeHref({
    venueToken: intent?.venueToken || "",
    returnToHome: true,
  });
  root.dataset.phase = game?.phase || "intro";
  root.dataset.turn =
    game && (game.phase === "handoff" || game.phase === "actual")
      ? 1 - game.turn
      : (game?.turn ?? "");
  root.innerHTML = `<div class="social-shell"><header class="social-top"><a class="social-brand" href="${esc(href)}"><img src="/assets/mingle-cards-masthead.png" alt="Mingle.Cards"></a><a class="social-exit" href="${esc(href)}">やめる</a></header>${body}</div>`;
  root.querySelectorAll(".social-brand,.social-exit").forEach((link) =>
    link.addEventListener("click", () =>
      saveSocialGameIntent({
        gameId,
        names: intent?.names || [],
        venueToken: intent?.venueToken || "",
      }),
    ),
  );
}
function begin() {
  usedIds = [];
  game =
    gameId === "match"
      ? createMatchGame({ names: intent.names, prompts: matchPrompts })
      : createChoiceGame({ names: intent.names, prompts: choicePrompts });
  render();
}
function restart() {
  const prompts = gameId === "match" ? matchPrompts : choicePrompts;
  const creator = gameId === "match" ? createMatchGame : createChoiceGame;
  game = creator({ names: intent.names, prompts, usedPromptIds: usedIds });
  render();
}
function renderIntro() {
  document.title = `${title()} | Mingle.Cards`;
  shell(
    `<main class="social-main"><p class="social-kicker">ゲーム · 全6問</p><h1 tabindex="-1" data-focus>${esc(title())}</h1><p class="social-lead">${esc(meta?.subtitle || "")}</p><p class="social-note">${gameId === "match" ? "声で答えをそろえて、最後にみんなで判定します。" : "予想する人と答える人を交代しながら遊びます。"}</p><div class="social-names">${intent.names.map((name) => `<span>${esc(name)}</span>`).join("")}</div><div class="social-actions"><button class="primary" data-action="begin" type="button">はじめる</button></div></main>`,
  );
  root.querySelector('[data-action="begin"]')?.addEventListener("click", begin);
  focusHeading();
}
function renderMissing() {
  shell(
    `<main class="social-main"><h1 tabindex="-1" data-focus>参加者を設定してね</h1><p class="social-lead">ホームで参加者を設定すると、このゲームで遊べます。</p><a class="primary-button" href="/">ホームで設定する</a></main>`,
  );
  focusHeading();
}
function renderMatch() {
  const round = game.cursor + 1;
  if (game.phase === "question")
    shell(
      `<main class="social-main"><p class="social-kicker">${round} / ${game.prompts.length}問</p><h1 tabindex="-1" data-focus>お題を見てね</h1><article class="social-card"><p class="social-question">${esc(promptText())}</p></article><p class="social-note">全員で答えを考えたら、ボタンを押してカウントダウン。</p><div class="social-actions"><button class="primary" data-action="countdown" type="button">せーので答える</button></div></main>`,
    );
  else if (game.phase === "countdown") {
    shell(
      `<main class="social-main"><p class="social-kicker">${round} / ${game.prompts.length}問</p><h1 tabindex="-1" data-focus>せーの…</h1><article class="social-card stage-change"><p class="social-question countdown">${game.countdown === 0 ? "せーの！" : game.countdown}</p></article><p class="social-note">みんなで声に出して同時に答えよう。</p></main>`,
    );
    countdownTimer = setTimeout(() => {
      game = matchAction(game, "tick");
      render();
    }, 1000);
  } else if (game.phase === "judgement")
    shell(
      `<main class="social-main"><p class="social-kicker">${round} / ${game.prompts.length}問</p><h1 tabindex="-1" data-focus>答えはそろった？</h1><article class="social-card"><p class="social-question">${esc(promptText())}</p></article><p class="social-note">口頭の答えは記録しません。みんなで自己判定してください。</p><div class="social-actions two"><button class="match" data-action="match" type="button">そろった！</button><button class="split" data-action="split" type="button">今回はバラバラ</button></div></main>`,
    );
  else renderComplete("match");
  bindMatch();
  focusHeading();
}
function bindMatch() {
  root
    .querySelector('[data-action="countdown"]')
    ?.addEventListener("click", () => {
      game = matchAction(game, "start-countdown");
      render();
    });
  root.querySelector('[data-action="tick"]')?.addEventListener("click", () => {
    game = matchAction(game, "tick");
    render();
  });
  ["match", "split"].forEach((action) =>
    root
      .querySelector(`[data-action="${action}"]`)
      ?.addEventListener("click", () => {
        game = matchAction(game, action);
        render();
      }),
  );
}
function renderChoice() {
  const round = game.cursor + 1;
  const predictor = game.names[game.turn];
  const actor = game.names[game.turn === 0 ? 1 : 0];
  const p = game.prompts[game.cursor];
  if (game.phase === "predict")
    shell(
      `<main class="social-main stage-change"><p class="social-kicker">${round} / ${game.prompts.length}問</p><h1 tabindex="-1" data-focus>${esc(predictor)}の予想</h1><p class="social-lead">${esc(actor)}なら、どっちを選ぶ？</p><article class="social-card"><p class="social-question">${esc(p.text)}</p></article><div class="social-option">${p.options.map((option, i) => `<button type="button" data-option="${i}">${esc(option)}</button>`).join("")}</div><p class="social-note">予想を選んだら、${esc(actor)}に端末を渡してね。</p></main>`,
    );
  else if (game.phase === "handoff")
    shell(
      `<main class="social-main"><p class="social-kicker">${round} / ${game.prompts.length}問</p><h1 tabindex="-1" data-focus>${esc(actor)}へ</h1><div class="social-handoff"><strong>あなたの番です</strong><p>予想は見えないままです。準備ができたらボタンを押してください。</p></div><div class="social-actions"><button class="primary" data-action="ready" type="button">準備できた</button></div></main>`,
    );
  else if (game.phase === "actual")
    shell(
      `<main class="social-main"><p class="social-kicker">${round} / ${game.prompts.length}問</p><h1 tabindex="-1" data-focus>${esc(actor)}の選択</h1><article class="social-card"><p class="social-question">${esc(p.text)}</p></article><div class="social-option">${p.options.map((option, i) => `<button type="button" data-actual="${i}">${esc(option)}</button>`).join("")}</div></main>`,
    );
  else if (game.phase === "result") {
    const result = game.result;
    shell(
      `<main class="social-main"><p class="social-kicker">${round} / ${game.prompts.length}問 · 答え合わせ</p><h1 tabindex="-1" data-focus>${result.correct ? "当たった！" : "今回は違った！"}</h1><div class="social-result"><strong>${esc(predictor)}の予想</strong><span>${esc(p.options[result.prediction])}</span><strong>${esc(actor)}の選択</strong><span>${esc(p.options[result.actual])}</span></div><div class="social-actions"><button class="primary" data-action="next" type="button">${round === game.prompts.length ? "結果を見る" : "次の問題へ"}</button></div></main>`,
    );
  } else renderComplete("choice");
  root.querySelectorAll("[data-option]").forEach((button) =>
    button.addEventListener("click", () => {
      game = choiceAction(game, "predict", Number(button.dataset.option));
      render();
    }),
  );
  root.querySelector('[data-action="ready"]')?.addEventListener("click", () => {
    game = choiceAction(game, "ready");
    render();
  });
  root.querySelectorAll("[data-actual]").forEach((button) =>
    button.addEventListener("click", () => {
      game = choiceAction(game, "actual", Number(button.dataset.actual));
      render();
    }),
  );
  root.querySelector('[data-action="next"]')?.addEventListener("click", () => {
    game = choiceAction(game, "next");
    render();
  });
  focusHeading();
}
function renderComplete(kind) {
  usedIds = Array.from(new Set(usedIds.concat(nextUsedPromptIds(game))));
  const rows = game.results
    .map(
      (result, i) =>
        `<div class="social-result"><strong>${i + 1}問目</strong><span>${kind === "match" ? (result.matched ? "そろった！" : "バラバラ") : result.correct ? "予想どおり！" : "ちがった！"}</span></div>`,
    )
    .join("");
  const poolSize =
    kind === "match" ? matchPrompts.length : choicePrompts.length;
  const remaining = Math.max(0, poolSize - usedIds.length);
  const exhausted = remaining === 0;
  shell(
    `<main class="social-main"><p class="social-kicker">結果</p><h1 tabindex="-1" data-focus>おつかれさま！</h1><p class="social-lead">${kind === "match" ? `${game.score} / ${game.results.length}問そろいました。` : `${game.score} / ${game.results.length}問予想が当たりました。`}</p><div class="social-list">${rows}</div><div class="social-actions"><button class="primary" data-action="${exhausted ? "reset" : "restart"}" type="button">${exhausted ? "お題を全部遊びました。新しく最初から遊ぶ" : `もう${Math.min(6, remaining)}問遊ぶ`}</button></div><p class="social-note">${exhausted ? "最初から遊ぶと、お題をリセットします。" : "次は、今まで使っていないお題から出題します。"}</p></main>`,
  );
  root
    .querySelector('[data-action="restart"]')
    ?.addEventListener("click", restart);
  root.querySelector('[data-action="reset"]')?.addEventListener("click", () => {
    usedIds = [];
    begin();
  });
  focusHeading();
}
function render() {
  if (game.phase === "error") {
    shell(
      `<main class="social-main"><h1 tabindex="-1" data-focus>参加者を確認してね</h1><p class="social-lead">${esc(game.error)}</p><a class="primary-button" href="/">ホームで設定する</a></main>`,
    );
    focusHeading();
    return;
  }
  if (game.exhausted || game.phase === "exhausted") {
    usedIds = Array.from(new Set(usedIds.concat(nextUsedPromptIds(game))));
    shell(
      `<main class="social-main"><h1 tabindex="-1" data-focus>お題を全部遊びました</h1><p class="social-lead">新しく最初から遊ぶと、お題をリセットできます。</p><div class="social-actions"><button class="primary" data-action="reset" type="button">新しく遊び直す</button></div></main>`,
    );
    root
      .querySelector('[data-action="reset"]')
      ?.addEventListener("click", () => {
        usedIds = [];
        begin();
      });
    focusHeading();
    return;
  }
  game.kind === "match" ? renderMatch() : renderChoice();
}
window.addEventListener("pagehide", () => clearTimeout(countdownTimer));
window.addEventListener("pageshow", (event) => {
  if (event.persisted) window.location.reload();
});
if (!meta) renderMissing();
else if (!validIntent) renderMissing();
else renderIntro();

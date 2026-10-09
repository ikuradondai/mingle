import { quizLevels, quizQuestions } from "./data/quiz-questions.js";
import { createQuizGame, quizAction, currentQuizQuestion } from "./quiz-state.js";

const root = document.querySelector("#quiz-app");
const params = new URLSearchParams(location.search);
const homeHref = "/";
const initialLevel = quizLevels.some((level) => level.id === params.get("level")) ? params.get("level") : quizLevels[0]?.id;
let levelId = initialLevel;
let game = null;
let usedQuestionIds = [];

function esc(value) { const div = document.createElement("div"); div.textContent = value == null ? "" : String(value); return div.innerHTML; }
function level() { return quizLevels.find((item) => item.id === levelId) || quizLevels[0]; }
function focusHeading() { requestAnimationFrame(() => root.querySelector("[data-focus]")?.focus()); }
function shell(body) { root.innerHTML = `<div class="quiz-shell"><header class="quiz-top"><a class="quiz-brand" href="${homeHref}"><img src="/assets/mingle-cards-masthead.png" alt="Mingle.Cards" /></a><a class="quiz-exit" href="${homeHref}">やめる</a></header>${body}</div>`; }
function pool() { return quizQuestions.filter((question) => question.level === levelId); }
function begin() { game = createQuizGame({ questions: pool(), levelId, usedQuestionIds: [] }); usedQuestionIds = [...game.usedQuestionIds]; render(); }
function continueQuiz() { game = createQuizGame({ questions: pool(), levelId, usedQuestionIds }); usedQuestionIds = [...game.usedQuestionIds]; render(); }
function renderIntro(focusLevelId = "") {
  document.title = "一般クイズ | Mingle.Cards";
  shell(`<main class="quiz-main"><p class="quiz-kicker">一般クイズ · 1セット6問</p><h1 tabindex="-1" data-focus>知っている？を楽しもう</h1><p class="quiz-lead">問題を読んで、答えを考えてみよう。正解を見て解説を読んだら、次の問題へ進みます。</p><div class="quiz-levels" aria-label="難易度を選ぶ">${quizLevels.map((item) => `<button type="button" data-level="${esc(item.id)}" ${item.id === levelId ? 'aria-current="true"' : ''}><strong>${esc(item.label)}</strong><small>${esc(item.description)}</small></button>`).join("")}</div><div class="quiz-actions"><button class="primary" type="button" data-action="begin">この難易度ではじめる</button></div></main>`);
  root.querySelectorAll("[data-level]").forEach((button) => button.addEventListener("click", () => { levelId = button.dataset.level; renderIntro(levelId); }));
  root.querySelector('[data-action="begin"]').addEventListener("click", begin);
  requestAnimationFrame(() => (focusLevelId ? root.querySelector(`[data-level="${CSS.escape(focusLevelId)}"]`) : root.querySelector("[data-focus]"))?.focus());
}
function renderQuestion() {
  const question = currentQuizQuestion(game); const round = game.cursor + 1;
  shell(`<main class="quiz-main"><p class="quiz-kicker">${esc(level().label)} · ${round} / ${game.questions.length}問</p><h1 tabindex="-1" data-focus>問題カード</h1><article class="quiz-card"><p class="quiz-question">${esc(question.question)}</p></article><p class="quiz-note">答えを考えたら、正解を見てみよう。</p><div class="quiz-actions"><button class="primary" type="button" data-action="reveal">正解を見る</button></div></main>`);
  root.querySelector('[data-action="reveal"]').addEventListener("click", () => { game = quizAction(game, "reveal"); render(); }); focusHeading();
}
function renderAnswer() {
  const question = currentQuizQuestion(game); const round = game.cursor + 1;
  shell(`<main class="quiz-main"><p class="quiz-kicker">${esc(level().label)} · ${round} / ${game.questions.length}問</p><h1 tabindex="-1" data-focus>正解・解説カード</h1><article class="quiz-card"><p class="quiz-note">問題：${esc(question.question)}</p><p class="quiz-answer">${esc(question.answer)}</p><p class="quiz-explanation">${esc(question.explanation)}</p></article><div class="quiz-actions"><button class="primary" type="button" data-action="next">${round === game.questions.length ? "おわる" : "次の問題"}</button></div></main>`);
  root.querySelector('[data-action="next"]').addEventListener("click", () => { game = quizAction(game, "next"); render(); }); focusHeading();
}
function renderComplete() {
  shell(`<main class="quiz-main"><p class="quiz-kicker">${esc(level().label)} · ${game.questions.length}問完了</p><h1 tabindex="-1" data-focus>おつかれさま！</h1><p class="quiz-lead">もう一度、同じ難易度の問題に挑戦できます。</p><div class="quiz-actions"><button class="primary" type="button" data-action="continue">もう${game.questions.length}問遊ぶ</button></div><div class="quiz-levels" aria-label="難易度を変更">${quizLevels.map((item) => `<button type="button" data-level="${esc(item.id)}"><strong>${esc(item.label)}でもう一度</strong><small>${esc(item.description)}</small></button>`).join("")}</div><footer class="quiz-footer"><a href="${homeHref}">ホームへ戻る</a></footer></main>`);
  root.querySelector('[data-action="continue"]').addEventListener("click", continueQuiz);
  root.querySelectorAll("[data-level]").forEach((button) => button.addEventListener("click", () => { levelId = button.dataset.level; usedQuestionIds = []; begin(); })); focusHeading();
}
function render() { if (!game) renderIntro(); else if (game.phase === "question") renderQuestion(); else if (game.phase === "answer") renderAnswer(); else renderComplete(); }
render();

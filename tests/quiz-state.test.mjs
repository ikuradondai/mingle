import test from "node:test";
import assert from "node:assert/strict";
import { createQuizGame, quizAction, currentQuizQuestion, QUIZ_SET_SIZE } from "../dist/quiz-state.js";

const questions = Array.from({ length: 12 }, (_, index) => ({
  id: `q${index + 1}`,
  question: `問題${index + 1}`,
  answer: `答え${index + 1}`,
  explanation: `解説${index + 1}`,
}));

test("quiz enforces question then answer then next", () => {
  const game = createQuizGame({ questions, random: () => 0 });
  assert.equal(game.questions.length, QUIZ_SET_SIZE);
  assert.equal(game.phase, "question");
  assert.equal(currentQuizQuestion(game).id, game.questions[0].id);
  assert.throws(() => quizAction(game, "next"), /QUIZ_ACTION/);
  const answer = quizAction(game, "reveal");
  assert.equal(answer.phase, "answer");
  assert.throws(() => quizAction(answer, "reveal"), /QUIZ_ACTION/);
  assert.equal(quizAction(answer, "next").phase, "question");
});

test("sixth answer completes the set and continuation prefers unseen questions", () => {
  let game = createQuizGame({ questions, random: () => 0 });
  for (let index = 0; index < QUIZ_SET_SIZE; index += 1) {
    game = quizAction(game, "reveal");
    game = quizAction(game, "next");
  }
  assert.equal(game.phase, "complete");
  const next = createQuizGame({ questions, usedQuestionIds: game.usedQuestionIds, random: () => 0 });
  assert.equal(next.questions.length, QUIZ_SET_SIZE);
  assert.equal(next.questions.some((question) => game.questions.some((old) => old.id === question.id)), false);
  assert.equal(new Set(next.questions.map((question) => question.id)).size, QUIZ_SET_SIZE);
});

test("exhausted pool starts a fresh set without duplicate questions", () => {
  const game = createQuizGame({ questions: questions.slice(0, 2), usedQuestionIds: ["q1", "q2"] });
  assert.deepEqual(game.questions.map((question) => question.id).sort(), ["q1", "q2"]);
  assert.deepEqual(game.usedQuestionIds, game.questions.map((question) => question.id));
});

test("three consecutive sets cycle through a 12-question pool without within-set duplicates", () => {
  let used = [];
  const sets = [];
  for (let index = 0; index < 3; index += 1) {
    const game = createQuizGame({ questions, usedQuestionIds: used, random: () => 0.25 });
    const ids = game.questions.map((question) => question.id);
    assert.equal(new Set(ids).size, ids.length);
    sets.push(ids);
    used = game.usedQuestionIds;
  }
  assert.equal(new Set([...sets[0], ...sets[1]]).size, 12);
  assert.equal(sets[2].length, QUIZ_SET_SIZE);
});

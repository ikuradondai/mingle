import test from 'node:test';
import assert from 'node:assert/strict';
import { QUICK_QUIZ_LEVELS, QUICK_QUIZ_QUESTIONS, getQuickQuizQuestion } from '../server-side/quick-quiz-questions.mjs';

const levelIds = QUICK_QUIZ_LEVELS.map(({ id }) => id);

test('quick quiz preserves four levels and forty stable IDs per level', () => {
  assert.deepEqual(levelIds, ['beginner', 'intermediate', 'advanced', 'expert']);
  assert.equal(QUICK_QUIZ_QUESTIONS.length, 160);
  assert.equal(new Set(QUICK_QUIZ_QUESTIONS.map(({ id }) => id)).size, 160);
  for (const level of levelIds) {
    const questions = QUICK_QUIZ_QUESTIONS.filter((question) => question.level === level);
    assert.equal(questions.length, 40, level);
    assert.deepEqual(questions.map(({ id }) => id), Array.from({ length: 40 }, (_, i) => `${level}-${String(i + 1).padStart(2, '0')}`));
  }
});

test('each item has four distinct safe choices and exactly one canonical correct choice', () => {
  for (const question of QUICK_QUIZ_QUESTIONS) {
    assert.ok(levelIds.includes(question.level), question.id);
    assert.match(question.question, /？$/, question.id);
    assert.equal(question.choices.length, 4, question.id);
    assert.equal(new Set(question.choices.map(({ id }) => id)).size, 4, question.id);
    assert.equal(new Set(question.choices.map(({ text }) => text)).size, 4, question.id);
    assert.ok(question.choices.every(({ id, text }) => /^[0-9a-f]{16}$/.test(id) && text.trim()), question.id);
    assert.ok(question.choices.every(({ id }) => !/-choice-[1-4]$/.test(id)), question.id);
    assert.equal(question.choices.filter(({ id }) => id === question.correctChoiceId).length, 1, question.id);
    assert.ok(question.explanation.trim(), question.id);
  }
});

test('correctness remains tied to opaque choice IDs after any choice reorder', () => {
  for (const question of QUICK_QUIZ_QUESTIONS) {
    const shuffled = [...question.choices].reverse();
    const correct = shuffled.find(({ id }) => id === question.correctChoiceId);
    assert.ok(correct, question.id);
    assert.equal(correct.text, question.choices[0].text, question.id);
  }
});

test('canonical choice one matches the original answer for every existing item', () => {
  const expected = {
    'beginner-01': '北海道', 'beginner-02': '金星', 'beginner-03': '0℃', 'beginner-04': '180度',
    'beginner-05': 'water', 'beginner-06': '円', 'beginner-07': '5本', 'beginner-08': '光合成',
    'beginner-09': '7色', 'beginner-10': '20', 'beginner-11': 'CO₂', 'beginner-12': '5月5日',
    'intermediate-01': '窒素', 'intermediate-02': '衆議院と参議院', 'intermediate-03': '約340m', 'intermediate-04': '京都市',
    'intermediate-05': 'ワトソンとクリック', 'intermediate-06': '清少納言', 'intermediate-07': '7', 'intermediate-08': 'H₂O',
    'intermediate-09': '富士山', 'intermediate-10': '森', 'intermediate-11': '北半球と南半球', 'intermediate-12': '31',
    'advanced-01': '1024', 'advanced-02': 'タングステン', 'advanced-03': '東経135度', 'advanced-04': '琵琶湖',
    'advanced-05': '1868年', 'advanced-06': '葛飾北斎', 'advanced-07': '成層圏', 'advanced-08': '97回',
    'advanced-09': '信濃川', 'advanced-10': '8', 'advanced-11': '世阿弥', 'advanced-12': '1867年',
    'expert-01': 'カンデラ', 'expert-02': '大化', 'expert-03': '88日', 'expert-04': 'ホメロス',
    'expert-05': '720年', 'expert-06': '142857', 'expert-07': '273.16K', 'expert-08': '5種類',
    'expert-09': '川の流れ', 'expert-10': '10段階', 'expert-11': '84通り', 'expert-12': '338350',
  };
  for (const [id, answer] of Object.entries(expected)) {
    const question = getQuickQuizQuestion(id);
    const correct = question.choices.find(({ id: choiceId }) => choiceId === question.correctChoiceId);
    assert.equal(correct.text, answer, id);
  }
});


import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { quizLevels, quizQuestions } from '../dist/data/quiz-questions.js';

test('quiz levels and questions have stable, unique content', () => {
  assert.deepEqual(quizLevels.map((level) => level.id), ['beginner', 'intermediate', 'advanced', 'expert']);
  assert.equal(quizQuestions.length, 48);
  assert.equal(new Set(quizQuestions.map((item) => item.id)).size, quizQuestions.length);
  assert.equal(new Set(quizQuestions.map((item) => item.question)).size, quizQuestions.length);
  const levels = new Set(quizLevels.map((level) => level.id));
  for (const item of quizQuestions) {
    assert.ok(levels.has(item.level), item.id);
    assert.ok(item.question.endsWith('？'), item.id);
    assert.ok(item.answer.trim() && item.explanation.trim(), item.id);
  }
  for (const level of levels) assert.equal(quizQuestions.filter((item) => item.level === level).length, 12, level);
});

test('specialist questions have an auditable source or an exact calculation', () => {
  const sources = readFileSync(new URL('../docs/QUIZ_CONTENT_SOURCES.md', import.meta.url), 'utf8');
  for (const item of quizQuestions.filter(({ level }) => level === 'advanced' || level === 'expert')) {
    assert.match(sources, new RegExp(`\\b${item.id}\\b`), item.id);
  }
});

test('advanced and expert answers are not duplicated as separate specialist prompts', () => {
  const specialist = quizQuestions.filter(({ level }) => level === 'advanced' || level === 'expert');
  assert.equal(new Set(specialist.map(({ answer }) => answer)).size, specialist.length);
});

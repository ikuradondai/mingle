import test from 'node:test';
import assert from 'node:assert/strict';
import { questionWolfTopics } from '../dist/data/question-wolf-topics.js';

test('question wolf topics contain enough unique, close question pairs', () => {
  assert.ok(questionWolfTopics.length >= 36);
  const ids = questionWolfTopics.map((topic) => topic.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const topic of questionWolfTopics) {
    assert.match(topic.id, /^[a-z0-9-]+$/);
    assert.equal(typeof topic.majority, 'string');
    assert.equal(typeof topic.minority, 'string');
    assert.ok(topic.majority.trim());
    assert.ok(topic.minority.trim());
    assert.notEqual(topic.majority, topic.minority);
    assert.equal(topic.majority.includes('\n'), false);
    assert.equal(topic.minority.includes('\n'), false);
  }
});

test('question wolf pairs do not reuse either question text', () => {
  const texts = questionWolfTopics.flatMap(({ majority, minority }) => [majority, minority]);
  assert.equal(new Set(texts).size, texts.length);
});

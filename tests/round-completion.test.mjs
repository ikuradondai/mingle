import test from 'node:test';
import assert from 'node:assert/strict';
import { roundCompletionInfo } from '../dist/round-completion.js';

test('round completion counts a full six-card round and remaining cards', () => {
  assert.deepEqual(roundCompletionInfo({ sessionId: 'a', questions: Array(40), cursor: 6, roundStart: 0 }), { total: 40, cursor: 6, start: 0, completed: 6, final: false, remaining: 34, nextCount: 6, key: 'a:0:6' });
});

test('final partial round uses its actual count and never claims another round', () => {
  const info = roundCompletionInfo({ sessionId: 'b', questions: Array(14), cursor: 14, roundStart: 12 });
  assert.equal(info.completed, 2);
  assert.equal(info.final, true);
  assert.equal(info.remaining, 0);
  assert.equal(info.nextCount, 0);
});

test('saved session data distinguishes consecutive rounds and restores the same boundary', () => {
  const first = { sessionId: 'c', questions: Array(12), cursor: 6, roundStart: 0 };
  const resumed = { sessionId: 'c', questions: Array(12), cursor: 12, roundStart: 6 };
  assert.equal(roundCompletionInfo(first).completed, 6);
  assert.equal(roundCompletionInfo(resumed).completed, 6);
  assert.notEqual(roundCompletionInfo(first).key, roundCompletionInfo(resumed).key);
  assert.deepEqual(roundCompletionInfo({ ...first }), roundCompletionInfo(first));
});

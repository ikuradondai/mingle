import test from 'node:test';
import assert from 'node:assert/strict';
import { createSession, summarizeLikes, sessionLikeTotals } from '../dist/engine.js';
import { saveSession, loadSession } from '../dist/session-storage.js';
import { decks } from '../dist/data/decks.js';

const deck = { id: 'likes', adultOnly: false, questions: Array.from({ length: 40 }, (_, i) => ({ id: `q-${i}`, text: `Q${i}` })) };

test('summarizeLikes aggregates only questions in range and preserves duplicate names and zeroes', () => {
  const session = createSession({ participants: ['同じ', '同じ', '0人'], deck, random: () => 0.5 });
  session.cursor = 6;
  session.likes = {
    [`${session.questions[0].id}:0`]: 2,
    [`${session.questions[0].id}:1`]: 1,
    [`${session.questions[5].id}:0`]: 3,
    [`${session.questions[6].id}:0`]: 99,
    'unknown:0': 500,
    [`${session.questions[1].id}:1`]: Number.NaN,
    [`${session.questions[2].id}:2`]: 'bad',
  };
  assert.deepEqual(sessionLikeTotals(session, 0, 6), [5, 1, 0]);
  assert.deepEqual(summarizeLikes(session, 0, 6), [
    { index: 0, name: '同じ', likes: 5 },
    { index: 1, name: '同じ', likes: 1 },
    { index: 2, name: '0人', likes: 0 },
  ]);
  assert.deepEqual(sessionLikeTotals(session, 6, 7), [99, 0, 0]);
  session.cursor = 40;
  session.likes[`${session.questions[36].id}:2`] = 4;
  assert.deepEqual(sessionLikeTotals(session, 36, 40), [0, 0, 4]);
});

test('stored totals survive a resumed session and use participant indexes', () => {
  const session = createSession({ participants: ['A', 'B'], deck: decks.find((item) => item.id === 'friends'), random: () => 0.5 });
  session.cursor = 12; session.unlockedUntil = 12;
  session.roundStart = 6; session.roundNumber = 3;
  session.likes = { [`${session.questions[6].id}:1`]: 2, [`${session.questions[7].id}:0`]: 1 };
  const storage = { value: null, setItem(_key, value) { this.value = value; }, getItem() { return this.value; }, removeItem() { this.value = null; } };
  const now = Date.now();
  assert.equal(saveSession(session, { storage, now }), true);
  const resumed = loadSession({ storage, now: now + 1 });
  assert.ok(resumed);
  assert.deepEqual(sessionLikeTotals(resumed, resumed.roundStart, resumed.cursor), [1, 2]);
  assert.deepEqual(sessionLikeTotals(resumed, 0, resumed.cursor), [1, 2]);
});

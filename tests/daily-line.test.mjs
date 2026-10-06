import test from 'node:test';
import assert from 'node:assert/strict';
import { decks } from '../dist/data/decks.js';
import { chooseDailyQuestion, eligibleDailyDeck, createDailyLineService } from '../server-side/daily-line.mjs';

const groupId = '11111111-1111-4111-8111-111111111111';
const friends = decks.find((deck) => deck.id === 'friends');
const date = decks.find((deck) => deck.id === 'date');
const intimacy = decks.find((deck) => deck.id === 'intimacy');

test('daily source eligibility allows safe group question decks only', () => {
  assert.equal(eligibleDailyDeck(friends), true);
  assert.equal(eligibleDailyDeck(date), false);
  assert.equal(eligibleDailyDeck(intimacy), false);
});

test('daily question choice is deterministic and avoids used questions until exhausted', () => {
  const first = chooseDailyQuestion({ deck: friends, groupId, localDate: '2026-10-06' });
  const repeat = chooseDailyQuestion({ deck: friends, groupId, localDate: '2026-10-06' });
  assert.deepEqual(first, repeat);
  const next = chooseDailyQuestion({ deck: friends, groupId, localDate: '2026-10-06', usedQuestionIds: [first.questionId] });
  assert.notEqual(next.questionId, first.questionId);
});

test('daily selection rejects invalid group identifiers and malformed dates', () => {
  assert.throws(() => chooseDailyQuestion({ deck: friends, groupId: 'shared', localDate: '2026-10-06' }), /INVALID_DAILY_DATE/);
  assert.throws(() => chooseDailyQuestion({ deck: friends, groupId, localDate: '2026-1-6' }), /INVALID_DAILY_DATE/);
  assert.throws(() => chooseDailyQuestion({ deck: friends, groupId, localDate: '2026-99-99' }), /INVALID_DAILY_DATE/);
});

test('daily selection completes a full cycle before repeating', () => {
  const cards = friends.questions.filter((card) => card.kind !== 'challenge' && card.kind !== 'action' && card.r18 !== true);
  const history = [];
  const firstCycle = new Set();
  for (let i = 0; i < cards.length; i += 1) {
    const picked = chooseDailyQuestion({ deck: friends, groupId, localDate: '2026-10-07', usedQuestionIds: history });
    firstCycle.add(picked.questionId);
    history.push(picked.questionId);
  }
  assert.equal(firstCycle.size, cards.length);
  const second = chooseDailyQuestion({ deck: friends, groupId, localDate: '2026-10-07', usedQuestionIds: history });
  assert.ok(firstCycle.has(second.questionId));
});

test('dispatch does not push when a concurrent claim is busy', async () => {
  let claimCount = 0;
  let pushCount = 0;
  const delivery = { status: 'sending', lease_token: 'lease-1', retry_key: 'retry-1', line_user_id: 'U12345678901234567890', payload: { question: '今日の問い' } };
  const service = createDailyLineService({
    env: {},
    rpcImpl: async (name) => {
      if (name === 'daily_claim_delivery') return claimCount++ === 0 ? delivery : null;
      if (name === 'daily_complete_delivery') return delivery;
      throw new Error(name);
    },
    pushImpl: async () => { pushCount += 1; return { ok: true, requestId: 'req-1' }; }
  });
  const results = await Promise.all([service.dispatch('d-1'), service.dispatch('d-1')]);
  assert.equal(pushCount, 1);
  assert.deepEqual(results.map((item) => item.claimed), [true, false]);
});

test('listReady delegates bounded delivery selection to the service RPC', async () => {
  const calls = [];
  const service = createDailyLineService({
    env: {}, now: () => new Date('2026-10-06T00:00:00Z'),
    rpcImpl: async (name, payload) => { calls.push({ name, payload }); return [{ id: 'd-1' }]; }
  });
  assert.deepEqual(await service.listReady(9999), [{ id: 'd-1' }]);
  assert.equal(calls[0].name, 'daily_list_ready_deliveries');
  assert.equal(calls[0].payload.p_limit, 500);
});

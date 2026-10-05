import test from 'node:test';
import assert from 'node:assert/strict';
import { createSoloSession, createSavedSession, revealCard } from '../dist/engine.js';
import { soloDecks } from '../dist/data/solo-decks.js';
import { decks } from '../dist/data/decks.js';
import { saveSession, loadSession } from '../dist/session-storage.js';
import { sessionNeedsThemeAccess } from '../dist/theme-access.js';

function storage() { let value = null; return { getItem() { return value; }, setItem(_key, next) { value = next; }, removeItem() { value = null; } }; }

test('solo engine creates one participant and fixed twelve-card order', () => {
  const session = createSoloSession({ deck: soloDecks[0] });
  assert.equal(session.mode, 'solo'); assert.deepEqual(session.participants, ['自分']); assert.equal(session.questionOrder, 'fixed');
  assert.deepEqual(session.questions.map((card) => card.id), soloDecks[0].questions.map((card) => card.id));
  assert.throws(() => createSoloSession({ deck: { ...soloDecks[0], audience: 'group' } }), /ソロテーマ/);
});

test('saved set keeps explicit fixed order and solo sessions round-trip through storage', () => {
  const fixed = createSavedSession({ participants: ['A', 'B'], cardIds: soloDecks[0].questions.slice(0, 6).map((card) => card.id), questionOrder: 'fixed' });
  assert.deepEqual(fixed.questions.map((card) => card.id), soloDecks[0].questions.slice(0, 6).map((card) => card.id));
  const storageTarget = storage(); const solo = createSoloSession({ deck: soloDecks[1] });
  assert.equal(saveSession(solo, { storage: storageTarget, now: 1000 }), true);
  const loaded = loadSession({ storage: storageTarget, now: 1001 });
  assert.equal(loaded.mode, 'solo'); assert.deepEqual(loaded.questions.map((card) => card.id), solo.questions.map((card) => card.id));
});

test('solo saved sets preserve 6, 24, and 40 public cards with owner, set, and order', () => {
  const owner = '11111111-1111-4111-8111-111111111111';
  for (const count of [6, 24, 40]) {
    const source = decks.find((deck) => !deck.adultOnly && deck.questions.length === 40);
    const ids = source.questions.slice(0, count).map((card) => card.id);
    const session = createSavedSession({ mode: 'solo', cardIds: ids, setId: '22222222-2222-4222-8222-222222222222', setName: `Solo ${count}`, ownerUserId: owner, questionOrder: count === 24 ? 'shuffle' : 'fixed' });
    const target = storage(); assert.equal(saveSession(session, { storage: target, now: 1000 }), true);
    const loaded = loadSession({ storage: target, now: 1001 });
    assert.equal(loaded.mode, 'solo'); assert.equal(loaded.ownerUserId, owner); assert.equal(loaded.setId, '22222222-2222-4222-8222-222222222222'); assert.equal(loaded.questions.length, count); assert.equal(loaded.questionOrder, session.questionOrder);
  }
});

test('official solo storage rejects altered catalog, mode, and order', () => {
  const target = storage(); const session = createSoloSession({ deck: soloDecks[0] }); assert.equal(saveSession(session, { storage: target, now: 1000 }), true);
  const mutate = (changes) => { const record = JSON.parse(target.getItem('mingle.cards.session.v1')); target.setItem('mingle.cards.session.v1', JSON.stringify({ ...record, ...changes })); assert.equal(loadSession({ storage: target, now: 1001 }), null); };
  mutate({ questionOrder: 'shuffle' }); assert.equal(saveSession(session, { storage: target, now: 1000 }), true); mutate({ mode: 'mystery' }); assert.equal(saveSession(session, { storage: target, now: 1000 }), true); mutate({ questionIds: [session.questions[1].id, ...session.questions.slice(1).map((card) => card.id)] });
});

test('guest can view only the first official solo round and must register to continue', () => {
  const guest = { enabled: true, authReady: true, user: null };
  const session = createSoloSession({ deck: soloDecks[0] });
  assert.equal(sessionNeedsThemeAccess({ ...session, cursor: 0, unlockedUntil: 6 }, guest), false);
  assert.equal(sessionNeedsThemeAccess({ ...session, cursor: 6, unlockedUntil: 6 }, guest), false);
  assert.equal(sessionNeedsThemeAccess({ ...session, cursor: 6, unlockedUntil: 12 }, guest), true);
  assert.equal(sessionNeedsThemeAccess({ ...session, cursor: 0, unlockedUntil: 6, customSet: true, ownerUserId: '11111111-1111-4111-8111-111111111111' }, guest), true);
});

test('solo saved sessions require a valid owner and group still requires two people', () => {
  assert.throws(() => createSavedSession({ mode: 'solo', cardIds: soloDecks[0].questions.slice(0, 6).map((card) => card.id), setId: 'set', ownerUserId: null }), /所有者/);
  assert.throws(() => createSavedSession({ mode: 'group', participants: ['ひとり'], cardIds: soloDecks[0].questions.slice(0, 6).map((card) => card.id) }), /2〜8/);
});

test('solo review records revealed custom cards but never future cards', () => {
  const owner = '11111111-1111-4111-8111-111111111111'; const setId = '22222222-2222-4222-8222-222222222222';
  const customCards = Array.from({ length: 6 }, (_, index) => ({ id: `custom:33333333-3333-4333-8333-${String(index + 1).padStart(12, '0')}`, text: `自作質問${index + 1}`, r18: false }));
  const session = createSavedSession({ mode: 'solo', cardIds: customCards.map((card) => card.id), customCards, setId, ownerUserId: owner, questionOrder: 'fixed' });
  const revealed = revealCard(session); revealed.cursor = 1; revealed.roundCount = 1;
  assert.deepEqual(revealed.revealedQuestionIds, [session.questions[0].id]);
  const target = storage(); assert.equal(saveSession(revealed, { storage: target, now: 1000 }), true);
  const loaded = loadSession({ storage: target, now: 1001 });
  assert.deepEqual(loaded.revealedQuestionIds, [session.questions[0].id]); assert.equal(loaded.ownerUserId, owner); assert.equal(loaded.setId, setId);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { decks } from '../dist/data/decks.js';
import { createSavedSession, revealCard, nextAnswer, likeCurrentAnswer, continueRound } from '../dist/engine.js';
import { loadSession, saveSession, SESSION_STORAGE_KEY } from '../dist/session-storage.js';

const storage = () => { const data = new Map(); return { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: (key) => data.delete(key) }; };
const date = decks.find((deck) => deck.id === 'date');
const ids = date.questions.slice(0, 13).map((card) => card.id);
const allIds = date.questions.map((card) => card.id);

test('createSavedSession canonicalizes six-to-forty IDs and excludes raw account data', () => {
  const session = createSavedSession({ participants: ['A', 'B'], cardIds: ids.slice(0, 6), random: () => 0 });
  assert.equal(session.customSet, true); assert.equal(session.deckId, 'my-set'); assert.deepEqual(session.deckIds, ['my-set']);
  assert.equal(session.mixed, false); assert.equal(session.includeChallenges, false); assert.equal(session.questions.length, 6);
  assert.ok(session.questions.every((card) => card.sourceDeckId === 'date'));
  assert.equal(Object.hasOwn(session.questions[0], 'text'), true);
  assert.equal(JSON.stringify(session).includes('account'), false);
  assert.throws(() => createSavedSession({ participants: ['A', 'B'], cardIds: ['nope', ...ids.slice(0, 5)] }), /不正/);
  assert.throws(() => createSavedSession({ participants: ['A', 'B'], cardIds: [...ids.slice(0, 6), ids[0]] }), /不正/);
});

test('saved session supports short final rounds, all answers, likes, and resume', () => {
  const session = createSavedSession({ participants: ['A', 'B'], cardIds: ids, random: () => 0.5 });
  session.revealed = true; session.answerIndex = 0; session.likes = {};
  session.likes = likeCurrentAnswer(session).likes;
  while (session.cursor < session.unlockedUntil) { session.revealed = true; session.answerIndex = 1; Object.assign(session, nextAnswer(session)); }
  assert.equal(session.cursor, 6); assert.equal(session.unlockedUntil, 6);
  session.unlockedUntil = 12; session.roundStart = 6; session.roundNumber = 2;
  session.cursor = 7; session.roundCount = 1; session.revealed = false; session.answerIndex = 0; session.feedbackSubmitted = [6, 7, 99];
  const target = storage(); assert.equal(saveSession(session, { storage: target, now: 1000 }), true);
  const restored = loadSession({ storage: target, now: 1001 });
  assert.equal(restored.customSet, true); assert.equal(restored.cursor, 7); assert.deepEqual(restored.feedbackSubmitted, [6, 7]);
  assert.equal(Object.hasOwn(JSON.parse(target.getItem(SESSION_STORAGE_KEY)), 'questions'), false, 'saved record does not expose question text');
});

test('hydration preserves legacy records without customSet and rejects tampered custom R18 source', () => {
  const base = createSavedSession({ participants: ['A', 'B'], cardIds: ids.slice(0, 6) });
  const target = storage(); saveSession(base, { storage: target, now: 1000 });
  const raw = JSON.parse(target.getItem(SESSION_STORAGE_KEY)); delete raw.customSet; raw.deckId = 'date'; raw.deckIds = ['date']; raw.mixed = false; raw.questionSources = raw.questionIds.map(() => 'date'); raw.questionIds = date.questions.slice(0, 40).map((card) => card.id); raw.questionSources = raw.questionIds.map(() => 'date'); raw.unlockedUntil = 6; raw.cursor = 0; raw.roundStart = 0; raw.roundCount = 0; raw.roundNumber = 1; target.setItem(SESSION_STORAGE_KEY, JSON.stringify(raw));
  assert.ok(loadSession({ storage: target, now: 1001 }));
  const custom = JSON.parse(target.getItem(SESSION_STORAGE_KEY)); custom.customSet = true; custom.deckId = 'my-set'; custom.deckIds = ['my-set']; custom.questionSources = custom.questionIds.map(() => 'not-a-deck'); target.setItem(SESSION_STORAGE_KEY, JSON.stringify(custom));
  assert.equal(loadSession({ storage: target, now: 1002 }), null);
});

test('R18 custom sets require adult consent and hydrated R18 metadata remains protected', () => {
  const r18 = date.r18Questions[0].id;
  assert.throws(() => createSavedSession({ participants: ['A', 'B'], cardIds: [r18, ...ids.slice(0, 5)] }), /成人/);
  const session = createSavedSession({ participants: ['A', 'B'], cardIds: [r18, ...ids.slice(0, 5)], adultConfirmed: true });
  assert.equal(session.includeR18, true); assert.equal(session.questions.find((card) => card.id === r18).r18, true);
});

test('custom sets finish correctly at every supported length and resume at round boundaries', () => {
  for (const length of [6, 7, 13, 40]) {
    const session = createSavedSession({ participants: ['A', 'B'], cardIds: allIds.slice(0, length), random: () => 0 });
    let current = session; const target = storage();
    while (current.cursor < current.questions.length) {
      while (current.cursor < current.unlockedUntil) {
        current = revealCard(current); current = nextAnswer(current); current = revealCard(current); current = nextAnswer(current);
      }
      if (current.cursor < current.questions.length) {
        current = continueRound(current); assert.ok(current.unlockedUntil > current.cursor);
        assert.equal(saveSession(current, { storage: target, now: 1000 + current.cursor }), true);
        const resumed = loadSession({ storage: target, now: 1001 + current.cursor }); assert.equal(resumed.cursor, current.cursor); current = resumed;
      }
    }
    assert.equal(current.cursor, length);
    assert.equal(saveSession(current, { storage: target, now: 2000 }), false);
    assert.equal(loadSession({ storage: target, now: 2001 }), null);
  }
});

test('custom R18 persisted flags cannot be downgraded during hydration', () => {
  const r18 = date.r18Questions[0].id;
  const target = storage(); const session = createSavedSession({ participants: ['A', 'B'], cardIds: [r18, ...ids.slice(0, 5)], adultConfirmed: true });
  saveSession(session, { storage: target, now: 1000 }); const raw = JSON.parse(target.getItem(SESSION_STORAGE_KEY)); raw.includeR18 = false; raw.adultConfirmed = false; target.setItem(SESSION_STORAGE_KEY, JSON.stringify(raw));
  assert.equal(loadSession({ storage: target, now: 1001 }), null);
});


test('custom cards mix with favorites, preserve owner snapshot, and keep text out of analytics-shaped records', () => {
  const customId = 'custom:11111111-1111-4111-8111-111111111111';
  const customCards = [{ id: customId, text: '<b>自作</b>😀', r18: false }];
  const session = createSavedSession({ participants: ['A', 'B'], cardIds: [customId, ...ids.slice(0, 5)], customCards, ownerUserId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', random: () => 0 });
  assert.equal(session.ownerUserId, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  assert.throws(() => createSavedSession({ participants: ['A', 'B'], cardIds: [customId, ...ids.slice(0, 5)], customCards, random: () => 0 }), /所有者/);
  assert.equal(session.questions.find((card) => card.id === customId).text, '<b>自作</b>😀');
  assert.equal(session.questions.find((card) => card.id === customId).sourceDeckId, 'custom');
  const target = storage(); assert.equal(saveSession(session, { storage: target, now: 1000 }), true);
  const raw = JSON.parse(target.getItem(SESSION_STORAGE_KEY));
  assert.equal(raw.customQuestions[0].text, '<b>自作</b>😀'); assert.equal(raw.questions, undefined); assert.equal(raw.ownerUserId, session.ownerUserId);
  const restored = loadSession({ storage: target, now: 1001 });
  assert.equal(restored.questions.find((card) => card.id === customId).text, '<b>自作</b>😀');
  assert.throws(() => createSavedSession({ participants: ['A', 'B'], cardIds: [customId, ...ids.slice(0, 5)], customCards: [{ id: customId, text: 'x'.repeat(301), r18: false }], ownerUserId: session.ownerUserId }), /不正/);
  const tampered = JSON.parse(target.getItem(SESSION_STORAGE_KEY)); tampered.customQuestions[0].r18 = true; tampered.adultConfirmed = false; target.setItem(SESSION_STORAGE_KEY, JSON.stringify(tampered)); assert.equal(loadSession({ storage: target, now: 1002 }), null);
});

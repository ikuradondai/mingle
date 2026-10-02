import test from 'node:test';
import assert from 'node:assert/strict';
import { createMixedSession, createSession, continueRound, isFinished, isRoundComplete, nextAnswer, revealCard, likeCurrentAnswer, currentSpeaker } from '../dist/engine.js';
import { loadSession, saveSession, clearSession } from '../dist/session-storage.js';
import { decks } from '../dist/data/decks.js';

const memory = () => ({ value: null, getItem() { return this.value; }, setItem(_key, value) { this.value = value; }, removeItem() { this.value = null; } });
const pick = (id) => decks.find((deck) => deck.id === id);

test('mixed sessions balance full rounds, keep unique source questions, and reject adult decks', () => {
  const value = createMixedSession({ participants: ['A', 'B'], decks: [pick('friends'), pick('team')], random: () => 0.5 });
  assert.equal(value.mixed, true);
  assert.deepEqual(value.deckIds, ['friends', 'team']);
  assert.equal(value.questions.length, 40);
  assert.equal(new Set(value.questions.map((card) => card.id)).size, 40);
  for (let i = 0; i < 6; i += 1) {
    const cards = value.questions.slice(i * 6, i * 6 + 6);
    assert.equal(cards.filter((card) => card.sourceDeckId === 'friends').length, 3);
    assert.equal(cards.filter((card) => card.sourceDeckId === 'team').length, 3);
  }
  const twoTail = value.questions.slice(36);
  assert.equal(twoTail.filter((card) => card.sourceDeckId === 'friends').length, 2);
  assert.equal(twoTail.filter((card) => card.sourceDeckId === 'team').length, 2);
  const three = createMixedSession({ participants: ['A', 'B'], decks: [pick('friends'), pick('team'), pick('founders')], random: () => 0.5 });
  const threeTailCounts = three.questions.slice(36).reduce((counts, card) => ({ ...counts, [card.sourceDeckId]: (counts[card.sourceDeckId] || 0) + 1 }), {});
  assert.deepEqual(Object.values(threeTailCounts).sort((a, b) => b - a), [2, 1, 1]);
  assert.throws(() => createMixedSession({ participants: ['A', 'B'], decks: [pick('friends'), pick('intimacy')] }), /ミックス/);
  assert.throws(() => createMixedSession({ participants: ['A', 'B'], decks: [pick('friends'), pick('team')], includeR18: true }), /R18/);
});

test('mixed touch challenges require every source deck to be eligible', () => {
  const pairEligible = createMixedSession({ participants: ['A', 'B'], decks: [pick('couples'), pick('new-couple')], includeChallenges: true, random: () => 0.5 });
  for (const card of pairEligible.questions.filter((item) => item.touch)) assert.ok(card.eligibleDeckIds.includes('couples') && card.eligibleDeckIds.includes('new-couple'));
  const group = createMixedSession({ participants: ['A', 'B', 'C'], decks: [pick('couples'), pick('new-couple')], includeChallenges: true, random: () => 0.5 });
  assert.equal(group.questions.some((card) => card.touch), false);
  const ineligible = createMixedSession({ participants: ['A', 'B'], decks: [pick('couples'), pick('friends')], includeChallenges: true, random: () => 0.5 });
  assert.equal(ineligible.questions.some((card) => card.touch), false);
});

test('session storage reloads progress, likes, and round boundaries without card text duplication', () => {
  const storage = memory(); let now = 1000;
  let session = createSession({ participants: ['A', 'B'], deck: pick('friends'), random: () => 0.5 });
  session = revealCard(session); session = likeCurrentAnswer(session); session = nextAnswer(session);
  assert.equal(saveSession(session, { storage, now }), true);
  const raw = JSON.parse(storage.value);
  assert.equal(raw.questionIds.length, 40); assert.equal(raw.questions, undefined); assert.equal(raw.expiresAt, now + 86400000);
  const restored = loadSession({ storage, now: () => now + 100 });
  assert.equal(restored.sessionId, session.sessionId); assert.equal(restored.cursor, 0); assert.equal(restored.answerIndex, 1); assert.equal(restored.likes[`${session.questions[0].id}:0`], 1);
  while (restored.cursor < 6) { restored.revealed = true; restored.answerIndex = 1; Object.assign(restored, nextAnswer(restored)); }
  restored.revealed = false; assert.equal(saveSession(restored, { storage, now }), true);
  assert.equal(loadSession({ storage, now }).cursor, 6);
  now += 86400001; assert.equal(loadSession({ storage, now }), null);
});

test('valid single adult, date-R18, and mixed challenge sessions restore', () => {
  for (const session of [
    createSession({ participants: ['A', 'B'], deck: pick('intimacy'), adultConfirmed: true, random: () => 0.5 }),
    createSession({ participants: ['A', 'B'], deck: pick('date'), adultConfirmed: true, includeR18: true, random: () => 0.5 }),
    createMixedSession({ participants: ['A', 'B'], decks: [pick('couples'), pick('new-couple')], includeChallenges: true, random: () => 0.5 }),
  ]) {
    const storage = memory(); assert.equal(saveSession(session, { storage, now: 1000 }), true); assert.ok(loadSession({ storage, now: 1000 }));
  }
});

test('full engine progression survives save/load at every card, gate, and final-four boundary', () => {
  const storage = memory();
  let now = 5000;
  let session = createSession({ participants: ['A', 'B'], deck: pick('friends'), random: () => 0.5 });
  const restore = () => {
    assert.equal(saveSession(session, { storage, now }), true);
    const loaded = loadSession({ storage, now });
    assert.ok(loaded);
    assert.equal(loaded.cursor, session.cursor);
    assert.equal(loaded.unlockedUntil, session.unlockedUntil);
    assert.equal(loaded.roundStart, session.roundStart);
    assert.equal(loaded.revealed, session.revealed);
    assert.equal(loaded.answerIndex, session.answerIndex);
    assert.equal(currentSpeaker(loaded), currentSpeaker(session));
    session = loaded;
    now += 1;
  };
  restore();
  while (!isFinished(session)) {
    session = revealCard(session); restore();
    session = likeCurrentAnswer(session); restore();
    session = nextAnswer(session); restore();
    session = nextAnswer(session);
    if (!isFinished(session)) restore();
    if (isRoundComplete(session)) {
      assert.equal(session.revealed, false);
      const boundary = session.cursor;
      session = continueRound(session); restore();
      assert.equal(session.roundStart, boundary);
      assert.equal(session.unlockedUntil, Math.min(boundary + 6, 40));
    }
  }
  assert.equal(session.cursor, 40);
  assert.equal(storage.value !== null, true); // final state is intentionally not offered for resume until cleared by save.
  clearSession({ storage });
});

test('corrupt, adult-invalid, and unavailable records are discarded safely', () => {
  const storage = memory(); storage.value = '{bad'; assert.equal(loadSession({ storage }), null); assert.equal(storage.value, null);
  const adultStorage = memory(); const adult = createSession({ participants: ['A', 'B'], deck: pick('intimacy'), adultConfirmed: true }); saveSession(adult, { storage: adultStorage }); const record = JSON.parse(adultStorage.value); record.adultConfirmed = false; adultStorage.value = JSON.stringify(record); assert.equal(loadSession({ storage: adultStorage }), null);
  const challengeStorage = memory(); const challenge = createSession({ participants: ['A', 'B'], deck: pick('friends'), includeChallenges: true }); saveSession(challenge, { storage: challengeStorage }); const challengeRecord = JSON.parse(challengeStorage.value); challengeRecord.includeChallenges = false; challengeStorage.value = JSON.stringify(challengeRecord); assert.equal(loadSession({ storage: challengeStorage }), null);
  const mixedOptions = memory(); const mixed = createMixedSession({ participants: ['A', 'B'], decks: [pick('friends'), pick('team')] }); saveSession(mixed, { storage: mixedOptions }); const mixedRecord = JSON.parse(mixedOptions.value); mixedRecord.adultConfirmed = true; mixedOptions.value = JSON.stringify(mixedRecord); assert.equal(loadSession({ storage: mixedOptions }), null);
  const broken = { getItem() { throw new Error('unavailable'); }, setItem() { throw new Error('unavailable'); }, removeItem() {} }; assert.equal(saveSession(null, { storage: broken }), false); assert.equal(loadSession({ storage: broken }), null);
  clearSession({ storage: adultStorage }); assert.equal(adultStorage.value, null);
});

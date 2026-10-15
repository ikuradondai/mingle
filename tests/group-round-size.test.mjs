import test from 'node:test';
import assert from 'node:assert/strict';
import { decks } from '../dist/data/decks.js';
import { soloDecks } from '../dist/data/solo-decks.js';
import { createSession, createMixedSession, createSavedSession, createSoloSession, continueRound, isRoundComplete, nextAnswer, revealCard } from '../dist/engine.js';
import { loadSession, saveSession } from '../dist/session-storage.js';

function answer(session) {
  let next = revealCard(session);
  while (next.revealed) next = nextAnswer(next);
  return next;
}

test('group conversation rounds unlock three cards while solo stays six', () => {
  const group = createSession({ participants: ['A', 'B'], deck: decks.find((deck) => deck.id === 'friends'), random: () => 0.1 });
  assert.equal(group.roundSize, 3);
  assert.equal(group.unlockedUntil, 3);
  let progressed = group;
  for (let i = 0; i < 3; i += 1) progressed = answer(progressed);
  assert.equal(progressed.cursor, 3);
  assert.equal(isRoundComplete(progressed), true);
  assert.equal(continueRound(progressed).unlockedUntil, 6);

  const solo = createSoloSession({ deck: soloDecks[0] });
  assert.equal(solo.roundSize, 6);
  assert.equal(solo.unlockedUntil, 6);
});

test('mixed and custom group sessions use three-card rounds', () => {
  const first = decks.find((deck) => deck.id === 'friends');
  const second = decks.find((deck) => deck.id === 'date');
  const mixed = createMixedSession({ participants: ['A', 'B'], decks: [first, second], random: () => 0.2 });
  assert.equal(mixed.roundSize, 3);
  assert.equal(mixed.unlockedUntil, 3);
  const custom = createSavedSession({ participants: ['A', 'B'], cardIds: first.questions.slice(0, 6).map((card) => card.id), random: () => 0.2 });
  assert.equal(custom.roundSize, 3);
  assert.equal(custom.unlockedUntil, 3);
});

test('old saved records without roundSize remain six-card compatible', () => {
  const storage = { value: null, getItem() { return this.value; }, setItem(_key, value) { this.value = value; }, removeItem() { this.value = null; } };
  const source = { ...createSession({ participants: ['A', 'B'], deck: decks.find((deck) => deck.id === 'friends'), random: () => 0.1 }), roundSize: 6, unlockedUntil: 6 };
  assert.equal(saveSession(source, { storage, now: 1000 }), true);
  const record = JSON.parse(storage.value); delete record.roundSize; storage.value = JSON.stringify(record);
  const restored = loadSession({ storage, now: 1000 });
  assert.equal(restored.roundSize, 6);
  assert.equal(restored.unlockedUntil, 6);
});

test('new group sessions round-trip real engine progress at each three-card boundary through the final remainder', () => {
  const storage = { value: null, getItem() { return this.value; }, setItem(_key, value) { this.value = value; }, removeItem() { this.value = null; } };
  let session = createSession({ participants: ['A', 'B'], deck: decks.find((deck) => deck.id === 'friends'), random: () => 0.1 });
  for (let expectedCursor = 1; expectedCursor <= session.questions.length; expectedCursor += 1) {
    const before = session;
    const progressed = answer(before);
    if (progressed.cursor === before.cursor) {
      assert.equal(isRoundComplete(before), true);
      session = continueRound(before);
      assert.equal(session.unlockedUntil, Math.min(session.questions.length, before.unlockedUntil + 3));
      const continued = answer(session);
      session = continued;
    } else {
      session = progressed;
    }

    assert.equal(session.cursor, expectedCursor);
    const seen = new Set(session.questions.slice(0, session.cursor).map((card) => card.id));
    assert.equal(seen.size, session.cursor, 'answered cards must be unique');
    const saved = { ...session, feedbackSubmitted: session.cursor >= 3 ? [3] : [] };
    const allowCompleted = session.cursor === session.questions.length;
    assert.equal(saveSession(saved, { storage, now: expectedCursor, allowCompleted }), true);
    const restored = loadSession({ storage, now: expectedCursor, allowCompleted });
    assert.ok(restored);
    assert.equal(restored.cursor, session.cursor);
    assert.equal(restored.roundSize, 3);
    assert.equal(restored.unlockedUntil, session.unlockedUntil);
    assert.deepEqual(restored.feedbackSubmitted, saved.feedbackSubmitted);
    session = restored;
  }

  assert.equal(session.cursor, session.questions.length);
  assert.equal(saveSession(session, { storage, now: 999, allowCompleted: true }), true);
  const completed = loadSession({ storage, now: 999, allowCompleted: true });
  assert.equal(completed.cursor, session.questions.length);
  assert.equal(new Set(session.questions.map((card) => card.id)).size, session.questions.length);
});

test('storage rejects malformed group boundaries and solo round-size tampering', () => {
  const storage = { value: null, getItem() { return this.value; }, setItem(_key, value) { this.value = value; }, removeItem() { this.value = null; } };
  const group = createSession({ participants: ['A', 'B'], deck: decks.find((deck) => deck.id === 'friends'), random: () => 0.1 });
  assert.equal(saveSession(group, { storage, now: 1 }), true);
  const malformed = JSON.parse(storage.value);
  malformed.unlockedUntil = 4;
  storage.value = JSON.stringify(malformed);
  assert.equal(loadSession({ storage, now: 1 }), null);

  const solo = createSoloSession({ deck: soloDecks[0] });
  assert.equal(saveSession(solo, { storage, now: 2 }), true);
  const tampered = JSON.parse(storage.value);
  tampered.roundSize = 3;
  storage.value = JSON.stringify(tampered);
  assert.equal(loadSession({ storage, now: 2 }), null);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ANSWER_STYLE_PREDICT,
  ANSWER_STYLE_TOGETHER,
  answerStyleForCard,
  ANSWER_STYLE_CARD_IDS,
  isAnswerStyleEligibleSession,
} from '../dist/answer-style.js';
import { decks } from '../dist/data/decks.js';

const cards = (ids) => ids.map((id) => ({ id, text: id }));
const group = (overrides = {}) => ({
  sessionId: 'session-stable',
  mode: 'group',
  participantRule: 'group',
  deckId: 'friends',
  questions: cards(['friends-08', 'friends-14', 'friends-25', 'friends-38']),
  ...overrides,
});

test('answer style is deterministic and alternates eligible cards', () => {
  const session = group();
  const first = session.questions.map((_, index) => answerStyleForCard(session, index));
  const second = session.questions.map((_, index) => answerStyleForCard(session, index));
  assert.deepEqual(first, second);
  assert.ok(first.some((value) => [ANSWER_STYLE_PREDICT, ANSWER_STYLE_TOGETHER].includes(value)));
  for (let index = 1; index < first.length; index += 1) {
    assert.ok(!(first[index] && first[index - 1]), 'special prompts must not be adjacent');
  }
});

test('style remains stable when the same card is addressed by object or index', () => {
  const session = group();
  assert.equal(answerStyleForCard(session, 1), answerStyleForCard(session, session.questions[1]));
});

test('non ordinary group sessions never receive answer-style variation', () => {
  for (const overrides of [
    { mode: 'solo', participantRule: 'solo' },
    { mixed: true },
    { customSet: true },
    { sharedGuest: true },
    { sponsorSet: true },
    { includeR18: true },
    { deckId: 'intimacy' },
  ]) {
    const session = group(overrides);
    assert.equal(isAnswerStyleEligibleSession(session), false);
    assert.equal(answerStyleForCard(session, 0), null);
  }
});

test('unlisted questions stay ordinary and malformed positions are safe', () => {
  const session = group({ questions: cards(['friends-01', 'friends-08']) });
  assert.equal(answerStyleForCard(session, 0), null);
  assert.equal(answerStyleForCard(session, 99), null);
  assert.equal(answerStyleForCard(session, { id: 'missing' }), null);
});

test('curated together candidates exist in the shipped normal catalog', () => {
  const catalog = new Set(decks.flatMap((deck) => deck.questions.map((card) => card.id)));
  assert.ok(ANSWER_STYLE_CARD_IDS.every((id) => catalog.has(id)));
  assert.equal(answerStyleForCard(group({ questions: [{ id: 'friends-08', kind: 'challenge', text: 'x' }] }), 0), null);
});

test('challenge cards stay ordinary even when the session includes challenges', () => {
  const session = group({ includeChallenges: true, questions: [{ id: 'friends-08', kind: 'challenge', text: 'x' }] });
  assert.equal(answerStyleForCard(session, 0), null);
});

test('including challenges does not disable styles for ordinary cards', () => {
  const ordinary = group({ questions: [{ id: 'friends-08', text: 'x' }] });
  const withChallenges = group({ includeChallenges: true, questions: [{ id: 'friends-08', text: 'x' }] });
  assert.equal(isAnswerStyleEligibleSession(withChallenges), true);
  assert.equal(answerStyleForCard(withChallenges, 0), answerStyleForCard(ordinary, 0));
});

test('questions addressing a counterpart never receive together style', () => {
  const session = group({ questions: [{ id: 'friends-08', text: '相手の答えを予想してみよう' }] });
  assert.notEqual(answerStyleForCard(session, 0), ANSWER_STYLE_TOGETHER);
});

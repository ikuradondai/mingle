import assert from 'node:assert/strict';
import test from 'node:test';
import { decks } from '../dist/data/decks.js';
import { soloDecks } from '../dist/data/solo-decks.js';
import { createMixedSession, createSession, currentParticipantIndex } from '../dist/engine.js';
import { PARTICIPANT_RULES, displayQuestionText, participantRuleForDeck, participantRuleForSavedSet, participantRuleForSession } from '../dist/participant-rule.js';

const pairIds = [
  'date', 'acquaintance-date', 'couples', 'intimacy', 'new-couple', 'moving-in',
  'first-intimacy', 'intimacy-refresh', 'intimacy-distance', 'omiai', 'promotion-rivals',
  'love-rivals', 'arch-enemies', 'hero-and-demon-king', 'assassin-and-target',
  'ex-lovers', 'detective-and-phantom-thief', 'engaged-couple',
];
const allIds = [...decks, ...soloDecks].map((deck) => deck.id);

test('all 56 built-in themes have an explicit participant rule', () => {
  assert.equal(allIds.length, 56);
  assert.deepEqual(Object.keys(PARTICIPANT_RULES).sort(), [...allIds].sort());
  assert.equal(pairIds.filter((id) => PARTICIPANT_RULES[id] === 'pair').length, 18);
  assert.equal(Object.values(PARTICIPANT_RULES).filter((rule) => rule === 'group').length, 22);
  assert.equal(Object.values(PARTICIPANT_RULES).filter((rule) => rule === 'solo').length, 16);
  assert.equal(participantRuleForDeck('future-theme'), 'group');
  assert.equal(participantRuleForDeck({ id: 'future-solo', audience: 'solo' }), 'solo');
});

test('new sessions enforce pair and group participant counts without mutating catalog data', () => {
  const pairDeck = decks.find((deck) => deck.id === 'date');
  const groupDeck = decks.find((deck) => deck.id === 'friends');
  assert.throws(() => createSession({ participants: ['A', 'B', 'C'], deck: pairDeck, participantRule: 'pair' }), /2人専用/);
  const group = createSession({ participants: ['A', 'B', 'C'], deck: groupDeck, participantRule: 'group', random: () => 0.5 });
  assert.equal(group.participantRule, 'group');
  assert.equal(group.participants.length, 3);
  assert.throws(() => createMixedSession({ participants: ['A', 'B', 'C'], decks: [pairDeck, groupDeck], participantRule: 'pair' }), /2人専用/);
  assert.equal(pairDeck.questions.length, 40);
});

test('mixed and saved sessions resolve pair metadata from their source cards', () => {
  assert.equal(participantRuleForSession({ mode: 'group', deckIds: ['friends', 'date'] }), 'pair');
  assert.equal(participantRuleForSession({ mode: 'group', deckIds: ['friends', 'team'] }), 'group');
  assert.equal(participantRuleForSession({ mode: 'group', deckId: 'my-set', questions: [{ sourceDeckId: 'date' }] }), 'pair');
  assert.equal(participantRuleForSession({ mode: 'group', deckId: 'my-set', questions: [{ sourceDeckId: 'custom' }] }), 'group');
  assert.equal(participantRuleForDeck({ sourceDeckId: 'shared', id: 'date-01' }), 'pair');
  assert.equal(participantRuleForDeck({ sourceDeckId: 'shared', id: 'friends-01' }), 'group');
  assert.equal(participantRuleForDeck('__proto__'), 'group');
  assert.equal(participantRuleForDeck({ sourceDeckId: 'shared', id: 'date-01' }), 'pair');
  assert.equal(participantRuleForSession({ mode: 'solo', deckIds: ['date'] }), 'solo');
});

test('saved set rule resolves raw and normalized cards while respecting audience', () => {
  assert.equal(participantRuleForSavedSet({ audience: 'group', card_ids: ['date-01', 'friends-01'] }), 'pair');
  assert.equal(participantRuleForSavedSet({ audience: 'group', cards: [{ id: 'date-01' }] }), 'pair');
  assert.equal(participantRuleForSavedSet({ audience: 'both', card_ids: ['friends-01'] }, 'solo'), 'solo');
  assert.equal(participantRuleForSavedSet({ audience: 'solo', card_ids: ['date-01'] }), 'solo');
});

test('two participants see the other registered name according to current speaker', () => {
  const session = { mode: 'group', participants: ['A', 'B'], cursor: 0, answerIndex: 0, deckIds: ['friends'] };
  const text = '相手に聞いて、相手の話を聞く';
  assert.equal(displayQuestionText(text, { participants: session.participants, participantIndex: currentParticipantIndex(session), rule: participantRuleForSession(session) }), 'Bに聞いて、Bの話を聞く');
  session.answerIndex = 1;
  assert.equal(displayQuestionText(text, { participants: session.participants, participantIndex: currentParticipantIndex(session), rule: participantRuleForSession(session) }), 'Aに聞いて、Aの話を聞く');
  session.cursor = 1;
  session.answerIndex = 0;
  assert.equal(currentParticipantIndex(session), 1);
  assert.equal(displayQuestionText('相手と話す', { participants: session.participants, participantIndex: currentParticipantIndex(session) }), 'Aと話す');
});

test('solo, three-or-more, invalid speakers, and empty names keep the source text', () => {
  const text = '相手に伝える';
  assert.equal(displayQuestionText(text, { participants: ['自分'], participantIndex: 0, rule: 'solo' }), text);
  assert.equal(displayQuestionText(text, { participants: ['A', 'B', 'C'], participantIndex: 0 }), text);
  assert.equal(displayQuestionText(text, { participants: ['A', 'B'], participantIndex: 2 }), text);
  assert.equal(displayQuestionText(text, { participants: ['A', ''], participantIndex: 0 }), text);
});

test('replacement callback keeps special name characters literal and protects compounds', () => {
  const name = '$&<B>&';
  const text = '相手、対戦相手、取引相手、相談相手、理想の相手、相手役、相手方、相手チーム、相手に';
  assert.equal(displayQuestionText(text, { participants: ['A', name], participantIndex: 0 }), `${name}、対戦相手、取引相手、相談相手、理想の相手、相手役、相手方、相手チーム、${name}に`);
});

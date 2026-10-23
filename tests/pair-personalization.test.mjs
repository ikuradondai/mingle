import assert from 'node:assert/strict';
import test from 'node:test';
import { decks } from '../dist/data/decks.js';
import { PAIR_PERSONALIZED_CARDS, PARTICIPANT_RULES, displayQuestionText } from '../dist/participant-rule.js';

const cardText = new Map(decks.flatMap((deck) => deck.questions.map((q) => [q.id, q.text])));
const ids = Object.keys(PAIR_PERSONALIZED_CARDS);
const NAME = 'あかり';
const LEFTOVER = /ここにいる人|となりの人|この中で|ここにいるみんな/u;

test('PAIR_PERSONALIZED_CARDS covers 90 cards whose source equals the current deck text', () => {
  assert.equal(ids.length, 90);
  assert.ok(Object.isFrozen(PAIR_PERSONALIZED_CARDS));
  for (const id of ids) assert.equal(PAIR_PERSONALIZED_CARDS[id].source, cardText.get(id), id);
});

test('every pair render is a short question with the name and no group wording', () => {
  for (const id of ids) {
    const out = PAIR_PERSONALIZED_CARDS[id].render(NAME);
    assert.ok([...out].length <= 40, `${id} too long: ${out}`);
    assert.ok(out.endsWith('？'), `${id} must end with ？: ${out}`);
    assert.ok(out.includes(NAME), `${id} lacks the name: ${out}`);
    assert.ok(!LEFTOVER.test(out), `${id} has group wording: ${out}`);
  }
});

test('2 players: the other player name is used per answerer', () => {
  for (const id of ids) {
    const { source, render } = PAIR_PERSONALIZED_CARDS[id];
    const base = { participants: ['A太', 'B子'], rule: 'group', cardId: id };
    assert.equal(displayQuestionText(source, { ...base, participantIndex: 0 }), render('B子'), id);
    assert.equal(displayQuestionText(source, { ...base, participantIndex: 1 }), render('A太'), id);
  }
});

test('3+ players, missing cardId, unknown cardId, or edited text stay unchanged', () => {
  const id = ids[0];
  const { source } = PAIR_PERSONALIZED_CARDS[id];
  assert.equal(displayQuestionText(source, { participants: ['A', 'B', 'C'], participantIndex: 0, cardId: id }), source);
  assert.equal(displayQuestionText(source, { participants: ['A', 'B'], participantIndex: 0 }), source);
  assert.equal(displayQuestionText(source, { participants: ['A', 'B'], participantIndex: 0, cardId: 'no-such-card' }), source);
  assert.equal(displayQuestionText(source, { participants: ['A', ''], participantIndex: 0, cardId: id }), source);
  const edited = `${source}（編集）`;
  assert.equal(displayQuestionText(edited, { participants: ['A', 'B'], participantIndex: 0, cardId: id }), edited);
});

test('group-rule deck cards no longer say ここにいる人 / となりの人', () => {
  const EXEMPT = new Set(['bar-first-meeting-18']);
  for (const deck of decks) {
    if (PARTICIPANT_RULES[deck.id] !== 'group') continue;
    for (const q of deck.questions) {
      if (EXEMPT.has(q.id)) continue;
      assert.ok(!/ここにいる人|となりの人/u.test(q.text), `${q.id}: ${q.text}`);
    }
  }
});

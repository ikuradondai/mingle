import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ROUND_SIZE, createSession, currentAnswerLikes, currentParticipantIndex, currentSpeaker,
  continueRound, isFinished, isRoundComplete, likeCurrentAnswer, nextAnswer, passAnswer,
  previousAnswer, revealCard, remaining,
} from '../dist/engine.js';
import { decks } from '../dist/data/decks.js';

const deck = { id: 'test', adultOnly: false, questions: Array.from({ length: 40 }, (_, index) => ({ id: `q-${index}`, text: `質問${index}` })) };
const names = ['A', 'B', 'C'];
const session = () => createSession({ participants: names, deck, random: () => 0.5 });

function answerCurrent(value, step = nextAnswer) {
  value = revealCard(value);
  for (let i = 0; i < value.participants.length; i += 1) value = step(value);
  return value;
}

test('contains eight complete, non-repeating decks', () => {
  assert.equal(decks.length, 8);
  for (const item of decks) {
    assert.equal(item.questions.length, 40, item.id);
    assert.equal(new Set(item.questions.map((card) => card.id)).size, 40, item.id);
  }
});

test('keeps one card until every participant answers and rotates the speaker', () => {
  let value = session();
  assert.equal(value.revealed, false);
  assert.equal(currentSpeaker(value), 'A');
  assert.equal(currentParticipantIndex(value), 0);
  value = revealCard(value);
  assert.equal(nextAnswer(value).cursor, 0);
  value = nextAnswer(value);
  assert.equal(value.cursor, 0);
  assert.equal(currentSpeaker(value), 'B');
  value = nextAnswer(value);
  assert.equal(currentSpeaker(value), 'C');
  value = nextAnswer(value);
  assert.equal(value.cursor, 1);
  assert.equal(value.revealed, false);
  assert.equal(currentSpeaker(value), 'B');
});

test('likes are scoped to card and participant, and previousAnswer restores them', () => {
  let value = revealCard(session());
  value = likeCurrentAnswer(value);
  assert.equal(currentAnswerLikes(value), 1);
  value = nextAnswer(value);
  assert.equal(currentAnswerLikes(value), 0);
  value = likeCurrentAnswer(value);
  assert.equal(currentAnswerLikes(value), 1);
  value = previousAnswer(value);
  assert.equal(currentAnswerLikes(value), 1);
  value = nextAnswer(value);
  assert.equal(currentAnswerLikes(value), 1);
  while (value.cursor === 0) value = nextAnswer(value);
  assert.equal(value.revealed, false);
  assert.equal(likeCurrentAnswer(value), value);
});

test('the back side cannot advance or receive likes, and pass advances only the current turn', () => {
  let value = session();
  assert.equal(nextAnswer(value), value);
  assert.equal(passAnswer(value), value);
  assert.equal(likeCurrentAnswer(value), value);
  value = revealCard(value);
  value = passAnswer(value);
  assert.equal(value.cursor, 0);
  assert.equal(value.answerIndex, 1);
  assert.equal(currentSpeaker(value), 'B');
});

test('six-card rounds require continueRound and the final four finish the session', () => {
  let value = session();
  for (let i = 0; i < 6; i += 1) value = answerCurrent(value);
  assert.equal(value.cursor, 6);
  assert.equal(isRoundComplete(value), true);
  assert.equal(value.unlockedUntil, ROUND_SIZE);
  value = continueRound(value);
  assert.equal(value.cursor, 6);
  assert.equal(value.unlockedUntil, 12);
  while (!isFinished(value)) {
    value = answerCurrent(value);
    if (isRoundComplete(value)) value = continueRound(value);
  }
  assert.equal(value.cursor, 40);
  assert.equal(remaining(value), 0);
  assert.equal(isRoundComplete(value), false);
});

test('participant names and adult confirmation are strictly validated', () => {
  assert.throws(() => createSession({ participants: ['A'], deck }), /2〜8人/);
  assert.throws(() => createSession({ participants: Array.from({ length: 9 }, (_, i) => String(i)), deck }), /2〜8人/);
  assert.throws(() => createSession({ participants: [' ', 'B'], deck }), /名前/);
  assert.throws(() => createSession({ participants: ['A'.repeat(25), 'B'], deck }), /24文字/);
  const adult = { ...deck, adultOnly: true };
  assert.throws(() => createSession({ participants: names, deck: adult, adultConfirmed: false }), /成人向け/);
  assert.throws(() => createSession({ participants: names, deck: adult, adultConfirmed: 'true' }), /成人向け/);
  assert.doesNotThrow(() => createSession({ participants: names, deck: adult, adultConfirmed: true }));
});

test('date can stay regular or add exactly one R18 card per six-card set', () => {
  const date = decks.find((item) => item.id === 'date');
  const intimacy = decks.find((item) => item.id === 'intimacy');
  assert.equal(date.questions.length, 40);
  assert.equal(date.questions.every((question) => question.r18 === false), true);
  assert.equal(date.r18Questions.length >= 6, true);
  assert.equal(intimacy.questions.every((question) => question.r18 === true), true);
  assert.throws(() => createSession({ participants: names, deck: date, includeR18: true }), /成人確認/);

  const regular = createSession({ participants: names, deck: date, random: () => 0.5 });
  assert.equal(regular.questions.length, 40);
  assert.equal(regular.questions.some((question) => question.r18), false);

  for (const value of [0, 0.5, 0.999999]) {
    const mixed = createSession({ participants: names, deck: date, adultConfirmed: true, includeR18: true, random: () => value });
    assert.equal(mixed.questions.length, 40);
    assert.equal(new Set(mixed.questions.map((question) => question.id)).size, 40);
    for (let round = 0; round < 6; round += 1) {
      const cards = mixed.questions.slice(round * 6, round * 6 + 6);
      assert.equal(cards.filter((question) => question.r18).length, 1);
      assert.equal(cards.findIndex((question) => question.r18) >= 3, true);
    }
    assert.equal(mixed.questions.slice(36).some((question) => question.r18), false);
  }
});

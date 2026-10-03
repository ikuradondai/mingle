import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ROUND_SIZE, createSession, currentAnswerLikes, currentCard, currentParticipantIndex, currentSpeaker,
  continueRound, isFinished, isRoundComplete, likeCurrentAnswer, nextAnswer, passAnswer,
  previousAnswer, revealCard, remaining,
} from '../dist/engine.js';
import { decks } from '../dist/data/decks.js';
import { challenges } from '../dist/data/challenges.js';

const deck = { id: 'test', adultOnly: false, questions: Array.from({ length: 40 }, (_, index) => ({ id: `q-${index}`, text: `質問${index}` })) };
const names = ['A', 'B', 'C'];
const session = () => createSession({ participants: names, deck, random: () => 0.5 });

function answerCurrent(value, step = nextAnswer) {
  value = revealCard(value);
  for (let i = 0; i < value.participants.length; i += 1) value = step(value);
  return value;
}

test('contains complete decks with unique question ids', () => {
  assert.equal(decks.length, 28);
  assert.equal(new Set(decks.flatMap((item) => item.questions.map((question) => question.id))).size, 1120);
  for (const item of decks) {
    assert.equal(item.questions.length, 40, item.id);
    assert.equal(new Set(item.questions.map((card) => card.id)).size, 40, item.id);
  }
  for (const item of decks.filter((deck) => deck.adultOnly)) {
    assert.equal(item.questions.every((question) => question.r18 === true), true, item.id);
  }
  assert.equal(new Set(challenges.map((card) => card.id)).size, 29);
  assert.equal(new Set([...decks.flatMap((item) => item.questions.map((question) => question.id)), ...challenges.map((card) => card.id)]).size, 1149);
});

test('acquaintance date keeps independent 40-card and R18 sources', () => {
  const acquaintance = decks.find((item) => item.id === 'acquaintance-date');
  assert.ok(acquaintance);
  assert.equal(acquaintance.questions.length, 40);
  assert.equal(acquaintance.questions.every((question) => question.r18 === false), true);
  assert.equal(acquaintance.r18Questions.length, 8);
  assert.equal(new Set([...acquaintance.questions, ...acquaintance.r18Questions].map((question) => question.id)).size, 48);
  assert.equal(acquaintance.r18Questions.every((question) => question.id.startsWith('acquaintance-date-r18-') && question.r18 === true), true);
  assert.equal(acquaintance.questions.some((question) => question.touch), false);
});

test('first-meeting themes include the shared name preference question once', () => {
  const ids = ['date', 'omiai', 'party-first-meeting', 'business-meetup', 'bar-first-meeting'];
  for (const id of ids) {
    const deck = decks.find((item) => item.id === id);
    assert.ok(deck, id);
    assert.equal(deck.questions.length, 40, id);
    assert.equal(deck.questions.filter((question) => question.text === 'これから、なんて呼んで欲しい？').length, 1, id);
  }
});

test('omiai is a regular non-touch theme and keeps concrete R18 refinements out of date', () => {
  const omiai = decks.find((item) => item.id === 'omiai');
  const date = decks.find((item) => item.id === 'date');
  assert.ok(omiai);
  assert.equal(omiai.adultOnly, false);
  assert.equal(omiai.r18Available, undefined);
  assert.equal(omiai.questions.every((question) => question.r18 === false), true);
  assert.equal(omiai.questions.some((question) => question.touch), false);
  assert.deepEqual(date.r18Questions.map((question) => question.id), ['intimacy-04', 'intimacy-07', 'intimacy-11', 'intimacy-17', 'intimacy-24', 'intimacy-27', 'intimacy-29', 'intimacy-37']);
  assert.equal(date.r18Questions.some((question) => ['intimacy-02', 'intimacy-06', 'intimacy-18', 'intimacy-20', 'intimacy-30', 'intimacy-31'].includes(question.id)), false);
  const intimacy = decks.find((item) => item.id === 'intimacy');
  assert.equal(new Set(intimacy.questions.map((question) => question.text)).size, 40);
});

test('touch challenges are restricted to eligible two-person partner decks', () => {
  const eligible = new Set(['couples', 'new-couple', 'moving-in', 'first-intimacy', 'intimacy-refresh', 'intimacy-distance']);
  const touch = challenges.filter((card) => card.touch === true);
  assert.equal(touch.length, 9);
  for (const item of decks) {
    const pair = createSession({ participants: ['A', 'B'], deck: item, adultConfirmed: item.adultOnly, includeChallenges: true, random: () => 0.5 });
    const group = createSession({ participants: ['A', 'B', 'C'], deck: item, adultConfirmed: item.adultOnly, includeChallenges: true, random: () => 0.5 });
    assert.equal(group.questions.some((card) => card.touch), false, item.id);
    if (!eligible.has(item.id)) assert.equal(pair.questions.some((card) => card.touch), false, item.id);
  }
  const pairTouchDecks = decks.filter((item) => eligible.has(item.id));
  assert.equal(pairTouchDecks.length, 6);
  for (const item of pairTouchDecks) {
    const seen = new Set();
    for (let seed = 0; seed < 32; seed += 1) {
      const value = createSession({ participants: ['A', 'B'], deck: item, adultConfirmed: item.adultOnly, includeChallenges: true, random: () => (seed + 0.25) / 32 });
      value.questions.filter((card) => card.touch).forEach((card) => seen.add(card.id));
    }
    assert.equal(seen.size > 0, true, item.id);
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
  assert.doesNotThrow(() => createSession({ participants: ['A'.repeat(40), 'B'], deck }));
  assert.doesNotThrow(() => createSession({ participants: ['😀'.repeat(40), 'B'], deck }));
  assert.throws(() => createSession({ participants: ['A'.repeat(41), 'B'], deck }), /40文字/);
  const adult = { ...deck, adultOnly: true };
  assert.throws(() => createSession({ participants: names, deck: adult, adultConfirmed: false }), /成人向け/);
  assert.throws(() => createSession({ participants: names, deck: adult, adultConfirmed: 'true' }), /成人向け/);
  assert.doesNotThrow(() => createSession({ participants: names, deck: adult, adultConfirmed: true }));
});

test('new adult decks require explicit confirmation', () => {
  for (const deck of decks.filter((item) => item.adultOnly)) {
    assert.throws(() => createSession({ participants: names, deck, adultConfirmed: false }), /成人向け/, deck.id);
    assert.doesNotThrow(() => createSession({ participants: names, deck, adultConfirmed: true }), deck.id);
  }
});

test('challenge mode keeps forty cards with six unique actions and no final-round action', () => {
  for (const deck of decks) {
    const value = createSession({ participants: names, deck, adultConfirmed: deck.adultOnly, includeChallenges: true, random: () => 0.5 });
    assert.equal(value.questions.length, 40, deck.id);
    assert.equal(new Set(value.questions.map((card) => card.id)).size, 40, deck.id);
    assert.equal(value.questions.filter((card) => card.kind === 'challenge').length, 6, deck.id);
    assert.equal(new Set(value.questions.filter((card) => card.kind === 'challenge').map((card) => card.id)).size, 6, deck.id);
    for (let round = 0; round < 6; round += 1) assert.equal(value.questions.slice(round * 6, round * 6 + 6).filter((card) => card.kind === 'challenge').length, 1, `${deck.id}-round-${round}`);
    assert.equal(value.questions.slice(36).some((card) => card.kind === 'challenge'), false, deck.id);
  }
});

test('date R18 and challenges share each six-card round without displacing R18', () => {
  const date = decks.find((item) => item.id === 'date');
  for (const random of [0, 0.5, 0.999999]) {
    const value = createSession({ participants: names, deck: date, adultConfirmed: true, includeR18: true, includeChallenges: true, random: () => random });
    for (let round = 0; round < 6; round += 1) {
      const cards = value.questions.slice(round * 6, round * 6 + 6);
      assert.equal(cards.filter((card) => card.r18).length, 1);
      assert.equal(cards.filter((card) => card.r18)[0] && cards.findIndex((card) => card.r18) >= 3, true);
      assert.equal(cards.filter((card) => card.kind === 'challenge').length, 1);
    }
    assert.equal(new Set(value.questions.map((card) => card.id)).size, 40);
    assert.equal(value.questions.slice(36).some((card) => card.r18 || card.kind === 'challenge'), false);
  }
});

test('challenge card follows the normal answer, like, and pass flow', () => {
  const value = createSession({ participants: names, deck, includeChallenges: true, random: () => 0.5 });
  const actionIndex = value.questions.findIndex((card) => card.kind === 'challenge');
  let actionSession = { ...value, cursor: actionIndex, revealed: false, answerIndex: 0 };
  actionSession = revealCard(actionSession);
  assert.equal(currentCard(actionSession).kind, 'challenge');
  actionSession = likeCurrentAnswer(actionSession);
  assert.equal(currentAnswerLikes(actionSession), 1);
  actionSession = passAnswer(actionSession);
  assert.equal(actionSession.answerIndex, 1);
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

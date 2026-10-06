import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ROUND_SIZE, createSession, createMixedSession, isTogetherCard, currentAnswerLikes, currentCard, currentParticipantIndex, currentSpeaker,
  continueRound, isFinished, isRoundComplete, likeCurrentAnswer, nextAnswer, passAnswer,
  previousAnswer, revealCard, remaining, sessionLikeTotals,
} from '../dist/engine.js';
import { decks } from '../dist/data/decks.js';
import { challenges, commonChallenges, themeChallenges, challengePoolFor, DECK_TOUCH_POLICY } from '../dist/data/challenges.js';
import { themeGroups } from '../dist/data/theme-groups.js';
import { participantRuleForDeck } from '../dist/participant-rule.js';

const deck = { id: 'test', adultOnly: false, questions: Array.from({ length: 40 }, (_, index) => ({ id: `q-${index}`, text: `質問${index}` })) };
const names = ['A', 'B', 'C'];
function seeded(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const deckById = (id) => decks.find((item) => item.id === id);
const challengeCards = (value) => value.questions.filter((card) => card.kind === 'challenge');
const ADULT_DECK_IDS = ['intimacy', 'first-intimacy', 'intimacy-refresh', 'intimacy-distance'];
const session = () => createSession({ participants: names, deck, random: () => 0.5 });

function answerCurrent(value, step = nextAnswer) {
  value = revealCard(value);
  for (let i = 0; i < value.participants.length; i += 1) value = step(value);
  return value;
}

test('contains complete decks with unique question ids', () => {
  assert.equal(decks.length, 40);
  assert.equal(new Set(decks.flatMap((item) => item.questions.map((question) => question.id))).size, 1600);
  for (const item of decks) {
    assert.equal(item.questions.length, 40, item.id);
    assert.equal(new Set(item.questions.map((card) => card.id)).size, 40, item.id);
  }
  for (const item of decks.filter((deck) => deck.adultOnly)) {
    assert.equal(item.questions.every((question) => question.r18 === true), true, item.id);
  }
  assert.equal(new Set(challenges.map((card) => card.id)).size, challenges.length);
  assert.equal(new Set([...decks.flatMap((item) => item.questions.map((question) => question.id)), ...challenges.map((card) => card.id)]).size, 1600 + challenges.length);
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
  const ids = decks.filter((item) => themeGroups[item.id]?.includes('first-meeting')).map((item) => item.id);
  assert.equal(ids.length, 8);
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

test('touch challenges follow DECK_TOUCH_POLICY and the participant count', () => {
  assert.equal(commonChallenges.filter((card) => card.touch >= 1).length, 9);
  for (const item of decks) {
    const limit = DECK_TOUCH_POLICY[item.id];
    assert.equal(Number.isInteger(limit), true, item.id);
    const seenTouch = new Set();
    for (let seed = 0; seed < 24; seed += 1) {
      for (const count of [2, 3]) {
        const people = ['A', 'B', 'C'].slice(0, count);
        const value = createSession({ participants: people, deck: item, adultConfirmed: item.adultOnly, includeChallenges: true, random: seeded(seed + 1) });
        for (const card of challengeCards(value)) {
          seenTouch.add(card.touch);
          assert.equal(card.touch <= limit, true, `${item.id} ${card.id}`);
          if (card.touch >= 2) assert.equal(count, 2, `${item.id} ${card.id}`);
          if (card.touch === 1 && count >= 3 && participantRuleForDeck(item.id) === 'group') assert.match(card.text, /エアでもOK/, `${item.id} ${card.id}`);
        }
      }
    }
    if (limit === 0) assert.deepEqual([...seenTouch].filter((level) => level > 0), [], item.id);
  }
  for (const id of ['couples', 'engaged-couple', 'intimacy']) {
    const seen = new Set();
    for (let seed = 0; seed < 48; seed += 1) {
      const value = createSession({ participants: ['A', 'B'], deck: deckById(id), adultConfirmed: ADULT_DECK_IDS.includes(id), includeChallenges: true, random: seeded(seed + 100) });
      challengeCards(value).filter((card) => card.touch >= 2).forEach((card) => seen.add(card.id));
    }
    assert.equal(seen.size > 0, true, id);
  }
});

test('single-theme challenges are four themed cards plus common cards, and never other themes', () => {
  for (const item of decks) {
    const themedAvailable = challengePoolFor({ deckIds: [item.id], participantCount: 2, includeR18: item.adultOnly }).filter((card) => card.deckIds).length;
    assert.ok(themedAvailable >= 4, `${item.id} has only ${themedAvailable} usable themed challenges`);
    for (let seed = 0; seed < 8; seed += 1) {
      const value = createSession({ participants: ['A', 'B'], deck: item, adultConfirmed: item.adultOnly, includeChallenges: true, random: seeded(seed + 7) });
      const cards = challengeCards(value);
      assert.equal(cards.length, 6, item.id);
      const themed = cards.filter((card) => card.deckIds);
      assert.equal(themed.every((card) => card.deckIds.length === 1 && card.deckIds[0] === item.id), true, item.id);
      assert.equal(themed.length, 4, item.id);
    }
  }
});

test('mixed-theme challenges use only selected themes and common cards within the lowest touch limit', () => {
  const combos = [['couples', 'friends'], ['friends', 'team', 'siblings'], ['couples', 'new-couple'], ['date', 'friends'], ['couples', 'neighbors', 'friends']];
  for (const ids of combos) {
    const mixDecks = ids.map(deckById);
    const limit = Math.min(...ids.map((id) => DECK_TOUCH_POLICY[id]));
    for (let seed = 0; seed < 16; seed += 1) {
      for (const count of [2, 3]) {
        const people = ['A', 'B', 'C'].slice(0, count);
        const value = createMixedSession({ participants: people, decks: mixDecks, includeChallenges: true, random: seeded(seed + 31) });
        const cards = challengeCards(value);
        assert.equal(cards.length, 6, ids.join('+'));
        assert.equal(new Set(cards.map((card) => card.id)).size, 6, ids.join('+'));
        for (const card of cards) {
          if (card.deckIds) assert.equal(ids.includes(card.deckIds[0]), true, `${ids.join('+')} ${card.id}`);
          assert.equal(card.touch <= limit, true, `${ids.join('+')} ${card.id}`);
          assert.equal(card.r18, false);
        }
        const perDeck = ids.map((id) => cards.filter((card) => card.deckIds?.[0] === id).length);
        assert.equal(Math.max(...perDeck) - Math.min(...perDeck) <= 1 || perDeck.some((n) => n === 0), true, ids.join('+'));
      }
    }
  }
});

test('R18 challenges appear only for adult-only decks with adult confirmation', () => {
  const r18Cards = challenges.filter((card) => card.r18);
  assert.equal(r18Cards.every((card) => card.deckIds?.length === 1 && ADULT_DECK_IDS.includes(card.deckIds[0])), true);
  for (const item of decks) {
    for (let seed = 0; seed < 12; seed += 1) {
      const value = createSession({ participants: ['A', 'B'], deck: item, adultConfirmed: item.adultOnly, includeChallenges: true, random: seeded(seed + 55) });
      for (const card of challengeCards(value).filter((entry) => entry.r18)) assert.equal(ADULT_DECK_IDS.includes(item.id), true, `${item.id} ${card.id}`);
    }
  }
  const date = deckById('date');
  for (let seed = 0; seed < 12; seed += 1) {
    const value = createSession({ participants: ['A', 'B'], deck: date, adultConfirmed: true, includeR18: true, includeChallenges: true, random: seeded(seed + 9) });
    assert.equal(challengeCards(value).some((card) => card.r18 || card.touch > 0), false);
  }
  assert.equal(challengePoolFor({ deckIds: ['intimacy'], participantCount: 2, includeR18: false }).some((card) => card.r18), false);
});

test('remote challenges never appear in in-person sessions; players rules follow the participant count', () => {
  for (const item of decks) {
    for (const count of [2, 3, 5]) {
      const people = ['A', 'B', 'C', 'D', 'E'].slice(0, count);
      for (let seed = 0; seed < 6; seed += 1) {
        const value = createSession({ participants: people, deck: item, adultConfirmed: item.adultOnly, includeChallenges: true, random: seeded(seed + 77) });
        for (const card of challengeCards(value)) {
          assert.notEqual(card.place, 'remote', `${item.id} ${card.id}`);
          if (card.players === 'pair') assert.equal(count, 2, `${item.id} ${card.id}`);
          if (card.players === 'group') assert.equal(count >= 3, true, `${item.id} ${card.id}`);
        }
      }
    }
  }
  const pool = challengePoolFor({ deckIds: ['friends'], participantCount: 2 });
  assert.equal(pool.some((card) => card.players === 'group'), false);
  assert.equal(challengePoolFor({ deckIds: ['friends'], participantCount: 3 }).some((card) => card.players === 'pair'), false);
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
  const actionIndex = value.questions.findIndex((card) => card.kind === 'challenge' && card.perform !== 'together');
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

test('together challenge is performed once by everyone and its like is pinned to participant 0', () => {
  const together = challenges.find((card) => card.perform === 'together' && card.players === 'any');
  assert.ok(together);
  assert.equal(isTogetherCard(together), true);
  assert.equal(isTogetherCard({ kind: 'question', perform: 'together' }), false);
  const base = createSession({ participants: names, deck, random: () => 0.5 });
  const at = 4; // cursor % participants !== 0
  assert.notEqual(at % names.length, 0);
  const place = (card) => base.questions.map((item, index) => (index === at ? { ...card, sourceDeckId: 'test' } : item));
  let value = revealCard({ ...base, questions: place(together), cursor: at, unlockedUntil: 6, roundStart: 0, roundCount: at, roundNumber: 1 });
  assert.notEqual(currentParticipantIndex(value), 0);
  value = likeCurrentAnswer(value);
  assert.deepEqual(value.likes, { [`${together.id}:0`]: 1 });
  assert.equal(currentAnswerLikes(value), 1);
  assert.deepEqual(sessionLikeTotals(value, 0, 6), [0, 0, 0]);
  assert.equal(previousAnswer(value), value);
  const advanced = nextAnswer(value);
  assert.equal(advanced.cursor, at + 1);
  assert.equal(advanced.answerIndex, 0);
  assert.equal(advanced.revealed, false);
  const passed = passAnswer(value);
  assert.equal(passed.cursor, at + 1);
  assert.equal(passed.answerIndex, 0);
  // each challenges and questions still move through every participant and credit the speaker
  const each = challenges.find((card) => card.perform === 'each');
  let eachSession = revealCard({ ...base, questions: place(each), cursor: at, unlockedUntil: 6, roundStart: 0, roundCount: at, roundNumber: 1 });
  eachSession = nextAnswer(eachSession);
  assert.equal(eachSession.cursor, at);
  assert.equal(eachSession.answerIndex, 1);
  eachSession = likeCurrentAnswer(eachSession);
  assert.equal(eachSession.likes[`${each.id}:${currentParticipantIndex(eachSession)}`], 1);
});

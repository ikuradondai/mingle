import test from 'node:test';
import assert from 'node:assert/strict';
import { decks } from '../dist/data/decks.js';
import { soloDecks } from '../dist/data/solo-decks.js';
import { challenges, commonChallenges, themeChallenges, DECK_TOUCH_POLICY } from '../dist/data/challenges.js';
import { romanceChallenges } from '../dist/data/challenges/romance.js';
import { adultChallenges } from '../dist/data/challenges/adult.js';
import { friendsChallenges } from '../dist/data/challenges/friends.js';
import { familyChallenges } from '../dist/data/challenges/family.js';
import { workMeetupChallenges } from '../dist/data/challenges/work-meetup.js';
import { roleplayChallenges } from '../dist/data/challenges/roleplay.js';
import { commonChallengeCards } from '../dist/data/challenges/common.js';
import { participantRuleForDeck, displayQuestionText } from '../dist/participant-rule.js';

const deckIds = decks.map((deck) => deck.id);
const soloIds = soloDecks.map((deck) => deck.id);
const rawSources = [romanceChallenges, adultChallenges, friendsChallenges, familyChallenges, workMeetupChallenges, roleplayChallenges];
const rawThemed = rawSources.flatMap((source) => Object.entries(source).flatMap(([deckId, cards]) => cards.map((card) => ({ deckId, card }))));
const themed = Object.entries(themeChallenges).flatMap(([deckId, cards]) => cards.map((card) => ({ deckId, card })));
const decksWithCards = Object.entries(themeChallenges);

const ADULT = ['intimacy', 'first-intimacy', 'intimacy-refresh', 'intimacy-distance'];
const CHILD = ['parent-under12', 'grandparents-and-grandchildren', 'classmates'];
const COUPLE = ['couples', 'new-couple', 'moving-in', 'engaged-couple'];
const EXPECTED_POLICY = {
  couples: 2, 'new-couple': 2, 'moving-in': 2, 'engaged-couple': 2,
  date: 0, 'acquaintance-date': 0, omiai: 0,
  intimacy: 3, 'first-intimacy': 3, 'intimacy-refresh': 3, 'intimacy-distance': 3,
  friends: 1, reunion: 1, 'same-oshi-fans': 1, roommates: 1, 'late-night-diner': 1, 'travel-companions': 1,
  siblings: 1, 'parent-50plus': 1, 'family-reunion': 1, 'in-laws': 1,
  'parent-under12': 1, 'grandparents-and-grandchildren': 1, classmates: 1,
  founders: 1, team: 1, 'new-colleagues': 1, 'sports-teammates': 1, 'business-meetup': 1,
  'party-first-meeting': 0, 'bar-first-meeting': 0, 'group-mixer': 0, neighbors: 0,
  'promotion-rivals': 1, 'love-rivals': 1, 'arch-enemies': 1, 'hero-and-demon-king': 1, 'assassin-and-target': 1, 'detective-and-phantom-thief': 1,
  'ex-lovers': 0,
};

const hasStandaloneAite = (text) => displayQuestionText(text, { participants: ['甲', '乙'], participantIndex: 0, rule: 'pair' }) !== text;

test('1. all 40 group decks have exactly 10 theme challenges and nothing else', () => {
  assert.equal(deckIds.length, 40);
  assert.deepEqual(Object.keys(themeChallenges).sort(), [...deckIds].sort());
  for (const [deckId, cards] of Object.entries(themeChallenges)) assert.equal(cards.length, 10, deckId);
  // 6 つのファイルで同じデッキを二重に書かない
  const all = rawSources.flatMap((source) => Object.keys(source));
  assert.equal(new Set(all).size, all.length);
});

test('2. challenge ids are unique and do not collide with question, R18 question, or solo question ids', () => {
  const challengeIds = challenges.map((card) => card.id);
  assert.equal(new Set(challengeIds).size, challengeIds.length);
  // 既存データでは、成人向けデッキの質問 ID が他デッキの R18 質問にも現れる（お題とは無関係）ため、質問側は集合で扱う。
  const questionIds = new Set([
    ...decks.flatMap((deck) => [...deck.questions, ...(deck.r18Questions || [])].map((card) => card.id)),
    ...soloDecks.flatMap((deck) => deck.questions.map((card) => card.id)),
  ]);
  for (const id of challengeIds) assert.equal(questionIds.has(id), false, id);
});

test('3. id formats', () => {
  for (const { deckId, card } of themed) assert.match(card.id, new RegExp(`^ch-${deckId}-(0[1-9]|10)$`), card.id);
  for (const card of commonChallenges) assert.match(card.id, /^(try|touch)-\d{2}$/, card.id);
  assert.equal(deckIds.some((id) => id.startsWith('ch')), false);
  for (const [deckId, cards] of decksWithCards) assert.deepEqual(cards.map((card) => card.id), Array.from({ length: cards.length }, (_, i) => `ch-${deckId}-${String(i + 1).padStart(2, '0')}`), deckId);
});

test('4. texts are non-empty, within 60 characters, single-line, and unique', () => {
  for (const card of challenges) {
    assert.equal(typeof card.text, 'string', card.id);
    assert.ok(card.text.trim().length > 0, card.id);
    assert.ok(Array.from(card.text).length <= 60, `${card.id}: ${Array.from(card.text).length}`);
    assert.doesNotMatch(card.text, /[\u0000-\u001f\u007f\u2028\u2029]/u, card.id);
  }
  assert.equal(new Set(challenges.map((card) => card.text)).size, challenges.length);
});

test('5. field values are valid and raw theme files use only the allowed keys', () => {
  for (const card of challenges) {
    assert.ok([0, 1, 2, 3].includes(card.touch), card.id);
    assert.ok(['any', 'pair', 'group'].includes(card.players), card.id);
    assert.ok(['each', 'together'].includes(card.perform), card.id);
    assert.ok(['inPerson', 'remote', 'either'].includes(card.place), card.id);
    assert.equal(typeof card.r18, 'boolean', card.id);
    assert.equal(card.kind, 'challenge', card.id);
    if (card.seconds !== undefined) assert.ok(Number.isInteger(card.seconds) && card.seconds >= 30 && card.seconds <= 180, card.id);
  }
  const allowed = new Set(['id', 'text', 'touch', 'players', 'perform', 'place', 'seconds', 'r18']);
  for (const { deckId, card } of rawThemed) {
    assert.deepEqual(Object.keys(card).filter((key) => !allowed.has(key)), [], card.id);
    for (const key of ['id', 'text', 'touch', 'players', 'perform', 'place', 'seconds']) assert.ok(Object.hasOwn(card, key), `${card.id} lacks ${key}`);
    if (Object.hasOwn(card, 'r18')) assert.equal(card.r18, true, `${card.id}: r18 is only written when true`);
    assert.ok(deckIds.includes(deckId), deckId);
  }
});

test('6. theme challenges stay within the deck touch limit', () => {
  for (const { deckId, card } of themed) assert.ok(card.touch <= DECK_TOUCH_POLICY[deckId], `${card.id} touch ${card.touch} > ${DECK_TOUCH_POLICY[deckId]}`);
});

test('7. r18 is only for the four adult decks and never for common challenges', () => {
  for (const { deckId, card } of themed) if (card.r18) assert.ok(ADULT.includes(deckId), card.id);
  for (const card of commonChallenges) assert.equal(card.r18, false, card.id);
});

test('8. touch levels 2 and 3 are limited to the couple and adult decks', () => {
  for (const { deckId, card } of themed) {
    if (card.touch === 3) assert.ok(ADULT.includes(deckId), card.id);
    if (card.touch >= 2) assert.ok(COUPLE.includes(deckId) || ADULT.includes(deckId), card.id);
  }
  for (const [deckId, cards] of decksWithCards) {
    const level3 = cards.filter((card) => card.touch === 3).length;
    if (deckId === 'first-intimacy' || deckId === 'intimacy-distance') assert.ok(level3 <= 3, `${deckId} level 3: ${level3}`);
    if (deckId === 'intimacy') assert.ok(level3 <= 2, `${deckId} level 3: ${level3}`);
  }
});

test('9. child decks have no touch above 1 and no romantic wording', () => {
  for (const { deckId, card } of themed.filter(({ deckId }) => CHILD.includes(deckId))) {
    assert.ok(card.touch <= 1, card.id);
    assert.doesNotMatch(card.text, /恋|好きな人|キス|デート|付き合/u, card.id);
  }
});

test('10. no-touch decks contain only touch 0', () => {
  const noTouch = ['date', 'acquaintance-date', 'omiai', 'party-first-meeting', 'bar-first-meeting', 'group-mixer', 'neighbors', 'ex-lovers'];
  for (const { deckId, card } of themed.filter(({ deckId }) => noTouch.includes(deckId))) assert.equal(card.touch, 0, card.id);
});

test('11. group-deck challenge texts have no standalone 相手', () => {
  for (const { deckId, card } of themed.filter(({ deckId }) => participantRuleForDeck(deckId) === 'group')) assert.equal(hasStandaloneAite(card.text), false, `${card.id}: ${card.text}`);
  for (const card of commonChallenges.filter((item) => item.players !== 'pair')) assert.equal(hasStandaloneAite(card.text), false, `${card.id}: ${card.text}`);
});

test('12. each deck has at least 3 either/remote cards and at least 6 in-person-capable cards', () => {
  for (const [deckId, cards] of decksWithCards) {
    assert.ok(cards.filter((card) => card.place === 'either' || card.place === 'remote').length >= 3, `${deckId} either/remote`);
    assert.ok(cards.filter((card) => card.place === 'inPerson' || card.place === 'either').length >= 6, `${deckId} in person`);
  }
});

test('13. remote and either challenges have no touch and no R18', () => {
  for (const card of challenges.filter((item) => item.place !== 'inPerson')) {
    assert.equal(card.touch, 0, card.id);
    assert.equal(card.r18, false, card.id);
  }
});

test('14. no gendered wording in any challenge', () => {
  for (const card of challenges) assert.doesNotMatch(card.text, /彼氏|彼女|男子|女子|男らしく|女らしく|男の子|女の子|ママ友会|オトコ|オンナ/u, card.id);
});

test('15. adult decks avoid the forbidden wording', () => {
  for (const { deckId, card } of themed.filter(({ deckId }) => ADULT.includes(deckId))) assert.doesNotMatch(card.text, /脱|裸|胸|お尻|おしり|性器|撮影|録画|録音|縛|叩|痛/u, `${card.id}: ${card.text}`);
});

test('16. legacy challenge ids remain (中断データの互換は ID だけ)', () => {
  const legacyIds = [
    ...Array.from({ length: 20 }, (_, i) => `try-${String(i + 1).padStart(2, '0')}`),
    ...Array.from({ length: 9 }, (_, i) => `touch-${String(i + 1).padStart(2, '0')}`),
  ];
  assert.equal(legacyIds.length, 29);
  for (const id of legacyIds) {
    const card = challenges.find((item) => item.id === id);
    assert.ok(card, id);
    assert.equal(card.kind, 'challenge', id);
  }
  const legacyTouch = Object.fromEntries(['touch-02', 'touch-03', 'touch-04', 'touch-07'].map((id) => [id, 1]).concat(['touch-01', 'touch-05', 'touch-06', 'touch-08', 'touch-09'].map((id) => [id, 2])));
  for (const [id, level] of Object.entries(legacyTouch)) {
    const card = challenges.find((item) => item.id === id);
    assert.equal(card.touch, level, id);
    assert.equal(card.players, 'pair', id);
  }
  assert.equal(commonChallengeCards.length, commonChallenges.length);
});

test('17. group-deck touch 1 challenges say 右隣の人と and エアでもOK', () => {
  for (const { deckId, card } of themed.filter(({ deckId }) => participantRuleForDeck(deckId) === 'group')) {
    if (card.touch === 1) {
      assert.ok(card.text.includes('右隣の人と'), `${card.id}: ${card.text}`);
      assert.ok(card.text.includes('エアでもOK'), `${card.id}: ${card.text}`);
    }
  }
});

test('18. together challenge texts have no standalone 相手', () => {
  for (const card of challenges.filter((item) => item.perform === 'together')) assert.equal(hasStandaloneAite(card.text), false, `${card.id}: ${card.text}`);
});

test('19. per-deck together and touch counts stay within the limits', () => {
  const touchMax = (deckId) => (ADULT.includes(deckId) ? 7 : COUPLE.includes(deckId) ? 5 : DECK_TOUCH_POLICY[deckId] === 1 ? 3 : 0);
  for (const [deckId, cards] of decksWithCards) {
    assert.ok(cards.filter((card) => card.perform === 'together').length <= 3, `${deckId} together`);
    assert.ok(cards.filter((card) => card.touch >= 1).length <= touchMax(deckId), `${deckId} touch count`);
  }
});

test('20. DECK_TOUCH_POLICY matches the design table', () => {
  assert.deepEqual({ ...DECK_TOUCH_POLICY }, EXPECTED_POLICY);
  for (const id of deckIds) assert.ok(Object.hasOwn(DECK_TOUCH_POLICY, id), id);
  for (const id of soloIds) assert.equal(Object.hasOwn(DECK_TOUCH_POLICY, id), false, id);
});

test('21. solo decks have no challenges', () => {
  for (const id of soloIds) assert.equal(Object.hasOwn(themeChallenges, id), false, id);
  assert.equal(challenges.some((card) => card.id.startsWith('ch-self-') || card.deckIds?.some((id) => soloIds.includes(id))), false);
});

test('B1. touch 2+ challenges contain a consent phrase, and touch 1 contains a consent or air-alternative phrase', () => {
  for (const card of challenges) {
    if (card.touch >= 2) assert.match(card.text, /OKなら|よければ/, `${card.id}: ${card.text}`);
    if (card.touch === 1) assert.match(card.text, /エアでもOK|OKなら|よければ/, `${card.id}: ${card.text}`);
  }
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { decks } from '../dist/data/decks.js';
import { soloCategories, soloDecks } from '../dist/data/solo-decks.js';

const LEGACY_IDS = [
  'self-love-now', 'self-crush', 'self-breakup-decided', 'self-breakup-lingering', 'self-strengths', 'self-work',
  'self-school', 'self-club', 'self-friends', 'self-values', 'self-checkin',
];
const NEW_IDS = ['self-path', 'self-people-tired', 'self-confidence', 'self-decision', 'self-future'];
const DISTRESS_IDS = [
  'self-breakup-decided', 'self-breakup-lingering', 'self-work', 'self-school',
  'self-confidence', 'self-people-tired', 'self-future',
];
const LOVE_CARE_IDS = ['self-love-now'];

const BANNED_QUESTION_STYLE = [
  /なぜ/u, /どうして/u, /べき/u, /戻れる/u, /戻りたい/u, /本当によかった/u, /SNSを見/u,
  /相手の本音/u, /相手はどう思/u, /自分の悪い/u, /何がいけなかった/u, /最悪/u, /うらやまし/u, /あなた/u,
];
const BANNED_DIAGNOSIS = [
  /うつ/u, /病気/u, /症状/u, /診断/u, /障害/u, /トラウマ/u, /PTSD/u, /依存/u, /メンヘラ/u, /HSP/u,
  /愛着スタイル/u, /自己肯定感が低い/u, /ネガティブ思考/u, /認知の歪み/u, /共依存/u, /毒親/u,
  /モラハラ/u, /ストレス度/u, /レベル判定/u,
];
const BANNED = [...BANNED_QUESTION_STYLE, ...BANNED_DIAGNOSIS];

test('solo catalog has 16 fixed-order non-adult solo themes with 12 questions each', () => {
  assert.equal(soloDecks.length, 16);
  assert.equal(soloDecks[0].id, 'self-love-now');
  for (const deck of soloDecks) {
    assert.equal(deck.audience, 'solo', deck.id);
    assert.equal(deck.questionOrder, 'fixed', deck.id);
    assert.equal(deck.adultOnly, false, deck.id);
    assert.equal(deck.questions.length, 12, deck.id);
    for (const card of deck.questions) assert.equal(card.r18, false, card.id);
  }
});

test('legacy deck and card ids are preserved and new ids exist', () => {
  const ids = new Set(soloDecks.map((deck) => deck.id));
  for (const id of [...LEGACY_IDS, ...NEW_IDS]) assert.ok(ids.has(id), `missing deck: ${id}`);
  for (const id of LEGACY_IDS) {
    const deck = soloDecks.find((item) => item.id === id);
    assert.deepEqual(deck.questions.map((card) => card.id), Array.from({ length: 12 }, (_, i) => `${id}-${String(i + 1).padStart(2, '0')}`));
  }
});

test('card ids are unique across the whole catalog and question texts are unique within a deck', () => {
  // Group decks may legitimately repeat ids between questions/r18Questions, so only
  // check solo ids for internal uniqueness and for collisions with the group catalog.
  const groupIds = new Set(decks.flatMap((deck) => [...(deck.questions || []), ...(deck.r18Questions || [])].map((card) => card.id)));
  const seen = new Set();
  for (const deck of soloDecks) {
    for (const card of deck.questions) {
      assert.ok(!seen.has(card.id), `duplicate solo card id: ${card.id}`);
      assert.ok(!groupIds.has(card.id), `solo card id collides with group catalog: ${card.id}`);
      seen.add(card.id);
    }
  }
  for (const deck of soloDecks) {
    assert.equal(new Set(deck.questions.map((card) => card.text)).size, deck.questions.length, deck.id);
  }
});

test('every solo category exists and has at least two themes', () => {
  const categoryIds = new Set(soloCategories.map((category) => category.id));
  assert.equal(soloCategories.find((category) => category.id === 'friends').label, '友だち・人間関係のこと');
  for (const deck of soloDecks) assert.ok(categoryIds.has(deck.category), `${deck.id}: ${deck.category}`);
  for (const category of soloCategories) {
    assert.ok(soloDecks.filter((deck) => deck.category === category.id).length >= 2, category.id);
  }
});

test('question text is short, ends with a question mark, and avoids banned expressions', () => {
  for (const deck of soloDecks) {
    for (const card of deck.questions) {
      assert.ok(Array.from(card.text).length <= 40, `${card.id}: too long (${Array.from(card.text).length})`);
      assert.ok(card.text.endsWith('？'), `${card.id}: must end with ？`);
      for (const pattern of BANNED) assert.doesNotMatch(card.text, pattern, `${card.id}: ${pattern}`);
    }
  }
});

test('titles, subtitles and descriptions avoid banned and diagnostic expressions and describe 12 questions', () => {
  for (const deck of soloDecks) {
    for (const field of ['title', 'subtitle', 'description']) {
      assert.equal(typeof deck[field], 'string', `${deck.id}.${field}`);
      assert.ok(deck[field].trim().length > 0, `${deck.id}.${field}`);
      for (const pattern of BANNED) assert.doesNotMatch(deck[field], pattern, `${deck.id}.${field}: ${pattern}`);
    }
    assert.ok(deck.description.includes('12問'), `${deck.id}: description must mention 12問`);
    assert.ok(Array.from(deck.description).length <= 100, `${deck.id}: description too long`);
  }
});

test('care flag marks distress and love-relationship themes only', () => {
  for (const deck of soloDecks) {
    const expected = DISTRESS_IDS.includes(deck.id) ? 'distress' : LOVE_CARE_IDS.includes(deck.id) ? 'love' : undefined;
    assert.equal(deck.care ?? undefined, expected, deck.id);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decks } from '../dist/data/decks.js';
import { DECK_TOUCH_POLICY } from '../dist/data/challenges.js';
import { groupLabels, themeGroups } from '../dist/data/theme-groups.js';

const NEW_DECK_IDS = [
  'ex-lovers', 'detective-and-phantom-thief', 'in-laws', 'same-oshi-fans', 'roommates',
  'grandparents-and-grandchildren', 'neighbors', 'travel-companions', 'late-night-diner', 'group-mixer',
  'engaged-couple', 'classmates',
];
const SHARED_QUESTION = 'これから、なんて呼んで欲しい？';
const GENDERED = /彼氏|彼女|男性|女性|旦那|奥さん|嫁|姑|婿|舅|ママ|パパ|おじいちゃん|おばあちゃん/;
const newDecks = NEW_DECK_IDS.map((id) => {
  const deck = decks.find((item) => item.id === id);
  assert.ok(deck, `${id} is registered in decks`);
  return deck;
});
const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const appSource = read('../dist/app.js');
const cssSource = read('../dist/styles.css');
// 設計書 §2.2 の接触上限の表（新しい 12 デッキの期待値）
const expectedNewDeckTouchLimit = {
  'engaged-couple': 2,
  'promotion-rivals': 1, 'love-rivals': 1, 'arch-enemies': 1, 'hero-and-demon-king': 1, 'assassin-and-target': 1, 'detective-and-phantom-thief': 1,
  'ex-lovers': 0,
  'same-oshi-fans': 1, roommates: 1, 'late-night-diner': 1, 'travel-companions': 1,
  'grandparents-and-grandchildren': 1, classmates: 1,
  'in-laws': 1, 'business-meetup': 1, 'sports-teammates': 1,
  'party-first-meeting': 0, 'bar-first-meeting': 0, 'group-mixer': 0, neighbors: 0,
};

test('every deck belongs to defined theme groups', () => {
  for (const deck of decks) {
    const groups = themeGroups[deck.id];
    assert.ok(Array.isArray(groups) && groups.length > 0, `${deck.id} has theme groups`);
    for (const group of groups) assert.ok(groupLabels[group], `${deck.id}: unknown group ${group}`);
  }
});

test('every question text is at most 60 characters', () => {
  for (const deck of decks) {
    for (const question of deck.questions) assert.ok([...question.text].length <= 60, `${question.id}: ${question.text}`);
  }
});

test('new decks use the agreed theme groups', () => {
  const expected = {
    'ex-lovers': ['relationship', 'roleplay'],
    'detective-and-phantom-thief': ['roleplay'],
    'in-laws': ['family'],
    'same-oshi-fans': ['friends'],
    roommates: ['friends'],
    'grandparents-and-grandchildren': ['family'],
    neighbors: ['first-meeting'],
    'travel-companions': ['friends', 'first-meeting'],
    'late-night-diner': ['friends'],
    'group-mixer': ['first-meeting', 'relationship'],
    'engaged-couple': ['relationship'],
    classmates: ['friends'],
  };
  for (const [id, groups] of Object.entries(expected)) assert.deepEqual([...themeGroups[id]].sort(), [...groups].sort(), id);
});

test('new decks are regular, non-R18 40-card decks', () => {
  for (const deck of newDecks) {
    assert.equal(deck.questions.length, 40, deck.id);
    assert.equal(deck.adultOnly, false, deck.id);
    assert.equal('r18Available' in deck, false, deck.id);
    assert.equal('r18Questions' in deck, false, deck.id);
    assert.equal(deck.questions.every((question) => question.r18 === false), true, deck.id);
    deck.questions.forEach((question, index) => {
      assert.equal(question.id, `${deck.id}-${String(index + 1).padStart(2, '0')}`);
    });
    if (Object.hasOwn(expectedNewDeckTouchLimit, deck.id)) assert.equal(DECK_TOUCH_POLICY[deck.id], expectedNewDeckTouchLimit[deck.id], `${deck.id} touch limit`);
    assert.equal(Number.isInteger(DECK_TOUCH_POLICY[deck.id]), true, `${deck.id} must have a touch limit`);
  }
});

test('new deck questions follow the wording rules', () => {
  for (const deck of newDecks) {
    for (const question of deck.questions) {
      assert.ok(question.text.endsWith('？'), `${question.id} should end with ？: ${question.text}`);
      assert.equal(question.text.includes('あなた'), false, `${question.id}: ${question.text}`);
      assert.equal(GENDERED.test(question.text), false, `${question.id}: ${question.text}`);
    }
  }
});

test('new deck questions are not duplicated within or across decks', () => {
  const others = new Set(decks.filter((deck) => !NEW_DECK_IDS.includes(deck.id)).flatMap((deck) => deck.questions.map((q) => q.text)));
  const seen = new Map();
  for (const deck of newDecks) {
    const texts = deck.questions.map((question) => question.text);
    assert.equal(new Set(texts).size, texts.length, `${deck.id} has duplicate questions`);
    for (const text of texts) {
      if (text === SHARED_QUESTION) continue;
      assert.equal(others.has(text), false, `${deck.id} reuses an existing question: ${text}`);
      assert.equal(seen.has(text), false, `${deck.id} duplicates ${seen.get(text)}: ${text}`);
      seen.set(text, deck.id);
    }
  }
});

test('first-meeting new decks ask the shared name question once', () => {
  for (const id of ['neighbors', 'travel-companions', 'group-mixer']) {
    const deck = newDecks.find((item) => item.id === id);
    assert.equal(deck.questions.filter((question) => question.text === SHARED_QUESTION).length, 1, id);
  }
});

test('new decks have icons and colors defined', () => {
  for (const id of NEW_DECK_IDS) {
    assert.ok(appSource.includes(`paths["${id}"]`), `icon for ${id}`);
    assert.ok(cssSource.includes(`.topic-${id} `), `.topic-${id}`);
    assert.ok(cssSource.includes(`.theme-card-${id} `), `.theme-card-${id}`);
  }
});

test('together challenges show ふたりで / みんなで instead of a single speaker', () => {
  assert.match(appSource, /isTogetherCard\(card\)/);
  assert.match(appSource, /"ふたりで"/);
  assert.match(appSource, /"みんなで"/);
  assert.match(appSource, /together \|\| session\.answerIndex === session\.participants\.length - 1 \? "次のカード"/);
});

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { THEME_EXPLORER_IMAGES, themeExplorerImage, recordThemeExplorerStart, themeExplorerHistory, rankThemeRecommendations, themeExplorerBookmarks, toggleThemeExplorerBookmark, themeExplorerExperienced, toggleThemeExplorerExperienced } from '../dist/theme-explorer.js';
import { THEME_EXAMPLE_QUESTION_IDS, themeExampleForDeck } from '../dist/theme-examples.js';
import { decks } from '../dist/data/decks.js';
import { soloDecks } from '../dist/data/solo-decks.js';
import { GUEST_THEME_IDS } from '../dist/theme-access.js';

let stored = null;
const auxiliaryStorage = new Map();
globalThis.localStorage = {
  getItem(key) { return key === 'mingle.theme-explorer.history.v1' ? stored : auxiliaryStorage.get(key) ?? null; },
  setItem(key, value) { if (key === 'mingle.theme-explorer.history.v1') stored = value; else auxiliaryStorage.set(key, value); },
};

// Bookmark and experienced tags are local-only, owner-scoped, reversible, and
// must stay isolated across guest and account identities.
assert.deepEqual(themeExplorerBookmarks(), []);
assert.equal(toggleThemeExplorerBookmark('friends'), true);
assert.deepEqual(themeExplorerBookmarks(), ['friends']);
assert.deepEqual(themeExplorerBookmarks('user-a'), []);
assert.equal(toggleThemeExplorerBookmark('friends', 'user-a'), true);
assert.deepEqual(themeExplorerBookmarks('user-a'), ['friends']);
assert.deepEqual(themeExplorerBookmarks('user-b'), []);
assert.equal(toggleThemeExplorerBookmark('friends'), false);
assert.deepEqual(themeExplorerBookmarks(), []);
assert.equal(toggleThemeExplorerBookmark('friends', 'user-a'), false);
assert.deepEqual(themeExplorerBookmarks('user-a'), []);
assert.equal(toggleThemeExplorerExperienced('date', 'user-a'), true);
assert.deepEqual(themeExplorerExperienced('user-a'), ['date']);
assert.equal(toggleThemeExplorerExperienced('date', 'user-a'), false);
assert.deepEqual(themeExplorerExperienced('user-a'), []);
// Reload semantics: helpers read storage on every access.
assert.equal(toggleThemeExplorerBookmark('friends', 'user-b'), true);
assert.deepEqual(themeExplorerBookmarks('user-b'), ['friends']);
assert.deepEqual(themeExplorerExperienced('user-b'), []);
auxiliaryStorage.set('mingle.theme-explorer.bookmarks.v1', '{bad json');
auxiliaryStorage.set('mingle.theme-explorer.experienced.v1', JSON.stringify(['bad']));
assert.deepEqual(themeExplorerBookmarks('user-b'), []);
assert.deepEqual(themeExplorerExperienced('user-b'), []);
const previousGetItem = globalThis.localStorage.getItem;
globalThis.localStorage.getItem = () => { throw new Error('blocked read'); };
assert.doesNotThrow(() => themeExplorerBookmarks('user-a'));
assert.doesNotThrow(() => themeExplorerExperienced('user-a'));
globalThis.localStorage.getItem = previousGetItem;

stored = JSON.stringify({ alice: { group: [{ themeIds: ['A', 'B'] }, null, 'bad'], solo: null }, broken: 'x', primitive: 1 });
assert.deepEqual(themeExplorerHistory('alice', 'group').map((row) => row.themeIds[0]), ['A', 'B']);
assert.deepEqual(themeExplorerHistory('alice', 'solo'), []);
stored = '{bad json';
assert.deepEqual(themeExplorerHistory('alice', 'group'), []);
stored = JSON.stringify(['not', 'an', 'object']);
assert.deepEqual(themeExplorerHistory('alice', 'group'), []);

stored = null;
recordThemeExplorerStart({ ownerId: 'alice', mode: 'group', themeIds: ['A', 'B'] });
recordThemeExplorerStart({ ownerId: 'alice', mode: 'group', themeIds: ['A'] });
assert.deepEqual(themeExplorerHistory('alice', 'group').map((row) => row.themeIds[0]), ['A', 'B']);
assert.deepEqual(themeExplorerHistory('alice', 'solo'), []);
recordThemeExplorerStart({ ownerId: 'bob', mode: 'group', themeIds: ['A'] });
assert.deepEqual(themeExplorerHistory('alice', 'group').map((row) => row.themeIds[0]), ['A', 'B']);
assert.deepEqual(themeExplorerHistory('bob', 'group').map((row) => row.themeIds[0]), ['A']);
recordThemeExplorerStart({ ownerId: 'alice', mode: 'solo', themeIds: ['S'] });
assert.deepEqual(themeExplorerHistory('alice', 'solo').map((row) => row.themeIds[0]), ['S']);

recordThemeExplorerStart({ ownerId: 'owner-with-primitive', mode: 'group', themeIds: ['safe'] });
assert.equal(themeExplorerHistory('owner-with-primitive', 'group')[0].themeIds[0], 'safe');
for (let index = 0; index < 20; index += 1) recordThemeExplorerStart({ ownerId: 'limited', mode: 'group', themeIds: [`theme-${index}`] });
assert.equal(themeExplorerHistory('limited', 'group').length, 12);

stored = JSON.stringify({ alice: { group: [{ themeIds: ['A'] }] } });
globalThis.localStorage.setItem = () => { throw new Error('blocked'); };
recordThemeExplorerStart({ ownerId: 'alice', mode: 'group', themeIds: ['B'] });
assert.deepEqual(themeExplorerHistory('alice', 'group').map((row) => row.themeIds[0]), ['A']);
globalThis.localStorage.setItem = (_key, value) => { stored = value; };
stored = JSON.stringify({ primitive: 1 });
recordThemeExplorerStart({ ownerId: 'primitive', mode: 'group', themeIds: ['works'] });
assert.equal(themeExplorerHistory('primitive', 'group')[0].themeIds[0], 'works');
globalThis.localStorage.getItem = () => { throw new Error('blocked read'); };
assert.doesNotThrow(() => recordThemeExplorerStart({ ownerId: 'blocked-read', mode: 'group', themeIds: ['safe'] }));
globalThis.localStorage.getItem = () => stored;

const registry = JSON.parse(fs.readFileSync(path.resolve('outputs/theme-explorer/registry-v1.json'), 'utf8'));
const ids = registry.items.map((theme) => theme.id);
assert.equal(ids.length, 56);
assert.equal(new Set(ids).size, ids.length);
assert.deepEqual(new Set(ids), new Set([...decks, ...soloDecks].map((deck) => deck.id)));
for (const id of ids) {
  const image = themeExplorerImage(id);
  assert.ok(image, `missing image mapping: ${id}`);
  assert.ok(fs.existsSync(path.resolve('dist', image.slice(1))), `missing asset: ${id}`);
}
assert.equal(themeExplorerImage('__unknown__'), null);
assert.equal(Object.keys(THEME_EXPLORER_IMAGES).length, 56);

const catalog = [...decks, ...soloDecks];
assert.equal(Object.keys(THEME_EXAMPLE_QUESTION_IDS).length, catalog.length);
for (const deck of catalog) {
  assert.ok(Object.hasOwn(THEME_EXAMPLE_QUESTION_IDS, deck.id), `missing example metadata: ${deck.id}`);
  const example = themeExampleForDeck(deck);
  assert.ok(example, `empty example: ${deck.id}`);
  if (!deck.adultOnly) {
    assert.ok([...example].length <= 50, `example too long: ${deck.id}`);
    const id = THEME_EXAMPLE_QUESTION_IDS[deck.id];
    if (id) {
      const card = deck.questions.find((question) => question.id === id);
      assert.ok(card && card.r18 !== true && card.kind !== 'challenge' && card.kind !== 'action', `unsafe example source: ${deck.id}`);
    }
  }
}

const fixture = [
  { id: 'friends', category: 'friends' }, { id: 'reunion', category: 'friends' },
  { id: 'family-reunion', category: 'family' }, { id: 'date', category: 'date' },
  { id: 'locked-new', category: 'new' },
];
const rank = (rows, available = new Set(fixture.map((deck) => deck.id))) => rankThemeRecommendations({
  decks: fixture,
  historyRows: rows,
  baseIds: ['date', 'friends', 'family-reunion', 'reunion', 'locked-new'],
  isAvailable: (deck) => available.has(deck.id),
  categoryOf: (deck) => [deck.category],
});
assert.deepEqual(rank([]).slice(0, 3).map((deck) => deck.id), ['date', 'friends', 'family-reunion']);
assert.equal(rank([{ themeIds: ['friends'] }])[0].id, 'reunion');
assert.equal(rank([{ themeIds: ['date'] }, { themeIds: ['friends'] }])[0].id, 'family-reunion');
assert.equal(rank([{ themeIds: ['unknown'] }])[0].id, 'date');
assert.equal(rank([{ themeIds: ['friends'] }], new Set(['friends', 'date']))[0].id, 'date');
assert.deepEqual(rank([{ themeIds: ['friends'] }]).map((deck) => deck.id), rank([{ themeIds: ['friends'] }]).map((deck) => deck.id));

const tierFixture = [
  { id: 'a1', category: 'same' }, { id: 'a2', category: 'same' }, { id: 'b1', category: 'other' },
];
assert.deepEqual(rankThemeRecommendations({
  decks: tierFixture,
  baseIds: ['a1', 'a2', 'b1'],
  limit: 3,
  isAvailable: (deck) => deck.id !== 'b1',
  categoryOf: (deck) => [deck.category],
}).map((deck) => deck.id), ['a1', 'a2', 'b1']);

const guestAvailable = new Set(GUEST_THEME_IDS);
const guestRank = (historyRows) => rankThemeRecommendations({
  decks,
  historyRows,
  baseIds: decks.map((deck) => deck.id),
  limit: 6,
  isAvailable: (deck) => guestAvailable.has(deck.id),
  categoryOf: (deck) => [deck.id],
});
assert.deepEqual(new Set(guestRank([]).map((deck) => deck.id)), guestAvailable);
assert.deepEqual(new Set(guestRank([...guestAvailable].map((id) => ({ themeIds: [id] }))).map((deck) => deck.id)), guestAvailable);

console.log(`theme-explorer tests passed: ${ids.length} assets, history isolation/corruption/mixed recency covered`);

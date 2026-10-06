import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { THEME_EXPLORER_IMAGES, themeExplorerImage, recordThemeExplorerStart, themeExplorerHistory } from '../dist/theme-explorer.js';
import { decks } from '../dist/data/decks.js';
import { soloDecks } from '../dist/data/solo-decks.js';

let stored = null;
globalThis.localStorage = {
  getItem() { return stored; },
  setItem(_key, value) { stored = value; },
};

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
assert.equal(ids.length, 51);
assert.equal(new Set(ids).size, ids.length);
assert.deepEqual(new Set(ids), new Set([...decks, ...soloDecks].map((deck) => deck.id)));
for (const id of ids) {
  const image = themeExplorerImage(id);
  assert.ok(image, `missing image mapping: ${id}`);
  assert.ok(fs.existsSync(path.resolve('dist', image.slice(1))), `missing asset: ${id}`);
}
assert.equal(themeExplorerImage('__unknown__'), null);
assert.equal(Object.keys(THEME_EXPLORER_IMAGES).length, 51);

console.log(`theme-explorer tests passed: ${ids.length} assets, history isolation/corruption/mixed recency covered`);

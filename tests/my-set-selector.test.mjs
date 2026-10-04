import test from 'node:test';
import assert from 'node:assert/strict';
import { playableSavedSet, playableSavedSets } from '../dist/my-set.js';

const ids = ['date-01', 'date-02', 'date-03', 'date-04', 'date-05', 'date-06'];

test('playable saved sets accept complete owned sets and preserve R18 metadata', () => {
  const customId = 'custom:11111111-1111-4111-8111-111111111111';
  const set = playableSavedSet({ id: 'set-1', name: '週末', card_ids: [...ids.slice(0, 5), customId] }, [{ id: customId, text: '自作', r18: true }]);
  assert.equal(set.cardCount, 6);
  assert.equal(set.hasR18, true);
});

test('playable saved sets classify adult deck questions and prefixless custom ids', () => {
  const customId = '11111111-1111-4111-8111-111111111111';
  const set = playableSavedSet({ id: 'set-2', card_ids: ['intimacy-01', 'date-01', 'date-02', 'date-03', 'date-04', customId] }, [{ id: customId, text: '自作', r18: false }]);
  assert.equal(set.hasR18, true);
  assert.equal(set.cards.at(-1).id, `custom:${customId}`);
});

test('playable saved set filtering excludes drafts, incomplete, and unknown cards', () => {
  const sets = [{ id: 'ready', card_ids: ids }, { id: 'short', card_ids: ids.slice(0, 5) }, { id: 'bad', card_ids: [...ids.slice(0, 5), 'missing'] }];
  assert.deepEqual(playableSavedSets(sets).map((set) => set.id), ['ready']);
});

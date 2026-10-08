import test from 'node:test';
import assert from 'node:assert/strict';
import { choicePrompts, matchPrompts, socialGames } from '../dist/data/social-games.js';

test('social games expose the agreed metadata', () => {
  assert.deepEqual(socialGames.map(({ id }) => id), ['match', 'choice']);
  assert.deepEqual(socialGames.map(({ rounds }) => rounds), [6, 6]);
  assert.deepEqual(socialGames.map(({ minPlayers, maxPlayers }) => [minPlayers, maxPlayers]), [[2, 8], [2, 2]]);
  assert.equal(socialGames.every((game) => game.title && game.subtitle), true);
});

test('social prompt pools meet the minimum count and have unique ids', () => {
  assert.ok(matchPrompts.length >= 36);
  assert.ok(choicePrompts.length >= 36);
  const ids = [...matchPrompts, ...choicePrompts].map(({ id }) => id);
  assert.equal(new Set(ids).size, ids.length);
});

test('social prompt texts are non-empty and unique', () => {
  const prompts = [...matchPrompts, ...choicePrompts];
  assert.equal(prompts.every(({ text }) => typeof text === 'string' && text.trim().length > 0), true);
  const texts = prompts.map(({ text }) => text.trim());
  assert.equal(new Set(texts).size, texts.length);
});

test('choice prompts always have exactly two non-empty options', () => {
  for (const prompt of choicePrompts) {
    assert.ok(Array.isArray(prompt.options), prompt.id);
    assert.equal(prompt.options.length, 2, prompt.id);
    assert.equal(prompt.options.every((option) => typeof option === 'string' && option.trim().length > 0), true, prompt.id);
  }
});

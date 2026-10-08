import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SOCIAL_GAME_INTENT_KEY,
  consumeSocialGameIntent,
  readSocialGameIntent,
  saveSocialGameIntent,
  socialGameHomeHref,
} from '../dist/social-game-intent.js';

function storage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

test('social game intent carries names and venue token, then is one-shot', () => {
  const store = storage();
  assert.equal(saveSocialGameIntent({ gameId: 'match', names: ['あき', 'りん'], venueToken: 'a'.repeat(32) }, store, () => 1000), true);
  assert.deepEqual(readSocialGameIntent(store, () => 2000), { gameId: 'match', names: ['あき', 'りん'], venueToken: 'a'.repeat(32), createdAt: 1000 });
  assert.deepEqual(consumeSocialGameIntent(store, () => 2000), { gameId: 'match', names: ['あき', 'りん'], venueToken: 'a'.repeat(32), createdAt: 1000 });
  assert.equal(store.getItem(SOCIAL_GAME_INTENT_KEY), null);
  assert.equal(socialGameHomeHref({ returnToHome: true }), '/?socialGameReturn=1');
  assert.equal(socialGameHomeHref({ venueToken: 'a'.repeat(32), returnToHome: true }), `/?venue=${'a'.repeat(32)}&socialGameReturn=1`);
});

test('social game intent rejects invalid game, choice roster, token, and expired values', () => {
  const store = storage();
  assert.equal(saveSocialGameIntent({ gameId: 'minority-topic', names: ['A', 'B'] }, store, () => 1000), false);
  assert.equal(saveSocialGameIntent({ gameId: 'choice', names: ['A'] }, store, () => 1000), false);
  assert.equal(saveSocialGameIntent({ gameId: 'choice', names: ['A', 'B', 'C'] }, store, () => 1000), false);
  assert.equal(saveSocialGameIntent({ gameId: 'match', names: ['A', 'B'], venueToken: 'https://evil.test' }, store, () => 1000), false);
  assert.equal(saveSocialGameIntent({ gameId: 'match', names: ['A', 'B'] }, store, () => 1000), true);
  assert.equal(readSocialGameIntent(store, () => 1000 + 30 * 60 * 1000 + 1), null);
  store.setItem(SOCIAL_GAME_INTENT_KEY, JSON.stringify({ gameId: 'choice', names: ['A', 'B', 'C'], venueToken: '', createdAt: 1000 }));
  assert.equal(readSocialGameIntent(store, () => 1000), null);
});

test('storage failures fail closed', () => {
  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
  assert.equal(saveSocialGameIntent({ gameId: 'match', names: ['A', 'B'] }, broken, () => 1000), false);
  assert.equal(readSocialGameIntent(broken, () => 1000), null);
});

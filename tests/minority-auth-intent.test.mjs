import test from 'node:test';
import assert from 'node:assert/strict';
import { consumeMinorityAuthIntent, saveMinorityAuthIntent } from '../dist/minority-auth-intent.js';

function storage() { const map = new Map(); return { getItem: (key) => map.get(key) || null, setItem: (key, value) => map.set(key, value), removeItem: (key) => map.delete(key) }; }
const token = 'a'.repeat(32);

test('minority auth intent round trips fixed venue token and is one shot', () => {
  const store = storage(); assert.equal(saveMinorityAuthIntent({ venueToken: token, name: '代表者' }, store, () => 1000), true);
  assert.deepEqual(consumeMinorityAuthIntent(store, () => 2000), { venueToken: token, name: '代表者' });
  assert.equal(consumeMinorityAuthIntent(store, () => 2000), null);
});

test('normal use intent round trips with an empty venue token', () => {
  const store = storage(); assert.equal(saveMinorityAuthIntent({ name: '代表' }, store, () => 1000), true);
  assert.deepEqual(consumeMinorityAuthIntent(store, () => 2000), { venueToken: '', name: '代表' });
  assert.equal(consumeMinorityAuthIntent(store, () => 2000), null);
});

test('intent rejects external or malformed destinations and expires', () => {
  const store = storage(); assert.equal(saveMinorityAuthIntent({ venueToken: 'https://evil.test', name: 'x' }, store, () => 0), false);
  assert.equal(saveMinorityAuthIntent({ venueToken: token, name: 'x' }, store, () => 0), true);
  assert.equal(consumeMinorityAuthIntent(store, () => 30 * 60 * 1000 + 1), null);
});

test('storage failures fail closed', () => {
  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
  assert.equal(saveMinorityAuthIntent({ name: 'x' }, broken), false); assert.equal(consumeMinorityAuthIntent(broken), null);
});

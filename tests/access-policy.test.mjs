import test from 'node:test';
import assert from 'node:assert/strict';
import { canContinue } from '../dist/access-policy.js';

test('continue requires enabled account, authReady, and confirmed user', async () => {
  assert.equal(await canContinue({ sharedGuest: false }, { enabled: false, authReady: true, user: { id: 'u1' } }), false);
  assert.equal(await canContinue({ sharedGuest: false }, { enabled: true, authReady: false, user: { id: 'u1' } }), false);
  assert.equal(await canContinue({ sharedGuest: false }, { enabled: true, authReady: true, user: null }), false);
  assert.equal(await canContinue({ sharedGuest: false }, { enabled: true, authReady: true, user: { id: 'u1' } }), true);
  assert.equal(await canContinue({ sharedGuest: true }, { enabled: true, authReady: true, user: { id: 'u1' } }), true);
});

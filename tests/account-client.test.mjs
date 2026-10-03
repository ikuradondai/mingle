import test from 'node:test';
import assert from 'node:assert/strict';

const module = await import('../dist/account.js?client-test=1');

test('account client discovers config, sends current bearer, and never calls API tokenless', async () => {
  let token = 'token-a'; const calls = []; const auth = {
    async getSession() { return { data: { session: token ? { access_token: token } : null }, error: null }; },
    async signInWithOtp() { return { data: null, error: null }; },
    async verifyOtp() { return { data: null, error: null }; },
    async signInWithOAuth() { return { data: null, error: null }; },
    async signOut() { return { error: null }; },
    onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
  };
  const sdk = { createClient() { return { auth }; } };
  const fetchImpl = async (url, options = {}) => { calls.push({ url, options }); if (url === '/api/account/config') return { ok: true, async json() { return { enabled: true, url: 'https://project.supabase.co', publishableKey: 'sb_publishable_public', googleEnabled: false }; } }; return { ok: true, async json() { return { user: { id: 'a' }, favorites: [], sets: [] }; } }; };
  const client = module.createAccountClientForTest({ fetchImpl, sdk }); await client.discover();
  await client.api.me(); assert.equal(calls.at(-1).options.headers.authorization, 'Bearer token-a');
  token = 'token-b'; await client.api.favorite({ id: 'date-01' }, true); assert.equal(calls.at(-1).options.headers.authorization, 'Bearer token-b');
  token = null; const before = calls.length; assert.deepEqual(await client.api.me(), { user: null, favorites: [], sets: [] }); await assert.rejects(() => client.api.favorite({ id: 'date-01' }, true), (error) => error.status === 401); assert.equal(calls.length, before);
});

test('auth provider errors are returned and SDK initialization failure disables account', async () => {
  const failingSdk = { createClient() { throw new Error('bad client'); } };
  const client = module.createAccountClientForTest({ sdk: failingSdk, fetchImpl: async () => ({ ok: true, async json() { return { enabled: true, url: 'https://project.supabase.co', publishableKey: 'sb_publishable_public', googleEnabled: true }; } }) });
  const config = await client.discover(); assert.equal(config.enabled, false); assert.equal(config.google, false);
  const errorSdk = { createClient() { return { auth: { async getSession() { return { data: { session: null }, error: null }; }, async signInWithOtp() { return { error: new Error('provider failed') }; } } }; } };
  const ready = module.createAccountClientForTest({ sdk: errorSdk, fetchImpl: async () => ({ ok: true, async json() { return { enabled: true, url: 'https://project.supabase.co', publishableKey: 'sb_publishable_public' }; } }) }); await ready.discover(); await assert.rejects(() => ready.api.sendOtp('a@example.test'), /provider failed/);
});

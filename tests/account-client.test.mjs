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

test('profile, deletion, and local signout use the fixed account contract', async () => {
  const calls = []; let signOutOptions = null;
  const auth = {
    async getSession() { return { data: { session: { access_token: 'token-profile' } }, error: null }; },
    async signOut(options) { signOutOptions = options; return { error: null }; },
    onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
  };
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url === '/api/account/config') return { ok: true, async json() { return { enabled: true, url: 'https://project.supabase.co', publishableKey: 'sb_publishable_public' }; } };
    return { ok: true, async json() { return url.endsWith('/profile') ? { user: { id: 'a', email: 'a@example.test', displayName: '新しい名前' } } : { deleted: true }; } };
  };
  const client = module.createAccountClientForTest({ fetchImpl, sdk: { createClient() { return { auth }; } } });
  await client.discover();
  await client.api.updateProfile('新しい名前');
  assert.equal(calls.at(-1).url, '/api/account/profile');
  assert.equal(calls.at(-1).options.method, 'PATCH');
  assert.deepEqual(JSON.parse(calls.at(-1).options.body), { displayName: '新しい名前' });
  await client.api.deleteAccount();
  assert.equal(calls.at(-1).url, '/api/account');
  assert.equal(calls.at(-1).options.method, 'DELETE');
  assert.deepEqual(JSON.parse(calls.at(-1).options.body), { confirmation: 'DELETE' });
  await client.api.logout();
  assert.deepEqual(signOutOptions, { scope: 'local' });
  await client.api.createCard('自作質問', true); assert.equal(calls.at(-1).url, '/api/account/cards'); assert.equal(calls.at(-1).options.method, 'POST'); assert.deepEqual(JSON.parse(calls.at(-1).options.body), { text: '自作質問', r18: true });
  await client.api.updateCard('custom:11111111-1111-4111-8111-111111111111', '更新質問', false); assert.equal(calls.at(-1).url, '/api/account/cards/custom%3A11111111-1111-4111-8111-111111111111'); assert.equal(calls.at(-1).options.method, 'PATCH');
  await client.api.deleteCard('custom:11111111-1111-4111-8111-111111111111'); assert.equal(calls.at(-1).url, '/api/account/cards/custom%3A11111111-1111-4111-8111-111111111111'); assert.equal(calls.at(-1).options.method, 'DELETE');
});

test('auth provider errors are returned and SDK initialization failure disables account', async () => {
  const failingSdk = { createClient() { throw new Error('bad client'); } };
  const client = module.createAccountClientForTest({ sdk: failingSdk, fetchImpl: async () => ({ ok: true, async json() { return { enabled: true, url: 'https://project.supabase.co', publishableKey: 'sb_publishable_public', googleEnabled: true }; } }) });
  const config = await client.discover(); assert.equal(config.enabled, false); assert.equal(config.google, false);
  const errorSdk = { createClient() { return { auth: { async getSession() { return { data: { session: null }, error: null }; }, async signInWithOtp() { return { error: new Error('provider failed') }; } } }; } };
  const ready = module.createAccountClientForTest({ sdk: errorSdk, fetchImpl: async () => ({ ok: true, async json() { return { enabled: true, url: 'https://project.supabase.co', publishableKey: 'sb_publishable_public' }; } }) }); await ready.discover(); await assert.rejects(() => ready.api.sendOtp('a@example.test'), /provider failed/);
});

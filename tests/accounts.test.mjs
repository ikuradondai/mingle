import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { accountConfig, createAccountService } from '../server-side/accounts.mjs';
import accountHandler from '../api/account.js';

function response(status, data) { return { ok: status >= 200 && status < 300, status, async json() { return data; } }; }
function request(path, { method = 'GET', body, authorization = 'Bearer user-token' } = {}) {
  const req = Readable.from(body === undefined ? [] : [Buffer.from(JSON.stringify(body))]);
  req.method = method; req.url = path; req.headers = { authorization, host: 'localhost', ...(body === undefined ? {} : { 'content-type': 'application/json' }) }; return req;
}
function sink() { let status, result; return { res: { setHeader() {}, writeHead(code) { status = code; }, end(value) { result = JSON.parse(value); } }, get result() { return { status, result }; } }; }

test('account service gracefully disables when Supabase config is absent', async () => {
  const service = createAccountService({ env: {}, fetchImpl: async () => { throw new Error('must not call network'); } });
  await assert.rejects(() => service.account(request('/api/account')), (error) => error.status === 503 && error.code === 'FEATURE_UNAVAILABLE');
});

test('public config rejects malformed URLs and secret key variants', () => {
  assert.equal(accountConfig({ SUPABASE_URL: 'javascript:alert(1)', SUPABASE_ANON_KEY: 'public' }), null);
  assert.equal(accountConfig({ SUPABASE_URL: 'https://project.supabase.co', SUPABASE_ANON_KEY: 'service_role-super-secret' }), null);
  assert.equal(accountConfig({ SUPABASE_URL: 'https://project.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_secret_do-not-use' }), null);
  assert.equal(accountConfig({ SUPABASE_URL: 'https://project.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_public' }).key, 'sb_publishable_public');
  assert.equal(accountConfig({ SUPABASE_URL: 'https://user:pass@project.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_public' }), null);
  assert.equal(accountConfig({ SUPABASE_URL: 'https://project.supabase.co/path', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_public' }), null);
  assert.equal(accountConfig({ SUPABASE_URL: 'https://project.supabase.co?x=1', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_public' }), null);
});

test('account service validates user through auth endpoint and scopes REST requests', async () => {
  const calls = [];
  const anonKey = `x.${Buffer.from(JSON.stringify({ role: 'anon' })).toString('base64url')}.x`;
  const service = createAccountService({ env: { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_ANON_KEY: anonKey }, fetchImpl: async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/auth/v1/user')) return response(200, { id: 'user-1', email: 'a@example.test' });
    if (url.includes('/favorites')) return response(200, []);
    return response(200, []);
  } });
  const result = await service.account(request('/api/account'));
  assert.equal(result.user.id, 'user-1'); assert.deepEqual(result.favorites, []); assert.deepEqual(result.sets, []);
  assert.ok(calls.every((call) => call.options.headers.Authorization === 'Bearer user-token'));
  await assert.rejects(() => service.favorite(request('/api/account/favorites/not-a-card'), 'not-a-card'), (error) => error.status === 400);
});

test('account writes reject missing or invalid auth before any data request', async () => {
  let calls = 0;
  const anonKey = `x.${Buffer.from(JSON.stringify({ role: 'anon' })).toString('base64url')}.x`;
  const service = createAccountService({ env: { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_ANON_KEY: anonKey }, fetchImpl: async () => { calls++; return response(401, {}); } });
  await assert.rejects(() => service.favorite(request('/api/account/favorites/date-01', { authorization: '' }), 'date-01'), (error) => error.status === 401);
  assert.equal(calls, 0);
});

test('self deletion rejects missing auth without changing data', async () => {
  let calls = 0; const anonKey = `x.${Buffer.from(JSON.stringify({ role: 'anon' })).toString('base64url')}.x`;
  const service = createAccountService({ env: { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_ANON_KEY: anonKey, SUPABASE_SERVICE_ROLE_KEY: 'service-role-secret' }, fetchImpl: async () => { calls++; return response(200, {}); } });
  await assert.rejects(() => service.removeAccount(request('/api/account', { method: 'DELETE', authorization: '' })), (error) => error.status === 401);
  assert.equal(calls, 0);
});

test('favorite upsert is idempotent and set payload always uses verified user id', async () => {
  const calls = []; const anonKey = `x.${Buffer.from(JSON.stringify({ role: 'anon' })).toString('base64url')}.x`;
  const service = createAccountService({ env: { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_ANON_KEY: anonKey }, fetchImpl: async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/auth/v1/user')) return response(200, { id: 'verified-user', email: 'x@y.test' });
    if (url.includes('/favorites?user_id')) return response(200, []);
    if (url.includes('/favorites?on_conflict')) return response(201, null);
    return response(201, [{ id: 'set-1234567890123456', user_id: 'verified-user', name: 'Six', card_ids: ['date-01', 'date-02', 'date-03', 'date-04', 'date-05', 'date-06'] }]);
  } });
  await service.favorite(request('/api/account/favorites/date-01', { method: 'PUT' }), 'date-01');
  const created = await service.set({ ...request('/api/account/sets', { method: 'POST', body: { name: 'Six', cardIds: ['date-01', 'date-02', 'date-03', 'date-04', 'date-05', 'date-06'], userId: 'attacker' } }), body: { name: 'Six', cardIds: ['date-01', 'date-02', 'date-03', 'date-04', 'date-05', 'date-06'], userId: 'attacker' } });
  assert.equal(JSON.parse(calls.at(-1).options.body).user_id, 'verified-user'); assert.equal(created.user_id, 'verified-user');
  await assert.rejects(() => service.set({ ...request('/api/account/sets', { method: 'POST', body: { name: 'bad', cardIds: [] } }), body: { name: 'bad', cardIds: [] } }), (error) => error.status === 400);
});

test('account deletion does not mutate rows when admin deletion fails', async () => {
  const calls = []; const anonKey = `x.${Buffer.from(JSON.stringify({ role: 'anon' })).toString('base64url')}.x`;
  const service = createAccountService({ env: { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_ANON_KEY: anonKey, SUPABASE_SERVICE_ROLE_KEY: 'service-role-secret' }, fetchImpl: async (url) => { calls.push(url); if (url.endsWith('/auth/v1/user')) return response(200, { id: 'verified-user' }); return response(500, {}); } });
  await assert.rejects(() => service.removeAccount(request('/api/account', { method: 'DELETE' })), (error) => error.status === 502);
  assert.deepEqual(calls, ['https://project.supabase.co/auth/v1/user', 'https://project.supabase.co/auth/v1/admin/users/verified-user']);
});

test('public config is safe and returns disabled state without config', async () => {
  const previous = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_ANON_KEY };
  delete process.env.SUPABASE_URL; delete process.env.SUPABASE_ANON_KEY;
  try { const out = sink(); await accountHandler(request('/api/account/config'), out.res); assert.deepEqual(out.result, { status: 200, result: { enabled: false, url: null, publishableKey: null, googleEnabled: false } }); }
  finally { if (previous.url === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = previous.url; if (previous.key === undefined) delete process.env.SUPABASE_ANON_KEY; else process.env.SUPABASE_ANON_KEY = previous.key; }
});

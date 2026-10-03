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
    if (url.endsWith('/auth/v1/user')) return response(200, { id: 'user-1', email: 'a@example.test', user_metadata: { display_name: '  A  ' } });
    if (url.includes('/favorites')) return response(200, []);
    return response(200, []);
  } });
  const result = await service.account(request('/api/account'));
  assert.equal(result.user.id, 'user-1'); assert.equal(result.user.displayName, 'A'); assert.equal(result.account.deletionAvailable, false); assert.deepEqual(result.favorites, []); assert.deepEqual(result.sets, []);
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

test('profile accepts only a trimmed unicode display name and updates auth metadata', async () => {
  const calls = []; const anonKey = `x.${Buffer.from(JSON.stringify({ role: 'anon' })).toString('base64url')}.x`;
  const service = createAccountService({ env: { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_ANON_KEY: anonKey }, fetchImpl: async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/auth/v1/user') && options.method === 'PUT') return response(200, { id: 'verified-user', user_metadata: { display_name: JSON.parse(options.body).data.display_name } });
    if (url.endsWith('/auth/v1/user')) return response(200, { id: 'verified-user', email: 'x@y.test', user_metadata: { display_name: 'Old' } });
    return response(200, []);
  } });
  const result = await service.profile({ ...request('/api/account/profile', { method: 'PATCH', body: { displayName: '  太郎  ' } }), body: { displayName: '  太郎  ' } });
  assert.equal(result.user.displayName, '太郎');
  assert.deepEqual(JSON.parse(calls.at(-1).options.body), { data: { display_name: '太郎' } });
  const fortyEmoji = '😀'.repeat(40);
  const cleared = await service.profile({ ...request('/api/account/profile', { method: 'PATCH', body: { displayName: '   ' } }), body: { displayName: '   ' } });
  assert.equal(cleared.user.displayName, null);
  assert.deepEqual(JSON.parse(calls.at(-1).options.body), { data: { display_name: '' } });
  await service.profile({ ...request('/api/account/profile', { method: 'PATCH', body: { displayName: fortyEmoji } }), body: { displayName: fortyEmoji } });
  await assert.rejects(() => service.profile({ ...request('/api/account/profile', { method: 'PATCH', body: { displayName: `${fortyEmoji}😀` } }), body: { displayName: `${fortyEmoji}😀` } }), (error) => error.status === 400);
  await assert.rejects(() => service.profile({ ...request('/api/account/profile', { method: 'PATCH', body: { displayName: 'a'.repeat(41) } }), body: { displayName: 'a'.repeat(41) } }), (error) => error.status === 400);
  await assert.rejects(() => service.profile({ ...request('/api/account/profile', { method: 'PATCH', body: { displayName: 'x', extra: true } }), body: { displayName: 'x', extra: true } }), (error) => error.status === 400);
  await assert.rejects(() => service.profile({ ...request('/api/account/profile', { method: 'PATCH', body: { displayName: 'x\n' } }), body: { displayName: 'x\n' } }), (error) => error.status === 400);
  const failedService = createAccountService({ env: { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_ANON_KEY: anonKey }, fetchImpl: async (url, options) => url.endsWith('/auth/v1/user') && options.method !== 'PUT' ? response(200, { id: 'verified-user' }) : response(500, {}) });
  await assert.rejects(() => failedService.profile({ ...request('/api/account/profile', { method: 'PATCH', body: { displayName: 'new' } }), body: { displayName: 'new' } }), (error) => error.status === 502);
});

test('account deletion does not mutate rows when admin deletion fails', async () => {
  const calls = []; const anonKey = `x.${Buffer.from(JSON.stringify({ role: 'anon' })).toString('base64url')}.x`;
  const service = createAccountService({ env: { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_ANON_KEY: anonKey, SUPABASE_SERVICE_ROLE_KEY: 'service-role-secret' }, fetchImpl: async (url) => { calls.push(url); if (url.endsWith('/auth/v1/user')) return response(200, { id: 'verified-user' }); return response(500, {}); } });
  await assert.rejects(() => service.removeAccount({ ...request('/api/account', { method: 'DELETE', body: { confirmation: 'DELETE' } }), body: { confirmation: 'DELETE' } }), (error) => error.status === 502);
  assert.deepEqual(calls, ['https://project.supabase.co/auth/v1/user', 'https://project.supabase.co/auth/v1/admin/users/verified-user']);
});

test('account deletion requires explicit confirmation before admin deletion', async () => {
  const calls = []; const anonKey = `x.${Buffer.from(JSON.stringify({ role: 'anon' })).toString('base64url')}.x`;
  const service = createAccountService({ env: { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_ANON_KEY: anonKey, SUPABASE_SERVICE_ROLE_KEY: 'service-role-secret' }, fetchImpl: async (url) => { calls.push(url); return response(200, { id: 'verified-user' }); } });
  await assert.rejects(() => service.removeAccount({ ...request('/api/account', { method: 'DELETE', body: { confirmation: 'wrong' } }), body: { confirmation: 'wrong' } }), (error) => error.status === 400 && error.code === 'CONFIRMATION_REQUIRED');
  await assert.rejects(() => service.removeAccount({ ...request('/api/account', { method: 'DELETE', body: { confirmation: 'DELETE', userId: 'other-user' } }), body: { confirmation: 'DELETE', userId: 'other-user' } }), (error) => error.status === 400 && error.code === 'CONFIRMATION_REQUIRED');
  await assert.rejects(() => service.removeAccount({ ...request('/api/account', { method: 'DELETE' }), body: undefined }), (error) => error.status === 400 && error.code === 'CONFIRMATION_REQUIRED');
  await assert.rejects(() => service.removeAccount({ ...request('/api/account', { method: 'DELETE' }), body: null }), (error) => error.status === 400 && error.code === 'CONFIRMATION_REQUIRED');
  await assert.rejects(() => service.removeAccount({ ...request('/api/account', { method: 'DELETE' }), body: [] }), (error) => error.status === 400 && error.code === 'CONFIRMATION_REQUIRED');
  assert.equal(calls.length, 5);
  assert.ok(calls.every((url) => url.endsWith('/auth/v1/user')));
});

test('account deletion reports unavailable without service role after authenticating owner', async () => {
  const calls = []; const anonKey = `x.${Buffer.from(JSON.stringify({ role: 'anon' })).toString('base64url')}.x`;
  const service = createAccountService({ env: { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_ANON_KEY: anonKey }, fetchImpl: async (url) => { calls.push(url); return response(200, { id: 'verified-user' }); } });
  await assert.rejects(() => service.removeAccount({ ...request('/api/account', { method: 'DELETE', body: { confirmation: 'DELETE' } }), body: { confirmation: 'DELETE' } }), (error) => error.status === 503 && error.code === 'ACCOUNT_DELETION_UNAVAILABLE');
  assert.deepEqual(calls, ['https://project.supabase.co/auth/v1/user']);
});

test('account deletion removes only the verified auth user and reports success', async () => {
  const calls = []; const anonKey = `x.${Buffer.from(JSON.stringify({ role: 'anon' })).toString('base64url')}.x`;
  const service = createAccountService({ env: { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_ANON_KEY: anonKey, SUPABASE_SERVICE_ROLE_KEY: 'service-role-secret' }, fetchImpl: async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/auth/v1/user')) return response(200, { id: 'verified-user' });
    return response(204, null);
  } });
  const result = await service.removeAccount({ ...request('/api/account', { method: 'DELETE', body: { confirmation: 'DELETE' } }), body: { confirmation: 'DELETE' } });
  assert.deepEqual(result, { deleted: true });
  assert.equal(calls.at(-1).url, 'https://project.supabase.co/auth/v1/admin/users/verified-user');
  assert.equal(calls.at(-1).options.headers.Authorization, 'Bearer service-role-secret');
  assert.deepEqual(JSON.parse(calls.at(-1).options.body), { should_soft_delete: false });
});

test('public config is safe and returns disabled state without config', async () => {
  const previous = { url: process.env.SUPABASE_URL, key: process.env.SUPABASE_ANON_KEY };
  delete process.env.SUPABASE_URL; delete process.env.SUPABASE_ANON_KEY;
  try { const out = sink(); await accountHandler(request('/api/account/config'), out.res); assert.deepEqual(out.result, { status: 200, result: { enabled: false, url: null, publishableKey: null, googleEnabled: false } }); }
  finally { if (previous.url === undefined) delete process.env.SUPABASE_URL; else process.env.SUPABASE_URL = previous.url; if (previous.key === undefined) delete process.env.SUPABASE_ANON_KEY; else process.env.SUPABASE_ANON_KEY = previous.key; }
});

test('custom cards enforce exact payload, owner identity, and set references', async () => {
  const calls = []; const anonKey = `x.${Buffer.from(JSON.stringify({ role: 'anon' })).toString('base64url')}.x`;
  const uuid = '11111111-1111-4111-8111-111111111111';
  let referenced = false;
  const service = createAccountService({ env: { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_ANON_KEY: anonKey }, fetchImpl: async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith('/auth/v1/user')) return response(200, { id: 'owner-1', email: 'x@y.test' });
    if (url.includes('/custom_cards?user_id=')) return response(200, [{ id: uuid, text: 'Saved', r18: false, created_at: '2026-01-01', updated_at: '2026-01-01' }]);
    if (url.endsWith('/custom_cards') && options.method === 'POST') return response(201, [{ id: uuid, text: '  New  ', r18: true, created_at: '2026-01-01', updated_at: '2026-01-01' }]);
    if (url.includes('/custom_cards?id=') && options.method === 'PATCH') return response(200, [{ id: uuid, text: 'Edited', r18: true, created_at: '2026-01-01', updated_at: '2026-01-01' }]);
    if (url.includes('/my_sets?user_id=') && options.method !== 'POST') return response(200, referenced ? [{ card_ids: [`custom:${uuid}`] }] : []);
    if (url.includes('/my_sets') && options.method === 'POST') return response(201, [{ id: 'set-1', user_id: 'owner-1', card_ids: JSON.parse(options.body).card_ids }]);
    if (url.includes('/custom_cards?id=') && options.method === 'DELETE') return response(200, [{ id: uuid }]);
    return response(200, []);
  } });
  const created = await service.customCard({ ...request('/api/account/cards', { method: 'POST', body: { text: ' New ', r18: true } }), body: { text: ' New ', r18: true } });
  assert.equal(created.card.id, `custom:${uuid}`); assert.equal(created.card.r18, true);
  await assert.rejects(() => service.customCard({ ...request('/api/account/cards', { method: 'POST', body: { text: 'x', r18: true, extra: 1 } }), body: { text: 'x', r18: true, extra: 1 } }), (error) => error.status === 400);
  await assert.rejects(() => service.customCard({ ...request('/api/account/cards', { method: 'POST', body: { text: 'x', r18: 'true' } }), body: { text: 'x', r18: 'true' } }), (error) => error.status === 400);
  await assert.rejects(() => service.customCard({ ...request('/api/account/cards', { method: 'POST', body: { text: '😀'.repeat(301), r18: false } }), body: { text: '😀'.repeat(301), r18: false } }), (error) => error.status === 400);
  await assert.rejects(() => service.customCard({ ...request('/api/account/cards', { method: 'POST', body: { text: 'line\nbreak', r18: false } }), body: { text: 'line\nbreak', r18: false } }), (error) => error.status === 400);
  const edited = await service.customCard({ ...request(`/api/account/cards/custom:${uuid}`, { method: 'PATCH', body: { text: 'Edited', r18: true } }), body: { text: 'Edited', r18: true } }, `custom:${uuid}`);
  assert.equal(edited.card.text, 'Edited');
  const set = await service.set({ ...request('/api/account/sets', { method: 'POST', body: { name: 'Mixed', cardIds: ['date-01','date-02','date-03','date-04','date-05',`custom:${uuid}`] } }), body: { name: 'Mixed', cardIds: ['date-01','date-02','date-03','date-04','date-05',`custom:${uuid}`] } });
  assert.deepEqual(set.card_ids.at(-1), `custom:${uuid}`);
  referenced = true;
  await assert.rejects(() => service.customCard({ ...request(`/api/account/cards/custom:${uuid}`, { method: 'DELETE' }) }, `custom:${uuid}`), (error) => error.status === 409 && error.code === 'CARD_IN_USE');
  assert.ok(calls.some(({ options }) => options.body?.includes('owner-1')));
});

test('custom card account read degrades only when its table is missing', async () => {
  const anonKey = `x.${Buffer.from(JSON.stringify({ role: 'anon' })).toString('base64url')}.x`;
  const base = { env: { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_ANON_KEY: anonKey } };
  const missing = createAccountService({ ...base, fetchImpl: async (url) => {
    if (url.endsWith('/auth/v1/user')) return response(200, { id: 'owner-1' });
    if (url.includes('/custom_cards')) return response(404, { code: 'PGRST205', message: 'custom_cards missing' });
    return response(200, []);
  } });
  const result = await missing.account(request('/api/account'));
  assert.equal(result.customCardsAvailable, false); assert.deepEqual(result.customCards, []);
  const broken = createAccountService({ ...base, fetchImpl: async (url) => url.endsWith('/auth/v1/user') ? response(200, { id: 'owner-1' }) : response(500, { message: 'database down' }) });
  await assert.rejects(() => broken.account(request('/api/account')), (error) => error.status === 502);
});

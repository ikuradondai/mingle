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

test('avatar upload validates JPEG bytes, uses owner storage path, and returns signed URL', async () => {
  const calls = []; const anonKey = `x.${Buffer.from(JSON.stringify({ role: 'anon' })).toString('base64url')}.x`;
  const service = createAccountService({ env: { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_ANON_KEY: anonKey }, fetchImpl: async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/auth/v1/user')) return response(200, { id: 'verified-user', email: 'x@y.test' });
    if (url.includes('/storage/v1/object/sign/')) return response(200, { signedURL: '/object/sign/profile-avatars/verified-user/avatar.jpg?token=test' });
    if (url.includes('/storage/v1/object/profile-avatars')) return response(200, {});
    return response(200, []);
  } });
  const imageData = `data:image/jpeg;base64,${Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0xff, 0xd9]).toString('base64')}`;
  const result = await service.avatar({ ...request('/api/account/avatar', { method: 'PUT', body: { imageData } }), body: { imageData } });
  assert.match(result.avatarUrl, /profile-avatars/); assert.match(result.avatarUrl, /[?&]v=[a-z0-9]+$/);
  const upload = calls.find((call) => call.url.includes('/storage/v1/object/profile-avatars/'));
  assert.equal(upload.options.method, 'POST'); assert.equal(upload.options.headers['Content-Type'], 'image/jpeg'); assert.equal(upload.options.headers['x-upsert'], 'true'); assert.ok(Buffer.isBuffer(upload.options.body));
  const oversized = Buffer.alloc(256 * 1024 + 1); oversized[0] = 0xff; oversized[1] = 0xd8; oversized[2] = 0xff; oversized[oversized.length - 2] = 0xff; oversized[oversized.length - 1] = 0xd9;
  const oversizedData = `data:image/jpeg;base64,${oversized.toString('base64')}`;
  await assert.rejects(() => service.avatar({ ...request('/api/account/avatar', { method: 'PUT', body: { imageData: oversizedData } }), body: { imageData: oversizedData } }), (error) => error.status === 400);
  await assert.rejects(() => service.avatar({ ...request('/api/account/avatar', { method: 'PUT', body: { imageData: 'data:image/jpeg;base64,Zm9vA' } }), body: { imageData: 'data:image/jpeg;base64,Zm9vA' } }), (error) => error.status === 400);
  await assert.rejects(() => service.avatar({ ...request('/api/account/avatar', { method: 'PUT', body: { imageData: 'data:image/jpeg;base64,Zm9v' } }), body: { imageData: 'data:image/jpeg;base64,Zm9v' } }), (error) => error.status === 400);
});

test('avatar deletion tolerates Storage not-found envelopes but surfaces real failures', async () => {
  const anonKey = `x.${Buffer.from(JSON.stringify({ role: 'anon' })).toString('base64url')}.x`;
  const missingService = createAccountService({ env: { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_ANON_KEY: anonKey }, fetchImpl: async (url) => {
    if (url.endsWith('/auth/v1/user')) return response(200, { id: 'verified-user' });
    return response(400, { statusCode: 404 });
  } });
  assert.deepEqual(await missingService.avatar({ ...request('/api/account/avatar', { method: 'DELETE' }), body: undefined }), { deleted: true, avatarUrl: null });
  const failedService = createAccountService({ env: { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_ANON_KEY: anonKey }, fetchImpl: async (url) => {
    if (url.endsWith('/auth/v1/user')) return response(200, { id: 'verified-user' });
    return response(500, { error: 'storage-down' });
  } });
  await assert.rejects(() => failedService.avatar({ ...request('/api/account/avatar', { method: 'DELETE' }), body: undefined }), (error) => error.status === 502);
});

test('avatar auth and body guards do not perform unauthenticated network calls', async () => {
  let calls = 0; const anonKey = `x.${Buffer.from(JSON.stringify({ role: 'anon' })).toString('base64url')}.x`;
  const service = createAccountService({ env: { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_ANON_KEY: anonKey }, fetchImpl: async () => { calls += 1; return response(500, {}); } });
  for (const method of ['GET', 'PUT', 'DELETE']) await assert.rejects(() => service.avatar({ ...request('/api/account/avatar', { method, authorization: '' }), body: method === 'PUT' ? {} : undefined }), (error) => error.status === 401);
  assert.equal(calls, 0);
  const authenticated = createAccountService({ env: { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_ANON_KEY: anonKey }, fetchImpl: async (url) => url.endsWith('/auth/v1/user') ? response(200, { id: 'verified-user' }) : response(400, { statusCode: 404 }) });
  await assert.rejects(() => authenticated.avatar({ ...request('/api/account/avatar', { method: 'PUT', body: { imageData: 'data:image/jpeg;base64,/wAA/w==' , extra: true } }), body: { imageData: 'data:image/jpeg;base64,/wAA/w==', extra: true } }), (error) => error.status === 400);
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

test('favorite validator accepts shipped R18 card ids through the real account service', async () => {
  const calls = []; const anonKey = `x.${Buffer.from(JSON.stringify({ role: 'anon' })).toString('base64url')}.x`;
  const service = createAccountService({ env: { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_ANON_KEY: anonKey }, fetchImpl: async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/auth/v1/user')) return response(200, { id: 'verified-user', email: 'x@y.test' });
    if (url.includes('/favorites?user_id')) return response(200, []);
    if (url.includes('/favorites?on_conflict')) return response(201, null);
    return response(200, []);
  } });
  for (const cardId of ['intimacy-07', 'intimacy-36']) {
    const result = await service.favorite(request(`/api/account/favorites/${cardId}`, { method: 'PUT' }), cardId);
    assert.deepEqual(result, { favorite: true, cardId });
  }
  assert.deepEqual(calls.filter((call) => call.options.method === 'POST').map((call) => JSON.parse(call.options.body).card_id), ['intimacy-07', 'intimacy-36']);
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
  const service = createAccountService({ env: { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_ANON_KEY: anonKey, SUPABASE_SERVICE_ROLE_KEY: 'service-role-secret' }, fetchImpl: async (url, options) => { calls.push({ url, options }); if (url.endsWith('/auth/v1/user')) return response(200, { id: 'verified-user' }); if (url.includes('/storage/v1/object/profile-avatars')) return response(200, {}); return response(500, {}); } });
  await assert.rejects(() => service.removeAccount({ ...request('/api/account', { method: 'DELETE', body: { confirmation: 'DELETE' } }), body: { confirmation: 'DELETE' } }), (error) => error.status === 502);
  assert.deepEqual(calls.map(({ url }) => url), ['https://project.supabase.co/auth/v1/user', 'https://project.supabase.co/storage/v1/object/profile-avatars', 'https://project.supabase.co/auth/v1/admin/users/verified-user']);
  assert.deepEqual(JSON.parse(calls[1].options.body), { prefixes: ['verified-user/avatar.jpg'] });
});

test('account deletion gates Auth admin delete on Storage result', async () => {
  const anonKey = `x.${Buffer.from(JSON.stringify({ role: 'anon' })).toString('base64url')}.x`;
  let failedAdminCalls = 0;
  const failedStorage = createAccountService({ env: { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_ANON_KEY: anonKey, SUPABASE_SERVICE_ROLE_KEY: 'service-role-secret' }, fetchImpl: async (url) => {
    if (url.endsWith('/auth/v1/user')) return response(200, { id: 'verified-user' });
    if (url.includes('/storage/v1/object/profile-avatars')) return response(500, {});
    failedAdminCalls += 1; return response(204, null);
  } });
  await assert.rejects(() => failedStorage.removeAccount({ ...request('/api/account', { method: 'DELETE', body: { confirmation: 'DELETE' } }), body: { confirmation: 'DELETE' } }), (error) => error.status === 502);
  assert.equal(failedAdminCalls, 0);
  let missingAdminCalls = 0;
  const missingStorage = createAccountService({ env: { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_ANON_KEY: anonKey, SUPABASE_SERVICE_ROLE_KEY: 'service-role-secret' }, fetchImpl: async (url) => {
    if (url.endsWith('/auth/v1/user')) return response(200, { id: 'verified-user' });
    if (url.includes('/storage/v1/object/profile-avatars')) return response(400, { statusCode: 404 });
    missingAdminCalls += 1; return response(204, null);
  } });
  assert.deepEqual(await missingStorage.removeAccount({ ...request('/api/account', { method: 'DELETE', body: { confirmation: 'DELETE' } }), body: { confirmation: 'DELETE' } }), { deleted: true });
  assert.equal(missingAdminCalls, 1);
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
    if (url.includes('/my_set_drafts')) return response(404, { code: 'PGRST205', message: 'my_set_drafts missing' });
    return response(200, []);
  } });
  const result = await missing.account(request('/api/account'));
  assert.equal(result.customCardsAvailable, false); assert.deepEqual(result.customCards, []); assert.equal(result.draftsAvailable, false); assert.deepEqual(result.drafts, []);
  const broken = createAccountService({ ...base, fetchImpl: async (url) => url.endsWith('/auth/v1/user') ? response(200, { id: 'owner-1' }) : response(500, { message: 'database down' }) });
  await assert.rejects(() => broken.account(request('/api/account')), (error) => error.status === 502);
});

test('set drafts validate bounded items and owner-scoped source sets', async () => {
  const anonKey = `x.${Buffer.from(JSON.stringify({ role: 'anon' })).toString('base64url')}.x`;
  const calls = [];
  const service = createAccountService({ env: { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_ANON_KEY: anonKey }, fetchImpl: async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith('/auth/v1/user')) return response(200, { id: 'owner-1' });
    if (url.includes('/my_sets')) return response(200, []);
    if (url.includes('/my_set_drafts')) return response(201, [{ id: '11111111-1111-1111-1111-111111111111', source_set_id: null, name: 'Ideas', items: [], updated_at: 'now' }]);
    return response(200, []);
  } });
  const created = await service.draft({ ...request('/api/account/set-drafts', { method: 'POST', body: { name: ' Ideas ', items: [] } }), body: { name: ' Ideas ', items: [] } });
  assert.equal(created.draft.name, 'Ideas'); assert.deepEqual(created.draft.items, []);
  await assert.rejects(() => service.draft({ ...request('/api/account/set-drafts', { method: 'POST', body: { name: 'x', items: [{ kind: 'saved', cardId: 'date-01' }, { kind: 'saved', cardId: 'date-01' }] } }), body: { name: 'x', items: [{ kind: 'saved', cardId: 'date-01' }, { kind: 'saved', cardId: 'date-01' }] } }), (error) => error.status === 400);
  await assert.rejects(() => service.draft({ ...request('/api/account/set-drafts', { method: 'POST', body: { name: 'x', items: [], sourceSetId: '11111111-1111-1111-1111-111111111111' } }), body: { name: 'x', items: [], sourceSetId: '11111111-1111-1111-1111-111111111111' } }), (error) => error.status === 404);
  assert.ok(calls.some((call) => call.url.includes('/my_set_drafts')));
});

test('draft completion keeps the six-card boundary and uses atomic RPC', async () => {
  const anonKey = `x.${Buffer.from(JSON.stringify({ role: 'anon' })).toString('base64url')}.x`;
  const draftRow = { id: '22222222-2222-2222-2222-222222222222', source_set_id: null, name: 'Ready', items: ['date-01','date-02','date-03','date-04','date-05'].map((cardId) => ({ kind: 'saved', cardId })) };
  const calls = [];
  const service = createAccountService({ env: { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_ANON_KEY: anonKey, SUPABASE_SERVICE_ROLE_KEY: 'service-role-test' }, fetchImpl: async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith('/auth/v1/user')) return response(200, { id: 'owner-1' });
    if (url.includes('/my_set_drafts')) return response(200, [draftRow]);
    if (url.includes('/rpc/complete_my_set_draft')) return response(200, { id: 'set-1' });
    if (url.includes('/my_sets')) return response(200, [{ id: 'set-1', name: 'Ready', card_ids: ['date-01','date-02','date-03','date-04','date-05','date-06'] }]);
    return response(200, []);
  } });
  await assert.rejects(() => service.completeDraft(request('/api/account/set-drafts/22222222-2222-2222-2222-222222222222', { method: 'POST' }), '22222222-2222-2222-2222-222222222222'), (error) => error.status === 400);
  draftRow.items.push({ kind: 'saved', cardId: 'date-06' });
  const completed = await service.completeDraft(request('/api/account/set-drafts/22222222-2222-2222-2222-222222222222', { method: 'POST' }), '22222222-2222-2222-2222-222222222222');
  assert.equal(completed.set.id, 'set-1'); assert.ok(calls.some((call) => call.url.includes('/rpc/complete_my_set_draft')));
});

test('AI question generation is optional, strict, and never persists a draft', async () => {
  const anonKey = `x.${Buffer.from(JSON.stringify({ role: 'anon' })).toString('base64url')}.x`;
  let aiRequest;
  const service = createAccountService({ env: { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_ANON_KEY: anonKey, OPENAI_API_KEY: 'openai-test' }, rateLimitImpl: async () => 1, fetchImpl: async (url, options = {}) => {
    if (url.endsWith('/auth/v1/user')) return response(200, { id: 'owner-1' });
    if (url === 'https://api.openai.com/v1/responses') { aiRequest = JSON.parse(options.body); const includeR18 = aiRequest.instructions.includes('成人向けの話題を含めてもよい'); return response(200, { output_text: JSON.stringify({ name: 'AI案', questions: Array.from({ length: 6 }, (_, index) => ({ text: `質問${index}`, r18: includeR18 && index === 0 })) }) }); }
    return response(200, []);
  } });
  const result = await service.aiQuestions({ ...request('/api/account/ai/questions', { method: 'POST', body: { theme: '初対面', tone: '軽い', count: 6 } }), body: { theme: '初対面', tone: '軽い', count: 6 } });
  assert.equal(result.questions.length, 6); assert.equal(result.questions[0].origin, 'ai'); assert.equal(result.questions.every((question) => question.r18 === false), true); assert.equal(aiRequest.store, false); assert.equal(aiRequest.model, 'gpt-5.6-luna'); assert.match(aiRequest.instructions, /成人向けの話題は含めず/);
  const adult = await service.aiQuestions({ ...request('/api/account/ai/questions', { method: 'POST', body: { theme: '初対面', tone: '軽い', count: 6, r18: true } }), body: { theme: '初対面', tone: '軽い', count: 6, r18: true } });
  assert.equal(adult.questions[0].r18, true); assert.equal(adult.questions[1].r18, false); assert.match(aiRequest.instructions, /成人向けの話題を含めてもよい/);
  await assert.rejects(() => service.aiQuestions({ ...request('/api/account/ai/questions', { method: 'POST', body: { theme: 'x', tone: 'y', count: 7 } }), body: { theme: 'x', tone: 'y', count: 7 } }), (error) => error.status === 400);
  await assert.rejects(() => service.aiQuestions({ ...request('/api/account/ai/questions', { method: 'POST', body: { theme: 'x', tone: 'y', count: 6, r18: 'true' } }), body: { theme: 'x', tone: 'y', count: 6, r18: 'true' } }), (error) => error.status === 400);
  const unavailable = createAccountService({ env: { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_ANON_KEY: anonKey }, fetchImpl: async (url) => url.endsWith('/auth/v1/user') ? response(200, { id: 'owner-1' }) : response(200, []) });
  await assert.rejects(() => unavailable.aiQuestions({ ...request('/api/account/ai/questions', { method: 'POST', body: { theme: 'x', tone: 'y', count: 6 } }), body: { theme: 'x', tone: 'y', count: 6 } }), (error) => error.status === 503);
});

test('AI generation fails closed on quota, provider, malformed, R18, and abort results', async () => {
  const anonKey = `x.${Buffer.from(JSON.stringify({ role: 'anon' })).toString('base64url')}.x`;
  const input = { theme: 'x', tone: 'y', count: 6 };
  const make = (rateLimitImpl, fetchImpl) => createAccountService({ env: { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_ANON_KEY: anonKey, OPENAI_API_KEY: 'openai-test' }, rateLimitImpl, fetchImpl: async (url, options) => url.endsWith('/auth/v1/user') ? response(200, { id: 'owner-1' }) : fetchImpl(url, options) });
  await assert.rejects(() => make(async () => ({ minute: 4, daily: 1, minuteLimit: 3, dailyLimit: 30 }), async () => response(200, {})).aiQuestions({ ...request('/api/account/ai/questions', { method: 'POST', body: input }), body: input }), (error) => error.status === 429);
  await assert.rejects(() => make(async () => ({ minute: Number.NaN, daily: 1, minuteLimit: 3, dailyLimit: 30 }), async () => response(200, {})).aiQuestions({ ...request('/api/account/ai/questions', { method: 'POST', body: input }), body: input }), (error) => error.status === 429);
  await assert.rejects(() => make(async () => ({ minute: 1, daily: 1, minuteLimit: 3, dailyLimit: 30 }), async () => response(500, {})).aiQuestions({ ...request('/api/account/ai/questions', { method: 'POST', body: input }), body: input }), (error) => error.status === 503);
  await assert.rejects(() => make(async () => ({ minute: 1, daily: 1, minuteLimit: 3, dailyLimit: 30 }), async () => response(200, { output_text: '{' })).aiQuestions({ ...request('/api/account/ai/questions', { method: 'POST', body: input }), body: input }), (error) => error.status === 503);
  await assert.rejects(() => make(async () => ({ minute: 1, daily: 1, minuteLimit: 3, dailyLimit: 30 }), async () => response(200, { output_text: JSON.stringify({ name: 'x', questions: Array.from({ length: 6 }, () => ({ text: 'q', r18: true })) }) })).aiQuestions({ ...request('/api/account/ai/questions', { method: 'POST', body: input }), body: input }), (error) => error.status === 503);
  let signalSeen; await assert.rejects(() => make(async () => ({ minute: 1, daily: 1, minuteLimit: 3, dailyLimit: 30 }), async (_url, options) => { signalSeen = options.signal; throw new Error('AbortError'); }).aiQuestions({ ...request('/api/account/ai/questions', { method: 'POST', body: input }), body: input }), (error) => error.status === 503); assert.ok(signalSeen);
});

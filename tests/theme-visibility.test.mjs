import test from 'node:test';
import assert from 'node:assert/strict';
import { categoryVisibility, applyCategoryVisibility, applyThemeVisibility, restoreAllThemes, normalizeThemeIds } from '../dist/theme-visibility.js';
import { createAccountService } from '../server-side/accounts.mjs';

test('theme visibility helpers derive shared category state and preserve individual overrides', () => {
  const hidden = new Set(['shared', 'other']);
  assert.deepEqual(categoryVisibility(['shared', 'other'], hidden), { state: 'all', count: 2, total: 2 });
  assert.equal(categoryVisibility(['shared', 'other'], new Set(['shared'])).state, 'some');
  const category = applyCategoryVisibility(new Set(), ['shared', 'other'], true);
  assert.deepEqual([...applyThemeVisibility(category, 'shared', false)].sort(), ['other']);
  assert.deepEqual([...restoreAllThemes()], []);
  assert.deepEqual(normalizeThemeIds(['shared', 'shared', 'unknown'], new Set(['shared'])), ['shared']);
});

function response(status, value) { return new Response(value === undefined ? '' : JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } }); }
const env = { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_public' };
const userId = '11111111-1111-4111-8111-111111111111';
function req(body = {}, method = 'PUT') { return { method, body, headers: { authorization: 'Bearer user-token' } }; }

test('theme visibility API scopes to the verified JWT and rejects duplicate or unknown ids', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith('/auth/v1/user')) return response(200, { id: userId, email: 'a@example.test' });
    if (url.endsWith('/rpc/set_theme_visibility')) return response(200, ['friends']);
    return response(200, []);
  };
  const service = createAccountService({ env, fetchImpl });
  assert.deepEqual(await service.themeVisibility(req({ hiddenThemeIds: ['friends'] })), { hiddenThemeIds: ['friends'] });
  const rpc = calls.find((call) => call.url.endsWith('/rpc/set_theme_visibility'));
  assert.equal(rpc.options.headers.Authorization, 'Bearer user-token');
  assert.deepEqual(JSON.parse(rpc.options.body), { p_hidden_theme_ids: ['friends'] });
  await assert.rejects(() => service.themeVisibility(req({ hiddenThemeIds: ['friends', 'friends'] })), (error) => error.code === 'INVALID_REQUEST');
  await assert.rejects(() => service.themeVisibility(req({ hiddenThemeIds: ['unknown-theme'] })), (error) => error.code === 'INVALID_REQUEST');
  assert.equal(calls.filter((call) => call.url.endsWith('/rpc/set_theme_visibility')).length, 1);
  await assert.rejects(() => service.themeVisibility({ method: 'PUT', body: { hiddenThemeIds: ['friends'] }, headers: {} }), (error) => error.code === 'UNAUTHENTICATED');
});

test('theme visibility API does not report success when the RPC fails', async () => {
  const service = createAccountService({ env, fetchImpl: async (url) => url.endsWith('/auth/v1/user') ? response(200, { id: userId, email: 'a@example.test' }) : response(500, { code: 'PGRST202' }) });
  await assert.rejects(() => service.themeVisibility(req({ hiddenThemeIds: ['friends'] })), (error) => error.code === 'FEATURE_UNAVAILABLE');
});

test('/me distinguishes a loaded empty preference from an unavailable visibility column', async () => {
  const base = async (url) => {
    if (url.endsWith('/auth/v1/user')) return response(200, { id: userId, email: 'a@example.test' });
    if (url.includes('/account_profiles?')) return response(200, [{ hidden_theme_ids: [] }]);
    return response(200, []);
  };
  const loaded = await createAccountService({ env, fetchImpl: base }).account({ headers: { authorization: 'Bearer user-token' } });
  assert.equal(loaded.account.themeVisibilityAvailable, true);
  assert.deepEqual(loaded.account.hiddenThemeIds, []);
  const unavailable = await createAccountService({ env, fetchImpl: async (url) => url.includes('/account_profiles?') ? response(404, { code: 'PGRST205' }) : base(url) }).account({ headers: { authorization: 'Bearer user-token' } });
  assert.equal(unavailable.account.themeVisibilityAvailable, false);
  assert.deepEqual(unavailable.account.hiddenThemeIds, []);
});

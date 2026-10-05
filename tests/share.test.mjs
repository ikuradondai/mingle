import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createAccountService } from '../server-side/accounts.mjs';

const env = { SUPABASE_URL: 'https://share-test.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test' };
const owner = '00000000-0000-0000-0000-000000000001';
const setId = '00000000-0000-4000-8000-000000000001';
const customUuid = '11111111-1111-4111-8111-111111111111';
const token = 'A'.repeat(43);
function req(path, extra = {}) { return { url: `https://mingle.test${path}`, method: 'GET', headers: { authorization: 'Bearer user-token' }, ...extra }; }
function response(status, data) { return { ok: status >= 200 && status < 300, status, async json() { return data; } }; }

test('share snapshots owner set, returns a reusable token, and hides cards from metadata', async () => {
  const calls = [];
  let current = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith('/auth/v1/user')) return response(200, { id: owner, email: 'owner@example.test' });
    if (url.includes('/my_sets?user_id=') && url.includes('id=eq.')) return response(200, [{ id: setId, name: '週末', card_ids: ['date-01', 'date-02', 'date-03', 'date-04', 'date-05', `custom:${customUuid}`] }]);
    if (url.includes('/custom_cards?')) return response(200, [{ id: customUuid, text: 'owner private text', r18: false, created_at: '2026-01-01', updated_at: '2026-01-01' }]);
    if (url.includes('/shared_sets?owner_id=') && options.method !== 'PATCH') return response(200, current);
    if (url.endsWith('/rpc/create_shared_set')) { const body = JSON.parse(options.body); if (!body.p_rotate && current.length) return response(200, current); current = [{ id: 'share-1', token: body.p_token, name: body.p_name, card_count: body.p_card_count, adult_only: body.p_adult_only, cards: body.p_cards }]; return response(200, current); }
    if (url.endsWith('/rpc/revoke_shared_set')) { current = []; return response(200, [true]); }
    throw new Error(`unexpected ${options.method || 'GET'} ${url}`);
  };
  const service = createAccountService({ env, fetchImpl });
  const created = await service.shareSet(req(`/api/account/sets/${setId}/share`, { method: 'POST' }), setId);
  assert.equal(created.share.cardCount, 6);
  assert.equal(created.share.adultOnly, false);
  assert.match(created.share.token, /^[A-Za-z0-9_-]{43}$/);
  const repeated = await service.shareSet(req(`/api/account/sets/${setId}/share`, { method: 'POST' }), setId);
  assert.equal(repeated.share.token, created.share.token);
  const rpcBody = JSON.parse(calls.find((call) => call.url.endsWith('/rpc/create_shared_set')).options.body);
  assert.equal(rpcBody.p_cards.at(-1).id, `custom:${customUuid}`);
  assert.equal(rpcBody.p_cards.at(-1).text, 'owner private text');
  const beforeRead = calls.length;
  const read = await service.shareSet(req(`/api/account/sets/${setId}/share`, { method: 'GET' }), setId);
  assert.equal(read.share.token, created.share.token);
  assert.equal(calls.slice(beforeRead).some((call) => call.options.method === 'PATCH' || call.options.method === 'POST'), false);
  const currentQuery = calls.find((call) => call.url.includes('/shared_sets?owner_id=') && call.url.includes('limit=1'));
  assert.ok(currentQuery);
  const stopped = await service.stopShare(req(`/api/account/sets/${setId}/share`, { method: 'DELETE' }), setId);
  assert.equal(stopped.revoked, true);
});

test('public share metadata omits question content and start requires consent for adult snapshots', async () => {
  let confirmed = false;
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.includes('/shared_sets?token_hash=') && url.includes('select=name,card_count,adult_only,cards')) return response(200, [{ name: '大人', card_count: 6, adult_only: true, cards: [{ id: 'intimacy-01', text: 'private text', r18: true }] }]);
    if (url.endsWith('/auth/v1/user')) return response(200, { id: 'guest-account' });
    if (url.includes('/account_profiles?')) return response(200, confirmed ? [{ adult_confirmed_at: '2026-10-05T09:12:00+00:00' }] : []);
    throw new Error(`unexpected ${url}`);
  };
  const service = createAccountService({ env: { ...env, SUPABASE_SERVICE_ROLE_KEY: 'service-role-test' }, fetchImpl });
  const hidden = { name: null, cardCount: null, adultOnly: true, active: true, ageConfirmationRequired: true };
  const metadata = await service.publicShare(req(`/api/share/${token}`), token, false);
  assert.deepEqual(metadata.share, hidden);
  await assert.rejects(() => service.publicShare(req(`/api/share/${token}/start`, { method: 'POST', headers: { authorization: '' }, body: { participants: ['A', 'B'], adultConfirmed: true } }), token, true), (error) => error.status === 401 && error.code === 'UNAUTHENTICATED');
  await assert.rejects(() => service.publicShare(req(`/api/share/${token}/start`, { method: 'POST', headers: { authorization: 'Bearer user-token' }, body: { participants: ['A', 'B'], adultConfirmed: true } }), token, true), (error) => error.status === 403 && error.code === 'AGE_CONFIRMATION_REQUIRED');
  confirmed = true;
  assert.deepEqual((await service.publicShare(req(`/api/share/${token}`), token, false)).share, { name: '大人', cardCount: 6, adultOnly: true, active: true, ageConfirmationRequired: false });
  assert.deepEqual((await service.publicShare(req(`/api/share/${token}`, { headers: {} }), token, false)).share, hidden);
  await assert.rejects(() => service.publicShare(req(`/api/share/${token}/start`, { method: 'POST', headers: { authorization: 'Bearer user-token' }, body: { participants: ['A', 'B'], adultConfirmed: false } }), token, true), (error) => error.status === 403 && error.code === 'ADULT_CONSENT_REQUIRED');
  const started = await service.publicShare(req(`/api/share/${token}/start`, { method: 'POST', headers: { authorization: 'Bearer user-token' }, body: { participants: ['A', 'B'], adultConfirmed: true } }), token, true);
  assert.equal(started.cards[0].text, 'private text');
  assert.equal(calls.every((call) => !call.url.includes('token=')), true);
});

test('non-adult public share starts for an unauthenticated guest', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.includes('/shared_sets?token_hash=') && url.includes('select=name,card_count,adult_only,cards')) return response(200, [{ name: 'はじめまして', card_count: 6, adult_only: false, cards: [{ id: 'date-01', text: 'guest-safe question', r18: false }] }]);
    if (url.endsWith('/auth/v1/user')) throw new Error('unauthenticated guest must not call auth');
    throw new Error(`unexpected ${url}`);
  };
  const service = createAccountService({ env: { ...env, SUPABASE_SERVICE_ROLE_KEY: 'service-role-test' }, fetchImpl });
  const started = await service.publicShare(req(`/api/share/${token}/start`, { method: 'POST', headers: {}, body: { participants: ['A', 'B'], adultConfirmed: false } }), token, true);
  assert.equal(started.cards[0].text, 'guest-safe question');
  assert.equal(started.participants[0], 'A');
  assert.equal(calls.some((call) => call.url.endsWith('/auth/v1/user')), false);
});

test('public share lookup is unavailable without the server-only key', async () => {
  const service = createAccountService({ env, fetchImpl: async () => { throw new Error('must not call REST'); } });
  await assert.rejects(() => service.publicShare(req(`/api/share/${token}`), token, false), (error) => error.status === 503 && error.code === 'SHARE_UNAVAILABLE');
});

test('unknown share token is not disclosed', async () => {
  const service = createAccountService({ env: { ...env, SUPABASE_SERVICE_ROLE_KEY: 'service-role-test' }, fetchImpl: async () => response(200, []) });
  await assert.rejects(() => service.publicShare(req(`/api/share/${'B'.repeat(43)}`), 'B'.repeat(43), false), (error) => error.status === 404 && error.code === 'NOT_FOUND');
  await assert.rejects(() => service.publicShare(req('/api/share/short'), 'short', false), (error) => error.status === 404 && error.code === 'NOT_FOUND');
});

test('rotation RPC failure leaves the existing link available to owner', async () => {
  const oldToken = 'C'.repeat(43);
  let rotateAttempted = false;
  const fetchImpl = async (url, options = {}) => {
    if (url.endsWith('/auth/v1/user')) return response(200, { id: owner, email: 'owner@example.test' });
    if (url.includes('/my_sets?user_id=') && url.includes('id=eq.')) return response(200, [{ id: setId, name: '週末', card_ids: ['date-01', 'date-02', 'date-03', 'date-04', 'date-05', 'date-06'] }]);
    if (url.includes('/custom_cards?')) return response(200, []);
    if (url.includes('/shared_sets?owner_id=') && options.method !== 'PATCH') return response(200, [{ id: 'share-1', token: oldToken, name: '週末', card_count: 6, adult_only: false }]);
    if (url.endsWith('/rpc/create_shared_set')) { rotateAttempted = JSON.parse(options.body).p_rotate; return response(500, { code: 'TX_FAILED' }); }
    throw new Error(`unexpected ${url}`);
  };
  const service = createAccountService({ env, fetchImpl });
  await assert.rejects(() => service.shareSet(req(`/api/account/sets/${setId}/share`, { method: 'PUT' }), setId), (error) => error.status === 502);
  assert.equal(rotateAttempted, true);
  const current = await service.shareSet(req(`/api/account/sets/${setId}/share`, { method: 'GET' }), setId);
  assert.equal(current.share.token, oldToken);
});

test('share migration does not grant anonymous table reads and binds inserts to owned sets', async () => {
  const sql = await readFile(fileURLToPath(new URL('../supabase/migrations/202610040001_shared_sets.sql', import.meta.url)), 'utf8');
  assert.match(sql, /drop policy if exists shared_sets_public_read/);
  assert.doesNotMatch(sql, /grant\s+select[^;]*\s+to\s+anon/i);
  assert.match(sql, /auth\.uid\(\)\s*=\s*owner_id\s+and\s+exists\s*\(select 1 from public\.my_sets/i);
  assert.match(sql, /shared_sets_one_active_per_set_idx/);
});

test('adult share metadata stays hidden for an invalid Bearer, a failed profile read, and a missing profile table', async () => {
  const shareRow = { name: '大人', card_count: 6, adult_only: true, cards: [{ id: 'intimacy-01', text: 'private text', r18: true }] };
  const hidden = { name: null, cardCount: null, adultOnly: true, active: true, ageConfirmationRequired: true };
  const make = (profile) => createAccountService({ env: { ...env, SUPABASE_SERVICE_ROLE_KEY: 'service-role-test' }, fetchImpl: async (url, options = {}) => {
    if (url.includes('/shared_sets?token_hash=')) return response(200, [shareRow]);
    if (url.endsWith('/auth/v1/user')) return options.headers.Authorization === 'Bearer good' ? response(200, { id: owner }) : response(401, { message: 'bad jwt' });
    if (url.includes('/account_profiles?')) { assert.equal(options.headers.Authorization, 'Bearer service-role-test'); return profile(); }
    throw new Error(`unexpected ${url}`);
  } });
  const withBearer = (value) => req(`/api/share/${token}`, { headers: { authorization: value } });
  const confirmedProfile = () => response(200, [{ adult_confirmed_at: '2026-10-05T09:12:00+00:00' }]);
  assert.deepEqual((await make(confirmedProfile).publicShare(withBearer('Bearer bad'), token, false)).share, hidden);
  assert.deepEqual((await make(() => response(500, { message: 'down' })).publicShare(withBearer('Bearer good'), token, false)).share, hidden);
  assert.deepEqual((await make(() => response(404, { code: 'PGRST205', message: 'account_profiles missing' })).publicShare(withBearer('Bearer good'), token, false)).share, hidden);
  assert.equal((await make(confirmedProfile).publicShare(withBearer('Bearer good'), token, false)).share.name, '大人');
  await assert.rejects(() => make(() => response(404, { code: 'PGRST205', message: 'account_profiles missing' })).publicShare(req(`/api/share/${token}/start`, { method: 'POST', headers: { authorization: 'Bearer good' }, body: { participants: ['A', 'B'], adultConfirmed: true } }), token, true), (error) => error.status === 403 && error.code === 'AGE_CONFIRMATION_REQUIRED');
});

test('non-adult share metadata is unchanged for guests and never calls auth', async () => {
  const fetchImpl = async (url) => {
    if (url.includes('/shared_sets?token_hash=')) return response(200, [{ name: '通常', card_count: 12, adult_only: false, cards: [] }]);
    throw new Error(`unexpected ${url}`);
  };
  const service = createAccountService({ env: { ...env, SUPABASE_SERVICE_ROLE_KEY: 'service-role-test' }, fetchImpl });
  for (const headers of [{}, { authorization: 'Bearer user-token' }]) {
    assert.deepEqual((await service.publicShare(req(`/api/share/${token}`, { headers }), token, false)).share, { name: '通常', cardCount: 12, adultOnly: false, active: true, ageConfirmationRequired: false });
  }
});

test('sharing a set with R18 cards needs an age-confirmed owner (issue and rotate), plain sets do not', async () => {
  let confirmed = false;
  const fetchImpl = async (url, options = {}) => {
    if (url.endsWith('/auth/v1/user')) return response(200, { id: owner, email: 'owner@example.test' });
    if (url.includes('/account_profiles?')) { assert.equal(options.headers.Authorization, 'Bearer user-token'); return response(200, confirmed ? [{ adult_confirmed_at: '2026-10-05T09:12:00+00:00' }] : []); }
    if (url.includes('/my_sets?user_id=') && url.includes('id=eq.')) return response(200, [{ id: setId, name: '大人', card_ids: ['intimacy-01', 'intimacy-02', 'intimacy-03', 'intimacy-04', 'intimacy-05', 'intimacy-06'] }]);
    if (url.includes('/custom_cards?')) return response(200, []);
    if (url.includes('/shared_sets?owner_id=')) return response(200, []);
    if (url.endsWith('/rpc/create_shared_set')) { const body = JSON.parse(options.body); return response(200, [{ id: 'share-1', token: body.p_token, name: body.p_name, card_count: body.p_card_count, adult_only: body.p_adult_only }]); }
    throw new Error(`unexpected ${options.method || 'GET'} ${url}`);
  };
  const service = createAccountService({ env, fetchImpl });
  for (const method of ['POST', 'PUT']) await assert.rejects(() => service.shareSet(req(`/api/account/sets/${setId}/share`, { method }), setId), (error) => error.status === 403 && error.code === 'AGE_CONFIRMATION_REQUIRED', method);
  assert.equal((await service.shareSet(req(`/api/account/sets/${setId}/share`, { method: 'GET' }), setId)).share, null);
  confirmed = true;
  const created = await service.shareSet(req(`/api/account/sets/${setId}/share`, { method: 'POST' }), setId);
  assert.equal(created.share.adultOnly, true);
  const rotated = await service.shareSet(req(`/api/account/sets/${setId}/share`, { method: 'PUT' }), setId);
  assert.equal(rotated.share.adultOnly, true);
});

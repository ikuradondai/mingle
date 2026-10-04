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
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.includes('/shared_sets?token_hash=') && url.includes('select=name,card_count,adult_only,cards')) return response(200, [{ name: '大人', card_count: 6, adult_only: true, cards: [{ id: 'intimacy-01', text: 'private text', r18: true }] }]);
    if (url.endsWith('/auth/v1/user')) return response(200, { id: 'guest-account' });
    throw new Error(`unexpected ${url}`);
  };
  const service = createAccountService({ env: { ...env, SUPABASE_SERVICE_ROLE_KEY: 'service-role-test' }, fetchImpl });
  const metadata = await service.publicShare(req(`/api/share/${token}`), token, false);
  assert.deepEqual(metadata.share, { name: '大人', cardCount: 6, adultOnly: true, active: true });
  await assert.rejects(() => service.publicShare(req(`/api/share/${token}/start`, { method: 'POST', headers: { authorization: '' }, body: { participants: ['A', 'B'], adultConfirmed: true } }), token, true), (error) => error.status === 401 && error.code === 'UNAUTHENTICATED');
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

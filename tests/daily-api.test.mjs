import test from 'node:test';
import assert from 'node:assert/strict';
import { createDailyApi } from '../server-side/daily-api.mjs';
import { createDailyScheduler, cronSecretMatches } from '../server-side/daily-line-scheduler.mjs';

const userId = '11111111-1111-4111-8111-111111111111';
const env = { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test', SUPABASE_SERVICE_ROLE_KEY: 'service-test', LINE_CHANNEL_SECRET: 'secret', LINE_CHANNEL_ACCESS_TOKEN: 'token', LINE_DELIVERY_ENABLED: 'false' };
const req = { headers: { authorization: 'Bearer user-token' } };

test('daily API authenticates, validates a safe builtin group and redacts member identities', async () => {
  const calls = [];
  const api = createDailyApi({ env, fetchImpl: async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith('/auth/v1/user')) return new Response(JSON.stringify({ id: userId, is_anonymous: false }), { status: 200 });
    if (url.includes('/rpc/persistent_group_create')) return new Response(JSON.stringify({ id: '22222222-2222-4222-8222-222222222222', name: '毎日', source_deck_id: 'friends', source_deck_name: '友だち', timezone: 'Asia/Tokyo', delivery_time: '09:00', status: 'active' }), { status: 200 });
    throw new Error(`unexpected ${url}`);
  } });
  const current = await api.user(req);
  const group = await api.create(current, { name: '毎日', sourceDeckId: 'friends', timezone: 'Asia/Tokyo', deliveryTime: '09:00' });
  assert.equal(group.sourceDeckId, 'friends');
  assert.equal(calls.some((call) => JSON.stringify(call.options.body || '').includes('challenge')), false);
  await assert.rejects(() => api.create(current, { name: '', sourceDeckId: 'date' }), /INVALID_REQUEST/);
});

test('cron secret comparison is length-safe and scheduler stays disabled without explicit flag', async () => {
  assert.equal(cronSecretMatches('cron-secret', 'cron-secret'), true);
  assert.equal(cronSecretMatches('cron-secret', 'wrong'), false);
  const scheduler = createDailyScheduler({ env: { ...env, LINE_DELIVERY_ENABLED: 'false' }, fetchImpl: async () => { throw new Error('must not fetch'); } });
  assert.deepEqual(await scheduler.run(), { enabled: false, prepared: 0, dispatched: 0 });
});

test('scheduler drains ready rows and continues after per-group and per-delivery failures', async () => {
  const deliveryCalls = [];
  const service = {
    prepareAndAdvance: async ({ groupId }) => {
      if (groupId.startsWith('bad')) throw Object.assign(new Error('source'), { code: 'DAILY_SOURCE_UNAVAILABLE' });
      return { id: 'q-1' };
    },
    listReady: async () => [{ id: 'bad-delivery' }, { id: 'good-delivery' }],
    dispatch: async (id) => {
      deliveryCalls.push(id);
      if (id === 'bad-delivery') throw Object.assign(new Error('network'), { code: 'DAILY_LINE_UNAVAILABLE' });
      return { claimed: true };
    }
  };
  const groups = [
    { id: 'bad-group', source_deck_id: 'friends', timezone: 'Asia/Tokyo', next_run_at: '2026-10-06T00:00:00Z' },
    { id: 'good-group', source_deck_id: 'friends', timezone: 'Asia/Tokyo', next_run_at: '2026-10-06T00:00:00Z' }
  ];
  const scheduler = createDailyScheduler({
    env: { ...env, LINE_DELIVERY_ENABLED: 'true' },
    now: () => new Date('2026-10-06T01:00:00Z'), service,
    fetchImpl: async (url) => {
      if (url.includes('/persistent_groups?')) return new Response(JSON.stringify(groups), { status: 200 });
      if (url.includes('/daily_questions?')) return new Response('[]', { status: 200 });
      throw new Error(`unexpected ${url}`);
    }
  });
  const result = await scheduler.run();
  assert.equal(result.prepared, 1);
  assert.equal(result.dispatched, 1);
  assert.deepEqual(deliveryCalls, ['bad-delivery', 'good-delivery']);
  assert.equal(result.errors.length, 2);
});

test('daily metadata routes use locked edit semantics and strict status/date validation', async () => {
  const calls = [];
  const groupId = '22222222-2222-4222-8222-222222222222';
  const api = createDailyApi({ env, fetchImpl: async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith('/auth/v1/user')) return new Response(JSON.stringify({ id: userId, is_anonymous: false }), { status: 200 });
    if (url.includes('/rpc/persistent_group_edit')) return new Response(JSON.stringify({ id: groupId, name: '更新', source_deck_id: 'friends', source_deck_name: '友だち', timezone: 'Asia/Tokyo', delivery_time: '10:00', status: 'active' }), { status: 200 });
    if (url.includes('/line_account_links?')) return new Response(JSON.stringify([{ status: 'blocked', delivery_paused: false }]), { status: 200 });
    if (url.includes('/persistent_groups?id=eq.')) return new Response(JSON.stringify([{ id: groupId, owner_user_id: userId, name: '更新', source_deck_id: 'friends', source_deck_name: '友だち', timezone: 'Asia/Tokyo', delivery_time: '10:00', status: 'active' }]), { status: 200 });
    if (url.includes('/persistent_group_members?')) return new Response(JSON.stringify([{ id: 'member-row', user_id: userId, display_name: '代表', role: 'owner', status: 'active', line_opt_in: true }]), { status: 200 });
    throw new Error(`unexpected ${url}`);
  } });
  const current = await api.user(req);
  const edited = await api.edit(current, groupId, { name: '更新', sourceDeckId: 'friends', deliveryTime: '10:00' });
  assert.equal(edited.name, '更新');
  assert.equal(calls.some((call) => call.options.method === 'PATCH'), false);
  assert.equal(calls.some((call) => String(call.options.body).includes('persistent_group_edit') || call.url.includes('/rpc/persistent_group_edit')), true);
  assert.equal((await api.lineStatus(current)).linked, false);
  await assert.rejects(() => api.globalLinePause(current, 'false'), /INVALID_REQUEST/);
  await assert.rejects(() => api.history(current, groupId, '2026-02-30'), /INVALID_REQUEST/);
});

test('readiness requires the settings row and only accepts official HTTPS LINE URLs', async () => {
  const api = createDailyApi({ env: { ...env, LINE_CHANNEL_SECRET: 'secret', LINE_CHANNEL_ACCESS_TOKEN: 'token', LINE_OFFICIAL_FRIEND_URL: 'https://lin.ee/mingle' }, fetchImpl: async (url) => {
    if (url.includes('/rest/v1/line_delivery_settings')) return new Response(JSON.stringify([{ enabled: true }]), { status: 200 });
    throw new Error(`unexpected ${url}`);
  } });
  const result = await api.readiness();
  assert.equal(result.configured, true);
  assert.equal(result.lineConfigured, true);
  assert.equal(result.deliveryEnabled, false);
  assert.match(result.officialFriendUrl, /^https:\/\/lin\.ee\//);
});

test('known PostgREST domain messages are mapped without exposing internals', async () => {
  const groupId = '22222222-2222-4222-8222-222222222222';
  const api = createDailyApi({ env, fetchImpl: async (url) => {
    if (url.endsWith('/auth/v1/user')) return new Response(JSON.stringify({ id: userId, is_anonymous: false }), { status: 200 });
    if (url.includes('/persistent_groups?id=eq.')) return new Response(JSON.stringify([{ id: groupId, owner_user_id: userId, name: 'x', source_deck_id: 'friends', source_deck_name: '友だち', timezone: 'Asia/Tokyo', delivery_time: '09:00', status: 'active' }]), { status: 200 });
    if (url.includes('/persistent_group_members?')) return new Response(JSON.stringify([{ id: 'member-row', user_id: userId, display_name: '代表', role: 'owner', status: 'active', line_opt_in: true }]), { status: 200 });
    if (url.includes('/daily_questions?')) return new Response(JSON.stringify({ code: 'P0001', message: 'FORBIDDEN', hint: 'internal detail' }), { status: 400 });
    throw new Error(`unexpected ${url}`);
  } });
  const current = await api.user(req);
  await assert.rejects(() => api.history(current, groupId), (error) => error.code === 'FORBIDDEN' && error.status === 403);
});

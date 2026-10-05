import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createVenueService } from '../server-side/venues.mjs';

const owner = '00000000-0000-0000-0000-000000000001';
const id = '00000000-0000-4000-8000-000000000011';
const env = { SUPABASE_URL: 'https://venue-onboarding.test', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test', SUPABASE_SERVICE_ROLE_KEY: 'service_role_test' };
const response = (status, body) => ({ ok: status >= 200 && status < 300, status, async json() { return body; } });
const request = (body = {}) => ({ url: 'https://mingle.cards/api/venue', method: 'POST', headers: { authorization: 'Bearer owner-token' }, body });

test('venue onboarding migration adds bounded private fields', async () => {
  const sql = await readFile(new URL('../supabase/migrations/202610100003_venue_onboarding.sql', import.meta.url), 'utf8');
  assert.match(sql, /add column if not exists industry text/i);
  assert.match(sql, /add column if not exists address text/i);
  assert.match(sql, /char_length\(industry\) <= 80/i);
  assert.match(sql, /char_length\(address\) <= 240/i);
});

test('venue owner projection retains private fields while public projection excludes them', async () => {
  const calls = [];
  const row = { id, owner_id: owner, name: '店', industry: 'バー', address: '管理用住所', logo_url: null, store_url: null, ending_url: null, welcome_text: '歓迎', adult_enabled: false };
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith('/auth/v1/user')) return response(200, { id: owner });
    if (url.endsWith('/rest/v1/venues')) return response(201, [row]);
    throw new Error(`unexpected ${url}`);
  };
  const service = createVenueService({ env, fetchImpl });
  const created = await service.create(request({ name: '店', industry: 'バー', address: '管理用住所', welcomeText: '歓迎' }));
  assert.equal(created.venue.industry, 'バー');
  assert.equal(created.venue.address, '管理用住所');
  assert.equal(calls.find((call) => call.url.endsWith('/rest/v1/venues')).options.headers.Authorization, 'Bearer owner-token');

  const publicCalls = [];
  const publicFetch = async (url) => {
    publicCalls.push(url);
    if (url.includes('/venue_tables?token_hash=')) return response(200, [{ id: 'table', label: 'A', venue_id: id, venues: row }]);
    if (url.includes('/venue_sets?venue_id=')) return response(200, []);
    throw new Error(`unexpected ${url}`);
  };
  const publicService = createVenueService({ env, fetchImpl: publicFetch });
  const info = await publicService.publicInfo({ url: 'https://mingle.cards/api/venue/public/token', method: 'GET', headers: {} }, 'A'.repeat(32), false);
  assert.equal(Object.hasOwn(info.venue, 'industry'), false);
  assert.equal(Object.hasOwn(info.venue, 'address'), false);
});

test('invalid overlong private field is rejected before persistence', async () => {
  let persisted = false;
  const fetchImpl = async (url) => {
    if (url.endsWith('/auth/v1/user')) return response(200, { id: owner });
    persisted = true;
    return response(201, []);
  };
  const service = createVenueService({ env, fetchImpl });
  await assert.rejects(() => service.create(request({ name: '店', address: 'あ'.repeat(241) })), (error) => error.code === 'INVALID_REQUEST');
  assert.equal(persisted, false);
});

test('venue update returns private fields and omitted URLs remain untouched in payload', async () => {
  const calls = [];
  const row = { id, owner_id: owner, name: '店', industry: 'ホテル', address: '住所', logo_url: 'https://img.test/logo.png', store_url: 'https://store.test', ending_url: 'https://end.test', welcome_text: '歓迎', adult_enabled: true, adult_attested_at: '2026-10-01T00:00:00Z' };
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith('/auth/v1/user')) return response(200, { id: owner });
    if (url.includes(`/venues?id=eq.${id}`) && options.method === 'PATCH') return response(200, [{ ...row, name: '更新店' }]);
    if (url.includes(`/venues?id=eq.${id}`)) return response(200, [row]);
    throw new Error(`unexpected ${url}`);
  };
  const service = createVenueService({ env, fetchImpl });
  const result = await service.update({ ...request(), method: 'PATCH', body: { name: '更新店', industry: 'ホテル', address: '住所' } }, id);
  assert.equal(result.venue.industry, 'ホテル');
  assert.equal(result.venue.address, '住所');
  const patch = calls.find((call) => call.options.method === 'PATCH');
  const payload = JSON.parse(patch.options.body);
  assert.deepEqual(Object.keys(payload).sort(), ['address', 'industry', 'name']);
  assert.equal(payload.storeUrl, undefined);
  assert.equal(payload.endingUrl, undefined);
});

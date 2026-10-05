import test from 'node:test';
import assert from 'node:assert/strict';
import { createMarketplaceService } from '../server-side/marketplace.mjs';

const anonKey = `x.${Buffer.from(JSON.stringify({ role: 'anon' })).toString('base64url')}.x`;
const env = { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_ANON_KEY: anonKey, SUPABASE_SERVICE_ROLE_KEY: 'service-role-test' };
const req = (path, body = undefined) => ({ url: path, method: body ? 'POST' : 'GET', headers: { authorization: 'Bearer user-token' }, body });
const response = (status, data) => ({ ok: status >= 200 && status < 300, status, async json() { return data; } });

test('marketplace publish validates verified owner, source metadata, and uses service RPC', async () => {
  const calls = [];
  const service = createMarketplaceService({ env, fetchImpl: async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith('/auth/v1/user')) return response(200, { id: '00000000-0000-4000-8000-000000000001' });
    if (url.includes('/rest/v1/my_sets')) return response(200, [{ id: '00000000-0000-4000-8000-000000000010', audience: 'group', question_order: 'shuffle', card_ids: ['date-01','date-02','date-03','date-04','date-05','date-06'] }]);
    if (url.includes('/rest/v1/rpc/marketplace_publish')) return response(200, { listingId: '00000000-0000-4000-8000-000000000099', version: 1 });
    return response(200, []);
  } });
  const result = await service.publish({ ...req('/api/marketplace/publish', { setId: '00000000-0000-4000-8000-000000000010', name: '公開', description: '', category: 'relationship', publisherName: '匿名', audience: 'group', questionOrder: 'shuffle' }) });
  assert.equal(result.version, 1);
  const rpc = calls.find((x) => x.url.includes('marketplace_publish'));
  assert.match(rpc.options.headers.Authorization, /^Bearer service-role-test$/);
  assert.deepEqual(JSON.parse(rpc.options.body).p_cards.map((x) => x.id), ['date-01','date-02','date-03','date-04','date-05','date-06']);
});

test('marketplace requires service role for sensitive operations', async () => {
  const noService = createMarketplaceService({ env: { ...env, SUPABASE_SERVICE_ROLE_KEY: '' }, fetchImpl: async (url) => url.endsWith('/auth/v1/user') ? response(200, { id: '00000000-0000-4000-8000-000000000001' }) : response(200, []) });
  await assert.rejects(() => noService.publish({ ...req('/api/marketplace/publish', { setId: '00000000-0000-4000-8000-000000000010', name: '公開', category: 'self', publisherName: '匿名', audience: 'group', questionOrder: 'shuffle' }) }), (e) => e.status === 503 && e.code === 'FEATURE_UNAVAILABLE');
});

test('missing marketplace RPC maps PGRST202 and 404 to unavailable', async () => {
  const missing = createMarketplaceService({ env, fetchImpl: async (url) => {
    if (url.endsWith('/auth/v1/user')) return response(200, { id: '00000000-0000-4000-8000-000000000001' });
    return response(404, { code: 'PGRST202', message: 'function does not exist' });
  } });
  await assert.rejects(() => missing.ownerList({ ...req('/api/marketplace/owner') }), (e) => e.status === 503 && e.code === 'FEATURE_UNAVAILABLE');
});

test('adult import does not trust redacted detail and forwards explicit display intent to RPC', async () => {
  const calls = [];
  const service = createMarketplaceService({ env, fetchImpl: async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith('/auth/v1/user')) return response(200, { id: '00000000-0000-4000-8000-000000000002' });
    if (url.includes('/rest/v1/rpc/marketplace_import')) return response(403, { code: 'AGE_CONFIRMATION_REQUIRED' });
    throw new Error(`unexpected request ${url}`);
  } });
  await assert.rejects(() => service.importSet({ ...req('/api/marketplace/import', { listingId: '00000000-0000-4000-8000-000000000099', showR18: false }) }), (e) => e.status === 403);
  const rpc = calls.find((x) => x.url.includes('marketplace_import')); assert.ok(rpc); assert.equal(JSON.parse(rpc.options.body).p_allow_adult, false); assert.equal(calls.some((x) => x.url.includes('marketplace_detail')), false);
});

test('authenticated non-adult detail forwards owner flags without adult access', async () => {
  const calls = [];
  const service = createMarketplaceService({ env, fetchImpl: async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith('/auth/v1/user')) return response(200, { id: '00000000-0000-4000-8000-000000000002' });
    if (url.includes('/rest/v1/rpc/marketplace_detail')) return response(200, { id: '00000000-0000-4000-8000-000000000099', adult: false });
    return response(200, []);
  } });
  const result = await service.detail({ ...req('/api/marketplace/00000000-0000-4000-8000-000000000099') }, '00000000-0000-4000-8000-000000000099');
  assert.equal(result.adult, false); const detail = calls.find((x) => x.url.includes('marketplace_detail')); assert.match(detail.url, /p_user_id=00000000-0000-4000-8000-000000000002/); assert.match(detail.url, /p_allow_adult=false/);
});

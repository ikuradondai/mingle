import test from 'node:test';
import assert from 'node:assert/strict';
import handlerDefault from '../api/business/[...path].js';
import { createBusinessHandler } from '../api/business.js';
import { createBusinessService } from '../server-side/business.mjs';

const org = '11111111-1111-4111-8111-111111111111';
const auth = { authorization: 'Bearer verified' };
const env = { SUPABASE_URL: 'https://business.test', SUPABASE_ANON_KEY: 'sb_publishable_test', SUPABASE_SERVICE_ROLE_KEY: 'service-key' };
const noopRate = async () => 0;

function response() { return { status: null, body: '', writeHead(status) { this.status = status; }, end(body) { this.body = body || ''; } }; }
function request(method, url, headers = {}, body) { return { method, url, headers: { ...auth, ...headers }, ...(body === undefined ? {} : { body }) }; }
function csvRequest(value) { return { ...request('POST', `/api/business/organizations/${org}/members/import`, { 'content-type': 'text/csv' }), async *[Symbol.asyncIterator]() { yield Buffer.isBuffer(value) ? value : Buffer.from(value); } }; }
function fakeFetch(url, options = {}) {
  const path = new URL(url).pathname;
  if (path === '/auth/v1/user') return Promise.resolve(new Response(JSON.stringify({ id: '22222222-2222-4222-8222-222222222222', email: 'employee@example.test', email_confirmed_at: '2026-01-01' })));
  if (path.includes('/rpc/')) {
    const name = path.split('/').at(-1); const payload = JSON.parse(options.body || '{}');
    if (name === 'org_workspace') return Promise.resolve(new Response(JSON.stringify({ role: 'member', allowedThemeIds: ['team'], featureFlags: { group_play: true, solo_play: true, theme_mix: false, audio: true, theme_tags: true } })));
    if (name === 'org_import_members') { assert.deepEqual(Object.keys(payload), ['p_actor', 'p_org', 'p_rows']); assert.equal(Object.keys(payload.p_rows[0]).sort().join(','), 'department,display_name,email'); return Promise.resolve(new Response(JSON.stringify({ created: payload.p_rows.length, skipped: 0 })));
    }
    return Promise.resolve(new Response(JSON.stringify({ created: 1, skipped: 0 })));
  }
  return Promise.resolve(new Response('{}'));
}

function makeHandler(rate = noopRate) { return createBusinessHandler({ service: createBusinessService({ env, fetchImpl: fakeFetch, rateImpl: noopRate }), rate }); }

test('catchall default export exists and routing errors are stable', async () => {
  assert.equal(typeof handlerDefault, 'function');
  const handler = makeHandler();
  const unknown = response(); await handler(request('GET', '/api/business/unknown', {}), unknown); assert.equal(unknown.status, 404);
  const wrong = response(); await handler(request('PATCH', '/api/business/organizations', {}, {}), wrong); assert.equal(wrong.status, 405);
  const cross = response(); await handler({ method: 'GET', url: '/api/business/organizations', headers: { origin: 'https://evil.example', host: 'localhost' } }, cross); assert.equal(cross.status, 403);
  const deleteWrong = response(); await handler(request('GET', `/api/business/organizations/${org}`, {}), deleteWrong); assert.equal(deleteWrong.status, 405);
});

test('JSON and BOM quoted CSV imports succeed through real handler and service', async () => {
  const handler = makeHandler(); const json = response();
  await handler(request('POST', `/api/business/organizations/${org}/members/import`, { 'content-type': 'application/json' }, { rows: [{ email: 'a@example.test', display_name: 'A', department: '' }] }), json); assert.equal(json.status, 201);
  const csv = response(); await handler(csvRequest('\uFEFFemail,display_name,department\n"b@example.test","B, Team","Sales"\n'), csv); assert.equal(csv.status, 201);
});

test('strict CSV failures return 400', async () => {
  const handler = makeHandler();
  const values = ['', 'email,display_name,department\n', 'email,display_name,department\na@example.test,"A,Sales\n', 'email,display_name,department\na@example.test,A,Sales"\n', 'email,display_name,department\n"a@example.test"x,A,Sales\n', 'email,display_name,department\na@example.test,A\n', 'email,display_name,department\na@example.test,A,Sales,extra\n'];
  for (const value of values) { const result = response(); await handler(csvRequest(value), result); assert.equal(result.status, 400, value); }
  const invalid = response(); await handler(csvRequest(new Uint8Array([0xc3, 0x28])), invalid); assert.equal(invalid.status, 400);
});

test('CSV row, duplicate, JSON shape, and body limits are enforced', async () => {
  const handler = makeHandler(); const row = (i) => ({ email: `x${i}@example.test`, display_name: `X${i}`, department: '' });
  const good = response(); await handler(request('POST', `/api/business/organizations/${org}/members/import`, { 'content-type': 'application/json' }, { rows: Array.from({ length: 500 }, (_, i) => row(i)) }), good); assert.equal(good.status, 201);
  const tooMany = response(); await handler(request('POST', `/api/business/organizations/${org}/members/import`, { 'content-type': 'application/json' }, { rows: Array.from({ length: 501 }, (_, i) => row(i)) }), tooMany); assert.equal(tooMany.status, 400);
  const duplicate = response(); await handler(request('POST', `/api/business/organizations/${org}/members/import`, { 'content-type': 'application/json' }, { rows: [row(1), row(1)] }), duplicate); assert.equal(duplicate.status, 400);
  for (const value of [null, [], { rows: [], extra: true }]) { const result = response(); await handler(request('POST', `/api/business/organizations/${org}/members/import`, { 'content-type': 'application/json' }, value), result); assert.equal(result.status, 400); }
  const huge = response(); await handler(csvRequest('email,display_name,department\n' + 'a'.repeat(256 * 1024)), huge); assert.equal(huge.status, 413);
  const hugeJson = response(); await handler(request('POST', `/api/business/organizations/${org}/members/import`, { 'content-type': 'application/json' }, { rows: [{ email: 'big@example.test', display_name: 'x'.repeat(256 * 1024), department: '' }] }), hugeJson); assert.equal(hugeJson.status, 413);
});

test('mutation payload and organization validation are enforced', async () => {
  const handler = makeHandler();
  for (const body of [{ role: 'owner' }, { role: 'unknown' }, { status: 'pending' }, {}]) { const result = response(); await handler(request('PATCH', `/api/business/organizations/${org}/members/22222222-2222-4222-8222-222222222222`, { 'content-type': 'application/json' }, body), result); assert.equal(result.status, 400); }
  const badOrg = response(); await handler(request('PUT', '/api/business/organizations/nope/policy', { 'content-type': 'application/json' }, { allowedThemeIds: ['team'], featureFlags: { group_play: true, solo_play: true, theme_mix: false, audio: true, theme_tags: true } }), badOrg); assert.equal(badOrg.status, 400);
});

test('injected rate receives read and mutation scopes', async () => {
  const calls = []; const handler = makeHandler(async (req, scope, limit) => { calls.push({ scope, limit }); });
  const read = response(); await handler(request('GET', `/api/business/organizations/${org}/workspace`), read); const mutation = response(); await handler(request('POST', `/api/business/organizations/${org}/members/import`, { 'content-type': 'application/json' }, { rows: [{ email: 'rate@example.test', display_name: 'Rate' }] }), mutation);
  assert.deepEqual(calls, [{ scope: 'read', limit: 3000 }, { scope: 'mutation', limit: 120 }]);
});

test('service errors preserve forbidden and migration statuses', async () => {
  const forbidden = createBusinessHandler({ service: { metadata: async () => { throw Object.assign(new Error(), { status: 403, code: 'FORBIDDEN' }); } }, rate: noopRate }); const denied = response(); await forbidden(request('GET', `/api/business/organizations/${org}/workspace`), denied); assert.equal(denied.status, 403);
  const missing = createBusinessHandler({ service: { metadata: async () => { throw Object.assign(new Error(), { status: 503, code: 'BUSINESS_MIGRATION_UNAVAILABLE' }); } }, rate: noopRate }); const unavailable = response(); await missing(request('GET', `/api/business/organizations/${org}/workspace`), unavailable); assert.equal(unavailable.status, 503);
});

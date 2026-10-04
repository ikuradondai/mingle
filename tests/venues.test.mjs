import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createVenueService } from '../server-side/venues.mjs';

const owner = '00000000-0000-0000-0000-000000000001';
const venueId = '00000000-0000-4000-8000-000000000001';
const setId = '00000000-0000-4000-8000-000000000002';
const tableId = '00000000-0000-4000-8000-000000000003';
const token = 'A'.repeat(32);
const env = { SUPABASE_URL: 'https://venue-test.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test', SUPABASE_SERVICE_ROLE_KEY: 'service_role_test' };
const req = (path, extra = {}) => ({ url: `https://mingle.cards${path}`, method: 'GET', headers: { authorization: 'Bearer owner-token' }, ...extra });
const response = (status, data) => ({ ok: status >= 200 && status < 300, status, async json() { return data; } });
const venueRow = { id: venueId, name: 'テスト居酒屋', logo_url: null, welcome_text: 'どうぞ', adult_enabled: false, owner_id: owner };
const setRow = { id: setId, venue_id: venueId, name: '初対面', card_count: 6, adult_only: false, active: true, cards: Array.from({ length: 6 }, (_, i) => ({ id: `date-0${i + 1}`, text: `質問${i + 1}`, r18: false })) };

test('venue public QR exposes venue active snapshots and server-issued session only after selected start', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => { calls.push({ url, options }); if (url.endsWith('/auth/v1/user')) return response(200, { id: owner }); if (url.includes('/venue_tables?token_hash=')) return response(200, [{ id: tableId, label: 'A卓', venue_id: venueId, venues: venueRow }]); if (url.includes('/venue_sets?venue_id=')) return response(200, [setRow]); if (url.includes('/venue_sets?id=')) return response(200, [setRow]); if (url.endsWith('/venue_usage_events')) return response(201, {}); throw new Error(`unexpected ${url}`); };
  const service = createVenueService({ env, fetchImpl });
  const info = await service.publicInfo(req(`/api/venue/public/${token}`, { headers: {} }), token, false);
  assert.deepEqual(info.sets[0].id, setId); assert.equal(Object.hasOwn(info.sets[0], 'cards'), false);
  const started = await service.publicInfo(req(`/api/venue/public/${token}/start`, { method: 'POST', headers: {}, body: { setId, participants: ['A', 'B'], adultConfirmed: false } }), token, true);
  assert.equal(started.cards.length, 6); assert.match(started.session, /^[A-Za-z0-9_-]{32}$/); assert.equal(calls.filter((x) => x.url.endsWith('/venue_usage_events')).length, 1);
});

test('venue public start rejects a set outside the current venue and adult snapshots require consent', async () => {
  const fetchImpl = async (url) => { if (url.includes('/venue_tables?token_hash=')) return response(200, [{ id: tableId, label: 'A卓', venue_id: venueId, venues: { ...venueRow, adult_enabled: true } }]); if (url.includes('/venue_sets?venue_id=')) return response(200, [{ ...setRow, adult_only: true }]); if (url.includes('/venue_sets?id=')) return response(200, [{ ...setRow, adult_only: false, cards: setRow.cards.map((card, index) => index === 0 ? { ...card, r18: true } : card) }]); throw new Error(`unexpected ${url}`); };
  const service = createVenueService({ env, fetchImpl });
  await assert.rejects(() => service.publicInfo(req(`/api/venue/public/${token}/start`, { method: 'POST', headers: {}, body: { setId: '00000000-0000-4000-8000-000000000099', participants: ['A', 'B'], adultConfirmed: true } }), token, true), (e) => e.code === 'NOT_FOUND');
  await assert.rejects(() => service.publicInfo(req(`/api/venue/public/${token}/start`, { method: 'POST', headers: {}, body: { setId, participants: ['A', 'B'], adultConfirmed: false } }), token, true), (e) => e.code === 'ADULT_CONSENT_REQUIRED');
});

test('venue completion requires the server-issued session, selected snapshot, and a full six-card block', async () => {
  const calls = [];
  let issuedHash = '';
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.includes('/venue_tables?token_hash=')) return response(200, [{ id: tableId, label: 'A卓', venue_id: venueId, venues: { ...venueRow, adult_enabled: true } }]);
    if (url.includes('/venue_sets?venue_id=')) return response(200, [{ ...setRow, card_count: 12, cards: [...setRow.cards, ...setRow.cards] }]);
    if (url.includes('/venue_sets?id=')) return response(200, [{ ...setRow, card_count: 12, cards: [...setRow.cards, ...setRow.cards] }]);
    if (url.includes('/venue_usage_events?table_id=')) return response(200, issuedHash && url.includes(`session_hash=eq.${issuedHash}`) ? [{ id: 'started' }] : []);
    if (url.endsWith('/venue_usage_events')) { issuedHash = JSON.parse(options.body).session_hash; return response(201, {}); }
    throw new Error(`unexpected ${url}`);
  };
  const service = createVenueService({ env, fetchImpl });
  const started = await service.publicInfo(req(`/api/venue/public/${token}/start`, { method: 'POST', headers: {}, body: { setId, participants: ['A', 'B'], adultConfirmed: false } }), token, true);
  await assert.rejects(() => service.analytics(req(`/api/venue/public/${token}/events`, { method: 'POST', headers: {}, body: { eventType: 'completed_round', setId, session: 'B'.repeat(32), roundIndex: 1 } }), token), (e) => e.code === 'SESSION_NOT_STARTED');
  await assert.rejects(() => service.analytics(req(`/api/venue/public/${token}/events`, { method: 'POST', headers: {}, body: { eventType: 'completed_round', setId, session: started.session, roundIndex: 3 } }), token), (e) => e.code === 'ROUND_NOT_COMPLETE');
  const accepted = await service.analytics(req(`/api/venue/public/${token}/events`, { method: 'POST', headers: {}, body: { eventType: 'completed_round', setId, session: started.session, roundIndex: 1 } }), token);
  assert.equal(accepted.accepted, true);
  assert.equal(calls.filter((call) => call.url.endsWith('/venue_usage_events')).length, 2);
});

test('venue migration has tenant composite FK, owner RLS, hashed QR storage, and dedupe events', async () => {
  const sql = await readFile(new URL('../supabase/migrations/202610070001_venues.sql', import.meta.url), 'utf8');
  assert.match(sql, /venue_usage_events_tenant_set_fk/); assert.match(sql, /venue_usage_events_tenant_table_fk/); assert.match(sql, /foreign key \(venue_id, venue_set_id\)/i); assert.match(sql, /token_hash text not null unique/); assert.match(sql, /unique\(table_id, session_hash, event_type, round_index\)/); assert.match(sql, /auth\.uid\(\) = owner_id/);
});

test('venue URLs reject unsafe writes and sanitize unsafe stored values on public read', async () => {
  const unsafe = { ...venueRow, logo_url: 'javascript:alert(1)', store_url: 'http://insecure.test', ending_url: 'javascript:void(0)' };
  const fetchImpl = async (url) => {
    if (url.endsWith('/auth/v1/user')) return response(200, { id: owner });
    if (url.includes('/venue_tables?token_hash=')) return response(200, [{ id: tableId, label: 'A卓', venue_id: venueId, venues: unsafe }]);
    if (url.includes('/venue_sets?venue_id=')) return response(200, [setRow]);
    throw new Error(`unexpected ${url}`);
  };
  const service = createVenueService({ env, fetchImpl });
  await assert.rejects(() => service.create(req('/api/venue', { method: 'POST', body: { name: '危険店舗', logoUrl: 'javascript:alert(1)' } })), (error) => error.code === 'INVALID_REQUEST');
  const info = await service.publicInfo(req(`/api/venue/public/${token}`, { headers: {} }), token, false);
  assert.equal(info.venue.logoUrl, null); assert.equal(info.venue.storeUrl, null); assert.equal(info.venue.endingUrl, null);
});

test('owner QR issue, redisplay, rotation, and revoke keep token lifecycle scoped', async () => {
  let ciphertext = ''; let active = true; let rawUrl = '';
  const fetchImpl = async (url, options = {}) => {
    if (url.endsWith('/auth/v1/user')) return response(200, { id: owner });
    if (url.includes('/venues?owner_id=')) return response(200, [{ ...venueRow, name: 'QR店舗' }]);
    if (url.includes('/venue_sets?venue_id=')) return response(200, []);
    if (url.includes('/venue_tables?token_hash=')) return response(200, active && url.includes(`token_hash=eq.${rawUrl}`) ? [{ id: tableId, label: 'A卓', venue_id: venueId, venues: venueRow }] : []);
    if (url.includes('/venue_tables?venue_id=')) return response(200, active ? [{ id: tableId, venue_id: venueId, label: 'A卓', active: true, token_ciphertext: ciphertext }] : [{ id: tableId, venue_id: venueId, label: 'A卓', active: false, token_ciphertext: ciphertext }]);
    if (url.endsWith('/venue_tables')) { const body = JSON.parse(options.body); ciphertext = body.token_ciphertext; rawUrl = body.token_hash; return response(201, [{ id: tableId, venue_id: venueId, label: 'A卓', active: true, token_ciphertext: ciphertext }]); }
    if (url.includes(`/venue_tables?id=eq.${tableId}`) && options.method === 'PATCH') { const body = JSON.parse(options.body); if (body.active === false) active = false; if (body.token_ciphertext) { ciphertext = body.token_ciphertext; rawUrl = body.token_hash; active = true; } return response(200, [{ id: tableId, venue_id: venueId, label: 'A卓', active, token_ciphertext: ciphertext }]); }
    if (url.includes(`/venue_tables?id=eq.${tableId}`) && !options.method) return response(200, [{ id: tableId, venue_id: venueId, label: 'A卓' }]);
    if (url.includes('/venues?id=') && url.includes(`owner_id=eq.${owner}`)) return response(200, [{ id: venueId }]);
    throw new Error(`unexpected ${url}`);
  };
  const service = createVenueService({ env, fetchImpl });
  const issued = await service.issueTable(req(`/api/venue/${venueId}/tables`, { method: 'POST', body: { label: 'A卓' } }), venueId);
  assert.match(issued.table.url, /token=/); assert.ok(rawUrl);
  const listed = await service.list(req('/api/venue'));
  assert.equal(listed.tables[0].url, issued.table.url);
  const freshService = createVenueService({ env, fetchImpl });
  assert.equal((await freshService.list(req('/api/venue'))).tables[0].url, issued.table.url);
  const rotated = await service.rotateTable(req(`/api/venue/tables/${tableId}/rotate`, { method: 'POST' }), tableId);
  assert.notEqual(rotated.table.url, issued.table.url);
  await assert.rejects(() => service.publicInfo(req(`/api/venue/public/${issued.table.token}`), issued.table.token, false), (error) => error.code === 'NOT_FOUND');
  await service.revokeTable(req(`/api/venue/tables/${tableId}/revoke`, { method: 'POST' }), tableId);
  await assert.rejects(() => service.publicInfo(req(`/api/venue/public/${rotated.table.token}`), rotated.table.token, false), (error) => error.code === 'NOT_FOUND');
  const stopped = await service.list(req('/api/venue'));
  assert.equal(stopped.tables[0].active, false); assert.equal(stopped.tables[0].url, null);
});

test('venue owner scope rejects foreign updates and stats paginates beyond one thousand events', async () => {
  const events = Array.from({ length: 1002 }, (_, index) => ({ venue_set_id: setId, event_type: index < 1000 ? 'started' : 'completed_round', created_at: new Date(index).toISOString() }));
  const fetchImpl = async (url, options = {}) => {
    if (url.endsWith('/auth/v1/user')) return response(200, { id: owner });
    if (url.includes('/venues?id=eq.') && url.includes('owner_id=eq.')) return response(options.method === 'PATCH' ? 200 : 200, options.method === 'PATCH' ? [] : [{ ...venueRow, id: venueId }]);
    if (url.includes('/venue_usage_events?')) { const offset = Number(new URL(url).searchParams.get('offset') || 0); return response(200, events.slice(offset, offset + 1000)); }
    throw new Error(`unexpected ${url}`);
  };
  const service = createVenueService({ env, fetchImpl });
  await assert.rejects(() => service.update(req(`/api/venue/${venueId}`, { method: 'PATCH', body: { name: '他店舗' } }), venueId), (error) => error.code === 'NOT_FOUND');
  const stats = await service.stats(req(`/api/venue/${venueId}/stats`), venueId);
  assert.equal(stats.totals.starts, 1000); assert.equal(stats.totals.completedRounds, 2);
});

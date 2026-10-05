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
  const fetchImpl = async (url) => { if (url.includes('/venue_tables?token_hash=')) return response(200, [{ id: tableId, label: 'A卓', venue_id: venueId, venues: { ...venueRow, adult_enabled: true, adult_attested_at: '2026-10-05T00:00:00+00:00' } }]); if (url.endsWith('/rpc/is_adult_confirmed')) return response(200, true); if (url.includes('/venue_sets?venue_id=')) return response(200, [{ ...setRow, adult_only: true }]); if (url.includes('/venue_sets?id=')) return response(200, [{ ...setRow, adult_only: false, cards: setRow.cards.map((card, index) => index === 0 ? { ...card, r18: true } : card) }]); throw new Error(`unexpected ${url}`); };
  const service = createVenueService({ env, fetchImpl });
  await assert.rejects(() => service.publicInfo(req(`/api/venue/public/${token}/start`, { method: 'POST', headers: {}, body: { setId: '00000000-0000-4000-8000-000000000099', participants: ['A', 'B'], adultConfirmed: true } }), token, true), (e) => e.code === 'NOT_FOUND');
  await assert.rejects(() => service.publicInfo(req(`/api/venue/public/${token}/start`, { method: 'POST', headers: {}, body: { setId, participants: ['A', 'B'], ageConfirmed: true, adultConfirmed: false } }), token, true), (e) => e.code === 'ADULT_CONSENT_REQUIRED');
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

const attestedAt = '2026-10-05T00:00:00+00:00';
const adultCards = Array.from({ length: 6 }, (_, i) => ({ id: `intimacy-0${i + 1}`, text: `R${i + 1}`, r18: true }));
function ownerFetch({ confirmed = true, row = {} } = {}) {
  const calls = [];
  const current = { ...venueRow, ...row };
  const fetchImpl = async (url, options = {}) => {
    const method = options.method || 'GET'; calls.push({ url, method, body: options.body ? JSON.parse(options.body) : null });
    if (url.endsWith('/auth/v1/user')) return response(200, { id: owner });
    if (url.includes('/account_profiles?')) return response(200, confirmed ? [{ adult_confirmed_at: '2026-10-05T09:12:00+00:00' }] : []);
    if (url.endsWith('/rest/v1/venues') && method === 'POST') { const body = JSON.parse(options.body); return response(201, [{ ...venueRow, ...body, adult_attested_at: body.adult_enabled ? attestedAt : null }]); }
    if (url.includes('/venues?id=eq.') && method === 'GET') return response(200, [current]);
    if (url.includes('/venues?id=eq.') && method === 'PATCH') { const body = JSON.parse(options.body); return response(200, [{ ...current, ...body }]); }
    if (url.endsWith('/rest/v1/venue_sets') && method === 'POST') { const body = JSON.parse(options.body); return response(201, [{ id: setId, ...body, active: true }]); }
    if (url.includes('/venue_sets?id=eq.') && method === 'GET') return response(200, [{ id: setId, venue_id: venueId, active: false, adult_only: true, venues: { owner_id: owner, adult_enabled: Boolean(current.adult_enabled) } }]);
    if (url.includes('/venue_sets?id=eq.') && method === 'PATCH') return response(204, null);
    throw new Error(`unexpected ${method} ${url}`);
  };
  return { service: createVenueService({ env, fetchImpl }), calls };
}
const post = (path, body, extra = {}) => req(path, { method: 'POST', body, ...extra });
const patch = (path, body) => req(path, { method: 'PATCH', body });

test('turning R18 on at venue creation needs a confirmed owner account, then the owner attestation', async () => {
  const unconfirmed = ownerFetch({ confirmed: false });
  await assert.rejects(() => unconfirmed.service.create(post('/api/venue', { name: '店', adultEnabled: true, participantsAdultAttested: true })), (e) => e.status === 403 && e.code === 'AGE_CONFIRMATION_REQUIRED');
  assert.equal(unconfirmed.calls.some((call) => call.method === 'POST' && call.url.endsWith('/rest/v1/venues')), false);
  const { service, calls } = ownerFetch();
  await assert.rejects(() => service.create(post('/api/venue', { name: '店', adultEnabled: true })), (e) => e.status === 403 && e.code === 'ADULT_ATTESTATION_REQUIRED');
  await assert.rejects(() => service.create(post('/api/venue', { name: '店', adultEnabled: true, participantsAdultAttested: false })), (e) => e.status === 403 && e.code === 'ADULT_ATTESTATION_REQUIRED');
  await assert.rejects(() => service.create(post('/api/venue', { name: '店', adultEnabled: true, participantsAdultAttested: 'yes' })), (e) => e.status === 400 && e.code === 'INVALID_REQUEST');
  const created = await service.create(post('/api/venue', { name: '店', adultEnabled: true, participantsAdultAttested: true }));
  assert.equal(created.venue.adultEnabled, true);
  assert.equal(created.venue.adultAttestedAt, '2026-10-05T00:00:00.000Z');
  const write = calls.find((call) => call.method === 'POST' && call.url.endsWith('/rest/v1/venues'));
  assert.equal(write.body.adult_enabled, true);
  assert.equal(Object.hasOwn(write.body, 'adult_attested_at'), false);
  assert.equal(Object.hasOwn(write.body, 'adult_attested_by'), false);
  const plain = await service.create(post('/api/venue', { name: '店' }));
  assert.equal(plain.venue.adultEnabled, false); assert.equal(plain.venue.adultAttestedAt, null);
});

test('enabling R18 on an existing venue checks account and attestation only on the off-to-on change', async () => {
  const off = ownerFetch({ confirmed: false, row: { adult_enabled: false } });
  await assert.rejects(() => off.service.update(patch(`/api/venue/${venueId}`, { adultEnabled: true, participantsAdultAttested: true }), venueId), (e) => e.status === 403 && e.code === 'AGE_CONFIRMATION_REQUIRED');
  const confirmedOff = ownerFetch({ row: { adult_enabled: false } });
  await assert.rejects(() => confirmedOff.service.update(patch(`/api/venue/${venueId}`, { adultEnabled: true }), venueId), (e) => e.status === 403 && e.code === 'ADULT_ATTESTATION_REQUIRED');
  const enabled = await confirmedOff.service.update(patch(`/api/venue/${venueId}`, { adultEnabled: true, participantsAdultAttested: true }), venueId);
  assert.equal(enabled.venue.adultEnabled, true);
  const patchBody = confirmedOff.calls.find((call) => call.method === 'PATCH').body;
  assert.deepEqual(patchBody, { adult_enabled: true });
  // Already on: no account lookup and no attestation needed.
  const alreadyOn = ownerFetch({ confirmed: false, row: { adult_enabled: true, adult_attested_at: attestedAt } });
  const same = await alreadyOn.service.update(patch(`/api/venue/${venueId}`, { adultEnabled: true }), venueId);
  assert.equal(same.venue.adultEnabled, true);
  assert.equal(alreadyOn.calls.some((call) => call.url.includes('/account_profiles')), false);
  // Turning it off never needs a check.
  const turnOff = await alreadyOn.service.update(patch(`/api/venue/${venueId}`, { adultEnabled: false }), venueId);
  assert.equal(turnOff.venue.adultEnabled, false);
});

test('database age-guard failures surface as 403 AGE_CONFIRMATION_REQUIRED', async () => {
  const fetchImpl = async (url, options = {}) => {
    if (url.endsWith('/auth/v1/user')) return response(200, { id: owner });
    if (url.includes('/account_profiles?')) return response(200, [{ adult_confirmed_at: '2026-10-05T09:12:00+00:00' }]);
    if (url.endsWith('/rest/v1/venues') && options.method === 'POST') return response(400, { code: 'P0001', message: 'AGE_CONFIRMATION_REQUIRED' });
    throw new Error(`unexpected ${url}`);
  };
  const service = createVenueService({ env, fetchImpl });
  await assert.rejects(() => service.create(post('/api/venue', { name: '店', adultEnabled: true, participantsAdultAttested: true })), (e) => e.status === 403 && e.code === 'AGE_CONFIRMATION_REQUIRED');
});

test('R18 sets can only be added or re-published by an age-confirmed owner of an R18-enabled venue', async () => {
  const unconfirmed = ownerFetch({ confirmed: false, row: { adult_enabled: true, adult_attested_at: attestedAt } });
  await assert.rejects(() => unconfirmed.service.addSet(post(`/api/venue/${venueId}/sets`, { name: '大人', sourceType: 'standard', sourceId: 'intimacy' }), venueId), (e) => e.status === 403 && e.code === 'AGE_CONFIRMATION_REQUIRED');
  assert.equal(unconfirmed.calls.some((call) => call.method === 'POST' && call.url.endsWith('/venue_sets')), false);
  await assert.rejects(() => unconfirmed.service.updateSet(patch(`/api/venue/sets/${setId}`, { active: true }), setId), (e) => e.status === 403 && e.code === 'AGE_CONFIRMATION_REQUIRED');
  const disabled = ownerFetch({ row: { adult_enabled: false } });
  await assert.rejects(() => disabled.service.updateSet(patch(`/api/venue/sets/${setId}`, { active: true }), setId), (e) => e.status === 400 && e.code === 'ADULT_VENUE_REQUIRED');
  const ok = ownerFetch({ row: { adult_enabled: true, adult_attested_at: attestedAt } });
  const added = await ok.service.addSet(post(`/api/venue/${venueId}/sets`, { name: '大人', sourceType: 'standard', sourceId: 'intimacy' }), venueId);
  assert.equal(added.set.adultOnly, true);
  assert.deepEqual(await ok.service.updateSet(patch(`/api/venue/sets/${setId}`, { active: true }), setId), { active: true });
  // Pausing an R18 set stays possible for an unconfirmed owner.
  assert.deepEqual(await unconfirmed.service.updateSet(patch(`/api/venue/sets/${setId}`, { active: false }), setId), { active: false });
  // Non-R18 sets need no account confirmation.
  const plain = await unconfirmed.service.addSet(post(`/api/venue/${venueId}/sets`, { name: '通常', sourceType: 'standard', sourceId: 'date' }), venueId);
  assert.equal(plain.set.adultOnly, false);
});

function publicFetch({ venue = {}, confirmed = true, rpcFails = false } = {}) {
  const calls = [];
  const adultSet = { ...setRow, id: '00000000-0000-4000-8000-0000000000a1', adult_only: true, cards: adultCards };
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.includes('/venue_tables?token_hash=')) return response(200, [{ id: tableId, label: 'A卓', venue_id: venueId, venues: { ...venueRow, adult_enabled: true, adult_attested_at: attestedAt, ...venue } }]);
    if (url.endsWith('/rpc/is_adult_confirmed')) return rpcFails ? response(500, { message: 'down' }) : response(200, confirmed);
    if (url.includes('/venue_sets?venue_id=')) return response(200, [setRow, adultSet].map(({ cards, ...rest }) => rest));
    if (url.includes('/venue_sets?id=')) return response(200, [url.includes(adultSet.id) ? adultSet : setRow]);
    if (url.endsWith('/venue_usage_events')) return response(201, {});
    throw new Error(`unexpected ${url}`);
  };
  return { service: createVenueService({ env, fetchImpl }), calls, adultSetId: adultSet.id };
}

test('public QR lists R18 sets only while enabled, attested and the owner is still age-confirmed', async () => {
  const live = publicFetch();
  const open = await live.service.publicInfo(req(`/api/venue/public/${token}`, { headers: {} }), token, false);
  assert.equal(open.sets.length, 2); assert.equal(open.venue.adultEnabled, true); assert.equal(open.venue.adultAttestedAt, '2026-10-05T00:00:00.000Z');
  assert.equal(Object.hasOwn(open.venue, 'owner_id') || Object.hasOwn(open.venue, 'ownerId'), false);
  const rpc = live.calls.find((call) => call.url.endsWith('/rpc/is_adult_confirmed'));
  assert.deepEqual(JSON.parse(rpc.options.body), { p_user_id: owner });
  assert.equal(rpc.options.headers.Authorization, 'Bearer service_role_test');
  for (const scenario of [{ confirmed: false }, { rpcFails: true }, { venue: { adult_attested_at: null } }, { venue: { adult_enabled: false } }]) {
    const closed = publicFetch(scenario);
    const info = await closed.service.publicInfo(req(`/api/venue/public/${token}`, { headers: {} }), token, false);
    assert.deepEqual(info.sets.map((set) => set.id), [setId], JSON.stringify(scenario));
    assert.equal(info.venue.adultEnabled, false, JSON.stringify(scenario));
  }
});

test('public R18 start needs the participant tap, then the per-session consent; never stores the tap', async () => {
  const { service, calls, adultSetId } = publicFetch();
  const start = (extra) => service.publicInfo(post(`/api/venue/public/${token}/start`, { setId: adultSetId, participants: ['A', 'B'], adultConfirmed: true, ...extra }, { headers: {} }), token, true);
  await assert.rejects(() => start({}), (e) => e.status === 403 && e.code === 'PARTICIPANT_AGE_REQUIRED');
  await assert.rejects(() => start({ ageConfirmed: false }), (e) => e.status === 403 && e.code === 'PARTICIPANT_AGE_REQUIRED');
  await assert.rejects(() => start({ ageConfirmed: 'true' }), (e) => e.status === 400 && e.code === 'INVALID_REQUEST');
  await assert.rejects(() => start({ ageConfirmed: true, adultConfirmed: false }), (e) => e.status === 403 && e.code === 'ADULT_CONSENT_REQUIRED');
  assert.equal(calls.some((call) => call.url.endsWith('/venue_usage_events')), false);
  const started = await start({ ageConfirmed: true });
  assert.equal(started.set.adultOnly, true); assert.equal(started.cards.length, 6);
  const event = calls.find((call) => call.url.endsWith('/venue_usage_events'));
  assert.equal(JSON.stringify(JSON.parse(event.options.body)).includes('age'), false);
  // Non-R18 sets are unaffected by the tap.
  const plain = await service.publicInfo(post(`/api/venue/public/${token}/start`, { setId, participants: ['A', 'B'], adultConfirmed: false }, { headers: {} }), token, true);
  assert.equal(plain.set.adultOnly, false);
});

test('public R18 start is refused once the owner account is no longer confirmed', async () => {
  const { service, adultSetId } = publicFetch({ confirmed: false });
  await assert.rejects(() => service.publicInfo(post(`/api/venue/public/${token}/start`, { setId: adultSetId, participants: ['A', 'B'], ageConfirmed: true, adultConfirmed: true }, { headers: {} }), token, true), (e) => e.status === 404 && e.code === 'NOT_FOUND');
});

test('adult-gate migration is static-checked for venue guard and attestation columns', async () => {
  const sql = await readFile(new URL('../supabase/migrations/202610090001_adult_gate.sql', import.meta.url), 'utf8');
  assert.match(sql, /create trigger venues_adult_guard before insert or update on public\.venues/);
  assert.match(sql, /add column if not exists adult_attested_by uuid null references auth\.users\(id\) on delete set null/);
});

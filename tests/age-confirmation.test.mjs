import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { AGE_ERRORS, readAdultConfirmation, requireAdultConfirmed, setAdultConfirmation, userFromBearer } from '../server-side/age-confirmation.mjs';

const config = { url: 'https://age-test.supabase.co', key: 'sb_publishable_test' };
const user = '00000000-0000-0000-0000-000000000001';
const response = (status, data) => ({ ok: status >= 200 && status < 300, status, async json() { if (data === undefined) throw new Error('empty'); return data; } });
const args = (fetchImpl, extra = {}) => ({ config, userId: user, authorization: 'Bearer user-token', fetchImpl, ...extra });

test('error codes are the contract values', () => {
  assert.deepEqual(AGE_ERRORS, { required: 'AGE_CONFIRMATION_REQUIRED', attestation: 'ADULT_ATTESTATION_REQUIRED', participant: 'PARTICIPANT_AGE_REQUIRED' });
});

test('readAdultConfirmation reads the owner row with the supplied Bearer and normalises the timestamp', async () => {
  const calls = [];
  const state = await readAdultConfirmation(args(async (url, options) => { calls.push({ url, options }); return response(200, [{ adult_confirmed_at: '2026-10-05T09:12:00.5+00:00' }]); }));
  assert.deepEqual(state, { available: true, confirmedAt: '2026-10-05T09:12:00.500Z' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${config.url}/rest/v1/account_profiles?user_id=eq.${user}&select=adult_confirmed_at`);
  assert.equal(calls[0].options.headers.Authorization, 'Bearer user-token');
  assert.equal(calls[0].options.headers.apikey, config.key);
});

test('readAdultConfirmation treats no row and a null value as unconfirmed, and a missing table as unavailable', async () => {
  assert.deepEqual(await readAdultConfirmation(args(async () => response(200, []))), { available: true, confirmedAt: null });
  assert.deepEqual(await readAdultConfirmation(args(async () => response(200, [{ adult_confirmed_at: null }]))), { available: true, confirmedAt: null });
  assert.deepEqual(await readAdultConfirmation(args(async () => response(200, [{ adult_confirmed_at: 'not a date' }]))), { available: true, confirmedAt: null });
  for (const code of ['PGRST205', '42P01']) {
    assert.deepEqual(await readAdultConfirmation(args(async () => response(404, { code, message: 'relation public.account_profiles does not exist' }))), { available: false, confirmedAt: null }, code);
  }
});

test('readAdultConfirmation throws for other failures; callers must treat that as unconfirmed', async () => {
  await assert.rejects(() => readAdultConfirmation(args(async () => response(500, { message: 'down' }))), (error) => error.status === 502);
  await assert.rejects(() => readAdultConfirmation(args(async () => response(404, { code: 'PGRST205', message: 'other_table missing' }))), (error) => error.status === 502);
  await assert.rejects(() => readAdultConfirmation(args(async () => response(401, {}))), (error) => error.status === 401);
  await assert.rejects(() => readAdultConfirmation(args(async () => { throw new Error('network'); })), /network/);
  await assert.rejects(() => readAdultConfirmation(args(async () => { throw new Error('no call'); }, { authorization: '' })), (error) => error.status === 401);
});

test('requireAdultConfirmed returns the time, and fails closed with 403 in every other case', async () => {
  assert.equal(await requireAdultConfirmed(args(async () => response(200, [{ adult_confirmed_at: '2026-10-05T09:12:00+00:00' }]))), '2026-10-05T09:12:00.000Z');
  for (const fetchImpl of [
    async () => response(200, []),
    async () => response(404, { code: 'PGRST205', message: 'account_profiles missing' }),
    async () => response(500, {}),
    async () => { throw new Error('network'); },
  ]) {
    await assert.rejects(() => requireAdultConfirmed(args(fetchImpl)), (error) => error.status === 403 && error.code === 'AGE_CONFIRMATION_REQUIRED');
  }
});

test('reads are never cached, so a revocation takes effect on the next call', async () => {
  let rows = [{ adult_confirmed_at: '2026-10-05T09:12:00+00:00' }]; let reads = 0;
  const fetchImpl = async () => { reads += 1; return response(200, rows); };
  assert.ok((await readAdultConfirmation(args(fetchImpl))).confirmedAt);
  rows = [{ adult_confirmed_at: null }];
  assert.equal((await readAdultConfirmation(args(fetchImpl))).confirmedAt, null);
  assert.equal(reads, 2);
});

test('setAdultConfirmation posts the RPC arguments as the user and returns the stored time or null', async () => {
  const calls = [];
  const fetchImpl = async (url, options) => { calls.push({ url, options }); return response(200, JSON.parse(options.body).p_confirmed ? '2026-10-05T09:12:00.25+00:00' : null); };
  const set = await setAdultConfirmation({ config, authorization: 'Bearer user-token', confirmed: true, source: 'login_screen', fetchImpl });
  assert.equal(set, '2026-10-05T09:12:00.250Z');
  assert.equal(calls[0].url, `${config.url}/rest/v1/rpc/set_adult_confirmation`);
  assert.equal(calls[0].options.method, 'POST'); assert.equal(calls[0].options.headers.Authorization, 'Bearer user-token');
  assert.deepEqual(JSON.parse(calls[0].options.body), { p_confirmed: true, p_source: 'login_screen' });
  assert.equal(await setAdultConfirmation({ config, authorization: 'Bearer user-token', confirmed: false, fetchImpl }), null);
  assert.equal(JSON.parse(calls[1].options.body).p_confirmed, false);
});

test('setAdultConfirmation validates input before any request and maps failures', async () => {
  const never = async () => { throw new Error('must not call'); };
  await assert.rejects(() => setAdultConfirmation({ config, authorization: 'Bearer t', confirmed: true, source: 'other', fetchImpl: never }), (error) => error.status === 400);
  await assert.rejects(() => setAdultConfirmation({ config, authorization: 'Bearer t', confirmed: 'yes', fetchImpl: never }), (error) => error.status === 400);
  await assert.rejects(() => setAdultConfirmation({ config, authorization: '', confirmed: true, source: 'settings', fetchImpl: never }), (error) => error.status === 401);
  const failing = (status, data = {}) => ({ config, authorization: 'Bearer t', confirmed: true, source: 'settings', fetchImpl: async () => response(status, data) });
  await assert.rejects(() => setAdultConfirmation(failing(401)), (error) => error.status === 401 && error.code === 'UNAUTHENTICATED');
  await assert.rejects(() => setAdultConfirmation(failing(404, { code: 'PGRST202' })), (error) => error.status === 503 && error.code === 'FEATURE_UNAVAILABLE');
  await assert.rejects(() => setAdultConfirmation(failing(500)), (error) => error.status === 502 && error.code === 'FEATURE_UNAVAILABLE');
  await assert.rejects(() => setAdultConfirmation({ ...failing(200, 'garbage') }), (error) => error.status === 502);
});

test('userFromBearer returns the user for a valid Bearer and null for everything else', async () => {
  const calls = [];
  const ok = await userFromBearer({ config, authorization: 'Bearer good', fetchImpl: async (url, options) => { calls.push({ url, options }); return response(200, { id: user, email: 'a@example.test' }); } });
  assert.equal(ok.id, user); assert.equal(calls[0].url, `${config.url}/auth/v1/user`); assert.equal(calls[0].options.headers.Authorization, 'Bearer good');
  assert.equal(await userFromBearer({ config, authorization: 'Bearer bad', fetchImpl: async () => response(401, { message: 'jwt' }) }), null);
  assert.equal(await userFromBearer({ config, authorization: 'Bearer odd', fetchImpl: async () => response(200, {}) }), null);
  assert.equal(await userFromBearer({ config, authorization: 'Bearer down', fetchImpl: async () => { throw new Error('network'); } }), null);
  assert.equal(await userFromBearer({ config, authorization: '', fetchImpl: async () => { throw new Error('must not call'); } }), null);
});

const migration = await readFile(new URL('../supabase/migrations/202610090001_adult_gate.sql', import.meta.url), 'utf8');
const normalized = migration.replace(/\s+/g, ' ');

test('adult-gate migration: account_profiles is owner-select only under RLS and cascades with the auth user', () => {
  assert.match(normalized, /create table if not exists public\.account_profiles \( user_id uuid primary key references auth\.users\(id\) on delete cascade/);
  assert.match(normalized, /alter table public\.account_profiles enable row level security/);
  assert.match(normalized, /revoke all on public\.account_profiles from anon, authenticated/);
  assert.match(normalized, /grant select on public\.account_profiles to authenticated/);
  assert.doesNotMatch(normalized, /grant (insert|update|delete|all)[^;]* on public\.account_profiles to authenticated/i);
  assert.match(normalized, /create policy account_profiles_owner_select on public\.account_profiles for select to authenticated using \(\(select auth\.uid\(\)\) = user_id\)/);
  assert.match(normalized, /account_profiles_adult_pair check \(\(adult_confirmed_at is null\) = \(adult_confirmation_source is null\)\)/);
  assert.match(normalized, /adult_confirmation_source in \('login_screen', 'settings'\)/);
});

test('adult-gate migration: SECURITY DEFINER functions pin search_path and use auth.uid(), not caller input', () => {
  assert.equal([...migration.matchAll(/create or replace function public\.(\w+)/g)].length, 5);
  for (const [, name] of [...migration.matchAll(/create or replace function public\.(\w+)/g)]) {
    const start = migration.indexOf(`create or replace function public.${name}`);
    const header = migration.slice(start, migration.indexOf('$$', migration.indexOf('$$', start) + 2) + 2);
    assert.match(header, /security definer/i, name);
    assert.match(header, /set search_path = public/i, name);
  }
  const setFn = migration.slice(migration.indexOf('function public.set_adult_confirmation'), migration.indexOf('function public.is_adult_confirmed'));
  assert.match(setFn, /v_user uuid := auth\.uid\(\)/);
  assert.doesNotMatch(setFn, /p_user_id/);
  assert.match(setFn, /raise exception 'UNAUTHENTICATED'/);
});

test('adult-gate migration: RPC execution grants keep anon out and the server-only checks off clients', () => {
  assert.match(normalized, /revoke all on function public\.set_adult_confirmation\(boolean, text\) from public, anon/);
  assert.match(normalized, /grant execute on function public\.set_adult_confirmation\(boolean, text\) to authenticated/);
  assert.match(normalized, /revoke all on function public\.is_adult_confirmed\(uuid\) from public, anon, authenticated/);
  assert.match(normalized, /grant execute on function public\.is_adult_confirmed\(uuid\) to service_role/);
  assert.match(normalized, /revoke all on function public\.group_create_room\(uuid,text,text,text,jsonb,boolean,text,text,timestamptz,boolean\) from public, anon, authenticated/);
  assert.match(normalized, /grant execute on function public\.group_join_member\(uuid,text,text,boolean,boolean\) to service_role/);
});

test('adult-gate migration: old RPC signatures are dropped and the new ones keep the contract argument names', () => {
  assert.match(normalized, /drop function if exists public\.group_create_room\(uuid,text,text,text,jsonb,boolean,text,text,timestamptz\)/);
  assert.match(normalized, /drop function if exists public\.group_join_member\(uuid,text,text,boolean\)/);
  assert.match(normalized, /p_adult_attested boolean default false/);
  assert.match(normalized, /p_age_confirmed boolean default false/);
  assert.match(normalized, /raise exception 'AGE_CONFIRMATION_REQUIRED'/);
  assert.match(normalized, /raise exception 'ADULT_ATTESTATION_REQUIRED'/);
  assert.match(normalized, /raise exception 'PARTICIPANT_AGE_REQUIRED'/);
  assert.match(normalized, /check \(not adult_only or adult_attested_at is not null\);/);
  assert.doesNotMatch(normalized, /adult_attested_at is not null\) not valid/);
  assert.match(normalized, /delete from public\.group_rooms where adult_only and adult_attested_at is null/);
  assert.match(normalized, /if not p_confirmed then delete from public\.account_profiles where user_id = v_user; return null; end if;/);
});

test('adult-gate migration: venues are guarded by a trigger and unattested R18 venues are switched off', () => {
  assert.match(normalized, /update public\.venues set adult_enabled = false where adult_enabled and adult_attested_at is null/);
  assert.match(normalized, /create trigger venues_adult_guard before insert or update on public\.venues for each row execute function public\.venues_adult_guard\(\)/);
  assert.match(normalized, /new\.adult_attested_at := now\(\)/);
  assert.match(normalized, /new\.adult_attested_by := new\.owner_id/);
  assert.match(normalized, /new\.adult_attested_at := old\.adult_attested_at/);
  assert.match(normalized, /new\.adult_attested_at := null/);
  assert.match(normalized, /adult_attested_by uuid null references auth\.users\(id\) on delete set null/);
});

test('adult-gate migration is one transaction and does not touch the earlier migration', async () => {
  assert.match(migration, /^(--[^\n]*\n)*begin;/);
  assert.match(migration.trimEnd(), /commit;$/);
  const earlier = await readFile(new URL('../supabase/migrations/202610080001_group_rooms.sql', import.meta.url), 'utf8');
  assert.doesNotMatch(earlier, /adult_attested|age_confirmed/);
});

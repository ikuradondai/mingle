import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

// Real-database check of 202610090001_adult_gate.sql on PGlite.
// Run it from a directory that can resolve @electric-sql/pglite (see tests/rls/README.md).
const siteRoot = process.env.MINGLE_SITE_ROOT || new URL('../..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const migration = (file) => readFile(join(siteRoot, 'supabase', 'migrations', file), 'utf8');

const db = new PGlite();
await db.waitReady;
const q = (sql, params) => db.query(sql, params);
const userA = '11111111-1111-4111-8111-111111111111';
const userB = '22222222-2222-4222-8222-222222222222';
const legacyOwner = '33333333-3333-4333-8333-333333333333';

async function as(roleName, uid = '') {
  await db.exec('reset role');
  await q("select set_config('request.jwt.claim.sub', $1, false)", [uid]);
  if (roleName !== 'postgres') await db.exec(`set role ${roleName}`);
}
async function expectError(fn, matcher, label) {
  let error = null;
  try { await fn(); } catch (caught) { error = caught; }
  assert.ok(error, `${label}: expected an error`);
  const text = `${error.code || ''} ${error.message || ''}`;
  assert.match(text, matcher, `${label}: got ${text}`);
}

try {
  await db.exec(`
    create schema auth;
    create table auth.users(id uuid primary key);
    create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create role anon; create role authenticated; create role service_role bypassrls;
    grant usage on schema auth to anon, authenticated, service_role;
  `);
  for (const file of ['202610020001_accounts.sql', '202610070001_venues.sql', '202610080001_group_rooms.sql']) await db.exec(await migration(file));
  await db.exec('grant usage on schema public to anon, authenticated, service_role');
  await q('insert into auth.users values ($1), ($2), ($3)', [userA, userB, legacyOwner]);

  // ---- Legacy data that exists before the gate migration ----
  const legacyVenue = (await q("insert into public.venues(owner_id, name, adult_enabled) values ($1, 'legacy R18', true) returning id", [legacyOwner])).rows[0].id;
  const legacyPlain = (await q("insert into public.venues(owner_id, name, adult_enabled) values ($1, 'legacy plain', false) returning id", [legacyOwner])).rows[0].id;
  const cards = JSON.stringify(Array.from({ length: 6 }, (_, i) => ({ id: `c${i}`, text: `q${i}`, r18: false })));
  const legacyRoom = (await q("insert into public.group_rooms(host_user_id, invite_hash, deck_id, deck_name, cards, adult_only, member_count) values ($1, 'legacy-invite', 'intimacy', 'legacy', $2::jsonb, true, 1) returning id", [legacyOwner, cards])).rows[0].id;
  await q("insert into public.group_members(room_id, secret_hash, display_name, role, adult_confirmed) values ($1, 'legacy-secret', 'legacy host', 'host', true)", [legacyRoom]);
  const legacyPlainRoom = (await q("insert into public.group_rooms(host_user_id, invite_hash, deck_id, deck_name, cards, adult_only, member_count) values ($1, 'legacy-plain-invite', 'date', 'plain', $2::jsonb, false, 1) returning id", [legacyOwner, cards])).rows[0].id;

  await db.exec(await migration('202610090001_adult_gate.sql'));
  await db.exec('grant select on public.account_profiles to authenticated; grant usage on schema public to service_role');

  // ---- Data migration ----
  await as('postgres');
  assert.equal((await q('select adult_enabled from public.venues where id = $1', [legacyVenue])).rows[0].adult_enabled, false, 'unattested R18 venue is switched off');
  assert.equal((await q('select adult_enabled from public.venues where id = $1', [legacyPlain])).rows[0].adult_enabled, false);
  assert.equal((await q('select count(*)::int as n from public.venues where adult_enabled').then((r) => r.rows[0].n)), 0);
  // Pre-gate R18 rooms (no attestation) and their members are deleted by the migration; plain rooms are kept.
  assert.equal((await q('select count(*)::int as n from public.group_rooms where id = $1', [legacyRoom])).rows[0].n, 0, 'unattested R18 room is deleted');
  assert.equal((await q('select count(*)::int as n from public.group_members where room_id = $1', [legacyRoom])).rows[0].n, 0, 'its members are deleted');
  assert.equal((await q('select count(*)::int as n from public.group_rooms where id = $1', [legacyPlainRoom])).rows[0].n, 1, 'non-R18 rooms are kept');
  assert.equal((await q('select count(*)::int as n from public.group_rooms where adult_only and adult_attested_at is null')).rows[0].n, 0);
  await expectError(() => q("insert into public.group_rooms(host_user_id, invite_hash, deck_id, deck_name, cards, adult_only) values ($1, 'x', 'd', 'd', $2::jsonb, true)", [userA, cards]), /23514|group_rooms_adult_attested/, 'new R18 room without attestation');
  // Re-running the migration is a no-op (idempotent).
  await db.exec(await migration('202610090001_adult_gate.sql'));

  // ---- account_profiles + set_adult_confirmation ----
  await as('postgres');
  await q("select public.is_adult_confirmed($1)", [userA]);
  await as('anon');
  await expectError(() => q('select * from public.account_profiles'), /42501|permission denied/, 'anon select');
  await expectError(() => q("select public.set_adult_confirmation(true, 'settings')"), /42501|permission denied/, 'anon RPC');
  await as('authenticated', '');
  await expectError(() => q("select public.set_adult_confirmation(true, 'settings')"), /28000|UNAUTHENTICATED/, 'no auth.uid()');

  await as('authenticated', userA);
  assert.equal((await q('select count(*)::int as n from public.account_profiles')).rows[0].n, 0);
  const first = (await q("select public.set_adult_confirmation(true, 'login_screen') as at")).rows[0].at;
  assert.ok(first instanceof Date, 'returns a timestamp');
  let row = (await q('select user_id, adult_confirmed_at, adult_confirmation_source from public.account_profiles')).rows;
  assert.equal(row.length, 1); assert.equal(row[0].user_id, userA); assert.equal(row[0].adult_confirmation_source, 'login_screen');
  await new Promise((resolve) => setTimeout(resolve, 15));
  const again = (await q("select public.set_adult_confirmation(true, 'settings') as at")).rows[0].at;
  assert.equal(again.getTime(), first.getTime(), 're-confirming keeps the first timestamp');
  assert.equal((await q('select adult_confirmation_source from public.account_profiles')).rows[0].adult_confirmation_source, 'login_screen', 're-confirming keeps the first source');
  // Direct writes are refused by GRANT (and would be by RLS).
  await expectError(() => q("insert into public.account_profiles(user_id, adult_confirmed_at, adult_confirmation_source) values ($1, now(), 'settings')", [userB]), /42501|permission denied/, 'direct insert');
  await expectError(() => q("update public.account_profiles set adult_confirmed_at = null"), /42501|permission denied/, 'direct update');
  await expectError(() => q('delete from public.account_profiles'), /42501|permission denied/, 'direct delete');
  await expectError(() => q("select public.set_adult_confirmation(true, 'hacked')"), /22023|INVALID_REQUEST/, 'invalid source');
  await expectError(() => q('select public.set_adult_confirmation(null, null)'), /22023|INVALID_REQUEST/, 'null confirmation');
  // B is isolated from A.
  await as('authenticated', userB);
  assert.equal((await q('select count(*)::int as n from public.account_profiles')).rows[0].n, 0, 'B cannot see A');
  await as('authenticated', userA);
  // Revoke deletes the row (no history); re-confirming afterwards creates a fresh row with a new time.
  assert.equal((await q('select public.set_adult_confirmation(false) as at')).rows[0].at, null);
  assert.equal((await q('select count(*)::int as n from public.account_profiles')).rows[0].n, 0, 'revoke leaves no row');
  await as('postgres');
  assert.equal((await q('select count(*)::int as n from public.account_profiles where user_id = $1', [userA])).rows[0].n, 0, 'no created_at / updated_at trace remains');
  await as('authenticated', userA);
  await new Promise((resolve) => setTimeout(resolve, 15));
  const reconfirmed = (await q("select public.set_adult_confirmation(true, 'settings') as at")).rows[0].at;
  assert.ok(reconfirmed.getTime() > first.getTime(), 'a new confirmation after revoke gets a new time');
  assert.equal((await q('select adult_confirmation_source from public.account_profiles')).rows[0].adult_confirmation_source, 'settings');
  // Revoking without ever having confirmed must not create a row.
  await as('authenticated', userB);
  assert.equal((await q('select public.set_adult_confirmation(false) as at')).rows[0].at, null);
  await as('postgres');
  assert.equal((await q('select count(*)::int as n from public.account_profiles where user_id = $1', [userB])).rows[0].n, 0, 'revoke by a never-confirmed user creates no row');

  // ---- is_adult_confirmed is server-only ----
  await as('authenticated', userA);
  await expectError(() => q('select public.is_adult_confirmed($1)', [userA]), /42501|permission denied/, 'authenticated is_adult_confirmed');
  await as('anon');
  await expectError(() => q('select public.is_adult_confirmed($1)', [userA]), /42501|permission denied/, 'anon is_adult_confirmed');
  await as('service_role');
  assert.equal((await q('select public.is_adult_confirmed($1) as ok', [userA])).rows[0].ok, true);
  assert.equal((await q('select public.is_adult_confirmed($1) as ok', [userB])).rows[0].ok, false, 'revoked / empty row');
  assert.equal((await q('select public.is_adult_confirmed($1) as ok', [legacyOwner])).rows[0].ok, false, 'no row');

  // ---- group_create_room ----
  const create = (host, adult, attested, invite) => q(
    "select * from public.group_create_room($1, $2, 'intimacy', 'deck', $3::jsonb, $4, $5, 'host', now() + interval '1 day', $6)",
    [host, invite, cards, adult, `secret-${invite}`, attested],
  );
  await as('anon');
  await expectError(() => create(userA, true, true, 'anon-invite'), /42501|permission denied/, 'anon create');
  await as('authenticated', userA);
  await expectError(() => create(userA, true, true, 'auth-invite'), /42501|permission denied/, 'authenticated create');
  await as('service_role');
  await expectError(() => create(userB, true, true, 'unconfirmed'), /AGE_CONFIRMATION_REQUIRED/, 'unconfirmed host');
  await expectError(() => create(userA, true, false, 'no-attest'), /ADULT_ATTESTATION_REQUIRED/, 'host did not attest');
  await expectError(() => q("select * from public.group_create_room($1, 'default-attest', 'intimacy', 'deck', $2::jsonb, true, 's', 'host', now() + interval '1 day')", [userA, cards]), /ADULT_ATTESTATION_REQUIRED/, 'attestation defaults to false');
  assert.equal((await q('select count(*)::int as n from public.group_rooms where invite_hash in ($1, $2, $3)', ['unconfirmed', 'no-attest', 'default-attest'])).rows[0].n, 0, 'failed creates leave no rows');
  const adultRoom = (await create(userA, true, true, 'adult-ok')).rows[0];
  const adultRow = (await q('select adult_only, adult_attested_at from public.group_rooms where id = $1', [adultRoom.room_id])).rows[0];
  assert.equal(adultRow.adult_only, true); assert.ok(adultRow.adult_attested_at instanceof Date);
  const hostMember = (await q('select role, adult_confirmed, age_confirmed_at from public.group_members where id = $1', [adultRoom.host_member_id])).rows[0];
  assert.equal(hostMember.role, 'host'); assert.ok(hostMember.age_confirmed_at instanceof Date);
  const plainRoom = (await create(userB, false, false, 'plain-ok')).rows[0];
  const plainRow = (await q('select adult_only, adult_attested_at from public.group_rooms where id = $1', [plainRoom.room_id])).rows[0];
  assert.equal(plainRow.adult_only, false); assert.equal(plainRow.adult_attested_at, null, 'plain rooms need no confirmation or attestation');
  assert.equal((await q('select age_confirmed_at from public.group_members where id = $1', [plainRoom.host_member_id])).rows[0].age_confirmed_at, null);
  // Attestation flag is ignored for a plain room.
  const plainAttested = (await create(userB, false, true, 'plain-attested')).rows[0];
  assert.equal((await q('select adult_attested_at from public.group_rooms where id = $1', [plainAttested.room_id])).rows[0].adult_attested_at, null);

  // ---- group_join_member ----
  const join = (room, secret, adultConsent, ageTap) => q('select * from public.group_join_member($1, $2, $3, $4, $5)', [room, secret, 'guest', adultConsent, ageTap]);
  await as('anon');
  await expectError(() => join(adultRoom.room_id, 'g0', true, true), /42501|permission denied/, 'anon join');
  await as('service_role');
  await expectError(() => join(adultRoom.room_id, 'g1', true, false), /PARTICIPANT_AGE_REQUIRED/, 'no age tap');
  await expectError(() => q("select * from public.group_join_member($1, 'g1', 'guest', true)", [adultRoom.room_id]), /PARTICIPANT_AGE_REQUIRED/, 'age tap defaults to false');
  await expectError(() => join(adultRoom.room_id, 'g1', false, true), /ADULT_CONSENT_REQUIRED/, 'no consent');
  assert.equal((await q('select member_count from public.group_rooms where id = $1', [adultRoom.room_id])).rows[0].member_count, 1);
  const joined = (await join(adultRoom.room_id, 'g1', true, true)).rows[0];
  assert.ok(joined.age_confirmed_at instanceof Date); assert.equal(joined.adult_confirmed, true); assert.equal(joined.role, 'guest');
  assert.equal((await q('select member_count from public.group_rooms where id = $1', [adultRoom.room_id])).rows[0].member_count, 2);
  const rejoined = (await join(adultRoom.room_id, 'g1', false, false)).rows[0];
  assert.equal(rejoined.id, joined.id, 'same secret returns the existing member');
  assert.equal((await q('select member_count from public.group_rooms where id = $1', [adultRoom.room_id])).rows[0].member_count, 2);
  const plainJoin = (await join(plainRoom.room_id, 'p1', false, false)).rows[0];
  assert.equal(plainJoin.age_confirmed_at, null); assert.equal(plainJoin.adult_confirmed, false);
  const plainTap = (await join(plainRoom.room_id, 'p2', false, true)).rows[0];
  assert.ok(plainTap.age_confirmed_at instanceof Date, 'a tap is stored when offered, even for a plain room');
  // Old function signatures are gone, so a stale deploy cannot bypass the new checks.
  assert.equal((await q("select to_regprocedure('public.group_join_member(uuid,text,text,boolean)') as f")).rows[0].f, null);
  assert.equal((await q("select to_regprocedure('public.group_create_room(uuid,text,text,text,jsonb,boolean,text,text,timestamptz)') as f")).rows[0].f, null);
  // Client roles can never touch the group tables.
  await as('authenticated', userA);
  await expectError(() => q('select * from public.group_rooms'), /42501|permission denied/, 'authenticated read rooms');
  await expectError(() => q('update public.group_members set age_confirmed_at = now()'), /42501|permission denied/, 'authenticated write members');

  // ---- venues_adult_guard ----
  const insertVenue = (owner, enabled, extra = '') => q(`insert into public.venues(owner_id, name, adult_enabled${extra ? ', adult_attested_at' : ''}) values ($1, 'v', $2${extra ? `, ${extra}` : ''}) returning id, adult_enabled, adult_attested_at, adult_attested_by`, [owner, enabled]);
  await as('authenticated', userB);
  await expectError(() => insertVenue(userB, true), /AGE_CONFIRMATION_REQUIRED/, 'unconfirmed owner inserts R18 venue');
  const plainVenue = (await insertVenue(userB, false)).rows[0];
  assert.equal(plainVenue.adult_enabled, false); assert.equal(plainVenue.adult_attested_at, null);
  await expectError(() => q('update public.venues set adult_enabled = true where id = $1', [plainVenue.id]), /AGE_CONFIRMATION_REQUIRED/, 'unconfirmed owner turns R18 on');
  assert.equal((await q('select adult_enabled from public.venues where id = $1', [plainVenue.id])).rows[0].adult_enabled, false);

  await as('authenticated', userA);
  const forged = (await insertVenue(userA, true, "'2000-01-01T00:00:00Z'")).rows[0];
  assert.equal(forged.adult_enabled, true);
  assert.ok(forged.adult_attested_at.getUTCFullYear() >= 2026, 'client-supplied attestation time is replaced by now()');
  assert.equal(forged.adult_attested_by, userA);
  const attestedAt = forged.adult_attested_at.getTime();
  await new Promise((resolve) => setTimeout(resolve, 15));
  // on -> on cannot rewrite the attestation, and unrelated edits keep it.
  await q("update public.venues set adult_attested_at = '2001-01-01T00:00:00Z', adult_attested_by = $2, adult_enabled = true where id = $1", [forged.id, userB]);
  let after = (await q('select adult_attested_at, adult_attested_by from public.venues where id = $1', [forged.id])).rows[0];
  assert.equal(after.adult_attested_at.getTime(), attestedAt); assert.equal(after.adult_attested_by, userA);
  await q("update public.venues set name = 'renamed' where id = $1", [forged.id]);
  after = (await q('select adult_attested_at from public.venues where id = $1', [forged.id])).rows[0];
  assert.equal(after.adult_attested_at.getTime(), attestedAt);
  // A client cannot attest while the flag is off.
  const offAttempt = (await q("insert into public.venues(owner_id, name, adult_enabled, adult_attested_at, adult_attested_by) values ($1, 'off', false, now(), $1) returning adult_attested_at, adult_attested_by", [userA])).rows[0];
  assert.equal(offAttempt.adult_attested_at, null); assert.equal(offAttempt.adult_attested_by, null);
  // Turning it off clears the record; turning it on again re-attests with a new time.
  await q('update public.venues set adult_enabled = false where id = $1', [forged.id]);
  after = (await q('select adult_attested_at, adult_attested_by from public.venues where id = $1', [forged.id])).rows[0];
  assert.equal(after.adult_attested_at, null); assert.equal(after.adult_attested_by, null);
  await q('update public.venues set adult_enabled = true where id = $1', [forged.id]);
  after = (await q('select adult_attested_at from public.venues where id = $1', [forged.id])).rows[0];
  assert.ok(after.adult_attested_at.getTime() > attestedAt);
  // After the owner revokes, existing settings are untouched but re-enabling is refused.
  await q("select public.set_adult_confirmation(false)");
  await q("update public.venues set name = 'still on' where id = $1", [forged.id]);
  assert.equal((await q('select adult_enabled from public.venues where id = $1', [forged.id])).rows[0].adult_enabled, true);
  await q('update public.venues set adult_enabled = false where id = $1', [forged.id]);
  await expectError(() => q('update public.venues set adult_enabled = true where id = $1', [forged.id]), /AGE_CONFIRMATION_REQUIRED/, 're-enable after revoke');
  // Owner scoping still applies: B cannot see or change A's venue.
  await as('authenticated', userB);
  assert.equal((await q('select count(*)::int as n from public.venues where id = $1', [forged.id])).rows[0].n, 0);

  // ---- cascade on account deletion ----
  await as('authenticated', userA);
  await q("select public.set_adult_confirmation(true, 'settings')");
  await as('postgres');
  assert.equal((await q('select count(*)::int as n from public.account_profiles where user_id = $1', [userA])).rows[0].n, 1);
  await q('delete from auth.users where id = $1', [userA]);
  assert.equal((await q('select count(*)::int as n from public.account_profiles where user_id = $1', [userA])).rows[0].n, 0, 'profile row is removed with the auth user');

  console.log('age-confirmation RLS verification passed');
} finally {
  await db.close();
}

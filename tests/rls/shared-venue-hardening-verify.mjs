import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const migration = await readFile(new URL('../../supabase/migrations/202610130001_shared_venue_hardening.sql', import.meta.url), 'utf8');
const lockdown = await readFile(new URL('../../supabase/migrations/202610130002_shared_venue_lockdown.sql', import.meta.url), 'utf8');
const groupCap = await readFile(new URL('../../supabase/migrations/202610130003_group_room_cap.sql', import.meta.url), 'utf8');
const u1 = '00000000-0000-0000-0000-000000000001';
const u2 = '00000000-0000-0000-0000-000000000002';
const setId = '00000000-0000-4000-8000-000000000001';
const venueId = '00000000-0000-4000-8000-000000000010';
const ids = ['date-01','date-02','date-03','date-04','date-05','date-06'];
const cards = JSON.stringify(ids.map((id) => ({ id, text: id, r18: false, kind: 'question' }))).replaceAll("'", "''");
await db.exec(`create schema auth;
create table auth.users(id uuid primary key, email text);
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
create role anon; create role authenticated; create role service_role;
grant usage on schema public,auth to anon,authenticated,service_role;
insert into auth.users values ('${u1}','a@test'),('${u2}','b@test');
create table public.my_sets(id uuid primary key, user_id uuid not null, name text not null, card_ids text[] not null, theme_r18 boolean not null default false, audience text not null default 'group', question_order text not null default 'shuffle', design jsonb);
create table public.custom_cards(id uuid primary key default gen_random_uuid(), user_id uuid not null, text text not null, r18 boolean not null default false);
create table public.shared_sets(id uuid primary key default gen_random_uuid(), owner_id uuid not null, set_id uuid not null, token text unique, token_hash text unique, token_ciphertext text, name text not null, card_count integer not null, adult_only boolean not null default false, cards jsonb not null, question_order text not null default 'shuffle', design jsonb, revoked_at timestamptz);
create table public.venues(id uuid primary key, owner_id uuid not null, name text not null, adult_enabled boolean not null default false);
create table public.venue_sets(id uuid primary key default gen_random_uuid(), venue_id uuid not null, name text not null, cards jsonb not null, card_count integer not null, adult_only boolean not null default false, active boolean not null default true, design jsonb);
create table public.venue_tables(id uuid primary key default gen_random_uuid(), venue_id uuid not null, label text not null, token_hash text not null, token_ciphertext text not null, active boolean not null default true);
create table public.group_rooms(id uuid primary key default gen_random_uuid(), host_user_id uuid not null, expires_at timestamptz not null, status text not null);
create or replace function public.set_shared_set_metadata() returns trigger language plpgsql as $$ begin return new; end; $$;
create or replace function public.create_shared_set(p_set_id uuid,p_token text,p_token_hash text,p_name text,p_card_count integer,p_adult_only boolean,p_cards jsonb,p_rotate boolean default false) returns table(id uuid,token text,name text,card_count integer,adult_only boolean) language sql as $$ select null::uuid,p_token,p_name,p_card_count,p_adult_only $$;
create or replace function public.revoke_shared_set(p_set_id uuid) returns boolean language sql as $$ select true $$;
insert into public.my_sets values ('${setId}','${u1}','theme',array['date-01','date-02','date-03','date-04','date-05','date-06'],true,'group','shuffle',null);
insert into public.shared_sets(owner_id,set_id,token,token_hash,name,card_count,adult_only,cards) values ('${u1}','${setId}',null,'legacy','legacy',6,false,to_jsonb(repeat('x',70000)));`);
// Phase A leaves old authenticated table writes available for cutover compatibility.
await db.exec(`grant all on public.shared_sets,public.venue_sets to authenticated;`);
await db.exec(migration);
await db.exec(`grant all on public.shared_sets,public.venue_sets,public.venues,public.my_sets,public.custom_cards to service_role; grant select,insert,update,delete on public.shared_sets,public.venue_sets to authenticated; grant execute on function public.create_shared_set_server(uuid,uuid,text,text,text,text,jsonb,boolean,text,jsonb,boolean) to service_role; grant execute on function public.create_venue_set_server(uuid,uuid,text,jsonb,boolean,jsonb) to service_role;`);
await db.exec(`insert into public.venues(id,owner_id,name,adult_enabled) values ('${venueId}','${u1}','compat venue',false),('00000000-0000-4000-8000-000000000011','${u2}','other venue',false);`);
let phaseAnonError; try { await db.exec(`set role anon; select public.create_shared_set_server('${u1}','${setId}','${'Z'.repeat(43)}','${'z'.repeat(64)}','iv.tag.payload','x','${cards}'::jsonb,false,'shuffle',null,false)`); } catch (error) { phaseAnonError = error; }
await db.exec('reset role;');
assert.equal(phaseAnonError?.code, '42501', 'Phase A anon new RPC must fail with permission denied');
assert.match(String(phaseAnonError?.message), /permission denied/i);
async function expectDenied(role, sql, label) {
  await db.exec(`set role ${role};`);
  let error;
  try { await db.exec(sql); } catch (caught) { error = caught; }
  await db.exec('reset role;');
  assert.ok(error, `${label}: call unexpectedly succeeded`);
  assert.equal(error.code, '42501', `${label}: wrong error code`);
  assert.match(String(error.message), /permission denied/i, `${label}: not a permission denial`);
}
const validNewCalls = [
  `select public.create_shared_set_server('${u1}','${setId}','${'C'.repeat(43)}','${'c'.repeat(64)}','iv.tag.payload','x','${cards}'::jsonb,false,'shuffle',null,true)`,
  `select public.revoke_shared_set_server('${u1}','${setId}')`,
  `select public.create_venue_set_server('${u1}','${venueId}','x','${cards}'::jsonb,false,null)`,
  `select public.set_venue_set_active_server('${u1}','00000000-0000-4000-8000-000000000099',true)`
];
for (const role of ['anon', 'authenticated']) for (const [index, call] of validNewCalls.entries()) await expectDenied(role, call, `Phase A ${role} new RPC ${index}`);
await expectDenied('authenticated', 'truncate public.shared_sets', 'Phase A shared TRUNCATE');
await expectDenied('authenticated', 'truncate public.venue_sets', 'Phase A venue TRUNCATE');
await db.exec(`set role authenticated; select public.create_shared_set('${setId}','${'K'.repeat(43)}','${'5'.repeat(64)}','legacy-compatible',6,false,'${cards}'::jsonb,false); reset role;`);
await db.exec(`set role authenticated; insert into public.shared_sets(owner_id,set_id,token_hash,name,card_count,adult_only,cards) values ('${u1}',gen_random_uuid(),'phase-a-direct','phase-a',6,false,'${cards}'::jsonb); insert into public.venue_sets(venue_id,name,cards,card_count,adult_only) values ('${venueId}','phase-a-direct','${cards}'::jsonb,6,false); reset role;`);
await db.exec(`set role service_role; select public.create_shared_set_server('${u1}','${setId}','${'A'.repeat(43)}','${'a'.repeat(64)}','iv.tag.payload','theme', '${cards}'::jsonb, true, 'shuffle', null, true);`);
const theme = (await db.query("select adult_only from public.shared_sets where set_id=$1 and revoked_at is null", [setId])).rows[0];
assert.equal(theme.adult_only, true, 'theme R18 must survive safe cards');
let invalid = false; try { await db.exec(`select public.create_shared_set_server('${u1}','${setId}','${'B'.repeat(43)}','${'b'.repeat(64)}','iv.tag.payload','bad','[{"id":"x","text":"x","r18":"true"}]'::jsonb,false,'shuffle',null,true)`); } catch { invalid = true; }
assert.equal(invalid, true);
async function expectServiceReject(call, label, code = '22023') {
  await db.exec('set role service_role;'); let error;
  try { await db.exec(call); } catch (caught) { error = caught; }
  await db.exec('reset role;');
  assert.equal(error?.code, code, `${label}: unexpected error`);
}
const makeCards = (count, edit = () => {}) => JSON.stringify(Array.from({ length: count }, (_, i) => { const card = { id: `id-${i}`, text: `text-${i}`, r18: false }; edit(card, i); return card; })).replaceAll("'", "''");
await expectServiceReject(`select public.create_shared_set_server('${u1}','${setId}','${'D'.repeat(43)}','${'d'.repeat(64)}','iv.tag.payload','bounds','${makeCards(41)}'::jsonb,false,'shuffle',null,true)`, '41 cards');
await expectServiceReject(`select public.create_shared_set_server('${u1}','${setId}','${'E'.repeat(43)}','${'e'.repeat(64)}','iv.tag.payload','duplicate','${makeCards(6, (card, i) => { if (i === 5) card.id = 'id-0'; })}'::jsonb,false,'shuffle',null,true)`, 'duplicate id');
await expectServiceReject(`select public.create_shared_set_server('${u1}','${setId}','${'F'.repeat(43)}','${'f'.repeat(64)}','iv.tag.payload','long','${makeCards(6, (card, i) => { if (i === 0) card.text = 'x'.repeat(301); })}'::jsonb,false,'shuffle',null,true)`, 'text over 300');
await expectServiceReject(`select public.create_shared_set_server('${u1}','${setId}','${'G'.repeat(43)}','${'1'.repeat(64)}','iv.tag.payload','null','null'::jsonb,false,'shuffle',null,true)`, 'null cards');
await expectServiceReject(`select public.create_shared_set_server('${u1}','${setId}','${'H'.repeat(43)}','${'2'.repeat(64)}','iv.tag.payload','huge','${makeCards(6, (card, i) => { if (i === 0) card.extra = 'x'.repeat(70000); })}'::jsonb,false,'shuffle',null,true)`, '64KiB payload');
const legacy = (await db.query("select cards from public.shared_sets where token_hash='legacy'")).rows[0]; assert.equal(JSON.stringify(legacy.cards).length > 65536, true, 'legacy oversized row unchanged');
await db.exec(`set role service_role;
insert into public.shared_sets(owner_id,set_id,token_hash,name,card_count,adult_only,cards)
select '${u1}',gen_random_uuid(),md5(i::text),'cap-'||i,6,false,'${cards}'::jsonb from generate_series(1,97) i;
insert into public.venue_sets(venue_id,name,cards,card_count,adult_only)
select '${venueId}','cap-'||i,'${cards}'::jsonb,6,false from generate_series(1,99) i;`);
await expectServiceReject(`select public.create_shared_set_server('${u1}','${setId}','${'I'.repeat(43)}','${'3'.repeat(64)}','iv.tag.payload','cap','${cards}'::jsonb,false,'shuffle',null,true)`, 'shared owner cap', '54000');
await expectServiceReject(`select public.create_venue_set_server('${u1}','${venueId}','cap','${cards}'::jsonb,false,null)`, 'venue cap', '54000');
await db.exec(`set role service_role; select public.create_venue_set_server('${u2}','00000000-0000-4000-8000-000000000011','other','${cards}'::jsonb,false,null); reset role;`);
// Phase B closes table DML and all old RPCs.
await db.exec('reset role;');
await db.exec(lockdown);
await db.exec(`set role authenticated; set request.jwt.claim.sub = '${u1}';`);
await expectDenied('authenticated', `insert into public.shared_sets(owner_id,set_id,token_hash,name,card_count,cards) values ('${u1}','${setId}','direct-insert','x',6,'${cards}'::jsonb)`, 'Phase B shared INSERT');
await expectDenied('authenticated', `update public.shared_sets set name='changed' where token_hash='legacy'`, 'Phase B shared UPDATE');
await expectDenied('authenticated', `delete from public.shared_sets where token_hash='legacy'`, 'Phase B shared DELETE');
await expectDenied('authenticated', `insert into public.venue_sets(venue_id,name,cards,card_count) values ('${venueId}','x','${cards}'::jsonb,6)`, 'Phase B venue INSERT');
await expectDenied('authenticated', `update public.venue_sets set name='changed' where venue_id='${venueId}'`, 'Phase B venue UPDATE');
await expectDenied('authenticated', `delete from public.venue_sets where venue_id='${venueId}'`, 'Phase B venue DELETE');
await expectDenied('authenticated', 'truncate public.shared_sets', 'Phase B shared TRUNCATE');
await expectDenied('authenticated', 'truncate public.venue_sets', 'Phase B venue TRUNCATE');
await expectDenied('anon', `select public.create_shared_set('${setId}','${'J'.repeat(43)}','${'4'.repeat(64)}','x',6,false,'${cards}'::jsonb,false)`, 'Phase B old RPC');
await expectDenied('authenticated', `select public.create_shared_set('${setId}','${'L'.repeat(43)}','${'6'.repeat(64)}','x',6,false,'${cards}'::jsonb,false)`, 'Phase B old RPC authenticated');
await expectDenied('authenticated', `select public.revoke_shared_set('${setId}')`, 'Phase B old revoke RPC authenticated');
await db.exec('reset role;');
await db.exec(groupCap);
await db.exec('grant all on public.group_rooms to service_role;');
await db.exec(`set role service_role; insert into public.group_rooms(host_user_id,expires_at,status) select '${u1}',now()+interval '1 hour','lobby' from generate_series(1,20);`);
let groupCapDenied = false; try { await db.exec(`insert into public.group_rooms(host_user_id,expires_at,status) values ('${u1}',now()+interval '1 hour','lobby')`); } catch (error) { groupCapDenied = error.code === '54000'; }
assert.equal(groupCapDenied, true, 'group owner active cap');
await db.exec(`insert into public.group_rooms(host_user_id,expires_at,status) values ('${u1}',now()-interval '1 hour','lobby'),('${u1}',now()+interval '1 hour','ended'),('${u2}',now()+interval '1 hour','lobby');`);
await db.exec('reset role;');
console.log('SHARED_VENUE_HARDENING_PGLITE_ASSERTIONS_OK');
await db.close();

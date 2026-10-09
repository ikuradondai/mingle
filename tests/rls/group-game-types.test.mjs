import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const owner = '11111111-1111-4111-8111-111111111111';
const pairs = JSON.stringify(Array.from({ length: 6 }, (_, i) => ({ majority: `多数${i}`, minority: `少数${i}` })));
const db = new PGlite();
await db.waitReady;
await db.exec(`create schema auth;
create table auth.users (id uuid primary key, email text);
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create role anon; create role authenticated; create role service_role bypassrls;
grant usage on schema public, auth to anon, authenticated, service_role;
insert into auth.users(id,email) values ('${owner}','owner@test');`);
for (const file of ['202610080001_group_rooms.sql', '202610150001_minority_topic.sql', '202610160001_question_wolf.sql', '202610170001_group_game_types.sql']) {
  await db.exec(await readFile(new URL(`../../supabase/migrations/${file}`, import.meta.url), 'utf8'));
}

test('group_rooms.game_type CHECK is a single constraint covering the six game types', async () => {
  const defs = (await db.query(`select pg_get_constraintdef(oid) as def from pg_constraint where conrelid='public.group_rooms'::regclass and conname='group_rooms_game_type'`)).rows;
  assert.equal(defs.length, 1);
  for (const type of ['cards', 'minority_topic', 'question_wolf', 'ochi_kara', 'one_cut', 'mission_mingle']) assert.ok(defs[0].def.includes(`'${type}'`), type);
  const count = (await db.query(`select count(*)::int as n from pg_constraint where conrelid='public.group_rooms'::regclass and contype='c' and pg_get_constraintdef(oid) like '%game_type%'`)).rows[0].n;
  assert.equal(count, 1);
});

test('new game types are accepted by the table and unknown ones are rejected', async () => {
  for (const [i, type] of ['ochi_kara', 'one_cut', 'mission_mingle'].entries()) {
    const room = (await db.query(`select * from public.question_wolf_create_room('${owner}','inv-${i}','sec-${i}','Host',now()+interval '1 hour','${pairs}'::jsonb)`)).rows[0];
    await db.query(`update public.group_rooms set game_type='${type}' where id='${room.room_id}'`);
    assert.equal((await db.query(`select game_type from public.group_rooms where id='${room.room_id}'`)).rows[0].game_type, type);
  }
  await assert.rejects(() => db.query(`update public.group_rooms set game_type='bogus'`));
});

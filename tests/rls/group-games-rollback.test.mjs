import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { oneCutScenes } from '../../dist/data/one-cut-scenes.js';

// Runs the rollback SQL documented in docs/GROUP_PLAY_SETUP.md against a database that has every migration
// (group rooms -> minority -> question wolf -> game types -> ochi -> one cut -> mission) applied, as production will.
const owner = '11111111-1111-4111-8111-111111111111';
const FILES = ['202610080001_group_rooms.sql', '202610150001_minority_topic.sql', '202610160001_question_wolf.sql', '202610170001_group_game_types.sql', '202610170002_ochi_kara.sql', '202610170003_one_cut.sql', '202610170004_mission_mingle.sql'];
const ochiPool = Array.from({ length: 40 }, (_, i) => ({ id: `ochi-${String(i + 1).padStart(3, '0')}`, text: `オチ${i}`, category: ['food', 'place', 'thing', 'oops'][i % 4] }));
const scenes = oneCutScenes.map(({ id, text, category, expression, similarGroup }) => ({ id, text, category, expression, ...(similarGroup ? { similarGroup } : {}) }));
const wolfPairs = JSON.stringify(Array.from({ length: 6 }, (_, i) => ({ majority: `多数${i}`, minority: `少数${i}` })));

const doc = (await readFile(new URL('../../docs/GROUP_PLAY_SETUP.md', import.meta.url), 'utf8')).split(String.fromCharCode(13)).join('');
const block = doc.match(/-- rollback-group-games: begin\n([\s\S]*?)-- rollback-group-games: end/);
assert.ok(block, 'rollback SQL block not found in docs/GROUP_PLAY_SETUP.md');
const rollbackSql = block[1];

const db = new PGlite();
await db.waitReady;
await db.exec(`create schema auth;
create table auth.users (id uuid primary key, email text);
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create role anon; create role authenticated; create role service_role bypassrls;
grant usage on schema public, auth to anon, authenticated, service_role;
insert into auth.users(id,email) values ('${owner}','owner@test');`);
for (const file of FILES) await db.exec(await readFile(new URL(`../../supabase/migrations/${file}`, import.meta.url), 'utf8'));

const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const count = async (sql) => Number((await one(sql)).n);
const GAME_OBJECTS = `p.proname ~ '^(ochi|one_cut|mission)_'`;

test('rollback removes every new-game room, table and function and restores the three-type CHECK', async () => {
  const wolf = await one(`select * from public.question_wolf_create_room($1,'wolf-inv','wolf-sec','Host',now()+interval '1 hour',$2::jsonb)`, [owner, wolfPairs]);
  await one(`select * from public.ochi_create_room($1,'o-inv','o-sec','Host',now()+interval '1 hour',$2::jsonb,1)`, [owner, JSON.stringify(ochiPool)]);
  await one(`select * from public.one_cut_create_room($1,'c-inv','c-sec','Host',now()+interval '1 hour',$2::jsonb,1,'slate','solo_actor')`, [owner, JSON.stringify(scenes)]);
  await one(`select * from public.mission_create_room($1,'m-inv','m-sec','Host',now()+interval '1 hour','{}'::jsonb)`, [owner]);
  assert.equal(await count(`select count(*)::int n from public.group_rooms where game_type in ('ochi_kara','one_cut','mission_mingle')`), 3);
  assert.ok(await count(`select count(*)::int n from public.ochi_games`) >= 1);
  assert.ok(await count(`select count(*)::int n from pg_proc p join pg_namespace s on s.oid=p.pronamespace where s.nspname='public' and ${GAME_OBJECTS}`) > 30);

  await db.exec(rollbackSql);

  assert.equal(await count(`select count(*)::int n from public.group_rooms where game_type in ('ochi_kara','one_cut','mission_mingle')`), 0);
  assert.equal(await count(`select count(*)::int n from pg_proc p join pg_namespace s on s.oid=p.pronamespace where s.nspname='public' and ${GAME_OBJECTS}`), 0);
  assert.equal(await count(`select count(*)::int n from information_schema.tables where table_schema='public' and table_name ~ '^(ochi|one_cut|mission)_'`), 0);
  // the existing games are untouched
  assert.equal((await one('select game_type from public.group_rooms where id=$1', [wolf.room_id])).game_type, 'question_wolf');
  assert.ok(await count(`select count(*)::int n from pg_proc p join pg_namespace s on s.oid=p.pronamespace where s.nspname='public' and p.proname like 'question_wolf_%'`) > 0);
  assert.ok(await count(`select count(*)::int n from pg_proc p join pg_namespace s on s.oid=p.pronamespace where s.nspname='public' and p.proname like 'minority_%'`) > 0);
  // the CHECK is back to exactly the original three types, and is validated
  const def = await one(`select pg_get_constraintdef(oid) as def, convalidated from pg_constraint where conrelid='public.group_rooms'::regclass and conname='group_rooms_game_type'`);
  for (const type of ['cards', 'minority_topic', 'question_wolf']) assert.ok(def.def.includes(`'${type}'`), type);
  for (const type of ['ochi_kara', 'one_cut', 'mission_mingle']) assert.ok(!def.def.includes(`'${type}'`), type);
  assert.equal(def.convalidated, true);
  await assert.rejects(() => db.query(`update public.group_rooms set game_type='ochi_kara' where id=$1`, [wolf.room_id]));
});

test('the rollback SQL can be run twice and the migrations can be applied again afterwards', async () => {
  await db.exec(rollbackSql);
  for (const file of FILES.slice(3)) await db.exec(await readFile(new URL(`../../supabase/migrations/${file}`, import.meta.url), 'utf8'));
  assert.ok(await count(`select count(*)::int n from pg_proc p join pg_namespace s on s.oid=p.pronamespace where s.nspname='public' and ${GAME_OBJECTS}`) > 30);
  await one(`select * from public.mission_create_room($1,'m2-inv','m2-sec','Host',now()+interval '1 hour','{}'::jsonb)`, [owner]);
});

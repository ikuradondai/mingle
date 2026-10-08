import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const owner = '11111111-1111-4111-8111-111111111111';
const guestA = '22222222-2222-4222-8222-222222222222';
const guestB = '33333333-3333-4333-8333-333333333333';
const roomId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const pairs = Array.from({ length: 6 }, (_, i) => ({ majority: `多数質問${i}`, minority: `少数質問${i}` }));
let createdRoomId = '';

const db = new PGlite();
await db.waitReady;
await db.exec(`create schema auth;
create table auth.users (id uuid primary key, email text);
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create role anon; create role authenticated; create role service_role bypassrls;
grant usage on schema public, auth to anon, authenticated, service_role;
insert into auth.users(id,email) values ('${owner}','owner@test'),('${guestA}','a@test'),('${guestB}','b@test');`);
await db.exec(await readFile(new URL('../../supabase/migrations/202610080001_group_rooms.sql', import.meta.url), 'utf8'));
await db.exec(await readFile(new URL('../../supabase/migrations/202610150001_minority_topic.sql', import.meta.url), 'utf8'));
await db.exec(await readFile(new URL('../../supabase/migrations/202610160001_question_wolf.sql', import.meta.url), 'utf8'));

async function call(sql) {
  return db.query(sql);
}
async function fails(sql, message) {
  await assert.rejects(() => call(sql), undefined, message);
}
async function createFixture(invite) {
  const row = (await call(`select * from public.question_wolf_create_room('${owner}','${invite}','${invite}-secret','Host',now()+interval '1 hour','${JSON.stringify(pairs)}'::jsonb)`)).rows[0];
  await db.exec(`set role service_role; insert into public.group_members(room_id,secret_hash,display_name,role) values ('${row.room_id}','${invite}-a','A','guest'),('${row.room_id}','${invite}-b','B','guest');`);
  const memberRows = (await call(`select id from public.group_members where room_id='${row.room_id}' order by id`)).rows;
  return { roomId: row.room_id, host: (await call(`select id from public.group_members where secret_hash='${invite}-secret'`)).rows[0].id, members: memberRows.map((item) => item.id) };
}

test('question wolf RLS denies direct client access and service role can create a room', async () => {
  await db.exec('set role anon');
  await fails('select * from public.question_wolf_games', 'anon cannot read private game state');
  await fails(`select * from public.question_wolf_create_room('${owner}','invite','secret','Host',now()+interval '1 hour','${JSON.stringify(pairs)}'::jsonb)`, 'anon cannot call service-only RPC');
  await db.exec('set role service_role');
  const created = await call(`select * from public.question_wolf_create_room('${owner}','invite','secret','Host',now()+interval '1 hour','${JSON.stringify(pairs)}'::jsonb)`);
  assert.equal(created.rows.length, 1);
  assert.ok(created.rows[0].room_id);
  createdRoomId = created.rows[0].room_id;
});

test('question wolf enforces 3-player assignment, turn, six-round and vote lifecycle', async () => {
  await db.exec(`set role service_role; insert into public.group_members(room_id,secret_hash,display_name,role) values ('${createdRoomId}','a-secret','A','guest'),('${createdRoomId}','b-secret','B','guest') on conflict do nothing;`);
  const host = (await call("select id from public.group_members where secret_hash='secret'")).rows[0].id;
  const members = (await call(`select id from public.group_members where room_id='${createdRoomId}' order by id`)).rows.map((row) => row.id);
  assert.equal(members.length, 3);
  const assignments = Object.fromEntries(members.map((id, index) => [id, { role: index === 0 ? 'minority' : 'majority', question: index === 0 ? pairs[0].minority : pairs[0].majority }]));
  const assigned = JSON.stringify(assignments);
  await fails(`select * from public.question_wolf_start_round('${createdRoomId}',1,'Q majority','Q minority','{}'::jsonb,'["0"]'::jsonb,0)`, 'incomplete assignment is rejected');
  const started = await call(`select * from public.question_wolf_start_round('${createdRoomId}',1,'${pairs[0].majority}','${pairs[0].minority}','${assigned}'::jsonb,'["0"]'::jsonb,0)`);
  assert.equal(started.rows[0].round_no, 1);
  for (const id of members) await call(`select public.question_wolf_confirm('${createdRoomId}',1,'${id}')`);
  const room = (await call(`select revision from public.group_rooms where id='${createdRoomId}'`)).rows[0];
  const round = (await call(`select answer_order from public.question_wolf_rounds where room_id='${createdRoomId}'`)).rows[0].answer_order;
  let revision = room.revision;
  const guestCurrent = round.find((id) => id !== host);
  if (round[0] !== guestCurrent) { await call(`select public.question_wolf_answer('${createdRoomId}',1,'${round[0]}'::uuid,${revision})`); revision += 1; }
  const nonCurrent = members.find((id) => id !== guestCurrent && id !== host);
  await fails(`select public.question_wolf_answer('${createdRoomId}',1,'${nonCurrent}',${revision})`, 'non-turn participant cannot answer');
  await call(`select public.question_wolf_answer('${createdRoomId}',1,'${guestCurrent}'::uuid,${revision})`);
  revision += 1;
  await fails(`select public.question_wolf_answer('${createdRoomId}',1,'${guestCurrent}'::uuid,${revision})`, 'duplicate answer cannot advance twice');
  while (revision < room.revision + 3) { await call(`select public.question_wolf_answer('${createdRoomId}',1,'${host}'::uuid,${revision})`); revision += 1; }
  assert.equal(round.length, 3);
  await fails(`select public.question_wolf_open_vote('${createdRoomId}',1,'${host}',${revision})`, 'discussion deadline blocks early vote');
  await db.exec(`update public.question_wolf_rounds set discussion_deadline=now()-interval '1 second' where room_id='${createdRoomId}'`);
  await call(`select public.question_wolf_open_vote('${createdRoomId}',1,'${host}',${revision})`);
  revision += 1;
  for (const [index, voter] of members.entries()) {
    await call(`select public.question_wolf_cast_vote('${createdRoomId}'::uuid,1,'${voter}'::uuid,'${members[(index + 1) % members.length]}'::uuid,${revision})`);
    revision += 1;
  }
  const result = await call(`select status from public.question_wolf_rounds where room_id='${createdRoomId}'`);
  assert.equal(result.rows[0].status, 'result');
  await call(`select public.question_wolf_finish('${createdRoomId}',1,'${host}'::uuid,${revision})`);
  assert.equal((await call(`select count(*)::int as count from public.question_wolf_rounds where room_id='${createdRoomId}'`)).rows[0].count, 0);
  assert.equal((await call(`select count(*)::int as count from public.question_wolf_votes where round_id in (select id from public.question_wolf_rounds where room_id='${createdRoomId}')`)).rows[0].count, 0);
  assert.equal((await call(`select status from public.group_rooms where id='${createdRoomId}'`)).rows[0].status, 'ended');
});

test('question wolf rejects undersized, expired, stale-pair, foreign-assignment, and wrong-round actions', async () => {
  await db.exec('set role service_role');
  const small = await createFixture('small-room');
  await db.exec(`delete from public.group_members where room_id='${small.roomId}' and secret_hash='small-room-b'`);
  const smallAssignments = JSON.stringify(Object.fromEntries([[small.members[0], { role: 'minority', question: 'x' }], [small.members[1], { role: 'majority', question: 'y' }]]));
  await fails(`select * from public.question_wolf_start_round('${small.roomId}',1,'A','B','${smallAssignments}'::jsonb,'["0"]'::jsonb,0)`, 'two-player room cannot start');

  const expired = await createFixture('expired-room');
  await db.exec(`update public.group_rooms set expires_at=now()-interval '1 second' where id='${expired.roomId}'`);
  const expiredAssignments = JSON.stringify(Object.fromEntries(expired.members.map((id, index) => [id, { role: index === 0 ? 'minority' : 'majority', question: index === 0 ? 'B' : 'A' }])));
  await fails(`select * from public.question_wolf_start_round('${expired.roomId}',1,'A','B','${expiredAssignments}'::jsonb,'["0"]'::jsonb,0)`, 'expired room cannot start');

  const invalid = await createFixture('invalid-room');
  const foreign = '44444444-4444-4444-8444-444444444444';
  const foreignAssignments = JSON.stringify({ [foreign]: { role: 'minority', question: pairs[0].minority }, [invalid.members[1]]: { role: 'majority', question: pairs[0].majority }, [invalid.members[2]]: { role: 'majority', question: pairs[0].majority } });
  await fails(`select * from public.question_wolf_start_round('${invalid.roomId}',1,'${pairs[0].majority}','${pairs[0].minority}','${foreignAssignments}'::jsonb,'["0"]'::jsonb,0)`, 'assignment must contain exactly room members');
  const nullAssignments = JSON.stringify(Object.fromEntries(invalid.members.map((id, index) => [id, { role: index === 0 ? 'minority' : 'majority', question: index === 0 ? pairs[0].minority : pairs[0].majority }])));
  const nullPayload = nullAssignments.replace('"role":"minority"', '"role":null').replace('"question":"' + pairs[0].majority + '"', '"question":null');
  await fails(`select * from public.question_wolf_start_round('${invalid.roomId}',1,'${pairs[0].majority}','${pairs[0].minority}','${nullPayload}'::jsonb,'["0"]'::jsonb,0)`, 'null role/question is rejected');
  const validAssignments = JSON.stringify(Object.fromEntries(invalid.members.map((id, index) => [id, { role: index === 0 ? 'minority' : 'majority', question: index === 0 ? pairs[0].minority : pairs[0].majority }])));
  await call(`select * from public.question_wolf_start_round('${invalid.roomId}',1,'${pairs[0].majority}','${pairs[0].minority}','${validAssignments}'::jsonb,'["0"]'::jsonb,0)`);
  const rev = (await call(`select revision from public.group_rooms where id='${invalid.roomId}'`)).rows[0].revision;
  await fails(`select * from public.question_wolf_finish('${invalid.roomId}',2,'${invalid.host}'::uuid,${rev})`, 'finish rejects wrong round');
  await fails(`select * from public.question_wolf_start_round('${invalid.roomId}',2,'${pairs[0].majority}','${pairs[0].minority}','${validAssignments}'::jsonb,'["0","0"]'::jsonb,${rev})`, 'duplicate used pair is rejected');
  await fails(`select * from public.question_wolf_start_round('${invalid.roomId}',7,'${pairs[5].majority}','${pairs[5].minority}','${validAssignments}'::jsonb,'[0,1,2,3,4,5,6]'::jsonb,${rev})`, 'round seven is rejected');
});

test.after(async () => { await db.close(); });

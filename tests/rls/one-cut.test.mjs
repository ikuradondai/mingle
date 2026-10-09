import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { oneCutScenes } from '../../dist/data/one-cut-scenes.js';
import { pickSceneSet, scoreSoloTake } from '../../dist/one-cut-rules.js';

// Applies group-rooms -> minority -> question-wolf -> game-types -> ochi -> one-cut, as production does.
const owner = '11111111-1111-4111-8111-111111111111';
const scenes = oneCutScenes.map(({ id, text, category, expression, similarGroup }) => ({ id, text, category, expression, ...(similarGroup ? { similarGroup } : {}) }));
const FILES = ['202610080001_group_rooms.sql', '202610150001_minority_topic.sql', '202610160001_question_wolf.sql', '202610170001_group_game_types.sql', '202610170002_ochi_kara.sql', '202610170003_one_cut.sql'];

const db = new PGlite();
await db.waitReady;
await db.exec(`create schema auth;
create table auth.users (id uuid primary key, email text);
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create role anon; create role authenticated; create role service_role bypassrls;
grant usage on schema public, auth to anon, authenticated, service_role;
insert into auth.users(id,email) values ('${owner}','owner@test');`);
for (const file of FILES) await db.exec(await readFile(new URL(`../../supabase/migrations/${file}`, import.meta.url), 'utf8'));
// the migrations are meant to be re-appliable: running the new one a second time must not break anything
await db.exec(await readFile(new URL('../../supabase/migrations/202610170003_one_cut.sql', import.meta.url), 'utf8'));
await db.exec('set role service_role');

// deterministic randomness so every run picks the same sets
let seed = 12345;
const random = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };

const q = (sql, params = []) => db.query(sql, params);
const one = async (sql, params) => (await q(sql, params)).rows[0];
async function fails(sql, params, code) {
  await assert.rejects(() => q(sql, params), (error) => { assert.ok(String(error.message).includes(code), `expected ${code}, got ${error.message}`); return true; }, `${code}: ${sql}`);
}
const rpc = (name, ...args) => q(`select public.${name}(${args.map((_, i) => `$${i + 1}`).join(',')})`, args);
const revision = async (roomId) => Number((await one('select revision from public.group_rooms where id=$1', [roomId])).revision);
const game = (roomId) => one('select * from public.one_cut_games where room_id=$1', [roomId]);
const takeRow = (roomId, no) => one('select * from public.one_cut_takes where room_id=$1 and take_no=$2', [roomId, no]);
const room = (roomId) => one('select * from public.group_rooms where id=$1', [roomId]);
// the closing screen's data kept for 5 minutes after the game ends (the game row itself is deleted at once)
const kept = (roomId) => one('select * from public.one_cut_results where room_id=$1', [roomId]);
const gameRows = async (roomId) => (await one('select count(*)::int n from public.one_cut_games where room_id=$1', [roomId])).n;
const counts = async (roomId) => ({
  takes: (await one('select count(*)::int n from public.one_cut_takes where room_id=$1', [roomId])).n,
  votes: (await one('select count(*)::int n from public.one_cut_votes v join public.group_members m on m.id=v.voter_id where m.room_id=$1', [roomId])).n,
  likes: (await one('select count(*)::int n from public.one_cut_likes where room_id=$1', [roomId])).n
});

let counter = 0;
async function fixture({ members = 3, lapsTotal = 1 } = {}) {
  counter += 1; const tag = `fx${counter}`;
  const created = await one(`select * from public.one_cut_create_room($1,$2,$3,'Host',now()+interval '1 hour',$4::jsonb,$5,'slate','solo_actor')`, [owner, tag, `${tag}-host`, JSON.stringify(scenes), lapsTotal]);
  for (let i = 1; i < members; i += 1) await q(`insert into public.group_members(room_id,secret_hash,display_name,role) values ($1,$2,$3,'guest')`, [created.room_id, `${tag}-g${i}`, `G${i}`]);
  await q('update public.group_rooms set member_count=$2 where id=$1', [created.room_id, members]);
  const ids = (await q(`select id from public.group_members where room_id=$1 order by (role='host') desc, joined_at, id`, [created.room_id])).rows.map((row) => row.id);
  return { roomId: created.room_id, host: created.host_member_id, ids, n: members };
}
// The next take's arguments, built like the server does: real pickSceneSet over the room's own snapshot and used arrays.
async function nextTake(fx, takeNo, { releaseAnswerOf = null } = {}) {
  const g = await game(fx.roomId);
  let usedAnswerIds = g.used_answer_ids;
  if (releaseAnswerOf) { const t = await takeRow(fx.roomId, releaseAnswerOf); usedAnswerIds = usedAnswerIds.filter((id) => id !== t.options[t.answer_index]); }
  const set = pickSceneSet({ scenes: g.scenes, usedAnswerIds, usedOptionIds: g.used_option_ids, random });
  const lapNo = Math.floor((takeNo - 1) / fx.n) + 1;
  return { takeNo, lapNo, actorId: fx.ids[(takeNo - 1) % fx.n], options: set.options, answerIndex: set.answerIndex, assignments: null, startStyle: 'slate' };
}
const startTakeSql = 'select public.one_cut_start_take($1,$2,$3,$4,$5,$6::jsonb,$7,null,$8,$9)';
const startTakeArgs = (fx, memberId, t, rev = null) => [fx.roomId, memberId, t.takeNo, t.lapNo, t.actorId, JSON.stringify(t.options), t.answerIndex, t.startStyle, rev];
async function startGame(fx) {
  const t = await nextTake(fx, 1);
  await q(startTakeSql, startTakeArgs(fx, fx.host, t, await revision(fx.roomId)));
  return t;
}
const startedAt = () => new Date(Date.now() + 1000).toISOString();
const ready = async (fx, takeNo, memberId) => rpc('one_cut_ready', fx.roomId, takeNo, memberId, startedAt());
// moves the clocks of the current take into the past, as if the shoot / vote windows had run out
const rewind = (fx, takeNo, seconds) => q(`update public.one_cut_takes set take_started_at=take_started_at-($3||' seconds')::interval, action_at=action_at-($3||' seconds')::interval, cut_at=cut_at-($3||' seconds')::interval, vote_deadline=vote_deadline-($3||' seconds')::interval where room_id=$1 and take_no=$2`, [fx.roomId, takeNo, String(seconds)]);
// plays one take to its result. choices: { memberId: 0..5 | null }
async function playTake(fx, takeNo, choices) {
  const t = await takeRow(fx.roomId, takeNo);
  await ready(fx, takeNo, t.actor_member_id);
  await rewind(fx, takeNo, 11);
  await rpc('one_cut_expire', fx.roomId, takeNo);
  assert.equal((await game(fx.roomId)).phase, 'vote');
  for (const [voter, choice] of Object.entries(choices)) await rpc('one_cut_cast_vote', fx.roomId, takeNo, voter, choice);
  if ((await game(fx.roomId)).phase !== 'result') await rpc('one_cut_close_vote', fx.roomId, takeNo, fx.host);
  return takeRow(fx.roomId, takeNo);
}
const nextAfter = async (fx, takeNo, memberId) => {
  const t = await nextTake(fx, takeNo + 1);
  await q(startTakeSql, startTakeArgs(fx, memberId, t, null));
  return t;
};

test('one_cut tables and RPCs are service_role only; internal helpers are callable by nobody', async () => {
  const fx = await fixture();
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`);
    for (const table of ['one_cut_games', 'one_cut_takes', 'one_cut_votes', 'one_cut_likes', 'one_cut_results']) await fails(`select * from public.${table}`, [], 'permission denied');
    await fails(`insert into public.one_cut_games(room_id,scenes) values ('${fx.roomId}','[]')`, [], 'permission denied');
    await fails('select public.one_cut_ready($1,1,$2,now())', [fx.roomId, fx.host], 'permission denied');
    await fails('select public.one_cut_cast_vote($1,1,$2,0)', [fx.roomId, fx.host], 'permission denied');
    await fails('select public.one_cut_skip($1,1,$2,null)', [fx.roomId, fx.host], 'permission denied');
    await fails('select public.one_cut_finish($1,$2,0)', [fx.roomId, fx.host], 'permission denied');
    await fails('select public.one_cut_state($1,$2)', [fx.roomId, fx.host], 'permission denied');
    await fails(`select * from public.one_cut_create_room($1,'i','s','H',now()+interval '1 hour','[]'::jsonb,1,'slate','solo_actor')`, [owner], 'permission denied');
  }
  await db.exec('set role service_role');
  for (const fn of ['one_cut_finalize($1)', 'one_cut_member_order($1)', 'one_cut_insert_take($1,null)']) await fails(`select public.${fn}`, [fx.roomId], 'permission denied');
  for (const table of ['one_cut_games', 'one_cut_takes', 'one_cut_votes', 'one_cut_likes', 'one_cut_results']) assert.equal((await one(`select relrowsecurity from pg_class where oid='public.${table}'::regclass`)).relrowsecurity, true, table);
  const r = await room(fx.roomId);
  assert.equal(r.game_type, 'one_cut'); assert.equal(r.adult_only, false); assert.equal(r.deck_id, 'one_cut');
  assert.ok(r.cards.length >= 6 && r.cards.length <= 40);
  const g = await game(fx.roomId);
  assert.equal(g.phase, 'lobby'); assert.equal(g.mode, 'solo_actor'); assert.equal(g.laps_auto, false);
  assert.equal(g.scenes.length, scenes.length);
});

test('create validates scenes, laps, style and mode; null laps means auto', async () => {
  const create = (scenesValue, laps, style = 'slate', mode = 'solo_actor') => fails(`select * from public.one_cut_create_room($1,'v','v','H',now()+interval '1 hour',$2::jsonb,$3,$4,$5)`, [owner, JSON.stringify(scenesValue), laps, style, mode], 'ONE_CUT_INVALID');
  await create(scenes.slice(0, 5), 1);
  await create(scenes, 4);
  await create(scenes, 0);
  await create(scenes, 1, 'f1');
  await create(scenes, 1, 'slate', 'ensemble');
  await create([...scenes.slice(0, 5), { ...scenes[0] }], 1);
  await create([...scenes.slice(0, 5), { id: 'x', text: 'no category', expression: 'joy' }], 1);
  await create([...scenes.slice(0, 5), { ...scenes[5], id: 'Bad ID' }], 1);
  const auto = await one(`select * from public.one_cut_create_room($1,'auto','auto-h','H',now()+interval '1 hour',$2::jsonb,null,'slate','solo_actor')`, [owner, JSON.stringify(scenes)]);
  const g = await game(auto.room_id);
  assert.equal(g.laps_auto, true);
});

test('start: host only, current revision, 2-8 players, resolves auto laps, zeroes scores, verifies actor and options', async () => {
  const solo = await fixture({ members: 1 });
  const soloTake = await nextTake({ ...solo, n: 2, ids: [solo.host, solo.host] }, 1);
  await fails(startTakeSql, startTakeArgs(solo, solo.host, { ...soloTake, actorId: solo.host }, await revision(solo.roomId)), 'ONE_CUT_PARTICIPANTS');
  const fx = await fixture({ members: 3 });
  const t = await nextTake(fx, 1);
  const rev = await revision(fx.roomId);
  await fails(startTakeSql, startTakeArgs(fx, fx.ids[1], t, rev), 'FORBIDDEN');
  await fails(startTakeSql, startTakeArgs(fx, fx.host, t, rev - 1), 'GROUP_STALE');
  await fails(startTakeSql, startTakeArgs(fx, fx.host, t, null), 'GROUP_STALE');
  await fails(startTakeSql, startTakeArgs(fx, fx.host, { ...t, takeNo: 2 }, rev), 'ONE_CUT_STALE_TAKE');
  await fails(startTakeSql, startTakeArgs(fx, fx.host, { ...t, actorId: fx.ids[1] }, rev), 'ONE_CUT_INVALID'); // rotation: take 1 belongs to the host
  await fails(startTakeSql, startTakeArgs(fx, fx.host, { ...t, lapNo: 2 }, rev), 'ONE_CUT_INVALID');
  await fails(startTakeSql, startTakeArgs(fx, fx.host, { ...t, options: t.options.slice(0, 5) }, rev), 'ONE_CUT_INVALID');
  await fails(startTakeSql, startTakeArgs(fx, fx.host, { ...t, options: [...t.options.slice(0, 5), t.options[0]] }, rev), 'ONE_CUT_INVALID');
  await fails(startTakeSql, startTakeArgs(fx, fx.host, { ...t, options: [...t.options.slice(0, 5), 'no-such-scene'] }, rev), 'ONE_CUT_INVALID');
  await fails(startTakeSql, startTakeArgs(fx, fx.host, { ...t, answerIndex: 6 }, rev), 'ONE_CUT_INVALID');
  await fails(startTakeSql, startTakeArgs(fx, fx.host, { ...t, startStyle: 'f1' }, rev), 'ONE_CUT_INVALID');
  assert.equal((await game(fx.roomId)).phase, 'lobby'); assert.equal((await counts(fx.roomId)).takes, 0);
  await q(startTakeSql, startTakeArgs(fx, fx.host, t, rev));
  const g = await game(fx.roomId);
  assert.equal(g.phase, 'brief'); assert.equal(g.take_no, 1); assert.equal(g.lap_no, 1);
  assert.deepEqual(g.scores, Object.fromEntries(fx.ids.map((id) => [id, 0])));
  assert.equal((await room(fx.roomId)).status, 'playing');
  assert.ok((await room(fx.roomId)).revision > rev);
  const take = await takeRow(fx.roomId, 1);
  assert.equal(take.status, 'brief'); assert.equal(take.actor_member_id, fx.host);
  assert.deepEqual(take.options, t.options);
  assert.deepEqual(take.option_texts, t.options.map((id) => scenes.find((scene) => scene.id === id).text)); // texts come from the snapshot, not the caller
  assert.equal(g.used_answer_ids.length, 1); assert.equal(g.used_answer_ids[0], t.options[t.answerIndex]);
  assert.deepEqual([...g.used_option_ids].sort(), [...t.options].sort());
  await fails(startTakeSql, startTakeArgs(fx, fx.host, t, await revision(fx.roomId)), 'ONE_CUT_STALE_TAKE'); // a second start
  // auto laps resolve from the player count: 2..4 -> 2 laps, 5..8 -> 1 lap; an explicit choice is kept
  for (const [members, expected] of [[2, 2], [4, 2], [5, 1], [8, 1]]) {
    const auto = await one(`select * from public.one_cut_create_room($1,$2,$3,'Host',now()+interval '1 hour',$4::jsonb,null,'slate','solo_actor')`, [owner, `auto${members}`, `auto${members}-h`, JSON.stringify(scenes)]);
    const ids = [auto.host_member_id];
    for (let i = 1; i < members; i += 1) ids.push((await one(`insert into public.group_members(room_id,secret_hash,display_name,role) values ($1,$2,'G','guest') returning id`, [auto.room_id, `auto${members}-${i}`])).id);
    await q('update public.group_rooms set member_count=$2 where id=$1', [auto.room_id, members]);
    const f = { roomId: auto.room_id, host: auto.host_member_id, ids: (await q(`select id from public.group_members where room_id=$1 order by (role='host') desc, joined_at, id`, [auto.room_id])).rows.map((row) => row.id), n: members };
    await q(startTakeSql, startTakeArgs(f, f.host, await nextTake(f, 1), await revision(f.roomId)));
    const g2 = await game(f.roomId);
    assert.equal(g2.laps_total, expected, `${members} players`); assert.equal(g2.laps_auto, false);
  }
  const explicit = await fixture({ members: 6, lapsTotal: 3 }); await startGame(explicit);
  assert.equal((await game(explicit.roomId)).laps_total, 3);
});

test('ready: actor or host only, idempotent, fixed schedule from the supplied start', async () => {
  const fx = await fixture({ members: 3 }); await startGame(fx);
  await fails('select public.one_cut_ready($1,1,$2,$3)', [fx.roomId, fx.ids[1], startedAt()], 'ONE_CUT_NOT_ACTOR');
  await fails('select public.one_cut_ready($1,2,$2,$3)', [fx.roomId, fx.host, startedAt()], 'ONE_CUT_STALE_TAKE');
  const start = new Date(Date.now() + 1000);
  await rpc('one_cut_ready', fx.roomId, 1, fx.host, start.toISOString());
  let take = await takeRow(fx.roomId, 1);
  assert.equal(take.status, 'take'); assert.equal((await game(fx.roomId)).phase, 'take');
  assert.equal(new Date(take.take_started_at).getTime(), start.getTime());
  assert.equal(new Date(take.action_at).getTime() - start.getTime(), 5500);
  assert.equal(new Date(take.cut_at).getTime() - new Date(take.action_at).getTime(), 3000);
  assert.equal(new Date(take.vote_deadline).getTime() - new Date(take.cut_at).getTime(), 40000);
  const rev = await revision(fx.roomId);
  await rpc('one_cut_ready', fx.roomId, 1, fx.host, new Date(Date.now() + 5000).toISOString()); // idempotent: nothing changes
  take = await takeRow(fx.roomId, 1);
  assert.equal(new Date(take.take_started_at).getTime(), start.getTime()); assert.equal(await revision(fx.roomId), rev);
  await fails('select public.one_cut_skip($1,1,$2,null)', [fx.roomId, fx.host], 'ONE_CUT_PHASE'); // a take already shot cannot be passed
  // the host may start the shoot for an absent actor
  const second = await fixture({ members: 3 }); await startGame(second);
  await rpc('one_cut_expire', second.roomId, 1); // nothing is due: no-op
  assert.equal((await game(second.roomId)).phase, 'brief');
});

test('timers: take -> vote half a second after the cut, vote -> result at the deadline; voting stops at the deadline', async () => {
  const fx = await fixture({ members: 3 }); await startGame(fx);
  await ready(fx, 1, fx.host);
  await rpc('one_cut_expire', fx.roomId, 1);
  assert.equal((await game(fx.roomId)).phase, 'take');
  await fails('select public.one_cut_cast_vote($1,1,$2,0)', [fx.roomId, fx.ids[1]], 'ONE_CUT_VOTE_CLOSED'); // still shooting
  await rewind(fx, 1, 11); // past cut_at + 0.5
  await rpc('one_cut_expire', fx.roomId, 1);
  assert.equal((await game(fx.roomId)).phase, 'vote'); assert.equal((await takeRow(fx.roomId, 1)).status, 'vote');
  const rev = await revision(fx.roomId);
  await rpc('one_cut_expire', fx.roomId, 1);
  assert.equal(await revision(fx.roomId), rev); // not due again: no change
  await rpc('one_cut_cast_vote', fx.roomId, 1, fx.ids[1], 1);
  await rewind(fx, 1, 51); // past the vote deadline
  await fails('select public.one_cut_cast_vote($1,1,$2,1)', [fx.roomId, fx.ids[2]], 'ONE_CUT_VOTE_CLOSED');
  await rpc('one_cut_expire', fx.roomId, 1);
  const g = await game(fx.roomId);
  assert.equal(g.phase, 'result'); assert.equal((await takeRow(fx.roomId, 1)).status, 'result');
  await rpc('one_cut_expire', fx.roomId, 1); // after the result: ignored
  assert.equal((await game(fx.roomId)).phase, 'result');
  // a long idle gap passes through both deadlines in one call
  const idle = await fixture({ members: 3 }); await startGame(idle);
  await ready(idle, 1, idle.host); await rewind(idle, 1, 60);
  await rpc('one_cut_expire', idle.roomId, 1);
  assert.equal((await game(idle.roomId)).phase, 'result');
  assert.deepEqual(Object.values((await game(idle.roomId)).scores), [0, 0, 0]); // nobody voted: nobody scores
});

test('votes: actor refused, one vote each, range checked, passes allowed, auto-result when all have voted, correct scoring', async () => {
  const fx = await fixture({ members: 4 }); const t = await startGame(fx);
  const [host, b, c, d] = fx.ids;
  await fails('select public.one_cut_cast_vote($1,1,$2,0)', [fx.roomId, b], 'ONE_CUT_VOTE_CLOSED'); // not in vote yet
  await ready(fx, 1, host); await rewind(fx, 1, 11); await rpc('one_cut_expire', fx.roomId, 1);
  await fails('select public.one_cut_cast_vote($1,1,$2,0)', [fx.roomId, host], 'ONE_CUT_ACTOR_VOTE');
  await fails('select public.one_cut_cast_vote($1,1,$2,6)', [fx.roomId, b], 'ONE_CUT_INVALID');
  await fails('select public.one_cut_cast_vote($1,1,$2,-1)', [fx.roomId, b], 'ONE_CUT_INVALID');
  await fails('select public.one_cut_cast_vote($1,2,$2,0)', [fx.roomId, b], 'ONE_CUT_STALE_TAKE');
  await fails('select public.one_cut_cast_vote($1,1,$2,0)', [fx.roomId, '99999999-9999-4999-8999-999999999999'], 'FORBIDDEN');
  await rpc('one_cut_cast_vote', fx.roomId, 1, b, t.answerIndex);
  await fails('select public.one_cut_cast_vote($1,1,$2,0)', [fx.roomId, b], 'ONE_CUT_ALREADY_VOTED');
  await rpc('one_cut_cast_vote', fx.roomId, 1, c, null); // わからない
  assert.equal((await game(fx.roomId)).phase, 'vote');
  await fails('select public.one_cut_close_vote($1,1,$2)', [fx.roomId, b], 'FORBIDDEN');
  await fails('select public.one_cut_close_vote($1,2,$2)', [fx.roomId, host], 'ONE_CUT_STALE_TAKE');
  await rpc('one_cut_cast_vote', fx.roomId, 1, d, (t.answerIndex + 1) % 6); // everyone but the actor has voted
  const g = await game(fx.roomId);
  assert.equal(g.phase, 'result'); assert.equal((await takeRow(fx.roomId, 1)).status, 'result');
  // b guessed right (+1), the actor gets one point per correct voter, c passed, d missed
  assert.deepEqual(g.scores, { [host]: 1, [b]: 1, [c]: 0, [d]: 0 });
  // the same numbers the display code derives from the rows
  const scored = scoreSoloTake({ answerIndex: t.answerIndex, actorId: host, votes: [{ voterId: b, choice: t.answerIndex }, { voterId: c, choice: null }, { voterId: d, choice: (t.answerIndex + 1) % 6 }] });
  assert.deepEqual(scored.gained, { [b]: 1, [host]: 1 });
  await fails('select public.one_cut_cast_vote($1,1,$2,0)', [fx.roomId, b], 'ONE_CUT_VOTE_CLOSED');
});

test('close_vote ends voting early and scores whoever voted; scores accumulate across takes', async () => {
  const fx = await fixture({ members: 3, lapsTotal: 2 });
  const [host, b, c] = fx.ids;
  const t1 = await startGame(fx);
  await playTake(fx, 1, { [b]: t1.answerIndex });
  let g = await game(fx.roomId);
  assert.equal(g.phase, 'result'); assert.deepEqual(g.scores, { [host]: 1, [b]: 1, [c]: 0 });
  await fails(startTakeSql, startTakeArgs(fx, b, await nextTake(fx, 2)), 'ONE_CUT_NOT_ACTOR'); // the actor of take 1 is the host; a guest cannot press next
  const t2 = await nextAfter(fx, 1, host);
  assert.equal(t2.actorId, b);
  await playTake(fx, 2, { [host]: null });
  g = await game(fx.roomId);
  assert.equal(g.phase, 'result'); assert.deepEqual(g.scores, { [host]: 1, [b]: 1, [c]: 0 }); // a take with only passes adds nothing
});

test('next: only the take actor or the host, a double press fails, the last take of a lap goes to break instead', async () => {
  const fx = await fixture({ members: 3, lapsTotal: 2 });
  const [host, b, c] = fx.ids;
  await startGame(fx);
  await playTake(fx, 1, { [b]: 0, [c]: null });
  const t2 = await nextTake(fx, 2);
  await fails(startTakeSql, startTakeArgs(fx, c, t2), 'ONE_CUT_NOT_ACTOR'); // take 1 was the host's
  await fails(startTakeSql, startTakeArgs(fx, host, { ...t2, actorId: c }), 'ONE_CUT_INVALID'); // rotation: take 2 is b's
  await fails(startTakeSql, startTakeArgs(fx, host, { ...t2, takeNo: 3 }), 'ONE_CUT_STALE_TAKE');
  await q(startTakeSql, startTakeArgs(fx, host, t2));
  await fails(startTakeSql, startTakeArgs(fx, host, t2), 'ONE_CUT_STALE_TAKE'); // the second press of "next"
  assert.equal((await game(fx.roomId)).phase, 'brief'); assert.equal((await game(fx.roomId)).take_no, 2);
  await playTake(fx, 2, { [host]: 2, [c]: 2 });
  const t3 = await nextTake(fx, 3);
  await q(startTakeSql, startTakeArgs(fx, b, t3)); // b was take 2's actor
  await playTake(fx, 3, { [host]: null, [b]: null });
  // take 3 is the last of lap 1: starting another take is refused, to_break is the way on
  await fails(startTakeSql, startTakeArgs(fx, c, await nextTake(fx, 4)), 'ONE_CUT_PHASE');
  await fails('select public.one_cut_to_break($1,3,$2)', [fx.roomId, b], 'ONE_CUT_NOT_ACTOR');
  await fails('select public.one_cut_to_break($1,2,$2)', [fx.roomId, c], 'ONE_CUT_STALE_TAKE');
  await rpc('one_cut_to_break', fx.roomId, 3, host); // the host may stand in for the actor
  assert.equal((await game(fx.roomId)).phase, 'break');
  await fails('select public.one_cut_to_break($1,3,$2)', [fx.roomId, host], 'ONE_CUT_PHASE');
  // a take that is not the last of its lap cannot go to break
  const mid = await fixture({ members: 3 }); await startGame(mid); await playTake(mid, 1, {});
  await fails('select public.one_cut_to_break($1,1,$2)', [mid.roomId, mid.host], 'ONE_CUT_PHASE');
});

test('skip is atomic: skipped + next take in one transaction, answer released, failures roll the skip back', async () => {
  const fx = await fixture({ members: 3 });
  const [host, b, c] = fx.ids;
  const t1 = await startGame(fx);
  const answer1 = t1.options[t1.answerIndex];
  const before = await game(fx.roomId);
  const rev = await revision(fx.roomId);
  // an invalid next take (wrong actor) must not leave a skipped row behind
  const bad = { ...(await nextTake(fx, 2, { releaseAnswerOf: 1 })), actorId: c };
  await fails('select public.one_cut_skip($1,1,$2,$3::jsonb)', [fx.roomId, host, JSON.stringify(bad)], 'ONE_CUT_INVALID');
  assert.equal((await takeRow(fx.roomId, 1)).status, 'brief'); assert.equal((await game(fx.roomId)).phase, 'brief');
  assert.deepEqual((await game(fx.roomId)).used_answer_ids, before.used_answer_ids); assert.equal(await revision(fx.roomId), rev);
  assert.equal((await counts(fx.roomId)).takes, 1);
  // nor with a malformed set, a stale number, or the wrong person pressing
  await fails('select public.one_cut_skip($1,1,$2,$3::jsonb)', [fx.roomId, host, JSON.stringify({ ...bad, actorId: b, options: bad.options.slice(1) })], 'ONE_CUT_INVALID');
  await fails('select public.one_cut_skip($1,1,$2,$3::jsonb)', [fx.roomId, host, JSON.stringify({ ...bad, actorId: b, takeNo: 3 })], 'ONE_CUT_STALE_TAKE');
  await fails('select public.one_cut_skip($1,1,$2,$3::jsonb)', [fx.roomId, b, JSON.stringify({ ...bad, actorId: b })], 'ONE_CUT_NOT_ACTOR');
  await fails('select public.one_cut_skip($1,2,$2,null)', [fx.roomId, host], 'ONE_CUT_STALE_TAKE');
  await fails('select public.one_cut_skip($1,1,$2,null)', [fx.roomId, host], 'ONE_CUT_INVALID'); // not the last take of the lap: null would end the lap early
  assert.equal((await takeRow(fx.roomId, 1)).status, 'brief'); assert.equal((await counts(fx.roomId)).takes, 1);
  // a valid skip: one call -> take 1 skipped, take 2 in brief for the next actor, the passed answer is free again
  const next = await nextTake(fx, 2, { releaseAnswerOf: 1 });
  await rpc('one_cut_skip', fx.roomId, 1, host, JSON.stringify(next));
  assert.equal((await takeRow(fx.roomId, 1)).status, 'skipped');
  const g = await game(fx.roomId);
  assert.equal(g.phase, 'brief'); assert.equal(g.take_no, 2);
  assert.equal((await takeRow(fx.roomId, 2)).actor_member_id, b);
  assert.ok(!g.used_answer_ids.includes(answer1), 'the passed scene is not counted as used');
  assert.ok(g.used_answer_ids.includes(next.options[next.answerIndex]));
  assert.deepEqual(g.scores, { [host]: 0, [b]: 0, [c]: 0 }); // no points for a skip
  await fails('select public.one_cut_skip($1,1,$2,$3::jsonb)', [fx.roomId, host, JSON.stringify(next)], 'ONE_CUT_STALE_TAKE'); // double press
  // the actor can pass; so can the host for them. Skipping the last take of a lap ends the lap with a null next.
  const t3 = await nextTake(fx, 3, { releaseAnswerOf: 2 });
  await rpc('one_cut_skip', fx.roomId, 2, host, JSON.stringify(t3));
  await rpc('one_cut_skip', fx.roomId, 3, c, null);
  assert.equal((await game(fx.roomId)).phase, 'break');
  assert.deepEqual((await q('select take_no,status from public.one_cut_takes where room_id=$1 order by take_no', [fx.roomId])).rows, [{ take_no: 1, status: 'skipped' }, { take_no: 2, status: 'skipped' }, { take_no: 3, status: 'skipped' }]);
});

test('likes: break only, never yourself, only someone who performed that lap, replaceable, not with 2 players', async () => {
  const fx = await fixture({ members: 3 });
  const [host, b, c] = fx.ids;
  await startGame(fx);
  await fails('select public.one_cut_like($1,1,$2,$3)', [fx.roomId, c, b], 'ONE_CUT_PHASE'); // not in a break
  await playTake(fx, 1, { [b]: null, [c]: null }); await nextAfter(fx, 1, host);
  await playTake(fx, 2, { [host]: null, [c]: null }); await nextAfter(fx, 2, b);
  await playTake(fx, 3, { [host]: null, [b]: null }); await rpc('one_cut_to_break', fx.roomId, 3, host);
  await fails('select public.one_cut_like($1,1,$2,$2)', [fx.roomId, c], 'ONE_CUT_INVALID');
  await fails('select public.one_cut_like($1,2,$2,$3)', [fx.roomId, c, b], 'ONE_CUT_PHASE'); // wrong lap
  await fails('select public.one_cut_like($1,1,$2,$3)', [fx.roomId, c, '99999999-9999-4999-8999-999999999999'], 'FORBIDDEN');
  await fails('select public.one_cut_like($1,1,$2,$3)', ['99999999-9999-4999-8999-999999999999', c, b], 'ONE_CUT_PHASE');
  await rpc('one_cut_like', fx.roomId, 1, c, b);
  await rpc('one_cut_like', fx.roomId, 1, c, host); // replaces the earlier choice
  await rpc('one_cut_like', fx.roomId, 1, b, host);
  assert.deepEqual((await q('select voter_id, target_id from public.one_cut_likes where room_id=$1 order by voter_id', [fx.roomId])).rows.map((row) => row.target_id).sort(), [host, host].sort());
  assert.equal((await counts(fx.roomId)).likes, 2);
  // two players: no awards at all
  const duo = await fixture({ members: 2 }); await startGame(duo);
  await playTake(duo, 1, { [duo.ids[1]]: null }); await nextAfter(duo, 1, duo.host);
  await playTake(duo, 2, { [duo.host]: null }); await rpc('one_cut_to_break', duo.roomId, 2, duo.host);
  await fails('select public.one_cut_like($1,1,$2,$3)', [duo.roomId, duo.ids[1], duo.host], 'ONE_CUT_PHASE');
  // someone whose only take was skipped has not performed: cannot be liked
  const sk = await fixture({ members: 3 }); await startGame(sk);
  await rpc('one_cut_skip', sk.roomId, 1, sk.host, JSON.stringify(await nextTake(sk, 2, { releaseAnswerOf: 1 })));
  await playTake(sk, 2, {}); await nextAfter(sk, 2, sk.ids[1]); await playTake(sk, 3, {}); await rpc('one_cut_to_break', sk.roomId, 3, sk.host);
  await fails('select public.one_cut_like($1,1,$2,$3)', [sk.roomId, sk.ids[1], sk.host], 'ONE_CUT_INVALID');
});

test('two laps: break -> continue starts lap 2 at the host, awards are tallied (ties share it), last break -> final purges takes/votes/likes', async () => {
  const fx = await fixture({ members: 3, lapsTotal: 2 });
  const [host, b, c] = fx.ids;
  const answers = new Set();
  const t1 = await startGame(fx); answers.add(t1.options[t1.answerIndex]);
  await playTake(fx, 1, { [b]: t1.answerIndex, [c]: null });
  for (const takeNo of [2, 3]) { const t = await nextAfter(fx, takeNo - 1, fx.ids[takeNo - 2]); answers.add(t.options[t.answerIndex]); await playTake(fx, takeNo, { [fx.ids[takeNo % 3]]: t.answerIndex }); }
  await rpc('one_cut_to_break', fx.roomId, 3, c);
  assert.equal((await game(fx.roomId)).phase, 'break');
  await rpc('one_cut_like', fx.roomId, 1, host, b);
  await rpc('one_cut_like', fx.roomId, 1, b, c);
  await rpc('one_cut_like', fx.roomId, 1, c, b);
  const rev = await revision(fx.roomId);
  const lap2 = await nextTake(fx, 4);
  assert.equal(lap2.actorId, host); assert.equal(lap2.lapNo, 2);
  await fails('select public.one_cut_close_break($1,1,$2,$3::jsonb)', [fx.roomId, b, JSON.stringify(lap2)], 'FORBIDDEN');
  await fails('select public.one_cut_close_break($1,2,$2,$3::jsonb)', [fx.roomId, host, JSON.stringify(lap2)], 'ONE_CUT_PHASE');
  await fails('select public.one_cut_close_break($1,1,$2,null)', [fx.roomId, host], 'ONE_CUT_INVALID'); // lap 1 of 2 needs a next take
  await fails('select public.one_cut_close_break($1,1,$2,$3::jsonb)', [fx.roomId, host, JSON.stringify({ ...lap2, actorId: b })], 'ONE_CUT_INVALID');
  assert.equal((await game(fx.roomId)).phase, 'break'); assert.deepEqual((await game(fx.roomId)).awards, []); // a failed close leaves no award behind
  await rpc('one_cut_close_break', fx.roomId, 1, host, JSON.stringify(lap2));
  let g = await game(fx.roomId);
  assert.equal(g.phase, 'brief'); assert.equal(g.take_no, 4); assert.equal(g.lap_no, 2);
  assert.deepEqual(g.awards, [{ lap: 1, memberIds: [b] }]);
  assert.equal((await counts(fx.roomId)).likes, 3); // likes stay until the game ends
  // lap 2: tie between two members for the award
  for (let takeNo = 4; takeNo <= 6; takeNo += 1) {
    if (takeNo > 4) await nextAfter(fx, takeNo - 1, fx.ids[(takeNo - 2) % 3]);
    await playTake(fx, takeNo, {});
  }
  await rpc('one_cut_to_break', fx.roomId, 6, host);
  await rpc('one_cut_like', fx.roomId, 2, host, c);
  await rpc('one_cut_like', fx.roomId, 2, b, host);
  await fails('select public.one_cut_close_break($1,2,$2,$3::jsonb)', [fx.roomId, host, JSON.stringify(await nextTake(fx, 7))], 'ONE_CUT_INVALID'); // last lap must not have a next take
  assert.ok((await counts(fx.roomId)).takes > 0);
  await rpc('one_cut_close_break', fx.roomId, 2, host, null);
  // the end of the game deletes the whole game row (scenes, takes, votes, likes, scores, awards); only the closing data is kept
  assert.equal(await gameRows(fx.roomId), 0);
  const result = (await kept(fx.roomId)).result;
  assert.deepEqual(Object.keys(result).sort(), ['awards', 'scores']);
  assert.deepEqual(result.awards.map((a) => a.lap), [1, 2]);
  assert.deepEqual([...result.awards[1].memberIds].sort(), [c, host].sort());
  assert.deepEqual(await counts(fx.roomId), { takes: 0, votes: 0, likes: 0 });
  assert.equal((await room(fx.roomId)).status, 'ended');
  assert.deepEqual(Object.keys(result.scores).sort(), [...fx.ids].sort()); // everyone's totals (PO decision Q14)
  assert.ok(Object.values(result.scores).some((v) => v > 0));
  const ttl = Number((await one('select extract(epoch from (result_expires_at - now())) as s from public.one_cut_results where room_id=$1', [fx.roomId])).s);
  assert.ok(ttl > 290 && ttl <= 300, `result_expires_at is about 5 minutes ahead (${ttl}s)`);
  await fails('select public.one_cut_finish($1,$2,$3)', [fx.roomId, host, 6], 'ONE_CUT_PHASE'); // already ended
});

test('finish: host only, from any phase; finalizes through the same function; only scores / awards are kept (and nothing from the lobby)', async () => {
  // from the lobby
  const lobby = await fixture({ members: 2 });
  await fails('select public.one_cut_finish($1,$2,$3)', [lobby.roomId, lobby.ids[1], 0], 'FORBIDDEN');
  await fails('select public.one_cut_finish($1,$2,$3)', [lobby.roomId, lobby.host, 1], 'ONE_CUT_STALE_TAKE');
  await rpc('one_cut_finish', lobby.roomId, lobby.host, 0);
  assert.equal(await gameRows(lobby.roomId), 0); assert.equal(await kept(lobby.roomId), undefined, 'a game that never started keeps nothing'); assert.equal((await room(lobby.roomId)).status, 'ended');
  assert.equal((await stateOf(lobby.roomId, lobby.host)).phase, 'ended');
  // mid-take: votes already cast are erased, the points of earlier takes remain
  const fx = await fixture({ members: 3, lapsTotal: 2 });
  const [host, b, c] = fx.ids;
  const t1 = await startGame(fx);
  await playTake(fx, 1, { [b]: t1.answerIndex, [c]: t1.answerIndex });
  await nextAfter(fx, 1, host);
  await ready(fx, 2, b); await rewind(fx, 2, 11); await rpc('one_cut_expire', fx.roomId, 2);
  await rpc('one_cut_cast_vote', fx.roomId, 2, host, 3);
  const mid = await counts(fx.roomId);
  assert.ok(mid.takes === 2 && mid.votes === 3, JSON.stringify(mid));
  await fails('select public.one_cut_like($1,1,$2,$3)', [fx.roomId, host, b], 'ONE_CUT_PHASE'); // not in a break: refused
  await rpc('one_cut_finish', fx.roomId, host, 2);
  assert.deepEqual(await counts(fx.roomId), { takes: 0, votes: 0, likes: 0 });
  assert.equal(await gameRows(fx.roomId), 0);
  assert.deepEqual((await kept(fx.roomId)).result, { scores: { [host]: 2, [b]: 1, [c]: 1 }, awards: [] });
  assert.equal((await room(fx.roomId)).status, 'ended');
  // from a break: the lap's award is tallied before everything is erased
  const br = await fixture({ members: 3, lapsTotal: 2 });
  await startGame(br);
  await playTake(br, 1, {}); await nextAfter(br, 1, br.host);
  await playTake(br, 2, {}); await nextAfter(br, 2, br.ids[1]);
  await playTake(br, 3, {}); await rpc('one_cut_to_break', br.roomId, 3, br.host);
  await rpc('one_cut_like', br.roomId, 1, br.host, br.ids[2]);
  await rpc('one_cut_like', br.roomId, 1, br.ids[1], br.ids[2]);
  assert.equal((await counts(br.roomId)).likes, 2);
  await rpc('one_cut_finish', br.roomId, br.host, 3);
  assert.deepEqual(await counts(br.roomId), { takes: 0, votes: 0, likes: 0 });
  assert.deepEqual((await kept(br.roomId)).result.awards, [{ lap: 1, memberIds: [br.ids[2]] }]);
  assert.equal(await gameRows(br.roomId), 0);
});

test('votes hold only the voter and the choice; the actor never has a vote row', async () => {
  const fx = await fixture({ members: 3 }); const t = await startGame(fx);
  await playTake(fx, 1, { [fx.ids[1]]: t.answerIndex, [fx.ids[2]]: null });
  const rows = (await q('select voter_id, choice from public.one_cut_votes v where take_id=(select id from public.one_cut_takes where room_id=$1 and take_no=1) order by voter_id', [fx.roomId])).rows;
  assert.equal(rows.length, 2); assert.ok(rows.every((row) => row.voter_id !== fx.host));
  assert.ok(rows.some((row) => row.choice === null));
});

test('expired rooms reject every transition and deleting the room cascades all one_cut rows', async () => {
  const fx = await fixture({ members: 3 }); await startGame(fx);
  await ready(fx, 1, fx.host); await rewind(fx, 1, 11); await rpc('one_cut_expire', fx.roomId, 1);
  await rpc('one_cut_cast_vote', fx.roomId, 1, fx.ids[1], 0);
  await q(`update public.group_rooms set expires_at=now()-interval '1 second' where id=$1`, [fx.roomId]);
  await fails('select public.one_cut_cast_vote($1,1,$2,0)', [fx.roomId, fx.ids[2]], 'ONE_CUT_PHASE');
  await fails('select public.one_cut_finish($1,$2,$3)', [fx.roomId, fx.host, 1], 'ONE_CUT_PHASE');
  await fails('select public.one_cut_ready($1,1,$2,$3)', [fx.roomId, fx.host, startedAt()], 'ONE_CUT_PHASE');
  await q('delete from public.group_rooms where id=$1', [fx.roomId]);
  for (const table of ['one_cut_games', 'one_cut_takes', 'one_cut_likes']) assert.equal((await one(`select count(*)::int n from public.${table} where room_id=$1`, [fx.roomId])).n, 0, table);
  assert.equal((await one('select count(*)::int n from public.one_cut_votes where voter_id=any($1::uuid[])', [fx.ids])).n, 0);
});

test('the host leaving cascades: deleting the host member removes their takes and votes', async () => {
  const fx = await fixture({ members: 3 }); await startGame(fx);
  await q('delete from public.group_members where id=$1', [fx.ids[2]]);
  assert.equal((await counts(fx.roomId)).takes, 1);
  await q('delete from public.group_members where id=$1', [fx.host]);
  assert.equal((await counts(fx.roomId)).takes, 0); // the host's take goes with them
});

const stateOf = async (roomId, memberId) => (await one('select public.one_cut_state($1,$2) as s', [roomId, memberId])).s;

test('M1: votes and likes moving the revision never block the host: close_vote / close_break / finish do not take a revision', async () => {
  const fx = await fixture({ members: 3, lapsTotal: 1 });
  const [host, b, c] = fx.ids;
  const t1 = await startGame(fx);
  await ready(fx, 1, host); await rewind(fx, 1, 11); await rpc('one_cut_expire', fx.roomId, 1);
  const before = await revision(fx.roomId);
  await rpc('one_cut_cast_vote', fx.roomId, 1, b, t1.answerIndex); // a participant's vote moves the revision on
  assert.ok((await revision(fx.roomId)) > before);
  await rpc('one_cut_close_vote', fx.roomId, 1, host); // ... and the host's close still goes through
  assert.equal((await game(fx.roomId)).phase, 'result');
  await nextAfter(fx, 1, host); await playTake(fx, 2, {}); await nextAfter(fx, 2, b); await playTake(fx, 3, {});
  await rpc('one_cut_to_break', fx.roomId, 3, host);
  await rpc('one_cut_like', fx.roomId, 1, b, c);
  await rpc('one_cut_like', fx.roomId, 1, c, b); // likes move the revision too
  await rpc('one_cut_close_break', fx.roomId, 1, host, null);
  assert.equal(await gameRows(fx.roomId), 0); assert.ok(await kept(fx.roomId));
  // finish is matched by take number + phase, not by revision
  const g = await fixture({ members: 2 }); await startGame(g);
  await ready(g, 1, g.host); await rewind(g, 1, 11); await rpc('one_cut_expire', g.roomId, 1);
  await rpc('one_cut_cast_vote', g.roomId, 1, g.ids[1], 0);
  await fails('select public.one_cut_finish($1,$2,$3)', [g.roomId, g.host, 2], 'ONE_CUT_STALE_TAKE');
  await rpc('one_cut_finish', g.roomId, g.host, 1);
  assert.equal(await gameRows(g.roomId), 0); assert.ok(await kept(g.roomId));
});

test('L10: skip with a next take is refused on the last take of a lap (nothing is changed)', async () => {
  const fx = await fixture({ members: 3 }); await startGame(fx);
  await rpc('one_cut_skip', fx.roomId, 1, fx.host, JSON.stringify(await nextTake(fx, 2, { releaseAnswerOf: 1 })));
  await rpc('one_cut_skip', fx.roomId, 2, fx.host, JSON.stringify(await nextTake(fx, 3, { releaseAnswerOf: 2 })));
  const rev = await revision(fx.roomId);
  const lapTwo = { ...(await nextTake(fx, 4, { releaseAnswerOf: 3 })) };
  await fails('select public.one_cut_skip($1,3,$2,$3::jsonb)', [fx.roomId, fx.host, JSON.stringify(lapTwo)], 'ONE_CUT_INVALID');
  assert.equal((await takeRow(fx.roomId, 3)).status, 'brief'); assert.equal(await revision(fx.roomId), rev); assert.equal((await game(fx.roomId)).phase, 'brief');
  await rpc('one_cut_skip', fx.roomId, 3, fx.host, null);
  assert.equal((await game(fx.roomId)).phase, 'break');
});

test('ready: a start instant far from the database clock is replaced, never refused', async () => {
  const fx = await fixture({ members: 3 }); await startGame(fx);
  await rpc('one_cut_ready', fx.roomId, 1, fx.host, new Date(Date.now() + 3600e3).toISOString());
  const take = await takeRow(fx.roomId, 1);
  const lead = new Date(take.take_started_at).getTime() - Date.now();
  assert.ok(lead > -2000 && lead < 3000, `lead ${lead}`);
  assert.equal(take.status, 'take');
});

test('one_cut_state: one snapshot, filtered per member, secrets only where the rules allow', async () => {
  const fx = await fixture({ members: 3, lapsTotal: 1 });
  const [host, b, c] = fx.ids;
  assert.equal((await stateOf(fx.roomId, b)).phase, 'lobby');
  await fails('select public.one_cut_state($1,$2)', ['99999999-9999-4999-8999-999999999999', b], 'ONE_CUT_UNAVAILABLE');
  const t1 = await startGame(fx);
  const answerText = scenes.find((scene) => scene.id === t1.options[t1.answerIndex]).text;
  // brief: only the actor learns which option is theirs
  const briefActor = await stateOf(fx.roomId, host); const briefOther = await stateOf(fx.roomId, b); const briefAnon = await stateOf(fx.roomId, null);
  assert.equal(briefActor.myAnswerIndex, t1.answerIndex);
  for (const view of [briefOther, briefAnon]) { assert.equal(view.myAnswerIndex, null); assert.equal(view.answerIndex, null); assert.deepEqual(view.votes, []); }
  assert.equal(briefActor.answerIndex, null);
  assert.equal(briefOther.phase, 'brief'); assert.equal(briefOther.take.options.length, 6); assert.equal('answerIndex' in briefOther.take, false); assert.equal('answer_index' in briefOther.take, false);
  // take / vote: still only the actor; votes are a count and my own flag
  await ready(fx, 1, host);
  assert.equal((await stateOf(fx.roomId, b)).phase, 'take');
  assert.equal((await stateOf(fx.roomId, b)).myAnswerIndex, null);
  assert.equal((await stateOf(fx.roomId, host)).myAnswerIndex, t1.answerIndex);
  await rewind(fx, 1, 11);
  const rev0 = await revision(fx.roomId);
  const voting = await stateOf(fx.roomId, b); // the due deadline is settled by the read itself
  assert.equal(voting.phase, 'vote'); assert.ok((await revision(fx.roomId)) > rev0); assert.equal(voting.revision, await revision(fx.roomId));
  await rpc('one_cut_cast_vote', fx.roomId, 1, b, t1.answerIndex);
  const mid = [await stateOf(fx.roomId, host), await stateOf(fx.roomId, b), await stateOf(fx.roomId, c)];
  assert.deepEqual(mid.map((view) => view.votedCount), [1, 1, 1]); assert.deepEqual(mid.map((view) => view.memberHasVoted), [false, true, false]);
  for (const view of mid) { assert.deepEqual(view.votes, []); assert.equal(view.answerIndex, null); }
  assert.equal(mid[0].myAnswerIndex, t1.answerIndex); assert.equal(mid[1].myAnswerIndex, null);
  // result: the answer is public, the votes are listed for scoring (the API turns them into tallies), nothing is secret any more
  await rpc('one_cut_cast_vote', fx.roomId, 1, c, null);
  const result = await stateOf(fx.roomId, c);
  assert.equal(result.phase, 'result'); assert.equal(result.answerIndex, t1.answerIndex); assert.equal(result.myAnswerIndex, null);
  assert.deepEqual(result.votes.map((v) => [v.voter_id, v.choice]).sort(), [[b, t1.answerIndex], [c, null]].sort());
  assert.equal(result.take.optionTexts[t1.answerIndex], answerText);
  assert.deepEqual(result.scores, { [host]: 1, [b]: 1, [c]: 0 });
  // a deadline passed while nobody polled: the read settles the vote too
  const idle = await fixture({ members: 3 }); await startGame(idle);
  await ready(idle, 1, idle.host); await rewind(idle, 1, 60);
  assert.equal((await stateOf(idle.roomId, idle.ids[1])).phase, 'result');
  // break: every take of the lap, answers only for performed takes; likes as a count and my own pick
  await nextAfter(fx, 1, host); await rpc('one_cut_skip', fx.roomId, 2, b, JSON.stringify(await nextTake(fx, 3, { releaseAnswerOf: 2 })));
  await playTake(fx, 3, {}); await rpc('one_cut_to_break', fx.roomId, 3, host);
  await rpc('one_cut_like', fx.roomId, 1, b, host);
  const brk = await stateOf(fx.roomId, b);
  assert.equal(brk.phase, 'break'); assert.equal(brk.myLikeTargetId, host); assert.equal(brk.likedCount, 1); assert.equal((await stateOf(fx.roomId, c)).myLikeTargetId, null);
  assert.deepEqual(brk.lapTakes.map((t) => [t.takeNo, t.skipped, t.sceneText === null]), [[1, false, false], [2, true, true], [3, false, false]]);
  assert.equal(brk.myAnswerIndex, null); assert.equal(brk.answerIndex, null); assert.equal(brk.take, null);
  // final: only scores and awards are served (from the kept result), no take
  await rpc('one_cut_close_break', fx.roomId, 1, host, null);
  const fin = await stateOf(fx.roomId, b);
  assert.equal(fin.phase, 'final'); assert.equal(fin.roomStatus, 'ended'); assert.deepEqual(fin.awards, [{ lap: 1, memberIds: [host] }]); assert.equal(fin.take, undefined);
  assert.deepEqual(Object.keys(fin).sort(), ['awards', 'memberCount', 'phase', 'resultExpiresAt', 'revision', 'roomStatus', 'scores']);
  assert.equal(JSON.stringify(fin).includes('answer'), false);
});

test('the kept result disappears 5 minutes after the end: served before, deleted at the limit (by a state read or the sweep), then only phase ended', async () => {
  const play = async () => {
    const fx = await fixture({ members: 3, lapsTotal: 1 });
    await startGame(fx); await playTake(fx, 1, {}); await nextAfter(fx, 1, fx.host); await playTake(fx, 2, {}); await nextAfter(fx, 2, fx.ids[1]); await playTake(fx, 3, {});
    await rpc('one_cut_to_break', fx.roomId, 3, fx.host);
    await rpc('one_cut_close_break', fx.roomId, 1, fx.host, null);
    return fx;
  };
  const a = await play(); const b = await play(); const c = await play();
  assert.equal(await gameRows(a.roomId) + await gameRows(b.roomId), 0);
  for (const fx of [a, b, c]) { const s = await stateOf(fx.roomId, fx.ids[1]); assert.equal(s.phase, 'final'); assert.ok(Object.keys(s.scores).length === 3); }
  // within the 5 minutes (one second to go) it is still served
  await q(`update public.one_cut_results set result_expires_at = now() + interval '1 second' where room_id=$1`, [a.roomId]);
  assert.equal((await stateOf(a.roomId, a.host)).phase, 'final');
  // a state read after the limit deletes it and answers with the minimal ended response
  await q(`update public.one_cut_results set result_expires_at = now() - interval '1 second' where room_id=$1`, [a.roomId]);
  const ended = await stateOf(a.roomId, a.host);
  assert.equal(ended.phase, 'ended'); assert.equal(ended.scores, undefined); assert.equal(ended.awards, undefined);
  assert.equal(await kept(a.roomId), undefined);
  // the group cleanup sweeps lapsed rows with exactly this filter, leaving rooms still within their 5 minutes alone
  await q(`update public.one_cut_results set result_expires_at = now() - interval '1 second' where room_id=$1`, [b.roomId]);
  await q('delete from public.one_cut_results where result_expires_at <= $1::timestamptz', [new Date().toISOString()]);
  assert.equal(await kept(b.roomId), undefined); assert.ok(await kept(c.roomId));
  assert.equal((await room(b.roomId)).status, 'ended');
  await q('delete from public.group_rooms where id=$1', [c.roomId]);
  assert.equal(await kept(c.roomId), undefined, 'the room expiry removes it too');
  await assert.rejects(() => q(`update public.one_cut_games set phase='final'`), /check|violates/i);
});

test.after(async () => { await db.close(); });

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// Applies group-rooms -> minority -> question-wolf -> game-types -> ochi -> one-cut -> mission, as production does.
const owner = '11111111-1111-4111-8111-111111111111';
const FILES = ['202610080001_group_rooms.sql', '202610150001_minority_topic.sql', '202610160001_question_wolf.sql', '202610170001_group_game_types.sql', '202610170002_ochi_kara.sql', '202610170003_one_cut.sql', '202610170004_mission_mingle.sql'];
const MISSION_SQL = new URL('../../supabase/migrations/202610170004_mission_mingle.sql', import.meta.url);
const GHOST = '44444444-4444-4444-8444-444444444444';

const db = new PGlite();
await db.waitReady;
await db.exec(`create schema auth;
create table auth.users (id uuid primary key, email text);
create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create role anon; create role authenticated; create role service_role bypassrls;
grant usage on schema public, auth to anon, authenticated, service_role;
insert into auth.users(id,email) values ('${owner}','owner@test');`);
for (const file of FILES) await db.exec(await readFile(new URL(`../../supabase/migrations/${file}`, import.meta.url), 'utf8'));
await db.exec('set role service_role');

const q = (sql, params = []) => db.query(sql, params);
const one = async (sql, params) => (await q(sql, params)).rows[0];
async function fails(sql, params, code) {
  await assert.rejects(() => q(sql, params), (error) => { assert.ok(String(error.message).includes(code), `expected ${code}, got ${error.message}`); return true; }, `${code}: ${sql}`);
}
const rpc = (name, ...args) => q(`select public.${name}(${args.map((_, i) => `$${i + 1}`).join(',')})`, args);
const revision = async (roomId) => Number((await one('select revision from public.group_rooms where id=$1', [roomId])).revision);
const game = (roomId) => one('select * from public.mission_games where room_id=$1', [roomId]);
const assignments = async (roomId) => (await q('select * from public.mission_assignments where room_id=$1 order by member_id, slot, status', [roomId])).rows;
const results = (roomId) => one('select * from public.mission_results where room_id=$1', [roomId]);
const countRows = async (table, roomId) => (await one(`select count(*)::int n from public.${table} where room_id=$1`, [roomId])).n;
// the summary the API builds at the last reveal (achieved counts from the rows still in the database; titles are display text only)
async function summaryOf(fx, titles = {}) {
  const counts = (await q(`select member_id, count(*)::int n from public.mission_assignments where room_id=$1 and status='achieved' group by member_id`, [fx.roomId])).rows;
  const members = Object.fromEntries(fx.ids.map((id) => [id, { achieved: counts.find((row) => row.member_id === id)?.n || 0, titles: titles[id] || [] }]));
  return { achievedTotal: Object.values(members).reduce((sum, item) => sum + item.achieved, 0), members };
}
const NEXT_SQL = 'select public.mission_reveal_next($1,$2,$3,$4::jsonb)';
// one reveal_next as the API sends it: the summary rides along only on the last person
async function revealNext(fx, memberId = fx.host, titles = {}) {
  const g = await game(fx.roomId);
  const last = g.reveal_cursor + 1 >= g.reveal_order.length;
  return q(NEXT_SQL, [fx.roomId, memberId, await revision(fx.roomId), last ? JSON.stringify(await summaryOf(fx, titles)) : null]);
}
const live = async (roomId, memberId, slot) => one(`select * from public.mission_assignments where room_id=$1 and member_id=$2 and slot=$3 and status in ('active','achieved')`, [roomId, memberId, slot]);

let counter = 0;
async function fixture({ members = 3, settings = {}, expiresIn = '24 hours' } = {}) {
  counter += 1; const tag = `fx${counter}`;
  const created = await one(`select * from public.mission_create_room($1,$2,$3,'Host',now()+$4::interval,$5::jsonb)`, [owner, tag, `${tag}-host`, expiresIn, JSON.stringify(settings)]);
  for (let i = 1; i < members; i += 1) await q(`insert into public.group_members(room_id,secret_hash,display_name,role) values ($1,$2,$3,'guest')`, [created.room_id, `${tag}-g${i}`, `G${i}`]);
  await q('update public.group_rooms set member_count=$2 where id=$1', [created.room_id, members]);
  const rows = (await q(`select id from public.group_members where room_id=$1 order by role desc, secret_hash`, [created.room_id])).rows;
  return { roomId: created.room_id, host: created.host_member_id, ids: rows.map((row) => row.id), tag, n: 1 };
}
// a valid deal: each member holds difficulties 1,2,3 (standard); member i names the next member on slot 1
let missionNo = 100;
function deal(fx, { preset = [1, 2, 3], base = missionNo } = {}) {
  missionNo += 40;
  return fx.ids.flatMap((memberId, i) => preset.map((difficulty, s) => ({
    memberId, slot: s + 1, missionId: `mission-${base + i * 3 + s}`, difficulty, topic: `topic-${base + i * 3 + s}`,
    targetMemberId: s === 0 ? fx.ids[(i + 1) % fx.ids.length] : null
  })));
}
const order = (fx) => JSON.stringify([...fx.ids].reverse());
const startArgs = (fx, rev, list = deal(fx), ord = order(fx)) => [fx.roomId, fx.host, JSON.stringify(list), ord, rev];
const START_SQL = 'select public.mission_start($1,$2,$3::jsonb,$4::jsonb,$5)';
async function startGame(fx, opts) { await q(START_SQL, startArgs(fx, await revision(fx.roomId), opts?.list, opts?.ord)); }
const newItem = (n, difficulty, extra = {}) => JSON.stringify({ missionId: `mission-${n}`, difficulty, topic: `new-${n}`, targetMemberId: null, ...extra });
const SWAP_SQL = 'select public.mission_swap($1,$2,$3,$4::jsonb)';
// puts the whole mission phase into the past: expired but not yet flipped
const backdate = (roomId, minutes = 90) => q(`update public.mission_games set started_at = now() - make_interval(mins => $2), ends_at = now() - interval '1 minute' where room_id=$1`, [roomId, minutes]);

test('mission tables and RPCs are service_role only, with RLS on', async () => {
  const fx = await fixture();
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`);
    for (const table of ['mission_games', 'mission_assignments', 'mission_swaps', 'mission_results']) {
      await fails(`select * from public.${table}`, [], 'permission denied');
      await fails(`delete from public.${table}`, [], 'permission denied');
    }
    await fails(`insert into public.mission_games(room_id) values ('${fx.roomId}')`, [], 'permission denied');
    await fails(`select * from public.mission_create_room($1,'i','s','H',now()+interval '1 hour','{}'::jsonb)`, [owner], 'permission denied');
    await fails('select public.mission_set_status($1,$2,$3,$4)', [fx.roomId, fx.host, GHOST, 'achieved'], 'permission denied');
    await fails('select public.mission_expire($1)', [fx.roomId], 'permission denied');
    await fails('select public.mission_finish($1,$2,0)', [fx.roomId, fx.host], 'permission denied');
    await fails('select public.mission_settings_ok($1::jsonb)', ['{}'], 'permission denied');
    await fails('select public.mission_item_ok($1,$2::jsonb,$3)', [fx.roomId, '{}', 'x'], 'permission denied');
    await fails('select public.mission_summary_ok($1,$2::jsonb)', [fx.roomId, '{}'], 'permission denied');
    await fails(NEXT_SQL, [fx.roomId, fx.host, 0, null], 'permission denied');
  }
  await db.exec('set role service_role');
  for (const table of ['mission_games', 'mission_assignments', 'mission_swaps', 'mission_results']) assert.equal((await one(`select relrowsecurity from pg_class where oid='public.${table}'::regclass`)).relrowsecurity, true, table);
  // no column can hold an answer, a text or a timestamp of achievement
  const columns = (await q(`select column_name from information_schema.columns where table_name in ('mission_games','mission_assignments','mission_swaps','mission_results')`)).rows.map((row) => row.column_name);
  for (const forbidden of ['text', 'answer', 'achieved_at', 'note', 'body']) assert.equal(columns.includes(forbidden), false, forbidden);
});

test('create builds the room, host and game with neutral cards; settings are validated', async () => {
  const fx = await fixture({ settings: { durationMinutes: 120, preset: 'hard', scene: 'business', seatMode: true } });
  const room = await one('select * from public.group_rooms where id=$1', [fx.roomId]);
  assert.equal(room.game_type, 'mission_mingle'); assert.equal(room.adult_only, false); assert.equal(room.status, 'lobby');
  assert.equal(room.cards.length, 6);
  assert.ok(room.cards.every((card) => card.text === 'ミッションカード' && card.r18 === false));
  const g = await game(fx.roomId);
  assert.equal(g.phase, 'lobby'); assert.equal(g.duration_minutes, 120); assert.equal(g.preset, 'hard'); assert.equal(g.scene, 'business'); assert.equal(g.seat_mode, true); assert.equal(g.extensions, 0);
  const defaults = await game((await fixture()).roomId);
  assert.deepEqual([defaults.duration_minutes, defaults.preset, defaults.scene, defaults.seat_mode], [60, 'standard', 'party', false]);
  const create = (settings) => fails(`select * from public.mission_create_room($1,'v','v','H',now()+interval '1 hour',$2::jsonb)`, [owner, JSON.stringify(settings)], 'MISSION_INVALID');
  await create({ durationMinutes: 45 }); await create({ durationMinutes: '60' }); await create({ preset: 'x' }); await create({ scene: 'x' }); await create({ seatMode: 'true' }); await create({ extra: 1 }); await create([]);
  await fails(`select * from public.mission_create_room(null,'v','v','H',now()+interval '1 hour','{}'::jsonb)`, [], 'MISSION_INVALID');
});

test('configure: host only, lobby only, current revision, partial settings merge', async () => {
  const fx = await fixture({ settings: { scene: 'mixer' } });
  const rev = await revision(fx.roomId);
  const sql = 'select public.mission_configure($1,$2,$3::jsonb,$4)';
  await fails(sql, [fx.roomId, fx.ids[1], '{"preset":"easy"}', rev], 'MISSION_NOT_OWNER');
  await fails(sql, [fx.roomId, fx.host, '{"preset":"easy"}', rev + 1], 'GROUP_STALE');
  await fails(sql, [fx.roomId, fx.host, '{"preset":"nope"}', rev], 'MISSION_INVALID');
  await fails(sql, [fx.roomId, fx.host, '{"hack":true}', rev], 'MISSION_INVALID');
  await q(sql, [fx.roomId, fx.host, '{"preset":"easy","durationMinutes":30}', rev]);
  const g = await game(fx.roomId);
  assert.deepEqual([g.preset, g.duration_minutes, g.scene, g.seat_mode], ['easy', 30, 'mixer', false]);
  assert.equal(await revision(fx.roomId), rev + 1);
  await q(sql, [fx.roomId, fx.host, '{"seatMode":true}', rev + 1]);
  assert.equal((await game(fx.roomId)).seat_mode, true);
  await startGame(fx, { list: deal(fx, { preset: [1, 1, 2] }) });
  await fails(sql, [fx.roomId, fx.host, '{"preset":"hard"}', await revision(fx.roomId)], 'MISSION_PHASE');
});

test('start verifies host, revision, 3-8 members, the full deal, the reveal order and that the game fits the room lifetime', async () => {
  const solo = await fixture({ members: 2 });
  await fails(START_SQL, startArgs(solo, await revision(solo.roomId), []), 'MISSION_PARTICIPANTS');
  const fx = await fixture({ members: 3 });
  const rev = await revision(fx.roomId);
  const good = deal(fx);
  const args = (list, ord) => startArgs(fx, rev, list, ord);
  await fails(START_SQL, [fx.roomId, fx.ids[1], ...startArgs(fx, rev).slice(2)], 'MISSION_NOT_OWNER');
  await fails(START_SQL, startArgs(fx, rev + 1), 'GROUP_STALE');
  await fails(START_SQL, args(good.slice(1)), 'MISSION_INVALID'); // not 3 per member
  await fails(START_SQL, args([...good.slice(0, 8), { ...good[8], missionId: good[0].missionId }]), 'MISSION_INVALID'); // H1 duplicate id
  await fails(START_SQL, args(good.map((item, i) => (i === 6 ? { ...item, topic: good[0].topic, targetMemberId: good[0].targetMemberId } : item))), 'MISSION_INVALID'); // H3 same topic on the same person
  await fails(START_SQL, args(good.map((item, i) => (i === 0 ? { ...item, targetMemberId: item.memberId } : item))), 'MISSION_INVALID'); // H2 yourself
  await fails(START_SQL, args(good.map((item, i) => (i === 0 ? { ...item, targetMemberId: GHOST } : item))), 'MISSION_INVALID'); // not in the room
  await fails(START_SQL, args(good.map((item, i) => (i === 1 ? { ...item, difficulty: 1 } : item))), 'MISSION_INVALID'); // H4 preset mismatch
  await fails(START_SQL, args(good.map((item, i) => (i === 1 ? { ...item, slot: 1 } : item))), 'MISSION_INVALID'); // two live missions in one slot
  await fails(START_SQL, args(good.map((item, i) => (i === 1 ? { ...item, slot: 4 } : item))), 'MISSION_INVALID');
  await fails(START_SQL, args(good.map((item, i) => (i === 1 ? { ...item, missionId: 'bad-id' } : item))), 'MISSION_INVALID');
  await fails(START_SQL, args(good.map((item, i) => (i === 1 ? { ...item, memberId: GHOST } : item))), 'MISSION_INVALID');
  await fails(START_SQL, args(good.map((item, i) => (i === 1 ? { ...item, topic: '' } : item))), 'MISSION_INVALID');
  await fails(START_SQL, args(good, JSON.stringify([fx.ids[0], fx.ids[0], fx.ids[1]])), 'MISSION_INVALID');
  await fails(START_SQL, args(good, JSON.stringify(fx.ids.slice(1))), 'MISSION_INVALID');
  await fails(START_SQL, args(good, JSON.stringify([...fx.ids.slice(1), GHOST])), 'MISSION_INVALID');
  assert.equal((await game(fx.roomId)).phase, 'lobby');
  assert.equal((await assignments(fx.roomId)).length, 0, 'a rejected start leaves nothing behind');
  // the game would outlive the room
  const short = await fixture({ members: 3, expiresIn: '10 minutes' });
  await fails(START_SQL, startArgs(short, await revision(short.roomId)), 'MISSION_UNAVAILABLE');
  // success
  await q(START_SQL, args(good));
  const g = await game(fx.roomId);
  assert.equal(g.phase, 'mission');
  assert.equal(Number((await one('select extract(epoch from (ends_at - started_at)) as s from public.mission_games where room_id=$1', [fx.roomId])).s), 3600);
  assert.deepEqual(g.reveal_order, [...fx.ids].reverse()); assert.equal(g.reveal_cursor, 0);
  assert.equal((await one('select status, revision from public.group_rooms where id=$1', [fx.roomId])).status, 'playing');
  assert.equal(await revision(fx.roomId), rev + 1);
  assert.equal((await assignments(fx.roomId)).length, 9);
  assert.ok((await assignments(fx.roomId)).every((row) => row.status === 'active'));
  await fails(START_SQL, startArgs(fx, await revision(fx.roomId)), 'MISSION_PHASE');
  // presets are enforced against the stored preset
  const hard = await fixture({ members: 3, settings: { preset: 'hard' } });
  await fails(START_SQL, startArgs(hard, await revision(hard.roomId), deal(hard, { preset: [1, 2, 3] })), 'MISSION_INVALID');
  await q(START_SQL, startArgs(hard, await revision(hard.roomId), deal(hard, { preset: [2, 3, 3] })));
  assert.equal((await game(hard.roomId)).phase, 'mission');
  // eight members is the ceiling, nine can never exist; a duration bigger than the time left is refused
  const long = await fixture({ members: 3, settings: { durationMinutes: 120 }, expiresIn: '90 minutes' });
  await fails(START_SQL, startArgs(long, await revision(long.roomId)), 'MISSION_UNAVAILABLE');
});

test('achieve / unachieve / pass: own missions only, idempotent, no revision, and they close with the reveal', async () => {
  const fx = await fixture(); await startGame(fx);
  const [a, b] = fx.ids;
  const mineA = await live(fx.roomId, a, 1); const mineB = await live(fx.roomId, b, 1);
  const rev = await revision(fx.roomId);
  const set = (member, id, status) => q('select public.mission_set_status($1,$2,$3,$4)', [fx.roomId, member, id, status]);
  await fails('select public.mission_set_status($1,$2,$3,$4)', [fx.roomId, a, mineB.id, 'achieved'], 'FORBIDDEN'); // somebody else's
  await fails('select public.mission_set_status($1,$2,$3,$4)', [fx.roomId, a, GHOST, 'achieved'], 'FORBIDDEN');
  await fails('select public.mission_set_status($1,$2,$3,$4)', [fx.roomId, a, mineA.id, 'swapped'], 'MISSION_INVALID');
  await set(a, mineA.id, 'achieved'); await set(a, mineA.id, 'achieved');
  assert.equal((await live(fx.roomId, a, 1)).status, 'achieved');
  await set(a, mineA.id, 'active'); await set(a, mineA.id, 'active');
  assert.equal((await live(fx.roomId, a, 1)).status, 'active', 'a mistaken tap can be taken back');
  await set(a, mineA.id, 'passed'); await set(a, mineA.id, 'passed');
  assert.equal((await one('select status from public.mission_assignments where id=$1', [mineA.id])).status, 'passed');
  assert.equal(await live(fx.roomId, a, 1), undefined, 'a passed slot stays empty (no refill)');
  await fails('select public.mission_set_status($1,$2,$3,$4)', [fx.roomId, a, mineA.id, 'achieved'], 'MISSION_UNAVAILABLE'); // passed is final
  await fails('select public.mission_set_status($1,$2,$3,$4)', [fx.roomId, a, mineA.id, 'active'], 'MISSION_UNAVAILABLE');
  const second = await live(fx.roomId, a, 2);
  await set(a, second.id, 'achieved');
  await fails('select public.mission_set_status($1,$2,$3,$4)', [fx.roomId, a, second.id, 'passed'], 'MISSION_UNAVAILABLE'); // achieved must be taken back first
  assert.equal(await revision(fx.roomId), rev, 'private taps never move the room revision');
  // the last chance to record stays open in reveal_ready, and closes when the reveal starts
  await backdate(fx.roomId); await rpc('mission_expire', fx.roomId);
  assert.equal((await game(fx.roomId)).phase, 'reveal_ready');
  await set(a, second.id, 'active'); await set(a, second.id, 'achieved');
  await rpc('mission_reveal_start', fx.roomId, fx.host, await revision(fx.roomId));
  await fails('select public.mission_set_status($1,$2,$3,$4)', [fx.roomId, a, second.id, 'active'], 'MISSION_PHASE');
});

test('swap: once per member, same difficulty, only an active own mission; a failed swap consumes nothing and a swapped id is never dealt again', async () => {
  const fx = await fixture(); await startGame(fx);
  const [a, b] = fx.ids;
  const first = await live(fx.roomId, a, 1);
  await fails(SWAP_SQL, [fx.roomId, a, (await live(fx.roomId, b, 1)).id, newItem(901, 1)], 'FORBIDDEN');
  await fails(SWAP_SQL, [fx.roomId, a, first.id, newItem(901, 2)], 'MISSION_INVALID'); // different difficulty
  await fails(SWAP_SQL, [fx.roomId, a, first.id, newItem(901, 1, { targetMemberId: a })], 'MISSION_INVALID'); // yourself
  await fails(SWAP_SQL, [fx.roomId, a, first.id, newItem(901, 1, { targetMemberId: GHOST })], 'MISSION_INVALID');
  await fails(SWAP_SQL, [fx.roomId, a, first.id, JSON.stringify({ missionId: 'x', difficulty: 1, topic: 't' })], 'MISSION_INVALID');
  // H1: an id that was dealt to somebody; H3: the same topic on the same person
  const dealt = await live(fx.roomId, b, 1);
  await fails(SWAP_SQL, [fx.roomId, a, first.id, newItem(902, 1).replace('mission-902', dealt.mission_id)], 'MISSION_POOL_EXHAUSTED');
  const chased = await one(`select * from public.mission_assignments where room_id=$1 and target_member_id is not null and member_id <> $2 and target_member_id <> $2 and status='active' limit 1`, [fx.roomId, a]);
  await fails(SWAP_SQL, [fx.roomId, a, first.id, JSON.stringify({ missionId: 'mission-903', difficulty: 1, topic: chased.topic, targetMemberId: chased.target_member_id })], 'MISSION_POOL_EXHAUSTED');
  assert.equal((await one('select count(*)::int n from public.mission_swaps where room_id=$1', [fx.roomId])).n, 0, 'a failed swap does not use up the swap');
  assert.equal((await live(fx.roomId, a, 1)).id, first.id);
  // an achieved mission cannot be swapped
  const achieved = await live(fx.roomId, a, 2);
  await rpc('mission_set_status', fx.roomId, a, achieved.id, 'achieved');
  await fails(SWAP_SQL, [fx.roomId, a, achieved.id, newItem(904, 2)], 'MISSION_UNAVAILABLE');
  const rev = await revision(fx.roomId);
  await q(SWAP_SQL, [fx.roomId, a, first.id, newItem(905, 1)]);
  assert.equal(await revision(fx.roomId), rev, 'swapping is private: no revision');
  const now = await live(fx.roomId, a, 1);
  assert.equal(now.mission_id, 'mission-905'); assert.equal(now.status, 'active'); assert.notEqual(now.id, first.id);
  assert.equal((await one('select status from public.mission_assignments where id=$1', [first.id])).status, 'swapped');
  assert.equal((await one('select used from public.mission_swaps where room_id=$1 and member_id=$2', [fx.roomId, a])).used, 1);
  await fails(SWAP_SQL, [fx.roomId, a, now.id, newItem(906, 1)], 'MISSION_SWAP_LIMIT');
  // the id that was swapped away cannot come back to anyone, even in another slot of another member
  await fails(SWAP_SQL, [fx.roomId, b, (await live(fx.roomId, b, 1)).id, newItem(907, 1).replace('mission-907', first.mission_id)], 'MISSION_POOL_EXHAUSTED');
  // another member still has their own swap
  await q(SWAP_SQL, [fx.roomId, b, (await live(fx.roomId, b, 3)).id, newItem(908, 3)]);
  assert.equal((await one('select count(*)::int n from public.mission_swaps where room_id=$1', [fx.roomId])).n, 2);
  // not after the end, and not while the phase row is merely waiting to be flipped
  const late = await fixture(); await startGame(late);
  await backdate(late.roomId);
  await fails(SWAP_SQL, [late.roomId, late.ids[0], (await live(late.roomId, late.ids[0], 1)).id, newItem(909, 1)], 'MISSION_PHASE');
  await rpc('mission_expire', late.roomId);
  await fails(SWAP_SQL, [late.roomId, late.ids[0], (await live(late.roomId, late.ids[0], 1)).id, newItem(909, 1)], 'MISSION_PHASE');
});

test('expire is idempotent: a no-op before ends_at, one flip and one revision bump afterwards', async () => {
  const fx = await fixture(); await startGame(fx);
  const rev = await revision(fx.roomId);
  await rpc('mission_expire', fx.roomId);
  assert.equal((await game(fx.roomId)).phase, 'mission'); assert.equal(await revision(fx.roomId), rev);
  await backdate(fx.roomId);
  await rpc('mission_expire', fx.roomId);
  assert.equal((await game(fx.roomId)).phase, 'reveal_ready'); assert.equal(await revision(fx.roomId), rev + 1);
  await rpc('mission_expire', fx.roomId); await rpc('mission_expire', fx.roomId);
  assert.equal((await game(fx.roomId)).phase, 'reveal_ready'); assert.equal(await revision(fx.roomId), rev + 1);
  await rpc('mission_expire', GHOST); // unknown room: quietly nothing
  const lobby = await fixture(); await rpc('mission_expire', lobby.roomId);
  assert.equal((await game(lobby.roomId)).phase, 'lobby');
});

test('end_now: host only, revision, mission phase; ends_at becomes the real end and never precedes started_at', async () => {
  const fx = await fixture(); await startGame(fx);
  const sql = 'select public.mission_end_now($1,$2,$3)';
  await fails(sql, [fx.roomId, fx.ids[1], await revision(fx.roomId)], 'MISSION_NOT_OWNER');
  await fails(sql, [fx.roomId, fx.host, (await revision(fx.roomId)) + 1], 'GROUP_STALE');
  const before = await game(fx.roomId);
  await q(sql, [fx.roomId, fx.host, await revision(fx.roomId)]);
  const after = await game(fx.roomId);
  assert.equal(after.phase, 'reveal_ready');
  assert.ok(new Date(after.ends_at) <= new Date() && new Date(after.ends_at) >= new Date(before.started_at));
  assert.ok(new Date(after.ends_at) < new Date(before.ends_at));
  await fails(sql, [fx.roomId, fx.host, await revision(fx.roomId)], 'MISSION_PHASE');
  const lobby = await fixture();
  await fails(sql, [lobby.roomId, lobby.host, await revision(lobby.roomId)], 'MISSION_PHASE');
});

test('extend: +15 minutes at most twice, only while the mission runs, never past the room expiry', async () => {
  const fx = await fixture(); await startGame(fx);
  const sql = 'select public.mission_extend($1,$2,$3,$4)';
  const endsAt = async () => new Date((await game(fx.roomId)).ends_at).getTime();
  const t0 = await endsAt();
  await fails(sql, [fx.roomId, fx.ids[1], 15, await revision(fx.roomId)], 'MISSION_NOT_OWNER');
  await fails(sql, [fx.roomId, fx.host, 15, (await revision(fx.roomId)) + 1], 'GROUP_STALE');
  await fails(sql, [fx.roomId, fx.host, 30, await revision(fx.roomId)], 'MISSION_INVALID');
  await fails(sql, [fx.roomId, fx.host, null, await revision(fx.roomId)], 'MISSION_INVALID');
  await q(sql, [fx.roomId, fx.host, 15, await revision(fx.roomId)]);
  assert.equal(await endsAt() - t0, 15 * 60 * 1000);
  await q(sql, [fx.roomId, fx.host, 15, await revision(fx.roomId)]);
  assert.equal(await endsAt() - t0, 30 * 60 * 1000);
  await fails(sql, [fx.roomId, fx.host, 15, await revision(fx.roomId)], 'MISSION_EXTEND_LIMIT');
  assert.equal((await game(fx.roomId)).extensions, 2);
  // bounded by the room's own 24h limit
  const tight = await fixture({ settings: { durationMinutes: 30 }, expiresIn: '40 minutes' }); await startGame(tight);
  await fails(sql, [tight.roomId, tight.host, 15, await revision(tight.roomId)], 'MISSION_UNAVAILABLE');
  // not in the lobby, not after the end
  const lobby = await fixture();
  await fails(sql, [lobby.roomId, lobby.host, 15, await revision(lobby.roomId)], 'MISSION_PHASE');
  await backdate(fx.roomId);
  await fails(sql, [fx.roomId, fx.host, 15, await revision(fx.roomId)], 'MISSION_PHASE');
});

test('reveal: the host starts, guests only 3 minutes after the real end; the host steps through everyone, then the game is deleted and only the summary remains', async () => {
  const fx = await fixture({ members: 3 }); await startGame(fx);
  const start = 'select public.mission_reveal_start($1,$2,$3)';
  const guest = fx.ids[1];
  await fails(start, [fx.roomId, fx.host, await revision(fx.roomId)], 'MISSION_PHASE'); // still on a mission
  await backdate(fx.roomId); await rpc('mission_expire', fx.roomId);
  await fails(start, [fx.roomId, guest, await revision(fx.roomId)], 'MISSION_NOT_OWNER'); // ends_at was 1 minute ago
  await fails(start, [fx.roomId, GHOST, await revision(fx.roomId)], 'FORBIDDEN');
  await fails(start, [fx.roomId, fx.host, (await revision(fx.roomId)) + 1], 'GROUP_STALE');
  await q(`update public.mission_games set ends_at = now() - interval '181 seconds' where room_id=$1`, [fx.roomId]);
  await q(start, [fx.roomId, guest, await revision(fx.roomId)]);
  let g = await game(fx.roomId); assert.equal(g.phase, 'reveal'); assert.equal(g.reveal_cursor, 0);
  // the representative idle for under 3 minutes: guests may not drive the reveal yet
  await q(`update public.mission_games set ends_at = now() - interval '1 minute' where room_id=$1`, [fx.roomId]);
  await fails(NEXT_SQL, [fx.roomId, guest, await revision(fx.roomId), null], 'MISSION_NOT_OWNER');
  await fails(NEXT_SQL, [fx.roomId, GHOST, await revision(fx.roomId), null], 'FORBIDDEN');
  await fails(NEXT_SQL, [fx.roomId, fx.host, (await revision(fx.roomId)) + 1, null], 'GROUP_STALE');
  await fails(start, [fx.roomId, fx.host, await revision(fx.roomId)], 'MISSION_PHASE');
  await revealNext(fx); g = await game(fx.roomId); assert.equal(g.reveal_cursor, 1);
  // 3 minutes after the real end time anybody may step on (the representative may have left)
  await q(`update public.mission_games set ends_at = now() - interval '181 seconds' where room_id=$1`, [fx.roomId]);
  await revealNext(fx, guest); g = await game(fx.roomId); assert.equal(g.reveal_cursor, 2); assert.equal(g.phase, 'reveal');
  assert.equal((await one('select status from public.group_rooms where id=$1', [fx.roomId])).status, 'playing');
  assert.equal(await countRows('mission_results', fx.roomId), 0, 'no summary while people are still being revealed');
  const revBefore = await revision(fx.roomId);
  await revealNext(fx);
  // the last person: the whole game is gone at once, the room ends, and only the minimal summary stays for 5 minutes
  assert.equal(await game(fx.roomId), undefined);
  for (const table of ['mission_games', 'mission_assignments', 'mission_swaps']) assert.equal(await countRows(table, fx.roomId), 0, table);
  assert.equal((await one('select status from public.group_rooms where id=$1', [fx.roomId])).status, 'ended', 'the room ends (frees the host cap)');
  assert.equal(await revision(fx.roomId), revBefore + 1);
  const kept = await results(fx.roomId);
  assert.equal(kept.result.achievedTotal, 0); assert.deepEqual(Object.keys(kept.result.members).sort(), [...fx.ids].sort());
  const ttl = Number((await one('select extract(epoch from (result_expires_at - now())) as s from public.mission_results where room_id=$1', [fx.roomId])).s);
  assert.ok(ttl > 290 && ttl <= 300, `result_expires_at is about 5 minutes ahead (${ttl}s)`);
  await fails(NEXT_SQL, [fx.roomId, fx.host, await revision(fx.roomId), null], 'MISSION_PHASE');
  // an eight-person game fits the cursor ceiling
  const eight = await fixture({ members: 8 }); await startGame(eight);
  await rpc('mission_end_now', eight.roomId, eight.host, await revision(eight.roomId));
  await rpc('mission_reveal_start', eight.roomId, eight.host, await revision(eight.roomId));
  for (let i = 0; i < 7; i += 1) await revealNext(eight);
  assert.equal((await game(eight.roomId)).reveal_cursor, 7);
  await revealNext(eight);
  assert.equal(await game(eight.roomId), undefined); assert.equal(Object.keys((await results(eight.roomId)).result.members).length, 8);
});

test('the last reveal_next accepts only a summary that matches the achieved rows; earlier ones accept none; phase can never be summary', async () => {
  const fx = await fixture({ members: 3 }); await startGame(fx);
  const [a, b] = fx.ids;
  await rpc('mission_set_status', fx.roomId, a, (await live(fx.roomId, a, 1)).id, 'achieved');
  await rpc('mission_set_status', fx.roomId, b, (await live(fx.roomId, b, 2)).id, 'achieved');
  await rpc('mission_end_now', fx.roomId, fx.host, await revision(fx.roomId));
  await rpc('mission_reveal_start', fx.roomId, fx.host, await revision(fx.roomId));
  const good = await summaryOf(fx, { [a]: ['聞き上手'] });
  assert.equal(good.achievedTotal, 2);
  const rev = () => revision(fx.roomId);
  // before the last person a summary is refused outright (nothing may be stored early)
  await fails(NEXT_SQL, [fx.roomId, fx.host, await rev(), JSON.stringify(good)], 'MISSION_INVALID');
  await revealNext(fx); await revealNext(fx);
  const last = async (value) => fails(NEXT_SQL, [fx.roomId, fx.host, await rev(), value === null ? null : JSON.stringify(value)], 'MISSION_INVALID');
  await last(null);
  await last({ ...good, achievedTotal: 3 });
  await last({ ...good, achievedTotal: '2' });
  await last({ ...good, extra: 1 });
  await last({ achievedTotal: 2, members: { ...good.members, [GHOST]: { achieved: 0, titles: [] } } });
  await last({ achievedTotal: 2, members: Object.fromEntries(Object.entries(good.members).slice(1)) });
  await last({ ...good, members: { ...good.members, [a]: { achieved: 2, titles: [] } } });
  await last({ ...good, members: { ...good.members, [a]: { achieved: 1, titles: 'x' } } });
  await last({ ...good, members: { ...good.members, [a]: { achieved: 1, titles: ['x'.repeat(21)] } } });
  await last({ ...good, members: { ...good.members, [a]: { achieved: 1, titles: [1] } } });
  await last({ ...good, members: { ...good.members, [a]: { achieved: 1, titles: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] } } });
  await last({ ...good, members: { ...good.members, [a]: { achieved: 1, titles: [], missions: ['mission-100'] } } });
  assert.equal(await countRows('mission_results', fx.roomId), 0, 'every refusal left the game and the room untouched');
  assert.equal((await game(fx.roomId)).phase, 'reveal');
  await q(NEXT_SQL, [fx.roomId, fx.host, await rev(), JSON.stringify(good)]);
  assert.deepEqual((await results(fx.roomId)).result, good);
  await assert.rejects(() => q(`update public.mission_games set phase='summary'`), /check|violates/i);
});

test('the kept summary disappears 5 minutes after the end: within the limit it stays, at the limit the sweep deletes it, the room stays until its own expiry', async () => {
  const fx = await fixture({ members: 3 }); await startGame(fx);
  await rpc('mission_set_status', fx.roomId, fx.ids[0], (await live(fx.roomId, fx.ids[0], 1)).id, 'achieved');
  await rpc('mission_end_now', fx.roomId, fx.host, await revision(fx.roomId));
  await rpc('mission_reveal_start', fx.roomId, fx.host, await revision(fx.roomId));
  for (let i = 0; i < 3; i += 1) await revealNext(fx);
  const other = await fixture({ members: 3 }); await startGame(other);
  await rpc('mission_end_now', other.roomId, other.host, await revision(other.roomId));
  await rpc('mission_reveal_start', other.roomId, other.host, await revision(other.roomId));
  for (let i = 0; i < 3; i += 1) await revealNext(other);
  // exactly what the group cleanup / the state read sends to PostgREST: delete ... where result_expires_at <= <now>
  const sweep = (at) => q(`delete from public.mission_results where result_expires_at <= $1::timestamptz`, [at]);
  const expires = (await results(fx.roomId)).result_expires_at;
  await sweep(new Date(new Date(expires).getTime() - 1000).toISOString());
  assert.equal(await countRows('mission_results', fx.roomId), 1, '4:59 after the end: still there');
  await q(`update public.mission_results set result_expires_at = now() - interval '1 second' where room_id=$1`, [fx.roomId]);
  await sweep(new Date().toISOString());
  assert.equal(await countRows('mission_results', fx.roomId), 0, 'past result_expires_at: deleted');
  assert.equal(await countRows('mission_results', other.roomId), 1, 'another room within its 5 minutes is untouched');
  assert.equal(await countRows('mission_games', fx.roomId) + await countRows('mission_assignments', fx.roomId) + await countRows('mission_swaps', fx.roomId), 0);
  assert.equal((await one('select status from public.group_rooms where id=$1', [fx.roomId])).status, 'ended');
  // the room's own 24h expiry removes the summary too
  await q('delete from public.group_rooms where id=$1', [other.roomId]);
  assert.equal(await countRows('mission_results', other.roomId), 0);
});

test('reveal_start erases everything that will never be shown; the last reveal deletes the rest; nobody can cut the kept summary short', async () => {
  const fx = await fixture({ members: 3 }); await startGame(fx);
  const [a, b] = fx.ids;
  const first = await live(fx.roomId, a, 1); const second = await live(fx.roomId, a, 2);
  await rpc('mission_set_status', fx.roomId, a, first.id, 'achieved');
  await rpc('mission_set_status', fx.roomId, a, second.id, 'passed');
  await q(SWAP_SQL, [fx.roomId, b, (await live(fx.roomId, b, 1)).id, newItem(970, 1)]);
  await rpc('mission_end_now', fx.roomId, fx.host, await revision(fx.roomId));
  assert.ok((await assignments(fx.roomId)).some((row) => row.status !== 'achieved'), 'recording stays possible until the reveal');
  assert.equal((await one('select count(*)::int n from public.mission_swaps where room_id=$1', [fx.roomId])).n, 1);
  await rpc('mission_reveal_start', fx.roomId, fx.host, await revision(fx.roomId));
  const left = await assignments(fx.roomId);
  assert.deepEqual(left.map((row) => row.status), ['achieved']);
  assert.equal(left[0].id, first.id);
  assert.equal((await one('select count(*)::int n from public.mission_swaps where room_id=$1', [fx.roomId])).n, 0);
  for (let i = 0; i < 3; i += 1) await revealNext(fx);
  // nothing but the minimal summary is left: not even the one achieved mission row
  for (const table of ['mission_games', 'mission_assignments', 'mission_swaps']) assert.equal(await countRows(table, fx.roomId), 0, table);
  assert.equal((await one('select status from public.group_rooms where id=$1', [fx.roomId])).status, 'ended');
  assert.equal((await results(fx.roomId)).result.members[a].achieved, 1);
  await fails('select public.mission_set_status($1,$2,$3,$4)', [fx.roomId, a, first.id, 'active'], 'MISSION_PHASE');
  const fin = 'select public.mission_finish($1,$2,$3)';
  // the summary is not cut short by finish -- not by a guest, a stranger or the representative
  for (const who of [b, GHOST, fx.host]) await fails(fin, [fx.roomId, who, await revision(fx.roomId)], 'MISSION_PHASE');
  assert.equal(await countRows('mission_results', fx.roomId), 1);
  // a guest can never finish a game that is still being played, however late it is
  const live2 = await fixture(); await startGame(live2);
  await backdate(live2.roomId); await rpc('mission_expire', live2.roomId);
  await q(`update public.mission_games set ends_at = now() - interval '10 minutes' where room_id=$1`, [live2.roomId]);
  await fails(fin, [live2.roomId, live2.ids[1], await revision(live2.roomId)], 'MISSION_NOT_OWNER');
  await q('select public.mission_reveal_start($1,$2,$3)', [live2.roomId, live2.ids[1], await revision(live2.roomId)]);
  await q(fin, [live2.roomId, live2.ids[2], await revision(live2.roomId)]); // during the reveal, after the grace
  assert.equal((await one('select status from public.group_rooms where id=$1', [live2.roomId])).status, 'ended');
});

test('finish erases assignments and swaps and ends the room; host only, current revision, any phase, once', async () => {
  const fx = await fixture(); await startGame(fx);
  await rpc('mission_set_status', fx.roomId, fx.ids[0], (await live(fx.roomId, fx.ids[0], 1)).id, 'achieved');
  await q(SWAP_SQL, [fx.roomId, fx.ids[1], (await live(fx.roomId, fx.ids[1], 1)).id, newItem(950, 1)]);
  const sql = 'select public.mission_finish($1,$2,$3)';
  await fails(sql, [fx.roomId, fx.ids[1], await revision(fx.roomId)], 'MISSION_NOT_OWNER');
  await fails(sql, [fx.roomId, fx.host, (await revision(fx.roomId)) - 1], 'GROUP_STALE');
  await q(sql, [fx.roomId, fx.host, await revision(fx.roomId)]);
  for (const table of ['mission_games', 'mission_assignments', 'mission_swaps']) assert.equal((await one(`select count(*)::int n from public.${table} where room_id=$1`, [fx.roomId])).n, 0, table);
  assert.equal((await one('select status from public.group_rooms where id=$1', [fx.roomId])).status, 'ended');
  await fails(sql, [fx.roomId, fx.host, await revision(fx.roomId)], 'MISSION_PHASE');
  await fails('select public.mission_set_status($1,$2,$3,$4)', [fx.roomId, fx.ids[0], GHOST, 'achieved'], 'MISSION_PHASE');
  assert.equal(await countRows('mission_results', fx.roomId), 0, 'an early finish keeps no summary');
  // from the lobby, and from the middle of the reveal: still no summary
  const lobby = await fixture();
  await q(sql, [lobby.roomId, lobby.host, await revision(lobby.roomId)]);
  assert.equal((await one('select count(*)::int n from public.mission_games where room_id=$1', [lobby.roomId])).n, 0);
  const done = await fixture(); await startGame(done);
  await rpc('mission_set_status', done.roomId, done.ids[0], (await live(done.roomId, done.ids[0], 1)).id, 'achieved');
  await rpc('mission_end_now', done.roomId, done.host, await revision(done.roomId));
  await rpc('mission_reveal_start', done.roomId, done.host, await revision(done.roomId));
  await revealNext(done);
  await q(sql, [done.roomId, done.host, await revision(done.roomId)]);
  for (const table of ['mission_games', 'mission_assignments', 'mission_results']) assert.equal(await countRows(table, done.roomId), 0, table);
  assert.equal((await one('select status from public.group_rooms where id=$1', [done.roomId])).status, 'ended');
});

test('a full 4-person game end to end, including the 24h cleanup cascade', async () => {
  const fx = await fixture({ members: 4, settings: { preset: 'easy', durationMinutes: 30 } });
  await startGame(fx, { list: deal(fx, { preset: [1, 1, 2] }) });
  for (const memberId of fx.ids) await rpc('mission_set_status', fx.roomId, memberId, (await live(fx.roomId, memberId, 1)).id, 'achieved');
  await rpc('mission_extend', fx.roomId, fx.host, 15, await revision(fx.roomId));
  await rpc('mission_end_now', fx.roomId, fx.host, await revision(fx.roomId));
  await rpc('mission_reveal_start', fx.roomId, fx.host, await revision(fx.roomId));
  assert.equal((await one(`select count(*)::int n from public.mission_assignments where room_id=$1 and status='achieved'`, [fx.roomId])).n, 4);
  for (let i = 0; i < 4; i += 1) await revealNext(fx);
  assert.equal(await countRows('mission_results', fx.roomId), 1);
  await q('delete from public.group_rooms where id=$1', [fx.roomId]);
  for (const table of ['mission_games', 'mission_assignments', 'mission_swaps', 'mission_results']) assert.equal((await one(`select count(*)::int n from public.${table} where room_id=$1`, [fx.roomId])).n, 0, `${table} cascades with the room`);
});

test('expired rooms reject every transition', async () => {
  const fx = await fixture(); await startGame(fx);
  const mine = await live(fx.roomId, fx.ids[0], 1);
  await q(`update public.group_rooms set expires_at=now()-interval '1 second' where id=$1`, [fx.roomId]);
  await fails('select public.mission_set_status($1,$2,$3,$4)', [fx.roomId, fx.ids[0], mine.id, 'achieved'], 'MISSION_PHASE');
  await fails(SWAP_SQL, [fx.roomId, fx.ids[0], mine.id, newItem(960, 1)], 'MISSION_PHASE');
  await fails('select public.mission_end_now($1,$2,$3)', [fx.roomId, fx.host, await revision(fx.roomId)], 'MISSION_PHASE');
  await fails('select public.mission_finish($1,$2,$3)', [fx.roomId, fx.host, await revision(fx.roomId)], 'MISSION_PHASE');
  await rpc('mission_expire', fx.roomId);
  assert.equal((await game(fx.roomId)).phase, 'mission', 'expiry of the room is the cleanup job, not a transition');
});

test('the migration is re-runnable and does not touch the shared game_type constraint', async () => {
  const before = (await one(`select pg_get_constraintdef(oid) as def from pg_constraint where conrelid='public.group_rooms'::regclass and conname='group_rooms_game_type'`)).def;
  await db.exec('reset role');
  await db.exec(await readFile(MISSION_SQL, 'utf8'));
  await db.exec('set role service_role');
  const after = (await one(`select pg_get_constraintdef(oid) as def from pg_constraint where conrelid='public.group_rooms'::regclass and conname='group_rooms_game_type'`)).def;
  assert.equal(after, before);
  assert.ok(after.includes("'mission_mingle'"));
  const fx = await fixture(); await startGame(fx);
  assert.equal((await game(fx.roomId)).phase, 'mission');
  // grants survive a second run
  await db.exec('set role anon');
  await fails('select public.mission_expire($1)', [fx.roomId], 'permission denied');
  await db.exec('set role service_role');
  assert.equal(/alter table public\.group_rooms/i.test(await readFile(MISSION_SQL, 'utf8')), false);
});

test.after(async () => { await db.close(); });

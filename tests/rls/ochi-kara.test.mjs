import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

// Applies group-rooms -> minority -> question-wolf -> game-types -> ochi, as production does.
const owner = '11111111-1111-4111-8111-111111111111';
const pool = Array.from({ length: 40 }, (_, i) => ({ id: `ochi-${String(i + 1).padStart(3, '0')}`, text: `オチ${i}`, category: ['food', 'place', 'thing', 'oops'][i % 4] }));
const FILES = ['202610080001_group_rooms.sql', '202610150001_minority_topic.sql', '202610160001_question_wolf.sql', '202610170001_group_game_types.sql', '202610170002_ochi_kara.sql'];

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
const game = (roomId) => one('select * from public.ochi_games where room_id=$1', [roomId]);
// the minimal closing data kept for 5 minutes after the game ends (the game row itself is deleted at once)
const kept = (roomId) => one('select * from public.ochi_results where room_id=$1', [roomId]);
const gameRows = async (roomId) => (await one('select count(*)::int n from public.ochi_games where room_id=$1', [roomId])).n;
const turn = (roomId, no) => one('select * from public.ochi_turns where room_id=$1 and turn_no=$2', [roomId, no]);
const handsFor = (ids, from = 0) => Object.fromEntries(ids.map((id, i) => [id, { idx: from + i, text: pool[from + i].text }]));

let counter = 0;
async function fixture({ members = 3, laps = 1 } = {}) {
  counter += 1; const tag = `fx${counter}`;
  const created = await one(`select * from public.ochi_create_room($1,$2,$3,'Host',now()+interval '1 hour',$4::jsonb,$5)`, [owner, tag, `${tag}-host`, JSON.stringify(pool), laps]);
  for (let i = 1; i < members; i += 1) await q(`insert into public.group_members(room_id,secret_hash,display_name,role) values ($1,$2,$3,'guest')`, [created.room_id, `${tag}-g${i}`, `G${i}`]);
  await q('update public.group_rooms set member_count=$2 where id=$1', [created.room_id, members]);
  const rows = (await q(`select id, role from public.group_members where room_id=$1 order by role desc, secret_hash`, [created.room_id])).rows;
  return { roomId: created.room_id, host: created.host_member_id, ids: rows.map((row) => row.id), laps };
}
const startArgs = (fx, rev, order = fx.ids, from = 0) => [fx.roomId, fx.host, rev, JSON.stringify(Array.from({ length: fx.laps }, () => order).flat()), JSON.stringify(handsFor(fx.ids, from))];
async function startGame(fx, order) { await rpc('ochi_start', ...startArgs(fx, await revision(fx.roomId), order)); }
async function confirmAll(fx) { for (const id of fx.ids) await rpc('ochi_confirm', fx.roomId, (await game(fx.roomId)).turn_no, id); }
// Plays one speaker turn: ready -> telling -> vote -> (last vote) reveal -> reveal -> result. votes: {voterId: guess}
async function playTurn(fx, truth, votes) {
  const g = await game(fx.roomId); const t = await turn(fx.roomId, g.turn_no); const speaker = t.speaker_id;
  await rpc('ochi_begin_tell', fx.roomId, g.turn_no, speaker);
  await rpc('ochi_finish_tell', fx.roomId, g.turn_no, speaker, truth);
  for (const [voter, guess] of Object.entries(votes)) await rpc('ochi_cast_vote', fx.roomId, g.turn_no, voter, guess);
  if ((await game(fx.roomId)).phase !== 'reveal') await rpc('ochi_close_vote', fx.roomId, g.turn_no, fx.host);
  await rpc('ochi_reveal', fx.roomId, g.turn_no, speaker, null);
  return { speaker, turn: await turn(fx.roomId, g.turn_no) };
}

test('ochi tables and RPCs are service_role only', async () => {
  const fx = await fixture();
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`);
    for (const table of ['ochi_games', 'ochi_turns', 'ochi_votes', 'ochi_results']) await fails(`select * from public.${table}`, [], 'permission denied');
    await fails(`insert into public.ochi_games(room_id,pool) values ('${fx.roomId}','[]')`, [], 'permission denied');
    await fails('select public.ochi_confirm($1,1,$2)', [fx.roomId, fx.host], 'permission denied');
    await fails(`select * from public.ochi_create_room($1,'i','s','H',now()+interval '1 hour','[]'::jsonb,1)`, [owner], 'permission denied');
    await fails('select public.ochi_open_turn($1)', [fx.roomId], 'permission denied');
    await fails('select public.ochi_hands_ok($1::jsonb,$1::jsonb,$1::jsonb,$2,true)', ['{}', fx.roomId], 'permission denied');
  }
  await db.exec('set role service_role');
  for (const table of ['ochi_games', 'ochi_turns', 'ochi_votes', 'ochi_results']) assert.equal((await one(`select relrowsecurity from pg_class where oid='public.${table}'::regclass`)).relrowsecurity, true, table);
  const room = await one('select * from public.group_rooms where id=$1', [fx.roomId]);
  assert.equal(room.game_type, 'ochi_kara');
  assert.equal(room.adult_only, false);
  assert.ok(room.cards.length >= 6 && room.cards.length <= 40);
  assert.ok(room.cards.every((card) => !pool.some((p) => p.text === card.text)), 'room cards hold no ochi text');
  assert.equal((await game(fx.roomId)).phase, 'lobby');
});

test('create validates the pool and laps', async () => {
  const create = (poolValue, laps) => fails(`select * from public.ochi_create_room($1,'v','v','H',now()+interval '1 hour',$2::jsonb,$3)`, [owner, JSON.stringify(poolValue), laps], 'OCHI_INVALID');
  await create(pool.slice(0, 5), 1);
  await create(pool, 3);
  await create([...pool.slice(0, 5), { id: 'ochi-001', text: 'dup', category: 'food' }], 1);
  await create([...pool.slice(0, 5), { id: 'x', category: 'food' }], 1);
});

test('start enforces host, revision, 2-8 members, order permutation and a verified deal', async () => {
  const solo = await fixture({ members: 1 });
  await fails('select public.ochi_start($1,$2,$3,$4::jsonb,$5::jsonb)', startArgs(solo, await revision(solo.roomId)), 'OCHI_PARTICIPANTS');
  const fx = await fixture({ members: 3 });
  const rev = await revision(fx.roomId);
  const sql = 'select public.ochi_start($1,$2,$3,$4::jsonb,$5::jsonb)';
  const guest = fx.ids.find((id) => id !== fx.host);
  await fails(sql, [fx.roomId, guest, rev, ...startArgs(fx, rev).slice(3)], 'FORBIDDEN');
  await fails(sql, [fx.roomId, fx.host, rev + 1, ...startArgs(fx, rev).slice(3)], 'GROUP_STALE');
  await fails(sql, startArgs(fx, rev, [fx.ids[0], fx.ids[0], fx.ids[1]]), 'OCHI_INVALID');
  await fails(sql, startArgs(fx, rev, [fx.ids[0], fx.ids[1]]), 'OCHI_INVALID');
  const bad = startArgs(fx, rev);
  await fails(sql, [...bad.slice(0, 4), JSON.stringify({ ...handsFor(fx.ids), [fx.ids[1]]: { idx: 0, text: pool[0].text } })], 'OCHI_INVALID'); // duplicate card
  await fails(sql, [...bad.slice(0, 4), JSON.stringify({ ...handsFor(fx.ids), [fx.ids[1]]: { idx: 1, text: 'forged' } })], 'OCHI_INVALID'); // text not from the pool
  await fails(sql, [...bad.slice(0, 4), JSON.stringify({ [fx.ids[0]]: { idx: 0, text: pool[0].text } })], 'OCHI_INVALID'); // not every member dealt
  await fails(sql, [...bad.slice(0, 4), JSON.stringify({ ...handsFor(fx.ids), '44444444-4444-4444-8444-444444444444': { idx: 9, text: pool[9].text } })], 'OCHI_INVALID');
  assert.equal((await game(fx.roomId)).phase, 'lobby');
  await q(sql, bad);
  const g = await game(fx.roomId);
  assert.equal(g.phase, 'deal'); assert.equal(g.turn_no, 1);
  assert.equal(Object.keys(g.hands).length, 3);
  assert.ok(Object.values(g.hands).every((hand) => hand.swapUsed === false));
  assert.deepEqual([...g.used].sort(), [0, 1, 2]);
  assert.equal((await one('select status from public.group_rooms where id=$1', [fx.roomId])).status, 'playing');
  await fails(sql, bad, 'OCHI_PHASE');
});

test('full game: vote can only reach result through reveal, answers stay in the turn row, finish erases everything', async () => {
  const fx = await fixture({ members: 3 });
  await startGame(fx);
  const [a, b, c] = fx.ids;
  await fails('select public.ochi_confirm($1,2,$2)', [fx.roomId, a], 'OCHI_STALE_TURN');
  await fails('select public.ochi_force_ready($1,1,$2)', [fx.roomId, b], 'FORBIDDEN');
  await rpc('ochi_confirm', fx.roomId, 1, a); await rpc('ochi_confirm', fx.roomId, 1, a);
  assert.equal((await game(fx.roomId)).phase, 'deal');
  await fails('select public.ochi_begin_tell($1,1,$2)', [fx.roomId, a], 'OCHI_PHASE');
  await rpc('ochi_confirm', fx.roomId, 1, b); await rpc('ochi_confirm', fx.roomId, 1, c);
  let g = await game(fx.roomId); assert.equal(g.phase, 'ready');
  let t = await turn(fx.roomId, 1);
  assert.equal(t.speaker_id, a); assert.equal(t.ochi_text, pool[0].text); assert.equal(t.truth, null); assert.equal(t.truth_locked, false);

  // only the speaker or the host may start telling
  await fails('select public.ochi_begin_tell($1,1,$2)', [fx.roomId, b], 'OCHI_TURN');
  await rpc('ochi_begin_tell', fx.roomId, 1, a);
  t = await turn(fx.roomId, 1);
  assert.equal(t.status, 'telling');
  assert.equal(Number((await one('select extract(epoch from (tell_deadline - tell_started_at)) as s from public.ochi_turns where id=$1', [t.id])).s), 60);
  await fails('select public.ochi_finish_tell($1,1,$2,$3)', [fx.roomId, b, 'real'], 'OCHI_TURN'); // not the speaker or host
  await fails('select public.ochi_finish_tell($1,1,$2,null)', [fx.roomId, a], 'OCHI_PHASE'); // speaker must register an answer
  await fails('select public.ochi_finish_tell($1,1,$2,$3)', [fx.roomId, a, 'maybe'], 'OCHI_PHASE');
  await rpc('ochi_finish_tell', fx.roomId, 1, a, 'real');
  t = await turn(fx.roomId, 1);
  assert.equal(t.status, 'vote'); assert.equal(t.truth_locked, true);

  // voting: not the speaker, valid guess, once only
  await fails('select public.ochi_cast_vote($1,1,$2,$3)', [fx.roomId, a, 'real'], 'OCHI_TURN');
  await fails('select public.ochi_cast_vote($1,1,$2,$3)', [fx.roomId, b, 'maybe'], 'OCHI_INVALID');
  await fails('select public.ochi_cast_vote($1,1,$2,$3)', [fx.roomId, '44444444-4444-4444-8444-444444444444', 'real'], 'FORBIDDEN');
  await fails('select public.ochi_cast_vote($1,2,$2,$3)', [fx.roomId, b, 'real'], 'OCHI_STALE_TURN');
  // vote -> result is rejected while votes are still open and while waiting at the very first vote
  await fails('select public.ochi_reveal($1,1,$2,null)', [fx.roomId, a], 'OCHI_NOT_REVEALED');
  await rpc('ochi_cast_vote', fx.roomId, 1, b, 'fiction');
  await fails('select public.ochi_cast_vote($1,1,$2,$3)', [fx.roomId, b, 'real'], 'OCHI_ALREADY_VOTED');
  await fails('select public.ochi_close_vote($1,1,$2)', [fx.roomId, b], 'FORBIDDEN');
  await fails('select public.ochi_next_turn($1,1,$2,null)', [fx.roomId, fx.host], 'OCHI_PHASE');
  await rpc('ochi_cast_vote', fx.roomId, 1, c, 'real'); // last vote: reveal, NOT result
  g = await game(fx.roomId); t = await turn(fx.roomId, 1);
  assert.equal(g.phase, 'reveal'); assert.equal(t.status, 'reveal');
  assert.equal(t.score_delta && Object.keys(t.score_delta).length, 0, 'no points before the reveal');
  await fails('select public.ochi_cast_vote($1,1,$2,$3)', [fx.roomId, c, 'real'], 'OCHI_VOTE_CLOSED');
  await fails('select public.ochi_reveal($1,1,$2,null)', [fx.roomId, b], 'OCHI_TURN');
  await rpc('ochi_reveal', fx.roomId, 1, a, 'fiction'); // registered answer wins over the argument
  g = await game(fx.roomId); t = await turn(fx.roomId, 1);
  assert.equal(g.phase, 'result'); assert.equal(t.truth, 'real');
  // truth=real: c guessed right (+1 listener); of 2 non-pass votes 1 missed, which is not a majority -> speaker 0
  assert.deepEqual(t.score_delta, { [c]: 1 });
  assert.deepEqual(g.scores[c], { listener: 1, teller: 0 }); assert.deepEqual(g.scores[a], { listener: 0, teller: 0 });
  await fails('select public.ochi_reveal($1,1,$2,null)', [fx.roomId, a], 'OCHI_PHASE'); // already revealed

  // turn 2: the speaker skips while ready
  await fails('select public.ochi_next_turn($1,1,$2,null)', [fx.roomId, b], 'FORBIDDEN');
  await rpc('ochi_next_turn', fx.roomId, 1, fx.host, null);
  g = await game(fx.roomId); assert.equal(g.turn_no, 2); assert.equal(g.phase, 'ready');
  assert.equal((await turn(fx.roomId, 2)).speaker_id, b);
  await fails('select public.ochi_skip($1,2,$2)', [fx.roomId, c], 'OCHI_TURN');
  await rpc('ochi_skip', fx.roomId, 2, b);
  assert.equal((await game(fx.roomId)).phase, 'skipped');
  await fails('select public.ochi_cast_vote($1,2,$2,$3)', [fx.roomId, a, 'real'], 'OCHI_VOTE_CLOSED');
  await rpc('ochi_next_turn', fx.roomId, 2, fx.host, null);

  // turn 3 (last): host finishes telling on the speaker's behalf -> no answer is registered; the speaker supplies it at reveal
  const last = await turn(fx.roomId, 3); assert.equal(last.speaker_id, c);
  await rpc('ochi_begin_tell', fx.roomId, 3, fx.host); // host proxy
  // M1(a): a host proxy may finish only 15 seconds after the 60 second clock ran out
  await fails('select public.ochi_finish_tell($1,3,$2,null)', [fx.roomId, fx.host], 'OCHI_PHASE');
  await q("update public.ochi_turns set tell_deadline=now()-interval '14 seconds' where room_id=$1 and turn_no=3", [fx.roomId]);
  await fails('select public.ochi_finish_tell($1,3,$2,null)', [fx.roomId, fx.host], 'OCHI_PHASE');
  await q("update public.ochi_turns set tell_deadline=now()-interval '16 seconds' where room_id=$1 and turn_no=3", [fx.roomId]);
  await rpc('ochi_finish_tell', fx.roomId, 3, fx.host, 'real'); // host's answer is ignored
  assert.equal((await turn(fx.roomId, 3)).truth, null);
  await rpc('ochi_cast_vote', fx.roomId, 3, a, 'pass');
  await rpc('ochi_close_vote', fx.roomId, 3, fx.host); // b never voted
  await fails('select public.ochi_reveal($1,3,$2,null)', [fx.roomId, c], 'OCHI_PHASE'); // no answer registered: one is required
  await rpc('ochi_reveal', fx.roomId, 3, fx.host, 'fiction'); // host proxy supplies what the speaker said
  t = await turn(fx.roomId, 3); assert.equal(t.truth, 'fiction'); assert.deepEqual(t.score_delta, {});

  // last turn -> the end: the whole game row (hands, answers, votes, pool, scores) is deleted at once
  const revBeforeFinal = await revision(fx.roomId);
  await rpc('ochi_next_turn', fx.roomId, 3, fx.host, null);
  assert.equal(await gameRows(fx.roomId), 0);
  assert.equal(await revision(fx.roomId), revBeforeFinal + 1); // the final transition bumps the room revision like the other games
  assert.equal((await one('select count(*)::int n from public.ochi_turns where room_id=$1', [fx.roomId])).n, 0);
  assert.equal((await one('select count(*)::int n from public.ochi_votes where voter_id=any($1::uuid[])', [fx.ids])).n, 0);
  // L4: the end also ends the room (frees the host's room cap); only the minimal result stays, for 5 minutes
  assert.equal((await one('select status from public.group_rooms where id=$1', [fx.roomId])).status, 'ended');
  const result = (await kept(fx.roomId)).result;
  assert.deepEqual(Object.keys(result).sort(), ['detective', 'laps', 'mysterious', 'scores', 'totalTurns']);
  assert.deepEqual(result.detective, [c]); assert.deepEqual(result.mysterious, []);
  assert.deepEqual(result.scores[c], { listener: 1, teller: 0 }); assert.equal(result.totalTurns, 3);
  const ttl = Number((await one('select extract(epoch from (result_expires_at - now())) as s from public.ochi_results where room_id=$1', [fx.roomId])).s);
  assert.ok(ttl > 290 && ttl <= 300, `result_expires_at is about 5 minutes ahead (${ttl}s)`);
  await fails('select public.ochi_finish($1,$2)', [fx.roomId, fx.host], 'OCHI_PHASE');
  await fails('select public.ochi_confirm($1,3,$2)', [fx.roomId, a], 'OCHI_PHASE');
  await assert.rejects(() => q(`update public.ochi_games set phase='final'`), /check|violates/i);
});

test('finish: host only, allowed from the lobby', async () => {
  const fx = await fixture({ members: 3 });
  await fails('select public.ochi_finish($1,$2)', [fx.roomId, fx.ids[1]], 'FORBIDDEN');
  await rpc('ochi_finish', fx.roomId, fx.host);
  assert.equal((await one('select count(*)::int n from public.ochi_games where room_id=$1', [fx.roomId])).n, 0);
});

test('finish mid-turn deletes the hands, the registered answer and the votes', async () => {
  const fx = await fixture({ members: 3 });
  await startGame(fx); await confirmAll(fx);
  const [a, b] = fx.ids;
  await rpc('ochi_begin_tell', fx.roomId, 1, a);
  await rpc('ochi_finish_tell', fx.roomId, 1, a, 'fiction');
  await rpc('ochi_cast_vote', fx.roomId, 1, b, 'real');
  assert.equal((await one('select count(*)::int n from public.ochi_votes v join public.ochi_turns t on t.id=v.turn_id where t.room_id=$1', [fx.roomId])).n, 1);
  await rpc('ochi_finish', fx.roomId, fx.host);
  assert.equal((await one('select count(*)::int n from public.ochi_turns where room_id=$1', [fx.roomId])).n, 0);
  assert.equal((await one('select count(*)::int n from public.ochi_votes where voter_id=any($1::uuid[])', [fx.ids])).n, 0);
  // L3: the whole game row is gone, nothing is left to read
  assert.equal((await one('select count(*)::int n from public.ochi_games where room_id=$1', [fx.roomId])).n, 0);
  assert.equal((await one('select status from public.group_rooms where id=$1', [fx.roomId])).status, 'ended');
  await fails('select public.ochi_finish($1,$2)', [fx.roomId, fx.host], 'OCHI_PHASE');
});

// A game where the first speaker is a guest and the host (ids[0]) finishes the telling on their behalf.
async function proxyFinished(members) {
  const fx = await fixture({ members });
  const order = [fx.ids[1], fx.ids[0], ...fx.ids.slice(2)];
  await startGame(fx, order); await confirmAll(fx);
  await rpc('ochi_begin_tell', fx.roomId, 1, order[0]);
  await q("update public.ochi_turns set tell_deadline=now()-interval '20 seconds' where room_id=$1", [fx.roomId]);
  await rpc('ochi_finish_tell', fx.roomId, 1, fx.host, null); // host proxy: nothing registered
  return { fx, host: fx.host, speaker: order[0], others: fx.ids.slice(2) };
}

test('host and speaker actions never depend on the room revision: a participant acting in between does not make them stale', async () => {
  const fx = await fixture({ members: 4 });
  const [a, b, c, d] = fx.ids;
  await startGame(fx);
  // deal: the host's force_ready after others confirmed/swapped since the host last looked
  await rpc('ochi_confirm', fx.roomId, 1, b); await rpc('ochi_confirm', fx.roomId, 1, c);
  await q('select public.ochi_swap($1,1,$2,$3::jsonb)', [fx.roomId, d, JSON.stringify({ idx: 20, text: pool[20].text })]);
  await rpc('ochi_force_ready', fx.roomId, 1, fx.host);
  // ready -> telling -> vote: each step right after another bumped the revision
  await rpc('ochi_begin_tell', fx.roomId, 1, a);
  await rpc('ochi_finish_tell', fx.roomId, 1, a, 'real');
  // a vote lands, then the host closes the vote without having seen it
  await rpc('ochi_cast_vote', fx.roomId, 1, b, 'real');
  await rpc('ochi_close_vote', fx.roomId, 1, fx.host);
  await rpc('ochi_reveal', fx.roomId, 1, a, null);
  await rpc('ochi_next_turn', fx.roomId, 1, fx.host, null);
  await rpc('ochi_skip', fx.roomId, 2, b);
  await rpc('ochi_next_turn', fx.roomId, 2, fx.host, null);
  // double clicks are still safe: the phase / turn number makes the repeat fail instead of advancing twice
  await rpc('ochi_begin_tell', fx.roomId, 3, c);
  await fails('select public.ochi_begin_tell($1,3,$2)', [fx.roomId, c], 'OCHI_PHASE');
  await rpc('ochi_skip', fx.roomId, 3, c);
  await fails('select public.ochi_skip($1,3,$2)', [fx.roomId, c], 'OCHI_PHASE');
  await rpc('ochi_next_turn', fx.roomId, 3, fx.host, null);
  await fails('select public.ochi_next_turn($1,3,$2,null)', [fx.roomId, fx.host], 'OCHI_STALE_TURN');
  assert.equal((await game(fx.roomId)).turn_no, 4);
  await rpc('ochi_finish', fx.roomId, fx.host);
});

test('M1(b): the speaker can register the answer during the vote, once, without a revision', async () => {
  const { fx, host, speaker, others } = await proxyFinished(4);
  assert.equal((await turn(fx.roomId, 1)).truth, null);
  await fails('select public.ochi_lock_truth($1,1,$2,$3)', [fx.roomId, host, 'real'], 'OCHI_TURN');
  await fails('select public.ochi_lock_truth($1,1,$2,$3)', [fx.roomId, speaker, 'maybe'], 'OCHI_INVALID');
  await fails('select public.ochi_lock_truth($1,2,$2,$3)', [fx.roomId, speaker, 'real'], 'OCHI_STALE_TURN');
  const rev = await revision(fx.roomId);
  await rpc('ochi_lock_truth', fx.roomId, 1, speaker, 'fiction');
  assert.equal(await revision(fx.roomId), rev + 1);
  assert.equal((await turn(fx.roomId, 1)).truth_locked, true);
  await fails('select public.ochi_lock_truth($1,1,$2,$3)', [fx.roomId, speaker, 'real'], 'OCHI_PHASE');
  for (const [voter, guess] of [[host, 'fiction'], [others[0], 'fiction'], [others[1], 'real']]) await rpc('ochi_cast_vote', fx.roomId, 1, voter, guess);
  await fails('select public.ochi_lock_truth($1,1,$2,$3)', [fx.roomId, speaker, 'real'], 'OCHI_PHASE'); // not allowed once voting closed
  await rpc('ochi_reveal', fx.roomId, 1, speaker, null);
  const t = await turn(fx.roomId, 1);
  assert.equal(t.truth, 'fiction');
  assert.deepEqual(t.score_delta, { [host]: 1, [others[0]]: 1 }, 'a registered answer scores the host like any listener');
});

test('M1(c): an answer typed in by the host earns the host no listener point; others and the teller score normally', async () => {
  const { fx, host, speaker, others } = await proxyFinished(4);
  for (const [voter, guess] of [[host, 'real'], [others[0], 'real'], [others[1], 'fiction']]) await rpc('ochi_cast_vote', fx.roomId, 1, voter, guess);
  await rpc('ochi_reveal', fx.roomId, 1, host, 'real');
  assert.deepEqual((await turn(fx.roomId, 1)).score_delta, { [others[0]]: 1 });
  assert.deepEqual((await game(fx.roomId)).scores[host], { listener: 0, teller: 0 });
  // the teller still scores when most votes missed, host-typed answer or not
  const b = await proxyFinished(4);
  for (const [voter, guess] of [[b.host, 'fiction'], [b.others[0], 'fiction'], [b.others[1], 'real']]) await rpc('ochi_cast_vote', b.fx.roomId, 1, voter, guess);
  await rpc('ochi_reveal', b.fx.roomId, 1, b.host, 'real');
  assert.deepEqual((await turn(b.fx.roomId, 1)).score_delta, { [b.others[1]]: 1, [b.speaker]: 1 });
  // the speaker entering their own answer at reveal is not a host proxy
  const c = await proxyFinished(3);
  await rpc('ochi_cast_vote', c.fx.roomId, 1, c.host, 'real'); await rpc('ochi_cast_vote', c.fx.roomId, 1, c.others[0], 'real');
  await rpc('ochi_reveal', c.fx.roomId, 1, c.speaker, 'real');
  assert.deepEqual((await turn(c.fx.roomId, 1)).score_delta, { [c.host]: 1, [c.others[0]]: 1 });
});

test('scoring: listeners +1 when right; teller +1 only when a strict majority of non-pass votes missed', async () => {
  const cases = [
    { name: 'all missed', truth: 'real', votes: ['fiction', 'fiction', 'fiction'], listeners: [0, 0, 0], teller: 1 },
    { name: 'majority missed (2 of 3)', truth: 'fiction', votes: ['real', 'real', 'fiction'], listeners: [0, 0, 1], teller: 1 },
    { name: 'minority missed (1 of 3)', truth: 'real', votes: ['real', 'real', 'fiction'], listeners: [1, 1, 0], teller: 0 },
    { name: 'tie does not count', truth: 'real', votes: ['real', 'fiction', 'pass'], listeners: [1, 0, 0], teller: 0 },
    { name: 'pass is excluded from the denominator', truth: 'real', votes: ['fiction', 'pass', 'pass'], listeners: [0, 0, 0], teller: 1 },
    { name: 'everyone passed', truth: 'real', votes: ['pass', 'pass', 'pass'], listeners: [0, 0, 0], teller: 0 },
    { name: 'nobody voted', truth: 'fiction', votes: [], listeners: [], teller: 0 }
  ];
  for (const item of cases) {
    const fx = await fixture({ members: 4 });
    await startGame(fx); await confirmAll(fx);
    const [speaker, ...voters] = fx.ids;
    const votes = Object.fromEntries(item.votes.map((guess, i) => [voters[i], guess]));
    const played = await playTurn(fx, item.truth, votes);
    assert.equal(played.speaker, speaker);
    const scores = (await game(fx.roomId)).scores;
    assert.equal(scores[speaker].teller, item.teller, `${item.name}: teller`);
    assert.equal(scores[speaker].listener, 0);
    item.listeners.forEach((points, i) => assert.equal(scores[voters[i]].listener, points, `${item.name}: listener ${i}`));
    assert.ok(fx.ids.every((id) => scores[id].teller === (id === speaker ? item.teller : 0)));
  }
});

test('swap: once per game, by turn/phase/own flag instead of revision, never reusing a dealt card', async () => {
  const fx = await fixture({ members: 3 });
  await startGame(fx);
  const [a, b, c] = fx.ids; const newHand = (idx) => JSON.stringify({ idx, text: pool[idx].text });
  const swap = (id, idx, turnNo = 1) => q('select public.ochi_swap($1,$2,$3,$4::jsonb)', [fx.roomId, turnNo, id, newHand(idx)]);
  await fails('select public.ochi_swap($1,1,$2,$3::jsonb)', [fx.roomId, b, newHand(0)], 'GROUP_STALE'); // card 0 already dealt (to a)
  await fails('select public.ochi_swap($1,1,$2,$3::jsonb)', [fx.roomId, b, JSON.stringify({ idx: 5, text: 'forged' })], 'GROUP_STALE');
  await fails('select public.ochi_swap($1,2,$2,$3::jsonb)', [fx.roomId, b, newHand(5)], 'OCHI_STALE_TURN');
  await rpc('ochi_confirm', fx.roomId, 1, b);
  const before = await revision(fx.roomId);
  await swap(c, 10); // c's swap succeeds although b's confirm moved the revision on
  assert.equal(await revision(fx.roomId), before + 1);
  await fails('select public.ochi_swap($1,1,$2,$3::jsonb)', [fx.roomId, c, newHand(11)], 'OCHI_SWAP_USED');
  await swap(b, 11); // b had already confirmed; swapping clears that confirmation
  let g = await game(fx.roomId);
  assert.equal(g.hands[c].text, pool[10].text); assert.equal(g.hands[c].swapUsed, true);
  assert.equal(g.confirmed[b], undefined);
  assert.ok([0, 1, 2, 10, 11].every((idx) => g.used.includes(idx)));
  await fails('select public.ochi_swap($1,1,$2,$3::jsonb)', [fx.roomId, a, newHand(10)], 'GROUP_STALE'); // returned/used cards are never dealt again
  await confirmAll(fx);
  g = await game(fx.roomId); assert.equal(g.phase, 'ready');
  assert.equal((await turn(fx.roomId, 1)).ochi_text, pool[0].text);
  await fails('select public.ochi_swap($1,1,$2,$3::jsonb)', [fx.roomId, b, newHand(12)], 'OCHI_SWAP_USED');
  await fails('select public.ochi_swap($1,1,$2,$3::jsonb)', [fx.roomId, c, newHand(12)], 'OCHI_SWAP_USED');
  const fresh = await fixture({ members: 3 }); await startGame(fresh); await confirmAll(fresh);
  const [x, y] = fresh.ids;
  await fails('select public.ochi_swap($1,1,$2,$3::jsonb)', [fresh.roomId, y, newHand(12)], 'OCHI_PHASE'); // not the speaker
  await q('select public.ochi_swap($1,1,$2,$3::jsonb)', [fresh.roomId, x, newHand(12)]); // the speaker, while ready
  assert.equal((await turn(fresh.roomId, 1)).ochi_text, pool[12].text);
  assert.equal((await game(fresh.roomId)).phase, 'ready');
  await rpc('ochi_begin_tell', fresh.roomId, 1, x);
  const late = await fixture({ members: 3 }); await startGame(late); await confirmAll(late);
  await rpc('ochi_begin_tell', late.roomId, 1, late.ids[0]);
  await fails('select public.ochi_swap($1,1,$2,$3::jsonb)', [late.roomId, late.ids[0], newHand(12)], 'OCHI_PHASE'); // not allowed while telling
});

test('two laps: a fresh deal between laps keeps swapUsed, same order, final after the last turn', async () => {
  const fx = await fixture({ members: 2, laps: 2 });
  await startGame(fx); await confirmAll(fx);
  const [a, b] = fx.ids;
  assert.equal((await game(fx.roomId)).turn_order.length, 4);
  await q('select public.ochi_swap($1,1,$2,$3::jsonb)', [fx.roomId, a, JSON.stringify({ idx: 20, text: pool[20].text })]);
  await playTurn(fx, 'real', { [b]: 'real' });
  await rpc('ochi_next_turn', fx.roomId, 1, fx.host, null); // turn 2 is still lap 1
  assert.equal((await game(fx.roomId)).phase, 'ready');
  await playTurn(fx, 'fiction', { [a]: 'real' });
  await fails('select public.ochi_next_turn($1,2,$2,null)', [fx.roomId, fx.host], 'OCHI_INVALID'); // lap boundary needs fresh hands
  await fails('select public.ochi_next_turn($1,2,$2,$3::jsonb)', [fx.roomId, fx.host, JSON.stringify(handsFor(fx.ids, 0))], 'OCHI_INVALID'); // dealt cards cannot come back
  await rpc('ochi_next_turn', fx.roomId, 2, fx.host, JSON.stringify(handsFor(fx.ids, 30)));
  let g = await game(fx.roomId);
  assert.equal(g.phase, 'deal'); assert.equal(g.turn_no, 3); assert.deepEqual(g.confirmed, {});
  assert.equal(g.hands[a].swapUsed, true); assert.equal(g.hands[b].swapUsed, false);
  assert.equal(g.hands[a].text, pool[30].text);
  await fails('select public.ochi_swap($1,3,$2,$3::jsonb)', [fx.roomId, a, JSON.stringify({ idx: 35, text: pool[35].text })], 'OCHI_SWAP_USED');
  await rpc('ochi_force_ready', fx.roomId, 3, fx.host);
  assert.equal((await turn(fx.roomId, 3)).speaker_id, a);
  await playTurn(fx, 'real', { [b]: 'pass' });
  await rpc('ochi_next_turn', fx.roomId, 3, fx.host, null);
  await playTurn(fx, 'real', { [a]: 'real' });
  await rpc('ochi_next_turn', fx.roomId, 4, fx.host, null);
  assert.equal(await gameRows(fx.roomId), 0);
  const { scores } = (await kept(fx.roomId)).result;
  assert.equal(scores[a].listener + scores[b].listener + scores[a].teller + scores[b].teller > 0, true);
});

test('titles: the top listener(s) and the top teller(s), nobody for a scoreless game, ties share', async () => {
  const play = async (members, turns) => {
    const fx = await fixture({ members }); await startGame(fx); await confirmAll(fx);
    for (let t = 1; t <= members; t += 1) {
      const speaker = (await turn(fx.roomId, t)).speaker_id;
      const spec = turns[t - 1];
      if (spec === 'skip') await rpc('ochi_skip', fx.roomId, t, speaker);
      else await playTurn(fx, spec.truth, Object.fromEntries(fx.ids.filter((id) => id !== speaker).map((id, i) => [id, spec.votes[i]])));
      await rpc('ochi_next_turn', fx.roomId, t, fx.host, null);
    }
    return fx;
  };
  // nobody scored: no title
  const flat = await play(3, ['skip', 'skip', 'skip']);
  assert.deepEqual((await kept(flat.roomId)).result.detective, []); assert.deepEqual((await kept(flat.roomId)).result.mysterious, []);
  // everybody fooled on every turn: all tellers tie for the mysterious title; nobody guessed right so no detective
  const fooled = await play(3, [{ truth: 'real', votes: ['fiction', 'fiction'] }, { truth: 'real', votes: ['fiction', 'fiction'] }, { truth: 'real', votes: ['fiction', 'fiction'] }]);
  const f = (await kept(fooled.roomId)).result;
  assert.deepEqual(f.detective, []); assert.deepEqual([...f.mysterious].sort(), [...fooled.ids].sort());
});

test('the kept result disappears 5 minutes after the end: served before, deleted by the sweep at the limit, the room stays until its own expiry', async () => {
  const finished = async () => {
    const fx = await fixture({ members: 3 }); await startGame(fx); await confirmAll(fx);
    for (let t = 1; t <= 3; t += 1) {
      const g = await game(fx.roomId); const speaker = (await turn(fx.roomId, g.turn_no)).speaker_id;
      await playTurn(fx, 'real', Object.fromEntries(fx.ids.filter((id) => id !== speaker).map((id) => [id, 'real'])));
      await rpc('ochi_next_turn', fx.roomId, g.turn_no, fx.host, null);
    }
    return fx;
  };
  const a = await finished(); const b = await finished();
  assert.equal(await gameRows(a.roomId) + await gameRows(b.roomId), 0);
  assert.ok(await kept(a.roomId)); assert.ok(await kept(b.roomId));
  // exactly what the group cleanup / the state read sends to PostgREST: delete ... where result_expires_at <= <now>
  const sweep = (at) => q('delete from public.ochi_results where result_expires_at <= $1::timestamptz', [at]);
  const expires = (await kept(a.roomId)).result_expires_at;
  await sweep(new Date(new Date(expires).getTime() - 1000).toISOString());
  assert.ok(await kept(a.roomId), '4:59 after the end: still there');
  await q(`update public.ochi_results set result_expires_at = now() - interval '1 second' where room_id=$1`, [a.roomId]);
  await sweep(new Date().toISOString());
  assert.equal(await kept(a.roomId), undefined, 'past result_expires_at: deleted');
  assert.ok(await kept(b.roomId), 'another room within its 5 minutes is untouched');
  assert.equal((await one('select status from public.group_rooms where id=$1', [a.roomId])).status, 'ended');
  assert.equal((await one('select count(*)::int n from public.ochi_turns where room_id=$1', [a.roomId])).n, 0);
  await q('delete from public.group_rooms where id=$1', [b.roomId]);
  assert.equal(await kept(b.roomId), undefined, 'the room expiry removes it too');
  // a game finished early (finish) keeps nothing at all
  const early = await fixture({ members: 3 }); await startGame(early);
  await rpc('ochi_finish', early.roomId, early.host);
  assert.equal(await kept(early.roomId), undefined); assert.equal(await gameRows(early.roomId), 0);
});

test('expired rooms reject every transition and deleting the room cascades all ochi rows', async () => {
  const fx = await fixture({ members: 3 });
  await startGame(fx); await confirmAll(fx);
  await rpc('ochi_begin_tell', fx.roomId, 1, fx.ids[0]);
  await rpc('ochi_finish_tell', fx.roomId, 1, fx.ids[0], 'real');
  await rpc('ochi_cast_vote', fx.roomId, 1, fx.ids[1], 'real');
  await q(`update public.group_rooms set expires_at=now()-interval '1 second' where id=$1`, [fx.roomId]);
  await fails('select public.ochi_cast_vote($1,1,$2,$3)', [fx.roomId, fx.ids[2], 'real'], 'OCHI_PHASE');
  await fails('select public.ochi_finish($1,$2)', [fx.roomId, fx.host], 'OCHI_PHASE');
  await q('delete from public.group_rooms where id=$1', [fx.roomId]);
  assert.equal((await one('select count(*)::int n from public.ochi_games where room_id=$1', [fx.roomId])).n, 0);
  assert.equal((await one('select count(*)::int n from public.ochi_turns where room_id=$1', [fx.roomId])).n, 0);
  assert.equal((await one('select count(*)::int n from public.ochi_votes where voter_id=any($1::uuid[])', [fx.ids])).n, 0);
});

test.after(async () => { await db.close(); });

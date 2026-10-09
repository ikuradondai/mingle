import test from 'node:test';
import assert from 'node:assert/strict';
import { createGroupRoomService } from '../server-side/group-rooms.mjs';

const roomId = '11111111-1111-4111-8111-111111111111';
const hostId = '22222222-2222-4222-8222-222222222222';
const env = { SUPABASE_URL: 'http://127.0.0.1:54321', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test', SUPABASE_SERVICE_ROLE_KEY: 'service', NODE_ENV: 'test' };
const members = [{ id: hostId, display_name: 'Host', role: 'host', adult_confirmed: true, joined_at: '1' }];
const baseRoom = { id: roomId, host_user_id: hostId, game_type: 'cards', status: 'lobby', revision: 2, expires_at: '2099-01-01T00:00:00.000Z', cards: [], member_count: 1, cursor: 0, revealed: false, answer_index: 0, invite_hash: 'x' };

function harness(room, rpcError) {
  const calls = [];
  const json = (data, status = 200) => new Response(JSON.stringify(data), { status });
  const fetchImpl = async (url) => {
    const u = new URL(url); calls.push(u.pathname);
    if (rpcError && u.pathname.includes('/rpc/')) return json({ message: rpcError.message }, rpcError.status);
    if (u.pathname === '/auth/v1/user') return json({ id: hostId, is_anonymous: false });
    if (u.pathname.includes('/rpc/')) return json([{ room_id: roomId, host_member_id: hostId }]);
    if (u.pathname.includes('/group_rooms')) return json([room]);
    if (u.pathname.includes('/group_members')) return json(members);
    if (u.pathname.includes('/venue_tables')) return json([{ id: 1, venues: { active: true } }]);
    if (u.pathname.includes('minority_games')) return json([{ room_id: roomId, round_no: 1, phase: 'talk', pairs: [], used_pairs: [] }]);
    if (u.pathname.includes('minority_rounds')) return json([{ id: 'r', status: 'talk', assignments: { [hostId]: { word: 'w', role: 'majority' } }, confirmed: {} }]);
    if (u.pathname.includes('question_wolf_games')) return json([{ room_id: roomId, round_no: 1, phase: 'answer', pairs: [], used_pairs: [] }]);
    if (u.pathname.includes('question_wolf_rounds')) return json([{ id: 'r', status: 'answer', assignments: { [hostId]: { question: 'Q', role: 'majority' } }, confirmed: {}, answer_order: [hostId], answer_index: 0 }]);
    return json([]);
  };
  return { service: createGroupRoomService({ env, fetchImpl }), calls };
}
const req = (body) => ({ headers: { authorization: 'Bearer jwt', 'x-group-member-token': 'tok' }, body });

test('state response keeps the per-game key name and top-level shape', async () => {
  const keys = (r) => Object.keys(r).sort().join(',');
  const cards = await harness({ ...baseRoom, status: 'playing' }).service.state(req({}), roomId);
  const minority = await harness({ ...baseRoom, game_type: 'minority_topic', status: 'playing' }).service.state(req({}), roomId);
  const wolf = await harness({ ...baseRoom, game_type: 'question_wolf', status: 'playing' }).service.state(req({}), roomId);
  assert.equal(keys(cards), 'card,host,member,room');
  assert.equal(keys(minority), 'card,host,member,minority,room');
  assert.equal(keys(wolf), 'card,host,member,questionWolf,room');
  assert.equal(minority.room.gameType, 'minority_topic');
  assert.equal(wolf.room.gameType, 'question_wolf');
});

test('create picks the RPC per game type and rejects unknown or non-string game types', async () => {
  for (const [gameType, rpc] of [['minority_topic', 'minority_create_room'], ['question_wolf', 'question_wolf_create_room'], ['ochi_kara', 'ochi_create_room'], ['one_cut', 'one_cut_create_room'], ['mission_mingle', 'mission_create_room']]) {
    const { service, calls } = harness({ ...baseRoom, game_type: gameType });
    await service.create(req({ gameType, hostName: 'H' }));
    assert.equal(calls.some((p) => p.endsWith(`/rpc/${rpc}`)), true, rpc);
  }
  for (const gameType of ['bogus', ['cards'], 'constructor', null, 5]) {
    await assert.rejects(() => harness(baseRoom).service.create(req({ gameType, hostName: 'H' })), (e) => e.status === 400 && e.code === 'INVALID_REQUEST', String(gameType));
  }
});

test('game-specific errors map to 409, others keep their status', async () => {
  const status = (message, httpStatus) => harness(baseRoom, { message, status: httpStatus }).service.create(req({ gameType: 'question_wolf', hostName: 'H' })).then(() => null, (e) => [e.status, e.code]);
  assert.deepEqual(await status('MINORITY_PHASE', 400), [409, 'MINORITY_PHASE']);
  assert.deepEqual(await status('QUESTION_WOLF_STALE_ROUND', 400), [409, 'QUESTION_WOLF_STALE_ROUND']);
  assert.deepEqual(await status('GROUP_STALE', 500), [409, 'GROUP_STALE']);
  assert.deepEqual(await status('GROUP_EXPIRED', 500), [410, 'GROUP_EXPIRED']);
  assert.deepEqual(await status('FORBIDDEN', 500), [403, 'FORBIDDEN']);
  assert.deepEqual(await status('OCHI_PHASE', 500), [409, 'OCHI_PHASE']);
  assert.deepEqual(await status('ONE_CUT_PHASE', 500), [409, 'ONE_CUT_PHASE']);
  assert.deepEqual(await status('MISSION_PHASE', 500), [409, 'MISSION_PHASE']);
  assert.deepEqual(await status('MISSION_NOT_OWNER', 500), [403, 'MISSION_NOT_OWNER']);
  assert.deepEqual(await status('MISSION_MINGLE_PHASE', 500), [502, 'GROUP_UNAVAILABLE']);
});

test('revision is required for cards rooms and exempt for minority/question wolf rooms', async () => {
  const code = (room) => harness(room).service.action(req({ action: 'confirm', roundNo: 1 }), roomId).then(() => null, (e) => e.code);
  assert.equal(await code({ ...baseRoom, status: 'playing' }), 'GROUP_STALE');
  assert.notEqual(await code({ ...baseRoom, game_type: 'minority_topic', status: 'playing' }), 'GROUP_STALE');
  assert.notEqual(await code({ ...baseRoom, game_type: 'question_wolf', status: 'playing' }), 'GROUP_STALE');
  assert.notEqual(await code({ ...baseRoom, game_type: 'mission_mingle', status: 'playing' }), 'GROUP_STALE');
});

test('venue token is verified only for games that opt in', async () => {
  const wolf = harness({ ...baseRoom, game_type: 'question_wolf' });
  await wolf.service.create(req({ gameType: 'question_wolf', hostName: 'H', venueToken: 'a'.repeat(32) }));
  assert.equal(wolf.calls.some((p) => p.includes('/venue_tables')), true);
  await assert.rejects(() => harness(baseRoom).service.create(req({ gameType: 'minority_topic', hostName: 'H', venueToken: 'short' })), (e) => e.status === 400);
});

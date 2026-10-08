import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createGroupRoomService } from '../server-side/group-rooms.mjs';

const roomId = '11111111-1111-4111-8111-111111111111';
const hostId = '22222222-2222-4222-8222-222222222222';
const guestId = '33333333-3333-4333-8333-333333333333';
const thirdId = '55555555-5555-4555-8555-555555555555';
const env = { SUPABASE_URL: 'http://127.0.0.1:54321', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test', SUPABASE_SERVICE_ROLE_KEY: 'service', NODE_ENV: 'test' };
const room = { id: roomId, game_type: 'minority_topic', status: 'playing', revision: 4, expires_at: new Date(Date.now() + 3600000).toISOString(), cards: [], member_count: 3, cursor: 0, revealed: false, answer_index: 0 };
const members = [{ id: hostId, display_name: 'Host', role: 'host', adult_confirmed: true }, { id: guestId, display_name: 'Guest', role: 'guest', adult_confirmed: false }, { id: thirdId, display_name: 'Third', role: 'guest', adult_confirmed: false }];
const game = { room_id: roomId, round_no: 1, phase: 'confirm', pairs: [{ majority: 'A', minority: 'B' }], used_pairs: [] };
const round = { id: '44444444-4444-4444-8444-444444444444', room_id: roomId, round_no: 1, status: 'confirm', assignments: { [hostId]: { word: 'A', role: 'majority' }, [guestId]: { word: 'B', role: 'minority' } }, confirmed: {} };
function fakeFetch(url) {
  const u = new URL(url);
  if (u.pathname.includes('/group_rooms')) return Promise.resolve(new Response(JSON.stringify([room]), { status: 200 }));
  if (u.pathname.includes('/group_members') && u.searchParams.get('secret_hash')) { const hostHash = createHash('sha256').update('host-token').digest('hex'); return Promise.resolve(new Response(JSON.stringify([u.searchParams.get('secret_hash').replace(/^eq\./, '') === hostHash ? members[0] : members[1]]), { status: 200 })); }
  if (u.pathname.includes('/group_members')) return Promise.resolve(new Response(JSON.stringify(members), { status: 200 }));
  if (u.pathname.includes('/minority_games')) return Promise.resolve(new Response(JSON.stringify([game]), { status: 200 }));
  if (u.pathname.includes('/minority_rounds')) return Promise.resolve(new Response(JSON.stringify([round]), { status: 200 }));
  if (u.pathname.includes('/minority_votes')) return Promise.resolve(new Response('[]', { status: 200 }));
  return Promise.resolve(new Response('[]', { status: 200 }));
}

test('minority state hides role and pair assignment before result, and token host is recognized', async () => {
  const service = createGroupRoomService({ env, fetchImpl: fakeFetch });
  const response = await service.state({ headers: { 'x-group-member-token': 'host-token' } }, roomId);
  assert.equal(response.host, true);
  assert.equal(response.minority.myWord, 'A');
  assert.equal(response.minority.myRole, null);
  assert.equal(response.minority.assignments, undefined);
});

test('guest member cannot start or finish the minority room', async () => {
  const service = createGroupRoomService({ env, fetchImpl: fakeFetch });
  await assert.rejects(() => service.action({ headers: { 'x-group-member-token': 'guest-token' }, body: { action: 'start', revision: 4 } }, roomId), (error) => error.code === 'FORBIDDEN');
});

test('authenticated minority create and host token start return a private word', async () => {
  let currentRoom = { ...room, status: 'lobby', revision: 0, member_count: 3 };
  let currentGame = { ...game, round_no: 0, phase: 'lobby' };
  let currentRound = null;
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const u = new URL(url); const path = u.pathname; const method = options.method || 'GET'; const body = options.body ? JSON.parse(options.body) : {};
    calls.push({ path, method, body });
    if (path === '/auth/v1/user') return new Response(JSON.stringify({ id: '66666666-6666-4666-8666-666666666666', is_anonymous: false }), { status: 200 });
    if (path.endsWith('/rpc/minority_create_room')) return new Response(JSON.stringify([{ room_id: roomId, host_member_id: hostId }]), { status: 200 });
    if (path.endsWith('/rpc/minority_start_round')) { currentRoom = { ...currentRoom, status: 'playing', revision: 1 }; currentGame = { ...currentGame, round_no: 1, phase: 'confirm' }; currentRound = { ...round, status: 'confirm' }; return new Response(JSON.stringify([currentRound]), { status: 200 }); }
    if (path.includes('/group_rooms')) return new Response(JSON.stringify([currentRoom]), { status: 200 });
    if (path.includes('/group_members') && u.searchParams.get('secret_hash')) return new Response(JSON.stringify([members[0]]), { status: 200 });
    if (path.includes('/group_members')) return new Response(JSON.stringify(members), { status: 200 });
    if (path.includes('/minority_games')) return new Response(JSON.stringify([currentGame]), { status: 200 });
    if (path.includes('/minority_rounds')) return new Response(JSON.stringify(currentRound ? [currentRound] : []), { status: 200 });
    if (path.includes('/minority_votes')) return new Response('[]', { status: 200 });
    return new Response('[]', { status: 200 });
  };
  const service = createGroupRoomService({ env, fetchImpl });
  const created = await service.create({ headers: { authorization: 'Bearer jwt' }, body: { gameType: 'minority_topic', hostName: 'Host' } });
  assert.equal(created.host, true);
  assert.equal(calls.find((call) => call.path.endsWith('/rpc/minority_create_room')).body.p_pairs.length > 5, true);
  const started = await service.action({ headers: { 'x-group-member-token': 'host-token' }, body: { action: 'start', revision: 0 } }, roomId);
  assert.equal(started.host, true);
  assert.equal(started.minority.myWord, 'A');
  assert.equal(started.minority.myRole, null);
  const startRpc = calls.find((call) => call.path.endsWith('/rpc/minority_start_round'));
  assert.equal(Boolean(startRpc), true);
  assert.equal(startRpc.body.p_expected_revision, 0);
  await assert.rejects(() => service.create({ headers: { authorization: 'Bearer jwt' }, body: { gameType: 'minority_topic', pairs: [{ majority: 'x', minority: 'y' }] } }), (error) => error.code === 'INVALID_REQUEST');
  await assert.rejects(() => service.create({ headers: { authorization: 'Bearer jwt' }, body: { gameType: 'minority_topic', deckId: 'date' } }), (error) => error.code === 'INVALID_REQUEST');
});

test('minority lifecycle accepts stale participant revision and sends round-aware RPC arguments', async () => {
  let currentRoom = { ...room, status: 'playing', revision: 1, member_count: 3 };
  let currentGame = { ...game, round_no: 1, phase: 'confirm' };
  let currentRound = { ...round, status: 'confirm', confirmed: {} };
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const u = new URL(url); const path = u.pathname; const method = options.method || 'GET'; const body = options.body ? JSON.parse(options.body) : {}; calls.push({ path, method, body });
    if (path.includes('/group_rooms')) return new Response(JSON.stringify([currentRoom]), { status: 200 });
    if (path.includes('/group_members') && u.searchParams.get('secret_hash')) { const hostHash = createHash('sha256').update('host-token').digest('hex'); return new Response(JSON.stringify([u.searchParams.get('secret_hash').replace(/^eq\./, '') === hostHash ? members[0] : members[1]]), { status: 200 }); }
    if (path.includes('/group_members')) return new Response(JSON.stringify(members), { status: 200 });
    if (path.endsWith('/rpc/minority_confirm')) { currentRound = { ...currentRound, status: 'talk', confirmed: { [hostId]: true, [guestId]: true, [thirdId]: true } }; currentGame = { ...currentGame, phase: 'talk' }; return new Response('{}', { status: 200 }); }
    if (path.endsWith('/rpc/minority_set_phase')) { currentRound = { ...currentRound, status: body.p_phase }; currentGame = { ...currentGame, phase: body.p_phase }; return new Response('{}', { status: 200 }); }
    if (path.endsWith('/rpc/minority_cast_vote')) { currentRound = { ...currentRound, status: 'result' }; currentGame = { ...currentGame, phase: 'result' }; return new Response('{}', { status: 200 }); }
    if (path.endsWith('/rpc/minority_start_round')) { currentRoom = { ...currentRoom, revision: 2 }; currentGame = { ...currentGame, round_no: 2, phase: 'confirm' }; currentRound = { ...currentRound, round_no: 2, status: 'confirm', confirmed: {} }; return new Response('{}', { status: 200 }); }
    if (path.endsWith('/rpc/minority_finish')) { currentRoom = { ...currentRoom, status: 'ended', revision: 3 }; currentGame = null; return new Response('{}', { status: 200 }); }
    if (path.includes('/minority_games')) return new Response(JSON.stringify(currentGame ? [currentGame] : []), { status: 200 });
    if (path.includes('/minority_rounds')) return new Response(JSON.stringify(currentRound ? [currentRound] : []), { status: 200 });
    if (path.includes('/minority_votes')) return new Response('[]', { status: 200 });
    return new Response('[]', { status: 200 });
  };
  const service = createGroupRoomService({ env, fetchImpl });
  const confirmed = await service.action({ headers: { 'x-group-member-token': 'guest-token' }, body: { action: 'confirm', revision: 0, roundNo: 1 } }, roomId);
  assert.equal(confirmed.minority.phase, 'talk');
  const opened = await service.action({ headers: { 'x-group-member-token': 'host-token' }, body: { action: 'vote_open', revision: 1, roundNo: 1 } }, roomId);
  assert.equal(opened.minority.phase, 'vote');
  const voted = await service.action({ headers: { 'x-group-member-token': 'guest-token' }, body: { action: 'vote', revision: 0, roundNo: 1, targetId: hostId } }, roomId);
  assert.equal(voted.minority.phase, 'result');
  const next = await service.action({ headers: { 'x-group-member-token': 'host-token' }, body: { action: 'next_round', revision: 1, roundNo: 1 } }, roomId);
  assert.equal(next.minority.round, 2);
  const finished = await service.action({ headers: { 'x-group-member-token': 'host-token' }, body: { action: 'finish', revision: 2, roundNo: 2 } }, roomId);
  assert.equal(finished.minority.phase, 'ended');
  const confirmRpc = calls.find((call) => call.path.endsWith('/rpc/minority_confirm')); assert.equal(confirmRpc.body.p_round_no, 1); assert.equal(confirmRpc.body.p_member_id, guestId);
  const voteRpc = calls.find((call) => call.path.endsWith('/rpc/minority_cast_vote')); assert.equal(voteRpc.body.p_round_no, 1); assert.equal(voteRpc.body.p_voter_id, guestId); assert.equal(voteRpc.body.p_target_id, hostId);
  const finishRpc = calls.find((call) => call.path.endsWith('/rpc/minority_finish')); assert.equal(finishRpc.body.p_round_no, 2); assert.equal(finishRpc.body.p_expected_revision, 2);
  await assert.rejects(() => service.action({ headers: { 'x-group-member-token': 'guest-token' }, body: { action: 'vote', revision: 0, roundNo: 1, targetId: hostId } }, roomId), (error) => error.code === 'GROUP_ENDED');
});

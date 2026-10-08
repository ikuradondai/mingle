import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createGroupRoomService } from '../server-side/group-rooms.mjs';

const roomId = '11111111-1111-4111-8111-111111111111';
const hostId = '22222222-2222-4222-8222-222222222222';
const guestId = '33333333-3333-4333-8333-333333333333';
const env = { SUPABASE_URL: 'http://127.0.0.1:54321', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test', SUPABASE_SERVICE_ROLE_KEY: 'service', NODE_ENV: 'test' };
const members = [{ id: hostId, display_name: 'Host', role: 'host', adult_confirmed: true }, { id: guestId, display_name: 'Guest', role: 'guest', adult_confirmed: false }, { id: '55555555-5555-4555-8555-555555555555', display_name: 'Third', role: 'guest', adult_confirmed: false }];
const room = { id: roomId, game_type: 'question_wolf', status: 'playing', revision: 2, expires_at: new Date(Date.now() + 3600000).toISOString(), cards: [], member_count: 3, cursor: 0, revealed: false, answer_index: 0 };
const game = { room_id: roomId, round_no: 1, phase: 'answer', pairs: [], used_pairs: [0] };
const round = { id: '44444444-4444-4444-8444-444444444444', room_id: roomId, round_no: 1, status: 'answer', assignments: { [hostId]: { question: 'A', role: 'majority' }, [guestId]: { question: 'B', role: 'minority' } }, confirmed: { [hostId]: true, [guestId]: true }, answer_order: [hostId, guestId], answer_index: 0 };

function fakeFetch(url) {
  const u = new URL(url);
  if (u.pathname.includes('/group_rooms')) return Promise.resolve(new Response(JSON.stringify([room]), { status: 200 }));
  if (u.pathname.includes('/group_members') && u.searchParams.get('secret_hash')) {
    const hostHash = createHash('sha256').update('host-token').digest('hex');
    return Promise.resolve(new Response(JSON.stringify([u.searchParams.get('secret_hash').replace(/^eq\./, '') === hostHash ? members[0] : members[1]]), { status: 200 }));
  }
  if (u.pathname.includes('/group_members')) return Promise.resolve(new Response(JSON.stringify(members), { status: 200 }));
  if (u.pathname.includes('/question_wolf_games')) return Promise.resolve(new Response(JSON.stringify([game]), { status: 200 }));
  if (u.pathname.includes('/question_wolf_rounds')) return Promise.resolve(new Response(JSON.stringify([round]), { status: 200 }));
  if (u.pathname.includes('/question_wolf_votes')) return Promise.resolve(new Response('[]', { status: 200 }));
  return Promise.resolve(new Response('[]', { status: 200 }));
}

test('question wolf state exposes only the member question before result', async () => {
  const service = createGroupRoomService({ env, fetchImpl: fakeFetch });
  const response = await service.state({ headers: { 'x-group-member-token': 'host-token' } }, roomId);
  assert.equal(response.questionWolf.myQuestion, 'A');
  assert.equal(response.questionWolf.phase, 'answer');
  assert.equal(response.questionWolf.majorityQuestion, undefined);
  assert.equal(response.questionWolf.minorityQuestion, undefined);
  assert.equal(response.questionWolf.assignments, undefined);
  assert.equal(response.questionWolf.serverNow !== undefined, true);
});

test('question wolf create sends the content deck to its dedicated RPC', async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    const u = new URL(url); const body = options.body ? JSON.parse(options.body) : {}; calls.push({ path: u.pathname, body });
    if (u.pathname === '/auth/v1/user') return new Response(JSON.stringify({ id: '66666666-6666-4666-8666-666666666666', is_anonymous: false }), { status: 200 });
    if (u.pathname.endsWith('/rpc/question_wolf_create_room')) return new Response(JSON.stringify([{ room_id: roomId, host_member_id: hostId }]), { status: 200 });
    if (u.pathname.includes('/group_rooms')) return new Response(JSON.stringify([{ ...room, status: 'lobby', game_type: 'question_wolf', revision: 0 }]), { status: 200 });
    if (u.pathname.includes('/group_members')) return new Response(JSON.stringify([members[0]]), { status: 200 });
    if (u.pathname.includes('/question_wolf_games')) return new Response(JSON.stringify([{ ...game, round_no: 0, phase: 'lobby' }]), { status: 200 });
    return new Response('[]', { status: 200 });
  };
  const service = createGroupRoomService({ env, fetchImpl });
  await service.create({ headers: { authorization: 'Bearer jwt' }, body: { gameType: 'question_wolf', hostName: 'Host' } });
  const call = calls.find((item) => item.path.endsWith('/rpc/question_wolf_create_room'));
  assert.equal(Boolean(call), true);
  assert.equal(call.body.p_pairs.length >= 6, true);
  assert.equal(calls.some((item) => item.path.endsWith('/rpc/minority_create_room')), false);
});

test('question wolf lets the current guest advance and rejects a non-current guest', async () => {
  const calls = [];
  let currentId = guestId;
  let hostAnswered = false;
  let mockRevision = 2;
  const fetchImpl = async (url, options = {}) => {
    const u = new URL(url); const path = u.pathname; const body = options.body ? JSON.parse(options.body) : {}; calls.push({ path, body });
    if (path.includes('/group_rooms')) return new Response(JSON.stringify([{ ...room, revision: mockRevision }]), { status: 200 });
    if (path.includes('/group_members') && u.searchParams.get('secret_hash')) {
      const hostHash = createHash('sha256').update('host-token').digest('hex');
      return new Response(JSON.stringify([u.searchParams.get('secret_hash').replace(/^eq\./, '') === hostHash ? members[0] : members[1]]), { status: 200 });
    }
    if (path.includes('/group_members')) return new Response(JSON.stringify(members), { status: 200 });
    if (path.includes('/question_wolf_games')) return new Response(JSON.stringify([game]), { status: 200 });
    if (path.includes('/question_wolf_rounds')) return new Response(JSON.stringify([round]), { status: 200 });
    if (path.endsWith('/rpc/question_wolf_answer')) {
      if (body.p_member_id !== currentId || (body.p_member_id === hostId && hostAnswered)) return new Response(JSON.stringify({ message: 'QUESTION_WOLF_TURN' }), { status: 409 });
      if (body.p_member_id === hostId) hostAnswered = true;
      currentId = hostId;
      mockRevision += 1;
      return new Response('{}', { status: 200 });
    }
    return new Response('[]', { status: 200 });
  };
  const service = createGroupRoomService({ env, fetchImpl });
  const advanced = await service.action({ headers: { 'x-group-member-token': 'guest-token' }, body: { action: 'answer', revision: 2, roundNo: 1 } }, roomId);
  assert.equal(advanced.host, false);
  await assert.rejects(() => service.action({ headers: { 'x-group-member-token': 'guest-token' }, body: { action: 'answer', revision: 3, roundNo: 1 } }, roomId), (error) => error.code === 'QUESTION_WOLF_TURN');
  await service.action({ headers: { 'x-group-member-token': 'host-token' }, body: { action: 'answer', revision: 3, roundNo: 1 } }, roomId);
  const answerCalls = calls.filter((call) => call.path.endsWith('/rpc/question_wolf_answer')).length;
  await assert.rejects(() => service.action({ headers: { 'x-group-member-token': 'host-token' }, body: { action: 'answer', revision: 3, roundNo: 1 } }, roomId), (error) => error.code === 'GROUP_STALE');
  assert.equal(calls.filter((call) => call.path.endsWith('/rpc/question_wolf_answer')).length, answerCalls);
  assert.equal(calls.some((call) => call.path.endsWith('/rpc/question_wolf_answer')), true);
});

test('question wolf result DTO follows the current round result snapshot', async () => {
  const resultGame = { ...game, phase: 'answer' };
  const resultRound = { ...round, status: 'result', majority_question: 'A', minority_question: 'B' };
  const fetchImpl = async (url) => {
    const u = new URL(url);
    if (u.pathname.includes('/group_rooms')) return new Response(JSON.stringify([{ ...room, revision: 8 }]), { status: 200 });
    if (u.pathname.includes('/group_members') && u.searchParams.get('secret_hash')) return new Response(JSON.stringify([members[0]]), { status: 200 });
    if (u.pathname.includes('/group_members')) return new Response(JSON.stringify(members), { status: 200 });
    if (u.pathname.includes('/question_wolf_games')) return new Response(JSON.stringify([resultGame]), { status: 200 });
    if (u.pathname.includes('/question_wolf_rounds')) return new Response(JSON.stringify([resultRound]), { status: 200 });
    if (u.pathname.includes('/question_wolf_votes')) return new Response(JSON.stringify([{ voter_id: hostId, target_id: guestId }]), { status: 200 });
    return new Response('[]', { status: 200 });
  };
  const service = createGroupRoomService({ env, fetchImpl });
  const response = await service.state({ headers: { 'x-group-member-token': 'host-token' } }, roomId);
  assert.equal(response.questionWolf.phase, 'result');
  assert.equal(response.questionWolf.majorityQuestion, 'A');
  assert.equal(response.questionWolf.minorityQuestion, 'B');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createGroupRoomService } from '../server-side/group-rooms.mjs';
import { ochiCards } from '../dist/data/ochi-cards.js';

const roomId = '11111111-1111-4111-8111-111111111111';
const [hostId, aId, bId] = ['22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333', '55555555-5555-4555-8555-555555555555'];
const turnId = '44444444-4444-4444-8444-444444444444';
const env = { SUPABASE_URL: 'http://127.0.0.1:54321', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test', SUPABASE_SERVICE_ROLE_KEY: 'service', NODE_ENV: 'test' };
const sha = (value) => createHash('sha256').update(value).digest('hex');
const members = [
  { id: hostId, display_name: 'Host', role: 'host', adult_confirmed: true, joined_at: '1' },
  { id: aId, display_name: 'A', role: 'guest', adult_confirmed: false, joined_at: '2' },
  { id: bId, display_name: 'B', role: 'guest', adult_confirmed: false, joined_at: '3' }
];
const tokens = { 'host-token': members[0], 'a-token': members[1], 'b-token': members[2] };
const pool = ochiCards.map(({ id, text, category }) => ({ id, text, category }));
const SECRET_TEXT = { [hostId]: 'HOSTのオチ', [aId]: 'AのオチXX', [bId]: 'BのオチYY' };
const baseRoom = { id: roomId, host_user_id: hostId, game_type: 'ochi_kara', status: 'playing', revision: 7, expires_at: '2099-01-01T00:00:00.000Z', cards: [], member_count: 3, cursor: 0, revealed: false, answer_index: 0, invite_hash: 'x' };
const baseGame = () => ({ room_id: roomId, pool, used: [0, 1, 2], laps: 1, turn_order: [aId, bId, hostId], turn_no: 1, phase: 'ready', hands: Object.fromEntries(members.map((m, i) => [m.id, { idx: i, text: SECRET_TEXT[m.id], swapUsed: false }])), confirmed: { [hostId]: true, [aId]: true, [bId]: true }, scores: Object.fromEntries(members.map((m) => [m.id, { listener: 0, teller: 0 }])) });
const baseTurn = (extra = {}) => ({ id: turnId, room_id: roomId, turn_no: 1, speaker_id: aId, ochi_text: SECRET_TEXT[aId], status: 'ready', tell_started_at: null, tell_deadline: null, truth: 'fiction', truth_locked: true, score_delta: {}, ...extra });

// A minimal in-memory PostgREST: serves whatever rows the scenario sets, and records every call.
function harness({ room = {}, game = {}, noGame = false, turn = null, votes = [], rpcError = null, kept = null, at = '2026-10-09T00:00:30.000Z' } = {}) {
  const calls = [];
  const state = { room: { ...baseRoom, ...room }, game: { ...baseGame(), ...game }, turn, votes, kept };
  const json = (data, status = 200) => new Response(JSON.stringify(data), { status });
  const fetchImpl = async (url, options = {}) => {
    const u = new URL(url); const path = u.pathname; const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ path, search: u.search, body, method: options.method || 'GET' });
    if (path === '/auth/v1/user') return json({ id: hostId, is_anonymous: false });
    if (path.includes('/rpc/')) return rpcError && path.endsWith(rpcError.rpc) ? json({ message: rpcError.message }, 400) : json(path.endsWith('_create_room') ? [{ room_id: roomId, host_member_id: hostId }] : null);
    if (path.includes('/group_rooms')) return json([state.room]);
    if (path.includes('/group_members') && u.searchParams.get('secret_hash')) {
      const found = Object.entries(tokens).find(([token]) => `eq.${sha(token)}` === u.searchParams.get('secret_hash'));
      return json(found ? [found[1]] : []);
    }
    if (path.includes('/group_members')) return json(members);
    if (path.includes('/venue_tables')) return json([{ id: 1, venues: { active: true } }]);
    if (path.includes('/ochi_results')) return options.method === 'DELETE' ? json([]) : json(state.kept ? [state.kept] : []);
    if (path.includes('/ochi_games')) return json(noGame ? [] : [state.game]);
    if (path.includes('/ochi_turns')) return json(state.turn ? [state.turn] : []);
    if (path.includes('/ochi_votes')) return json(state.votes);
    return json([]);
  };
  const service = createGroupRoomService({ env, fetchImpl, now: () => Date.parse(at) });
  const rpcCalls = () => calls.filter((call) => call.path.includes('/rpc/')).map((call) => ({ name: call.path.split('/rpc/')[1], body: call.body }));
  return { service, state, calls, rpcCalls };
}
const asMember = (token, body) => ({ headers: { 'x-group-member-token': token }, body });
const stateOf = async (h, token) => (await h.service.state({ headers: { 'x-group-member-token': token } }, roomId)).ochi;
const secretTexts = [SECRET_TEXT[hostId], SECRET_TEXT[aId], SECRET_TEXT[bId]];

test('state returns only your own hand, and only while it is live', async () => {
  for (const phase of ['deal', 'ready', 'telling']) {
    const h = harness({ game: { phase }, turn: phase === 'deal' ? null : baseTurn({ status: phase }) });
    const mine = await stateOf(h, 'b-token');
    assert.equal(mine.myOchi, SECRET_TEXT[bId], phase);
    const raw = JSON.stringify(await h.service.state({ headers: { 'x-group-member-token': 'b-token' } }, roomId));
    assert.equal(raw.includes(SECRET_TEXT[hostId]), false, `${phase}: host hand leaked`);
    assert.equal(raw.includes(SECRET_TEXT[aId]), false, `${phase}: speaker hand leaked`);
    // the host (representative) sees only their own hand as well
    const rawHost = JSON.stringify(await h.service.state({ headers: { 'x-group-member-token': 'host-token' } }, roomId));
    assert.equal(rawHost.includes(SECRET_TEXT[aId]) || rawHost.includes(SECRET_TEXT[bId]), false, `${phase}: host sees others' hands`);
  }
  // later in the lap a member's own upcoming hand is still theirs; once spent it is never returned
  const spent = await stateOf(harness({ game: { phase: 'ready', turn_no: 2 }, turn: baseTurn({ turn_no: 2, speaker_id: bId }) }), 'a-token');
  assert.equal(spent.myOchi, null);
  const upcoming = await stateOf(harness({ game: { phase: 'ready', turn_no: 1 }, turn: baseTurn() }), 'host-token');
  assert.equal(upcoming.myOchi, SECRET_TEXT[hostId]);
  for (const phase of ['vote', 'reveal', 'result', 'skipped', 'final']) {
    const mine = await stateOf(harness({ game: { phase, turn_no: phase === 'final' ? 3 : 1 }, turn: phase === 'final' ? null : baseTurn({ status: phase === 'skipped' ? 'skipped' : phase }) }), 'a-token');
    assert.equal(mine.myOchi, null, phase);
    assert.equal(mine.mySwapAvailable, false, phase);
  }
});

test('the answer and per-voter guesses never appear before result, for anyone including the host and the speaker', async () => {
  for (const phase of ['telling', 'vote', 'reveal']) {
    const votes = [{ voter_id: bId, guess: 'fiction' }, { voter_id: hostId, guess: 'real' }];
    const h = harness({ game: { phase }, turn: baseTurn({ status: phase, tell_started_at: '2026-10-09T00:00:00.000Z', tell_deadline: '2026-10-09T00:01:00.000Z' }), votes: phase === 'telling' ? [] : votes });
    for (const token of ['host-token', 'a-token', 'b-token']) {
      const response = await h.service.state({ headers: { 'x-group-member-token': token } }, roomId);
      const raw = JSON.stringify(response);
      assert.equal(response.ochi.result, null, `${phase}/${token}`);
      assert.equal(response.ochi.scores, null);
      assert.equal(/"truth"|"fiction"|"guess"|"guesses"|"tally"/.test(raw), false, `${phase}/${token}: ${raw.slice(0, 200)}`);
      assert.equal(typeof (response.ochi.myTruthLocked === null ? false : response.ochi.myTruthLocked), 'boolean');
    }
    const speaker = await stateOf(h, 'a-token'); const other = await stateOf(h, 'b-token');
    assert.equal(speaker.myTruthLocked, true, 'the speaker is told whether an answer is registered');
    assert.equal(other.myTruthLocked, null);
    assert.equal((await stateOf(h, 'host-token')).myTruthLocked, true, 'the host may need to reveal for the speaker, so it learns only whether an answer exists');
    // the server never even asks the database for the answer or the guesses before the result
    const asked = h.calls.filter((call) => /ochi_(turns|votes)/.test(call.path)).map((call) => decodeURIComponent(call.search));
    assert.ok(asked.length > 0);
    assert.ok(asked.every((search) => !/select=[^&]*\b(truth|guess)\b(?!_)/.test(search)), `${phase}: ${asked.join(' | ')}`);
    assert.equal(other.memberHasVoted, phase !== 'telling');
  }
  // the speaker's spoken ending is shown from the vote on (spec Q16), never during ready/telling
  assert.equal((await stateOf(harness({ game: { phase: 'telling' }, turn: baseTurn({ status: 'telling' }) }), 'b-token')).turnOchi, null);
  assert.equal((await stateOf(harness({ game: { phase: 'vote' }, turn: baseTurn({ status: 'vote' }) }), 'b-token')).turnOchi, SECRET_TEXT[aId]);
  assert.equal((await stateOf(harness({ game: { phase: 'ready' }, turn: baseTurn() }), 'b-token')).turnOchi, null);
});

test('vote progress is counted without exposing who voted what', async () => {
  const h = harness({ game: { phase: 'vote' }, turn: baseTurn({ status: 'vote' }), votes: [{ voter_id: bId }] });
  const mine = await stateOf(h, 'b-token'); const other = await stateOf(h, 'host-token');
  assert.equal(mine.votedCount, 1); assert.equal(mine.voterCount, 2); assert.equal(mine.memberHasVoted, true); assert.equal(other.memberHasVoted, false);
});

test('result reveals the answer, tally and guesses, and only the viewer\u2019s own gain -- nobody else\u2019s points', async () => {
  const votes = [{ voter_id: bId, guess: 'fiction' }, { voter_id: hostId, guess: 'real' }];
  const scores = { [hostId]: { listener: 0, teller: 0 }, [aId]: { listener: 0, teller: 4 }, [bId]: { listener: 1, teller: 0 } };
  const h = harness({ game: { phase: 'result', scores }, turn: baseTurn({ status: 'result', score_delta: { [bId]: 1, [aId]: 1 } }), votes });
  const host = (await stateOf(h, 'host-token')).result;
  assert.equal(host.truth, 'fiction');
  assert.deepEqual(host.tally, { real: 1, fiction: 1, pass: 0 });
  assert.equal(host.guesses[bId], 'fiction');
  assert.equal(host.myDelta, 0);
  assert.equal((await stateOf(h, 'b-token')).result.myDelta, 1);
  assert.equal((await stateOf(h, 'a-token')).result.myDelta, 1, 'the speaker sees their own gain');
  for (const token of ['host-token', 'a-token', 'b-token']) {
    const response = await h.service.state({ headers: { 'x-group-member-token': token } }, roomId);
    const raw = JSON.stringify(response);
    assert.equal(response.ochi.scores, null, `${token}: no score table`);
    assert.equal(response.ochi.result.scoreDelta, undefined, `${token}: no per-member delta table`);
    assert.deepEqual(Object.keys(response.ochi.result).sort(), ['guesses', 'myDelta', 'tally', 'truth'], token);
    assert.equal(/"scores"\s*:\s*\{|"scoreDelta"|"listener"|"teller"/.test(raw), false, `${token}: ${raw.slice(0, 160)}`);
  }
  // the server does not even ask the database for the score table while the game runs
  assert.ok(h.calls.filter((call) => call.path.includes('/ochi_games')).every((call) => !/select=[^&]*scores/.test(decodeURIComponent(call.search))));
});

const KEPT_AT = '2026-10-09T00:00:00.000Z';
const keptResult = (extra = {}) => ({ result: { laps: 1, totalTurns: 3, detective: [hostId, aId], mysterious: [bId], scores: { [hostId]: { listener: 2, teller: 0 }, [aId]: { listener: 2, teller: 1 }, [bId]: { listener: 1, teller: 3 } } }, result_expires_at: '2026-10-09T00:05:00.000Z', ...extra });

test('final announces the title winners to everyone and gives each member only their OWN tally', async () => {
  const gone = { room: { status: 'ended' }, noGame: true, kept: keptResult(), at: '2026-10-09T00:02:00.000Z' };
  for (const [token, id] of [['host-token', hostId], ['a-token', aId], ['b-token', bId]]) {
    const h = harness(gone);
    const response = await h.service.state({ headers: { 'x-group-member-token': token } }, roomId);
    const final = response.ochi;
    assert.equal(final.phase, 'final');
    assert.deepEqual([...final.titles.detective].sort(), [aId, hostId].sort());
    assert.deepEqual(final.titles.mysterious, [bId]);
    assert.deepEqual(final.myScore, keptResult().result.scores[id], `${token}: own tally`);
    assert.equal(final.scores, null, 'no score table');
    assert.equal(final.myOchi, null); assert.equal(final.mySwapAvailable, false);
    const raw = JSON.stringify(response);
    assert.equal(/"scores"\s*:\s*\{/.test(raw), false, token);
    // nobody else's tally appears: the only {listener, teller} object in the whole response is the viewer's own
    assert.equal((raw.match(/"listener"/g) || []).length, 1, `${token}: ${raw.slice(0, 200)}`);
    assert.equal((raw.match(/"teller"/g) || []).length, 1, token);
    assert.equal(final.resultExpiresAt, '2026-10-09T00:05:00.000Z');
    assert.equal(h.calls.some((call) => call.method === 'DELETE' && call.path.includes('ochi_results') && call.search.includes('room_id')), false, 'a result within its 5 minutes is not deleted');
  }
  const flat = await stateOf(harness({ ...gone, kept: keptResult({ result: { laps: 1, totalTurns: 3, detective: [], mysterious: [], scores: { [bId]: { listener: 0, teller: 0 } } } }) }), 'b-token');
  assert.deepEqual(flat.titles, { detective: [], mysterious: [] });
  assert.deepEqual(flat.myScore, { listener: 0, teller: 0 });
});

test('after result_expires_at the kept result is deleted and the state is the minimal ended response', async () => {
  const h = harness({ room: { status: 'ended' }, noGame: true, kept: keptResult(), at: '2026-10-09T00:05:00.001Z' });
  const ended = (await h.service.state({ headers: { 'x-group-member-token': 'a-token' } }, roomId)).ochi;
  assert.equal(ended.phase, 'ended'); assert.equal(ended.titles, undefined); assert.equal(ended.myScore, undefined); assert.equal(ended.scores, null);
  assert.ok(h.calls.some((call) => call.method === 'DELETE' && call.path.endsWith('/ochi_results') && call.search.includes('room_id=eq.') && call.search.includes('result_expires_at=lte.2026-10-09T00%3A05%3A00.001Z')), 'the lapsed row is deleted on the read');
  const exact = await stateOf(harness({ room: { status: 'ended' }, noGame: true, kept: keptResult(), at: '2026-10-09T00:04:59.999Z' }), 'a-token');
  assert.equal(exact.phase, 'final', 'one millisecond before the limit it is still served');
});

test('the periodic cleanup also sweeps lapsed results of all three games', async () => {
  const h = harness({ room: { status: 'ended' }, noGame: true, at: '2026-10-09T01:00:00.000Z' });
  await h.service.state({ headers: { 'x-group-member-token': 'a-token' } }, roomId);
  const sweeps = h.calls.filter((call) => call.method === 'DELETE' && !call.search.includes('room_id')).map((call) => call.path.split('/').pop());
  assert.deepEqual(sweeps.sort(), ['group_rooms', 'mission_results', 'ochi_results', 'one_cut_results']);
  assert.ok(h.calls.filter((call) => call.method === 'DELETE' && call.path.endsWith('_results')).every((call) => call.search === '?result_expires_at=lte.2026-10-09T01%3A00%3A00.000Z'));
});

test('ended rooms and rooms before the game exists return minimal state', async () => {
  const ended = await stateOf(harness({ room: { status: 'ended' }, noGame: true }), 'a-token');
  assert.equal(ended.phase, 'ended'); assert.equal(ended.myOchi, null);
  const lobby = await stateOf(harness({ room: { status: 'lobby', member_count: 2 }, noGame: true }), 'a-token');
  assert.equal(lobby.phase, 'lobby'); assert.equal(lobby.memberCount, 2);
});

test('timer fields: serverNow is returned next to the deadline so clients never trust their own clock', async () => {
  const h = harness({ game: { phase: 'telling' }, turn: baseTurn({ status: 'telling', tell_started_at: '2026-10-09T00:00:00.000Z', tell_deadline: '2026-10-09T00:01:00.000Z' }) });
  const mine = await stateOf(h, 'b-token');
  assert.equal(mine.serverNow, '2026-10-09T00:00:30.000Z'); assert.equal(mine.tellDeadline, '2026-10-09T00:01:00.000Z');
});

test('only start needs the room revision; every other action is exempt and keyed by turnNo + phase', async () => {
  const code = (h, token, body) => h.service.action(asMember(token, body), roomId).then(() => null, (error) => error.code);
  const deal = () => harness({ game: { phase: 'deal', confirmed: {} } });
  assert.equal(await code(deal(), 'a-token', { action: 'confirm', turnNo: 1 }), null);
  assert.equal(await code(deal(), 'a-token', { action: 'swap', turnNo: 1 }), null);
  const vote = () => harness({ game: { phase: 'vote' }, turn: baseTurn({ status: 'vote' }) });
  assert.equal(await code(vote(), 'b-token', { action: 'vote', turnNo: 1, guess: 'real' }), null);
  assert.equal(await code(harness({ game: { phase: 'ready' }, turn: baseTurn() }), 'a-token', { action: 'begin_tell', turnNo: 1 }), null);
  assert.equal(await code(harness({ game: { phase: 'ready' }, turn: baseTurn() }), 'a-token', { action: 'begin_tell', turnNo: 1, revision: 6 }), null, 'a stale revision does not matter');
  assert.equal(await code(harness({ game: { phase: 'ready' }, turn: baseTurn() }), 'a-token', { action: 'begin_tell', turnNo: 1, revision: 7 }), null);
  assert.equal(await code(harness({ game: { phase: 'deal' } }), 'host-token', { action: 'force_ready', turnNo: 1 }), null);
  assert.equal(await code(harness({ game: { phase: 'lobby', turn_no: 0 }, room: { status: 'lobby' } }), 'host-token', { action: 'start' }), 'GROUP_STALE');
  assert.equal(await code(harness({ game: { phase: 'vote' }, turn: baseTurn({ status: 'vote' }), room: { revision: 50 } }), 'host-token', { action: 'close_vote', turnNo: 1, revision: 7 }), null, 'close_vote right after votes moved the revision');
  assert.equal(await code(harness({ game: { phase: 'result' }, turn: baseTurn({ status: 'result' }), room: { revision: 50 } }), 'host-token', { action: 'next_turn', turnNo: 1, revision: 7 }), null);
  assert.equal(await code(harness({ game: { phase: 'vote' }, room: { revision: 50 } }), 'host-token', { action: 'finish', revision: 7 }), null);
  // someone else's action moved the room revision on; confirm / vote / swap with a stale client view still go through
  const h = harness({ room: { revision: 99 }, game: { phase: 'deal', confirmed: {} } });
  assert.equal(await code(h, 'b-token', { action: 'confirm', turnNo: 1, revision: 1 }), null);
});

test('participants cannot send host actions; only the speaker or the host drive a turn', async () => {
  const code = (h, token, body) => h.service.action(asMember(token, { revision: 7, turnNo: 1, ...body }), roomId).then(() => null, (error) => `${error.status}:${error.code}`);
  for (const action of ['start', 'force_ready', 'close_vote', 'next_turn', 'finish']) {
    const h = harness({ game: { phase: 'vote' }, turn: baseTurn({ status: 'vote' }) });
    assert.equal(await code(h, 'a-token', { action }), '403:FORBIDDEN', action);
    assert.equal(h.rpcCalls().length, 0, action);
  }
  for (const [action, phase, status] of [['begin_tell', 'ready', 'ready'], ['finish_tell', 'telling', 'telling'], ['skip', 'ready', 'ready'], ['reveal', 'reveal', 'reveal']]) {
    const body = { action, truth: 'real' };
    const h = harness({ game: { phase }, turn: baseTurn({ status }) });
    assert.equal(await code(h, 'b-token', body), '403:FORBIDDEN', `${action}: another participant`);
    assert.equal(h.rpcCalls().length, 0);
    assert.equal(await code(h, 'a-token', body), null, `${action}: the speaker`);
    const proxy = harness({ game: { phase }, turn: baseTurn({ status, truth_locked: true }) });
    assert.equal(await code(proxy, 'host-token', body), null, `${action}: the host as proxy`);
  }
  assert.equal(await code(harness({ game: { phase: 'ready' }, turn: baseTurn() }), 'a-token', { action: 'nonsense' }), '400:INVALID_REQUEST');
});

test('vote -> result is refused: reveal during the vote never reaches the database; stale turns are rejected', async () => {
  const h = harness({ game: { phase: 'vote' }, turn: baseTurn({ status: 'vote', truth_locked: true }) });
  await assert.rejects(() => h.service.action(asMember('a-token', { action: 'reveal', turnNo: 1, revision: 7 }), roomId), (e) => e.status === 409 && e.code === 'OCHI_NOT_REVEALED');
  await assert.rejects(() => h.service.action(asMember('host-token', { action: 'reveal', turnNo: 1, revision: 7, truth: 'real' }), roomId), (e) => e.code === 'OCHI_NOT_REVEALED');
  assert.equal(h.rpcCalls().length, 0);
  await assert.rejects(() => h.service.action(asMember('b-token', { action: 'vote', turnNo: 2, guess: 'real' }), roomId), (e) => e.status === 409 && e.code === 'OCHI_STALE_TURN');
  await assert.rejects(() => h.service.action(asMember('b-token', { action: 'vote', guess: 'real' }), roomId), (e) => e.status === 400);
  await assert.rejects(() => h.service.action(asMember('b-token', { action: 'vote', turnNo: 1, guess: 'maybe' }), roomId), (e) => e.status === 400);
  const after = harness({ game: { phase: 'reveal' }, turn: baseTurn({ status: 'reveal' }) });
  await assert.rejects(() => after.service.action(asMember('b-token', { action: 'vote', turnNo: 1, guess: 'real' }), roomId), (e) => e.status === 409 && e.code === 'OCHI_VOTE_CLOSED');
  // the RPC's own refusal is mapped to 409 as well
  const raced = harness({ game: { phase: 'reveal' }, turn: baseTurn({ status: 'reveal' }), rpcError: { rpc: '/ochi_reveal', message: 'OCHI_NOT_REVEALED' } });
  await assert.rejects(() => raced.service.action(asMember('a-token', { action: 'reveal', turnNo: 1, revision: 7 }), roomId), (e) => e.status === 409 && e.code === 'OCHI_NOT_REVEALED');
});

test("finish_tell forwards only the speaker's own answer; reveal sends an answer only when none is registered", async () => {
  const speaker = harness({ game: { phase: 'telling' }, turn: baseTurn({ status: 'telling', truth_locked: false }) });
  await assert.rejects(() => speaker.service.action(asMember('a-token', { action: 'finish_tell', turnNo: 1, revision: 7 }), roomId), (e) => e.status === 400);
  await speaker.service.action(asMember('a-token', { action: 'finish_tell', turnNo: 1, revision: 7, truth: 'fiction' }), roomId);
  assert.deepEqual(speaker.rpcCalls().map((c) => [c.name, c.body.p_truth, c.body.p_member_id]), [['ochi_finish_tell', 'fiction', aId]]);
  const proxy = harness({ game: { phase: 'telling' }, turn: baseTurn({ status: 'telling', truth_locked: false }) });
  await proxy.service.action(asMember('host-token', { action: 'finish_tell', turnNo: 1, revision: 7, truth: 'real' }), roomId);
  assert.equal(proxy.rpcCalls()[0].body.p_truth, null, 'a host finishing on the speaker behalf never supplies the answer');
  const locked = harness({ game: { phase: 'reveal' }, turn: baseTurn({ status: 'reveal', truth_locked: true }) });
  await locked.service.action(asMember('a-token', { action: 'reveal', turnNo: 1, revision: 7, truth: 'real' }), roomId);
  assert.equal(locked.rpcCalls()[0].body.p_truth, null, 'a registered answer is not overridable');
  const open = harness({ game: { phase: 'reveal' }, turn: baseTurn({ status: 'reveal', truth_locked: false }) });
  await assert.rejects(() => open.service.action(asMember('host-token', { action: 'reveal', turnNo: 1, revision: 7 }), roomId), (e) => e.status === 400);
  await open.service.action(asMember('host-token', { action: 'reveal', turnNo: 1, revision: 7, truth: 'real' }), roomId);
  assert.equal(open.rpcCalls()[0].body.p_truth, 'real');
});

test('start deals one unused card per member, balanced across categories, in a permuted order', async () => {
  const h = harness({ room: { status: 'lobby', revision: 3 }, game: { phase: 'lobby', turn_no: 0, used: [], laps: 2, turn_order: [], hands: {}, scores: {} } });
  await h.service.action(asMember('host-token', { action: 'start', revision: 3 }), roomId);
  const [call] = h.rpcCalls();
  assert.equal(call.name, 'ochi_start');
  assert.equal(call.body.p_expected_revision, 3);
  const hands = Object.entries(call.body.p_hands);
  assert.deepEqual(hands.map(([id]) => id).sort(), [aId, bId, hostId].sort());
  assert.equal(new Set(hands.map(([, hand]) => hand.idx)).size, 3);
  assert.ok(hands.every(([, hand]) => pool[hand.idx].text === hand.text));
  assert.equal(new Set(hands.map(([, hand]) => pool[hand.idx].category)).size, 3, 'three cards come from three different categories');
  assert.equal(call.body.p_turn_order.length, 6);
  assert.deepEqual(call.body.p_turn_order.slice(0, 3), call.body.p_turn_order.slice(3));
  assert.deepEqual([...call.body.p_turn_order.slice(0, 3)].sort(), [aId, bId, hostId].sort());
  const guest = harness({ room: { status: 'lobby' }, game: { phase: 'lobby', turn_no: 0 } });
  await assert.rejects(() => guest.service.action(asMember('a-token', { action: 'start', revision: 7 }), roomId), (e) => e.status === 403);
  const exhausted = harness({ room: { status: 'lobby', revision: 3 }, game: { phase: 'lobby', turn_no: 0, used: pool.map((_, i) => i).slice(0, pool.length - 2) } });
  await assert.rejects(() => exhausted.service.action(asMember('host-token', { action: 'start', revision: 3 }), roomId), (e) => e.status === 409 && e.code === 'OCHI_POOL_EXHAUSTED');
  assert.equal(exhausted.rpcCalls().length, 0);
});

test('swap redraws an unused card once; a used flag is refused without touching the database', async () => {
  const h = harness({ game: { phase: 'deal', used: [0, 1, 2] } });
  await h.service.action(asMember('b-token', { action: 'swap', turnNo: 1 }), roomId);
  const [call] = h.rpcCalls();
  assert.equal(call.name, 'ochi_swap');
  assert.equal(call.body.p_turn_no, 1); assert.equal(call.body.p_member_id, bId);
  assert.ok(![0, 1, 2].includes(call.body.p_new_hand.idx)); assert.equal(pool[call.body.p_new_hand.idx].text, call.body.p_new_hand.text);
  const used = baseGame(); used.hands[bId].swapUsed = true;
  const refused = harness({ game: { phase: 'deal', hands: used.hands } });
  await assert.rejects(() => refused.service.action(asMember('b-token', { action: 'swap', turnNo: 1 }), roomId), (e) => e.status === 409 && e.code === 'OCHI_SWAP_USED');
  assert.equal(refused.rpcCalls().length, 0);
});

test('next_turn deals fresh hands only at a lap boundary', async () => {
  const lapEnd = harness({ game: { phase: 'result', laps: 2, turn_order: [aId, bId, hostId, aId, bId, hostId], turn_no: 3 }, turn: baseTurn({ turn_no: 3, status: 'result' }) });
  await lapEnd.service.action(asMember('host-token', { action: 'next_turn', turnNo: 3, revision: 7 }), roomId);
  assert.equal(Object.keys(lapEnd.rpcCalls()[0].body.p_hands).length, 3);
  const mid = harness({ game: { phase: 'skipped', turn_no: 1 }, turn: baseTurn({ status: 'skipped' }) });
  await mid.service.action(asMember('host-token', { action: 'next_turn', turnNo: 1, revision: 7 }), roomId);
  assert.equal(mid.rpcCalls()[0].body.p_hands, null);
  const last = harness({ game: { phase: 'result', turn_no: 3 }, turn: baseTurn({ turn_no: 3, status: 'result' }) });
  await last.service.action(asMember('host-token', { action: 'next_turn', turnNo: 3, revision: 7 }), roomId);
  assert.equal(last.rpcCalls()[0].body.p_hands, null);
});

test('create: ochi payload goes to its RPC, venue tokens are verified, mixed sources and bad laps are refused', async () => {
  const req = (body) => ({ headers: { authorization: 'Bearer jwt' }, body });
  const h = harness();
  await h.service.create(req({ gameType: 'ochi_kara', hostName: 'H', laps: 2, venueToken: 'a'.repeat(32) }));
  assert.ok(h.calls.some((call) => call.path.includes('/venue_tables')), 'venue token is verified');
  const call = h.rpcCalls().find((item) => item.name === 'ochi_create_room');
  assert.equal(call.body.p_laps, 2); assert.equal(call.body.p_pool.length, ochiCards.length);
  assert.equal(call.body.p_pairs, undefined); assert.equal(call.body.p_deck_id, undefined);
  assert.deepEqual(Object.keys(call.body).sort(), ['p_expires_at', 'p_host_name', 'p_host_secret_hash', 'p_host_user_id', 'p_invite_hash', 'p_laps', 'p_pool']);
  const defaulted = harness(); await defaulted.service.create(req({ gameType: 'ochi_kara', hostName: 'H' }));
  assert.equal(defaulted.rpcCalls()[0].body.p_laps, 1);
  for (const extra of [{ deckId: 'any' }, { setId: 'abcdefabcdefabcd' }, { pairs: [] }, { laps: 3 }, { laps: '2' }]) {
    await assert.rejects(() => harness().service.create(req({ gameType: 'ochi_kara', hostName: 'H', ...extra })), (e) => e.status === 400, JSON.stringify(extra));
  }
  await assert.rejects(() => harness().service.create(req({ gameType: 'ochi_kara', hostName: 'H', venueToken: 'short' })), (e) => e.status === 400);
  const created = await harness({ room: { status: 'lobby' }, noGame: true }).service.create(req({ gameType: 'ochi_kara', hostName: 'H' }));
  assert.equal(created.ochi.phase, 'lobby'); assert.equal(created.room.gameType, 'ochi_kara'); assert.equal(created.host, true);
});

test('the older games keep their create payload shapes after the createPayload refactor', async () => {
  const req = (body) => ({ headers: { authorization: 'Bearer jwt' }, body });
  const expected = ['p_expires_at', 'p_host_name', 'p_host_secret_hash', 'p_host_user_id', 'p_invite_hash', 'p_pairs'];
  for (const gameType of ['question_wolf', 'minority_topic']) {
    const h = harness(); await h.service.create(req({ gameType, hostName: 'H' }));
    assert.deepEqual(Object.keys(h.rpcCalls()[0].body).sort(), expected, gameType);
  }
});

test('ochi errors surface as 409 with their codes', async () => {
  for (const message of ['OCHI_PHASE', 'OCHI_TURN', 'OCHI_ALREADY_VOTED', 'OCHI_VOTE_CLOSED', 'OCHI_SWAP_USED', 'OCHI_POOL_EXHAUSTED', 'OCHI_STALE_TURN', 'OCHI_NOT_STARTED', 'OCHI_NOT_REVEALED']) {
    const h = harness({ game: { phase: 'vote' }, turn: baseTurn({ status: 'vote' }), rpcError: { rpc: '/ochi_cast_vote', message } });
    await assert.rejects(() => h.service.action(asMember('b-token', { action: 'vote', turnNo: 1, guess: 'real' }), roomId), (e) => e.status === 409 && e.code === message, message);
  }
});

test('L1: someone whose turn has not come still gets their own hand through vote/reveal/result; spent hands never come back', async () => {
  for (const phase of ['vote', 'reveal', 'result', 'skipped']) {
    const turn = baseTurn({ status: phase });
    const later = await stateOf(harness({ game: { phase }, turn }), 'b-token'); // b speaks 2nd, a speaks 1st
    assert.equal(later.myOchi, SECRET_TEXT[bId], `${phase}: upcoming speaker keeps their hand`);
    assert.equal(later.mySwapAvailable, false, `${phase}: no redraw outside deal/ready`);
    const current = await stateOf(harness({ game: { phase }, turn }), 'a-token');
    assert.equal(current.myOchi, null, `${phase}: the current speaker's hand is spent`);
    const raw = JSON.stringify(await harness({ game: { phase }, turn }).service.state({ headers: { 'x-group-member-token': 'b-token' } }, roomId));
    assert.equal(raw.includes(SECRET_TEXT[hostId]), false, `${phase}: others' hands stay private`);
  }
  // turn 2: a (already spoke) has nothing left, host (speaks 3rd) still has theirs
  const second = harness({ game: { phase: 'telling', turn_no: 2 }, turn: baseTurn({ turn_no: 2, speaker_id: bId, status: 'telling' }) });
  assert.equal((await stateOf(second, 'a-token')).myOchi, null);
  assert.equal((await stateOf(second, 'host-token')).myOchi, SECRET_TEXT[hostId]);
  assert.equal((await stateOf(second, 'b-token')).myOchi, SECRET_TEXT[bId]);
});

test('L2: RPC payload rejections (stale reads) become a 409 GROUP_STALE the client can retry, not a 502', async () => {
  for (const message of ['OCHI_INVALID', 'OCHI_PARTICIPANTS']) {
    const h = harness({ room: { status: 'lobby', revision: 3 }, game: { phase: 'lobby', turn_no: 0, used: [] }, rpcError: { rpc: '/ochi_start', message } });
    await assert.rejects(() => h.service.action(asMember('host-token', { action: 'start', revision: 3 }), roomId), (e) => e.status === 409 && e.code === 'GROUP_STALE', message);
  }
  const next = harness({ game: { phase: 'result', turn_no: 1 }, turn: baseTurn({ status: 'result' }), rpcError: { rpc: '/ochi_next_turn', message: 'OCHI_INVALID' } });
  await assert.rejects(() => next.service.action(asMember('host-token', { action: 'next_turn', turnNo: 1, revision: 7 }), roomId), (e) => e.status === 409 && e.code === 'GROUP_STALE');
});

test('L3/L4: a finished game row is gone (ended); a game played to the end keeps only its minimal result, and ended rooms refuse every action', async () => {
  const gone = await stateOf(harness({ room: { status: 'ended' }, noGame: true }), 'a-token');
  assert.equal(gone.phase, 'ended'); assert.equal(gone.scores, null);
  const final = await stateOf(harness({ room: { status: 'ended' }, noGame: true, kept: keptResult(), at: '2026-10-09T00:01:00.000Z' }), 'b-token');
  assert.equal(final.phase, 'final'); assert.deepEqual(final.titles, { detective: [hostId, aId], mysterious: [bId] });
  assert.deepEqual(final.myScore, { listener: 1, teller: 3 });
  await assert.rejects(() => harness({ room: { status: 'ended' }, noGame: true, kept: keptResult() }).service.action(asMember('host-token', { action: 'finish', revision: 7 }), roomId), (e) => e.code === 'GROUP_ENDED');
});

test('L5: state reuses the room it was given instead of re-reading it first', async () => {
  const h = harness({ game: { phase: 'ready' }, turn: baseTurn() });
  await h.service.state({ headers: { 'x-group-member-token': 'b-token' } }, roomId);
  // one read in member() + the closing consistency read of ochiState (no extra opening read)
  assert.equal(h.calls.filter((call) => call.path.includes('/group_rooms') && call.search.startsWith('?id=eq.')).length, 2);
});

test('M1: lock_truth is a speaker-only, revision-free action during the vote', async () => {
  const mk = () => harness({ game: { phase: 'vote' }, turn: baseTurn({ status: 'vote', truth_locked: false }) });
  const speaker = mk();
  await speaker.service.action(asMember('a-token', { action: 'lock_truth', turnNo: 1, truth: 'real' }), roomId);
  assert.deepEqual(speaker.rpcCalls().map((c) => [c.name, c.body.p_truth, c.body.p_member_id]), [['ochi_lock_truth', 'real', aId]]);
  for (const token of ['host-token', 'b-token']) {
    const other = mk();
    await assert.rejects(() => other.service.action(asMember(token, { action: 'lock_truth', turnNo: 1, truth: 'real' }), roomId), (e) => e.status === 403, token);
    assert.equal(other.rpcCalls().length, 0);
  }
  await assert.rejects(() => mk().service.action(asMember('a-token', { action: 'lock_truth', turnNo: 1 }), roomId), (e) => e.status === 400);
  const early = harness({ game: { phase: 'telling' }, turn: baseTurn({ status: 'telling' }) });
  await assert.rejects(() => early.service.action(asMember('a-token', { action: 'lock_truth', turnNo: 1, truth: 'real' }), roomId), (e) => e.status === 409 && e.code === 'OCHI_PHASE');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createGroupRoomService } from '../server-side/group-rooms.mjs';
import { oneCutScenes } from '../dist/data/one-cut-scenes.js';
import { pickSceneSet, validateSceneSet } from '../dist/one-cut-rules.js';

const roomId = '11111111-1111-4111-8111-111111111111';
const [hostId, aId, bId] = ['22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333', '55555555-5555-4555-8555-555555555555'];
const takeId = '44444444-4444-4444-8444-444444444444';
const env = { SUPABASE_URL: 'http://127.0.0.1:54321', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test', SUPABASE_SERVICE_ROLE_KEY: 'service', NODE_ENV: 'test' };
const NOW = Date.parse('2026-10-09T00:00:30.000Z');
const sha = (value) => createHash('sha256').update(value).digest('hex');
const members = [
  { id: hostId, display_name: 'Host', role: 'host', adult_confirmed: true, joined_at: '1' },
  { id: aId, display_name: 'A', role: 'guest', adult_confirmed: false, joined_at: '2' },
  { id: bId, display_name: 'B', role: 'guest', adult_confirmed: false, joined_at: '3' }
];
const tokens = { 'host-token': members[0], 'a-token': members[1], 'b-token': members[2] };
const scenes = oneCutScenes.map(({ id, text, category, expression, similarGroup }) => ({ id, text, category, expression, ...(similarGroup ? { similarGroup } : {}) }));
const set = pickSceneSet({ scenes, usedAnswerIds: [], usedOptionIds: [], random: (() => { let s = 7; return () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; }; })() });
const ANSWER_INDEX = 2;
const optionTexts = set.options.map((id) => scenes.find((scene) => scene.id === id).text);
const ANSWER_TEXT = optionTexts[ANSWER_INDEX];
const ANSWER_ID = set.options[ANSWER_INDEX];
const baseRoom = { id: roomId, host_user_id: hostId, game_type: 'one_cut', status: 'playing', revision: 7, expires_at: '2099-01-01T00:00:00.000Z', cards: [], member_count: 3, cursor: 0, revealed: false, answer_index: 0, invite_hash: 'x' };
const baseGame = (extra = {}) => ({ room_id: roomId, scenes, mode: 'solo_actor', start_style: 'slate', laps_total: 2, laps_auto: false, lap_no: 1, take_no: 1, phase: 'brief', used_answer_ids: [ANSWER_ID], used_option_ids: [...set.options], scores: { [hostId]: 0, [aId]: 0, [bId]: 0 }, awards: [], ...extra });
const iso = (offsetMs) => new Date(NOW + offsetMs).toISOString();
// take 1 belongs to the host; take 2 to A; take 3 to B (room order: host, A, B)
const baseTake = (extra = {}) => ({ id: takeId, room_id: roomId, take_no: 1, lap_no: 1, actor_member_id: hostId, options: set.options, option_texts: optionTexts, answer_index: ANSWER_INDEX, assignments: null, start_style: 'slate', status: 'brief', take_started_at: null, action_at: null, cut_at: null, vote_deadline: null, ...extra });

const pickColumns = (row, select) => {
  if (!select || select === '*') return { ...row };
  const wanted = select.split(',');
  return Object.fromEntries(wanted.filter((column) => column in row).map((column) => [column, row[column]]));
};
// A small in-memory PostgREST: honours eq filters and `select=` column lists, so a leak shows up as a column that was asked for.
// Mirrors one_cut_state in the migration (the real filtering is tested in tests/rls/one-cut.test.mjs); the API only shapes this.
function snapshotFor(st, memberId) {
  const g = st.game;
  if (!g) {
    // the game row is gone: for 5 minutes only the kept scores + awards (phase 'final'), then a minimal 'ended'
    const head = { roomStatus: st.room.status, revision: st.room.revision, memberCount: st.room.member_count };
    if (st.kept && Date.parse(st.kept.result_expires_at) > st.nowMs()) return { ...head, phase: 'final', scores: st.kept.result.scores, awards: st.kept.result.awards, resultExpiresAt: st.kept.result_expires_at };
    return st.room.status === 'ended' ? { ...head, phase: 'ended' } : null;
  }
  const take = g.take_no > 0 && ['brief', 'take', 'vote', 'result'].includes(g.phase) ? st.takes.find((t) => t.take_no === g.take_no) : null;
  const votes = take ? st.votes.filter((v) => v.take_id === take.id) : [];
  return {
    roomStatus: st.room.status, revision: st.room.revision, memberCount: st.room.member_count, phase: g.phase, mode: g.mode, startStyle: g.start_style, lapsTotal: g.laps_total, lapsAuto: g.laps_auto,
    lapNo: g.lap_no, takeNo: g.take_no, scores: g.scores, awards: g.awards,
    take: take ? { actorMemberId: take.actor_member_id, options: take.options, optionTexts: take.option_texts, status: take.status, takeStartedAt: take.take_started_at, actionAt: take.action_at, cutAt: take.cut_at, voteDeadline: take.vote_deadline } : null,
    votedCount: ['vote', 'result'].includes(g.phase) ? votes.length : 0, memberHasVoted: votes.some((v) => v.voter_id === memberId),
    myAnswerIndex: take && ['brief', 'take', 'vote'].includes(g.phase) && take.actor_member_id === memberId ? take.answer_index : null,
    answerIndex: take && g.phase === 'result' ? take.answer_index : null,
    votes: g.phase === 'result' ? votes.map((v) => ({ voter_id: v.voter_id, choice: v.choice })) : [],
    lapTakes: g.phase === 'break' ? st.takes.filter((t) => t.lap_no === g.lap_no).map((t) => ({ takeNo: t.take_no, actorMemberId: t.actor_member_id, skipped: t.status !== 'result', sceneText: t.status === 'result' ? t.option_texts[t.answer_index] : null })) : [],
    myLikeTargetId: st.likes.find((l) => l.voter_id === memberId && l.lap_no === g.lap_no)?.target_id || null, likedCount: g.phase === 'break' ? st.likes.filter((l) => l.lap_no === g.lap_no).length : 0
  };
}
function harness({ room = {}, game = {}, noGame = false, kept = null, takes = [baseTake()], votes = [], likes = [], rpcError = null, expireSideEffect = null, nowFn = () => NOW, rawSnapshot = null } = {}) {
  const calls = [];
  const state = { room: { ...baseRoom, ...room }, game: noGame ? null : baseGame(game), kept, nowMs: () => nowFn(), takes, votes: votes.map((vote) => ({ take_id: takeId, ...vote })), likes: likes.map((like) => ({ room_id: roomId, lap_no: 1, ...like })) };
  const json = (data, status = 200) => new Response(JSON.stringify(data), { status });
  const rows = (table, url) => {
    const params = [...url.searchParams.entries()].filter(([key]) => !['select', 'order', 'limit'].includes(key));
    const source = state[table] || [];
    return source.filter((row) => params.every(([key, value]) => !value.startsWith('eq.') || String(row[key]) === value.slice(3))).map((row) => pickColumns(row, url.searchParams.get('select')));
  };
  const fetchImpl = async (url, options = {}) => {
    const u = new URL(url); const path = u.pathname; const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ path, search: decodeURIComponent(u.search), body, method: options.method || 'GET' });
    if (path === '/auth/v1/user') return json({ id: hostId, is_anonymous: false });
    if (path.includes('/rpc/')) {
      if (rpcError && path.endsWith(rpcError.rpc)) return json({ message: rpcError.message }, 400);
      if (path.endsWith('/one_cut_state')) return json(rawSnapshot ? rawSnapshot(snapshotFor(state, body.p_member_id)) : snapshotFor(state, body.p_member_id));
      if (path.endsWith('/one_cut_expire') && expireSideEffect) expireSideEffect(state);
      return json(path.endsWith('_create_room') ? [{ room_id: roomId, host_member_id: hostId }] : null);
    }
    if (path.includes('/group_rooms')) return json([state.room]);
    if (path.includes('/group_members') && u.searchParams.get('secret_hash')) {
      const found = Object.entries(tokens).find(([token]) => `eq.${sha(token)}` === u.searchParams.get('secret_hash'));
      return json(found ? [found[1]] : []);
    }
    if (path.includes('/group_members')) return json(members);
    if (path.includes('/venue_tables')) return json([{ id: 1, venues: { active: true } }]);
    if (path.includes('/one_cut_games')) return json(state.game ? [pickColumns(state.game, u.searchParams.get('select'))] : []);
    if (path.includes('/one_cut_takes')) return json(rows('takes', u));
    if (path.includes('/one_cut_votes')) return json(rows('votes', u));
    if (path.includes('/one_cut_likes')) return json(rows('likes', u));
    return json([]);
  };
  const service = createGroupRoomService({ env, fetchImpl, now: nowFn });
  const allRpc = () => calls.filter((call) => call.path.includes('/rpc/')).map((call) => ({ name: call.path.split('/rpc/')[1], body: call.body }));
  // the state read that follows every action is not an action RPC: kept out of rpcCalls
  const rpcCalls = () => allRpc().filter((call) => call.name !== 'one_cut_state');
  return { service, state, calls, rpcCalls, allRpc };
}
const asMember = (token, body) => ({ headers: { 'x-group-member-token': token }, body });
const stateOf = async (h, token) => (await h.service.state({ headers: { 'x-group-member-token': token } }, roomId)).oneCut;
const code = (h, token, body) => h.service.action(asMember(token, body), roomId).then(() => null, (error) => `${error.status}:${error.code}`);
const live = (status, extra = {}) => baseTake({ status, take_started_at: iso(-20000), action_at: iso(-14500), cut_at: iso(-11500), vote_deadline: iso(28500), ...extra });

test('create sends the scene snapshot to one_cut_create_room and validates the options', async () => {
  const h = harness();
  const result = await h.service.create({ headers: { authorization: 'Bearer jwt' }, body: { gameType: 'one_cut', hostName: 'H', lapsTotal: 3 } });
  const call = h.rpcCalls().find((item) => item.name === 'one_cut_create_room');
  assert.ok(call); assert.equal(call.body.p_laps_total, 3); assert.equal(call.body.p_start_style, 'slate'); assert.equal(call.body.p_mode, 'solo_actor');
  assert.equal(call.body.p_scenes.length, oneCutScenes.length);
  assert.ok(call.body.p_scenes.every((scene) => scene.id && scene.text && scene.category && scene.expression && !('kidSafe' in scene)));
  assert.equal(result.room.gameType, 'one_cut'); assert.equal(result.host, true);
  const auto = harness(); await auto.service.create({ headers: { authorization: 'Bearer jwt' }, body: { gameType: 'one_cut', hostName: 'H' } });
  assert.equal(auto.rpcCalls().find((item) => item.name === 'one_cut_create_room').body.p_laps_total, null);
  for (const body of [{ lapsTotal: 4 }, { lapsTotal: 0 }, { lapsTotal: '2' }, { startStyle: 'f1' }, { mode: 'ensemble' }, { deckId: 'x' }, { pairs: [] }]) {
    await assert.rejects(() => harness().service.create({ headers: { authorization: 'Bearer jwt' }, body: { gameType: 'one_cut', hostName: 'H', ...body } }), (e) => e.status === 400, JSON.stringify(body));
  }
  const venue = harness();
  await venue.service.create({ headers: { authorization: 'Bearer jwt' }, body: { gameType: 'one_cut', hostName: 'H', venueToken: 'a'.repeat(32) } });
  assert.equal(venue.calls.some((c) => c.path.includes('/venue_tables')), true);
});

test('the actor alone gets myScene while the take is live; nobody else, the host included', async () => {
  for (const [phase, status] of [['brief', 'brief'], ['take', 'take'], ['vote', 'vote']]) {
    const h = harness({ game: { phase }, takes: [phase === 'brief' ? baseTake() : live(status)] });
    const actor = await stateOf(h, 'host-token'); // the host is this take's actor
    assert.deepEqual(actor.myScene, { label: 'C', text: ANSWER_TEXT }, phase);
    assert.equal(actor.isActor, true);
    for (const token of ['a-token', 'b-token']) {
      const h2 = harness({ game: { phase }, takes: [phase === 'brief' ? baseTake() : live(status)] });
      const response = await h2.service.state({ headers: { 'x-group-member-token': token } }, roomId);
      assert.equal(response.oneCut.myScene, null, `${phase}/${token}`);
      assert.equal(response.oneCut.isActor, false);
      // the six options are public, but nothing in the payload points at the answer
      assert.equal(response.oneCut.options.length, 6);
      assert.deepEqual(response.oneCut.options.map((o) => o.label), ['A', 'B', 'C', 'D', 'E', 'F']);
      const raw = JSON.stringify(response.oneCut);
      assert.equal(/answer_index|answerIndex|answerLabel|"tally"|correctMemberIds/.test(raw), false, `${phase}/${token}`);
    }
  }
  // a non-actor host: the representative's end-to-end view carries no answer either
  const other = harness({ game: { phase: 'vote', take_no: 2 }, takes: [live('vote', { take_no: 2, actor_member_id: aId })] });
  const hostView = await stateOf(other, 'host-token');
  assert.equal(hostView.myScene, null);
  assert.equal(JSON.stringify(hostView).includes('"isActor":true'), false);
  // the actor's own end-of-vote view does not get the answer tag either, only the scene text for their own screen
  const actorVote = await stateOf(harness({ game: { phase: 'vote' }, takes: [live('vote')] }), 'host-token');
  assert.equal(actorVote.result, null);
});

test('votes are counted, never listed: only whether I voted, and no choice, before and after result', async () => {
  const votes = [{ voter_id: aId, choice: 2 }, { voter_id: bId, choice: 4 }];
  const h = harness({ game: { phase: 'vote' }, takes: [live('vote')], votes });
  for (const [token, voted] of [['a-token', true], ['b-token', true], ['host-token', false]]) {
    const response = await h.service.state({ headers: { 'x-group-member-token': token } }, roomId);
    const view = response.oneCut;
    assert.equal(view.votedCount, 2); assert.equal(view.voterCount, 2); assert.equal(view.memberHasVoted, voted);
    assert.equal(view.result, null);
    assert.equal(/choice|myVote/.test(JSON.stringify(response)), false, token);
  }
});

test('result reveals the answer, per-symbol tally, correct voters and gains -- and no per-voter choice', async () => {
  const votes = [{ voter_id: aId, choice: ANSWER_INDEX }, { voter_id: bId, choice: 4 }];
  const h = harness({ game: { phase: 'result', scores: { [hostId]: 1, [aId]: 1, [bId]: 0 } }, takes: [live('result')], votes });
  const response = await h.service.state({ headers: { 'x-group-member-token': 'b-token' } }, roomId);
  const view = response.oneCut;
  assert.equal(view.result.answerLabel, 'C'); assert.equal(view.result.answerText, ANSWER_TEXT);
  assert.deepEqual(view.result.tally, [0, 0, 1, 0, 1, 0]); assert.equal(view.result.passCount, 0);
  assert.deepEqual(view.result.correctMemberIds, [aId]);
  assert.deepEqual(view.result.gained, { [aId]: 1, [hostId]: 1 });
  assert.equal(view.scores[hostId], 1);
  assert.equal(/"choice"|"myVote"|voter_id/.test(JSON.stringify(response)), false, 'who picked what stays hidden');
  assert.equal(view.myScene, null);
  assert.equal(view.memberHasVoted, true);
  // passes (null choices) are counted apart
  const passed = await stateOf(harness({ game: { phase: 'result' }, takes: [live('result')], votes: [{ voter_id: aId, choice: null }, { voter_id: bId, choice: null }] }), 'a-token');
  assert.equal(passed.result.passCount, 2); assert.deepEqual(passed.result.correctMemberIds, []); assert.deepEqual(passed.result.gained, { [hostId]: 0 });
});

test('the break lists the lap with answers (all takes are over), the likes only as my own choice and a count; no award yet', async () => {
  const takes = [baseTake({ status: 'result' }), baseTake({ id: 't2', take_no: 2, actor_member_id: aId, status: 'result', answer_index: 0 }), baseTake({ id: 't3', take_no: 3, actor_member_id: bId, status: 'skipped', answer_index: 1 })];
  const likes = [{ voter_id: bId, target_id: aId }, { voter_id: aId, target_id: hostId }];
  const h = harness({ game: { phase: 'break', take_no: 3 }, takes, likes });
  const response = await h.service.state({ headers: { 'x-group-member-token': 'b-token' } }, roomId);
  const view = response.oneCut;
  assert.equal(view.phase, 'break');
  assert.deepEqual(view.break.takes, [
    { takeNo: 1, actorMemberId: hostId, skipped: false, sceneText: ANSWER_TEXT },
    { takeNo: 2, actorMemberId: aId, skipped: false, sceneText: optionTexts[0] },
    { takeNo: 3, actorMemberId: bId, skipped: true, sceneText: null }
  ]);
  assert.equal(view.break.myLikeTargetId, aId); assert.equal(view.break.likedCount, 2); assert.deepEqual(view.awards, []);
  assert.equal(/answer_index|voter_id|target_id/.test(JSON.stringify(response)), false);
  assert.equal(JSON.stringify(response).includes(optionTexts[1]), false, 'the skipped take reveals nothing');
});

test('lobby and ended: minimal, scores only when started', async () => {
  const lobby = await stateOf(harness({ room: { status: 'lobby', member_count: 2 }, game: { phase: 'lobby', take_no: 0, lap_no: 0, laps_auto: true }, takes: [] }), 'a-token');
  assert.equal(lobby.phase, 'lobby'); assert.equal(lobby.lapsTotal, null); assert.equal(lobby.scores, null); assert.equal(lobby.memberCount, 2);
  const none = await stateOf(harness({ room: { status: 'lobby' }, noGame: true, takes: [] }), 'a-token');
  assert.equal(none.phase, 'lobby');
  const ended = await stateOf(harness({ room: { status: 'ended' }, noGame: true, takes: [] }), 'b-token');
  assert.equal(ended.phase, 'ended'); assert.equal(ended.scores, null); assert.deepEqual(ended.awards, []); assert.equal(ended.myScene, null);
});

const KEPT = (extra = {}) => ({ result: { scores: { [hostId]: 3, [aId]: 2, [bId]: 0 }, awards: [{ lap: 1, memberIds: [aId] }] }, result_expires_at: iso(4 * 60000 + 30000), ...extra });

test('final serves everyone\u2019s totals and the lap awards (PO decision Q14) from the kept result for 5 minutes, and nothing else', async () => {
  const gone = { room: { status: 'ended' }, noGame: true, takes: [], kept: KEPT() };
  const final = await stateOf(harness(gone), 'b-token');
  assert.equal(final.phase, 'final'); assert.deepEqual(final.scores, { [hostId]: 3, [aId]: 2, [bId]: 0 }); assert.deepEqual(final.awards, [{ lap: 1, memberIds: [aId] }]);
  assert.equal(final.myScene, null); assert.equal(final.result ?? null, null);
  assert.equal(final.resultExpiresAt, KEPT().result_expires_at);
  const raw = JSON.stringify(await harness(gone).service.state({ headers: { 'x-group-member-token': 'a-token' } }, roomId));
  assert.equal(/answer_index|voter_id|target_id|optionTexts|"options"/.test(raw), false, 'no take, vote or like data is left to serve');
  // a finished game cannot be acted on (GROUP_ENDED), host included
  assert.equal(await code(harness(gone), 'host-token', { action: 'finish', takeNo: 6, revision: 7 }), '409:GROUP_ENDED');
});

test('after result_expires_at only the minimal ended response is served, and the lapsed row is swept by the cleanup', async () => {
  const late = () => NOW + 5 * 60000;
  const h = harness({ room: { status: 'ended' }, noGame: true, takes: [], kept: KEPT({ result_expires_at: iso(0) }), nowFn: late });
  const ended = await stateOf(h, 'a-token');
  assert.equal(ended.phase, 'ended'); assert.equal(ended.scores, null); assert.deepEqual(ended.awards, []);
  const sweeps = h.calls.filter((call) => call.method === 'DELETE').map((call) => call.path.split('/').pop());
  assert.deepEqual(sweeps.sort(), ['group_rooms', 'mission_results', 'ochi_results', 'one_cut_results']);
  const still = await stateOf(harness({ room: { status: 'ended' }, noGame: true, takes: [], kept: KEPT({ result_expires_at: iso(1) }) }), 'a-token');
  assert.equal(still.phase, 'final', 'one millisecond before the limit it is still served');
});

test('timeline fields appear only while the take is live and use the server clock', async () => {
  const v = await stateOf(harness({ game: { phase: 'take' }, takes: [live('take', { take_started_at: iso(-3000), action_at: iso(2500), cut_at: iso(5500), vote_deadline: iso(45500) })] }), 'a-token');
  assert.equal(v.serverNow, iso(0)); assert.equal(v.takeStartedAt, iso(-3000)); assert.equal(v.actionAt, iso(2500)); assert.equal(v.cutAt, iso(5500)); assert.equal(v.voteDeadline, null);
  const brief = await stateOf(harness({ game: { phase: 'brief' } }), 'a-token');
  assert.equal(brief.takeStartedAt, null); assert.equal(brief.actionAt, null);
  const voting = await stateOf(harness({ game: { phase: 'vote' }, takes: [live('vote')] }), 'a-token');
  assert.equal(voting.voteDeadline, iso(28500));
});

test('actions settle a passed deadline first (the state read does it inside one_cut_state)', async () => {
  const act = harness({ game: { phase: 'take' }, takes: [live('take', { cut_at: iso(-600) })], expireSideEffect: (s) => { s.game.phase = 'vote'; s.takes[0].status = 'vote'; } });
  assert.equal(await code(act, 'a-token', { action: 'vote', takeNo: 1, choice: 1 }), null);
  assert.deepEqual(act.rpcCalls().map((c) => c.name), ['one_cut_expire', 'one_cut_cast_vote']);
  const early = harness({ game: { phase: 'take' }, takes: [live('take', { cut_at: iso(2000) })] });
  assert.equal((await stateOf(early, 'a-token')).phase, 'take');
  assert.deepEqual(early.allRpc().map((c) => c.name), ['one_cut_state'], 'a state read is one RPC and never calls expire itself');
});

test('revision is exempt for everything but start; the host closes / continues / finishes against take and lap numbers', async () => {
  const room = { revision: 99 }; // the client view is stale: participants' votes and likes keep moving the revision
  assert.equal(await code(harness({ room }), 'host-token', { action: 'ready', takeNo: 1, revision: 1 }), null);
  assert.equal(await code(harness({ room }), 'host-token', { action: 'skip', takeNo: 1, revision: 1 }), null);
  assert.equal(await code(harness({ room, game: { phase: 'vote' }, takes: [live('vote')] }), 'a-token', { action: 'vote', takeNo: 1, choice: 0 }), null);
  assert.equal(await code(harness({ room, game: { phase: 'result' }, takes: [live('result')] }), 'host-token', { action: 'next', takeNo: 1 }), null);
  assert.equal(await code(harness({ room, game: { phase: 'break', take_no: 3 }, takes: [baseTake({ status: 'result' })] }), 'a-token', { action: 'like', lapNo: 1, targetId: bId }), null);
  // M1: no revision needed (none sent, or a stale one) for these
  const relaxed = [
    ['close_vote', { room, game: { phase: 'vote' }, takes: [live('vote')] }, { takeNo: 1 }],
    ['continue', { room, game: { phase: 'break', take_no: 3 }, takes: [baseTake({ status: 'result' })] }, { lapNo: 1 }],
    ['finish', { room }, { takeNo: 1 }]
  ];
  for (const [action, setup, extra] of relaxed) {
    assert.equal(await code(harness(setup), 'host-token', { action, ...extra }), null, `${action}: no revision`);
    assert.equal(await code(harness(setup), 'host-token', { action, ...extra, revision: 1 }), null, `${action}: stale revision`);
  }
  // they are matched by take / lap number and phase instead
  assert.equal(await code(harness({ room, game: { phase: 'vote' }, takes: [live('vote')] }), 'host-token', { action: 'close_vote', takeNo: 2 }), '409:ONE_CUT_STALE_TAKE');
  assert.equal(await code(harness({ room, game: { phase: 'break', take_no: 3 }, takes: [baseTake({ status: 'result' })] }), 'host-token', { action: 'continue', lapNo: 2 }), '409:ONE_CUT_STALE_TAKE');
  assert.equal(await code(harness({ room }), 'host-token', { action: 'finish' }), '400:INVALID_REQUEST');
  // start is the one that still needs the current revision
  const lobby = { room: { status: 'lobby' }, game: { phase: 'lobby', take_no: 0, lap_no: 0 }, takes: [] };
  assert.equal(await code(harness(lobby), 'host-token', { action: 'start' }), '409:GROUP_STALE');
  assert.equal(await code(harness(lobby), 'host-token', { action: 'start', revision: 6 }), '409:GROUP_STALE');
  assert.equal(await code(harness(lobby), 'host-token', { action: 'start', revision: 7 }), null);
});

test('only the host can start / close_vote / continue / finish; only the actor or the host can ready / skip / next; the actor cannot vote', async () => {
  for (const [action, setup, extra] of [['start', { room: { status: 'lobby' }, game: { phase: 'lobby', take_no: 0 }, takes: [] }, {}], ['close_vote', { game: { phase: 'vote' }, takes: [live('vote')] }, { takeNo: 1 }], ['continue', { game: { phase: 'break' }, takes: [baseTake({ status: 'result' })] }, { lapNo: 1 }], ['finish', {}, {}]]) {
    const h = harness(setup);
    assert.equal(await code(h, 'a-token', { action, revision: 7, ...extra }), '403:FORBIDDEN', action);
    assert.equal(h.rpcCalls().length, 0, action);
  }
  // take 1 belongs to the host: A (not host, not actor) is refused; the host proxies for an absent actor (take 2 is A's)
  for (const [action, phase, status] of [['ready', 'brief', 'brief'], ['skip', 'brief', 'brief'], ['next', 'result', 'result']]) {
    const h = harness({ game: { phase }, takes: [status === 'brief' ? baseTake() : live(status)] });
    assert.equal(await code(h, 'a-token', { action, takeNo: 1 }), '409:ONE_CUT_NOT_ACTOR', `${action}: another participant`);
    assert.equal(h.rpcCalls().length, 0);
    assert.equal(await code(harness({ game: { phase, take_no: 2 }, takes: [{ ...(status === 'brief' ? baseTake() : live(status)), take_no: 2, actor_member_id: aId }] }), 'a-token', { action, takeNo: 2 }), null, `${action}: the actor`);
    assert.equal(await code(harness({ game: { phase, take_no: 2 }, takes: [{ ...(status === 'brief' ? baseTake() : live(status)), take_no: 2, actor_member_id: aId }] }), 'host-token', { action, takeNo: 2 }), null, `${action}: the host for the actor`);
  }
  const voting = harness({ game: { phase: 'vote' }, takes: [live('vote')] });
  assert.equal(await code(voting, 'host-token', { action: 'vote', takeNo: 1, choice: 0 }), '409:ONE_CUT_ACTOR_VOTE');
  assert.equal(voting.rpcCalls().length, 0);
  assert.equal(await code(harness(), 'a-token', { action: 'nonsense' }), '400:INVALID_REQUEST');
});

test('stale and malformed requests never reach the database', async () => {
  const brief = () => harness();
  assert.equal(await code(brief(), 'host-token', { action: 'ready' }), '400:INVALID_REQUEST');
  assert.equal(await code(brief(), 'host-token', { action: 'ready', takeNo: '1' }), '400:INVALID_REQUEST');
  const stale = brief();
  assert.equal(await code(stale, 'host-token', { action: 'ready', takeNo: 2 }), '409:ONE_CUT_STALE_TAKE');
  assert.equal(await code(stale, 'host-token', { action: 'skip', takeNo: 0 }), '409:ONE_CUT_STALE_TAKE');
  assert.equal(stale.rpcCalls().length, 0);
  const voting = () => harness({ game: { phase: 'vote' }, takes: [live('vote')] });
  for (const choice of [6, -1, 1.5, 'A', {}]) assert.equal(await code(voting(), 'a-token', { action: 'vote', takeNo: 1, choice }), '400:INVALID_REQUEST', String(choice));
  assert.equal(await code(voting(), 'a-token', { action: 'vote', takeNo: 2, choice: 1 }), '409:ONE_CUT_STALE_TAKE');
  assert.equal(await code(harness({ game: { phase: 'take' }, takes: [live('take', { cut_at: iso(3000) })] }), 'a-token', { action: 'vote', takeNo: 1, choice: 1 }), '409:ONE_CUT_VOTE_CLOSED');
  assert.equal(await code(harness({ game: { phase: 'result' }, takes: [live('result')] }), 'a-token', { action: 'vote', takeNo: 1, choice: 1 }), '409:ONE_CUT_VOTE_CLOSED');
  assert.equal(await code(harness({ game: { phase: 'break' }, takes: [baseTake({ status: 'result' })] }), 'host-token', { action: 'ready', takeNo: 1 }), '409:ONE_CUT_PHASE');
  assert.equal(await code(harness({ game: { phase: 'vote' }, takes: [live('vote')] }), 'host-token', { action: 'next', takeNo: 1 }), '409:ONE_CUT_PHASE');
  assert.equal(await code(harness({ game: { phase: 'result' }, takes: [live('result')] }), 'host-token', { action: 'skip', takeNo: 1 }), '409:ONE_CUT_PHASE');
  assert.equal(await code(harness({ game: { phase: 'take' }, takes: [live('take')] }), 'host-token', { action: 'close_vote', takeNo: 1, revision: 7 }), '409:ONE_CUT_VOTE_CLOSED');
  // ready during/after the shoot is an idempotent no-op rather than an error (the RPC is not even called)
  const again = harness({ game: { phase: 'take' }, takes: [live('take', { cut_at: iso(3000) })] });
  assert.equal(await code(again, 'host-token', { action: 'ready', takeNo: 1 }), null);
  assert.equal(again.rpcCalls().length, 0);
  assert.equal(await code(harness({ game: { phase: 'break' }, takes: [baseTake({ status: 'result' })] }), 'host-token', { action: 'like', lapNo: 2, targetId: bId }), '409:ONE_CUT_STALE_TAKE');
  assert.equal(await code(harness({ game: { phase: 'break' }, takes: [baseTake({ status: 'result' })] }), 'host-token', { action: 'like', lapNo: 1, targetId: 'nope' }), '400:INVALID_REQUEST');
  assert.equal(await code(harness({ game: { phase: 'result' }, takes: [live('result')] }), 'host-token', { action: 'like', lapNo: 1, targetId: bId }), '409:ONE_CUT_PHASE');
});

test('start picks a valid set with the host as first actor and passes the revision', async () => {
  const h = harness({ room: { status: 'lobby' }, game: { phase: 'lobby', take_no: 0, lap_no: 0, used_answer_ids: [], used_option_ids: [] }, takes: [] });
  assert.equal(await code(h, 'host-token', { action: 'start', revision: 7 }), null);
  const [call] = h.rpcCalls();
  assert.equal(call.name, 'one_cut_start_take');
  assert.equal(call.body.p_take_no, 1); assert.equal(call.body.p_lap_no, 1); assert.equal(call.body.p_actor_id, hostId); assert.equal(call.body.p_member_id, hostId);
  assert.equal(call.body.p_expected_revision, 7); assert.equal(call.body.p_start_style, 'slate'); assert.equal(call.body.p_assignments, null);
  assert.equal(validateSceneSet(scenes, call.body.p_options).ok, true, JSON.stringify(validateSceneSet(scenes, call.body.p_options)));
  assert.ok(call.body.p_answer_index >= 0 && call.body.p_answer_index < 6);
  assert.equal(await code(harness({ game: { phase: 'brief' } }), 'host-token', { action: 'start', revision: 7 }), '409:ONE_CUT_PHASE');
});

test('ready sends the start instant one second ahead on the server clock', async () => {
  const h = harness();
  assert.equal(await code(h, 'host-token', { action: 'ready', takeNo: 1 }), null);
  assert.deepEqual(h.rpcCalls(), [{ name: 'one_cut_ready', body: { p_room_id: roomId, p_take_no: 1, p_member_id: hostId, p_started_at: iso(1000) } }]);
});

test('next hands the turn on in room order, and goes to the break after the last take of a lap', async () => {
  // take 1 (host) -> take 2 is A's
  const mid = harness({ game: { phase: 'result' }, takes: [live('result')] });
  assert.equal(await code(mid, 'host-token', { action: 'next', takeNo: 1 }), null);
  const [start] = mid.rpcCalls();
  assert.equal(start.name, 'one_cut_start_take');
  assert.equal(start.body.p_take_no, 2); assert.equal(start.body.p_lap_no, 1); assert.equal(start.body.p_actor_id, aId); assert.equal(start.body.p_expected_revision, null);
  assert.equal(validateSceneSet(scenes, start.body.p_options).ok, true);
  assert.equal(start.body.p_options.includes(ANSWER_ID), false, 'a scene already used as an answer is not offered again');
  // take 3 is the last of lap 1 (3 players): break
  const last = harness({ game: { phase: 'result', take_no: 3 }, takes: [live('result', { take_no: 3, actor_member_id: bId })] });
  assert.equal(await code(last, 'b-token', { action: 'next', takeNo: 3 }), null);
  assert.deepEqual(last.rpcCalls(), [{ name: 'one_cut_to_break', body: { p_room_id: roomId, p_take_no: 3, p_member_id: bId } }]);
});

test('skip is ONE rpc: it carries the next take, releases the passed scene for the pick, and ends the lap with null', async () => {
  const h = harness({ game: { phase: 'brief' } });
  assert.equal(await code(h, 'host-token', { action: 'skip', takeNo: 1 }), null);
  assert.equal(h.rpcCalls().length, 1);
  const [skip] = h.rpcCalls();
  assert.equal(skip.name, 'one_cut_skip'); assert.equal(skip.body.p_take_no, 1);
  assert.equal(skip.body.p_next.takeNo, 2); assert.equal(skip.body.p_next.actorId, aId); assert.equal(skip.body.p_next.lapNo, 1);
  assert.equal(validateSceneSet(scenes, skip.body.p_next.options).ok, true);
  // the last take of the lap: nothing follows but the break
  const last = harness({ game: { phase: 'brief', take_no: 3 }, takes: [baseTake({ take_no: 3, actor_member_id: bId })] });
  assert.equal(await code(last, 'b-token', { action: 'skip', takeNo: 3 }), null);
  assert.deepEqual(last.rpcCalls(), [{ name: 'one_cut_skip', body: { p_room_id: roomId, p_take_no: 3, p_member_id: bId, p_next: null } }]);
  // the passed answer is pickable again: over many picks it eventually shows up as an option or answer
  let seen = false;
  for (let i = 0; i < 200 && !seen; i += 1) {
    const probe = harness({ game: { phase: 'brief', used_option_ids: [] } });
    await code(probe, 'host-token', { action: 'skip', takeNo: 1 });
    seen = probe.rpcCalls()[0].body.p_next.options.includes(ANSWER_ID);
  }
  assert.equal(seen, true, 'the released scene can come back');
  // a pick that fails (pool exhausted) fails the whole request before any RPC
  const exhausted = harness({ game: { phase: 'brief', scenes: scenes.slice(0, 5) } });
  assert.equal(await code(exhausted, 'host-token', { action: 'skip', takeNo: 1 }), '409:ONE_CUT_SCENES_EXHAUSTED');
  assert.equal(exhausted.rpcCalls().length, 0);
});

test('continue: lap 1 of 2 starts take 4 with the host; the last lap sends no next take; finish is one rpc', async () => {
  const lap = harness({ game: { phase: 'break', take_no: 3 }, takes: [baseTake({ status: 'result' })] });
  assert.equal(await code(lap, 'host-token', { action: 'continue', lapNo: 1, revision: 7 }), null);
  const [close] = lap.rpcCalls();
  assert.equal(close.name, 'one_cut_close_break'); assert.equal(close.body.p_lap_no, 1); assert.equal('p_expected_revision' in close.body, false);
  assert.equal(close.body.p_next.takeNo, 4); assert.equal(close.body.p_next.lapNo, 2); assert.equal(close.body.p_next.actorId, hostId);
  assert.equal(validateSceneSet(scenes, close.body.p_next.options).ok, true);
  const final = harness({ game: { phase: 'break', take_no: 6, lap_no: 2 }, takes: [baseTake({ status: 'result' })] });
  assert.equal(await code(final, 'host-token', { action: 'continue', lapNo: 2, revision: 7 }), null);
  assert.equal(final.rpcCalls()[0].body.p_next, null);
  const fin = harness();
  assert.equal(await code(fin, 'host-token', { action: 'finish', takeNo: 1, revision: 7 }), null);
  assert.deepEqual(fin.rpcCalls(), [{ name: 'one_cut_finish', body: { p_room_id: roomId, p_member_id: hostId, p_take_no: 1 } }]);
  assert.equal(await code(harness({ game: { phase: 'break', take_no: 3 }, takes: [baseTake({ status: 'result' })] }), 'host-token', { action: 'continue', lapNo: 2, revision: 7 }), '409:ONE_CUT_STALE_TAKE');
});

test('vote and like pass the right ids; passes are null', async () => {
  const v = harness({ game: { phase: 'vote' }, takes: [live('vote')] });
  assert.equal(await code(v, 'a-token', { action: 'vote', takeNo: 1, choice: 4 }), null);
  assert.deepEqual(v.rpcCalls(), [{ name: 'one_cut_cast_vote', body: { p_room_id: roomId, p_take_no: 1, p_voter_id: aId, p_choice: 4 } }]);
  const p = harness({ game: { phase: 'vote' }, takes: [live('vote')] });
  assert.equal(await code(p, 'b-token', { action: 'vote', takeNo: 1, choice: null }), null);
  assert.equal(p.rpcCalls()[0].body.p_choice, null);
  const p2 = harness({ game: { phase: 'vote' }, takes: [live('vote')] });
  assert.equal(await code(p2, 'b-token', { action: 'vote', takeNo: 1 }), null);
  assert.equal(p2.rpcCalls()[0].body.p_choice, null);
  const l = harness({ game: { phase: 'break' }, takes: [baseTake({ status: 'result' })] });
  assert.equal(await code(l, 'b-token', { action: 'like', lapNo: 1, targetId: aId }), null);
  assert.deepEqual(l.rpcCalls(), [{ name: 'one_cut_like', body: { p_room_id: roomId, p_lap_no: 1, p_voter_id: bId, p_target_id: aId } }]);
});

test('RPC refusals map to their 409 codes', async () => {
  const via = async (rpc, message, action, setup) => {
    const h = harness({ ...setup, rpcError: { rpc, message } });
    return code(h, 'a-token', action);
  };
  const voting = { game: { phase: 'vote' }, takes: [live('vote')] };
  assert.equal(await via('/one_cut_cast_vote', 'ONE_CUT_ALREADY_VOTED', { action: 'vote', takeNo: 1, choice: 1 }, voting), '409:ONE_CUT_ALREADY_VOTED');
  assert.equal(await via('/one_cut_cast_vote', 'ONE_CUT_VOTE_CLOSED', { action: 'vote', takeNo: 1, choice: 1 }, voting), '409:ONE_CUT_VOTE_CLOSED');
  assert.equal(await via('/one_cut_cast_vote', 'ONE_CUT_STALE_TAKE', { action: 'vote', takeNo: 1, choice: 1 }, voting), '409:ONE_CUT_STALE_TAKE');
  assert.equal(await via('/one_cut_cast_vote', 'ONE_CUT_ACTOR_VOTE', { action: 'vote', takeNo: 1, choice: 1 }, voting), '409:ONE_CUT_ACTOR_VOTE');
  assert.equal(await via('/one_cut_cast_vote', 'ONE_CUT_UNAVAILABLE', { action: 'vote', takeNo: 1, choice: 1 }, voting), '409:ONE_CUT_UNAVAILABLE');
  assert.equal(await via('/one_cut_cast_vote', 'ONE_CUT_SCENES_EXHAUSTED', { action: 'vote', takeNo: 1, choice: 1 }, voting), '409:ONE_CUT_SCENES_EXHAUSTED');
  assert.equal(await via('/one_cut_cast_vote', 'GROUP_STALE', { action: 'vote', takeNo: 1, choice: 1 }, voting), '409:GROUP_STALE');
});

test('M2: a state read is ONE rpc plus the room / member lookups, and never touches the game tables', async () => {
  for (const [phase, take] of [['brief', baseTake()], ['take', live('take', { cut_at: iso(3000) })], ['vote', live('vote')], ['result', live('result')]]) {
    const h = harness({ game: { phase }, takes: [take], votes: [{ voter_id: aId, choice: 0 }] });
    await stateOf(h, 'a-token');
    // the periodic cleanup (first read of a service instance) deletes lapsed rows; it is not part of the read itself
    const tables = h.calls.filter((c) => c.method !== 'DELETE').map((c) => c.path.replace('/rest/v1/', '').split('?')[0]);
    assert.equal(h.allRpc().length, 1, phase);
    assert.deepEqual(h.allRpc()[0], { name: 'one_cut_state', body: { p_room_id: roomId, p_member_id: aId } });
    assert.equal(tables.some((t) => /^one_cut_(games|takes|votes|likes)$/.test(t)), false, `${phase}: ${tables}`);
    assert.ok(tables.length <= 5, `${phase}: ${tables.length} requests: ${tables}`);
  }
});

test('the API shapes the snapshot and never trusts it for secrets: stray answer fields are not forwarded', async () => {
  // even a snapshot that wrongly carried an answer for a non-actor, or before the result, produces no myScene / result
  const leaky = (snap) => ({ ...snap, answerIndex: 2, myAnswerIndex: 2, answer_index: 2, votes: [{ voter_id: aId, choice: 2 }], extra: 'x' });
  for (const phase of ['brief', 'take', 'vote']) {
    const h = harness({ game: { phase }, takes: [phase === 'brief' ? baseTake({ actor_member_id: aId }) : live(phase, { actor_member_id: aId })], rawSnapshot: leaky });
    const view = await stateOf(h, 'b-token');
    assert.equal(view.myScene, null, phase); assert.equal(view.result, null, phase);
    assert.equal(/answer|extra|choice|voter_id/i.test(JSON.stringify(view)), false, `${phase}: ${JSON.stringify(view).slice(0, 200)}`);
  }
  // a snapshot with no take at all (e.g. nobody started yet) still projects
  const none = await stateOf(harness({ game: { phase: 'brief' }, takes: [], rawSnapshot: (snap) => ({ ...snap, take: null }) }), 'a-token');
  assert.deepEqual(none.options, []);
});

test('result carries only the caller\'s own outcome (correct / wrong / pass), never anyone else\'s choice', async () => {
  const votes = [{ voter_id: aId, choice: ANSWER_INDEX }, { voter_id: bId, choice: 4 }];
  const run = (token, v = votes) => stateOf(harness({ game: { phase: 'result' }, takes: [live('result')], votes: v }), token);
  assert.equal((await run('a-token')).result.myVerdict, 'correct');
  assert.equal((await run('b-token')).result.myVerdict, 'wrong');
  assert.equal((await run('b-token', [{ voter_id: bId, choice: null }])).result.myVerdict, 'pass');
  assert.equal((await run('host-token')).result.myVerdict, 'none'); // the actor
  assert.equal((await run('a-token', [])).result.myVerdict, 'none'); // did not vote
});

test('L1: serverNow is stamped when the request arrives, not after our own processing', async () => {
  let t = NOW;
  const h = harness({ game: { phase: 'brief' }, nowFn: () => { t += 40; return t; } });
  const view = await stateOf(h, 'a-token');
  assert.equal(Date.parse(view.serverNow), NOW + 40, 'the first clock read of the request');
});

test('L2: RPC refusals that only mean "your view is stale" become GROUP_STALE, not 502', async () => {
  const via = (rpc, message, action, setup) => code(harness({ ...setup, rpcError: { rpc, message } }), 'host-token', action);
  const lobby = { room: { status: 'lobby' }, game: { phase: 'lobby', take_no: 0, lap_no: 0 }, takes: [] };
  assert.equal(await via('/one_cut_start_take', 'ONE_CUT_INVALID', { action: 'start', revision: 7 }, lobby), '409:GROUP_STALE');
  assert.equal(await via('/one_cut_start_take', 'ONE_CUT_PARTICIPANTS', { action: 'start', revision: 7 }, lobby), '409:GROUP_STALE');
  assert.equal(await via('/one_cut_ready', 'ONE_CUT_INVALID', { action: 'ready', takeNo: 1 }, {}), '409:GROUP_STALE');
  assert.equal(await via('/one_cut_skip', 'ONE_CUT_INVALID', { action: 'skip', takeNo: 1 }, {}), '409:GROUP_STALE');
  // ... and they are known game codes at the room level too (create)
  await assert.rejects(() => harness({ rpcError: { rpc: '/one_cut_create_room', message: 'ONE_CUT_INVALID' } }).service.create({ headers: { authorization: 'Bearer jwt' }, body: { gameType: 'one_cut', hostName: 'H' } }), (e) => e.status === 409 && e.code === 'ONE_CUT_INVALID');
});

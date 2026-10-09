import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createGroupRoomService } from '../server-side/group-rooms.mjs';
import { MISSION_ERROR_STATUS, MISSION_POLL_MS, MISSION_FINAL_WINDOW_MS, missionPollMs } from '../server-side/mission-mingle.mjs';
import { missionCards } from '../dist/data/mission-mingle-cards.js';

const roomId = '11111111-1111-4111-8111-111111111111';
const ids = ['22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333', '55555555-5555-4555-8555-555555555555', '66666666-6666-4666-8666-666666666666'];
const [hostId, aId, bId, cId] = ids;
const env = { SUPABASE_URL: 'http://127.0.0.1:54321', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test', SUPABASE_SERVICE_ROLE_KEY: 'service', NODE_ENV: 'test' };
const sha = (value) => createHash('sha256').update(value).digest('hex');
const members = [
  { id: hostId, display_name: 'ハル', role: 'host', adult_confirmed: true, joined_at: '1' },
  { id: aId, display_name: 'アオイ', role: 'guest', adult_confirmed: false, joined_at: '2' },
  { id: bId, display_name: 'ボブ', role: 'guest', adult_confirmed: false, joined_at: '3' },
  { id: cId, display_name: 'チカ', role: 'guest', adult_confirmed: false, joined_at: '4' }
];
const tokens = { 'host-token': members[0], 'a-token': members[1], 'b-token': members[2], 'c-token': members[3] };
const NOW = Date.parse('2026-10-09T01:00:00.000Z');
const baseRoom = { id: roomId, host_user_id: hostId, game_type: 'mission_mingle', status: 'playing', revision: 7, expires_at: '2099-01-01T00:00:00.000Z', cards: [], member_count: 4, cursor: 0, revealed: false, answer_index: 0, invite_hash: 'x' };
const baseGame = () => ({ room_id: roomId, duration_minutes: 60, preset: 'standard', scene: 'party', seat_mode: false, phase: 'mission', started_at: '2026-10-09T00:30:00.000Z', ends_at: '2026-10-09T01:30:00.000Z', extensions: 0, reveal_order: [aId, hostId, cId, bId], reveal_cursor: 0 });

// three missions per member, all distinct ids; named ones aim at the next member in the list
const byText = (predicate) => missionCards.filter(predicate);
const namedCards = byText((card) => card.target === 'named' && card.scenes.includes('party'));
const plainCards = byText((card) => card.target === 'anyone' && card.scenes.includes('party'));
const row = (n, memberId, slot, card, extra = {}) => ({ id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, room_id: roomId, member_id: memberId, slot, mission_id: card.id, difficulty: card.difficulty, topic: card.topic, target_member_id: card.target === 'named' ? ids[(ids.indexOf(memberId) + 1) % 4] : null, status: 'active', ...extra });
function baseAssignments() {
  const out = []; let n = 1; let named = 0; let plain = 0;
  for (const memberId of ids) for (const slot of [1, 2, 3]) {
    const card = slot === 3 ? plainCards[plain++] : namedCards[named++];
    out.push(row(n++, memberId, slot, { ...card, difficulty: slot }));
  }
  return out;
}
const textOf = (assignment) => missionCards.find((card) => card.id === assignment.mission_id).text;

// A minimal in-memory PostgREST that honours eq./in. filters and the select= column list, so a column the code never asks for never comes back.
function harness({ room = {}, game = {}, noGame = false, kept = null, assignments = baseAssignments(), swaps = [], rpcError = null, expireTo = null, clock = NOW, roster = members } = {}) {
  const calls = [];
  const state = { room: { ...baseRoom, ...room }, game: { ...baseGame(), ...game }, assignments, swaps, clock, kept };
  const json = (data, status = 200) => new Response(JSON.stringify(data), { status });
  const project = (rows, select) => { const columns = (select || '*').split(','); return columns.includes('*') ? rows : rows.map((item) => Object.fromEntries(columns.filter((column) => column in item).map((column) => [column, item[column]]))); };
  const matches = (item, params) => [...params.entries()].every(([key, value]) => {
    if (['select', 'order', 'limit'].includes(key)) return true;
    if (value.startsWith('eq.')) return String(item[key]) === value.slice(3);
    if (value.startsWith('in.(')) return value.slice(4, -1).split(',').includes(String(item[key]));
    return true;
  });
  const fetchImpl = async (url, options = {}) => {
    const u = new URL(url); const path = u.pathname; const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ path, method: options.method || 'GET', search: decodeURIComponent(u.search), body });
    if (path === '/auth/v1/user') return json({ id: hostId, is_anonymous: false });
    if (path.includes('/rpc/')) {
      if (rpcError && path.endsWith(rpcError.rpc)) { const failure = typeof rpcError.times === 'number' ? rpcError.times-- > 0 : true; if (failure) return json({ message: rpcError.message }, 400); }
      if (path.endsWith('/mission_expire') && expireTo) { state.game = { ...state.game, phase: expireTo }; state.room = { ...state.room, revision: state.room.revision + 1 }; }
      return json(path.endsWith('_create_room') ? [{ room_id: roomId, host_member_id: hostId }] : null);
    }
    if (path.includes('/group_rooms')) return json([state.room]);
    if (path.includes('/group_members') && u.searchParams.get('secret_hash')) {
      const found = Object.entries(tokens).find(([token]) => `eq.${sha(token)}` === u.searchParams.get('secret_hash'));
      return json(found ? [found[1]] : []);
    }
    if (path.includes('/group_members')) return json(roster);
    if (path.includes('/venue_tables')) return json([{ id: 1, venues: { active: true } }]);
    if (path.includes('/mission_results')) return options.method === 'DELETE' ? json([]) : json(state.kept ? [state.kept] : []);
    if (path.includes('/mission_games')) return json(noGame ? [] : project([state.game], u.searchParams.get('select')));
    if (path.includes('/mission_assignments')) return json(project(state.assignments.filter((item) => matches(item, u.searchParams)), u.searchParams.get('select')));
    if (path.includes('/mission_swaps')) return json(project(state.swaps.filter((item) => matches(item, u.searchParams)), u.searchParams.get('select')));
    return json([]);
  };
  const service = createGroupRoomService({ env, fetchImpl, now: () => state.clock });
  const rpcCalls = () => calls.filter((call) => call.path.includes('/rpc/')).map((call) => ({ name: call.path.split('/rpc/')[1], body: call.body }));
  return { service, state, calls, rpcCalls };
}
const asMember = (token, body) => ({ headers: { 'x-group-member-token': token }, body });
const stateOf = async (h, token) => (await h.service.state({ headers: { 'x-group-member-token': token } }, roomId)).mission;
const codeOf = (promise) => promise.then(() => null, (error) => error.code);
const strip = (mission) => { const { serverNow, ...rest } = mission; return rest; };

test('during the mission phase a member sees only their own three missions, with the target name filled in', async () => {
  const h = harness();
  const all = h.state.assignments;
  for (const [token, memberId] of [['host-token', hostId], ['a-token', aId], ['b-token', bId], ['c-token', cId]]) {
    const response = await h.service.state({ headers: { 'x-group-member-token': token } }, roomId);
    const mine = all.filter((item) => item.member_id === memberId);
    assert.deepEqual(response.mission.myMissions.map((item) => item.missionId), mine.map((item) => item.mission_id), token);
    const raw = JSON.stringify(response);
    for (const other of all.filter((item) => item.member_id !== memberId)) {
      assert.equal(raw.includes(other.mission_id), false, `${token} must not see ${other.mission_id}`);
      assert.equal(raw.includes(other.id), false, `${token} must not see assignment ${other.id}`);
    }
    assert.equal(raw.includes('{target}'), false);
  }
  const named = (await stateOf(h, 'a-token')).myMissions.find((item) => /ボブ/.test(item.text));
  assert.ok(named, 'the named target is replaced by the display name (a -> next member = ボブ)');
  assert.equal(h.state.assignments.every((item) => !('text' in item)), true, 'the database never holds a mission text');
});

test('the representative sees only their own missions too, and no global progress is ever returned in the mission phase', async () => {
  const quiet = harness();
  const busy = harness({ assignments: baseAssignments().map((item, i) => (i % 2 ? { ...item, status: i % 4 === 1 ? 'achieved' : 'passed' } : item)) });
  for (const token of ['host-token', 'b-token']) {
    const a = await stateOf(quiet, token); const b = await stateOf(busy, token);
    assert.equal(a.reveal, null); assert.equal(a.summary, null); assert.equal(b.reveal, null); assert.equal(b.summary, null);
    assert.equal(JSON.stringify(a).includes('achievedTotal'), false);
    // somebody else's taps change nothing in what this member can see about the others
    assert.deepEqual(a.myMissions.map((item) => item.missionId), b.myMissions.map((item) => item.missionId));
  }
  // one member's own state changes only through their own rows
  const mine = (await stateOf(busy, 'a-token')).myMissions;
  assert.ok(mine.every((item) => ['active', 'achieved', 'passed'].includes(item.status)));
  // the database is asked for no achievement list and no other member's rows in this phase
  const asked = busy.calls.filter((call) => call.path.includes('/mission_assignments')).map((call) => call.search);
  assert.ok(asked.length > 0);
  assert.ok(asked.every((search) => /member_id=eq\./.test(search) && !/status=eq\.achieved/.test(search) && !/\btopic\b/.test(search)), asked.join(' | '));
});

test('reveal returns only people the reveal has reached and only what they achieved (never active, passed or swapped missions)', async () => {
  const rows = baseAssignments();
  // order is [a, host, c, b]; mark one of each status for several people
  const statusFor = (item) => {
    if (item.member_id === aId) return item.slot === 1 ? 'achieved' : item.slot === 2 ? 'passed' : 'active';
    if (item.member_id === hostId) return item.slot === 3 ? 'achieved' : item.slot === 1 ? 'swapped' : 'active';
    if (item.member_id === cId) return 'achieved';
    return item.slot === 1 ? 'achieved' : 'active';
  };
  const withStatus = rows.map((item) => ({ ...item, status: statusFor(item) }));
  const h = harness({ game: { phase: 'reveal', reveal_cursor: 1 }, assignments: withStatus });
  const view = await stateOf(h, 'b-token');
  assert.equal(view.reveal.cursor, 1); assert.equal(view.reveal.total, 4);
  assert.equal(view.reveal.current.memberId, hostId);
  assert.equal(view.reveal.current.name, 'ハル');
  assert.deepEqual(view.reveal.revealed.map((person) => person.memberId), [aId, hostId], 'up to and including the person being revealed');
  assert.equal(view.reveal.revealed[0].missions.length, 1, 'a achieved exactly one');
  assert.equal(view.reveal.current.missions.length, 1, 'host: slot 3 achieved, the swapped and active ones stay hidden');
  const raw = JSON.stringify(view);
  const nameOf = (id) => members.find((m) => m.id === id)?.display_name || '誰か';
  const rendered = (item) => textOf(item).replaceAll('{target}', nameOf(item.target_member_id));
  const hidden = withStatus.filter((item) => item.status !== 'achieved' || [cId, bId].includes(item.member_id));
  for (const item of hidden) assert.equal(raw.includes(rendered(item)), false, `${item.mission_id} (${item.status}) must not leak`);
  const shown = withStatus.filter((item) => item.status === 'achieved' && [aId, hostId].includes(item.member_id));
  for (const item of shown) assert.equal(raw.includes(rendered(item)), true, `${item.mission_id} is revealed`);
  assert.equal(raw.includes('mission-'), false, 'catalog ids are not needed to show a revealed mission');
  assert.equal(view.myMissions, null, 'own list is not needed once the reveal runs');
  assert.equal(view.summary, null);
  assert.equal(view.reveal.revealed.some((person) => [cId, bId].includes(person.memberId)), false);
  const queries = h.calls.filter((call) => call.path.includes('/mission_assignments')).map((call) => call.search);
  assert.equal(queries.length, 1);
  assert.match(queries[0], /status=eq\.achieved/);
  assert.ok(queries[0].includes(`member_id=in.(${aId},${hostId})`), queries[0]);
  assert.equal(/\btopic\b/.test(queries[0]), false);
});

test('a person with nothing achieved is revealed with an empty list', async () => {
  const rows = baseAssignments().map((item) => ({ ...item, status: item.member_id === bId ? 'passed' : item.member_id === cId ? 'active' : 'achieved' }));
  const mid = await stateOf(harness({ game: { phase: 'reveal', reveal_cursor: 3 }, assignments: rows }), 'a-token');
  assert.equal(mid.reveal.current.memberId, bId); assert.deepEqual(mid.reveal.current.missions, []);
});

const KEPT_ROW = (extra = {}) => ({
  result: {
    achievedTotal: 6,
    members: {
      [hostId]: { achieved: 3, titles: ['ナチュラル・スパイ', '聞き上手'] },
      [aId]: { achieved: 3, titles: ['ナチュラル・スパイ'] },
      [bId]: { achieved: 0, titles: [] },
      [cId]: { achieved: 0, titles: [] }
    }
  },
  result_expires_at: '2026-10-09T01:05:00.000Z', ...extra
});

test('the summary shows only the achieved total and the viewer’s OWN count and titles -- nobody else’s, and no mission text', async () => {
  const at = { clock: Date.parse('2026-10-09T01:02:00.000Z') };
  for (const [token, id, mine] of [['host-token', hostId, 3], ['a-token', aId, 3], ['b-token', bId, 0]]) {
    const h = harness({ room: { status: 'ended' }, noGame: true, kept: KEPT_ROW(), ...at });
    const response = await h.service.state({ headers: { 'x-group-member-token': token } }, roomId);
    const view = response.mission;
    assert.equal(view.phase, 'summary'); assert.equal(view.pollMs, 0);
    assert.deepEqual(Object.keys(view.summary).sort(), ['achievedTotal', 'myAchieved', 'myTitles']);
    assert.equal(view.summary.achievedTotal, 6);
    assert.equal(view.summary.myAchieved, mine, token);
    assert.deepEqual(view.summary.myTitles, KEPT_ROW().result.members[id].titles, token);
    assert.equal(view.reveal, null, 'nobody’s missions are served any more'); assert.equal(view.myMissions, null);
    const raw = JSON.stringify(view);
    for (const other of ids) assert.equal(raw.includes(other), false, `${token}: the mission part names nobody (${other})`);
    assert.equal(/"members"|"achieved"|mission-\d/.test(raw), false, token);
    assert.equal(view.resultExpiresAt, '2026-10-09T01:05:00.000Z');
    assert.equal(h.calls.some((call) => call.path.includes('mission_assignments')), false, 'the assignment table is not even read');
  }
  assert.deepEqual((await stateOf(harness({ room: { status: 'ended' }, noGame: true, kept: KEPT_ROW(), ...at }), 'b-token')).summary.myTitles, [], 'a member with nothing achieved gets no title');
});

test('after result_expires_at the summary row is deleted and the state is the minimal ended response', async () => {
  const h = harness({ room: { status: 'ended' }, noGame: true, kept: KEPT_ROW(), clock: Date.parse('2026-10-09T01:05:00.001Z') });
  const ended = await stateOf(h, 'a-token');
  assert.equal(ended.phase, 'ended'); assert.equal(ended.summary, null); assert.equal(ended.reveal, null); assert.equal(ended.pollMs, 0);
  assert.ok(h.calls.some((call) => call.method === 'DELETE' && call.path.endsWith('/mission_results') && call.search.includes('room_id=eq.') && call.search.includes('result_expires_at=lte.')), 'the lapsed row is deleted on the read');
  const edge = await stateOf(harness({ room: { status: 'ended' }, noGame: true, kept: KEPT_ROW(), clock: Date.parse('2026-10-09T01:04:59.999Z') }), 'a-token');
  assert.equal(edge.phase, 'summary', 'one millisecond before the limit it is still served');
  assert.equal((await stateOf(harness({ room: { status: 'ended' }, noGame: true }), 'a-token')).phase, 'ended', 'a game finished early keeps nothing');
});

test('the last reveal_next carries the summary built from the achieved rows (own titles from the catalog); earlier ones carry none', async () => {
  const rows = baseAssignments().map((item) => ({ ...item, status: item.member_id === hostId ? 'achieved' : item.member_id === aId && item.slot === 1 ? 'achieved' : 'active' }));
  const last = harness({ game: { phase: 'reveal', reveal_cursor: 3 }, assignments: rows });
  await last.service.action(asMember('host-token', { action: 'reveal_next', cursor: 3 }), roomId);
  const call = last.rpcCalls().at(-1);
  assert.equal(call.name, 'mission_reveal_next');
  assert.equal(call.body.p_result.achievedTotal, 4);
  assert.deepEqual(Object.keys(call.body.p_result.members).sort(), [...ids].sort());
  assert.equal(call.body.p_result.members[hostId].achieved, 3); assert.equal(call.body.p_result.members[aId].achieved, 1);
  assert.equal(call.body.p_result.members[bId].achieved, 0); assert.deepEqual(call.body.p_result.members[bId].titles, []);
  assert.ok(call.body.p_result.members[hostId].titles.includes('ナチュラル・スパイ'));
  assert.deepEqual(Object.keys(call.body.p_result).sort(), ['achievedTotal', 'members']);
  assert.equal(JSON.stringify(call.body.p_result).includes('mission-'), false, 'no catalog id or text is stored');
  const mid = harness({ game: { phase: 'reveal', reveal_cursor: 1 }, assignments: rows });
  await mid.service.action(asMember('host-token', { action: 'reveal_next', cursor: 1 }), roomId);
  assert.equal('p_result' in mid.rpcCalls().at(-1).body, false);
});

test('polling hints: 1s in the lobby and from the end onward, 30s while on a mission, 5s in the last minute, stopped once ended', async () => {
  const at = (iso) => ({ clock: Date.parse(iso) });
  const hint = async (opts, token = 'a-token') => (await stateOf(harness(opts), token)).pollMs;
  assert.equal(await hint({ ...at('2026-10-09T01:00:00.000Z') }), 30000, 'mission, half an hour left');
  assert.equal(await hint({ ...at('2026-10-09T01:29:00.000Z') }), 5000, 'exactly 60s before the end');
  assert.equal(await hint({ ...at('2026-10-09T01:29:30.000Z') }), 5000);
  assert.equal(await hint({ ...at('2026-10-09T01:28:59.000Z') }), 30000);
  assert.equal(await hint({ game: { phase: 'reveal_ready' } }), 1000);
  assert.equal(await hint({ game: { phase: 'reveal', reveal_cursor: 0 } }), 1000);
  assert.equal(await hint({ room: { status: 'ended' }, game: { phase: 'summary', reveal_cursor: 4 } }), 0, 'the summary is a frozen frame: no polling');
  assert.equal(await hint({ room: { status: 'ended' } }), 0);
  const lobby = harness({ room: { status: 'lobby', member_count: 2 }, game: { phase: 'lobby', started_at: null, ends_at: null } });
  const lobbyState = await stateOf(lobby, 'a-token');
  assert.equal(lobbyState.pollMs, 1000); assert.equal(lobbyState.phase, 'lobby');
  assert.deepEqual(lobbyState.settings, { durationMinutes: 60, preset: 'standard', scene: 'party', seatMode: false });
  assert.equal(missionPollMs('mission', NOW - 1, NOW), MISSION_POLL_MS.missionOverdue, 'an overdue game that has not flipped yet is polled quickly');
  assert.equal(MISSION_FINAL_WINDOW_MS, 60000);
});

test('every hint keeps a member far below the 180 requests/minute per-member state limit, and a whole 8-person hour stays small', () => {
  for (const [name, ms] of Object.entries(MISSION_POLL_MS)) { if (ms > 0) assert.ok(60000 / ms <= 180, `${name}: ${60000 / ms}/min`); }
  // 8 members: 2 min lobby + 60 min mission (30s, 5s over the last minute) + 5 min reveal/summary at the hinted intervals
  const perMember = (2 * 60000) / MISSION_POLL_MS.lobby + (59 * 60000) / MISSION_POLL_MS.mission + MISSION_FINAL_WINDOW_MS / MISSION_POLL_MS.missionFinal + (5 * 60000) / MISSION_POLL_MS.reveal;
  assert.ok(perMember * 8 < 8 * 600, `unexpectedly many state requests: ${perMember * 8}`);
  // the mission phase itself is a small fraction of what 1s polling would cost
  const missionOnly = (59 * 60000) / MISSION_POLL_MS.mission + MISSION_FINAL_WINDOW_MS / MISSION_POLL_MS.missionFinal;
  assert.ok(missionOnly < (60 * 60) / 20);
});

test('a state read costs exactly one room fetch and one members fetch (no duplicate getRoom)', async () => {
  const h = harness();
  await stateOf(h, 'a-token');
  assert.equal(h.calls.filter((call) => call.path.includes('/group_rooms') && call.method === 'GET').length, 1, 'state() itself loads the room once and the projector reuses it');
  assert.equal(h.calls.filter((call) => call.path.includes('/group_members') && !call.search.includes('secret_hash')).length, 1);
});

test('a due mission phase is advanced lazily by the idempotent expiry RPC and the state then shows reveal_ready', async () => {
  const h = harness({ clock: Date.parse('2026-10-09T01:30:01.000Z'), expireTo: 'reveal_ready' });
  const view = await stateOf(h, 'a-token');
  assert.deepEqual(h.rpcCalls().map((call) => call.name), ['mission_expire']);
  assert.equal(view.phase, 'reveal_ready');
  assert.equal(view.revealOpenAt, '2026-10-09T01:33:00.000Z', 'anyone may start 3 minutes after the real end time');
  assert.equal(view.myMissions.length, 3, 'the last-chance tap window keeps the own list');
  assert.equal(view.swapsLeft, 0);
  // an expiry that fails must not break reading
  const failing = harness({ clock: Date.parse('2026-10-09T01:30:01.000Z'), rpcError: { rpc: '/mission_expire', message: 'boom' } });
  assert.equal((await stateOf(failing, 'a-token')).phase, 'mission');
});

test('own taps skip the revision; every whole-game action needs it; guests are refused host actions with MISSION_NOT_OWNER (403)', async () => {
  const a1 = baseAssignments().find((item) => item.member_id === aId && item.slot === 1);
  for (const action of ['achieve', 'unachieve', 'pass']) {
    const h = harness();
    await h.service.action(asMember('a-token', { action, assignmentId: a1.id }), roomId);
    const call = h.rpcCalls().at(-1);
    assert.equal(call.name, 'mission_set_status');
    assert.equal(call.body.p_member_id, aId);
    assert.equal(call.body.p_status, { achieve: 'achieved', unachieve: 'active', pass: 'passed' }[action]);
  }
  const refuse = (token, body) => codeOf(harness().service.action(asMember(token, body), roomId));
  for (const action of ['configure', 'start', 'extend', 'end_now']) {
    const body = { action, revision: 7, ...(action === 'configure' ? { settings: { preset: 'hard' } } : {}) };
    assert.equal(await refuse('a-token', body), 'MISSION_NOT_OWNER', action);
    await assert.rejects(() => harness().service.action(asMember('a-token', body), roomId), (error) => error.status === 403);
  }
  assert.equal(MISSION_ERROR_STATUS.MISSION_NOT_OWNER, 403);
  // only start carries the revision; every other representative action is guarded by its phase instead
  const lobby = () => harness({ room: { status: 'lobby' }, game: { phase: 'lobby' } });
  assert.equal(await codeOf(lobby().service.action(asMember('host-token', { action: 'start', revision: 6 }), roomId)), 'GROUP_STALE', 'start: stale revision');
  assert.equal(await codeOf(lobby().service.action(asMember('host-token', { action: 'start' }), roomId)), 'GROUP_STALE', 'start: missing revision');
  for (const [action, opts] of [['extend', {}], ['end_now', {}], ['configure', { room: { status: 'lobby' }, game: { phase: 'lobby' } }]]) {
    const h = harness(opts);
    assert.equal(await codeOf(h.service.action(asMember('host-token', { action, settings: { durationMinutes: 30 } }), roomId)), null, `${action}: no revision needed`);
    assert.equal(h.rpcCalls().at(-1).body.p_expected_revision, null);
  }
  assert.equal(await codeOf(lobby().service.action(asMember('host-token', { action: 'start', revision: 7 }), roomId)), null);
  assert.equal(await refuse('host-token', { action: 'bogus', revision: 7 }), 'INVALID_REQUEST');
  assert.equal(await refuse('a-token', { action: 'achieve', assignmentId: 'not-a-uuid' }), 'INVALID_REQUEST');
});

test('phase guards: actions outside their phase are MISSION_PHASE (409)', async () => {
  const id = baseAssignments()[0].id;
  const code = (opts, token, body) => codeOf(harness(opts).service.action(asMember(token, body), roomId));
  assert.equal(await code({ game: { phase: 'reveal', reveal_cursor: 0 } }, 'a-token', { action: 'achieve', assignmentId: id }), 'MISSION_PHASE', 'no more recording once the reveal began');
  assert.equal(await code({ game: { phase: 'reveal_ready' } }, 'a-token', { action: 'swap', assignmentId: id }), 'MISSION_PHASE', 'no swap after the end');
  assert.equal(await code({ game: { phase: 'reveal_ready' } }, 'a-token', { action: 'achieve', assignmentId: baseAssignments().find((item) => item.member_id === aId).id }), null, 'recording stays open until the reveal starts');
  assert.equal(await code({ game: { phase: 'mission' } }, 'host-token', { action: 'reveal_start', revision: 7 }), 'MISSION_PHASE');
  assert.equal(await code({ game: { phase: 'mission' } }, 'host-token', { action: 'reveal_next', revision: 7 }), 'MISSION_PHASE');
  assert.equal(await code({ room: { status: 'lobby' }, game: { phase: 'lobby' } }, 'host-token', { action: 'extend', revision: 7 }), 'MISSION_PHASE');
  assert.equal(await code({ room: { status: 'ended' } }, 'host-token', { action: 'finish', revision: 7 }), 'GROUP_ENDED');
});

test('start deals three missions per member that satisfy the hard rules, and fixes a reveal order of everyone', async () => {
  const h = harness({ room: { status: 'lobby' }, game: { phase: 'lobby', preset: 'hard', scene: 'business', seat_mode: false, started_at: null, ends_at: null } });
  await h.service.action(asMember('host-token', { action: 'start', revision: 7 }), roomId);
  const call = h.rpcCalls().find((item) => item.name === 'mission_start');
  assert.equal(call.body.p_member_id, hostId); assert.equal(call.body.p_expected_revision, 7);
  const deal = call.body.p_assignments;
  assert.equal(deal.length, 12);
  assert.equal(new Set(deal.map((item) => item.missionId)).size, 12);
  for (const memberId of ids) assert.deepEqual(deal.filter((item) => item.memberId === memberId).map((item) => item.difficulty), [2, 3, 3]);
  assert.ok(deal.every((item) => item.targetMemberId !== item.memberId));
  assert.deepEqual([...call.body.p_reveal_order].sort(), [...ids].sort());
  assert.equal(JSON.stringify(call.body).includes('text'), false, 'no mission text is sent to the database');
  // fewer than three people
  const small = harness({ room: { status: 'lobby', member_count: 2 }, game: { phase: 'lobby' }, roster: members.slice(0, 2) });
  assert.equal(await codeOf(small.service.action(asMember('host-token', { action: 'start', revision: 7 }), roomId)), 'GROUP_PARTICIPANTS');
  assert.equal(small.rpcCalls().length, 0);
  assert.equal(await codeOf(harness({ room: { status: 'playing' }, game: { phase: 'mission' } }).service.action(asMember('host-token', { action: 'start', revision: 7 }), roomId)), 'MISSION_PHASE');
});

test('configure validates settings (400) and forwards only what was given', async () => {
  const lobby = () => harness({ room: { status: 'lobby' }, game: { phase: 'lobby' } });
  const h = lobby();
  await h.service.action(asMember('host-token', { action: 'configure', revision: 7, settings: { durationMinutes: 120, seatMode: true } }), roomId);
  assert.deepEqual(h.rpcCalls().at(-1).body.p_settings, { durationMinutes: 120, seatMode: true });
  for (const settings of [{ durationMinutes: 45 }, { preset: 'extreme' }, { scene: 'hell' }, { seatMode: 'yes' }, { other: 1 }, [], null, {}]) {
    assert.equal(await codeOf(lobby().service.action(asMember('host-token', { action: 'configure', revision: 7, settings }), roomId)), 'INVALID_REQUEST', JSON.stringify(settings));
  }
});

test('extend is +15 only, at most twice, and the representative-only end_now / reveal_start rules hold', async () => {
  const h = harness();
  await h.service.action(asMember('host-token', { action: 'extend', revision: 7, minutes: 15 }), roomId);
  assert.deepEqual(h.rpcCalls().at(-1).body, { p_room_id: roomId, p_member_id: hostId, p_minutes: 15, p_expected_revision: null });
  assert.equal(await codeOf(harness().service.action(asMember('host-token', { action: 'extend', revision: 7, minutes: 30 }), roomId)), 'INVALID_REQUEST');
  assert.equal(await codeOf(harness({ game: { extensions: 2 } }).service.action(asMember('host-token', { action: 'extend', revision: 7 }), roomId)), 'MISSION_EXTEND_LIMIT');
  // reveal_start: guests only after the 3 minute grace following the real end time
  const early = harness({ game: { phase: 'reveal_ready' }, clock: Date.parse('2026-10-09T01:32:59.000Z') });
  assert.equal(await codeOf(early.service.action(asMember('a-token', { action: 'reveal_start', revision: 7 }), roomId)), 'MISSION_NOT_OWNER');
  await assert.rejects(() => early.service.action(asMember('a-token', { action: 'reveal_start', revision: 7 }), roomId), (error) => error.status === 403);
  const late = harness({ game: { phase: 'reveal_ready' }, clock: Date.parse('2026-10-09T01:33:00.000Z') });
  assert.equal(await codeOf(late.service.action(asMember('a-token', { action: 'reveal_start', revision: 7 }), roomId)), null);
  assert.equal(late.rpcCalls().at(-1).name, 'mission_reveal_start');
  assert.equal(await codeOf(early.service.action(asMember('host-token', { action: 'reveal_start', revision: 7 }), roomId)), null, 'the representative can always start');
});

test('swap: once per member, only your own active mission, a fresh card of the same difficulty', async () => {
  const mine = baseAssignments().find((item) => item.member_id === aId && item.slot === 2);
  const h = harness();
  await h.service.action(asMember('a-token', { action: 'swap', assignmentId: mine.id }), roomId);
  const call = h.rpcCalls().find((item) => item.name === 'mission_swap');
  assert.equal(call.body.p_member_id, aId); assert.equal(call.body.p_assignment_id, mine.id);
  assert.equal(call.body.p_new.difficulty, mine.difficulty);
  assert.equal(h.state.assignments.some((item) => item.mission_id === call.body.p_new.missionId), false, 'never an id already dealt in this room');
  assert.notEqual(call.body.p_new.targetMemberId, aId);
  assert.equal(await codeOf(harness({ swaps: [{ room_id: roomId, member_id: aId, used: 1 }] }).service.action(asMember('a-token', { action: 'swap', assignmentId: mine.id }), roomId)), 'MISSION_SWAP_LIMIT');
  const theirs = baseAssignments().find((item) => item.member_id === bId);
  assert.equal(await codeOf(harness().service.action(asMember('a-token', { action: 'swap', assignmentId: theirs.id }), roomId)), 'FORBIDDEN');
  const done = baseAssignments().map((item) => (item.id === mine.id ? { ...item, status: 'achieved' } : item));
  assert.equal(await codeOf(harness({ assignments: done }).service.action(asMember('a-token', { action: 'swap', assignmentId: mine.id }), roomId)), 'MISSION_UNAVAILABLE');
  // a concurrent swap took the drawn id: the server draws again once, then gives up
  const racing = harness({ rpcError: { rpc: '/mission_swap', message: 'MISSION_POOL_EXHAUSTED', times: 1 } });
  assert.equal(await codeOf(racing.service.action(asMember('a-token', { action: 'swap', assignmentId: mine.id }), roomId)), null);
  assert.equal(racing.rpcCalls().filter((item) => item.name === 'mission_swap').length, 2);
  const stuck = harness({ rpcError: { rpc: '/mission_swap', message: 'MISSION_POOL_EXHAUSTED' } });
  assert.equal(await codeOf(stuck.service.action(asMember('a-token', { action: 'swap', assignmentId: mine.id }), roomId)), 'MISSION_POOL_EXHAUSTED');
  assert.equal(stuck.rpcCalls().filter((item) => item.name === 'mission_swap').length, 3);
});

test('swap is refused after the end even if the phase row has not flipped yet', async () => {
  const mine = baseAssignments().find((item) => item.member_id === aId);
  const h = harness({ clock: Date.parse('2026-10-09T01:30:05.000Z'), expireTo: 'reveal_ready' });
  assert.equal(await codeOf(h.service.action(asMember('a-token', { action: 'swap', assignmentId: mine.id }), roomId)), 'MISSION_PHASE');
  assert.equal(h.rpcCalls()[0].name, 'mission_expire');
});

test('RPC errors map through the game table: statuses, and stale-payload codes become a refetch (409 GROUP_STALE)', async () => {
  const run = (message) => harness({ rpcError: { rpc: '/mission_end_now', message } }).service.action(asMember('host-token', { action: 'end_now', revision: 7 }), roomId).then(() => null, (error) => [error.status, error.code]);
  assert.deepEqual(await run('MISSION_PHASE'), [409, 'MISSION_PHASE']);
  assert.deepEqual(await run('MISSION_NOT_OWNER'), [403, 'MISSION_NOT_OWNER']);
  assert.deepEqual(await run('MISSION_SWAP_LIMIT'), [409, 'MISSION_SWAP_LIMIT']);
  assert.deepEqual(await run('MISSION_EXTEND_LIMIT'), [409, 'MISSION_EXTEND_LIMIT']);
  assert.deepEqual(await run('MISSION_POOL_EXHAUSTED'), [409, 'MISSION_POOL_EXHAUSTED']);
  assert.deepEqual(await run('MISSION_UNAVAILABLE'), [409, 'MISSION_UNAVAILABLE']);
  assert.deepEqual(await run('MISSION_INVALID'), [409, 'GROUP_STALE']);
  assert.deepEqual(await run('MISSION_PARTICIPANTS'), [409, 'GROUP_STALE']);
  assert.deepEqual(await run('FORBIDDEN'), [403, 'FORBIDDEN']);
  assert.deepEqual(await run('GROUP_STALE'), [409, 'GROUP_STALE']);
  assert.deepEqual(await run('GROUP_EXPIRED'), [410, 'GROUP_EXPIRED']);
  assert.deepEqual(await run('something else'), [502, 'GROUP_UNAVAILABLE']);
});

test('create: settings are validated, deck / set / pairs are refused, seat missions default on only for a table QR', async () => {
  const req = (body) => ({ headers: { authorization: 'Bearer jwt' }, body });
  const create = async (body) => { const h = harness({ room: { status: 'lobby' }, game: { phase: 'lobby' } }); const result = await h.service.create(req({ gameType: 'mission_mingle', hostName: 'ハル', ...body })); return { result, call: h.rpcCalls().find((item) => item.name === 'mission_create_room'), h }; };
  const plain = await create({});
  assert.deepEqual(plain.call.body.p_settings, { durationMinutes: 60, preset: 'standard', scene: 'party', seatMode: false });
  assert.equal(plain.result.mission.phase, 'lobby');
  assert.equal(plain.result.host, true); assert.ok(plain.result.memberToken);
  const venue = await create({ venueToken: 'a'.repeat(32), settings: { durationMinutes: 30, preset: 'easy' } });
  assert.deepEqual(venue.call.body.p_settings, { durationMinutes: 30, preset: 'easy', scene: 'party', seatMode: true });
  assert.equal(venue.h.calls.some((call) => call.path.includes('/venue_tables')), true);
  const off = await create({ venueToken: 'a'.repeat(32), settings: { seatMode: false } });
  assert.equal(off.call.body.p_settings.seatMode, false);
  for (const bad of [{ settings: { durationMinutes: 90 } }, { settings: { preset: 'x' } }, { settings: { scene: 'x' } }, { settings: { seatMode: 1 } }, { settings: { extra: true } }, { settings: 'x' }, { deckId: 'questions' }, { setId: 'abcdefabcdefabcdefabcd' }, { pairs: [] }]) {
    await assert.rejects(() => create(bad), (error) => error.status === 400 && error.code === 'INVALID_REQUEST', JSON.stringify(bad));
  }
  assert.equal(plain.result.room.gameType, 'mission_mingle');
  assert.deepEqual(Object.keys(plain.result).sort(), ['card', 'host', 'inviteToken', 'member', 'memberToken', 'mission', 'room']);
});

test('ended rooms and rooms with no game row return minimal state; no mission text rides along', async () => {
  const ended = await stateOf(harness({ room: { status: 'ended' } }), 'a-token');
  assert.equal(ended.phase, 'ended'); assert.equal(ended.myMissions, null); assert.equal(ended.pollMs, 0);
  assert.equal(JSON.stringify(ended).includes('mission-'), false);
});

test('reveal_next and finish: the representative any time, anybody else only after the real end + 3 minutes; reveal_next names its position', async () => {
  const early = Date.parse('2026-10-09T01:32:59.000Z'); const late = Date.parse('2026-10-09T01:33:00.000Z');
  const next = (token, clock, extra = {}, game = {}) => { const h = harness({ clock, game: { phase: 'reveal', reveal_cursor: 1, ...game } }); return codeOf(h.service.action(asMember(token, { action: 'reveal_next', cursor: 1, ...extra }), roomId)).then((code) => ({ code, h })); };
  assert.equal((await next('a-token', early)).code, 'MISSION_NOT_OWNER');
  assert.equal((await next('host-token', early)).code, null);
  const ok = await next('a-token', late);
  assert.equal(ok.code, null); assert.equal(ok.h.rpcCalls().at(-1).name, 'mission_reveal_next');
  assert.equal((await next('host-token', late, { cursor: undefined })).code, 'INVALID_REQUEST', 'the position is required');
  assert.equal((await next('host-token', late, { cursor: 0 })).code, 'MISSION_PHASE', 'a double tap or retry must not skip a person');
  const finish = (token, clock, game, room = {}) => { const h = harness({ clock, room, game }); return codeOf(h.service.action(asMember(token, { action: 'finish' }), roomId)).then((code) => ({ code, h })); };
  assert.equal((await finish('a-token', late, { phase: 'mission' })).code, 'MISSION_NOT_OWNER', 'never during the game');
  assert.equal((await finish('a-token', early, { phase: 'reveal', reveal_cursor: 1 })).code, 'MISSION_NOT_OWNER');
  assert.equal((await finish('a-token', late, { phase: 'reveal', reveal_cursor: 1 })).code, null);
  // a finished game has no game row any more: its 5-minute summary cannot be cut short by anyone, host included
  for (const token of ['a-token', 'host-token']) {
    for (const action of ['finish', 'reveal_next']) {
      const gone = harness({ clock: late, room: { status: 'ended' }, noGame: true, kept: KEPT_ROW({ result_expires_at: '2026-10-09T09:00:00.000Z' }) });
      assert.equal(await codeOf(gone.service.action(asMember(token, { action, cursor: 4 }), roomId)), 'GROUP_ENDED', `${token}/${action}`);
      assert.equal(gone.rpcCalls().length, 0);
    }
  }
});

test('an ended room without a kept summary is just ended; the late-finish grace time is still given during the reveal', async () => {
  assert.equal((await stateOf(harness({ room: { status: 'ended' }, game: { phase: 'mission' } }), 'a-token')).phase, 'ended');
  const rows = baseAssignments().map((item) => ({ ...item, status: item.slot === 1 ? 'achieved' : 'active' }));
  assert.ok((await stateOf(harness({ game: { phase: 'reveal', reveal_cursor: 0 }, assignments: rows }), 'a-token')).revealOpenAt);
});

test('an action that crosses the end time gets MISSION_PHASE (not a stale-revision error) so the client just reloads', async () => {
  const due = () => harness({ clock: Date.parse('2026-10-09T01:30:05.000Z'), expireTo: 'reveal_ready' });
  for (const action of ['end_now', 'extend']) {
    const h = due();
    assert.equal(await codeOf(h.service.action(asMember('host-token', { action, revision: 7 }), roomId)), 'MISSION_PHASE', action);
    assert.equal(h.rpcCalls().some((call) => call.name === 'mission_extend' || call.name === 'mission_end_now'), false);
  }
  const finish = due();
  assert.equal(await codeOf(finish.service.action(asMember('host-token', { action: 'finish', revision: 7 }), roomId)), null, 'finish is legal in every phase');
});

import { randomInt } from 'node:crypto';
import { missionCards } from '../dist/data/mission-mingle-cards.js';

// 「ミッション・ミングル」(game_type='mission_mingle'). Group-room handlers; group-rooms.mjs only dispatches here.
// Every member holds three secret missions for the whole gathering. Another member's missions, the number of missions
// anyone (or everyone) has achieved, and every pass / swap stay inside this module while the mission phase runs; at the
// reveal only the missions a member ACHIEVED are returned, and only for the people the reveal has already reached.
// Nothing about an answer is stored: assignments hold the catalog id, an optional target member, the topic tag and a status.
// Reads of mission_assignments use explicit column lists for the same reason.
// When the last person has been revealed (PO decision 2026-10-09) the whole game row is deleted at once; mission_results keeps only the
// achieved total and each member's own achieved count + titles for 5 minutes (served as phase 'summary', own figures only), then
// nothing ('ended'). The summary no longer lists anyone's missions: devices keep what the reveal showed them in memory.
const fail = (status, code) => Object.assign(new Error(code), { status, code });
const enc = encodeURIComponent;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isoOrNull = (value) => { if (!value) return null; const time = new Date(value); return Number.isNaN(time.getTime()) ? null : time.toISOString(); };

// MISSION_NOT_OWNER is the only 403; the rest are 409. Generic RPC errors (INVALID_REQUEST etc.) are mapped to MISSION_INVALID /
// MISSION_PARTICIPANTS inside the RPCs so rest() never turns them into a 502.
export const MISSION_ERROR_STATUS = Object.freeze({
  MISSION_NOT_OWNER: 403,
  MISSION_PHASE: 409,
  MISSION_SWAP_LIMIT: 409,
  MISSION_EXTEND_LIMIT: 409,
  MISSION_POOL_EXHAUSTED: 409,
  MISSION_UNAVAILABLE: 409,
  MISSION_INVALID: 409,
  MISSION_PARTICIPANTS: 409
});
export const MISSION_ERROR_CODES = Object.keys(MISSION_ERROR_STATUS);

export const MISSION_PRESETS = Object.freeze({ easy: Object.freeze([1, 1, 2]), standard: Object.freeze([1, 2, 3]), hard: Object.freeze([2, 3, 3]) });
export const MISSION_DURATIONS = Object.freeze([30, 60, 120]);
export const MISSION_SCENE_IDS = Object.freeze(['party', 'mixer', 'business']);
export const MISSION_DEFAULT_SETTINGS = Object.freeze({ durationMinutes: 60, preset: 'standard', scene: 'party', seatMode: false });
export const MISSION_SWAP_LIMIT_PER_MEMBER = 1;
export const MISSION_EXTEND_MINUTES = 15;
export const MISSION_MAX_EXTENSIONS = 2;
// Anyone may start the reveal once the representative has been idle this long after the real end time (mirrors the RPC).
export const MISSION_REVEAL_GRACE_MS = 3 * 60 * 1000;
// Polling hints returned to clients (spec 4.5). REVEAL is the one knob to raise to 2000 if a shared store Wi-Fi nears the IP-wide cap.
export const MISSION_POLL_MS = Object.freeze({ lobby: 1000, mission: 30000, missionFinal: 5000, missionOverdue: 1000, reveal: 1000, ended: 0 });
export const MISSION_FINAL_WINDOW_MS = 60 * 1000;

const HOST_ACTIONS = ['configure', 'start', 'extend', 'end_now'];
// reveal_start / reveal_next / finish: the representative, or anybody once the real end time + 3 minutes has passed (a representative who left must not stall the room;
// finish for a non-representative only during the reveal -- a finished game's summary is never cut short).
const LATE_ACTIONS = ['reveal_start', 'reveal_next', 'finish'];
export const MISSION_RESULT_TTL_MS = 5 * 60 * 1000;
// Only `start` carries the room `revision` (it must not run against a roster that changed). Everything else is made safe by the phase check
// (and, for reveal_next, by the cursor), like the other games; private taps (achieve / unachieve / pass / swap) never touch the revision.
const STRICT_REVISION = ['start'];
const ACTION_PHASES = {
  configure: ['lobby'], start: ['lobby'],
  achieve: ['mission', 'reveal_ready'], unachieve: ['mission', 'reveal_ready'], pass: ['mission', 'reveal_ready'],
  swap: ['mission'], extend: ['mission'], end_now: ['mission'],
  reveal_start: ['reveal_ready'], reveal_next: ['reveal'], finish: null
};
const GAME_COLUMNS = 'duration_minutes,preset,scene,seat_mode,phase,started_at,ends_at,extensions,reveal_order,reveal_cursor';
const MY_COLUMNS = 'id,slot,mission_id,difficulty,target_member_id,status';
const REVEAL_COLUMNS = 'member_id,slot,mission_id,difficulty,target_member_id';
const LIVE_COLUMNS = 'id,member_id,slot,mission_id,difficulty,topic,target_member_id,status';

// ---------------------------------------------------------------------------
// create / settings
// ---------------------------------------------------------------------------
// Validates a (possibly partial) settings object and returns only the keys that were given.
export function parseMissionSettings(raw) {
  if (raw === undefined) return {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw fail(400, 'INVALID_REQUEST');
  const out = {};
  for (const key of Object.keys(raw)) {
    const value = raw[key];
    if (key === 'durationMinutes') { if (!MISSION_DURATIONS.includes(value)) throw fail(400, 'INVALID_REQUEST'); out.durationMinutes = value; }
    else if (key === 'preset') { if (typeof value !== 'string' || !Object.hasOwn(MISSION_PRESETS, value)) throw fail(400, 'INVALID_REQUEST'); out.preset = value; }
    else if (key === 'scene') { if (!MISSION_SCENE_IDS.includes(value)) throw fail(400, 'INVALID_REQUEST'); out.scene = value; }
    else if (key === 'seatMode') { if (typeof value !== 'boolean') throw fail(400, 'INVALID_REQUEST'); out.seatMode = value; }
    else throw fail(400, 'INVALID_REQUEST');
  }
  return out;
}
// A table QR (venue) means seats are usually fixed, so seat missions default to ON there (spec 3.2).
export function missionInput(input) {
  const given = parseMissionSettings(input.settings);
  const settings = { ...MISSION_DEFAULT_SETTINGS, seatMode: input.venueToken !== undefined, ...given };
  return { type: 'mission_mingle', settings };
}
// The room row needs a 6..40 card array; the RPC fills it with neutral placeholders, so no mission text is built here.
export const missionSource = () => ({ id: 'mission_mingle', name: 'ミッション・ミングル', cards: [], adultOnly: false, participantRule: 'group' });
export const missionCreatePayload = ({ common, gi }) => ({ ...common, p_settings: gi.settings });

// ---------------------------------------------------------------------------
// dealing (pure; spec 3.3)
// ---------------------------------------------------------------------------
const defaultRandom = () => randomInt(2 ** 30) / 2 ** 30;
function makeRng(random = defaultRandom) {
  const int = (n) => Math.min(n - 1, Math.floor(random() * n));
  return {
    int,
    pick: (items) => items[int(items.length)],
    shuffle: (items) => { const output = [...items]; for (let i = output.length - 1; i > 0; i -= 1) { const n = int(i + 1); [output[i], output[n]] = [output[n], output[i]]; } return output; }
  };
}
// Soft constraints, relaxed in this order (S4 -> S2 -> S1 -> S3) once the stricter pass keeps failing.
//   S1 no repeated category in a member's three   S2 no repeated target in a member's three
//   S3 named-target counts differ by at most 2    S4 at most one seat mission per member
const SOFT_LEVELS = Object.freeze([
  { s1: true, s2: true, s3: true, s4: true },
  { s1: true, s2: true, s3: true, s4: false },
  { s1: true, s2: false, s3: true, s4: false },
  { s1: false, s2: false, s3: true, s4: false },
  { s1: false, s2: false, s3: false, s4: false }
]);
const ATTEMPTS_PER_LEVEL = 50;
const MAX_NAMED_SPREAD = 2;

export function eligibleMissionCards(cards, { scene, seatMode, playerCount }) {
  return cards.filter((card) => card.retired !== true && card.scenes.includes(scene) && card.minPlayers <= playerCount && (card.target !== 'seat' || seatMode === true));
}

// Cards a member may take for one slot under the hard rules (H1 unused id, H2/H3 for named) and the active soft rules.
function slotChoices({ pool, difficulty, memberId, ids, used, targetTopic, mine, soft }) {
  const choices = [];
  for (const card of pool) {
    if (card.difficulty !== difficulty || used.has(card.id)) continue;
    if (soft.s1 && mine.some((pick) => pick.card.category === card.category)) continue;
    if (soft.s4 && card.target === 'seat' && mine.some((pick) => pick.card.target === 'seat')) continue;
    if (card.target === 'named') {
      const targets = ids.filter((id) => id !== memberId && !targetTopic.has(`${id}|${card.topic}`) && (!soft.s2 || !mine.some((pick) => pick.targetMemberId === id)));
      if (targets.length) choices.push({ card, targets });
    } else choices.push({ card, targets: null });
  }
  return choices;
}

function attemptDeal({ ids, pool, preset, rng, soft, exclude }) {
  const used = new Set(exclude);
  const targetTopic = new Set();
  const namedCount = new Map(ids.map((id) => [id, 0]));
  const hands = new Map(ids.map((id) => [id, []]));
  const slotFor = new Map(ids.map((id) => [id, new Map()]));
  // hardest tier first (fewest candidates), members shuffled inside each tier
  for (const difficulty of [...new Set(preset)].sort((a, b) => b - a)) {
    const copies = preset.filter((value) => value === difficulty).length;
    for (const memberId of rng.shuffle(ids.flatMap((id) => Array.from({ length: copies }, () => id)))) {
      const mine = hands.get(memberId);
      const choices = slotChoices({ pool, difficulty, memberId, ids, used, targetTopic, mine, soft });
      if (!choices.length) return null;
      const picked = rng.pick(choices);
      let targetMemberId = null;
      if (picked.targets) {
        const fewest = Math.min(...picked.targets.map((id) => namedCount.get(id)));
        targetMemberId = rng.pick(picked.targets.filter((id) => namedCount.get(id) === fewest));
        namedCount.set(targetMemberId, namedCount.get(targetMemberId) + 1);
        targetTopic.add(`${targetMemberId}|${picked.card.topic}`);
      }
      used.add(picked.card.id);
      const taken = slotFor.get(memberId);
      const slot = preset.indexOf(difficulty) + (taken.get(difficulty) || 0) + 1;
      taken.set(difficulty, (taken.get(difficulty) || 0) + 1);
      mine.push({ card: picked.card, targetMemberId, slot });
    }
  }
  if (soft.s3) { const counts = [...namedCount.values()]; if (Math.max(...counts) - Math.min(...counts) > MAX_NAMED_SPREAD) return null; }
  return ids.flatMap((memberId) => hands.get(memberId).map((pick) => ({ memberId, slot: pick.slot, missionId: pick.card.id, difficulty: pick.card.difficulty, topic: pick.card.topic, targetMemberId: pick.targetMemberId }))).sort((a, b) => ids.indexOf(a.memberId) - ids.indexOf(b.memberId) || a.slot - b.slot);
}

// roster: [{ id }] in join order. Throws MISSION_POOL_EXHAUSTED (409) when even the relaxed rules cannot fill every slot.
// `level` is the index into SOFT_LEVELS that succeeded (0 = every soft rule held); tests use it to watch how often rules are relaxed.
export function dealMissions(args) { return dealMissionsWithLevel(args).assignments; }
export function dealMissionsWithLevel({ roster, cards = missionCards, preset, scene, seatMode = false, exclude = [], random }) {
  const slots = Array.isArray(preset) ? preset : MISSION_PRESETS[preset];
  if (!slots) throw fail(400, 'INVALID_REQUEST');
  const ids = roster.map((item) => item.id);
  const pool = eligibleMissionCards(cards, { scene, seatMode, playerCount: ids.length });
  const rng = makeRng(random);
  for (const [level, soft] of SOFT_LEVELS.entries()) {
    for (let attempt = 0; attempt < ATTEMPTS_PER_LEVEL; attempt += 1) {
      const assignments = attemptDeal({ ids, pool, preset: slots, rng, soft, exclude });
      if (assignments) return { assignments, level };
    }
  }
  throw fail(409, 'MISSION_POOL_EXHAUSTED');
}

// One replacement of the same difficulty for `assignmentId`. `assignments` are ALL rows of the room (any status): swapped and
// passed ones keep their ids unavailable (H1) but only active / achieved ones occupy a (target, topic) pair (H3).
export function dealReplacement({ roster, cards = missionCards, scene, seatMode = false, assignments, assignmentId, random }) {
  const old = assignments.find((item) => item.id === assignmentId);
  if (!old) throw fail(403, 'FORBIDDEN');
  const ids = roster.map((item) => item.id);
  const byId = new Map(cards.map((card) => [card.id, card]));
  const live = assignments.filter((item) => ['active', 'achieved'].includes(item.status) && item.id !== old.id);
  const used = new Set(assignments.map((item) => item.mission_id));
  const targetTopic = new Set(live.filter((item) => item.target_member_id).map((item) => `${item.target_member_id}|${item.topic}`));
  const mine = live.filter((item) => item.member_id === old.member_id).map((item) => ({ card: byId.get(item.mission_id) || { category: null, target: null }, targetMemberId: item.target_member_id || null }));
  const namedCount = new Map(ids.map((id) => [id, 0]));
  for (const item of live) if (item.target_member_id && namedCount.has(item.target_member_id)) namedCount.set(item.target_member_id, namedCount.get(item.target_member_id) + 1);
  const pool = eligibleMissionCards(cards, { scene, seatMode, playerCount: ids.length });
  const rng = makeRng(random);
  for (const soft of SOFT_LEVELS) {
    if (!soft.s3) continue; // the single draw balances target counts greedily; S3 as a spread limit does not apply to one card
    const choices = slotChoices({ pool, difficulty: Number(old.difficulty), memberId: old.member_id, ids, used, targetTopic, mine, soft });
    if (!choices.length) continue;
    const picked = rng.pick(choices);
    let targetMemberId = null;
    if (picked.targets) { const fewest = Math.min(...picked.targets.map((id) => namedCount.get(id))); targetMemberId = rng.pick(picked.targets.filter((id) => namedCount.get(id) === fewest)); }
    return { missionId: picked.card.id, difficulty: picked.card.difficulty, topic: picked.card.topic, targetMemberId };
  }
  throw fail(409, 'MISSION_POOL_EXHAUSTED');
}

// ---------------------------------------------------------------------------
// projection helpers
// ---------------------------------------------------------------------------
const catalog = new Map(missionCards.map((card) => [card.id, card]));
// {target} is replaced at projection time only; the database never holds a mission text.
export function renderMissionText(card, targetName) {
  if (!card) return '（この指令は表示できません）';
  return card.text.replaceAll('{target}', () => targetName || '誰か');
}
// Titles describe only the member's own achievements -- never a comparison with anyone else.
export function missionTitles(achievedCards) {
  const titles = [];
  const has = (...categories) => achievedCards.some((card) => card && categories.includes(card.category));
  if (achievedCards.length >= 3) titles.push('ナチュラル・スパイ');
  if (has('ask', 'call')) titles.push('聞き上手');
  if (has('make-say')) titles.push('合いの手マスター');
  if (has('find')) titles.push('共通点ハンター');
  if (has('connect')) titles.push('橋渡し役');
  return titles;
}
export function missionPollMs(phase, endsAtMs, nowMs) {
  if (phase === 'lobby') return MISSION_POLL_MS.lobby;
  if (phase === 'mission') {
    const left = endsAtMs - nowMs;
    if (!Number.isFinite(left)) return MISSION_POLL_MS.mission;
    return left <= 0 ? MISSION_POLL_MS.missionOverdue : left <= MISSION_FINAL_WINDOW_MS ? MISSION_POLL_MS.missionFinal : MISSION_POLL_MS.mission;
  }
  if (phase === 'ended' || phase === 'summary') return MISSION_POLL_MS.ended; // the summary is a single frozen frame: nothing left to poll for
  return MISSION_POLL_MS.reveal; // reveal_ready / reveal stay in lock-step with the representative
}
const settingsOf = (game) => ({ durationMinutes: Number(game.duration_minutes), preset: game.preset, scene: game.scene, seatMode: game.seat_mode === true });

// The kept summary of a finished game while it is within its 5 minutes, otherwise null (an expired row is deleted on the spot).
async function readResult(ctx, roomId) {
  const { rest, now } = ctx;
  const row = (await rest(`/rest/v1/mission_results?room_id=eq.${enc(roomId)}&select=result,result_expires_at`))?.[0] || null;
  if (!row) return null;
  if (Date.parse(row.result_expires_at || '') > now()) return row;
  await rest(`/rest/v1/mission_results?room_id=eq.${enc(roomId)}&result_expires_at=lte.${enc(new Date(now()).toISOString())}`, { method: 'DELETE' }).catch(() => {});
  return null;
}
// The closing summary: the achieved total for everyone, and only the caller's own count and titles.
function summaryState(base, row, memberId, list, room) {
  const kept = row.result && typeof row.result === 'object' ? row.result : {};
  const own = memberId ? kept.members?.[memberId] : null;
  return {
    ...base, phase: 'summary', memberCount: Array.isArray(list) ? list.length : Number(room.member_count || 0), pollMs: MISSION_POLL_MS.ended,
    resultExpiresAt: isoOrNull(row.result_expires_at), revealOpenAt: null, myMissions: null, reveal: null,
    summary: { achievedTotal: Number(kept.achievedTotal || 0), myAchieved: Number(own?.achieved || 0), myTitles: Array.isArray(own?.titles) ? own.titles.filter((title) => typeof title === 'string') : [] }
  };
}
// Built at the last reveal_next, from the achieved rows that are about to be deleted (the RPC re-checks the counts).
async function buildSummary(ctx, room) {
  const rows = (await ctx.rest(`/rest/v1/mission_assignments?room_id=eq.${enc(room.id)}&status=eq.achieved&select=member_id,mission_id`)) || [];
  const roster = await ctx.members(room.id);
  return { achievedTotal: rows.length, members: Object.fromEntries(roster.map((item) => {
    const own = rows.filter((row) => row.member_id === item.id).map((row) => catalog.get(row.mission_id));
    return [item.id, { achieved: own.length, titles: missionTitles(own) }];
  })) };
}

// ctx: { rest(path, options), getRoom(id), members(roomId), now() }. `list` = the room's members when the caller already loaded them.
export async function missionState(ctx, room, member, list) {
  const { rest, getRoom, now } = ctx;
  const memberId = member?.id || null;
  const readGame = async () => (await rest(`/rest/v1/mission_games?room_id=eq.${enc(room.id)}&select=${GAME_COLUMNS}`))?.[0] || null;
  const nowMs = now();
  const base = { serverNow: new Date(nowMs).toISOString() };
  let game = await readGame();
  if (!game) {
    if (room.status !== 'ended') return { ...base, phase: 'lobby', settings: { ...MISSION_DEFAULT_SETTINGS }, memberCount: Number(room.member_count || 0), pollMs: MISSION_POLL_MS.lobby, myMissions: null, reveal: null, summary: null };
    // the game row is gone after the last reveal; for 5 minutes only the closing summary is served, then a minimal 'ended'
    const kept = await readResult(ctx, room.id);
    return kept ? summaryState(base, kept, memberId, list, room) : { ...base, phase: 'ended', pollMs: MISSION_POLL_MS.ended, myMissions: null, reveal: null, summary: null };
  }
  // lazy transition: the mission phase ends at ends_at (the RPC re-checks against its own clock; idempotent, no cron)
  if (game.phase === 'mission' && Date.parse(game.ends_at || '') <= nowMs) {
    await rest('/rest/v1/rpc/mission_expire', { method: 'POST', body: JSON.stringify({ p_room_id: room.id }) }).catch(() => {});
    game = (await readGame()) || game;
    Object.assign(room, await getRoom(room.id));
  }
  if (room.status === 'ended') return { ...base, phase: 'ended', pollMs: MISSION_POLL_MS.ended, myMissions: null, reveal: null, summary: null };
  const phase = game.phase;
  const roster = list || await ctx.members(room.id);
  const nameOf = (id) => roster.find((item) => item.id === id)?.display_name || '';
  const endsAtMs = Date.parse(game.ends_at || '');
  const result = {
    ...base, phase, settings: settingsOf(game), memberCount: roster.length,
    startedAt: isoOrNull(game.started_at), endsAt: isoOrNull(game.ends_at),
    extensionsLeft: Math.max(0, MISSION_MAX_EXTENSIONS - Number(game.extensions || 0)),
    revealOpenAt: ['reveal_ready', 'reveal'].includes(phase) && Number.isFinite(endsAtMs) ? new Date(endsAtMs + MISSION_REVEAL_GRACE_MS).toISOString() : null,
    pollMs: missionPollMs(phase, endsAtMs, nowMs),
    swapsLeft: 0, myMissions: null, reveal: null, summary: null
  };
  if (phase === 'lobby') return result;
  const render = (row) => {
    const card = catalog.get(row.mission_id);
    return { text: renderMissionText(card, nameOf(row.target_member_id)), difficulty: Number(row.difficulty), ...(card?.revealNote ? { note: card.revealNote } : {}) };
  };
  if ((phase === 'mission' || phase === 'reveal_ready') && memberId) {
    const mine = (await rest(`/rest/v1/mission_assignments?room_id=eq.${enc(room.id)}&member_id=eq.${enc(memberId)}&status=in.(active,achieved,passed)&select=${MY_COLUMNS}&order=slot.asc`)) || [];
    result.myMissions = mine.map((row) => ({ assignmentId: row.id, slot: Number(row.slot), missionId: row.mission_id, ...render(row), category: catalog.get(row.mission_id)?.category || null, status: row.status }));
    if (phase === 'mission') {
      const swaps = (await rest(`/rest/v1/mission_swaps?room_id=eq.${enc(room.id)}&member_id=eq.${enc(memberId)}&select=used`))?.[0];
      result.swapsLeft = Math.max(0, MISSION_SWAP_LIMIT_PER_MEMBER - Number(swaps?.used || 0));
    }
  } else if (phase === 'mission' || phase === 'reveal_ready') result.myMissions = [];
  if (phase === 'reveal') {
    const order = Array.isArray(game.reveal_order) ? game.reveal_order : [];
    const cursor = Number(game.reveal_cursor || 0);
    // only people the reveal has reached; only what they achieved
    const reached = order.slice(0, cursor + 1);
    const rows = reached.length ? (await rest(`/rest/v1/mission_assignments?room_id=eq.${enc(room.id)}&member_id=in.(${reached.map(enc).join(',')})&status=eq.achieved&select=${REVEAL_COLUMNS}&order=slot.asc`)) || [] : [];
    const people = reached.map((id) => ({ memberId: id, name: nameOf(id), missions: rows.filter((row) => row.member_id === id).map(render) }));
    result.reveal = { cursor, total: order.length, current: people[people.length - 1] || null, revealed: people };
  }
  return result;
}

// ---------------------------------------------------------------------------
// actions
// ---------------------------------------------------------------------------
// ctx: { rest(path, options), members(roomId), getRoom(id), now() }. Performs one action; the caller re-reads and projects the state.
export async function missionAction(ctx, args) {
  try { return await runAction(ctx, args); }
  catch (error) {
    // the RPC rejected a payload built from a stale read (members / assignments changed in between): ask the client to refetch
    if (error.code === 'MISSION_INVALID' || error.code === 'MISSION_PARTICIPANTS') throw fail(409, 'GROUP_STALE');
    throw error;
  }
}
async function runAction(ctx, { room, actor, input }) {
  const { rest, members, getRoom, now } = ctx;
  const action = input.action;
  if (typeof action !== 'string' || !Object.hasOwn(ACTION_PHASES, action)) throw fail(400, 'INVALID_REQUEST');
  if (HOST_ACTIONS.includes(action) && actor.role !== 'host') throw fail(403, 'MISSION_NOT_OWNER');
  const rpc = (name, body) => rest(`/rest/v1/rpc/${name}`, { method: 'POST', body: JSON.stringify({ p_room_id: room.id, ...body }) });
  const readGame = async () => (await rest(`/rest/v1/mission_games?room_id=eq.${enc(room.id)}&select=${GAME_COLUMNS}`))?.[0] || null;
  let game = await readGame();
  if (!game) throw fail(409, room.status === 'ended' ? 'GROUP_ENDED' : 'MISSION_UNAVAILABLE');
  if (room.status === 'ended') throw fail(409, 'GROUP_ENDED');
  if (game.phase === 'mission' && Date.parse(game.ends_at || '') <= now()) {
    await rpc('mission_expire', {}).catch(() => {});
    game = (await readGame()) || game;
    Object.assign(room, await getRoom(room.id)); // the expiry moved the revision; a stale host request then fails below
  }
  if (STRICT_REVISION.includes(action) && (!Number.isInteger(input.revision) || input.revision !== Number(room.revision))) throw fail(409, 'GROUP_STALE');
  const allowed = ACTION_PHASES[action];
  if (allowed && !allowed.includes(game.phase)) throw fail(409, 'MISSION_PHASE');
  const revision = action === 'start' ? Number(room.revision) : null;
  // late rule: not the representative -> only after the real end time + 3 minutes (finish: only during the reveal)
  if (LATE_ACTIONS.includes(action) && actor.role !== 'host' && (now() < Date.parse(game.ends_at || '') + MISSION_REVEAL_GRACE_MS || (action === 'finish' && game.phase !== 'reveal'))) throw fail(403, 'MISSION_NOT_OWNER');

  if (action === 'finish') { await rpc('mission_finish', { p_member_id: actor.id, p_expected_revision: revision }); return; }
  if (action === 'configure') {
    const settings = parseMissionSettings(input.settings);
    if (!Object.keys(settings).length) throw fail(400, 'INVALID_REQUEST');
    await rpc('mission_configure', { p_member_id: actor.id, p_settings: settings, p_expected_revision: revision });
    return;
  }
  if (action === 'start') {
    if (room.status !== 'lobby') throw fail(409, 'MISSION_PHASE');
    const roster = await members(room.id);
    if (roster.length < 3 || roster.length > 8) throw fail(400, 'GROUP_PARTICIPANTS');
    const deal = dealMissions({ roster, preset: game.preset, scene: game.scene, seatMode: game.seat_mode === true });
    const order = makeRng().shuffle(roster.map((item) => item.id));
    await rpc('mission_start', { p_member_id: actor.id, p_assignments: deal, p_reveal_order: order, p_expected_revision: revision });
    return;
  }
  if (action === 'extend') {
    if (input.minutes !== undefined && input.minutes !== MISSION_EXTEND_MINUTES) throw fail(400, 'INVALID_REQUEST');
    if (Number(game.extensions || 0) >= MISSION_MAX_EXTENSIONS) throw fail(409, 'MISSION_EXTEND_LIMIT');
    await rpc('mission_extend', { p_member_id: actor.id, p_minutes: MISSION_EXTEND_MINUTES, p_expected_revision: revision });
    return;
  }
  if (action === 'end_now') { await rpc('mission_end_now', { p_member_id: actor.id, p_expected_revision: revision }); return; }
  if (action === 'reveal_start') {
    await rpc('mission_reveal_start', { p_member_id: actor.id, p_expected_revision: revision });
    return;
  }
  if (action === 'reveal_next') {
    // a double tap or a retry must not skip a person: the caller names the position it is looking at
    if (!Number.isInteger(input.cursor)) throw fail(400, 'INVALID_REQUEST');
    if (input.cursor !== Number(game.reveal_cursor)) throw fail(409, 'MISSION_PHASE');
    // the last person ends the game: its summary is the only thing kept (5 minutes), built here from the rows that go with it
    const last = Number(game.reveal_cursor) + 1 >= (Array.isArray(game.reveal_order) ? game.reveal_order.length : 0);
    await rpc('mission_reveal_next', { p_member_id: actor.id, p_expected_revision: revision, ...(last ? { p_result: await buildSummary(ctx, room) } : {}) }); return;
  }

  // achieve / unachieve / pass / swap act on one of the caller's own assignments
  if (typeof input.assignmentId !== 'string' || !UUID.test(input.assignmentId)) throw fail(400, 'INVALID_REQUEST');
  if (action !== 'swap') {
    const status = { achieve: 'achieved', unachieve: 'active', pass: 'passed' }[action];
    await rpc('mission_set_status', { p_member_id: actor.id, p_assignment_id: input.assignmentId, p_status: status });
    return;
  }
  const readSwapsUsed = async () => Number((await rest(`/rest/v1/mission_swaps?room_id=eq.${enc(room.id)}&member_id=eq.${enc(actor.id)}&select=used`))?.[0]?.used || 0);
  if (await readSwapsUsed() >= MISSION_SWAP_LIMIT_PER_MEMBER) throw fail(409, 'MISSION_SWAP_LIMIT');
  const roster = await members(room.id);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const assignments = (await rest(`/rest/v1/mission_assignments?room_id=eq.${enc(room.id)}&select=${LIVE_COLUMNS}`)) || [];
    const own = assignments.find((item) => item.id === input.assignmentId);
    if (!own || own.member_id !== actor.id) throw fail(403, 'FORBIDDEN');
    if (own.status !== 'active') throw fail(409, 'MISSION_UNAVAILABLE');
    const replacement = dealReplacement({ roster, scene: game.scene, seatMode: game.seat_mode === true, assignments, assignmentId: input.assignmentId });
    try { await rpc('mission_swap', { p_member_id: actor.id, p_assignment_id: input.assignmentId, p_new: replacement }); return; }
    // another member took that id / topic meanwhile: draw again from fresh rows
    catch (error) { if (error.code !== 'MISSION_POOL_EXHAUSTED' || attempt === 2) throw error; }
  }
}

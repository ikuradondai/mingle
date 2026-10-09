import { randomInt } from 'node:crypto';
import { ochiCards } from '../dist/data/ochi-cards.js';

// 「オチから話して」(game_type='ochi_kara'). Group-room handlers; group-rooms.mjs only dispatches here.
// The secret answer (real story / made-up story) and every hand but your own never leave this module before
// the turn reaches 'result'. Reads of ochi_turns / ochi_votes use explicit column lists for the same reason.
// Scores are private too (PO decision 2026-10-09): during the game nobody gets any score, the result screen gets only the caller's
// own gain for the turn, and the closing screen announces the title winners plus the caller's OWN tally. When the game ends the
// whole game row is deleted; only ochi_results (winners + tallies) lives on for 5 minutes, then it is deleted too.
const fail = (status, code) => Object.assign(new Error(code), { status, code });
const enc = encodeURIComponent;
const isoOrNull = (value) => { if (!value) return null; const time = new Date(value); return Number.isNaN(time.getTime()) ? null : time.toISOString(); };

export const OCHI_ERROR_CODES = ['OCHI_PHASE', 'OCHI_TURN', 'OCHI_ALREADY_VOTED', 'OCHI_VOTE_CLOSED', 'OCHI_SWAP_USED', 'OCHI_POOL_EXHAUSTED', 'OCHI_STALE_TURN', 'OCHI_NOT_STARTED', 'OCHI_NOT_REVEALED', 'OCHI_INVALID', 'OCHI_PARTICIPANTS'];
const TRUTHS = ['real', 'fiction'];
const GUESSES = ['real', 'fiction', 'pass'];
const HOST_ACTIONS = ['start', 'force_ready', 'close_vote', 'next_turn', 'finish'];
// Only `start` needs the caller's room `revision`. Every later action is identified by turnNo + phase (+ actor), because
// participants' confirm / vote / swap / lock_truth move the revision constantly and would make the host's clicks fail.
const STRICT_REVISION = ['start'];
const SPEAKER_ACTIONS = ['begin_tell', 'finish_tell', 'skip', 'reveal', 'lock_truth'];
// Phases in which each action is legal (finish is legal anywhere). Checked here and again inside the RPCs.
const ACTION_PHASES = { start: ['lobby'], confirm: ['deal'], force_ready: ['deal'], swap: ['deal', 'ready'], begin_tell: ['ready'], finish_tell: ['telling'], skip: ['ready', 'telling'], vote: ['vote'], lock_truth: ['vote'], close_vote: ['vote'], reveal: ['reveal'], next_turn: ['result', 'skipped'], finish: null };
const TURN_PHASES = ['ready', 'telling', 'vote', 'reveal', 'result', 'skipped'];
// The spoken ending is no longer secret once the speaker has finished telling (spec Q16); change here to hide it longer.
const TURN_OCHI_PHASES = ['vote', 'reveal', 'result'];
// Own hand stays viewable until your own turn is over (before it: any phase; the current speaker's hand is spent from the vote on).
const HAND_PHASES = ['deal', 'ready', 'telling', 'vote', 'reveal', 'result', 'skipped'];
const SWAP_PHASES = ['deal', 'ready', 'telling'];

function shuffle(items) { const output = [...items]; for (let i = output.length - 1; i > 0; i -= 1) { const n = randomInt(i + 1); [output[i], output[n]] = [output[n], output[i]]; } return output; }

export function ochiInput(input) {
  if (input.laps !== undefined && ![1, 2].includes(input.laps)) throw fail(400, 'INVALID_REQUEST');
  return { type: 'ochi_kara', pool: ochiCards.map(({ id, text, category }) => ({ id, text, category })), laps: input.laps ?? 1 };
}
// The room row needs a 6..40 card array; the RPC fills it with placeholders, so no card text is built here.
export const ochiSource = () => ({ id: 'ochi_kara', name: 'オチから話して', cards: [], adultOnly: false, participantRule: 'group' });
export const ochiCreatePayload = ({ common, gi }) => ({ ...common, p_pool: gi.pool, p_laps: gi.laps });

// Draw `count` unused cards, preferring categories that have been dealt the least in this game.
function draw(game, count) {
  const pool = Array.isArray(game.pool) ? game.pool : [];
  const taken = new Set((Array.isArray(game.used) ? game.used : []).map(Number));
  const dealt = new Map();
  for (const idx of taken) { const category = pool[idx]?.category; dealt.set(category, (dealt.get(category) || 0) + 1); }
  const picks = [];
  for (let n = 0; n < count; n += 1) {
    const byCategory = new Map();
    pool.forEach((card, idx) => { if (!taken.has(idx)) { if (!byCategory.has(card.category)) byCategory.set(card.category, []); byCategory.get(card.category).push(idx); } });
    if (!byCategory.size) throw fail(409, 'OCHI_POOL_EXHAUSTED');
    const fewest = Math.min(...[...byCategory.keys()].map((category) => dealt.get(category) || 0));
    const categories = [...byCategory.keys()].filter((category) => (dealt.get(category) || 0) === fewest);
    const category = categories[randomInt(categories.length)]; const list = byCategory.get(category); const idx = list[randomInt(list.length)];
    taken.add(idx); dealt.set(category, (dealt.get(category) || 0) + 1); picks.push({ idx, text: pool[idx].text });
  }
  return picks;
}

const countKeys = (value) => Object.keys(value && typeof value === 'object' ? value : {}).length;
const TURN_COLUMNS = (phase) => ['id', 'turn_no', 'speaker_id', 'tell_started_at', 'tell_deadline', 'status', 'truth_locked', ...(TURN_OCHI_PHASES.includes(phase) ? ['ochi_text'] : []), ...(phase === 'result' ? ['score_delta'] : [])].join(',');
const endedState = (turnNo = 0, totalTurns = 0, laps = 1) => ({ phase: 'ended', turnNo, totalTurns, laps, myOchi: null, mySwapAvailable: false, scores: null, result: null });

// The kept result of a finished game while it is within its 5 minutes, otherwise null (an expired row is deleted on the spot).
async function readResult(ctx, roomId) {
  const { rest, now } = ctx;
  const row = (await rest(`/rest/v1/ochi_results?room_id=eq.${enc(roomId)}&select=result,result_expires_at`))?.[0] || null;
  if (!row) return null;
  if (Date.parse(row.result_expires_at || '') > now()) return row;
  await rest(`/rest/v1/ochi_results?room_id=eq.${enc(roomId)}&result_expires_at=lte.${enc(new Date(now()).toISOString())}`, { method: 'DELETE' }).catch(() => {});
  return null;
}
// The closing screen: the title winners for everyone, and only the caller's own tally.
function finalState(ctx, row, memberId) {
  const kept = row.result && typeof row.result === 'object' ? row.result : {};
  const own = memberId ? kept.scores?.[memberId] : null;
  const ids = (value) => (Array.isArray(value) ? value.filter((id) => typeof id === 'string') : []);
  return {
    ...endedState(Number(kept.totalTurns || 0), Number(kept.totalTurns || 0), Number(kept.laps || 1)),
    phase: 'final', serverNow: new Date(ctx.now()).toISOString(), resultExpiresAt: isoOrNull(row.result_expires_at),
    titles: { detective: ids(kept.detective), mysterious: ids(kept.mysterious) },
    myScore: own ? { listener: Number(own.listener || 0), teller: Number(own.teller || 0) } : null
  };
}

// ctx: { rest(path, options), getRoom(id), now() }
export async function ochiState(ctx, room, member) {
  const { rest, getRoom, now } = ctx;
  const memberId = member?.id || null;
  let game; let turn = null; let votes = []; let truth = null; let stableRoom;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const startRoom = attempt === 0 ? room : await getRoom(room.id);
    const games = await rest(`/rest/v1/ochi_games?room_id=eq.${enc(room.id)}&select=laps,turn_order,turn_no,phase,hands,confirmed`); game = games?.[0];
    if (!game && startRoom.status === 'ended') {
      // a finished game has no game row any more; for 5 minutes its minimal result is still served, then only 'ended'
      const kept = await readResult(ctx, room.id);
      Object.assign(room, startRoom);
      return kept ? finalState(ctx, kept, memberId) : endedState();
    }
    if (!game) { Object.assign(room, startRoom); return { phase: 'lobby', turnNo: 0, totalTurns: 0, laps: 1, memberCount: Number(startRoom.member_count || 0) }; }
    if (startRoom.status === 'ended') { Object.assign(room, startRoom); return endedState(Number(game.turn_no || 0), Array.isArray(game.turn_order) ? game.turn_order.length : 0, Number(game.laps || 1)); }
    turn = null; votes = []; truth = null;
    if (Number(game.turn_no) > 0 && TURN_PHASES.includes(game.phase)) {
      turn = (await rest(`/rest/v1/ochi_turns?room_id=eq.${enc(room.id)}&turn_no=eq.${Number(game.turn_no)}&select=${TURN_COLUMNS(game.phase)}`))?.[0] || null;
      if (turn && ['vote', 'reveal', 'result'].includes(game.phase)) votes = (await rest(`/rest/v1/ochi_votes?turn_id=eq.${enc(turn.id)}&select=${game.phase === 'result' ? 'voter_id,guess' : 'voter_id'}`)) || [];
      if (turn && game.phase === 'result') truth = (await rest(`/rest/v1/ochi_turns?id=eq.${enc(turn.id)}&select=truth`))?.[0]?.truth || null;
    }
    const endRoom = await getRoom(room.id);
    if (startRoom.revision === endRoom.revision && startRoom.status === endRoom.status) { stableRoom = endRoom; break; }
  }
  if (!stableRoom) throw fail(409, 'GROUP_STALE');
  Object.assign(room, stableRoom);
  const phase = game.phase;
  const order = Array.isArray(game.turn_order) ? game.turn_order : [];
  const laps = Number(game.laps || 1);
  const perLap = Math.max(1, Math.floor(order.length / laps));
  const turnNo = Number(game.turn_no || 0);
  const lapIndex = turnNo > 0 ? (turnNo - 1) % perLap : 0;
  const speakerId = turnNo > 0 ? order[turnNo - 1] || null : null;
  const myHand = memberId ? game.hands?.[memberId] : null;
  // a hand is live from the deal until its owner's turn is over; afterwards it is spent and never returned
  const myPos = order.slice(0, perLap).indexOf(memberId);
  const handLive = Boolean(myHand) && HAND_PHASES.includes(phase) && (SWAP_PHASES.includes(phase) ? myPos >= lapIndex : myPos > lapIndex);
  const result = { phase, turnNo, totalTurns: order.length, laps, order: order.slice(0, perLap), speakerId, memberCount: countKeys(game.hands) || Number(stableRoom.member_count || 0), serverNow: new Date(now()).toISOString() };
  result.myOchi = handLive ? myHand.text : null;
  result.mySwapAvailable = handLive && SWAP_PHASES.includes(phase) && myHand.swapUsed !== true && (phase === 'deal' || (phase === 'ready' && speakerId === memberId));
  result.confirmed = Boolean(game.confirmed?.[memberId]); result.confirmedCount = countKeys(game.confirmed);
  result.tellStartedAt = isoOrNull(turn?.tell_started_at); result.tellDeadline = isoOrNull(turn?.tell_deadline);
  // only the speaker (and the host, who may act for them) learn whether an answer is registered -- never what it is
  result.myTruthLocked = turn && memberId && (memberId === turn.speaker_id || member.role === 'host') && ['telling', 'vote', 'reveal'].includes(phase) ? turn.truth_locked === true : null;
  result.turnOchi = turn && TURN_OCHI_PHASES.includes(phase) ? turn.ochi_text || null : null;
  result.voterCount = ['vote', 'reveal', 'result'].includes(phase) ? Math.max(0, result.memberCount - 1) : 0;
  result.votedCount = votes.length; result.memberHasVoted = votes.some((vote) => vote.voter_id === memberId);
  result.result = null;
  if (turn && phase === 'result') {
    const tally = { real: 0, fiction: 0, pass: 0 }; const guesses = {};
    for (const vote of votes) { if (GUESSES.includes(vote.guess)) { tally[vote.guess] += 1; guesses[vote.voter_id] = vote.guess; } }
    const delta = turn.score_delta && typeof turn.score_delta === 'object' ? turn.score_delta : {};
    // only the caller's own gain for this turn: nobody else's points are returned
    result.result = { truth, tally, guesses, myDelta: memberId ? Number(delta[memberId] || 0) : 0 };
  }
  result.scores = null;
  return result;
}

// ctx: { rest(path, options), members(roomId), getRoom? }. Performs one action; the caller re-reads and projects the state.
export async function ochiAction(ctx, args) {
  try { return await runAction(ctx, args); }
  catch (error) {
    // the RPC rejected a payload built from a stale read (members/hands changed in between): ask the client to refetch and retry
    if (error.code === 'OCHI_INVALID' || error.code === 'OCHI_PARTICIPANTS') throw fail(409, 'GROUP_STALE');
    throw error;
  }
}
async function runAction(ctx, { room, actor, input }) {
  const { rest, members } = ctx;
  const action = input.action;
  if (!Object.hasOwn(ACTION_PHASES, action)) throw fail(400, 'INVALID_REQUEST');
  if (HOST_ACTIONS.includes(action) && actor.role !== 'host') throw fail(403, 'FORBIDDEN');
  if (action !== 'start' && action !== 'finish' && !Number.isInteger(input.turnNo)) throw fail(400, 'INVALID_REQUEST');
  if (STRICT_REVISION.includes(action) && (!Number.isInteger(input.revision) || input.revision !== Number(room.revision))) throw fail(409, 'GROUP_STALE');
  const rpc = (name, body) => rest(`/rest/v1/rpc/${name}`, { method: 'POST', body: JSON.stringify({ p_room_id: room.id, ...body }) });
  const readGame = async () => (await rest(`/rest/v1/ochi_games?room_id=eq.${enc(room.id)}&select=*`))?.[0];
  const game = await readGame();
  if (!game) throw fail(409, 'OCHI_NOT_STARTED');
  if (action !== 'start' && action !== 'finish' && input.turnNo !== Number(game.turn_no)) throw fail(409, 'OCHI_STALE_TURN');
  const allowed = ACTION_PHASES[action];
  if (allowed && !allowed.includes(game.phase)) throw fail(409, action === 'reveal' && game.phase === 'vote' ? 'OCHI_NOT_REVEALED' : action === 'vote' ? 'OCHI_VOTE_CLOSED' : 'OCHI_PHASE');
  const turnNo = Number(game.turn_no);
  const revision = Number(room.revision);

  if (action === 'finish') { await rpc('ochi_finish', { p_member_id: actor.id}); return; }
  if (action === 'start') {
    const roster = await members(room.id);
    if (room.status !== 'lobby') throw fail(409, 'OCHI_PHASE');
    if (roster.length < 2 || roster.length > 8) throw fail(400, 'GROUP_PARTICIPANTS');
    const picks = draw(game, roster.length);
    const lap = shuffle(roster.map((item) => item.id));
    await rpc('ochi_start', { p_member_id: actor.id, p_expected_revision: revision, p_turn_order: Array.from({ length: Number(game.laps) || 1 }, () => lap).flat(), p_hands: Object.fromEntries(roster.map((item, index) => [item.id, picks[index]])) });
    return;
  }
  if (action === 'confirm') { await rpc('ochi_confirm', { p_turn_no: turnNo, p_member_id: actor.id }); return; }
  if (action === 'force_ready') { await rpc('ochi_force_ready', { p_turn_no: turnNo, p_member_id: actor.id }); return; }
  if (action === 'swap') {
    let current = game;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const hand = current.hands?.[actor.id];
      if (!hand) throw fail(403, 'FORBIDDEN');
      if (hand.swapUsed === true) throw fail(409, 'OCHI_SWAP_USED');
      try { await rpc('ochi_swap', { p_turn_no: turnNo, p_member_id: actor.id, p_new_hand: draw(current, 1)[0] }); return; }
      catch (error) { if (error.code !== 'GROUP_STALE' || attempt === 2) throw error; current = (await readGame()) || current; }
    }
    return;
  }
  if (action === 'vote') {
    if (!GUESSES.includes(input.guess)) throw fail(400, 'INVALID_REQUEST');
    await rpc('ochi_cast_vote', { p_turn_no: turnNo, p_voter_id: actor.id, p_guess: input.guess });
    return;
  }
  if (action === 'close_vote') { await rpc('ochi_close_vote', { p_turn_no: turnNo, p_member_id: actor.id }); return; }
  if (action === 'next_turn') {
    const total = Array.isArray(game.turn_order) ? game.turn_order.length : 0; const perLap = Math.max(1, Math.floor(total / (Number(game.laps) || 1)));
    let hands = null;
    if (turnNo < total && turnNo % perLap === 0) { const roster = await members(room.id); const picks = draw(game, roster.length); hands = Object.fromEntries(roster.map((item, index) => [item.id, picks[index]])); }
    await rpc('ochi_next_turn', { p_turn_no: turnNo, p_member_id: actor.id, p_hands: hands });
    return;
  }
  // speaker (or host proxy) actions: begin_tell / finish_tell / skip / reveal
  if (SPEAKER_ACTIONS.includes(action)) {
    const turn = (await rest(`/rest/v1/ochi_turns?room_id=eq.${enc(room.id)}&turn_no=eq.${turnNo}&select=id,speaker_id,status,truth_locked`))?.[0];
    if (!turn) throw fail(409, 'OCHI_PHASE');
    if (actor.id !== turn.speaker_id && actor.role !== 'host') throw fail(403, 'FORBIDDEN');
    const isSpeaker = actor.id === turn.speaker_id;
    const base = { p_turn_no: turnNo, p_member_id: actor.id };
    if (action === 'lock_truth') {
      if (!isSpeaker) throw fail(403, 'FORBIDDEN');
      if (!TRUTHS.includes(input.truth)) throw fail(400, 'INVALID_REQUEST');
      await rpc('ochi_lock_truth', { p_turn_no: turnNo, p_member_id: actor.id, p_truth: input.truth });
    } else if (action === 'begin_tell') await rpc('ochi_begin_tell', base);
    else if (action === 'skip') await rpc('ochi_skip', base);
    else if (action === 'finish_tell') {
      // only the speaker's own answer counts; a host finishing on their behalf never supplies one
      if (isSpeaker && !TRUTHS.includes(input.truth)) throw fail(400, 'INVALID_REQUEST');
      await rpc('ochi_finish_tell', { ...base, p_truth: isSpeaker ? input.truth : null });
    } else {
      const locked = turn.truth_locked === true;
      if (!locked && !TRUTHS.includes(input.truth)) throw fail(400, 'INVALID_REQUEST');
      await rpc('ochi_reveal', { ...base, p_truth: locked ? null : input.truth });
    }
  }
}

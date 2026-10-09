import { randomBytes } from 'node:crypto';
import { oneCutScenes } from '../dist/data/one-cut-scenes.js';
import { ONE_CUT_LABELS, actorForTake, isLastTakeOfLap, pickSceneSet, scoreSoloTake } from '../dist/one-cut-rules.js';

// 「ワンカット」(game_type='one_cut'). Group-room handlers; group-rooms.mjs only dispatches here.
// The scene the actor performs (one_cut_takes.answer_index) and every vote stay inside this module until the take
// reaches 'result': the actor alone gets `myScene` (brief / take / vote), nobody -- the host included -- gets the answer
// earlier, and votes are never returned per voter (only counted; at result only the correct voters' ids are returned).
// Reads of one_cut_takes / one_cut_votes use explicit column lists for the same reason.
// When the game ends (PO decision 2026-10-09) the whole game row is deleted; one_cut_state then serves only the closing screen's data
// (everyone's total + the lap awards, PO decision Q14) as phase 'final' for 5 minutes, and a minimal phase 'ended' after that.
const fail = (status, code) => Object.assign(new Error(code), { status, code });
const enc = encodeURIComponent;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const isoOrNull = (value) => { if (!value) return null; const time = new Date(value); return Number.isNaN(time.getTime()) ? null : time.toISOString(); };

export const ONE_CUT_ERROR_CODES = ['ONE_CUT_INVALID', 'ONE_CUT_PARTICIPANTS', 'ONE_CUT_PHASE', 'ONE_CUT_STALE_TAKE', 'ONE_CUT_ACTOR_VOTE', 'ONE_CUT_ALREADY_VOTED', 'ONE_CUT_VOTE_CLOSED', 'ONE_CUT_NOT_ACTOR', 'ONE_CUT_SCENES_EXHAUSTED', 'ONE_CUT_UNAVAILABLE'];
const ACTIONS = ['start', 'ready', 'skip', 'vote', 'close_vote', 'next', 'like', 'continue', 'finish'];
const HOST_ACTIONS = ['start', 'close_vote', 'continue', 'finish'];
// Actions that must carry the caller's current room `revision`; the rest are checked by take / lap number instead.
// only start needs the room revision (a late joiner changes who plays). Everything else is matched by take / lap number and phase,
// so participants' votes and likes moving the revision never fail the host's close_vote / continue / finish.
const STRICT_REVISION = ['start'];
const TAKE_ACTIONS = ['ready', 'skip', 'vote', 'close_vote', 'next', 'finish'];
const READY_LEAD_MS = 1000;
const VOTE_DELAY_MS = 500;
const SECRET_PHASES = ['brief', 'take', 'vote'];
const GAME_COLUMNS = 'phase,mode,start_style,laps_total,laps_auto,lap_no,take_no,scores,awards';

const random = () => randomBytes(6).readUIntBE(0, 6) / 2 ** 48;

export function oneCutInput(input) {
  if (input.lapsTotal !== undefined && ![1, 2, 3].includes(input.lapsTotal)) throw fail(400, 'INVALID_REQUEST');
  if (input.startStyle !== undefined && input.startStyle !== 'slate') throw fail(400, 'INVALID_REQUEST');
  if (input.mode !== undefined && input.mode !== 'solo_actor') throw fail(400, 'INVALID_REQUEST');
  return {
    type: 'one_cut',
    scenes: oneCutScenes.map(({ id, text, category, expression, similarGroup }) => ({ id, text, category, expression, ...(similarGroup ? { similarGroup } : {}) })),
    lapsTotal: input.lapsTotal ?? null,
    startStyle: 'slate',
    mode: 'solo_actor'
  };
}
// group_rooms.cards needs 6..40 entries; the RPC fills it from the first 40 scenes, so this only has to be a valid source.
export const oneCutSource = (gi) => ({ id: 'one_cut', name: 'ワンカット', cards: gi.scenes.slice(0, 40).map((scene) => ({ id: `one-cut:${scene.id}`, text: scene.text, r18: false, sourceDeckId: 'one_cut', participantRule: 'group' })), adultOnly: false, participantRule: 'group' });
export const oneCutCreatePayload = ({ common, gi }) => ({ ...common, p_scenes: gi.scenes, p_laps_total: gi.lapsTotal, p_start_style: gi.startStyle, p_mode: gi.mode });

const countKeys = (value) => Object.keys(value && typeof value === 'object' ? value : {}).length;
const labelled = (take) => (Array.isArray(take?.options) ? take.options.map((_, index) => ({ label: ONE_CUT_LABELS[index], text: take.option_texts?.[index] ?? '' })) : []);

// ctx: { rest(path, options), now() }. One RPC returns a consistent snapshot that is already filtered for `member`
// (see one_cut_state in the migration); this only shapes it. `receivedAt` is when the request arrived, so serverNow does not
// include our own processing time (clients estimate the clock offset from the round trip).
export async function oneCutState(ctx, room, member, receivedAt = ctx.now()) {
  const { rest } = ctx;
  const memberId = member?.id || null;
  const serverNow = new Date(receivedAt).toISOString();
  const snap = await rest('/rest/v1/rpc/one_cut_state', { method: 'POST', body: JSON.stringify({ p_room_id: room.id, p_member_id: memberId }) });
  if (!snap) return { phase: 'lobby', mode: 'solo_actor', startStyle: 'slate', lap: 0, lapsTotal: null, takeNo: 0, takesInLap: 0, memberCount: Number(room.member_count || 0), serverNow, scores: null, awards: [] };
  Object.assign(room, { revision: snap.revision, status: snap.roomStatus, member_count: snap.memberCount });
  const memberCount = Number(snap.memberCount || 0);
  const finished = { mode: 'solo_actor', startStyle: 'slate', lap: 0, lapsTotal: null, takeNo: 0, takesInLap: memberCount, memberCount, serverNow, myScene: null };
  if (snap.phase === 'ended') return { ...finished, phase: 'ended', scores: null, awards: [] };
  if (snap.phase === 'final') return { ...finished, phase: 'final', scores: snap.scores && typeof snap.scores === 'object' ? snap.scores : {}, awards: Array.isArray(snap.awards) ? snap.awards : [], resultExpiresAt: isoOrNull(snap.resultExpiresAt) };
  const phase = snap.phase;
  const take = snap.take || null;
  const texts = Array.isArray(take?.optionTexts) ? take.optionTexts : [];
  const base = {
    phase, mode: snap.mode, startStyle: snap.startStyle, lap: Number(snap.lapNo || 0), lapsTotal: snap.lapsAuto ? null : Number(snap.lapsTotal), takeNo: Number(snap.takeNo || 0), takesInLap: memberCount, memberCount,
    serverNow, scores: phase === 'lobby' ? null : snap.scores || {}, awards: Array.isArray(snap.awards) ? snap.awards : []
  };
  if (phase === 'lobby') return base;
  const actorId = take?.actorMemberId || null;
  const isActor = Boolean(memberId) && actorId === memberId;
  const live = ['take', 'vote'].includes(phase);
  const myAnswer = Number.isInteger(snap.myAnswerIndex) ? snap.myAnswerIndex : null;
  const result = {
    ...base, actorMemberId: actorId, isActor,
    options: phase === 'break' || !take ? [] : (take.options || []).map((_, index) => ({ label: ONE_CUT_LABELS[index], text: texts[index] ?? '' })),
    myScene: isActor && SECRET_PHASES.includes(phase) && myAnswer !== null ? { label: ONE_CUT_LABELS[myAnswer], text: texts[myAnswer] ?? '' } : null,
    takeStartedAt: live ? isoOrNull(take?.takeStartedAt) : null, actionAt: live ? isoOrNull(take?.actionAt) : null, cutAt: live ? isoOrNull(take?.cutAt) : null,
    voteDeadline: phase === 'vote' ? isoOrNull(take?.voteDeadline) : null,
    votedCount: Number(snap.votedCount || 0), voterCount: take ? Math.max(0, memberCount - 1) : 0,
    // only whether I have voted -- never what I chose, so the representative's shared screen has nothing to show
    memberHasVoted: snap.memberHasVoted === true,
    result: null, break: null
  };
  if (take && phase === 'result' && Number.isInteger(snap.answerIndex)) {
    const votes = Array.isArray(snap.votes) ? snap.votes.map((vote) => ({ voterId: vote.voter_id, choice: vote.choice })) : [];
    const scored = scoreSoloTake({ answerIndex: snap.answerIndex, actorId, votes });
    const mine = votes.find((vote) => vote.voterId === memberId);
    // the caller's own outcome only (they know what they chose); nobody else's choice is derivable from this
    const myVerdict = !memberId || memberId === actorId ? 'none' : !mine ? 'none' : mine.choice === snap.answerIndex ? 'correct' : Number.isInteger(mine.choice) && mine.choice >= 0 && mine.choice < 6 ? 'wrong' : 'pass';
    result.result = { answerLabel: ONE_CUT_LABELS[snap.answerIndex], answerText: texts[snap.answerIndex] ?? '', tally: scored.tally, passCount: scored.passCount, correctMemberIds: scored.correctMemberIds, gained: scored.gained, myVerdict };
  }
  if (phase === 'break') {
    result.break = {
      lap: Number(snap.lapNo),
      takes: (snap.lapTakes || []).map((item) => ({ takeNo: Number(item.takeNo), actorMemberId: item.actorMemberId, skipped: item.skipped === true, sceneText: item.skipped === true ? null : item.sceneText ?? null })),
      myLikeTargetId: snap.myLikeTargetId || null,
      likedCount: Number(snap.likedCount || 0)
    };
  }
  return result;
}

// ctx: { rest(path, options), members(roomId), getRoom(id), now() }. Performs one action; the caller re-reads and projects the state.
export async function oneCutAction(ctx, { room, actor, input }) {
  const { rest, members, now } = ctx;
  const action = input.action;
  if (!ACTIONS.includes(action)) throw fail(400, 'INVALID_REQUEST');
  if (HOST_ACTIONS.includes(action) && actor.role !== 'host') throw fail(403, 'FORBIDDEN');
  if (TAKE_ACTIONS.includes(action) && !Number.isInteger(input.takeNo)) throw fail(400, 'INVALID_REQUEST');
  if ((action === 'like' || action === 'continue') && !Number.isInteger(input.lapNo)) throw fail(400, 'INVALID_REQUEST');
  if (STRICT_REVISION.includes(action) && (!Number.isInteger(input.revision) || input.revision !== Number(room.revision))) throw fail(409, 'GROUP_STALE');
  const revision = Number(room.revision);
  // a refusal that only says "the request no longer fits the room" (roster changed, set no longer valid...) is a stale view to the client
  const rpc = async (name, body) => {
    try { return await rest(`/rest/v1/rpc/${name}`, { method: 'POST', body: JSON.stringify({ p_room_id: room.id, ...body }) }); }
    catch (error) { if (error.code === 'ONE_CUT_INVALID' || error.code === 'ONE_CUT_PARTICIPANTS') throw fail(409, 'GROUP_STALE'); throw error; }
  };
  const readGame = async (withScenes = false) => (await rest(`/rest/v1/one_cut_games?room_id=eq.${enc(room.id)}&select=${GAME_COLUMNS},used_answer_ids,used_option_ids${withScenes ? ',scenes' : ''}`))?.[0];
  const readTake = async (takeNo) => (await rest(`/rest/v1/one_cut_takes?room_id=eq.${enc(room.id)}&take_no=eq.${Number(takeNo)}&select=*`))?.[0] || null;
  let game = await readGame();
  if (!game) throw fail(409, 'ONE_CUT_UNAVAILABLE');

  if (action === 'finish') { await rpc('one_cut_finish', { p_member_id: actor.id, p_take_no: input.takeNo }); return; }
  const startOf = (set, takeNo, lapNo, actorId) => ({ takeNo, lapNo, actorId, options: set.options, answerIndex: set.answerIndex, assignments: null, startStyle: 'slate' });
  const pick = async (usedAnswerIds) => {
    const full = await readGame(true);
    return pickSceneSet({ scenes: full.scenes, usedAnswerIds, usedOptionIds: full.used_option_ids || [], random });
  };

  if (action === 'start') {
    if (room.status !== 'lobby' || game.phase !== 'lobby') throw fail(409, 'ONE_CUT_PHASE');
    const roster = await members(room.id);
    if (roster.length < 2 || roster.length > 8) throw fail(400, 'GROUP_PARTICIPANTS');
    const set = await pick([]);
    const first = startOf(set, 1, 1, actorForTake(roster, 1).id);
    await rpc('one_cut_start_take', { p_member_id: actor.id, p_take_no: 1, p_lap_no: 1, p_actor_id: first.actorId, p_options: first.options, p_answer_index: first.answerIndex, p_assignments: null, p_start_style: 'slate', p_expected_revision: revision });
    return;
  }

  if (action === 'like' || action === 'continue') {
    if (game.phase !== 'break') throw fail(409, 'ONE_CUT_PHASE');
    if (input.lapNo !== Number(game.lap_no)) throw fail(409, 'ONE_CUT_STALE_TAKE');
    if (action === 'like') {
      if (typeof input.targetId !== 'string' || !UUID.test(input.targetId)) throw fail(400, 'INVALID_REQUEST');
      await rpc('one_cut_like', { p_lap_no: input.lapNo, p_voter_id: actor.id, p_target_id: input.targetId });
      return;
    }
    let next = null;
    if (Number(game.lap_no) < Number(game.laps_total)) {
      const roster = await members(room.id);
      const takeNo = Number(game.lap_no) * roster.length + 1;
      next = startOf(await pick(game.used_answer_ids || []), takeNo, Number(game.lap_no) + 1, actorForTake(roster, takeNo).id);
    }
    await rpc('one_cut_close_break', { p_lap_no: input.lapNo, p_member_id: actor.id, p_next: next });
    return;
  }

  // take-bound actions: settle any deadline that has passed, then require the caller's take to still be the current one
  let take = Number(game.take_no) > 0 ? await readTake(game.take_no) : null;
  if (take && ((take.status === 'take' && Date.parse(take.cut_at || '') + VOTE_DELAY_MS <= now()) || (take.status === 'vote' && Date.parse(take.vote_deadline || '') <= now()))) {
    await rpc('one_cut_expire', { p_take_no: Number(game.take_no) }).catch(() => {});
    game = await readGame();
    take = await readTake(game.take_no);
  }
  if (input.takeNo !== Number(game.take_no) || !take) throw fail(409, 'ONE_CUT_STALE_TAKE');

  if (action === 'vote') {
    let choice = null;
    if (input.choice !== null && input.choice !== undefined) {
      if (!Number.isInteger(input.choice) || input.choice < 0 || input.choice >= (take.options?.length || 0)) throw fail(400, 'INVALID_REQUEST');
      choice = input.choice;
    }
    if (game.phase !== 'vote') throw fail(409, 'ONE_CUT_VOTE_CLOSED');
    if (take.actor_member_id === actor.id) throw fail(409, 'ONE_CUT_ACTOR_VOTE');
    await rpc('one_cut_cast_vote', { p_take_no: input.takeNo, p_voter_id: actor.id, p_choice: choice });
    return;
  }
  if (action === 'close_vote') {
    if (game.phase !== 'vote') throw fail(409, 'ONE_CUT_VOTE_CLOSED');
    await rpc('one_cut_close_vote', { p_take_no: input.takeNo, p_member_id: actor.id });
    return;
  }

  // ready / skip / next: the actor of this take, or the host acting for them
  if (take.actor_member_id !== actor.id && actor.role !== 'host') throw fail(409, 'ONE_CUT_NOT_ACTOR');
  if (action === 'ready') {
    if (game.phase !== 'brief') { if (['take', 'vote', 'result'].includes(game.phase)) return; throw fail(409, 'ONE_CUT_PHASE'); }
    await rpc('one_cut_ready', { p_take_no: input.takeNo, p_member_id: actor.id, p_started_at: new Date(now() + READY_LEAD_MS).toISOString() });
    return;
  }
  const roster = await members(room.id);
  const n = roster.length;
  const takeNo = Number(game.take_no);
  const nextArgs = async (usedAnswerIds) => {
    if (isLastTakeOfLap(n, takeNo)) return null;
    return startOf(await pick(usedAnswerIds), takeNo + 1, Number(game.lap_no), actorForTake(roster, takeNo + 1).id);
  };
  if (action === 'skip') {
    if (game.phase !== 'brief') throw fail(409, 'ONE_CUT_PHASE');
    // the passed scene is released: it may be an answer again, so the next set is picked as if it had never been used
    const answerId = take.options?.[Number(take.answer_index)];
    const next = await nextArgs((game.used_answer_ids || []).filter((id) => id !== answerId));
    await rpc('one_cut_skip', { p_take_no: input.takeNo, p_member_id: actor.id, p_next: next });
    return;
  }
  // next
  if (game.phase !== 'result') throw fail(409, 'ONE_CUT_PHASE');
  if (isLastTakeOfLap(n, takeNo)) { await rpc('one_cut_to_break', { p_take_no: input.takeNo, p_member_id: actor.id }); return; }
  const next = await nextArgs(game.used_answer_ids || []);
  await rpc('one_cut_start_take', { p_member_id: actor.id, p_take_no: next.takeNo, p_lap_no: next.lapNo, p_actor_id: next.actorId, p_options: next.options, p_answer_index: next.answerIndex, p_assignments: null, p_start_style: 'slate', p_expected_revision: null });
}

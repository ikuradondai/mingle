import { randomInt } from 'node:crypto';
import { QUICK_QUIZ_LEVELS, QUICK_QUIZ_QUESTIONS } from './quick-quiz-questions.mjs';

const fail = (status, code) => Object.assign(new Error(code), { status, code });
const enc = encodeURIComponent;
const iso = (value) => value ? new Date(value).toISOString() : null;
const LEVELS = new Set(QUICK_QUIZ_LEVELS.map((item) => item.id));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ERRORS = ['QUIZ_BUZZ_PHASE', 'QUIZ_BUZZ_PARTICIPANTS', 'QUIZ_BUZZ_STALE_ROUND', 'QUIZ_BUZZ_CLOSED', 'QUIZ_BUZZ_ALREADY_CLAIMED', 'QUIZ_BUZZ_LOCKED', 'QUIZ_BUZZ_TIMEOUT', 'QUIZ_BUZZ_NOT_STARTED', 'QUIZ_BUZZ_FULL', 'QUIZ_BUZZ_INVALID'];
export const QUIZ_BUZZ_ERROR_STATUS = Object.fromEntries(ERRORS.map((code) => [code, 409]));
const ACTIONS = new Set(['start', 'claim', 'answer', 'advance', 'finish']);

const shuffle = (items, random = randomInt) => {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const n = random(i + 1); [out[i], out[n]] = [out[n], out[i]];
  }
  return out;
};

export function selectQuickQuizQuestions(level, random = randomInt) {
  if (!LEVELS.has(level)) throw fail(400, 'QUIZ_BUZZ_INVALID');
  const source = QUICK_QUIZ_QUESTIONS.filter((item) => item.level === level);
  if (source.length < 6) throw fail(503, 'QUIZ_BUZZ_UNAVAILABLE');
  return shuffle(source, random).slice(0, 6).map((item) => {
    const choices = shuffle(item.choices.map((choice) => ({ id: choice.id, text: choice.text })), random);
    return { id: item.id, question: item.question, choices, correctChoiceId: item.correctChoiceId, explanation: item.explanation };
  });
}

export const quizBuzzInput = (input = {}) => {
  const level = input.difficulty === undefined ? 'beginner' : input.difficulty;
  if (!LEVELS.has(level)) throw fail(400, 'QUIZ_BUZZ_INVALID');
  return { type: 'quiz_buzz', difficulty: level };
};
export const quizBuzzSource = (gi) => ({ id: 'quiz_buzz', name: 'みんなで早押しクイズ', cards: Array.from({ length: 6 }, (_, i) => ({ id: `quiz-buzz:${i + 1}`, text: 'クイズ', r18: false, sourceDeckId: 'quiz_buzz', participantRule: 'group' })), adultOnly: false, participantRule: 'group' });
export const quizBuzzCreatePayload = ({ common, gi }) => ({ ...common, p_difficulty: gi.difficulty, p_questions: selectQuickQuizQuestions(gi.difficulty) });

const publicRound = (game, round, memberId, attempt = null) => {
  if (!round) return null;
  const revealed = round.phase === 'reveal' || round.phase === 'complete';
  const claim = round.winner_member_id === memberId;
  return {
    questionId: round.question_id, question: round.question_text,
    choices: Array.isArray(round.choices) ? round.choices : [],
    phase: round.phase, openedAt: iso(round.opened_at), answerDueAt: iso(round.answer_due_at), overallDueAt: iso(round.overall_due_at), revealDueAt: iso(round.reveal_due_at),
    winnerMemberId: round.winner_member_id || null,
    claimId: claim && !revealed ? round.winner_claim_id : null,
    lockedMemberIds: Array.isArray(round.locked_member_ids) ? round.locked_member_ids : [],
    lastAttempt: attempt ? { result: attempt.result, choiceId: attempt.choice_id || null, answeredAt: iso(attempt.answered_at) } : null,
    ...(revealed ? { correctChoiceId: round.correct_choice_id, explanation: round.explanation } : {})
  };
};

export async function quizBuzzState(ctx, room, member, receivedAt = ctx.now()) {
  const { rest } = ctx; const memberId = member?.id || null;
  if (!room || room.game_type !== 'quiz_buzz') throw fail(409, 'QUIZ_BUZZ_UNAVAILABLE');
  await rest('/rest/v1/rpc/quiz_buzz_advance', { method: 'POST', body: JSON.stringify({ p_room_id: room.id }) }).catch((error) => {
    if (['QUIZ_BUZZ_NOT_STARTED', 'QUIZ_BUZZ_PHASE'].includes(error.code)) return;
    if (['NOT_FOUND', 'GROUP_UNAVAILABLE'].includes(error.code)) throw fail(503, 'QUIZ_BUZZ_UNAVAILABLE');
    throw error;
  });
  let stableRoom = null; let game = null; let rounds = []; let attemptRows = [];
  for (let tries = 0; tries < 3; tries += 1) {
    const startRoom = await ctx.getRoom(room.id);
    const games = await rest(`/rest/v1/quiz_buzz_games?room_id=eq.${enc(room.id)}&select=phase,difficulty,round_no,question_index,total_questions,scores,revision`, {});
    const candidate = games?.[0];
    const candidateRounds = candidate?.round_no ? await rest(`/rest/v1/quiz_buzz_rounds?room_id=eq.${enc(room.id)}&round_no=eq.${Number(candidate.round_no)}&select=id,question_id,question_text,choices,phase,opened_at,answer_due_at,overall_due_at,reveal_due_at,winner_member_id,winner_claim_id,locked_member_ids,correct_choice_id,explanation`, {}) : [];
    const candidateAttempts = candidateRounds?.[0]?.id && memberId ? await rest(`/rest/v1/quiz_buzz_attempts?round_id=eq.${enc(candidateRounds[0].id)}&member_id=eq.${enc(memberId)}&select=result,choice_id,answered_at&limit=1`, {}) : [];
    const endRoom = await ctx.getRoom(room.id);
    if (startRoom.revision === endRoom.revision && startRoom.status === endRoom.status) { stableRoom = endRoom; game = candidate; rounds = candidateRounds; attemptRows = candidateAttempts; break; }
  }
  if (!stableRoom || !game) throw fail(409, 'GROUP_STALE');
  Object.assign(room, { revision: stableRoom?.revision ?? room.revision, status: stableRoom?.status ?? (game.phase === 'complete' ? 'ended' : (game.phase === 'lobby' ? 'lobby' : 'playing')), member_count: stableRoom?.member_count ?? room.member_count });
  const scores = game.scores && typeof game.scores === 'object' ? game.scores : {};
  return { phase: game.phase, difficulty: game.difficulty, roundNo: Number(game.round_no || 0), questionIndex: Number(game.question_index || 0), totalQuestions: Number(game.total_questions || 6), scores, serverNow: new Date(ctx.now()).toISOString(), round: publicRound(game, rounds?.[0], memberId, attemptRows?.[0] || null) };
}

export async function quizBuzzAction(ctx, { room, actor, input }) {
  const { rest } = ctx; const action = input.action;
  if (!ACTIONS.has(action)) throw fail(400, 'INVALID_REQUEST');
  if (action === 'start' || action === 'finish') {
    if (actor.role !== 'host') throw fail(403, 'FORBIDDEN');
    if (!Number.isInteger(input.revision) || input.revision !== Number(room.revision)) throw fail(409, 'GROUP_STALE');
  } else {
    if (!Number.isInteger(input.roundNo) || typeof input.questionId !== 'string') throw fail(400, 'INVALID_REQUEST');
    if (input.questionId.length < 1 || input.questionId.length > 120 || /[\u0000-\u001f\u007f]/u.test(input.questionId)) throw fail(400, 'INVALID_REQUEST');
    if (action === 'answer' && (!UUID.test(String(input.claimId || '')) || typeof input.choiceId !== 'string' || input.choiceId.length < 1 || input.choiceId.length > 120 || /[\u0000-\u001f\u007f]/u.test(input.choiceId))) throw fail(400, 'INVALID_REQUEST');
  }
  const rpc = action === 'start' ? 'quiz_buzz_start' : action === 'claim' ? 'quiz_buzz_claim' : action === 'answer' ? 'quiz_buzz_answer' : action === 'advance' ? 'quiz_buzz_advance' : 'quiz_buzz_finish';
  const body = action === 'start'
    ? { p_room_id: room.id, p_member_id: actor.id, p_expected_revision: input.revision }
    : action === 'finish'
      ? { p_room_id: room.id, p_member_id: actor.id, p_expected_revision: input.revision }
      : action === 'claim'
        ? { p_room_id: room.id, p_member_id: actor.id, p_round_no: input.roundNo, p_question_id: input.questionId }
        : action === 'answer'
          ? { p_room_id: room.id, p_member_id: actor.id, p_round_no: input.roundNo, p_question_id: input.questionId, p_claim_id: input.claimId, p_choice_id: input.choiceId }
          : { p_room_id: room.id, p_round_no: input.roundNo, p_question_id: input.questionId };
  await rest(`/rest/v1/rpc/${rpc}`, { method: 'POST', body: JSON.stringify(body) });
}

export { ERRORS as QUIZ_BUZZ_ERROR_CODES };

import test from 'node:test';
import assert from 'node:assert/strict';
import { quizBuzzAction, quizBuzzCreatePayload, quizBuzzInput, quizBuzzSource, quizBuzzState, selectQuickQuizQuestions } from '../server-side/quiz-buzz.mjs';

const room = { id: '00000000-0000-4000-8000-000000000001', game_type: 'quiz_buzz', revision: 4, status: 'playing', member_count: 2 };
const member = { id: '00000000-0000-4000-8000-000000000002', role: 'guest' };

test('create payload preserves six server-selected questions and opaque shuffled choices', () => {
  const gi = quizBuzzInput({ difficulty: 'beginner' });
  const source = quizBuzzSource(gi);
  const payload = quizBuzzCreatePayload({ common: { p_host_user_id: 'u' }, gi, source, input: {} });
  assert.equal(payload.p_difficulty, 'beginner');
  assert.equal(payload.p_questions.length, 6);
  assert.ok(payload.p_questions.every((q) => q.choices.length === 4 && q.correctChoiceId && q.choices.some((choice) => choice.id === q.correctChoiceId)));
  assert.equal(source.cards.length, 6);
});

test('default create payload selects six unique questions for every difficulty', () => {
  for (const difficulty of ['beginner', 'intermediate', 'advanced', 'expert']) {
    const gi = quizBuzzInput({ difficulty });
    const payload = quizBuzzCreatePayload({ common: {}, gi, source: quizBuzzSource(gi), input: {} });
    assert.equal(payload.p_questions.length, 6, difficulty);
    assert.equal(new Set(payload.p_questions.map(({ id }) => id)).size, 6, difficulty);
    assert.ok(payload.p_questions.every(({ id }) => id.startsWith(`${difficulty}-`)), difficulty);
  }
});

test('server selects six distinct questions from each forty-question level', () => {
  const levels = ['beginner', 'intermediate', 'advanced', 'expert'];
  for (const level of levels) {
    const first = selectQuickQuizQuestions(level, () => 0);
    const second = selectQuickQuizQuestions(level, (max) => Math.floor(max / 2));
    for (const questions of [first, second]) {
      assert.equal(questions.length, 6, level);
      assert.equal(new Set(questions.map(({ id }) => id)).size, 6, level);
      assert.ok(questions.every(({ id }) => id.startsWith(`${level}-`)), level);
      assert.ok(questions.every(({ id }) => Number(id.slice(-2)) >= 1 && Number(id.slice(-2)) <= 40), level);
    }
    assert.notDeepEqual(first.map(({ id }) => id).sort(), second.map(({ id }) => id).sort(), `${level} selection must depend on randomness`);
    assert.ok([...first, ...second].some(({ id }) => Number(id.slice(-2)) >= 13), `${level} extended bank is selectable`);
  }
});

test('live projection excludes the correct choice and explanation', async () => {
  const calls = [];
  const ctx = { now: () => Date.parse('2026-01-01T00:00:00Z'), getRoom: async () => ({ ...room }), rest: async (path, options) => {
    calls.push(path);
    if (path.includes('/rpc/quiz_buzz_advance')) return null;
    if (path.includes('quiz_buzz_games')) return [{ phase: 'playing', difficulty: 'beginner', round_no: 1, question_index: 0, total_questions: 6, scores: { [member.id]: 0 }, revision: 4 }];
    return [{ question_id: 'q1', question_text: 'Q?', choices: [{ id: 'a', text: 'A' }, { id: 'b', text: 'B' }, { id: 'c', text: 'C' }, { id: 'd', text: 'D' }], phase: 'buzz', opened_at: '2026-01-01T00:00:00Z', answer_due_at: '2026-01-01T00:00:10Z', overall_due_at: '2026-01-01T00:00:45Z', winner_member_id: null, winner_claim_id: null, locked_member_ids: [], correct_choice_id: 'b', explanation: 'private' }];
  } };
  const state = await quizBuzzState(ctx, { ...room }, member);
  assert.equal(state.round.questionId, 'q1');
  assert.equal('correctChoiceId' in state.round, false);
  assert.equal('explanation' in state.round, false);
  assert.ok(calls.some((path) => path.includes('quiz_buzz_advance')));
});

test('reveal projection exposes answer only after the server phase changes', async () => {
  const ctx = { now: () => Date.now(), getRoom: async () => ({ ...room, revision: 8, status: 'ended' }), rest: async (path) => {
    if (path.includes('/rpc/quiz_buzz_advance')) return null;
    if (path.includes('quiz_buzz_games')) return [{ phase: 'complete', difficulty: 'beginner', round_no: 1, question_index: 0, total_questions: 6, scores: {}, revision: 8 }];
    return [{ question_id: 'q1', question_text: 'Q?', choices: [], phase: 'reveal', opened_at: null, answer_due_at: null, overall_due_at: null, winner_member_id: member.id, winner_claim_id: null, locked_member_ids: [], correct_choice_id: 'b', explanation: 'reason' }];
  } };
  const state = await quizBuzzState(ctx, { ...room }, member);
  assert.equal(state.round.correctChoiceId, 'b');
  assert.equal(state.round.explanation, 'reason');
});

test('state retries a mixed revision read and returns the post-advance room revision', async () => {
  let roomReads = 0;
  const ctx = { now: () => Date.parse('2026-01-01T00:00:20Z'), getRoom: async () => {
    roomReads += 1;
    return { ...room, revision: roomReads < 3 ? (roomReads === 1 ? 4 : 5) : 5, status: 'playing' };
  }, rest: async (path) => {
    if (path.includes('/rpc/quiz_buzz_advance')) return null;
    if (path.includes('quiz_buzz_games')) return [{ phase: 'playing', difficulty: 'beginner', round_no: 1, question_index: 0, total_questions: 6, scores: {}, revision: 5 }];
    if (path.includes('quiz_buzz_attempts')) return [];
    return [{ id: 'round-1', question_id: 'q1', question_text: 'Q?', choices: [], phase: 'buzz', opened_at: null, answer_due_at: null, overall_due_at: null, reveal_due_at: null, winner_member_id: null, winner_claim_id: null, locked_member_ids: [] }];
  } };
  const state = await quizBuzzState(ctx, { ...room }, member);
  assert.equal(state.roundNo, 1);
  assert.equal(roomReads >= 4, true);
});

test('state refuses to publish after three continuously changing room revisions', async () => {
  let revision = 4;
  const ctx = { now: () => Date.now(), getRoom: async () => ({ ...room, revision: revision += 1, status: 'playing' }), rest: async (path) => {
    if (path.includes('/rpc/quiz_buzz_advance')) return null;
    if (path.includes('quiz_buzz_games')) return [{ phase: 'playing', difficulty: 'beginner', round_no: 1, question_index: 0, total_questions: 6, scores: {}, revision: 5 }];
    return [{ id: 'round-1', question_id: 'q1', question_text: 'Q?', choices: [], phase: 'buzz', locked_member_ids: [] }];
  } };
  await assert.rejects(() => quizBuzzState(ctx, { ...room }, member), { code: 'GROUP_STALE', status: 409 });
});

test('claim action sends member and round identity to the dedicated RPC', async () => {
  let request;
  const ctx = { rest: async (path, options) => { request = { path, body: JSON.parse(options.body) }; } };
  await quizBuzzAction(ctx, { room, actor: member, input: { action: 'claim', roundNo: 1, questionId: 'q1' } });
  assert.match(request.path, /quiz_buzz_claim$/);
  assert.deepEqual(request.body, { p_room_id: room.id, p_member_id: member.id, p_round_no: 1, p_question_id: 'q1' });
});

test('answer rejects malformed claim and choice before reaching the RPC', async () => {
  const ctx = { rest: async () => { throw new Error('must not call'); } };
  await assert.rejects(() => quizBuzzAction(ctx, { room, actor: member, input: { action: 'answer', roundNo: 1, questionId: 'q1', claimId: 'bad', choiceId: 'a' } }), { code: 'INVALID_REQUEST', status: 400 });
  await assert.rejects(() => quizBuzzAction(ctx, { room, actor: member, input: { action: 'answer', roundNo: 1, questionId: 'q1', claimId: '00000000-0000-4000-8000-000000000003', choiceId: '' } }), { code: 'INVALID_REQUEST', status: 400 });
  await assert.rejects(() => quizBuzzAction(ctx, { room, actor: member, input: { action: 'answer', roundNo: 1, questionId: 'q1', claimId: '00000000-0000-4000-8000-000000000003', choiceId: '0123456789abcdef' } }), /must not call/);
  await assert.rejects(() => quizBuzzAction({ rest: async () => { throw new Error('must not call'); } }, { room, actor: member, input: { action: 'answer', roundNo: 1, questionId: 'q\n1', claimId: '00000000-0000-4000-8000-000000000003', choiceId: '0123456789abcdef' } }), { code: 'INVALID_REQUEST', status: 400 });
});

test('start and finish are host-only and carry compare-and-swap revision', async () => {
  const calls = [];
  const ctx = { rest: async (path, options) => calls.push({ path, body: JSON.parse(options.body) }) };
  const host = { ...member, role: 'host' };
  await quizBuzzAction(ctx, { room, actor: host, input: { action: 'start', revision: 4 } });
  await quizBuzzAction(ctx, { room: { ...room, revision: 5 }, actor: host, input: { action: 'finish', revision: 5 } });
  assert.deepEqual(calls.map((item) => item.path.split('/').pop()), ['quiz_buzz_start', 'quiz_buzz_finish']);
  assert.equal(calls[0].body.p_expected_revision, 4);
  await assert.rejects(() => quizBuzzAction(ctx, { room, actor: member, input: { action: 'finish', revision: 4 } }), { code: 'FORBIDDEN' });
});

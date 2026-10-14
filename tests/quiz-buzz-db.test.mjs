import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const hostUser = '11111111-1111-4111-8111-111111111111';
const roomOtherMember = '22222222-2222-4222-8222-222222222222';
const foreignMember = '33333333-3333-4333-8333-333333333333';
const questions = Array.from({ length: 6 }, (_, index) => ({
  id: `beginner-${String(index + 1).padStart(2, '0')}`,
  question: `問題${index + 1}？`,
  choices: ['a', 'b', 'c', 'd'].map((text) => ({ id: `${index + 1}-${text}`, text })),
  correctChoiceId: `${index + 1}-a`,
  explanation: '説明',
}));

const db = new PGlite();
await db.waitReady;
await db.exec(`create schema auth;
create table auth.users (id uuid primary key, email text);
create role anon; create role authenticated; create role service_role bypassrls;
grant usage on schema public, auth to anon, authenticated, service_role;
insert into auth.users(id,email) values ('${hostUser}','host@test');`);
await db.exec(await readFile(new URL('../supabase/migrations/202610080001_group_rooms.sql', import.meta.url), 'utf8'));
await db.exec(await readFile(new URL('../supabase/migrations/202610150001_minority_topic.sql', import.meta.url), 'utf8'));
await db.exec(await readFile(new URL('../supabase/migrations/202610170001_group_game_types.sql', import.meta.url), 'utf8'));
await db.exec(await readFile(new URL('../supabase/migrations/202610180001_quiz_buzz.sql', import.meta.url), 'utf8'));

const query = (sql) => db.query(sql);
const mustFail = (sql, message) => assert.rejects(() => query(sql), undefined, message);
const service = () => db.exec('set role service_role');
const room = async (name) => {
  const row = (await query(`select * from public.quiz_buzz_create_room('${hostUser}','${name}','${name}-host','Host',now()+interval '1 hour','beginner','${JSON.stringify(questions)}'::jsonb)`)).rows[0];
  await query(`select * from public.group_join_member('${row.room_id}','${name}-guest','Guest',false)`);
  const members = (await query(`select id,role from public.group_members where room_id='${row.room_id}' order by role desc`)).rows;
  return { id: row.room_id, host: members.find(({ role }) => role === 'host').id, guest: members.find(({ role }) => role === 'guest').id, revision: (await query(`select revision from public.group_rooms where id='${row.room_id}'`)).rows[0].revision };
};

test('quiz buzz SQL enforces RLS, atomic claim, wrong-lock, score replay, timeout, and cross-room membership', async () => {
  await service();
  const game = await room('db-quiz-a');
  const other = await room('db-quiz-b');
  await db.exec('set role anon');
  await mustFail('select * from public.quiz_buzz_games', 'client cannot read private quiz state');
  await mustFail(`select * from public.quiz_buzz_create_room('${hostUser}','x','y','Host',now()+interval '1 hour','beginner','${JSON.stringify(questions)}'::jsonb)`, 'client cannot call create RPC');
  await db.exec('set role authenticated');
  await mustFail('select * from public.quiz_buzz_rounds', 'authenticated client cannot read private rounds');
  await mustFail(`select * from public.quiz_buzz_advance('${game.id}')`, 'authenticated client cannot call advance RPC');
  await service();

  await query(`select public.quiz_buzz_start('${game.id}','${game.host}',${game.revision})`);
  await assert.rejects(() => query(`select public.quiz_buzz_start('${game.id}','${game.host}',${game.revision})`), /GROUP_STALE/);
  await query(`select public.quiz_buzz_start('${other.id}','${other.host}',${other.revision})`);
  const round = (await query(`select id,question_id from public.quiz_buzz_rounds where room_id='${game.id}'`)).rows[0];
  await query(`select public.quiz_buzz_claim('${game.id}','${game.guest}',1,'${round.question_id}')`);
  await mustFail(`select public.quiz_buzz_claim('${game.id}','${game.host}',1,'${round.question_id}')`, 'second claimant cannot replace winner');
  const claim = (await query(`select id from public.quiz_buzz_attempts where round_id='${round.id}' and member_id='${game.guest}'`)).rows[0].id;
  const beforeWrongRevision = (await query(`select revision from public.quiz_buzz_games where room_id='${game.id}'`)).rows[0].revision;
  await query(`select public.quiz_buzz_answer('${game.id}','${game.guest}',1,'${round.question_id}','${claim}','1-b')`);
  assert.equal((await query(`select revision from public.quiz_buzz_games where room_id='${game.id}'`)).rows[0].revision, beforeWrongRevision + 1);
  let state = (await query(`select phase,locked_member_ids,winner_member_id from public.quiz_buzz_rounds where id='${round.id}'`)).rows[0];
  assert.equal(state.phase, 'buzz');
  assert.deepEqual(state.locked_member_ids, [game.guest]);
  await mustFail(`select public.quiz_buzz_claim('${game.id}','${game.guest}',1,'${round.question_id}')`, 'wrong claimant stays locked');
  const hostClaim = await query(`select public.quiz_buzz_claim('${game.id}','${game.host}',1,'${round.question_id}')`);
  const hostClaimId = hostClaim.rows[0].quiz_buzz_claim;
  await query(`select public.quiz_buzz_answer('${game.id}','${game.host}',1,'${round.question_id}','${hostClaimId}','1-a')`);
  await mustFail(`select public.quiz_buzz_answer('${game.id}','${game.host}',1,'${round.question_id}','${hostClaimId}','1-a')`, 'correct answer cannot score twice');
  state = (await query(`select phase from public.quiz_buzz_rounds where id='${round.id}'`)).rows[0];
  assert.equal(state.phase, 'reveal');
  assert.equal((await query(`select (scores->>'${game.host}')::int as score from public.quiz_buzz_games where room_id='${game.id}'`)).rows[0].score, 1);

  await query(`update public.quiz_buzz_rounds set reveal_due_at=now()-interval '1 second' where id='${round.id}'`);
  await query(`select public.quiz_buzz_advance('${game.id}')`);
  const round2 = (await query(`select id,question_id from public.quiz_buzz_rounds where room_id='${game.id}' and round_no=2`)).rows[0];
  assert.ok(round2);
  const timedClaim = (await query(`select public.quiz_buzz_claim('${game.id}','${game.host}',2,'${round2.question_id}')`)).rows[0].quiz_buzz_claim;
  await query(`update public.quiz_buzz_rounds set answer_due_at=now()+interval '30 seconds',overall_due_at=now()-interval '1 second' where id='${round2.id}'`);
  await mustFail(`select public.quiz_buzz_answer('${game.id}','${game.host}',2,'${round2.question_id}','${timedClaim}','2-a')`, 'overall deadline closes answer even while answer window remains');
  const beforeOverallRevision = (await query(`select revision from public.quiz_buzz_games where room_id='${game.id}'`)).rows[0].revision;
  await query(`select public.quiz_buzz_advance('${game.id}',2,'${round2.question_id}')`);
  assert.equal((await query(`select phase from public.quiz_buzz_rounds where id='${round2.id}'`)).rows[0].phase, 'reveal');
  assert.ok((await query(`select revision from public.quiz_buzz_games where room_id='${game.id}'`)).rows[0].revision > beforeOverallRevision);

  const otherRound = (await query(`select question_id from public.quiz_buzz_rounds where room_id='${other.id}' and round_no=1`)).rows[0];
  const otherBefore = (await query(`select phase,round_no from public.quiz_buzz_games where room_id='${other.id}'`)).rows[0];
  await mustFail(`select public.quiz_buzz_claim('${game.id}','${other.guest}',1,'${round.question_id}')`, 'member from another playing room cannot claim');
  assert.deepEqual((await query(`select phase,round_no from public.quiz_buzz_games where room_id='${other.id}'`)).rows[0], otherBefore);
  await mustFail(`select public.quiz_buzz_claim('${game.id}','${foreignMember}',2,'${round2.question_id}')`, 'unknown member cannot claim');

  const timeoutRoom = await room('db-quiz-timeout');
  await query(`select public.quiz_buzz_start('${timeoutRoom.id}','${timeoutRoom.host}',${timeoutRoom.revision})`);
  const timeoutRound = (await query(`select id,question_id from public.quiz_buzz_rounds where room_id='${timeoutRoom.id}'`)).rows[0];
  const timeoutClaim = (await query(`select public.quiz_buzz_claim('${timeoutRoom.id}','${timeoutRoom.host}',1,'${timeoutRound.question_id}')`)).rows[0].quiz_buzz_claim;
  await query(`update public.quiz_buzz_rounds set answer_due_at=now()-interval '1 second',overall_due_at=now()+interval '30 seconds' where id='${timeoutRound.id}'`);
  await mustFail(`select public.quiz_buzz_answer('${timeoutRoom.id}','${timeoutRoom.host}',1,'${timeoutRound.question_id}','${timeoutClaim}','1-a')`, 'answer deadline closes answer before overall deadline');
  const timeoutBefore = (await query(`select revision from public.quiz_buzz_games where room_id='${timeoutRoom.id}'`)).rows[0].revision;
  await query(`select public.quiz_buzz_advance('${timeoutRoom.id}',1,'${timeoutRound.question_id}')`);
  assert.equal((await query(`select phase from public.quiz_buzz_rounds where id='${timeoutRound.id}'`)).rows[0].phase, 'buzz');
  assert.ok((await query(`select revision from public.quiz_buzz_games where room_id='${timeoutRoom.id}'`)).rows[0].revision > timeoutBefore);

  // Two wrong answers exhaust the remaining members; then auto-advance through rounds 3-6.
  await query(`update public.quiz_buzz_rounds set reveal_due_at=now()-interval '1 second' where id='${round2.id}'`);
  await query(`select public.quiz_buzz_advance('${game.id}')`);
  for (let roundNo = 3; roundNo <= 6; roundNo += 1) {
    const current = (await query(`select id,question_id from public.quiz_buzz_rounds where room_id='${game.id}' and round_no=${roundNo}`)).rows[0];
    for (const memberId of [game.guest, game.host]) {
      const claimId = (await query(`select public.quiz_buzz_claim('${game.id}','${memberId}',${roundNo},'${current.question_id}')`)).rows[0].quiz_buzz_claim;
      await query(`select public.quiz_buzz_answer('${game.id}','${memberId}',${roundNo},'${current.question_id}','${claimId}','${roundNo}-b')`);
    }
    assert.equal((await query(`select phase from public.quiz_buzz_rounds where id='${current.id}'`)).rows[0].phase, 'reveal');
    await query(`update public.quiz_buzz_rounds set reveal_due_at=now()-interval '1 second' where id='${current.id}'`);
    await query(`select public.quiz_buzz_advance('${game.id}')`);
  }
  const ended = (await query(`select phase,scores from public.quiz_buzz_games where room_id='${game.id}'`)).rows[0];
  assert.equal(ended.phase, 'complete');
  assert.equal(Number(ended.scores[game.host]), 1, 'wrong answers never award extra points');
  assert.equal((await query(`select status from public.group_rooms where id='${game.id}'`)).rows[0].status, 'ended');
});

test.after(async () => db.close());


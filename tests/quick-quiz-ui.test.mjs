import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { rankFor, answerDeadline, deadlineForPhase, normalizeQuizPhase } from '../dist/quick-quiz-model.js';
import { saveQuickQuizAuthIntent, consumeQuickQuizAuthIntent } from '../dist/quick-quiz-auth-intent.js';

const registry = fs.readFileSync('dist/data/game-registry.js', 'utf8');
const account = fs.readFileSync('dist/account.js', 'utf8');
const page = fs.readFileSync('dist/quick-quiz-room.js', 'utf8');

test('quick quiz is registered as a two-to-eight player game and uses the server game type', () => {
  assert.match(registry, /id: 'quick-quiz'/);
  assert.match(registry, /minParticipants: 2/);
  assert.match(registry, /maxParticipants: 8/);
  assert.match(account, /gameType: 'quiz_buzz'/);
});

test('quick quiz UI sends server-authoritative claim and answer payloads without a client answer bank', () => {
  assert.match(page, /data-act=\\?"claim/);
  assert.match(page, /quickQuizAction/);
  assert.match(page, /currentRevision/);
  assert.match(page, /difficulty/);
  assert.match(page, /r\.question/);
  assert.match(page, /r\.phase/);
  assert.match(page, /claimId/);
  assert.match(page, /Number\(g\.questionIndex\|\|0\)\+1/);
  assert.match(page, /r\.explanation/);
  assert.match(fs.readFileSync('dist/quick-quiz-model.js', 'utf8'), /revealDueAt/);
  assert.match(page, /serverNow/);
  assert.match(page, /performance\.now/);
  assert.match(page, /lastAttempt/);
  assert.match(page, /questionId/);
  assert.match(page, /correctChoiceId/);
  assert.doesNotMatch(page, /quick-quiz-questions/);
});

test('quick quiz auth return preserves the chosen name and difficulty', () => {
  const intent = fs.readFileSync('dist/quick-quiz-auth-intent.js', 'utf8');
  const app = fs.readFileSync('dist/app.js', 'utf8');
  assert.match(intent, /difficulty/);
  assert.match(app, /quick-quiz-room\.html\?create=1/);
  assert.match(app, /saveQuickQuizAuthIntent\(quickQuizIntent\)/);
});

test('quick quiz normalizes the server buzz phase', () => {
  assert.equal(normalizeQuizPhase({ phase: 'playing', round: { phase: 'buzz' } }), 'question');
  assert.equal(normalizeQuizPhase({ phase: 'playing', round: { phase: 'answer' } }), 'answer');
  assert.equal(normalizeQuizPhase({ phase: 'playing', round: { phase: 'revealed' } }), 'reveal');
  assert.equal(normalizeQuizPhase({ phase: 'complete' }), 'ended');
});

test('quick quiz ranks ties fairly and uses the earliest answer deadline', () => {
  const rows = [{ score: 3 }, { score: 2 }, { score: 2 }, { score: 1 }];
  assert.deepEqual(rows.map((_, index) => rankFor(rows, index)), [1, 2, 2, 4]);
  assert.deepEqual(answerDeadline({ answerDueAt: '2026-10-14T00:00:10Z', overallDueAt: '2026-10-14T00:00:45Z' }), '2026-10-14T00:00:10.000Z');
  assert.deepEqual(answerDeadline({ answerDueAt: '2026-10-14T00:00:50Z', overallDueAt: '2026-10-14T00:00:45Z' }), '2026-10-14T00:00:45.000Z');
});

test('quick quiz uses the overall deadline before a claim and the shorter deadline after it', () => {
  const round = { overallDueAt: '2026-10-14T00:00:45Z', answerDueAt: '2026-10-14T00:00:10Z', revealDueAt: '2026-10-14T00:00:50Z' };
  assert.equal(deadlineForPhase({ phase: 'playing', round: { ...round, phase: 'buzz' } }, {}), round.overallDueAt);
  assert.equal(deadlineForPhase({ phase: 'playing', round: { ...round, phase: 'answer', claimId: 'claim-1' } }, {}), '2026-10-14T00:00:10.000Z');
  assert.equal(deadlineForPhase({ phase: 'playing', round: { ...round, phase: 'answer', claimId: null } }, {}), '2026-10-14T00:00:10.000Z');
  assert.equal(deadlineForPhase({ phase: 'playing', round: { ...round, phase: 'answer', answerDueAt: '2026-10-14T00:00:50Z' } }, {}), '2026-10-14T00:00:45.000Z');
  assert.equal(deadlineForPhase({ phase: 'playing', round: { ...round, phase: 'reveal' } }, {}), round.revealDueAt);
  assert.equal(deadlineForPhase({ phase: 'complete', round }, {}), null);
});

test('quick quiz auth intent round trips and fails closed on blocked storage', () => {
  const values = new Map();
  const storage = { getItem: (key) => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
  assert.equal(saveQuickQuizAuthIntent({ name: '  ゲスト  ', difficulty: 'advanced' }, storage), true);
  assert.deepEqual(consumeQuickQuizAuthIntent(storage), { venueToken: '', name: 'ゲスト', difficulty: 'advanced' });
  const blocked = { getItem: () => null, setItem: () => { throw new Error('blocked'); }, removeItem: () => {} };
  assert.equal(saveQuickQuizAuthIntent({ name: 'x' }, blocked), false);
  assert.equal(consumeQuickQuizAuthIntent(blocked), null);
});

test('quick quiz HTML keeps the standalone quiz page separate', () => {
  const html = fs.readFileSync('dist/quick-quiz-room.html', 'utf8');
  assert.match(html, /id="quick-quiz-app"/);
  assert.match(html, /quick-quiz-room\.js/);
  assert.doesNotMatch(html, /quiz\.js/);
});





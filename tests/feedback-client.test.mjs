import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFeedbackPayload, submitFeedback } from '../dist/feedback.js';
import { createSession } from '../dist/engine.js';
import { decks } from '../dist/data/decks.js';
import { loadSession, saveSession } from '../dist/session-storage.js';

const pick = (id) => decks.find((deck) => deck.id === id);
const memory = () => ({ value: null, getItem() { return this.value; }, setItem(_key, value) { this.value = value; }, removeItem() { this.value = null; } });

test('feedback payload contains only the backend contract and trims text', () => {
  const session = createSession({ participants: ['A', 'B'], deck: pick('friends'), random: () => 0.5 });
  const payload = buildFeedbackPayload(session, 6, 'positive', '  よかった！  ');
  assert.deepEqual(payload, { sessionId: session.sessionId, cursor: 6, themeId: 'friends', themeIds: ['friends'], rating: 'positive', text: 'よかった！' });
  assert.throws(() => buildFeedbackPayload(session, 6, null, ''));
  assert.throws(() => buildFeedbackPayload(session, 6, null, 'x'.repeat(1001)));
});

test('feedback post accepts duplicate success and sends exact JSON', async () => {
  const session = createSession({ participants: ['A', 'B'], deck: pick('friends'), random: () => 0.5 });
  const payload = buildFeedbackPayload(session, 12, 'needs_improvement', '改善点');
  let request;
  const result = await submitFeedback(payload, { fetchImpl: async (url, options) => { request = { url, options }; return { ok: true, async json() { return { ok: true, duplicate: true }; } }; } });
  assert.deepEqual(result, { ok: true, duplicate: true });
  assert.equal(request.url, '/api/feedback'); assert.equal(request.options.method, 'POST'); assert.deepEqual(JSON.parse(request.options.body), payload);
});

test('feedbackSubmitted round cursors are compatible with older and resumed records', () => {
  const storage = memory(); const session = createSession({ participants: ['A', 'B'], deck: pick('friends'), random: () => 0.5 });
  session.feedbackSubmitted = [6, 6, 99]; session.cursor = 6; session.unlockedUntil = 6; session.roundStart = 0; session.roundCount = 0; session.roundNumber = 2;
  assert.equal(saveSession(session, { storage, now: 1000 }), true);
  const raw = JSON.parse(storage.value); assert.deepEqual(raw.feedbackSubmitted, [6]);
  assert.deepEqual(loadSession({ storage, now: 1000 }).feedbackSubmitted, [6]);
  delete raw.feedbackSubmitted; storage.value = JSON.stringify(raw); assert.deepEqual(loadSession({ storage, now: 1000 }).feedbackSubmitted, []);
});

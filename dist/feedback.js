const COMPLETED_CURSORS = new Set([3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36, 39, 40]);

export function feedbackKey(sessionId, cursor) { return `${sessionId}:${cursor}`; }

export function buildFeedbackPayload(session, cursor, rating = null, text = '') {
  const total = Array.isArray(session?.questions) ? session.questions.length : 40;
  const roundSize = session?.mode === 'solo' || session?.roundSize === 6 ? 6 : 3;
  if (!session || typeof session.sessionId !== 'string' || cursor < roundSize || cursor > total || (cursor < total && cursor % roundSize !== 0)) throw new Error('feedback');
  const trimmed = typeof text === 'string' ? text.trim() : '';
  if (trimmed.length > 1000) throw new Error('feedback-text');
  const normalizedRating = rating === 'positive' || rating === 'needs_improvement' ? rating : null;
  if (!normalizedRating && !trimmed) throw new Error('feedback-empty');
  const themeIds = session.mixed ? [...(session.deckIds || [])] : [session.deckId];
  return { sessionId: session.sessionId, cursor, themeId: session.deckId, themeIds, rating: normalizedRating, text: trimmed };
}
export async function submitFeedback(payload, { fetchImpl = globalThis.fetch, signal } = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('feedback-network');
  const response = await fetchImpl('/api/feedback', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload), signal });
  let result = null;
  try { result = await response.json(); } catch {}
  if (!response.ok || !result?.ok) throw new Error('feedback-submit');
  return { ok: true, duplicate: result.duplicate === true };
}

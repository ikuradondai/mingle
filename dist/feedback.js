const COMPLETED_CURSORS = new Set([6, 12, 18, 24, 30, 36, 40]);

export function feedbackKey(sessionId, cursor) { return `${sessionId}:${cursor}`; }

export function buildFeedbackPayload(session, cursor, rating = null, text = '') {
  if (!session || typeof session.sessionId !== 'string' || !COMPLETED_CURSORS.has(cursor)) throw new Error('feedback');
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

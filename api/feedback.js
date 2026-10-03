import { ALLOWED_THEME_IDS } from '../server-side/config.mjs';
import { bodyWithLimit, exactKeys, json, sameOrigin } from '../server-side/http.mjs';
import { persistentStoreAvailable, recordFeedback } from '../server-side/store.mjs';
import { decks } from '../dist/data/decks.js';

const CURSORS = new Set([6, 12, 18, 24, 30, 36, 40]);
const SESSION_ID = /^[A-Za-z0-9-]{8,100}$/;
const REGULAR_THEME_IDS = new Set(decks.filter((deck) => !deck.adultOnly).map((deck) => deck.id));
function todayJst(date) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date); }

export default async function feedback(req, res) {
  if (req.method !== 'POST' || !sameOrigin(req)) return json(res, req.method !== 'POST' ? 405 : 403, { error: 'forbidden' });
  if (!persistentStoreAvailable()) return json(res, 503, { error: 'analytics_unavailable' });
  let input;
  try { input = await bodyWithLimit(req, 8192); } catch (error) { return json(res, error.status || 400, { error: 'invalid_request' }); }
  if (!exactKeys(input, ['sessionId', 'cursor', 'themeId', 'themeIds', 'rating', 'text'])) return json(res, 400, { error: 'invalid_feedback' });
  if (typeof input.sessionId !== 'string' || !SESSION_ID.test(input.sessionId)) return json(res, 400, { error: 'invalid_feedback' });
  const customSet = input.themeId === 'my-set';
  if (!Number.isSafeInteger(input.cursor) || (customSet ? input.cursor < 6 || input.cursor > 40 : !CURSORS.has(input.cursor))) return json(res, 400, { error: 'invalid_feedback' });
  if (typeof input.themeId !== 'string' || !ALLOWED_THEME_IDS.includes(input.themeId)) return json(res, 400, { error: 'invalid_feedback' });
  if (!Array.isArray(input.themeIds) || input.themeIds.some((id) => typeof id !== 'string') || new Set(input.themeIds).size !== input.themeIds.length) return json(res, 400, { error: 'invalid_feedback' });
  if (customSet) {
    if (input.themeIds.length !== 1 || input.themeIds[0] !== 'my-set') return json(res, 400, { error: 'invalid_feedback' });
  } else if (input.themeId === 'mix') {
    if (input.themeIds.length < 2 || input.themeIds.length > 3 || input.themeIds.some((id) => !REGULAR_THEME_IDS.has(id))) return json(res, 400, { error: 'invalid_feedback' });
  } else if (input.themeIds.length !== 1 || input.themeIds[0] !== input.themeId) return json(res, 400, { error: 'invalid_feedback' });
  if (input.rating !== null && input.rating !== 'positive' && input.rating !== 'needs_improvement') return json(res, 400, { error: 'invalid_feedback' });
  if (typeof input.text !== 'string') return json(res, 400, { error: 'invalid_feedback' });
  const text = input.text.trim();
  if (text.length > 1000 || (input.rating === null && !text)) return json(res, 400, { error: 'invalid_feedback' });
  const createdAt = new Date().toISOString();
  try {
    const written = await recordFeedback({ sessionId: input.sessionId, cursor: input.cursor, themeId: input.themeId, themeIds: input.themeIds, rating: input.rating, text, createdAt, date: todayJst(new Date(createdAt)) });
    return json(res, 200, { ok: true, duplicate: written === 0 });
  } catch { return json(res, 503, { error: 'analytics_unavailable' }); }
}

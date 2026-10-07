import { ALLOWED_THEME_IDS, PAGE_IDS } from '../server-side/config.mjs';
import { adminSession, body, clientRateKey, exactKeys, json, sameOrigin } from '../server-side/http.mjs';
import { consumeRate, fetchThemeStartStats, persistentStoreAvailable, recordEvent } from '../server-side/store.mjs';
function todayJst() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
function dateOffset(date, offset) { const [year, month, day] = String(date).split('-').map(Number); const value = new Date(Date.UTC(year, month - 1, day + offset)); return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(value); }
export function recommendationLabels(stats) {
  const yesterday = stats?.days?.[0]?.themes || {};
  const previous = stats?.days?.[1]?.themes || {};
  const ids = Object.keys(yesterday);
  const counts = ids.map((id) => [id, Number(yesterday[id]) || 0]).filter(([, count]) => count >= 5).sort((a, b) => b[1] - a[1]);
  const labels = {};
  if (counts.length && (counts.length === 1 || counts[0][1] > counts[1][1])) labels[counts[0][0]] = 'yesterday_top';
  for (const [id, count] of counts) {
    if (labels[id]) continue;
    const prior = Number(previous[id]) || 0;
    if (prior > 0 && count >= prior + 2 && count >= prior * 1.5) labels[id] = 'rising';
  }
  return labels;
}
let recommendationCache = { key: '', expiresAt: 0, payload: null, pending: null, error: null };
async function publicRecommendationPayload() {
  const yesterday = dateOffset(todayJst(), -1); const key = yesterday;
  if (recommendationCache.key === key && recommendationCache.payload && recommendationCache.expiresAt > Date.now()) return recommendationCache.payload;
  if (recommendationCache.key === key && recommendationCache.pending) return recommendationCache.pending;
  if (recommendationCache.key === key && recommendationCache.error && recommendationCache.expiresAt > Date.now()) throw recommendationCache.error;
  recommendationCache = { key, expiresAt: 0, payload: null, pending: null, error: null };
  recommendationCache.pending = fetchThemeStartStats([yesterday, dateOffset(yesterday, -1)]).then((stats) => {
    const payload = { labels: recommendationLabels(stats), asOf: yesterday };
    if (recommendationCache.key !== key) return payload;
    recommendationCache = { key, expiresAt: Date.now() + 5 * 60 * 1000, payload, pending: null, error: null };
    return payload;
  }).catch((error) => { if (recommendationCache.key === key) recommendationCache = { key, expiresAt: Date.now() + 30 * 1000, payload: null, pending: null, error }; throw error; });
  return recommendationCache.pending;
}
export default async function track(req, res) {
  const view = new URL(req.url || '/', 'http://localhost').searchParams.get('view');
  if (req.method === 'GET' && view === 'recommendations') {
    if (!sameOrigin(req)) return json(res, 403, { error: 'forbidden' });
    if (!persistentStoreAvailable()) return json(res, 503, { error: 'analytics_unavailable' });
    try {
      if (await consumeRate(clientRateKey(req, 'recommendations')) > 30) return json(res, 429, { error: 'rate_limited' });
      return json(res, 200, await publicRecommendationPayload(), { 'Cache-Control': 'no-cache, must-revalidate, s-maxage=300, stale-while-revalidate=60' });
    } catch { return json(res, 503, { error: 'analytics_unavailable' }); }
  }
  if (req.method !== 'POST' || !sameOrigin(req) || adminSession(req)) return json(res, req.method !== 'POST' ? 405 : 403, { error: 'forbidden' });
  if (!persistentStoreAvailable()) return json(res, 503, { error: 'analytics_unavailable' });
  let input; try { input = await body(req); } catch (e) { return json(res, e.status || 400, { error: 'invalid_request' }); }
  const progressTypes = ['round_complete', 'round_continue', 'session_complete'];
  const keys = input.type === 'page_view' ? ['type', 'pageId', 'eventId'] : ['theme_start', ...progressTypes].includes(input.type) ? ['type', 'themeId', 'eventId'] : [];
  if (!keys.length || !exactKeys(input, keys) || typeof input.eventId !== 'string' || input.eventId.length < 8 || input.eventId.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(input.eventId)) return json(res, 400, { error: 'invalid_event' });
  if (input.type === 'page_view' && (!PAGE_IDS.includes(input.pageId))) return json(res, 400, { error: 'invalid_event' });
  if (input.type !== 'page_view' && (!ALLOWED_THEME_IDS.includes(input.themeId))) return json(res, 400, { error: 'invalid_event' });
  try { if (await consumeRate(clientRateKey(req, 'track')) > 60) return json(res, 429, { error: 'rate_limited' }); } catch { return json(res, 503, { error: 'analytics_unavailable' }); }
  try { await recordEvent({ ...input, date: todayJst() }); return json(res, 202, { ok: true }); } catch { return json(res, 503, { error: 'analytics_unavailable' }); }
}

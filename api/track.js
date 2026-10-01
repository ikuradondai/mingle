import { ALLOWED_THEME_IDS, PAGE_IDS, SESSION_COOKIE } from '../server-side/config.mjs';
import { body, cookie, exactKeys, json, sameOrigin } from '../server-side/http.mjs';
import { persistentStoreAvailable, recordEvent } from '../server-side/store.mjs';
function todayJst() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
export default async function track(req, res) {
  if (req.method !== 'POST' || !sameOrigin(req) || cookie(req, SESSION_COOKIE)) return json(res, req.method !== 'POST' ? 405 : 403, { error: 'forbidden' });
  if (!persistentStoreAvailable()) return json(res, 503, { error: 'analytics_unavailable' });
  let input; try { input = await body(req); } catch (e) { return json(res, e.status || 400, { error: 'invalid_request' }); }
  const keys = input.type === 'page_view' ? ['type', 'pageId', 'eventId'] : input.type === 'theme_start' ? ['type', 'themeId', 'eventId'] : [];
  if (!keys.length || !exactKeys(input, keys) || typeof input.eventId !== 'string' || input.eventId.length < 8 || input.eventId.length > 100 || !/^[A-Za-z0-9._:-]+$/.test(input.eventId)) return json(res, 400, { error: 'invalid_event' });
  if (input.type === 'page_view' && (!PAGE_IDS.includes(input.pageId))) return json(res, 400, { error: 'invalid_event' });
  if (input.type === 'theme_start' && (!ALLOWED_THEME_IDS.includes(input.themeId))) return json(res, 400, { error: 'invalid_event' });
  try { await recordEvent({ ...input, date: todayJst() }); return json(res, 202, { ok: true }); } catch { return json(res, 503, { error: 'analytics_unavailable' }); }
}

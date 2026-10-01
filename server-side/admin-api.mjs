import { createHmac, timingSafeEqual } from 'node:crypto';
import { ALLOWED_THEME_IDS, PAGE_IDS, PAGE_LABELS, SESSION_COOKIE } from './config.mjs';
import { body, clearCookie, cookie, exactKeys, json, sameOrigin, setCookie, verifySession, signSession } from './http.mjs';
import { consumeRate, fetchStats, knownDates, persistentStoreAvailable, recordEvent } from './store.mjs';
import { decks } from '../dist/data/decks.js';
const themes = Object.fromEntries(decks.map((d) => [d.id, d.title]));
function configured() { return Boolean(process.env.ADMIN_PASSWORD && process.env.ADMIN_SESSION_SECRET) && persistentStoreAvailable(); }
function ipKey(req) { return createHmac('sha256', process.env.ADMIN_SESSION_SECRET || 'missing').update(String(req.headers?.['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown')).digest('hex').slice(0, 32); }
export async function sessionHandler(req, res) {
  if (!sameOrigin(req)) return json(res, 403, { error: 'forbidden' });
  if (req.method === 'GET') return verifySession(cookie(req, SESSION_COOKIE)) ? json(res, 200, { authenticated: true }) : json(res, 401, { authenticated: false });
  if (req.method === 'DELETE') { clearCookie(res); return json(res, 200, { ok: true }); }
  if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });
  if (!configured()) return json(res, 503, { error: 'analytics_unavailable' });
  let input; try { input = await body(req); } catch (e) { return json(res, e.status || 400, { error: 'invalid_request' }); }
  if (!exactKeys(input, ['password']) || typeof input.password !== 'string' || input.password.length > 512) return json(res, 400, { error: 'invalid_request' });
  let attempts; try { attempts = await consumeRate(ipKey(req)); } catch { return json(res, 503, { error: 'analytics_unavailable' }); }
  if (attempts > 10) return json(res, 429, { error: 'rate_limited' });
  const a = Buffer.from(input.password), b = Buffer.from(process.env.ADMIN_PASSWORD); const valid = a.length === b.length && timingSafeEqual(a, b);
  if (!valid) return json(res, 401, { error: 'invalid_password' });
  try { setCookie(res, signSession(), 4 * 60 * 60); return json(res, 200, { ok: true }); } catch { return json(res, 503, { error: 'analytics_unavailable' }); }
}
function datesFor(range) { const now = new Date(); const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }); const end = fmt.format(now); const count = range === 'today' ? 1 : range === '7d' ? 7 : range === '30d' ? 30 : 0; if (!count) return []; const dates = []; let d = new Date(`${end}T00:00:00+09:00`); for (let i = count - 1; i >= 0; i--) { const x = new Date(d); x.setDate(x.getDate() - i); dates.push(fmt.format(x)); } return dates; }
export async function statsHandler(req, res) {
  if (req.method !== 'GET') return json(res, 405, { error: 'method_not_allowed' }); if (!sameOrigin(req)) return json(res, 403, { error: 'forbidden' }); if (!verifySession(cookie(req, SESSION_COOKIE))) return json(res, 401, { error: 'unauthorized' });
  const range = new URL(req.url || '/', 'http://localhost').searchParams.get('range') || 'today'; if (!['today', '7d', '30d', 'all'].includes(range)) return json(res, 400, { error: 'invalid_range' });
  if (!persistentStoreAvailable()) return json(res, 503, { error: 'analytics_unavailable' }); try { const dates = range === 'all' ? allDates() : datesFor(range); const result = await fetchStats(dates); const page = {}, theme = {}, daily = []; for (const item of result.days) { daily.push({ date: item.date, pageViews: Number(item.day.pageViews || 0), themeStarts: Number(item.day.themeStarts || 0) }); for (const id of PAGE_IDS) page[id] = (page[id] || 0) + Number(item.pages[id] || 0); for (const id of ALLOWED_THEME_IDS) theme[id] = (theme[id] || 0) + Number(item.themes[id] || 0); } const totals = range === 'all' ? result.totals : { pageViews: daily.reduce((n, x) => n + x.pageViews, 0), themeStarts: daily.reduce((n, x) => n + x.themeStarts, 0) }; return json(res, 200, { range, timezone: 'Asia/Tokyo', trackingStartedAt: result.startedAt || null, updatedAt: result.updatedAt || new Date().toISOString(), totals: { pageViews: Number(totals.pageViews || 0), themeStarts: Number(totals.themeStarts || 0) }, pages: PAGE_IDS.map((id) => ({ id, label: PAGE_LABELS[id], count: page[id] || 0 })), themes: ALLOWED_THEME_IDS.map((id) => ({ id, label: themes[id] || id, count: theme[id] || 0 })), daily }); } catch { return json(res, 503, { error: 'analytics_unavailable' }); }
}
async function allDates() { if (process.env.ANALYTICS_ALL_DAYS) return process.env.ANALYTICS_ALL_DAYS.split(',').filter(Boolean); return knownDates(); }

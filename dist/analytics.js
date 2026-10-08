const seen = new Set();
let lastPage = null;
function eventId(prefix) { if (globalThis.crypto?.randomUUID) return `${prefix}:${crypto.randomUUID()}`; return `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2)}`; }
function send(payload) { try { const key = payload.eventId; if (seen.has(key)) return; seen.add(key); fetch('/api/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), keepalive: true }).catch(() => {}); } catch {} }
export function trackPage(pageId) { if (pageId === lastPage) return; lastPage = pageId; send({ type: 'page_view', pageId, eventId: eventId('page') }); }
export function trackThemeStart(themeId) { send({ type: 'theme_start', themeId, eventId: eventId('theme') }); }
const THEME_LIKE_TOKEN_KEY = 'mingle.analytics.voter-token.v1';
const THEME_LIKE_STATE_KEY = 'mingle.analytics.theme-likes.v1';
const themeLikePending = new Set();
let memoryVoterToken = '';
const memoryThemeLikes = new Set();
function readThemeLikeToken() {
  try {
    const saved = localStorage.getItem(THEME_LIKE_TOKEN_KEY);
    if (saved && /^[A-Za-z0-9_-]{32,128}$/.test(saved)) { memoryVoterToken = saved; return saved; }
    const token = globalThis.crypto?.randomUUID ? crypto.randomUUID().replace(/-/g, '') : `${Date.now()}${Math.random().toString(36).slice(2)}`;
    const normalized = token.padEnd(32, '0').slice(0, 128);
    memoryVoterToken = normalized;
    localStorage.setItem(THEME_LIKE_TOKEN_KEY, normalized);
    return normalized;
  } catch {
    if (!memoryVoterToken) memoryVoterToken = `${Date.now()}${Math.random().toString(36).slice(2)}`.replace(/[^A-Za-z0-9_-]/g, 'x').padEnd(32, '0').slice(0, 128);
    return memoryVoterToken;
  }
}
function readThemeLikeState() {
  try { const value = JSON.parse(localStorage.getItem(THEME_LIKE_STATE_KEY) || '[]'); const values = new Set(Array.isArray(value) ? value.filter((id) => typeof id === 'string') : []); values.forEach((id) => memoryThemeLikes.add(id)); return new Set([...values, ...memoryThemeLikes]); } catch { return new Set(memoryThemeLikes); }
}
function saveThemeLikeState(values) { values.forEach((id) => memoryThemeLikes.add(id)); try { localStorage.setItem(THEME_LIKE_STATE_KEY, JSON.stringify([...values].slice(-200))); } catch {} }
export function hasThemeLike(themeId) { return readThemeLikeState().has(String(themeId || '')); }
export async function submitThemeLike(themeId) {
  const id = String(themeId || '');
  if (!id || hasThemeLike(id)) return { ok: true, already: true };
  if (themeLikePending.has(id)) return { ok: false, pending: true };
  const voterToken = readThemeLikeToken();
  if (!voterToken) return { ok: false, error: '保存できませんでした。もう一度お試しください。' };
  themeLikePending.add(id);
  try {
    const response = await fetch('/api/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'theme_like', themeId: id, voterToken, eventId: eventId('theme-like') }), keepalive: true });
    let payload = null; try { payload = await response.json(); } catch {}
    if (!response.ok || payload?.ok !== true) return { ok: false, error: response.status === 429 ? '送信が混み合っています。もう一度お試しください。' : '送信できませんでした。もう一度お試しください。' };
    const values = readThemeLikeState(); values.add(id); saveThemeLikeState(values);
    return { ok: true, already: payload.accepted === false };
  } catch { return { ok: false, error: '送信できませんでした。もう一度お試しください。' }; }
  finally { themeLikePending.delete(id); }
}
const progressSeen = new Set();
function progressId(sessionId, milestone) { const safe = String(sessionId || '').replace(/[^A-Za-z0-9._:-]/g, '-'); return `session-${safe}-${milestone}`.slice(0, 128); }
function progressEvent(type, sessionId, themeId, milestone) { const id = progressId(sessionId, milestone); if (progressSeen.has(id)) return; progressSeen.add(id); send({ type, themeId, eventId: id }); }
export function trackSessionProgress(previousSession, nextSession) {
  if (!previousSession || !nextSession || !previousSession.sessionId || previousSession.sessionId !== nextSession.sessionId) return;
  const previous = Number(previousSession.cursor) || 0; const next = Number(nextSession.cursor) || 0; const themeId = nextSession.deckId;
  if (!themeId || next <= previous) {
    if (Number(nextSession.unlockedUntil) <= Number(previousSession.unlockedUntil || 0)) return;
  }
  for (const cursor of [6, 12, 18, 24, 30, 36]) if (previous < cursor && next >= cursor) progressEvent('round_complete', nextSession.sessionId, themeId, `round-complete-${cursor}`);
  if (Number(nextSession.unlockedUntil) > Number(previousSession.unlockedUntil || 0) && previous >= Number(previousSession.unlockedUntil || 0)) progressEvent('round_continue', nextSession.sessionId, themeId, `continue-${nextSession.unlockedUntil}`);
  const total = Array.isArray(nextSession.questions) ? nextSession.questions.length : 40;
  if (previous < total && next >= total) progressEvent('session_complete', nextSession.sessionId, themeId, 'session-complete');
}

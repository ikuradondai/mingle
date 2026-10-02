const seen = new Set();
let lastPage = null;
function eventId(prefix) { if (globalThis.crypto?.randomUUID) return `${prefix}:${crypto.randomUUID()}`; return `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2)}`; }
function send(payload) { try { const key = payload.eventId; if (seen.has(key)) return; seen.add(key); fetch('/api/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), keepalive: true }).catch(() => {}); } catch {} }
export function trackPage(pageId) { if (pageId === lastPage) return; lastPage = pageId; send({ type: 'page_view', pageId, eventId: eventId('page') }); }
export function trackThemeStart(themeId) { send({ type: 'theme_start', themeId, eventId: eventId('theme') }); }
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
  if (previous < 40 && next >= 40) progressEvent('session_complete', nextSession.sessionId, themeId, 'session-complete');
}

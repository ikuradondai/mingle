const seen = new Set();
let lastPage = null;
function eventId(prefix) { if (globalThis.crypto?.randomUUID) return `${prefix}:${crypto.randomUUID()}`; return `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2)}`; }
function send(payload) { try { const key = payload.eventId; if (seen.has(key)) return; seen.add(key); fetch('/api/track', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), keepalive: true }).catch(() => {}); } catch {} }
export function trackPage(pageId) { if (pageId === lastPage) return; lastPage = pageId; send({ type: 'page_view', pageId, eventId: eventId('page') }); }
export function trackThemeStart(themeId) { send({ type: 'theme_start', themeId, eventId: eventId('theme') }); }

let loaded = false;
let pending = null;
let labels = Object.create(null);
let asOf = '';
let retryAfter = 0;
let expiresAt = 0;
let refreshTimer = 0;
function jstDate() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
function yesterdayJst() { const [year, month, day] = jstDate().split('-').map(Number); return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.UTC(year, month - 1, day - 1))); }
function scheduleRefresh(onReady) {
  if (refreshTimer) return;
  const now = Date.now();
  const nextDue = Math.min(retryAfter || Infinity, expiresAt || Infinity);
  const delay = Math.max(1000, Math.min(60 * 1000, Number.isFinite(nextDue) ? nextDue - now : 60 * 1000));
  refreshTimer = globalThis.setTimeout(() => {
    refreshTimer = 0;
    const dateChanged = asOf && yesterdayJst() !== asOf;
    if (dateChanged) { loaded = false; labels = Object.create(null); retryAfter = 0; expiresAt = 0; if (typeof onReady === 'function') onReady(); }
    loadRecommendationLabels(onReady);
  }, delay);
}
export function recommendationLabel(themeId) { return asOf === yesterdayJst() ? (labels[themeId] || '') : ''; }
export function loadRecommendationLabels(onReady) {
  const expected = yesterdayJst();
  if (loaded && asOf === expected && expiresAt > Date.now()) { scheduleRefresh(onReady); return; }
  if (loaded && asOf !== expected) { loaded = false; labels = Object.create(null); expiresAt = 0; retryAfter = 0; }
  if (pending || Date.now() < retryAfter) { scheduleRefresh(onReady); return; }
  pending = fetch('/api/track?view=recommendations', { headers: { Accept: 'application/json' } })
    .then((response) => response.ok ? response.json() : null)
    .then((payload) => { if (!payload || payload.asOf !== expected || !payload.labels || typeof payload.labels !== 'object') throw new Error('invalid recommendation response'); labels = payload.labels; asOf = payload.asOf; loaded = true; expiresAt = Date.now() + 5 * 60 * 1000; retryAfter = 0; if (typeof onReady === 'function') onReady(); })
    .catch(() => { retryAfter = Date.now() + 30 * 1000; })
    .finally(() => { pending = null; scheduleRefresh(onReady); });
}

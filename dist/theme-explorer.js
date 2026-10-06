export const THEME_EXPLORER_IMAGES = {
  'moving-in': '/assets/theme-explorer/moving-in-v1.webp',
  neighbors: '/assets/theme-explorer/neighbors-v1.webp',
  'self-work': '/assets/theme-explorer/self-work-v1.webp',
  'bar-first-meeting': '/assets/theme-explorer/bar-first-meeting-v1.webp',
  'business-meetup': '/assets/theme-explorer/business-meetup-v1.webp',
  reunion: '/assets/theme-explorer/reunion-v1.webp',
  team: '/assets/theme-explorer/team-v1.webp',
  'ex-lovers': '/assets/theme-explorer/ex-lovers-v1.webp',
  'engaged-couple': '/assets/theme-explorer/engaged-couple-v1.webp',
  'self-school': '/assets/theme-explorer/self-school-v1.webp',
  date: '/assets/theme-explorer/date-v1.webp',
  'late-night-diner': '/assets/theme-explorer/late-night-diner-v1.webp',
  'group-mixer': '/assets/theme-explorer/group-mixer-v1.webp',
  'self-checkin': '/assets/theme-explorer/self-checkin-v1.webp',
  'new-couple': '/assets/theme-explorer/new-couple-v1.webp',
  'self-values': '/assets/theme-explorer/self-values-v1.webp',
  'intimacy-refresh': '/assets/theme-explorer/intimacy-refresh-v1.webp',
  'new-colleagues': '/assets/theme-explorer/new-colleagues-v1.webp',
  siblings: '/assets/theme-explorer/siblings-v1.webp',
  'self-crush': '/assets/theme-explorer/self-crush-v1.webp',
  'family-reunion': '/assets/theme-explorer/family-reunion-v1.webp',
  'parent-50plus': '/assets/theme-explorer/parent-50plus-v1.webp',
  'love-rivals': '/assets/theme-explorer/love-rivals-v1.webp',
  'intimacy-distance': '/assets/theme-explorer/intimacy-distance-v1.webp',
  'detective-and-phantom-thief': '/assets/theme-explorer/detective-and-phantom-thief-v1.webp',
  intimacy: '/assets/theme-explorer/intimacy-v1.webp',
  'grandparents-and-grandchildren': '/assets/theme-explorer/grandparents-and-grandchildren-v1.webp',
  roommates: '/assets/theme-explorer/roommates-v1.webp',
  'same-oshi-fans': '/assets/theme-explorer/same-oshi-fans-v1.webp',
  'acquaintance-date': '/assets/theme-explorer/acquaintance-date-v1.webp',
  classmates: '/assets/theme-explorer/classmates-v1.webp',
  friends: '/assets/theme-explorer/friends-v1.webp',
  'sports-teammates': '/assets/theme-explorer/sports-teammates-v1.webp',
  founders: '/assets/theme-explorer/founders-v1.webp',
  'assassin-and-target': '/assets/theme-explorer/assassin-and-target-v1.webp',
  couples: '/assets/theme-explorer/couples-v1.webp',
  'hero-and-demon-king': '/assets/theme-explorer/hero-and-demon-king-v1.webp',
  'first-intimacy': '/assets/theme-explorer/first-intimacy-v1.webp',
  'self-strengths': '/assets/theme-explorer/self-strengths-v1.webp',
  omiai: '/assets/theme-explorer/omiai-v1.webp',
  'self-club': '/assets/theme-explorer/self-club-v1.webp',
  'self-friends': '/assets/theme-explorer/self-friends-v1.webp',
  'self-love-now': '/assets/theme-explorer/self-love-now-v1.webp',
  'travel-companions': '/assets/theme-explorer/travel-companions-v1.webp',
  'arch-enemies': '/assets/theme-explorer/arch-enemies-v1.webp',
  'party-first-meeting': '/assets/theme-explorer/party-first-meeting-v1.webp',
  'promotion-rivals': '/assets/theme-explorer/promotion-rivals-v1.webp',
  'in-laws': '/assets/theme-explorer/in-laws-v1.webp',
  'self-breakup-lingering': '/assets/theme-explorer/self-breakup-lingering-v1.webp',
  'self-breakup-decided': '/assets/theme-explorer/self-breakup-decided-v1.webp',
  'parent-under12': '/assets/theme-explorer/parent-under12-v1.webp',
};

export function themeExplorerImage(id) {
  return typeof id === 'string' && Object.hasOwn(THEME_EXPLORER_IMAGES, id) ? THEME_EXPLORER_IMAGES[id] : null;
}

const KEY = 'mingle.theme-explorer.history.v1';
const BUCKETS = ['group', 'solo'];
function isRecord(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function safeOwner(ownerId) { return typeof ownerId === 'string' && ownerId.trim() ? ownerId : 'guest'; }
function safeBucket(mode) { return mode === 'solo' ? 'solo' : 'group'; }
function normalizeIds(value) { return Array.isArray(value) ? [...new Set(value.filter((id) => typeof id === 'string' && id.trim()))] : []; }
function normalizeRows(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set(); const rows = [];
  for (const row of value) {
    if (!isRecord(row)) continue;
    const startedAt = typeof row.startedAt === 'string' ? row.startedAt : new Date(0).toISOString();
    for (const id of normalizeIds(row.themeIds)) {
      if (seen.has(id)) continue;
      seen.add(id); rows.push({ themeIds: [id], startedAt });
      if (rows.length >= 12) return rows;
    }
  }
  return rows;
}
function readHistory() {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    const parsed = JSON.parse(typeof raw === 'string' && raw ? raw : '{}');
    if (!isRecord(parsed)) return {};
    const normalized = {};
    for (const [owner, value] of Object.entries(parsed)) {
      if (!isRecord(value)) continue;
      normalized[owner] = {};
      for (const bucket of BUCKETS) normalized[owner][bucket] = normalizeRows(value[bucket]);
    }
    return normalized;
  } catch { return {}; }
}
function writeHistory(value) { try { globalThis.localStorage?.setItem(KEY, JSON.stringify(value)); } catch {} }
export function recordThemeExplorerStart({ ownerId = null, mode = 'group', themeIds = [] } = {}) {
  const ids = normalizeIds(themeIds); if (!ids.length) return;
  const owner = safeOwner(ownerId); const bucket = safeBucket(mode); const history = readHistory();
  const ownerHistory = isRecord(history[owner]) ? history[owner] : {}; const current = normalizeRows(ownerHistory[bucket]);
  const now = new Date().toISOString(); const touched = new Set(ids);
  ownerHistory[bucket] = [...ids.map((id) => ({ themeIds: [id], startedAt: now })), ...current.filter((row) => !touched.has(row.themeIds[0]))].slice(0, 12);
  history[owner] = ownerHistory; writeHistory(history);
}
export function themeExplorerHistory(ownerId = null, mode = 'group') {
  return normalizeRows(readHistory()[safeOwner(ownerId)]?.[safeBucket(mode)]);
}

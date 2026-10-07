export const THEME_EXPLORER_IMAGES = {
  'moving-in': '/assets/theme-explorer/moving-in-v3.webp',
  neighbors: '/assets/theme-explorer/neighbors-v3.webp',
  'self-work': '/assets/theme-explorer/self-work-v3.webp',
  'bar-first-meeting': '/assets/theme-explorer/bar-first-meeting-v3.webp',
  'business-meetup': '/assets/theme-explorer/business-meetup-v3.webp',
  reunion: '/assets/theme-explorer/reunion-v3.webp',
  team: '/assets/theme-explorer/team-v3.webp',
  'ex-lovers': '/assets/theme-explorer/ex-lovers-v3.webp',
  'engaged-couple': '/assets/theme-explorer/engaged-couple-v3.webp',
  'self-school': '/assets/theme-explorer/self-school-v3.webp',
  date: '/assets/theme-explorer/date-v3.webp',
  'late-night-diner': '/assets/theme-explorer/late-night-diner-v3.webp',
  'group-mixer': '/assets/theme-explorer/group-mixer-v3.webp',
  'self-checkin': '/assets/theme-explorer/self-checkin-v3.webp',
  'new-couple': '/assets/theme-explorer/new-couple-v3.webp',
  'self-values': '/assets/theme-explorer/self-values-v3.webp',
  'intimacy-refresh': '/assets/theme-explorer/intimacy-refresh-v3.webp',
  'new-colleagues': '/assets/theme-explorer/new-colleagues-v3.webp',
  siblings: '/assets/theme-explorer/siblings-v3.webp',
  'self-crush': '/assets/theme-explorer/self-crush-v3.webp',
  'family-reunion': '/assets/theme-explorer/family-reunion-v3.webp',
  'parent-50plus': '/assets/theme-explorer/parent-50plus-v3.webp',
  'love-rivals': '/assets/theme-explorer/love-rivals-v3.webp',
  'intimacy-distance': '/assets/theme-explorer/intimacy-distance-v3.webp',
  'detective-and-phantom-thief': '/assets/theme-explorer/detective-and-phantom-thief-v3.webp',
  intimacy: '/assets/theme-explorer/intimacy-v3.webp',
  'grandparents-and-grandchildren': '/assets/theme-explorer/grandparents-and-grandchildren-v3.webp',
  roommates: '/assets/theme-explorer/roommates-v3.webp',
  'same-oshi-fans': '/assets/theme-explorer/same-oshi-fans-v3.webp',
  'acquaintance-date': '/assets/theme-explorer/acquaintance-date-v3.webp',
  classmates: '/assets/theme-explorer/classmates-v3.webp',
  friends: '/assets/theme-explorer/friends-v3.webp',
  'sports-teammates': '/assets/theme-explorer/sports-teammates-v3.webp',
  founders: '/assets/theme-explorer/founders-v3.webp',
  'assassin-and-target': '/assets/theme-explorer/assassin-and-target-v3.webp',
  couples: '/assets/theme-explorer/couples-v3.webp',
  'hero-and-demon-king': '/assets/theme-explorer/hero-and-demon-king-v3.webp',
  'first-intimacy': '/assets/theme-explorer/first-intimacy-v3.webp',
  'self-strengths': '/assets/theme-explorer/self-strengths-v3.webp',
  omiai: '/assets/theme-explorer/omiai-v3.webp',
  'self-club': '/assets/theme-explorer/self-club-v3.webp',
  'self-friends': '/assets/theme-explorer/self-friends-v3.webp',
  'self-love-now': '/assets/theme-explorer/self-love-now-v3.webp',
  'travel-companions': '/assets/theme-explorer/travel-companions-v3.webp',
  'arch-enemies': '/assets/theme-explorer/arch-enemies-v3.webp',
  'party-first-meeting': '/assets/theme-explorer/party-first-meeting-v3.webp',
  'promotion-rivals': '/assets/theme-explorer/promotion-rivals-v3.webp',
  'in-laws': '/assets/theme-explorer/in-laws-v3.webp',
  'self-breakup-lingering': '/assets/theme-explorer/self-breakup-lingering-v3.webp',
  'self-breakup-decided': '/assets/theme-explorer/self-breakup-decided-v3.webp',
  'parent-under12': '/assets/theme-explorer/parent-under12-v3.webp',
};

export function themeExplorerImage(id) {
  return typeof id === 'string' && Object.hasOwn(THEME_EXPLORER_IMAGES, id) ? THEME_EXPLORER_IMAGES[id] : null;
}

const KEY = 'mingle.theme-explorer.history.v1';
const BOOKMARK_KEY = 'mingle.theme-explorer.bookmarks.v1';
const EXPERIENCED_KEY = 'mingle.theme-explorer.experienced.v1';
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
function readBookmarks() {
  try {
    const raw = globalThis.localStorage?.getItem(BOOKMARK_KEY);
    const parsed = JSON.parse(typeof raw === 'string' && raw ? raw : '{}');
    if (!isRecord(parsed)) return {};
    const normalized = {};
    for (const [owner, ids] of Object.entries(parsed)) normalized[owner] = normalizeIds(ids);
    return normalized;
  } catch { return {}; }
}
function writeBookmarks(value) { try { globalThis.localStorage?.setItem(BOOKMARK_KEY, JSON.stringify(value)); } catch {} }
export function themeExplorerBookmarks(ownerId = null) { return normalizeIds(readBookmarks()[safeOwner(ownerId)]); }
export function toggleThemeExplorerBookmark(id, ownerId = null) {
  if (typeof id !== 'string' || !id.trim()) return false;
  const owner = safeOwner(ownerId); const all = readBookmarks(); const current = new Set(normalizeIds(all[owner]));
  if (current.has(id)) current.delete(id); else current.add(id);
  all[owner] = [...current]; writeBookmarks(all); return current.has(id);
}
function readExperienced() {
  try {
    const raw = globalThis.localStorage?.getItem(EXPERIENCED_KEY);
    const parsed = JSON.parse(typeof raw === 'string' && raw ? raw : '{}');
    if (!isRecord(parsed)) return {};
    const normalized = {};
    for (const [owner, ids] of Object.entries(parsed)) normalized[owner] = normalizeIds(ids);
    return normalized;
  } catch { return {}; }
}
function writeExperienced(value) { try { globalThis.localStorage?.setItem(EXPERIENCED_KEY, JSON.stringify(value)); } catch {} }
export function themeExplorerExperienced(ownerId = null) { return normalizeIds(readExperienced()[safeOwner(ownerId)]); }
export function toggleThemeExplorerExperienced(id, ownerId = null) {
  if (typeof id !== 'string' || !id.trim()) return false;
  const owner = safeOwner(ownerId); const all = readExperienced(); const current = new Set(normalizeIds(all[owner]));
  if (current.has(id)) current.delete(id); else current.add(id);
  all[owner] = [...current]; writeExperienced(all); return current.has(id);
}
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

// Deterministic ranking shared by group and solo explorers. Availability is
// always primary; history only supplies a small, explainable category affinity.
export function rankThemeRecommendations({ decks = [], historyRows = [], baseIds = [], limit = 8, isAvailable = () => true, categoryOf = () => [] } = {}) {
  const historyIds = new Set(historyRows.flatMap((row) => row?.themeIds || []).filter((id) => typeof id === 'string'));
  const recent = historyRows.flatMap((row) => row?.themeIds || []).find((id) => decks.some((deck) => deck.id === id));
  const recentCategories = new Set(recent ? categoryOf(decks.find((deck) => deck.id === recent)) : []);
  const preferred = new Map(baseIds.map((id, index) => [id, index]));
  const pool = decks.map((deck, index) => {
    const categories = categoryOf(deck);
    return {
      deck, index,
      available: isAvailable(deck) ? 1 : 0,
      unplayed: historyIds.has(deck.id) ? 0 : 1,
      affinity: categories.some((category) => recentCategories.has(category)) ? 1 : 0,
      baseIndex: preferred.has(deck.id) ? preferred.get(deck.id) : baseIds.length + index,
    };
  });
  pool.sort((a, b) => b.available - a.available || b.unplayed - a.unplayed || b.affinity - a.affinity || a.baseIndex - b.baseIndex || a.index - b.index);
  const picked = [];
  const seenCategories = new Set();
  const pickTier = (tier) => {
    for (const item of tier) {
      if (picked.length >= limit) return;
      const categories = categoryOf(item.deck);
      if (categories.some((category) => !seenCategories.has(category))) {
        picked.push(item.deck); categories.forEach((category) => seenCategories.add(category));
      }
    }
    for (const item of tier) {
      if (picked.length >= limit) return;
      if (!picked.includes(item.deck)) picked.push(item.deck);
    }
  };
  // Complete each priority tier before moving on. Category diversity never
  // allows a locked or already-played card to outrank an available candidate.
  pickTier(pool.filter((entry) => entry.available === 1 && entry.unplayed === 1));
  pickTier(pool.filter((entry) => entry.available === 1 && entry.unplayed === 0));
  pickTier(pool.filter((entry) => entry.available === 0 && entry.unplayed === 1));
  pickTier(pool.filter((entry) => entry.available === 0 && entry.unplayed === 0));
  return picked;
}

// Pure helpers for per-account theme visibility. A checked id means hidden.
export function normalizeThemeIds(ids, validIds) {
  const allowed = validIds instanceof Set ? validIds : new Set(validIds || []);
  return [...new Set(Array.isArray(ids) ? ids.filter((id) => typeof id === 'string' && allowed.has(id)) : [])];
}
export function categoryVisibility(themeIds, hiddenIds) {
  const ids = [...new Set(themeIds || [])];
  const hidden = hiddenIds instanceof Set ? hiddenIds : new Set(hiddenIds || []);
  const count = ids.filter((id) => hidden.has(id)).length;
  return { state: count === 0 ? 'none' : count === ids.length ? 'all' : 'some', count, total: ids.length };
}
export function applyCategoryVisibility(hiddenIds, themeIds, checked) {
  const next = new Set(hiddenIds || []);
  for (const id of new Set(themeIds || [])) checked ? next.add(id) : next.delete(id);
  return next;
}
export function applyThemeVisibility(hiddenIds, id, checked) {
  const next = new Set(hiddenIds || []);
  if (checked) next.add(id); else next.delete(id);
  return next;
}
export function restoreAllThemes() { return new Set(); }

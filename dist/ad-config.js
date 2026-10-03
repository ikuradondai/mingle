const DEFAULT_CONFIG = null;
function validUrl(value) { if (typeof value !== 'string' || !value.trim()) return null; try { const url = new URL(value, globalThis.location?.origin || 'https://mingle.cards/'); return (url.protocol === 'http:' || url.protocol === 'https:') ? url.href : null; } catch { return null; } }
export function getAdConfig() {
  const candidate = globalThis.__MINGLE_AD_CONFIG__ || DEFAULT_CONFIG;
  if (!candidate || candidate.enabled !== true) return null;
  const url = validUrl(candidate.url);
  if (!url || typeof candidate.title !== 'string' || !candidate.title.trim() || typeof candidate.description !== 'string') return null;
  return { title: candidate.title.trim().slice(0, 120), description: candidate.description.trim().slice(0, 240), url };
}
export function renderAd(slot) {
  const config = getAdConfig(); if (!config) return '';
  return `<aside class="ad-slot" data-ad-slot="${String(slot || '').replace(/[^a-z0-9-]/gi, '')}" aria-label="広告"><span class="ad-label">広告</span><a href="${config.url.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}" target="_blank" rel="noopener noreferrer"> <strong>${config.title.replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]))}</strong><small>${config.description.replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]))}</small></a></aside>`;
}

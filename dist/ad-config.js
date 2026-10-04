const DEFAULT_CONFIG = {
  enabled: true,
  url: 'https://sbm.erudaite.ai',
  brand: 'Stand By Me',
  logo: '/assets/stand-by-me-logo.png',
  logoAlt: 'Stand By Me',
  title: 'PDFもPPTもレイアウトの崩れない超高精度翻訳。カラーコピーよりずっと安く',
  headline: 'PDFもPPTもレイアウトの崩れない超高精度翻訳。',
  subline: 'カラーコピーよりずっと安く',
  cta: '詳しく見る',
  description: ''
};
function validUrl(value) { if (typeof value !== 'string' || !value.trim()) return null; try { const url = new URL(value, globalThis.location?.origin || 'https://mingle.cards/'); return (url.protocol === 'http:' || url.protocol === 'https:') ? url.href : null; } catch { return null; } }
export function getAdConfig() {
  const candidate = globalThis.__MINGLE_AD_CONFIG__ || DEFAULT_CONFIG;
  if (!candidate || candidate.enabled !== true) return null;
  const url = validUrl(candidate.url);
  if (!url || typeof candidate.title !== 'string' || !candidate.title.trim()) return null;
  return { brand: typeof candidate.brand === 'string' ? candidate.brand.trim().slice(0, 60) : '', logo: typeof candidate.logo === 'string' ? candidate.logo : '', logoAlt: typeof candidate.logoAlt === 'string' ? candidate.logoAlt : '', title: candidate.title.trim().slice(0, 160), headline: typeof candidate.headline === 'string' && candidate.headline.trim() ? candidate.headline.trim().slice(0, 120) : candidate.title.trim().slice(0, 160), subline: typeof candidate.subline === 'string' ? candidate.subline.trim().slice(0, 80) : '', description: typeof candidate.description === 'string' ? candidate.description.trim().slice(0, 240) : '', cta: typeof candidate.cta === 'string' && candidate.cta.trim() ? candidate.cta.trim().slice(0, 40) : '詳しく見る', url };
}
export function renderAd(slot) {
  const config = getAdConfig(); if (!config) return '';
  const esc = (value) => String(value).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  const image = config.logo ? `<img class="ad-logo" src="${esc(config.logo)}" alt="${esc(config.logoAlt || config.brand)}" loading="lazy" onerror="this.hidden=true;this.nextElementSibling.hidden=false" /><span class="ad-brand" hidden>${esc(config.brand)}</span>` : `<span class="ad-brand">${esc(config.brand)}</span>`;
  return `<aside class="ad-slot" data-ad-slot="${String(slot || '').replace(/[^a-z0-9-]/gi, '')}" aria-label="広告"><span class="ad-label">広告</span><a href="${esc(config.url)}" target="_blank" rel="sponsored noopener noreferrer">${image}<span class="ad-copy"><strong><span class="ad-headline">${esc(config.headline)}</span>${config.subline ? `<span class="ad-subline">${esc(config.subline)}</span>` : ''}</strong>${config.description ? `<small>${esc(config.description)}</small>` : ''}</span><span class="ad-cta">${esc(config.cta)}<span aria-hidden="true">→</span></span></a></aside>`;
}

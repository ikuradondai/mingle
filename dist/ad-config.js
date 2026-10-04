const DEFAULT_CONFIG = {
  enabled: true,
  url: 'https://sbm.erudaite.ai',
  brand: 'Stand By Me',
  logo: '/assets/stand-by-me-logo.png',
  logoAlt: 'Stand By Me',
  creativeDesktop: '/assets/sbm-banner-ai-layout-v1.png',
  creativeMobile: '/assets/sbm-banner-ai-layout-v1.png',
  creativeAlt: 'Stand By Me — PDF・PPTの超高精度翻訳。レイアウトそのまま。まずは無料で試してみる',
  title: 'PDFもPPTもレイアウトの崩れない超高精度翻訳。カラーコピーよりずっと安く',
  headline: 'PDFもPPTもレイアウトの崩れない超高精度翻訳。',
  subline: 'カラーコピーよりずっと安く',
  cta: 'まずは無料で試してみる',
  description: ''
};
function validUrl(value) { if (typeof value !== 'string' || !value.trim()) return null; try { const url = new URL(value, globalThis.location?.origin || 'https://mingle.cards/'); return (url.protocol === 'http:' || url.protocol === 'https:') ? url.href : null; } catch { return null; } }
export function getAdConfig() {
  const candidate = globalThis.__MINGLE_AD_CONFIG__ || DEFAULT_CONFIG;
  if (!candidate || candidate.enabled !== true) return null;
  const url = validUrl(candidate.url);
  if (!url || typeof candidate.title !== 'string' || !candidate.title.trim()) return null;
  const isDefault = candidate === DEFAULT_CONFIG;
  return { brand: typeof candidate.brand === 'string' ? candidate.brand.trim().slice(0, 60) : '', logo: typeof candidate.logo === 'string' ? candidate.logo : '', logoAlt: typeof candidate.logoAlt === 'string' ? candidate.logoAlt : '', creativeDesktop: isDefault && typeof candidate.creativeDesktop === 'string' ? candidate.creativeDesktop : '', creativeMobile: isDefault && typeof candidate.creativeMobile === 'string' ? candidate.creativeMobile : '', creativeAlt: isDefault && typeof candidate.creativeAlt === 'string' && candidate.creativeAlt.trim() ? candidate.creativeAlt.trim().slice(0, 160) : '', title: candidate.title.trim().slice(0, 160), headline: typeof candidate.headline === 'string' && candidate.headline.trim() ? candidate.headline.trim().slice(0, 120) : candidate.title.trim().slice(0, 160), subline: typeof candidate.subline === 'string' ? candidate.subline.trim().slice(0, 80) : '', description: typeof candidate.description === 'string' ? candidate.description.trim().slice(0, 240) : '', cta: typeof candidate.cta === 'string' && candidate.cta.trim() ? candidate.cta.trim().slice(0, 40) : '詳しく見る', url };
}
export function renderAd(slot) {
  const config = getAdConfig(); if (!config) return '';
  const esc = (value) => String(value).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
  const hasCreative = Boolean(config.creativeDesktop || config.creativeMobile);
  const image = hasCreative ? `<picture class="ad-creative"><source media="(max-width: 540px)" srcset="${esc(config.creativeMobile || config.creativeDesktop)}"><img src="${esc(config.creativeDesktop || config.creativeMobile)}" alt="" loading="eager" onerror="this.closest('.ad-creative').hidden=true;this.closest('.ad-slot').classList.add('ad-creative-failed')"></picture>` : config.logo ? `<img class="ad-logo" src="${esc(config.logo)}" alt="${esc(config.logoAlt || config.brand)}" loading="lazy" onerror="this.hidden=true;this.nextElementSibling.hidden=false" /><span class="ad-brand" hidden>${esc(config.brand)}</span>` : `<span class="ad-brand">${esc(config.brand)}</span>`;
  const creativeMarkup = hasCreative ? `<span class="ad-creative-art" aria-hidden="true">${image}</span><span class="ad-creative-content"><span class="ad-creative-brand">${config.logo ? `<img class="ad-creative-logo" src="${esc(config.logo)}" alt="" aria-hidden="true" onerror="this.hidden=true;this.nextElementSibling.hidden=false" /><span class="ad-creative-brand-fallback" hidden>${esc(config.brand)}</span>` : esc(config.brand)}</span><span class="ad-creative-kicker">PDF・PPTの超高精度翻訳</span><strong class="ad-creative-headline"><span>レイアウト、</span><span>そのまま。</span></strong><span class="ad-creative-subline">カラーコピーよりずっと安く</span></span><span class="ad-cta">${esc(config.cta)}<span aria-hidden="true">→</span></span>` : `<span class="ad-copy"><strong><span class="ad-headline">${esc(config.headline)}</span>${config.subline ? `<span class="ad-subline">${esc(config.subline)}</span>` : ''}</strong>${config.description ? `<small>${esc(config.description)}</small>` : ''}</span><span class="ad-cta">${esc(config.cta)}<span aria-hidden="true">→</span></span>`;
  const accessibleLabel = `${config.brand} — ${config.title} — ${config.cta}`;
  return `<aside class="ad-slot${hasCreative ? ' ad-slot-creative' : ''}" data-ad-slot="${String(slot || '').replace(/[^a-z0-9-]/gi, '')}" aria-label="広告"><span class="ad-label">広告</span><a href="${esc(config.url)}" target="_blank" rel="sponsored noopener noreferrer" title="${esc(accessibleLabel)}" aria-label="${esc(accessibleLabel)}">${hasCreative ? creativeMarkup : `${image}${creativeMarkup}`}</a></aside>`;
}

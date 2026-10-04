(function (root) {
  'use strict';

  const KEY = 'mingle.lp.experience.v1';
  const VERSION = 1;
  const TTL = 30 * 24 * 60 * 60 * 1000;
  const EXPERIENCES = new Set(['everyday', 'date', 'team']);
  const CAMPAIGNS = new Map([
    ['mingle-date', 'date'], ['date', 'date'], ['romance', 'date'], ['couple', 'date'], ['first-date', 'date'],
    ['mingle-team', 'team'], ['team', 'team'], ['work', 'team'], ['meetup', 'team'], ['business', 'team'], ['team-meetup', 'team'],
    ['mingle-everyday', 'everyday'], ['everyday', 'everyday'], ['family', 'everyday'], ['friends', 'everyday'], ['general', 'everyday'], ['everyday-friends', 'everyday'],
  ]);

  const validExperience = (value) => {
    const normalized = typeof value === 'string' ? value.trim().toLowerCase() : '';
    return EXPERIENCES.has(normalized) ? normalized : null;
  };
  const campaignExperience = (value) => CAMPAIGNS.get(typeof value === 'string' ? value.trim().toLowerCase() : '') || null;
  const clock = (now) => now === undefined ? Date.now() : now;

  function readSaved(storage, now) {
    if (!storage) return null;
    try {
      const value = JSON.parse(storage.getItem(KEY) || 'null');
      const at = value?.at;
      if (value?.v !== VERSION || !validExperience(value.experience) || !Number.isFinite(at) || at > now || now - at < 0 || now - at >= TTL) {
        if (value !== null) { try { storage.removeItem(KEY); } catch (_) {} }
        return null;
      }
      return validExperience(value.experience);
    } catch (_) { try { storage.removeItem(KEY); } catch (__) {} return null; }
  }

  function resolve(options) {
    const input = options || {};
    const search = typeof input.search === 'string' ? input.search : '';
    const params = new URLSearchParams(search);
    const query = validExperience(params.get('experience'));
    if (query) return { experience: query, source: 'query' };
    const content = campaignExperience(params.get('utm_content'));
    if (content) return { experience: content, source: 'utm_content' };
    const campaign = campaignExperience(params.get('utm_campaign'));
    if (campaign) return { experience: campaign, source: 'utm_campaign' };
    const saved = readSaved(input.storage, clock(input.now));
    if (saved) return { experience: saved, source: 'saved' };
    return { experience: 'everyday', source: 'default' };
  }

  function remember(storage, experience, now) {
    const value = validExperience(experience);
    if (!storage || !value) return false;
    const at = clock(now);
    if (!Number.isFinite(at)) return false;
    try { storage.setItem(KEY, JSON.stringify({ v: VERSION, experience: value, at })); return true; } catch (_) { return false; }
  }

  function forget(storage) {
    if (!storage) return false;
    try { storage.removeItem(KEY); return true; } catch (_) { return false; }
  }

  function asUrl(currentUrl) {
    try {
      const absolute = /^[a-z][a-z\d+.-]*:/i.test(currentUrl);
      return { url: new URL(currentUrl, 'https://mingle.local'), absolute };
    } catch (_) { return null; }
  }
  function stringify(parsed) {
    return parsed.absolute ? parsed.url.href : `${parsed.url.pathname}${parsed.url.search}${parsed.url.hash}`;
  }
  function selectionUrl(currentUrl, experience) {
    const value = validExperience(experience), parsed = asUrl(currentUrl);
    if (!value || !parsed) return currentUrl;
    parsed.url.searchParams.set('experience', value);
    return stringify(parsed);
  }
  function resetUrl(currentUrl) {
    const parsed = asUrl(currentUrl);
    if (!parsed) return currentUrl;
    const params = parsed.url.searchParams;
    params.delete('experience');
    for (const name of ['utm_content', 'utm_campaign']) {
      const value = params.get(name);
      if (campaignExperience(value)) params.delete(name);
    }
    return stringify(parsed);
  }

  const api = { resolve, remember, forget, selectionUrl, resetUrl };
  root.MingleExperienceRouting = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
}(typeof globalThis !== 'undefined' ? globalThis : this));

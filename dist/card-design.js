const FAMILY_ASSETS = {
  welcome: { front: '/assets/card-families/first-meeting-front.webp', back: '/assets/card-families/first-meeting-back.webp', accent: '#ef6a55' },
  romance: { front: '/assets/card-families/love-front.webp', back: '/assets/card-families/love-back.webp', accent: '#e9b62f' },
  friends: { front: '/assets/card-families/friends-front.webp', back: '/assets/card-families/friends-back.webp', accent: '#5eb59d' },
  family: { front: '/assets/card-families/family-front.webp', back: '/assets/card-families/family-back.webp', accent: '#e9a35d' },
  work: { front: '/assets/card-families/work-front.webp', back: '/assets/card-families/work-back.webp', accent: '#326d74' },
  sports: { front: '/assets/card-families/sports-front.webp', back: '/assets/card-families/sports-back.webp', accent: '#1769e8' },
  roleplay: { front: '/assets/card-families/roleplay-front.webp', back: '/assets/card-families/roleplay-back.webp', accent: '#6d5ab8' },
  self: { front: '/assets/card-families/self-front.webp', back: '/assets/card-families/self-back.webp', accent: '#8471c6' },
  adult: { front: '/assets/card-families/adult-front.webp', back: '/assets/card-families/adult-back.webp', accent: '#7d3457' },
};
import { CREATOR_PRESETS, normalizeCreatorDesign } from './creator-metadata.js';
const DECK_FAMILIES = {
  date: 'welcome', 'business-meetup': 'welcome', 'acquaintance-date': 'welcome', omiai: 'welcome', 'party-first-meeting': 'welcome', 'bar-first-meeting': 'welcome', neighbors: 'welcome', 'group-mixer': 'welcome', classmates: 'welcome',
  couples: 'romance', 'new-couple': 'romance', 'moving-in': 'romance', 'engaged-couple': 'romance', 'ex-lovers': 'romance', 'love-rivals': 'romance',
  friends: 'friends', reunion: 'friends', siblings: 'family', 'same-oshi-fans': 'friends', roommates: 'friends', 'travel-companions': 'friends', 'late-night-diner': 'friends',
  'parent-50plus': 'family', 'parent-under12': 'family', 'family-reunion': 'family', 'in-laws': 'family', 'grandparents-and-grandchildren': 'family',
  founders: 'work', team: 'work', 'new-colleagues': 'work', 'promotion-rivals': 'work',
  'sports-teammates': 'sports',
  'hero-and-demon-king': 'roleplay', 'assassin-and-target': 'roleplay', 'arch-enemies': 'roleplay', 'detective-and-phantom-thief': 'roleplay',
  'self-love-now': 'self', 'self-crush': 'self', 'self-breakup-decided': 'self', 'self-breakup-lingering': 'self', 'self-strengths': 'self', 'self-work': 'self', 'self-school': 'self', 'self-club': 'self', 'self-friends': 'self', 'self-values': 'self', 'self-checkin': 'self',
  intimacy: 'adult', 'first-intimacy': 'adult', 'intimacy-refresh': 'adult', 'intimacy-distance': 'adult',
};
const VARIANT_PALETTES = { welcome: ['#ef6a55','#1769e8','#e9b62f','#4da99a'], romance: ['#e9b62f','#ef6a55','#b65d87','#1769e8'], friends: ['#5eb59d','#1769e8','#ef6a55','#e9b62f'], family: ['#e9a35d','#5eb59d','#ef6a55','#8471c6'], work: ['#326d74','#1769e8','#e9b62f','#5eb59d'], sports: ['#1769e8','#ef6a55','#e9b62f','#326d74'], roleplay: ['#6d5ab8','#1769e8','#ef6a55','#e9b62f'], self: ['#8471c6','#1769e8','#5eb59d','#e9b62f'], adult: ['#7d3457','#a94f64','#9b6a3a','#5a315d'] };
// Explicit variants keep neighboring decks visually distinct without a hash that can
// accidentally make unrelated themes look alike when a deck id changes.
const DECK_VARIANTS = {
  date: 0, 'acquaintance-date': 1, omiai: 2, 'party-first-meeting': 3, 'bar-first-meeting': 0, neighbors: 1, 'group-mixer': 2, classmates: 3, 'business-meetup': 0,
  couples: 0, 'new-couple': 1, 'moving-in': 2, 'engaged-couple': 3, 'ex-lovers': 0, 'love-rivals': 1,
  friends: 0, reunion: 1, 'same-oshi-fans': 2, roommates: 3, 'travel-companions': 0, 'late-night-diner': 1,
  'parent-50plus': 0, 'parent-under12': 1, 'family-reunion': 2, siblings: 3, 'in-laws': 0, 'grandparents-and-grandchildren': 1,
  founders: 0, team: 1, 'new-colleagues': 2, 'promotion-rivals': 3, 'sports-teammates': 0,
  'hero-and-demon-king': 0, 'assassin-and-target': 1, 'arch-enemies': 2, 'detective-and-phantom-thief': 3,
  'self-love-now': 0, 'self-crush': 1, 'self-breakup-decided': 2, 'self-breakup-lingering': 3, 'self-strengths': 0, 'self-work': 1, 'self-school': 2, 'self-club': 3, 'self-friends': 0, 'self-values': 1, 'self-checkin': 2,
  intimacy: 0, 'first-intimacy': 1, 'intimacy-refresh': 2, 'intimacy-distance': 3,
};
function variantAccent(deckId, family) { return VARIANT_PALETTES[family][DECK_VARIANTS[deckId] ?? 0]; }
function cornerAssets(family) {
  const front = FAMILY_ASSETS[family]?.front || FAMILY_ASSETS.welcome.front;
  const base = front.replace(/-front\.webp$/, '-front-');
  return { tl: base + 'tl.webp', tr: base + 'tr.webp', bl: base + 'bl.webp', br: base + 'br.webp' };
}
export function cardDesignForDeck(deckId) {
  const known = Object.hasOwn(DECK_FAMILIES, deckId);
  const safeId = known ? deckId : null;
  const family = safeId ? DECK_FAMILIES[safeId] : 'welcome';
  return { ...FAMILY_ASSETS[family], family, variant: safeId ? (DECK_VARIANTS[safeId] ?? 0) : 0, corners: cornerAssets(family), accent: variantAccent(safeId, family) };
}
export function soloMotifForDeck(deckId) {
  const motifs = {
    'self-love-now': '<path d="M12 20S4 14.5 4 9a4 4 0 0 1 8-1.5A4 4 0 0 1 20 9c0 5.5-8 11-8 11Z"/>',
    'self-crush': '<path d="M11 20S4 15 4 10a3.6 3.6 0 0 1 7-1.4A3.6 3.6 0 0 1 18 10c0 1-.2 1.9-.6 2.8"/><path d="M19 3v4M17 5h4"/>',
    'self-breakup-decided': '<path d="M14 4h5v16h-5"/><path d="M10 12H3m3-3-3 3 3 3"/>',
    'self-breakup-lingering': '<path d="M12 20S4 14.5 4 9a4 4 0 0 1 8-1.5A4 4 0 0 1 20 9c0 5.5-8 11-8 11Z"/><path d="m12 7.5-1.5 3 3 2-1.5 3"/>',
    'self-strengths': '<path d="m12 4 2 5 5 .5-3.8 3.4L16.4 18 12 15.3 7.6 18l1.2-5.1L5 9.5l5-.5z"/>',
    'self-work': '<path d="M4 8h16v11H4zM8 8V5h8v3"/><path d="M4 12h16"/>',
    'self-school': '<path d="m3 8 9-4 9 4-9 4z"/><path d="M7 10v4.5c3 2 7 2 10 0V10"/>',
    'self-club': '<circle cx="12" cy="12" r="8"/><path d="M12 4v16M4 12h16"/>',
    'self-friends': '<circle cx="9" cy="9" r="3"/><circle cx="16" cy="10" r="2.5"/><path d="M3.5 19c.6-3 2.6-5 5.5-5s4.9 2 5.5 5M14.5 19c.3-2 1.4-3.5 3-3.5 1.4 0 2.6 1.2 3 3.5"/>',
    'self-values': '<path d="M6 4h12v16H6z"/><path d="M9 8h6M9 12h6M9 16h4"/>',
    'self-checkin': '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6 7 7M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/>',
  };
  const path = motifs[deckId];
  return path ? `<svg class="solo-card-motif" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${path}</svg>` : '';
}
export function cardDesignForSession(session) {
  const creator = normalizeCreatorDesign(session?.design);
  if (creator) {
    const preset = CREATOR_PRESETS[creator.presetId];
    if (preset && FAMILY_ASSETS[preset.family]) return { ...FAMILY_ASSETS[preset.family], family: preset.family, variant: 0, accent: FAMILY_ASSETS[preset.family].accent, creatorPresetId: creator.presetId };
  }
  const fallbackId = session?.mode === 'solo' ? 'self-values' : 'date';
  const current = session?.questions?.[session.cursor];
  if (session?.mixed && current?.sourceDeckId) return cardDesignForDeck(current.sourceDeckId);
  if (session?.customSet || session?.sharedGuest) return cardDesignForDeck(Object.hasOwn(DECK_FAMILIES, session.deckId) ? session.deckId : fallbackId);
  if (session?.mixed && session.deckIds?.length) return cardDesignForDeck(session.deckIds.find((id) => Object.hasOwn(DECK_FAMILIES, id)) || fallbackId);
  return cardDesignForDeck(Object.hasOwn(DECK_FAMILIES, session?.deckId) ? session.deckId : fallbackId);
}
export function cardDesignFamilyForDeck(deckId) { return DECK_FAMILIES[deckId] || 'welcome'; }
export { DECK_FAMILIES, FAMILY_ASSETS };

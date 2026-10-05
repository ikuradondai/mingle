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
const DECK_FAMILIES = {
  date: 'welcome', 'business-meetup': 'welcome', 'acquaintance-date': 'welcome', omiai: 'welcome', 'party-first-meeting': 'welcome', 'bar-first-meeting': 'welcome', neighbors: 'welcome', 'group-mixer': 'welcome', classmates: 'welcome',
  couples: 'romance', 'new-couple': 'romance', 'moving-in': 'romance', 'engaged-couple': 'romance', 'ex-lovers': 'romance', 'love-rivals': 'romance',
  friends: 'friends', reunion: 'friends', siblings: 'family', 'same-oshi-fans': 'friends', roommates: 'friends', 'travel-companions': 'friends', 'late-night-diner': 'friends',
  'parent-50plus': 'family', 'parent-under12': 'family', 'family-reunion': 'family', 'in-laws': 'family', 'grandparents-and-grandchildren': 'family',
  founders: 'work', team: 'work', 'new-colleagues': 'work', 'promotion-rivals': 'work',
  'sports-teammates': 'sports',
  'hero-and-demon-king': 'roleplay', 'assassin-and-target': 'roleplay', 'arch-enemies': 'roleplay', 'detective-and-phantom-thief': 'roleplay',
  'self-values': 'self', 'self-strengths': 'self', 'self-work': 'self', 'self-checkin': 'self',
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
  'self-values': 0, 'self-strengths': 1, 'self-work': 2, 'self-checkin': 3,
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
    'self-values': '<path d="M12 3 14.5 9l6.5.5-5 4 1.5 6.2-5.5-3.3-5.5 3.3L8 13.5 3 9.5 9.5 9 12 3Z"/>',
    'self-strengths': '<path d="M5 18 9 14l3 2 7-8"/><path d="M16 8h3v3"/>',
    'self-work': '<circle cx="12" cy="12" r="8"/><path d="M12 4v8l5 3"/>',
    'self-checkin': '<path d="M12 3c3 3 5 6 5 9a5 5 0 1 1-10 0c0-3 2-6 5-9Z"/><path d="M9 15c1.5 1 3 1 4.5 0"/>',
  };
  const path = motifs[deckId];
  return path ? `<svg class="solo-card-motif" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${path}</svg>` : '';
}
export function cardDesignForSession(session) {
  const fallbackId = session?.mode === 'solo' ? 'self-values' : 'date';
  const current = session?.questions?.[session.cursor];
  if (session?.mixed && current?.sourceDeckId) return cardDesignForDeck(current.sourceDeckId);
  if (session?.customSet || session?.sharedGuest) return cardDesignForDeck(Object.hasOwn(DECK_FAMILIES, session.deckId) ? session.deckId : fallbackId);
  if (session?.mixed && session.deckIds?.length) return cardDesignForDeck(session.deckIds.find((id) => Object.hasOwn(DECK_FAMILIES, id)) || fallbackId);
  return cardDesignForDeck(Object.hasOwn(DECK_FAMILIES, session?.deckId) ? session.deckId : fallbackId);
}
export function cardDesignFamilyForDeck(deckId) { return DECK_FAMILIES[deckId] || 'welcome'; }
export { DECK_FAMILIES, FAMILY_ASSETS };

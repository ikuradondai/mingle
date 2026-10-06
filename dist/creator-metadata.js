// Shared server/client normalization for creator-set metadata.
// The registry is deliberately finite now; the descriptor shape leaves room for
// future asset-backed kinds without accepting arbitrary URLs from users.
export const CREATOR_DESIGN_VERSION = 1;
export const CREATOR_PRESETS = Object.freeze({
  'first-meeting': { label: 'はじめての出会い', family: 'welcome', front: '/assets/card-families/first-meeting-front.webp', back: '/assets/card-families/first-meeting-back.webp' },
  relationships: { label: '恋愛と家族', family: 'family', front: '/assets/card-families/family-front.webp', back: '/assets/card-families/family-back.webp' },
  friends: { label: '友だち', family: 'friends', front: '/assets/card-families/friends-front.webp', back: '/assets/card-families/friends-back.webp' },
  'work-future': { label: '仕事とこれから', family: 'work', front: '/assets/card-families/work-front.webp', back: '/assets/card-families/work-back.webp' },
  'self-reflection': { label: '自分をふり返る', family: 'self', front: '/assets/card-families/self-front.webp', back: '/assets/card-families/self-back.webp' },
  'adult-conversation': { label: '大人の会話', family: 'adult', front: '/assets/card-families/adult-front.webp', back: '/assets/card-families/adult-back.webp' },
  love: { label: '恋する気持ち', family: 'romance', front: '/assets/card-families/love-front.webp', back: '/assets/card-families/love-back.webp' },
  sports: { label: 'スポーツ', family: 'sports', front: '/assets/card-families/sports-front.webp', back: '/assets/card-families/sports-back.webp' },
});
export const CREATOR_PRESET_IDS = Object.freeze(Object.keys(CREATOR_PRESETS));
const PRESET_SET = new Set(CREATOR_PRESET_IDS);

export function normalizeCreatorDesign(value, { strict = false } = {}) {
  if (value == null || value === '') return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    if (strict) throw new Error('INVALID_DESIGN');
    return null;
  }
  const version = value.version;
  const kind = value.kind;
  const presetId = value.presetId;
  if (version !== CREATOR_DESIGN_VERSION || kind !== 'preset' || typeof presetId !== 'string' || !PRESET_SET.has(presetId)) {
    if (strict) throw new Error('INVALID_DESIGN');
    return null;
  }
  return { version: CREATOR_DESIGN_VERSION, kind: 'preset', presetId };
}

export function effectiveCreatorAdult(explicit, cards = []) {
  return explicit === true || (Array.isArray(cards) && cards.some((card) => card?.r18 === true));
}

export function isCreatorPreset(value) { return PRESET_SET.has(value); }

import { canonicalCard } from "./account-library.js";

function idsOf(set) {
  if (Array.isArray(set?.card_ids)) return set.card_ids;
  if (Array.isArray(set?.cards)) return set.cards.map((entry) => entry?.cardId || entry?.card_id || entry?.id || entry);
  return [];
}

export function playableSavedSet(set, customCards = []) {
  const ids = idsOf(set);
  if (ids.length < 6 || ids.length > 40 || new Set(ids).size !== ids.length || ids.some((id) => typeof id !== "string")) return null;
  const cards = ids.map((id) => canonicalCard(id, customCards) || canonicalCard(`custom:${id}`, customCards));
  if (cards.some((card) => !card)) return null;
  const normalizedIds = cards.map((card) => card.id);
  if (new Set(normalizedIds).size !== normalizedIds.length) return null;
  const audience = ['group', 'solo', 'both'].includes(set?.audience) ? set.audience : 'group';
  const questionOrder = ['shuffle', 'fixed'].includes(set?.questionOrder || set?.question_order) ? (set.questionOrder || set.question_order) : 'shuffle';
  return { ...set, audience, questionOrder, card_ids: normalizedIds, cards, cardCount: cards.length, hasR18: set?.r18 === true || set?.theme_r18 === true || set?.effectiveR18 === true || cards.some((card) => card.r18 === true) };
}

export function playableSavedSets(sets = [], customCards = []) {
  return (Array.isArray(sets) ? sets : []).map((set) => playableSavedSet(set, customCards)).filter(Boolean);
}

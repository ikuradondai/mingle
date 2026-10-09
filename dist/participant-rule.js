// Participant rules are metadata for the theme picker and display layer.
// Unknown or legacy themes intentionally fall back to the regular group rule.
import { decks } from './data/decks.js';
import { soloDecks } from './data/solo-decks.js';

export const PARTICIPANT_RULES = Object.freeze({
  date: 'pair',
  'acquaintance-date': 'pair',
  couples: 'pair',
  intimacy: 'pair',
  'new-couple': 'pair',
  'moving-in': 'pair',
  'first-intimacy': 'pair',
  'intimacy-refresh': 'pair',
  'intimacy-distance': 'pair',
  omiai: 'pair',
  'promotion-rivals': 'pair',
  'love-rivals': 'pair',
  'arch-enemies': 'pair',
  'hero-and-demon-king': 'pair',
  'assassin-and-target': 'pair',
  'ex-lovers': 'pair',
  'detective-and-phantom-thief': 'pair',
  'engaged-couple': 'pair',
  friends: 'group', founders: 'group', team: 'group', 'parent-50plus': 'group',
  'parent-under12': 'group', reunion: 'group', siblings: 'group', 'new-colleagues': 'group',
  'sports-teammates': 'group', 'family-reunion': 'group', 'party-first-meeting': 'group',
  'business-meetup': 'group', 'bar-first-meeting': 'group', 'in-laws': 'group',
  'same-oshi-fans': 'group', roommates: 'group', 'grandparents-and-grandchildren': 'group',
  neighbors: 'group', 'travel-companions': 'group', 'late-night-diner': 'group',
  'group-mixer': 'group', classmates: 'group',
  'self-love-now': 'solo', 'self-crush': 'solo', 'self-breakup-decided': 'solo',
  'self-breakup-lingering': 'solo', 'self-strengths': 'solo', 'self-work': 'solo',
  'self-school': 'solo', 'self-club': 'solo', 'self-friends': 'solo',
  'self-values': 'solo', 'self-checkin': 'solo',
  'self-path': 'solo', 'self-people-tired': 'solo', 'self-confidence': 'solo',
  'self-decision': 'solo', 'self-future': 'solo',
});
const CARD_RULES = new Map([...decks, ...soloDecks].flatMap((deck) => [...(deck.questions || []), ...(deck.r18Questions || [])].map((card) => [card.id, PARTICIPANT_RULES[deck.id] || (deck.audience === 'solo' ? 'solo' : 'group')])));

export function participantRuleForDeck(deckOrId) {
  const ids = typeof deckOrId === 'string' ? [deckOrId] : [deckOrId?.sourceDeckId, deckOrId?.deckId, deckOrId?.id].filter((id, index, values) => typeof id === 'string' && values.indexOf(id) === index);
  for (const id of ids) {
    if (Object.hasOwn(PARTICIPANT_RULES, id)) return PARTICIPANT_RULES[id];
    if (CARD_RULES.has(id)) return CARD_RULES.get(id);
  }
  if (typeof deckOrId === 'object' && deckOrId?.audience === 'solo') return 'solo';
  return 'group';
}

export function participantRuleForSession(session) {
  if (session?.mode === 'solo') return 'solo';
  if (session?.participantRule === 'pair' || session?.participantRule === 'group') return session.participantRule;
  const ids = new Set([...(Array.isArray(session?.deckIds) ? session.deckIds : []), session?.deckId]);
  for (const question of session?.questions || []) if (question?.sourceDeckId) ids.add(question.sourceDeckId);
  if ([...ids].some((id) => participantRuleForDeck(id) === 'pair')) return 'pair';
  return 'group';
}

export function participantCountAllowed(rule, count) {
  if (!Number.isInteger(count)) return false;
  if (rule === 'solo') return count === 1;
  if (rule === 'pair') return count === 2;
  return count >= 2 && count <= 8;
}

export function participantRuleForSavedSet(set, mode = 'group') {
  if (mode === 'solo' || set?.audience === 'solo') return 'solo';
  const cards = Array.isArray(set?.cards) ? set.cards : [];
  const rawIds = Array.isArray(set?.card_ids) ? set.card_ids : cards.map((card) => card?.cardId || card?.card_id || card?.id).filter(Boolean);
  return cards.concat(rawIds.map((id) => ({ id }))).some((card) => participantRuleForDeck(card) === 'pair') ? 'pair' : 'group';
}

// Replace only the conversational standalone use of 「相手」. Terms such as
// 対戦相手・相談相手・理想の相手・相手役・相手方・相手チーム stay literal.
export function displayQuestionText(text, { participants, participantIndex, rule = 'group' } = {}) {
  if (typeof text !== 'string' || rule === 'solo' || !Array.isArray(participants) || participants.length !== 2) return text;
  if (!Number.isInteger(participantIndex) || participantIndex < 0 || participantIndex > 1) return text;
  const other = participants[participantIndex === 0 ? 1 : 0];
  if (typeof other !== 'string' || !other.trim() || participants.some((name) => typeof name !== 'string' || !name.trim())) return text;
  return text.replace(/(?<!対戦)(?<!取引)(?<!相談)(?<!理想の)相手(?!役|方|チーム|先)/gu, () => other);
}

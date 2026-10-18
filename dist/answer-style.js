// Small, deterministic answer-style variations for ordinary group play.
// This deliberately does not alter the question or session persistence shape.

export const ANSWER_STYLE_PREDICT = 'predict';
export const ANSWER_STYLE_TOGETHER = 'together';

// These questions have a short, concrete answer that can be guessed or given
// together. Keep this allowlist small and explicit rather than inferring from
// question text (which would make serious or long-form prompts unsuitable).
export const ANSWER_STYLE_CARD_IDS = Object.freeze([
  'friends-08', 'team-14', 'group-mixer-08', 'acquaintance-date-08',
  'founders-03', 'parent-50plus-07', 'parent-under12-03',
  'reunion-05', 'siblings-03', 'moving-in-03',
  'family-reunion-03', 'new-colleagues-06', 'sports-teammates-08',
  'bar-first-meeting-03', 'promotion-rivals-05', 'love-rivals-03',
  'arch-enemies-10', 'hero-and-demon-king-03', 'assassin-and-target-10',
  'detective-and-phantom-thief-03', 'in-laws-03',
  'same-oshi-fans-03', 'roommates-01', 'grandparents-and-grandchildren-03',
  'travel-companions-03', 'late-night-diner-02', 'engaged-couple-09',
  'classmates-06', 'mom-friends-first-07', 'mom-friends-children-09',
  'mom-friends-self-04', 'mom-friends-daily-06',
]);

const TOGETHER_CARD_IDS = new Set(ANSWER_STYLE_CARD_IDS);
const NORMAL_GROUP_DECKS = new Set([
  'date', 'acquaintance-date', 'couples', 'friends', 'founders', 'team',
  'parent-50plus', 'parent-under12', 'reunion', 'siblings', 'new-couple',
  'moving-in', 'family-reunion', 'new-colleagues', 'sports-teammates',
  'omiai', 'party-first-meeting', 'business-meetup', 'bar-first-meeting',
  'promotion-rivals', 'love-rivals', 'arch-enemies', 'hero-and-demon-king',
  'assassin-and-target', 'ex-lovers', 'detective-and-phantom-thief',
  'in-laws', 'same-oshi-fans', 'roommates', 'grandparents-and-grandchildren',
  'neighbors', 'travel-companions', 'late-night-diner', 'group-mixer',
  'engaged-couple', 'classmates', 'mom-friends-first', 'mom-friends-children',
  'mom-friends-self', 'mom-friends-concerns', 'mom-friends-daily',
]);

function hash(value) {
  let result = 2166136261;
  for (const char of String(value)) {
    result ^= char.codePointAt(0);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

export function isAnswerStyleEligibleSession(session) {
  return Boolean(
    session?.mode !== 'solo'
      && session?.participantRule !== 'solo'
      && session?.deckId
      && NORMAL_GROUP_DECKS.has(session.deckId)
      && session.mixed !== true
      && session.customSet !== true
      && session.sharedGuest !== true
      && session.sponsorSet !== true
      && session.includeR18 !== true
      && Array.isArray(session.questions),
  );
}

function candidateStyle(session, index) {
  const card = session.questions[index];
  if (card?.kind === 'challenge') return null;
  const id = card?.id;
  if (!id) return null;
  const value = hash(`${session.sessionId || session.deckId}:${id}`);
  // Prediction is available across ordinary decks, but only occasionally.
  // Questions that address a specific counterpart cannot be answered by the
  // whole group, even when their id is in the curated together allowlist.
  if (TOGETHER_CARD_IDS.has(id) && !String(card.text || '').includes('相手') && value % 2 === 0) return ANSWER_STYLE_TOGETHER;
  if (value % 4 === 0) return ANSWER_STYLE_PREDICT;
  return null;
}

/**
 * Return the stable variation for a card, or null when the card should use
 * ordinary answering. The result is derived from persisted session/card data,
 * so re-render, back, and reload keep the same variation.
 */
export function answerStyleForCard(session, cardOrIndex) {
  if (!isAnswerStyleEligibleSession(session)) return null;
  const index = typeof cardOrIndex === 'number'
    ? cardOrIndex
    : session.questions.findIndex((card) => card?.id === cardOrIndex?.id);
  if (!Number.isInteger(index) || index < 0 || index >= session.questions.length) return null;
  let previousSpecial = false;
  for (let cursor = 0; cursor < index; cursor += 1) {
    const candidate = candidateStyle(session, cursor);
    const selected = previousSpecial ? null : candidate;
    previousSpecial = Boolean(selected);
  }
  const style = candidateStyle(session, index);
  // A special prompt is never shown on adjacent cards, regardless of type.
  return previousSpecial ? null : style;
}

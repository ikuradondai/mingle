// Stable, non-sensitive examples shown on theme cards. These IDs are reviewed
// against the standard catalog; no answers or generated text are stored.
export const THEME_EXAMPLE_QUESTION_IDS = Object.freeze({
  date: 'date-02', 'acquaintance-date': 'acquaintance-date-01', couples: 'couples-01', intimacy: null,
  friends: 'friends-01', founders: 'founders-01', team: 'team-01', 'parent-50plus': 'parent-50plus-01',
  'parent-under12': 'parent-under12-01', reunion: 'reunion-01', siblings: 'siblings-01', 'new-couple': 'new-couple-01',
  'moving-in': 'moving-in-01', 'first-intimacy': null, 'intimacy-refresh': null, 'intimacy-distance': null,
  'family-reunion': 'family-reunion-01', 'new-colleagues': 'new-colleagues-02', 'sports-teammates': 'sports-teammates-01',
  omiai: 'omiai-02', 'party-first-meeting': 'party-first-meeting-02', 'business-meetup': 'business-meetup-02',
  'bar-first-meeting': 'bar-first-meeting-02', 'promotion-rivals': 'promotion-rivals-01', 'love-rivals': 'love-rivals-01',
  'arch-enemies': 'arch-enemies-01', 'hero-and-demon-king': 'hero-and-demon-king-01', 'assassin-and-target': 'assassin-and-target-01',
  'ex-lovers': 'ex-lovers-01', 'detective-and-phantom-thief': 'detective-and-phantom-thief-01', 'in-laws': 'in-laws-01',
  'same-oshi-fans': 'same-oshi-fans-01', roommates: 'roommates-01', 'grandparents-and-grandchildren': 'grandparents-and-grandchildren-01',
  neighbors: 'neighbors-02', 'travel-companions': 'travel-companions-02', 'late-night-diner': 'late-night-diner-01',
  'group-mixer': 'group-mixer-04', 'engaged-couple': 'engaged-couple-01', classmates: 'classmates-01',
  'self-love-now': 'self-love-now-09', 'self-crush': 'self-crush-02', 'self-breakup-decided': 'self-breakup-decided-07',
  'self-breakup-lingering': 'self-breakup-lingering-09', 'self-strengths': 'self-strengths-02', 'self-work': 'self-work-03',
  'self-school': 'self-school-04', 'self-club': 'self-club-02', 'self-path': 'self-path-09',
  'self-friends': 'self-friends-11', 'self-people-tired': 'self-people-tired-11', 'self-values': 'self-values-03',
  'self-checkin': 'self-checkin-01', 'self-confidence': 'self-confidence-07', 'self-decision': 'self-decision-07',
  'self-future': 'self-future-07',
});

const CONDITION_LABELS = Object.freeze({
  'parent-under12': '子どもが12歳以下の親子',
  'parent-50plus': '親が50歳以上の親子',
});

export function themeExampleForDeck(deck) {
  if (!deck || deck.adultOnly === true) return deck?.subtitle || '';
  const questionId = THEME_EXAMPLE_QUESTION_IDS[deck.id];
  const card = questionId && Array.isArray(deck.questions) ? deck.questions.find((item) => item?.id === questionId) : null;
  const text = typeof card?.text === 'string' ? card.text.trim() : '';
  if (!text || card.r18 === true || card.kind === 'challenge' || card.kind === 'action') return deck.subtitle || '';
  const label = CONDITION_LABELS[deck.id];
  return label ? `${label}：${text}` : text;
}

export const THEME_EXAMPLE_CONDITION_LABELS = CONDITION_LABELS;

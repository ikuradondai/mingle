// Small visual/audio pair catalog for successful interaction feedback.
// Selection is random per tone while avoiding the immediately previous pair.
const CATALOG = Object.freeze({
  bright: [
    ['crossfan', 'feedback-group'],
    ['fountain', 'feedback-sparkle'],
    ['swoosh', 'feedback-confetti'],
  ],
  confetti: [
    ['crossfan', 'feedback-group'],
    ['fountain', 'feedback-confetti'],
    ['ribbon', 'feedback-sparkle'],
  ],
  heart: [
    ['bloom', 'feedback-heart'],
    ['swoosh', 'feedback-sparkle'],
    ['fountain', 'feedback-group'],
  ],
  calm: [
    ['bloom', 'feedback-calm'],
    ['swoosh', 'feedback-calm'],
  ],
});
const lastByTone = new Map();

function safeTone(tone) { return Object.hasOwn(CATALOG, tone) ? tone : 'bright'; }

export function interactionFeedbackFor({ tone = 'bright', action = 'reveal', participantCount = 1 } = {}) {
  const safe = safeTone(tone);
  const options = CATALOG[safe];
  const previous = lastByTone.get(safe);
  let candidates = options.filter(([variant, soundKey]) => variant !== previous?.variant && soundKey !== previous?.soundKey);
  if (!candidates.length) candidates = options.filter(([variant]) => variant !== previous?.variant);
  if (!candidates.length) candidates = options;
  const [variant, soundKey] = candidates[Math.floor(Math.random() * candidates.length)];
  lastByTone.set(safe, { variant, soundKey });
  const count = Math.max(1, Math.min(8, Number(participantCount) || 1));
  return { tone: safe, action: typeof action === 'string' ? action : 'reveal', variant, soundKey, participantCount: count, intensity: count >= 2 ? 'group' : 'solo' };
}

export function __resetInteractionFeedbackForTest() { lastByTone.clear(); }
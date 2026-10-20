// Action-aware visual/audio pair catalog for successful interaction feedback.
// Each operation gets a small semantic set; the previous pair across tones is avoided.
const CATALOG = Object.freeze({
  bright: {
    theme: [['confetti-cannon', 'feedback-group'], ['star-comet', 'feedback-sparkle'], ['ribbon-relay', 'feedback-confetti']],
    reveal: [['card-fan', 'feedback-sparkle'], ['page-sweep', 'feedback-confetti']],
    'next-person': [['ribbon-relay', 'feedback-group'], ['card-fan', 'feedback-sparkle']],
    'next-card': [['page-sweep', 'feedback-confetti'], ['star-comet', 'feedback-sparkle'], ['ribbon-relay', 'feedback-group']],
    pass: [['soft-ripple', 'feedback-calm']],
  },
  confetti: {
    theme: [['confetti-cannon', 'feedback-confetti'], ['star-comet', 'feedback-sparkle'], ['ribbon-relay', 'feedback-group']],
    reveal: [['page-sweep', 'feedback-confetti'], ['card-fan', 'feedback-sparkle']],
    'next-person': [['ribbon-relay', 'feedback-group'], ['confetti-cannon', 'feedback-confetti']],
    'next-card': [['star-comet', 'feedback-sparkle'], ['page-sweep', 'feedback-confetti']],
    pass: [['soft-ripple', 'feedback-calm']],
  },
  heart: {
    theme: [['heart-bloom', 'feedback-heart'], ['heart-orbit', 'feedback-sparkle'], ['star-comet', 'feedback-group']],
    reveal: [['heart-bloom', 'feedback-heart'], ['card-fan', 'feedback-sparkle']],
    'next-person': [['heart-orbit', 'feedback-heart'], ['ribbon-relay', 'feedback-group'], ['heart-bloom', 'feedback-sparkle']],
    'next-card': [['heart-orbit', 'feedback-heart'], ['star-comet', 'feedback-sparkle'], ['heart-bloom', 'feedback-group']],
    pass: [['soft-ripple', 'feedback-calm']],
  },
  calm: {
    theme: [['soft-ripple', 'feedback-calm'], ['card-fan', 'feedback-calm']],
    reveal: [['soft-ripple', 'feedback-calm'], ['card-fan', 'feedback-calm']],
    'next-person': [['soft-ripple', 'feedback-calm'], ['card-fan', 'feedback-calm']],
    'next-card': [['soft-ripple', 'feedback-calm'], ['page-sweep', 'feedback-calm']],
    pass: [['soft-ripple', 'feedback-calm']],
  },
});
let lastPair = null;
const ACTIONS = new Set(['theme', 'reveal', 'next-person', 'next-card', 'pass']);
function safeTone(tone) { return Object.hasOwn(CATALOG, tone) ? tone : 'bright'; }
function safeAction(action) { return ACTIONS.has(action) ? action : 'reveal'; }
export function interactionFeedbackFor({ tone = 'bright', action = 'reveal', participantCount = 1 } = {}) {
  const safeToneValue = safeTone(tone); const safeActionValue = safeAction(action);
  const options = CATALOG[safeToneValue][safeActionValue]; const previous = lastPair;
  let candidates = options.filter(([variant, soundKey]) => variant !== previous?.variant && soundKey !== previous?.soundKey);
  if (!candidates.length) candidates = options.filter(([variant]) => variant !== previous?.variant);
  if (!candidates.length) candidates = options;
  const [variant, soundKey] = candidates[Math.floor(Math.random() * candidates.length)];
  lastPair = { variant, soundKey };
  const count = Math.max(1, Math.min(8, Number(participantCount) || 1));
  return { tone: safeToneValue, action: safeActionValue, variant, soundKey, participantCount: count, intensity: count >= 2 ? 'group' : 'solo' };
}
export function __resetInteractionFeedbackForTest() { lastPair = null; }

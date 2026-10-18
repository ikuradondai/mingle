const REACTIONS = Object.freeze({ same: 'same', surprise: 'surprise' });

function normalizeReaction(reaction) {
  return reaction === REACTIONS.surprise ? REACTIONS.surprise : REACTIONS.same;
}

/** Small inline vector icon for the reaction button. */
export function reactionIcon(reaction) {
  const kind = normalizeReaction(reaction);
  if (kind === REACTIONS.surprise) {
    return `<svg class="conversation-reaction-icon conversation-reaction-icon-surprise" viewBox="0 0 32 24" aria-hidden="true" focusable="false"><g class="reaction-card reaction-card-main"><rect x="7.5" y="3" width="13" height="17" rx="2.2" transform="rotate(-8 7.5 3)"/></g><g class="reaction-spark"><path d="M24.5 3.2v3M27.7 6.4h-3M26.8 12.4v2.2M29 14.5h-2.2M23.6 16.7v2.1M25.7 18.8h-2.1"/></g></svg>`;
  }
  return `<svg class="conversation-reaction-icon conversation-reaction-icon-same" viewBox="0 0 32 24" aria-hidden="true" focusable="false"><rect class="reaction-card reaction-card-left" x="3" y="4" width="12" height="16" rx="2" transform="rotate(-8 3 4)"/><rect class="reaction-card reaction-card-right" x="17" y="4" width="12" height="16" rx="2" transform="rotate(8 17 4)"/><path class="reaction-join" d="M13.5 12h5"/></svg>`;
}

/** Pointer-transparent, absolutely-positioned effect. Parent should provide a positioned root. */
export function reactionEffectMarkup(reaction, stage = 1) {
  const kind = normalizeReaction(reaction);
  const safeStage = Math.min(20, Math.max(1, Number(stage) || 1));
  // Reallocate the full base-to-target range across all 20 stages so even the
  // late taps keep growing instead of flattening against a hard clamp.
  const progress = (safeStage - 1) / 19;
  const isMobile = typeof window !== 'undefined' && window.innerWidth <= 520;
  const baseWidth = isMobile ? Math.min(120, window.innerWidth * 0.31) : 188;
  const targetWidth = isMobile ? window.innerWidth * 0.90 : (typeof window !== 'undefined' ? Math.min(940, window.innerWidth * 0.8) : 940);
  const imageWidthValue = baseWidth + (targetWidth - baseWidth) * Math.pow(progress, 0.75);
  const scale = (imageWidthValue / baseWidth).toFixed(3);
  const imageWidth = imageWidthValue.toFixed(1);
  const liftMax = isMobile ? 80 : 180;
  const lift = (liftMax * Math.pow(progress, 1.5)).toFixed(1);
  const image = kind === REACTIONS.surprise ? '/assets/play/reaction-wow.webp' : '/assets/play/reaction-yes.webp';
  return `<span class="conversation-reaction-effect conversation-reaction-effect-${kind}" data-reaction-effect="${kind}" data-stage="${safeStage}" style="--reaction-stage:${safeStage};--reaction-scale:${scale};--reaction-image-width:${imageWidth}px;--reaction-lift:${lift}px" aria-hidden="true"><img class="reaction-effect-image" src="${image}" alt="" decoding="async" draggable="false"></span>`;
}

// Begin decoding while the play screen is loading so the first tap is visual immediately.
export function preloadReactionAssets() {
  if (typeof Image === 'undefined') return;
  for (const src of ['/assets/play/reaction-yes.webp', '/assets/play/reaction-wow.webp']) {
    const image = new Image();
    image.decoding = 'async';
    image.src = src;
    image.decode?.().catch(() => {});
  }
}

preloadReactionAssets();

export const conversationReactionKinds = REACTIONS;

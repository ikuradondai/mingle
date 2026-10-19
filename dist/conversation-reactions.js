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
export function reactionEffectMarkup(reaction, stage = 1, profile = {}) {
  const kind = normalizeReaction(reaction);
  const safeStage = Math.min(20, Math.max(1, Number(stage) || 1));
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
  const participants = Math.max(1, Math.min(8, Number(profile.participantCount) || 1));
  const tone = profile.tone === 'heart' ? 'heart' : profile.tone === 'calm' ? 'calm' : profile.tone === 'confetti' ? 'confetti' : 'bright';
  const toneFactor = tone === 'calm' ? 0.62 : tone === 'heart' ? 1.14 : 1;
  const densityFactor = participants >= 4 ? 1.28 : participants >= 2 ? 1.08 : 0.68;
  const intensity = densityFactor * toneFactor;
  const particleCount = Math.min(60, Math.max(tone === 'calm' ? 7 : 11,
    Math.round((kind === REACTIONS.same ? 19 : 15) * intensity + safeStage * (participants >= 2 ? 1.25 : .72))));
  // The artwork itself is the anchor: every trajectory starts at its lifted centre,
  // then clears the letterface before fanning into a larger, uneven halo.
  const spread = imageWidthValue * (0.34 + 0.14 * Math.pow(progress, .72)) * intensity;
  const verticalSpread = spread * (0.72 + .26 * progress);
  const svgFor = (particleKind) => particleKind === 'heart'
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.4S3.8 15.7 3.8 9.2A4.5 4.5 0 0 1 12 6.7a4.5 4.5 0 0 1 8.2 2.5c0 6.5-8.2 11.2-8.2 11.2Z"/><path class="particle-highlight" d="M7.1 9.2c.3-1.9 2.5-2.8 4-1.7-.9.1-1.7.7-2.1 1.6-.4.8-1 1.1-1.9.1Z"/></svg>'
    : particleKind === 'sparkle'
      ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 1.8 1.8 7.4 7.4 1.8-7.4 1.8-1.8 7.4-1.8-7.4-7.4-1.8 7.4-1.8L12 1.8Z"/></svg>'
      : '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/></svg>';
  const particles = Array.from({ length: particleCount }, (_, index) => {
    const angle = ((index * 137.507 + safeStage * 17 + (index % 5) * 9) % 360) * Math.PI / 180;
    const radial = .72 + ((index * 31 + safeStage * 13) % 39) / 100;
    const x = Math.round(Math.cos(angle) * spread * radial);
    const y = Math.round(Math.sin(angle) * verticalSpread * radial - Number(lift) * (.12 + (index % 4) * .08));
    const driftX = Math.round(x * (1.10 + (index % 4) * .10) + Math.sin(index * 2.1) * 9);
    const driftY = Math.round(y * (1.06 + (index % 3) * .08) - (16 + (index % 6) * 8));
    // Same! always pairs joyful hearts with a fine sparkle vocabulary. WOW keeps
    // its energetic starburst language and never turns into hearts by accident.
    const particleKind = kind === REACTIONS.same
      ? (tone === 'heart' ? (index % 4 === 0 ? 'sparkle' : 'heart') : (index % 3 === 0 ? 'sparkle' : index % 5 === 0 ? 'dot' : 'heart'))
      : (index % 3 === 0 ? 'sparkle' : index % 4 === 0 ? 'dot' : 'sparkle');
    const heartSize = 20 + Math.round(29 * Math.pow(progress, .82)) + ((index * 11 + safeStage * 3) % 10) - 4;
    const fineSize = 8 + ((index * 7 + safeStage) % 8);
    const size = particleKind === 'heart' && kind === REACTIONS.same
      ? Math.min(55, heartSize)
      : Math.round(fineSize * (0.85 + intensity * .18));
    const delay = Math.min(.08, (index % 9) * .009).toFixed(3);
    const rotate = Math.round((index * 43 + safeStage * 19) % 140 - 70);
    return `<i class="reaction-particle reaction-particle-${particleKind}" style="--particle-x:${x}px;--particle-y:${y}px;--particle-drift-x:${driftX}px;--particle-drift-y:${driftY}px;--particle-size:${size}px;--particle-delay:${delay}s;--particle-rotate:${rotate}deg">${svgFor(particleKind)}</i>`;
  }).join('');
  return `<span class="conversation-reaction-effect conversation-reaction-effect-${kind} conversation-reaction-effect-${tone}" data-reaction-effect="${kind}" data-reaction-tone="${tone}" data-stage="${safeStage}" style="--reaction-stage:${safeStage};--reaction-scale:${scale};--reaction-image-width:${imageWidth}px;--reaction-lift:${lift}px" aria-hidden="true"><span class="reaction-effect-content"><span class="reaction-particles">${particles}</span><img class="reaction-effect-image" src="${image}" alt="" decoding="async" draggable="false"></span></span>`;
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

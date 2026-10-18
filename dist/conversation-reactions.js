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
export function reactionEffectMarkup(reaction) {
  const kind = normalizeReaction(reaction);
  if (kind === REACTIONS.surprise) {
    return `<span class="conversation-reaction-effect conversation-reaction-effect-surprise" data-reaction-effect="surprise" aria-hidden="true"><span class="reaction-effect-hero reaction-effect-hero-left"></span><span class="reaction-effect-hero reaction-effect-hero-main"></span><span class="reaction-effect-hero reaction-effect-hero-right"></span><span class="reaction-effect-paper reaction-effect-paper-one"></span><span class="reaction-effect-paper reaction-effect-paper-two"></span><span class="reaction-effect-paper reaction-effect-paper-three"></span><span class="reaction-effect-paper reaction-effect-paper-four"></span><span class="reaction-effect-paper reaction-effect-paper-five"></span></span>`;
  }
  return `<span class="conversation-reaction-effect conversation-reaction-effect-same" data-reaction-effect="same" aria-hidden="true"><span class="reaction-effect-card reaction-effect-card-left"></span><span class="reaction-effect-card reaction-effect-card-right"></span><span class="reaction-effect-rays reaction-effect-rays-left"><i></i><i></i><i></i></span><span class="reaction-effect-rays reaction-effect-rays-right"><i></i><i></i><i></i></span></span>`;
}

export const conversationReactionKinds = REACTIONS;

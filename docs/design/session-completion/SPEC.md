# Six-card session completion — adopted compact editorial design

## Final direction

The approved design is a compact editorial fan of six completed cards beside the real completion summary and theme-specific reply action. It uses warm ivory, ink navy, cobalt, restrained coral, and the existing Mingle theme cover. The fan is the visual proof of progress; recap owns the full question content. The screen keeps one live completion action, a skip link, a recap link, and the theme-like control.

The original editorial board (session-completion-editorial-board.png) is retained as design history only. The adopted board is session-completion-compact-board.png. Board copy, fake navigation, sample theme text, and sample participant context are visual approximations; product copy and behavior come from the current app.

## Actual DOM and behavior contract

- Scope root: .round-completion.
- Layout: .round-completion-layout contains .round-completion-cards and .round-completion-main.
- Fan: .round-completion-card-fan contains six real .round-completion-card nodes. The front card contains the existing .round-completion-cover theme image. The optional question excerpt is not rendered by the current app.
- Fan placement uses inline --completion-card-index, --completion-card-count, and --completion-card-offset; CSS must not depend on six nth-child positions.
- Summary: .round-completion-copy, .round-completion-kicker, .round-completion-title, and .round-completion-lead.
- Live reply: .completion-reply is nested inside .round-completion-main. Its actual .completion-reply-lead, .completion-reply-example, action, and skip controls preserve theme-/mode-specific behavior.
- Secondary behavior remains in .round-favorites-compact and .theme-likes. Recap, continuation, final transitions, save/like behavior, and in-memory action semantics are unchanged.
- Desktop is two columns at 960px and above. Below 960px the layout stacks safely. Mobile keeps a compact fan and one-row primary/skip action with 44px-or-larger targets.

## Adopted ImageGen prompt

Use case: ui-mockup. Asset type: high-fidelity desktop and mobile product UI board for a Mingle.cards six-card session completion screen. Revise the previous Mingle.cards six-card completion screen into a more compact, mature editorial completion experience. Show one desktop 1440px viewport and one 390px mobile inset on the same design board. Preserve the warm ivory, dark ink navy, cobalt blue, restrained coral, small yellow/green paper-card visual language, but do not show a six-card question grid on mobile. Instead show a compact fan/spread of 3 to 6 finished paper cards with varied colored edges, small numbers, and at most one very short two-line question excerpt on the front; the full six-card recap is behind one quiet expandable control. Desktop: a compact fan of finished cards occupies one side while the completion summary sits close beside it, with concise headline 「6枚ぶん、話せた。」, short truthful lead, and one clear practical action. The action must represent the existing theme-specific completion-reply semantics accurately: use a completion-reply area with a short prompt and an action label like 「伝えた」 where appropriate, preserving a skip link 「今回はスキップ」. Keep review 「今回の6枚を見返す」 and theme-like as quiet secondary controls. Mobile: fan maximum about 180px wide and headline/action immediately adjacent or directly below, so the first viewport is short and the achievement is felt without a large hero. Use real Mingle.cards header/logo treatment only; no fake navigation, tagline, sample theme, participant count, or English mottos. Final UI text will be exact HTML/CSS, image text is only approximate. Avoid giant empty cream areas, centered paragraph stacks, unrelated people illustrations, childish or gender-targeted art, stock-photo look, flowers, hearts, sparkles, confetti, thick rails, repeated rounded boxes, multiple pill buttons, loud gradients, neon, dashboard UI, and heavy shadows. The visual proof is the compact fan of completed cards, not six full question previews.

## Rejected first-board prompt history

The first board prompt requested a 2x3 editorial spread and mobile contact sheet. It was rejected because it exposed too much question text and did not make the compact fan the clear achievement marker. The exact generated prompt remains in repository history through the original board generation record; the adopted prompt above is the implementation source of truth.

## Implementation and verification

- No new production bitmap was needed. The fan uses the existing theme cover and six real cards.
- CSS is completion-scoped and removes thick rails, decorative side strips, repeated rounded panels, and unrelated illustration.
- Current verification images:
  - C:/dev/carding/artifacts/manual-completion-final/real-app-320.png
  - C:/dev/carding/artifacts/manual-completion-final/real-app-390.png
  - C:/dev/carding/artifacts/manual-completion-final/real-app-768.png
  - C:/dev/carding/artifacts/manual-completion-final/real-app-900.png
  - C:/dev/carding/artifacts/manual-completion-final/real-app-1366.png
- The 390px and 1366x768 current-app captures fit their viewport. The 320px capture has only minimal natural overflow for readable Japanese copy. The 768px and 900px captures use the safe stacked layout.
- The old after-desktop.png and after-mobile.png fixture captures are not product evidence and are not referenced by the adopted design.


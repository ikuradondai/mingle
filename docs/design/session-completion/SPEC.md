# Six-card session completion — compact four-choice closing

## Final direction

The completion screen uses a compact warm-cream summary with four equal actions: 共通点, いいね！, ありがとう, and 覚えてる？. Selecting one replaces the four-card area with one short spoken instruction and a return link. Continue and finish remain available in both states. The reference board is `mingle-completion-ui-design-board.png`; its large title and footer proportions are reduced in the product implementation to keep the first viewport compact.

## DOM and behavior contract

- Scope root: `.round-completion`.
- `.round-completion-layout` contains `.round-completion-main`; the old decorative card fan is not part of the completion DOM.
- `.completion-choice-grid` contains four equal action cards, four columns on desktop and two by two on narrow screens. The four generated icon assets live under `dist/assets/completion/` and are rendered as decorative images.
- `.completion-choice-stage` replaces the grid in the same region. It shows one instruction and a `4つから選ぶ` return control; the list and instruction never render together.
- `.round-favorites-compact` and `.theme-likes` remain available below the compact action area, along with save, continue, and finish behavior.
- `覚えてる？` uses only an in-memory map of completed ordinary card answers for the current round: card ID, participant name/index, and question text. It records on the normal next-card action, excludes pass and challenge/together cards, is never serialized or sent to an API, and disables itself when there are no candidates. A second question is offered only when another candidate exists.
- Solo sessions keep the existing self-directed completion copy and do not show prompts addressed to other people.

## Image generation

The complete source prompt is in `imagegen-ui-board-prompt.md`; the resulting reference board is `mingle-completion-ui-design-board.png`.

## Verification

`node --check dist/app.js` and `npm run check` are the relevant checks. Browser captures should cover a six-card desktop completion, narrow two-by-two layout, selected instruction state, one-candidate recall, no-candidate recall, and the final partial round.

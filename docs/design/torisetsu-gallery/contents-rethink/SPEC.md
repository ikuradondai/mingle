# Contents screen rethink — ImageGen design contract

## Generated board

`contents-editorial-board.png` is a visual reference generated with the built-in `image_gen__imagegen`. It shows a desktop three-column editorial contents view plus a compact mobile list.

## Direction

- Keep the existing Mingle.cards header, real progress count, and manual/help link.
- Replace repeated full-width rounded cards and repeated blue pills with three chapter panels on desktop, each with a distinct chapter number, short description, state, and one action.
- Actual chapters: `満たされるもの、足りないもの`, `頭の中の声`, `心が動くとき`.
- Actual state actions remain `はじめる`, `つづける`, `見直す`; state labels remain `未着手`, `途中`, `完了`.
- Use warm cream, deep navy, vivid blue, and restrained coral. Use fine dividers and small chapter marks; avoid thick vertical rails, decorative AI strips, and excessive rounded framing.
- Mobile collapses to compact text rows with a small image/number mark, keeping the viewport short and preserving the existing actions.

## Implementation contract and final CSS status

- The redesign is implemented and scoped to the contents screen. Done/gallery screens are unchanged.
- Actual root and header hooks are `.ts-contents.ts-contents-editorial`, `.ts-contents-header`, `.ts-contents-progress`, and `.ts-contents-manual`.
- Each live chapter card is `.ts-contents-card` / `.ts-chapter` with `data-ts-chapter` and `data-ts-status`, containing `.ts-chapter-copy`, `.ts-chapter-thumb`, `.ts-chapter-footer`, `.ts-chapter-status`, and the existing `.ts-chapter-button`. No `.ts-chapter-thumb-wrap` contract exists.
- Desktop uses three equal columns with explicit single-column card layout, aligned top chapter numbers/copy, fixed 150px thumbnail crops, and footer status/actions aligned at the bottom. There are no fake headers, generated guide copy, thick rails, or repeated rounded outer cards.
- Mobile uses two columns for every width up to 759px: thumbnail plus copy on the first row, footer status/action below the copy. At 359px and below, the thumbnail is 64px; otherwise it is 76px. This preserves readable chapter titles and short pages.
- Gallery scene height uses a viewport-aware clamp on desktop; the intro scene uses a shorter `calc(100svh - 300px)` clamp. Images use `object-fit: cover` and intrinsic image height does not expand the layout.
- Choice groups reserve a 28px check column for every `.ts-step .ts-chip`; selected markers are 16px at an 8px inset. Selected and unselected tiles remain equal height with 16px text. The done/gallery layer is unaffected.
- Existing chapter labels, subtitles, progress count, states (`未着手` / `途中` / `完了`), actions (`はじめる` / `つづける` / `見直す`), chapter navigation, and manual link behavior remain authoritative. The board's sample imagery and typography are references only; exact Japanese text is HTML/CSS.

## Exact ImageGen prompt

Use case: UI mockup. Create one high-fidelity product design board for Mingle.cards “わたしのトリセツ” contents screen, showing a mature editorial table of contents rather than a list of repeated rounded cards. Show a warm cream desktop app viewport and a small mobile inset in the same board. Existing structure only as content reference: three actual chapters named 「満たされるもの、足りないもの」「頭の中の声」「心が動くとき」, actual progress 3章中0章できた, and an existing manual link. Design the desktop as three distinct compact editorial chapter columns or book-like panels with generous but controlled whitespace, varied navy/blue/coral details, clear states 「未着手」「途中」「完了」 and actions 「はじめる」「つづける」「見直す」. Use a restrained warm cream, deep navy, vivid blue, and very small coral accent palette. Preserve the by Mingle.cards header and a slim progress line. Use sophisticated typography and visual hierarchy, with each chapter feeling like a chapter cover or catalog entry; avoid a full-width stack of horizontal cards, repeated blue pill buttons, excessive rounded rectangles, thick vertical color rails, decorative AI-like strips, giant blank space, childish illustration, gender-coded people, flowers, hearts, gradients, dashboard UI, or heavy shadows. Mobile inset should show a compact vertical editorial list with small book/number marks and short rows, keeping the page height short. Include only short realistic Japanese labels; text is a visual approximation and final HTML/CSS will render exact copy. No browser chrome, no recreated logo, no watermark. This is a design reference board, not production UI.

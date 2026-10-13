# Gallery visual contract

- `ts-gallery` is the optional screen wrapper. `ts-gallery-scene` holds one scene image and `ts-gallery-copy` holds live HTML text/actions.
- Stage modifiers: `data-gallery-stage="arrival|deep|discovery|manual"` (or matching `is-arrival`, `is-deep`, `is-discovery`, `is-manual`). CSS maps arrival/deep/discovery/manual to cream, navy, navy, and cream palettes.
- Scene image assets live in `dist/assets/torisetsu-gallery/`; alt is empty when decorative. Do not bake text or controls into the image.
- Desktop is a two-column scene/copy composition; compact screens stack a roughly 180px scene above the prompt. Discovery keeps the insight headline readable in the dark copy panel. Manual pairs cover art with chapter navigation and one active section.

## Markup expected by the CSS bridge

For each gallery step, use this shape so the scene is a real visual column instead of a small replacement icon:

```html
<section class="ts-step ts-gallery" data-ts-scene="gallery" data-gallery-stage="arrival">
  <div class="ts-step-progress"><ol class="ts-steps5">…</ol><span class="ts-step-local">…</span></div>
  <figure class="ts-gallery-scene"><img src="./assets/torisetsu-gallery/arrival-gallery.png" alt="" aria-hidden="true"></figure>
  <div class="ts-gallery-copy">…live h1, options and actions…</div>
</section>
```

Deep uses `deep-layers.png`, discovery uses `discovery-sculpture.png`, and manual uses `book-cover-architecture.png`. The scene/content wrapper above is the production contract. Progress must stay inside `.ts-step-progress`, which spans the full gallery width before the scene and copy columns.

# Card art delivery

The production art is split into nine family pairs under `dist/assets/card-families/`. The original portrait pairs are preserved in `sources/`; the WebP files are technical crops for the four front corners and full back surface. The app overlays all question, title, progress, logo, audio, and interaction text as HTML so generated art never supplies copy.

`theme-mapping.json` is generated from the actual `dist/data/decks.js` and `dist/data/solo-decks.js` imports. It records 44 themes, their family, mode, explicit variant, and accent. The last verification reported missing=0 and extra=0.

Generation used the built-in ImageGen tool. `sources/README.md` and `generation-prompts.md` distinguish the recorded prompt direction from exact prompt text where the earlier approved calls were not recoverable verbatim. No marketplace, LP, or unrelated assets are part of this delivery.

# Theme explorer assets v1

The built-in ImageGen tool generated 51 individual, text-free theme illustrations. The original PNG sources remain in `sources/` for local review and are intentionally excluded from the delivery asset set; the optimized WebP files in `webp/` and `dist/assets/theme-explorer/` are the runtime assets.

`registry-v1.json` is the authoritative 51-theme manifest. `adultOnly` themes require the existing age/display gate. `optionalR18` marks themes such as date that can offer optional adult questions after the existing consent flow; it does not make the theme adult-only. The manifest does not classify thumbnail images.

`dist/theme-explorer.js` provides the safe image registry lookup and owner/mode-separated recent-start history. `dist/app.js` uses the registry for the common group/solo shelves and records history only after a session starts. Unknown IDs, deleted themes, unavailable saved sets, and hidden adult sets are ignored by the explorer.

The generated scene prompts and provenance remain alongside the manifest. The contact sheet is a review artifact; production rendering uses one lazy-loaded WebP per card with explicit dimensions.

# Mingle LP experiences

The public preview supports three explicit experiences: `everyday` (default), `date`, and `team`.

Selection priority is `?experience=` when it is one of the allowlisted values, then an allowlisted `utm_content` or `utm_campaign` token, then the visitor's own saved first-party preference, then `everyday`.

Examples:

- `/about/index.html?experience=date`
- `/about/index.html?utm_campaign=team-meetup`
- `/about/index.html?utm_content=everyday-friends`

Only these exact campaign terms map: `mingle-date`, `date`, `romance`, `couple`, `first-date`; `mingle-team`, `team`, `work`, `meetup`, `business`, `team-meetup`; and `mingle-everyday`, `everyday`, `family`, `friends`, `general`, `everyday-friends`. Matching checks `utm_content` before `utm_campaign`. Unknown or missing tags fall through to a valid saved preference, then `everyday`. Campaign parameters are read for the current visit and are not persisted.

The visitor can choose a scene in the “どんな時間に使う？” control. That deliberate action stores only the Mingle display preference in first-party `localStorage` under `mingle.lp.experience.v1`, with version `1` and a 30-day expiry. Manual selection adds/replaces the `experience` URL parameter while preserving unrelated parameters. “選び直す” removes the saved preference and removes recognized campaign/experience parameters. Storage access is wrapped so blocked or unavailable storage does not break the page.

The LP does not read third-party cookies, browser history, other apps, fingerprinting signals, or inferred sensitive interests. The game CTA remains the existing `https://mingle.cards/` entry point; the LP does not invent theme deep links.

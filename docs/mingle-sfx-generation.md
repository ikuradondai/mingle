# Mingle.cards SFX generation record

Regenerated 2026-10-18 with the ElevenLabs Sound Generation API workflow from `C:/dev/king-quests/tools/generate_sfx_elevenlabs.py`, posting to `https://api.elevenlabs.io/v1/sound-generation`. The API key was loaded from the existing `C:/dev/king-quests/.env`; its value is not recorded. The generation run returned fresh audio bytes for all five scoped effects: `card-click` (8,820 bytes), `card-flip` (13,835), `theme-select` (17,179), `reaction-same` (18,433), and `reaction-surprise` (20,105). A stronger second `reaction-same` candidate was selected after waveform comparison; the final processed asset SHA-256 begins `DBEDD55E`. The API rejected the first prompt batch because several prompts exceeded its 450-character limit; those prompts were shortened and the five requests then succeeded.

The new prompts ask for close-mic physical Foley: paper card stock, hand movement, wood/table contact, paper air, and short natural room reflections. They explicitly exclude electronic tones, synthesizers, pitch sweeps, melodies, chimes, sparkle, arcade/game sounds, and notification sounds. Theme selection is a 1-second layered paper action; flip is 0.8 seconds; reactions are 1.1 and 1.2 seconds to allow a physical lead-in and room tail. Completion sounds were not changed.

Decoded verification used the `audio-decode` MP3 decoder at 44.1 kHz stereo. Final decoded peaks are click -4.77 dBFS, flip -4.55 dBFS, theme -4.20 dBFS, same -4.44 dBFS, and surprise -8.92 dBFS. No decoded sample reached or exceeded -3 dBFS.

No subjective listening judgment is recorded here. The generated files are available directly in `dist/assets/audio/` for playback review.

## Level audit and runtime recommendations

Active RMS uses a -50 dBFS sample activity threshold across decoded stereo PCM. The five final files received one offline ffmpeg dynamics/level pass from originals held in `C:/Users/kuran/AppData/Local/Temp/mingle-audio-originals-20261018`. The pass used gentle 2:1 compression with makeup, per-file attenuation/makeup, and a final headroom limiter; a second conservative attenuation pass corrected MP3 codec overshoot.

| asset | decoded duration | active RMS | peak | strongest 20 ms | adopted runtime gain |
| --- | ---: | ---: | ---: | ---: | ---: |
| click | 0.480 s | -23.43 dBFS | -4.77 dBFS | 0.18 s | 0.75 |
| flip | 0.800 s | -24.58 dBFS | -4.55 dBFS | 0.26 s | 0.85 |
| theme | 1.000 s | -26.08 dBFS | -4.20 dBFS | 0.70 s | 0.85 |
| reaction-same | 1.080 s | -23.91 dBFS | -4.44 dBFS | 0.10 s | 0.85 |
| reaction-surprise | 1.200 s | -21.25 dBFS | -8.92 dBFS | 0.08 s | 0.65 |

The reaction RMS values now sit within 2.7 dB, and every decoded peak is below -3 dBFS. Theme remains slightly quieter at -26.08 dBFS because its physical transient was already close to the headroom ceiling. The adopted values in the table match the final `dist/card-audio.js` runtime gains.

## Reaction timing for motion sync

Waveform inspection of the processed decoded files found the strongest 20 ms window of `reaction-same` around 0.10 seconds, with the broader card movement active through approximately 0.83 seconds; runtime starts its source at `now` so it stays aligned with the visual pop. The strongest `reaction-surprise` window is around 0.08 seconds, with the main active material ending around 0.38 seconds and a quiet tail to 1.20 seconds; runtime also starts its source at `now`. These are measured signal landmarks and scheduling values, not subjective listening judgments.

## Prior completion asset history

The four completion assets were generated in the 2026-10-17 ElevenLabs batch and were not changed in this regeneration. Their decoded durations were approximately 2.821 s (confetti), 3.265 s (fireworks), 2.952 s (ribbons), and 2.952 s (cards). The prior record measured post-adjustment active RMS values of -21.25, -20.59, -20.49, and -22.73 dBFS respectively, with decoded peaks between -6.52 and -3.61 dBFS. No listening-based judgment was made for those assets.

## Card click bell replacement

The prior click asset (SHA-256 `7EDBB318E52B80A470191B56AF4C9DF96827E3DF1ABA81227606994B565261F7`) was replaced on 2026-10-18 after the brief changed from physical card Foley to a short, clear, joyful bell cue. Two fresh ElevenLabs candidates were generated with the existing Sound Generation API workflow. Candidate A is available at `C:/Users/kuran/AppData/Local/Temp/mingle-click-bell-candidates/candidate-a.mp3` (SHA-256 `642E23947CEC95FFCEEC7CD279133144DF6EE632865E0103E0CFFDE2FF01AA92`, decoded 0.680 s, active RMS -25.52 dBFS, peak -2.76 dBFS). Candidate B is available at `C:/Users/kuran/AppData/Local/Temp/mingle-click-bell-candidates/candidate-b.mp3` (SHA-256 `6A8F4CED6020A48B878EAF677C336FFA48C2C5188F76AB0C2D292A48D60D0893`, decoded 0.680 s, active RMS -23.84 dBFS, peak -5.01 dBFS).

Candidate B was adopted because its bell transient has safer headroom and a moderate active level for repeated clicks. It is now the runtime `dist/assets/audio/mingle-card-click.mp3` with the same adopted runtime gain `0.75`; `dist/card-audio.js` only received the cache-busting URL update `v=20-bell-20261018`. The final asset SHA-256 is `6A8F4CED6020A48B878EAF677C336FFA48C2C5188F76AB0C2D292A48D60D0893`. No subjective listening claim is made; the candidate paths are provided for human audition.

## Long-tail 2026-10-18 replacement batch

The complete nine-effect set was regenerated through the same ElevenLabs Sound Generation API workflow after feedback that the prior sounds were too short. The new target durations are click 1.5 s, flip 1.5 s, theme 1.8 s, same/surprise 4.8 s, and approximately 5 s for all four completion effects. The click prompt now describes only a short warm acoustic handbell blessing with natural attack and clean decay; it contains no click, UI, or card-selection language. Completion prompts retain the requested crowd cheer/applause and distinct fireworks, card shuffle, cracker/ribbon, and paper-confetti identities.

Final decoded measurements after one ffmpeg loudness/headroom pass (44.1 kHz stereo, active RMS threshold -50 dBFS) are: click 1.480 s / -29.55 dBFS / -5.44 dBFS peak / main attack 0.14 s; flip 1.480 s / -27.32 / -6.18 / 0.72 s; theme 1.760 s / -28.82 / -4.45 / 1.44 s; confetti 5.000 s / -28.16 / -12.98 / 0.00 s; fireworks 5.000 s / -30.37 / -17.53 / 0.22 s; ribbons 5.000 s / -29.08 / -13.38 / 1.26 s; cards 5.000 s / -29.20 / -4.43 / 0.76 s; same 4.800 s / -27.72 / -4.44 / 0.40 s; surprise 4.800 s / -24.16 / -4.45 / 3.68 s. No decoded peak exceeds -3 dBFS. These are waveform measurements, not listening judgments. Runtime gain and cancellation behavior were not changed; cache-busting URLs are `v=21-long-20261018`.

Final processed SHA-256 hashes: click `023E3576C35CCEA5C219CC00F8B09B7074FA655909E1E58063CF42718C2A09AB`; flip `4E1E8F84D0E68E14FBA59C9382C9C68986181B3429ADDCD19E3B9311115C2F38`; theme `90CD15ADAF9F8D27640CCB8020062C098CB183B485848807E8B00280C7822EBB`; confetti `98C53D987D19897556751D692F58ACF1FF7E203998B91FB33EDB2324F5A23E26`; fireworks `609CD668F4F7988AC5511FC9A250318C6F2A7C59E582C709B750EFE55EF38932`; ribbons `51EF353E76B8981A2B973A0B6F2ED1DFB10638C30C45B3E9479A6B96CA2C8DBF`; cards `AE56DD0BD54090A02ED6A438307B3785E7959BE94F057452E7DAE085A0C38641`; same `6FCC5095D51315CAFA36BC6F8C3C252E39F299BCE7CEF2DCAF59F6FEAC9075B9`; surprise `A75DA7066C0BF5745D3B5E1C16A0B7603475C0D4177FDD2494E1BD62A7302AB2`.

### Latest post-leveling audit

The subsequent light compression/makeup pass and per-file headroom correction produced the current values below; these supersede the initial long-batch measurements above. Active RMS uses the same -50 dBFS threshold, and peaks are decoded MP3 sample peaks.

| asset | duration | active RMS | peak | first 0.5 s RMS | strongest 20 ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| click | 1.480 s | -28.34 dBFS | -4.56 dBFS | -25.16 dBFS | 0.14 s |
| flip | 1.480 s | -24.37 dBFS | -4.22 dBFS | -23.07 dBFS | 1.14 s |
| theme | 1.760 s | -28.49 dBFS | -3.89 dBFS | -39.09 dBFS | 1.44 s |
| confetti | 5.000 s | -21.78 dBFS | -7.13 dBFS | -19.08 dBFS | 0.86 s |
| fireworks | 5.000 s | -20.54 dBFS | -6.88 dBFS | -17.69 dBFS | 0.22 s |
| ribbons | 5.000 s | -20.94 dBFS | -4.06 dBFS | -36.04 dBFS | 1.26 s |
| cards | 5.000 s | -27.96 dBFS | -4.89 dBFS | -27.90 dBFS | 2.54 s |
| same | 4.800 s | -28.62 dBFS | -5.60 dBFS | -27.31 dBFS | 0.68 s |
| surprise | 4.800 s | -25.80 dBFS | -5.26 dBFS | -22.21 dBFS | 3.68 s |

Surprise has measurable material in the first 0.5 seconds (first-500-ms RMS -22.21 dBFS), so it was retained; its strongest later resonance is at 3.68 seconds. No subjective listening judgment is implied. Current final SHA-256 values are click `B642F16AAE4D5D2D8376B6AB1202EBE36A9037F576AE81FFADB0181F0807CF6A`, flip `F34E3BB1D0322A32980A88E2943A681EA7B3443284F516D50829969A092385A4`, theme `E7F3906C14E478A93AEC110FC19759606776335155486A81C388BB57D7853E73`, confetti `4978B4A580820B180CB8772BBA05538625340DDFC79AA3BBA236DE14190CF84B`, fireworks `6AFA020C56AE9F7CFE161450A6D9A04B7B6ABBE7B6DE88C65E85B699DB7ED2F7`, ribbons `1C168A156FE5EB4B453C9B81C8C1DC8B7C186D2B31D399A1ACFF3FB5215835C5`, cards `D37EC391DBB80CE2611D6F917C83BBAD9B1E5DE5BD8011DC908C2309DF884AB7`, same `D495BE378788EB6117BCED36983075A95068FF4EB63B64B7731937C9786DF25E`, surprise `E03B2F35B1D4D61315405EDDED6487E60553E426805882BFA54675CA4F49E217`.

## Current runtime note

The current implementation starts both reaction sounds immediately (`0 s` scheduling delay) so the audio impact stays aligned with the fast visual pop. The current adopted assets are: click 1.760 s decoded (applause candidate), flip 0.800 s, theme 1.760 s, confetti/fireworks/ribbons/cards 5.000 s each, same 1.200 s (latest cheer replacement), and surprise 1.200 s (latest cheer replacement). The click prompt requested 1.8 s from ElevenLabs and decoded to 1.760 s. `artifacts/audio-preview/unused/mingle-next-person.mp3` and `artifacts/audio-preview/unused/_gen_next_person.py` are intermediate files from a separate next-person experiment, are not referenced by the current mapping, and remain excluded from staging.

## Restored short reaction assets

The long-batch flip and reaction assets were restored byte-for-byte from commit `f20e53116e45005ee23cd3007cf17d2caa8b08ef`: flip 0.800 s SHA-256 `22037C778186BD3AD9443E110525D7472BF0A2CFE5987B99864C794F915EE867`; same 1.080 s SHA-256 `DBEDD55E14BF14285B8FC7EDD17EB39B646B23730C0829849B538EF29A0E206B`; surprise 1.200 s SHA-256 `D6929BF8C2F9BD833E9EA91C33A86F129D7487ADC934DE41C9B6FA801924513D`. Their cache URLs use `v=23-short-20261018`; gains are unchanged.

## Applause click replacement

The selected click replacement is the audience applause candidate `artifacts/audio-audition/applause-20261018/05-audience-blessing.mp3`, copied byte-for-byte to `dist/assets/audio/mingle-card-click.mp3`. It is 1.760 seconds, active RMS -27.82 dBFS, decoded peak -9.46 dBFS, and SHA-256 `6F3912B83CCC7A4F4DF1ADF43048D7A45CAB09E5AA03B70E03D75557355B54E8`. The adopted runtime gain remains `0.75`; only the click cache URL changed to `v=22-applause-20261018`. The original five applause candidates and measurements remain in `artifacts/audio-audition/applause-20261018/manifest.json`. No subjective listening claim is made.

## Reaction cheer replacement

Generated 2026-10-19 with the existing ElevenLabs Sound Generation API workflow from `C:/dev/king-quests/tools/generate_sfx_elevenlabs.py`, using the existing `C:/dev/king-quests/.env` key without recording its value. Only the two reaction assets were regenerated. `reaction-same` requests an immediate bright multi-person “Yeah/Yes” cheer for joyful agreement; `reaction-surprise` requests a distinct positive multi-person “Whoa/Ooh/Wow” exclamation for happy surprise. Both prompts exclude applause, instruments, electronic/metal sounds, fear, screams, and booing.

The generated MP3s were decoded and leveled offline with PyAV/libmp3lame to a decoded peak near -4.5 dBFS, preserving the requested short duration and 44.1 kHz stereo format. Measurements below use decoded PCM and mono active RMS; they are waveform measurements, not subjective listening judgments.

| asset | decoded duration | active RMS | peak | first 0.5 s RMS | SHA-256 |
| --- | ---: | ---: | ---: | ---: | --- |
| reaction-same | 1.200 s | -22.17 dBFS | -4.50 dBFS | -18.97 dBFS | `18D1B51F31FA0A1C53E9377B29FF0EAEDEAB7676615A1219612C3B98448A4B26` |
| reaction-surprise | 1.200 s | -17.97 dBFS | -4.54 dBFS | -14.58 dBFS | `BE0A1EBE582DC864E3AFB34CE8ADA8540CBD24CFF66934D7C8174991908CF78F` |

The existing reaction runtime gains remain unchanged at `0.85` for same and `0.65` for surprise; all other audio assets and behavior remain unchanged. The reaction URLs now use cache-buster `v=24-cheer-20261019`. No local audio playback/listen tool was available in the current environment (no native audio app or browser tab was exposed), so no subjective audition claim is made.

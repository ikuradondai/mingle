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

Waveform inspection of the processed decoded files found the strongest 20 ms window of `reaction-same` around 0.10 seconds, with the broader card movement active through approximately 0.83 seconds; runtime schedules its source at `now + 0.28 s`. The strongest `reaction-surprise` window is around 0.08 seconds, with the main active material ending around 0.38 seconds and a quiet tail to 1.20 seconds; runtime schedules its source at `now + 0.26 s`. These are measured signal landmarks and scheduling values, not subjective listening judgments.

## Prior completion asset history

The four completion assets were generated in the 2026-10-17 ElevenLabs batch and were not changed in this regeneration. Their decoded durations were approximately 2.821 s (confetti), 3.265 s (fireworks), 2.952 s (ribbons), and 2.952 s (cards). The prior record measured post-adjustment active RMS values of -21.25, -20.59, -20.49, and -22.73 dBFS respectively, with decoded peaks between -6.52 and -3.61 dBFS. No listening-based judgment was made for those assets.

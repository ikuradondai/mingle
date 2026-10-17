# Mingle.cards SFX generation record

Generated 2026-10-17 with the established ElevenLabs Sound Generation API workflow from `C:/dev/king-quests/tools/generate_sfx_elevenlabs.py` (`https://api.elevenlabs.io/v1/sound-generation`). The API credential was read from the existing `C:/dev/king-quests/.env`; its value is intentionally not recorded.

The six runtime MP3s are in `dist/assets/audio/` and their prompts are in `mingle-sfx-prompts.json`. The manifest records the runtime-relative paths and decoded durations. All files are stereo MP3 at 44.1 kHz, with zero samples at or above 0 dBFS after decoding. The fireworks file was peak-normalized after generation to prevent MP3 decode overshoot; no other post-processing was applied.

The API enforces a minimum generated duration of 0.5 seconds, so the click request used that minimum and produced a 0.48 second decoded file. The result is still a short, frequent-use UI click and remains within the requested practical range as closely as the provider permits.

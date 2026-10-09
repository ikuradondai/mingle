# Audio assets

## Card flip

- Provider: ElevenLabs Sound Generation API
- Generated: 2026-10-04
- Runtime asset: `dist/assets/audio/mingle-card-flip.mp3`
- Source candidate: 17 Cotton Table
- Decoded format: MP3, 48 kHz, stereo, 0.48 seconds
- Source SHA-256: `fb811852c967ff14a5faf29065c27ca900e7f31bb2985598ff06b6a73bec95ce`
- Peak: -2.85 dBFS; clipped samples: 0
- Post-processing: listening-copy loudness normalization (`loudnorm=I=-24:TP=-3:LRA=7`); the selected MP3 is used unchanged at runtime
- Runtime behavior: played from the local asset; no runtime audio-generation API call

Selection prompt:

> A single paper card turn on a cotton-covered surface: gentle close paper flutter, tiny fabric brush, and a soft muted contact. Clearly one card flip, intimate, calm, and repeatable. No voice, speech, music, melody, chime, magic, fanfare, or extra taps.

Other generated candidates remain in the external audio artifact directory and are not included in the product bundle.

## ワンカット（合成音）

- ビープ（880Hz・120ms）とカチンコ音／カット音は、実行時に Web Audio（`dist/one-cut-audio.js`）で合成します。音源ファイルと外部の音声生成APIは使わないため、このファイルへの出典・ハッシュの記録対象はありません。
- 仕様書（`docs/games/one-cut.md` §2.5）にある `dist/assets/audio/one-cut-clap.mp3` は作成していません。実機で合成音が不自然な場合に、上の「Card flip」と同じ手順で生成して置き換えます。

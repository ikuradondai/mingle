// Sound for 「ワンカット」: beeps and the clapper are synthesized with Web Audio (no audio files).
// Sound is a bonus: every function here swallows its errors, and the game is fully playable without it.
// The AudioContext must be created / resumed inside a user gesture (iOS Safari), so call unlockAudio() from a click handler.
const STORAGE_KEY = 'mingle.oneCut.sound';
let context = null;
let unlocked = false;
let scheduled = [];

export function getSoundPreference(defaultOn) {
  try {
    const saved = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (saved === '1') return true;
    if (saved === '0') return false;
  } catch {
    // Storage can be unavailable (private mode); fall back to the default.
  }
  return defaultOn === true;
}
export function saveSoundPreference(on) {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, on ? '1' : '0');
  } catch {
    // The in-memory choice still applies to this page.
  }
}

const contextClass = () => globalThis.AudioContext || globalThis.webkitAudioContext || null;
export const isAudioSupported = () => Boolean(contextClass());
export const isAudioUnlocked = () => unlocked && Boolean(context) && context.state !== 'suspended' && context.state !== 'closed';

// Call from a user gesture. Resolves to true once the context is running.
export async function unlockAudio() {
  try {
    const Context = contextClass();
    if (!Context) return false;
    try {
      if (globalThis.navigator?.audioSession) globalThis.navigator.audioSession.type = 'playback';
    } catch {
      // Not supported everywhere; ignore.
    }
    if (!context || context.state === 'closed') context = new Context();
    if (context.state === 'suspended') await context.resume();
    // Starting a silent buffer inside the gesture is what makes iOS accept later, scheduled sounds.
    const silent = context.createBuffer(1, 1, context.sampleRate || 22050);
    const source = context.createBufferSource();
    source.buffer = silent;
    source.connect(context.destination);
    source.start(0);
    unlocked = context.state === 'running' || unlocked;
    return isAudioUnlocked();
  } catch {
    return false;
  }
}

function envelope(gain, when, peak, length) {
  gain.gain.setValueAtTime(0.0001, when);
  gain.gain.exponentialRampToValueAtTime(peak, when + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, when + length);
}
function beep(when) {
  const osc = context.createOscillator();
  const gain = context.createGain();
  osc.type = 'sine';
  osc.frequency.value = 880;
  envelope(gain, when, 0.35, 0.12);
  osc.connect(gain).connect(context.destination);
  osc.start(when);
  osc.stop(when + 0.14);
  return osc;
}
// Clapper: a short burst of decaying noise plus a low knock.
function clap(when) {
  const length = 0.3;
  const frames = Math.max(1, Math.floor((context.sampleRate || 22050) * length));
  const buffer = context.createBuffer(1, frames, context.sampleRate || 22050);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < frames; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / frames) ** 3;
  const noise = context.createBufferSource();
  const noiseGain = context.createGain();
  noise.buffer = buffer;
  envelope(noiseGain, when, 0.7, length);
  noise.connect(noiseGain).connect(context.destination);
  noise.start(when);
  const knock = context.createOscillator();
  const knockGain = context.createGain();
  knock.type = 'triangle';
  knock.frequency.setValueAtTime(180, when);
  knock.frequency.exponentialRampToValueAtTime(70, when + 0.08);
  envelope(knockGain, when, 0.5, 0.12);
  knock.connect(knockGain).connect(context.destination);
  knock.start(when);
  knock.stop(when + 0.14);
  scheduled.push(knock); // cancelCues stops the knock together with the noise burst
  return noise;
}

// Reserve a cue `delayMs` from now on the audio clock (not on setTimeout). Returns false when nothing was scheduled.
export function scheduleCue(kind, delayMs = 0) {
  try {
    if (!isAudioUnlocked()) return false;
    const when = context.currentTime + Math.max(0, delayMs) / 1000;
    const node = kind === 'clap' ? clap(when) : beep(when);
    scheduled.push(node);
    return true;
  } catch {
    return false;
  }
}
export function scheduleCues(cues) {
  return cues.reduce((count, cue) => count + (scheduleCue(cue.kind, cue.delayMs) ? 1 : 0), 0);
}
export function cancelCues() {
  for (const node of scheduled) {
    try {
      node.stop();
    } catch {
      // Already finished.
    }
  }
  scheduled = [];
}

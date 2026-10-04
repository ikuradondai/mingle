const STORAGE_KEY = "mingle.cardAudio.enabled";
let enabled = true;
let context = null;
let soundRevision = 0;
let activeSource = null;
let activeGain = null;
let audioBytesPromise = null;
let audioBufferPromise = null;
const AUDIO_URL = "/assets/audio/mingle-card-flip.mp3";

try {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === "0") enabled = false;
  if (saved === "1") enabled = true;
} catch {
  // Storage can be unavailable in private or restricted browsing modes.
}

function fetchAudioBytes() {
  if (audioBytesPromise) return audioBytesPromise;
  try {
    audioBytesPromise = fetch(AUDIO_URL, { cache: "force-cache" })
      .then((response) => { if (!response.ok) throw new Error(`audio-${response.status}`); return response.arrayBuffer(); })
      .catch(() => { audioBytesPromise = null; return null; });
  } catch {
    audioBytesPromise = null;
    return Promise.resolve(null);
  }
  return audioBytesPromise;
}

if (enabled) fetchAudioBytes();

export function isCardAudioEnabled() {
  return enabled;
}

export function toggleCardAudio() {
  enabled = !enabled;
  soundRevision += 1;
  if (!enabled) stopActiveSource();
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    // The in-memory preference still works for this page.
  }
  return enabled;
}

function stopActiveSource() {
  if (!activeSource) return;
  try { activeSource.stop(); } catch { /* already ended */ }
  try { activeSource.disconnect(); } catch { /* already disconnected */ }
  try { activeGain?.disconnect(); } catch { /* already disconnected */ }
  activeSource = null;
  activeGain = null;
}

function loadAudioBuffer(audioContext) {
  if (audioBufferPromise) return audioBufferPromise;
  audioBufferPromise = fetchAudioBytes()
    .then((data) => data ? audioContext.decodeAudioData(data.slice(0)) : null)
    .then((buffer) => { if (!buffer) { audioBufferPromise = null; audioBytesPromise = null; } return buffer; })
    .catch(() => { audioBufferPromise = null; audioBytesPromise = null; return null; });
  return audioBufferPromise;
}

export function playFlipSound() {
  if (!enabled) return;
  const revision = ++soundRevision;
  try {
    context ||= new (window.AudioContext || window.webkitAudioContext)();
    const start = (buffer) => {
      if (!buffer || !enabled || revision !== soundRevision) return;
      stopActiveSource();
      const source = context.createBufferSource();
      const gain = context.createGain();
      gain.gain.value = 0.72;
      source.buffer = buffer;
      source.connect(gain).connect(context.destination);
      activeSource = source;
      activeGain = gain;
      source.onended = () => {
        try { source.disconnect(); gain.disconnect(); } catch { /* already disconnected */ }
        if (activeSource === source) { activeSource = null; activeGain = null; }
      };
      try { source.start(); } catch {
        try { source.disconnect(); gain.disconnect(); } catch { /* already disconnected */ }
        if (activeSource === source) { activeSource = null; activeGain = null; }
      }
    };
    const loadAndStart = () => { if (!enabled || revision !== soundRevision) return; loadAudioBuffer(context).then(start).catch(() => {}); };
    if (context.state === "suspended") context.resume().then(loadAndStart).catch(() => {});
    else loadAndStart();
  } catch {
    // Audio is decorative; card play must continue when unsupported or blocked.
  }
}

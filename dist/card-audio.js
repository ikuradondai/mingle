const STORAGE_KEY = "mingle.cardAudio.enabled";
const AUDIO_URLS = {
  flip: "/assets/audio/mingle-card-flip.mp3?v=23-short-20261018",
  click: "/assets/audio/mingle-card-click.mp3?v=22-applause-20261018",
  theme: "/assets/audio/mingle-theme-select.mp3?v=21-long-20261018",
  "reaction-same": "/assets/audio/mingle-card-reaction-same.mp3?v=24-cheer-20261019",
  "reaction-surprise": "/assets/audio/mingle-card-reaction-surprise.mp3?v=26-packed-crowd-20261019",
  "celebration-confetti": "/assets/audio/mingle-celebration-confetti.mp3?v=21-long-20261018",
  "celebration-fireworks": "/assets/audio/mingle-celebration-fireworks.mp3?v=21-long-20261018",
  "celebration-ribbons": "/assets/audio/mingle-celebration-ribbons.mp3?v=21-long-20261018",
  "celebration-cards": "/assets/audio/mingle-celebration-cards.mp3?v=21-long-20261018",
};
let enabled = true;
let context = null;
let soundRevision = 0;
const activeSources = new Set();
const activeSourceKeys = new Map();
const cancelledKeys = new Set();
const audioBytesPromises = new Map();
const audioBufferPromises = new Map();

try {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === "0") enabled = false;
  if (saved === "1") enabled = true;
} catch {
  // Storage can be unavailable in private or restricted browsing modes.
}

if (enabled) Object.keys(AUDIO_URLS).forEach((key) => { fetchAudioBytes(key); });

function fetchAudioBytes(key) {
  if (audioBytesPromises.has(key)) return audioBytesPromises.get(key);
  const url = AUDIO_URLS[key];
  if (!url) return Promise.resolve(null);
  let promise;
  try {
    promise = fetch(url, { cache: "force-cache" })
      .then((response) => { if (!response.ok) throw new Error(`audio-${response.status}`); return response.arrayBuffer(); })
      .catch(() => { audioBytesPromises.delete(key); return null; });
  } catch {
    promise = Promise.resolve(null);
  }
  audioBytesPromises.set(key, promise);
  return promise;
}

export function isCardAudioEnabled() {
  return enabled;
}

export function toggleCardAudio() {
  enabled = !enabled;
  soundRevision += 1;
  if (!enabled) stopActiveSources();
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    // The in-memory preference still works for this page.
  }
  return enabled;
}

export function stopCardAudio() {
  soundRevision += 1;
  stopActiveSources();
}

function stopActiveSources() {
  for (const source of activeSources) {
    try { source.stop(); } catch { /* already ended */ }
    try { source.disconnect(); } catch { /* already disconnected */ }
    activeSourceKeys.delete(source);
  }
  activeSources.clear();
}

function loadAudioBuffer(key, audioContext) {
  if (audioBufferPromises.has(key)) return audioBufferPromises.get(key);
  const promise = fetchAudioBytes(key)
    .then((data) => data ? audioContext.decodeAudioData(data.slice(0)) : null)
    .then((buffer) => { if (!buffer) { audioBufferPromises.delete(key); audioBytesPromises.delete(key); } return buffer; })
    .catch(() => { audioBufferPromises.delete(key); audioBytesPromises.delete(key); return null; });
  audioBufferPromises.set(key, promise);
  return promise;
}

function playAudioKey(key, gainValue = 0.72, delaySeconds = 0) {
  if (!enabled || !AUDIO_URLS[key]) return;
  cancelledKeys.delete(key);
  const revision = ++soundRevision;
  try {
    context ||= new (window.AudioContext || window.webkitAudioContext)();
    const start = (buffer) => {
      if (!buffer || !enabled || revision !== soundRevision || cancelledKeys.has(key)) return;
      stopActiveSources();
      const source = context.createBufferSource();
      const gain = context.createGain();
      gain.gain.value = gainValue;
      source.buffer = buffer;
      source.connect(gain).connect(context.destination);
      activeSources.add(source);
      activeSourceKeys.set(source, key);
      source.onended = () => { try { source.disconnect(); gain.disconnect(); } catch { /* already disconnected */ } activeSources.delete(source); activeSourceKeys.delete(source); };
      try { source.start(context.currentTime + Math.max(0, delaySeconds)); } catch { activeSources.delete(source); activeSourceKeys.delete(source); try { source.disconnect(); gain.disconnect(); } catch { /* already disconnected */ } }
    };
    const loadAndStart = () => { if (!enabled || revision !== soundRevision) return; loadAudioBuffer(key, context).then(start).catch(() => {}); };
    if (context.state === "suspended") context.resume().then(loadAndStart).catch(() => {});
    else loadAndStart();
  } catch {
    // Audio is decorative; the action must continue when unsupported or blocked.
  }
}

export function playFlipSound() { playAudioKey("flip", 0.85); }
export function playUiClick() { playAudioKey("click", 0.75); }
export function playThemeSelectSound() { playAudioKey("theme", 0.85); }
export function playReactionSound(reaction) {
  if (reaction === "same") playAudioKey("reaction-same", 0.85);
  if (reaction === "surprise") playAudioKey("reaction-surprise", 0.65);
}
export function stopReactionSound() {
  cancelledKeys.add("reaction-same");
  cancelledKeys.add("reaction-surprise");
  for (const source of [...activeSources]) {
    const key = activeSourceKeys.get(source);
    if (!key || !key.startsWith("reaction-")) continue;
    try { source.stop(); } catch {}
    try { source.disconnect(); } catch {}
    activeSources.delete(source);
    activeSourceKeys.delete(source);
  }
}
export function playCompletionSound(variant) {
  if (typeof variant !== "string") return;
  playAudioKey(`celebration-${variant}`, 0.7);
}

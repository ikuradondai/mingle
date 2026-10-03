const STORAGE_KEY = "mingle.cardAudio.enabled";
let enabled = true;
let context = null;
let soundRevision = 0;

try {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved === "0") enabled = false;
  if (saved === "1") enabled = true;
} catch {
  // Storage can be unavailable in private or restricted browsing modes.
}

export function isCardAudioEnabled() {
  return enabled;
}

export function toggleCardAudio() {
  enabled = !enabled;
  soundRevision += 1;
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    // The in-memory preference still works for this page.
  }
  return enabled;
}

export function createPaperBuffer(audioContext) {
  const duration = 0.075;
  const buffer = audioContext.createBuffer(1, Math.floor(audioContext.sampleRate * duration), audioContext.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i += 1) {
    const envelope = Math.pow(1 - i / data.length, 2.4);
    data[i] = (Math.random() * 2 - 1) * envelope * 0.22;
  }
  return buffer;
}

export function playFlipSound() {
  if (!enabled) return;
  const revision = soundRevision;
  try {
    context ||= new (window.AudioContext || window.webkitAudioContext)();
    const start = () => {
      if (!enabled || revision !== soundRevision) return;
      const buffer = createPaperBuffer(context);
      const source = context.createBufferSource();
      const filter = context.createBiquadFilter();
      const gain = context.createGain();
      filter.type = "bandpass";
      filter.frequency.value = 1800;
      filter.Q.value = 0.7;
      gain.gain.value = 0.5;
      source.buffer = buffer;
      source.connect(filter).connect(gain).connect(context.destination);
      source.onended = () => {
        try {
          source.disconnect();
          filter.disconnect();
          gain.disconnect();
        } catch {
          // Nodes may already be disconnected by the browser.
        }
      };
      source.start();
    };
    if (context.state === "suspended") context.resume().then(start).catch(() => {});
    else start();
  } catch {
    // Audio is decorative; card play must continue when unsupported or blocked.
  }
}

import test from 'node:test';
import assert from 'node:assert/strict';

// The audio module reads AudioContext / localStorage from globalThis at call time, so each test installs its own doubles.
const audio = await import('../dist/one-cut-audio.js');
const restore = (key, value) => { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; };

function fakeContext({ state = 'suspended', fail = false } = {}) {
  const log = [];
  class FakeContext {
    constructor() { if (fail) throw new Error('nope'); this.state = state; this.currentTime = 10; this.sampleRate = 8000; this.destination = {}; }
    async resume() { this.state = 'running'; log.push('resume'); }
    createBuffer(channels, frames) { return { getChannelData: () => new Float32Array(frames) }; }
    createBufferSource() { const node = { connect: () => ({ connect: () => {} }), start: (when) => log.push(['buffer', when]), stop: () => log.push('stop-buffer') }; node.connect = (target) => target; return node; }
    createOscillator() { return { frequency: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: (target) => target, start: (when) => log.push(['osc', when]), stop: () => log.push('stop-osc') }; }
    createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect: (target) => target }; }
  }
  return { FakeContext, log };
}

test('without Web Audio nothing throws and nothing is scheduled', async () => {
  const saved = [globalThis.AudioContext, globalThis.webkitAudioContext];
  delete globalThis.AudioContext; delete globalThis.webkitAudioContext;
  try {
    assert.equal(audio.isAudioSupported(), false);
    assert.equal(await audio.unlockAudio(), false);
    assert.equal(audio.scheduleCue('beep', 100), false);
    assert.equal(audio.scheduleCues([{ kind: 'clap', delayMs: 5 }]), 0);
    assert.doesNotThrow(() => audio.cancelCues());
  } finally { restore('AudioContext', saved[0]); restore('webkitAudioContext', saved[1]); }
});

test('a constructor that throws is swallowed', async () => {
  const saved = globalThis.AudioContext;
  globalThis.AudioContext = fakeContext({ fail: true }).FakeContext;
  try {
    assert.equal(await audio.unlockAudio(), false);
    assert.equal(audio.scheduleCue('clap', 0), false);
  } finally { restore('AudioContext', saved); }
});

test('unlock resumes the context inside the gesture, then cues are reserved on the audio clock', async () => {
  const saved = globalThis.AudioContext;
  const { FakeContext, log } = fakeContext();
  globalThis.AudioContext = FakeContext;
  try {
    assert.equal(audio.scheduleCue('beep', 0), false, 'locked: nothing is scheduled before the gesture');
    assert.equal(await audio.unlockAudio(), true);
    assert.equal(audio.isAudioUnlocked(), true);
    assert.ok(log.includes('resume')); assert.ok(log.some((entry) => Array.isArray(entry) && entry[0] === 'buffer'), 'a silent buffer is started to settle iOS');
    log.length = 0;
    const count = audio.scheduleCues([{ kind: 'beep', delayMs: 500 }, { kind: 'beep', delayMs: 1500 }, { kind: 'clap', delayMs: 2500 }]);
    assert.equal(count, 3);
    const starts = log.filter((entry) => Array.isArray(entry)).map((entry) => entry[1]).sort((a, b) => a - b);
    assert.ok(starts.includes(10.5) && starts.includes(11.5) && starts.includes(12.5), `scheduled against currentTime: ${starts}`);
    assert.doesNotThrow(() => audio.cancelCues());
  } finally { restore('AudioContext', saved); }
});

test('the sound preference defaults per device and survives broken storage', () => {
  const saved = globalThis.localStorage;
  try {
    globalThis.localStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
    assert.equal(audio.getSoundPreference(true), true);
    assert.equal(audio.getSoundPreference(false), false);
    assert.doesNotThrow(() => audio.saveSoundPreference(true));
    const map = new Map();
    globalThis.localStorage = { getItem: (key) => map.get(key) ?? null, setItem: (key, value) => map.set(key, value) };
    assert.equal(audio.getSoundPreference(true), true);
    audio.saveSoundPreference(false);
    assert.equal(map.get('mingle.oneCut.sound'), '0');
    assert.equal(audio.getSoundPreference(true), false);
    audio.saveSoundPreference(true);
    assert.equal(audio.getSoundPreference(false), true);
  } finally { restore('localStorage', saved); }
});

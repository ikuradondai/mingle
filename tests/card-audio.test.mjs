import test from "node:test";
import assert from "node:assert/strict";

const original = {
  localStorage: globalThis.localStorage,
  fetch: globalThis.fetch,
  window: globalThis.window,
  AudioContext: globalThis.AudioContext,
};
const restore = (key, value) => { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; };

test("sound effects share the card preference, default on, and map completion variants", async () => {
  const storage = new Map();
  const requests = [];
  const starts = [];
  const stops = [];
  let deferredResolve = null;
  let deferred = false;
  globalThis.localStorage = { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
  globalThis.fetch = async (url) => { const key = String(url).split('/').pop().split('?')[0]; requests.push(key); return { ok: true, arrayBuffer: async () => ({ key, slice() { return this; } }) }; };
  class FakeContext {
    constructor() { this.state = "running"; this.destination = {}; }
    createBufferSource() { const source = { buffer: null, connect: () => source, start: () => starts.push(source.buffer), stop: () => stops.push(true), disconnect() {} }; return source; }
    createGain() { return { gain: { value: 0 }, connect: (target) => target, disconnect() {} }; }
    async decodeAudioData(bytes) { if (deferred) return new Promise((resolve) => { deferredResolve = () => resolve({ key: bytes.key }); }); return { key: bytes.key }; }
    async resume() { this.state = "running"; }
  }
  globalThis.AudioContext = FakeContext;
  globalThis.window = { AudioContext: FakeContext };
  try {
    const audio = await import(`../dist/card-audio.js?test=${Date.now()}`);
    assert.equal(audio.isCardAudioEnabled(), true);
    audio.playUiClick(); await new Promise((resolve) => setTimeout(resolve, 0));
    audio.playThemeSelectSound(); await new Promise((resolve) => setTimeout(resolve, 0));
    audio.playCompletionSound("fireworks"); await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(starts.map((buffer) => buffer.key), ["mingle-card-click.mp3", "mingle-theme-select.mp3", "mingle-celebration-fireworks.mp3"]);
    const requestCount = requests.length;
    const startCount = starts.length;
    audio.stopCardAudio();
    assert.ok(stops.length >= 1);
    audio.toggleCardAudio();
    assert.equal(audio.isCardAudioEnabled(), false);
    assert.equal(storage.get("mingle.cardAudio.enabled"), "0");
    audio.playCompletionSound("confetti");
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(starts.length, startCount);
    assert.ok(requests.length >= requestCount);
    audio.toggleCardAudio();
    deferred = true;
    audio.playCompletionSound("cards");
    await new Promise((resolve) => setTimeout(resolve, 0));
    audio.stopCardAudio();
    deferredResolve?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(starts.length, startCount);
    storage.set("mingle.cardAudio.enabled", "0");
    const disabled = await import(`../dist/card-audio.js?disabled=${Date.now()}`);
    assert.equal(disabled.isCardAudioEnabled(), false);
  } finally {
    restore("localStorage", original.localStorage);
    restore("fetch", original.fetch);
    restore("window", original.window);
    restore("AudioContext", original.AudioContext);
  }
});

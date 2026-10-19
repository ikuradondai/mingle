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
    assert.deepEqual([...new Set(requests)].sort(), [
      "mingle-card-click.mp3",
      "mingle-home-theme-fanfare-v1.mp3",
      "mingle-theme-select.mp3",
    ].sort(), "only first-navigation sounds are warmed before interaction");
    const beforePlayWarmup = requests.length;
    audio.warmCardAudio(["flip", "reaction-same", "reaction-surprise", "flip"]);
    assert.equal(requests.length, beforePlayWarmup + 3, "play warmup deduplicates short sounds");
    audio.playUiClick(); await new Promise((resolve) => setTimeout(resolve, 0));
    audio.playThemeSelectSound(); await new Promise((resolve) => setTimeout(resolve, 0));
    audio.playHomeThemeFanfare(); await new Promise((resolve) => setTimeout(resolve, 0));
    audio.playCompletionSound("fireworks"); await new Promise((resolve) => setTimeout(resolve, 0));
    audio.playInteractionSound("feedback-group", { tone: "bright", participantCount: 2 }); await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(starts.map((buffer) => buffer.key), ["mingle-card-click.mp3", "mingle-theme-select.mp3", "mingle-home-theme-fanfare-v1.mp3", "mingle-celebration-fireworks.mp3", "feedback-group-applause.mp3"]);
    const interactionRequestCount = requests.length;
    audio.playInteractionSound("unknown-feedback-key", { tone: "bright", participantCount: 2 });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(requests.length, interactionRequestCount, "unknown interaction variants are silent");
    audio.warmCardAudio(["feedback-group"]);
    assert.equal(requests.length, interactionRequestCount, "repeated canonical key shares one byte cache");
    audio.playInteractionSound("feedback-calm", { tone: "calm", participantCount: 1 }); await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(starts.at(-1).key, "feedback-calm-air.mp3", "calm interaction resolves to the quiet asset");
    const requestCount = requests.length;
    const startCount = starts.length;
    audio.stopCardAudio();
    assert.ok(stops.length >= 1);
    audio.toggleCardAudio();
    assert.equal(audio.isCardAudioEnabled(), false);
    assert.equal(storage.get("mingle.cardAudio.enabled"), "0");
    audio.playCompletionSound("confetti");
    audio.playHomeThemeFanfare();
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
    const disabledRequests = requests.length;
    disabled.warmCardAudio(["celebration-confetti", "celebration-fireworks"]);
    assert.equal(requests.length, disabledRequests, "disabled audio does not warm sounds");
  } finally {
    restore("localStorage", original.localStorage);
    restore("fetch", original.fetch);
    restore("window", original.window);
    restore("AudioContext", original.AudioContext);
  }
});

test("reaction decode cancellation suppresses only the cancelled pending sound", async () => {
  const storage = new Map();
  const starts = [];
  const pending = [];
  globalThis.localStorage = { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) };
  globalThis.fetch = async (url) => {
    const key = String(url).split('/').pop().split('?')[0];
    return { ok: true, arrayBuffer: async () => ({ key, slice() { return this; } }) };
  };
  class FakeContext {
    constructor() { this.state = "running"; this.destination = {}; }
    createBufferSource() {
      const source = { buffer: null, connect: () => source, start: () => starts.push(source.buffer.key), stop() {}, disconnect() {} };
      return source;
    }
    createGain() { return { gain: { value: 0 }, connect: (target) => target, disconnect() {} }; }
    async decodeAudioData(bytes) {
      return new Promise((resolve) => pending.push(() => resolve({ key: bytes.key })));
    }
    async resume() { this.state = "running"; }
  }
  globalThis.AudioContext = FakeContext;
  globalThis.window = { AudioContext: FakeContext };
  try {
    const audio = await import(`../dist/card-audio.js?reaction=${Date.now()}`);
    audio.playReactionSound("same");
    await new Promise((resolve) => setTimeout(resolve, 0));
    audio.stopReactionSound();
    pending.splice(0).forEach((resolve) => resolve());
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(starts, [], "cancelled pending reaction must not start");

    audio.playReactionSound("surprise");
    await new Promise((resolve) => setTimeout(resolve, 0));
    pending.splice(0).forEach((resolve) => resolve());
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(starts, ["mingle-card-reaction-surprise.mp3"], "new reaction starts after cancellation");

    audio.playUiClick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    audio.stopReactionSound();
    pending.splice(0).forEach((resolve) => resolve());
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(starts, ["mingle-card-reaction-surprise.mp3", "mingle-card-click.mp3"], "reaction stop does not cancel pending generic click");

    audio.toggleCardAudio();
    audio.playReactionSound("same");
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(starts, ["mingle-card-reaction-surprise.mp3", "mingle-card-click.mp3"], "disabled audio stays silent");
  } finally {
    restore("localStorage", original.localStorage);
    restore("fetch", original.fetch);
    restore("window", original.window);
    restore("AudioContext", original.AudioContext);
  }
});

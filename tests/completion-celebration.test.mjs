import test from "node:test";
import assert from "node:assert/strict";
import { celebrationVariants, chooseCelebrationVariant } from "../dist/completion-celebration.js";
import { startCompletionCelebration } from "../dist/completion-celebration.js";

function fakeDom({ transformThrows = false, contextThrows = false } = {}) {
  const listeners = new Map();
  const timers = new Set();
  const rafs = new Set();
  let nextId = 1;
  const context = {
    setTransform() { if (transformThrows) throw new Error("transform failed"); },
    clearRect() {}, save() {}, restore() {}, translate() {}, rotate() {}, fillRect() {},
    beginPath() {}, fill() {}, stroke() {}, arc() {}, moveTo() {}, lineTo() {},
    bezierCurveTo() {}, closePath() {}, roundRect() {}, quadraticCurveTo() {},
  };
  const canvas = { style: {}, width: 0, height: 0, getContext: () => { if (contextThrows) throw new Error("context failed"); return context; } };
  const close = { focus() {}, addEventListener(type, fn) { this.listener = fn; } };
  const overlay = {
    dataset: {}, style: {}, inert: false, removed: false,
    setAttribute() {},
    set innerHTML(value) { this.html = value; },
    querySelector(selector) { return selector === "canvas" ? canvas : close; },
    remove() { this.removed = true; body.children = body.children.filter((child) => child !== this); },
  };
  const body = { children: [{ inert: false }] , appendChild(child) { this.children.push(child); } };
  const documentRef = {
    body,
    createElement() { return overlay; },
    querySelector(selector) { return selector === "[data-completion-celebration]" ? body.children.find((child) => child.dataset?.completionCelebration === "true") || null : null; },
  };
  const windowRef = {
    innerWidth: 390, innerHeight: 844, devicePixelRatio: 1,
    matchMedia: () => ({ matches: false }),
    addEventListener(type, fn) { listeners.set(type, fn); },
    removeEventListener(type, fn) { if (listeners.get(type) === fn) listeners.delete(type); },
    requestAnimationFrame(fn) { const id = nextId++; rafs.add(id); return id; },
    cancelAnimationFrame(id) { rafs.delete(id); },
    setTimeout(fn) { const id = nextId++; timers.add(id); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  return { documentRef, windowRef, overlay, body, listeners, timers, rafs };
}

test("celebration variants cover four distinct patterns", () => {
  assert.deepEqual(celebrationVariants, ["confetti", "fireworks", "ribbons", "cards"]);
  const values = [0, 0.25, 0.5, 0.75];
  const picked = values.map((value) => celebrationVariants[chooseCelebrationVariant(() => value)]);
  assert.equal(new Set(picked).size, 4);
});

test("celebration selection avoids repeating the previous pattern", () => {
  const first = chooseCelebrationVariant(() => 0.5);
  const second = chooseCelebrationVariant(() => 0.5);
  assert.notEqual(second, first);
});

test("asset setup failure keeps the static return affordance and delay", () => {
  const fake = fakeDom({ transformThrows: true });
  let completed = 0;
  const celebration = startCompletionCelebration({ ...fake, onComplete: () => { completed += 1; } });
  assert.equal(fake.overlay.removed, false);
  assert.equal(fake.body.children.some((child) => child.inert), true);
  assert.equal(fake.timers.size, 3);
  assert.equal(fake.rafs.size, 0);
  celebration.stop();
  assert.equal(completed, 0);
  assert.equal(fake.timers.size, 0);
});

test("re-entry stops the previous instance before starting the next", () => {
  const fake = fakeDom();
  let firstCompleted = 0;
  const first = startCompletionCelebration({ ...fake, duration: 10000, onComplete: () => { firstCompleted += 1; } });
  assert.equal(fake.timers.size, 3);
  assert.equal(fake.rafs.size, 0);
  const second = startCompletionCelebration({ ...fake, duration: 10000 });
  assert.equal(firstCompleted, 0);
  assert.equal(fake.timers.size, 3);
  assert.equal(fake.rafs.size, 0);
  second.stop();
  assert.equal(fake.timers.size, 0);
  assert.equal(fake.rafs.size, 0);
  first.stop();
});

test("missing asset events keep the static return affordance and delay", () => {
  const fake = fakeDom({ contextThrows: true });
  let completed = 0;
  const celebration = startCompletionCelebration({ ...fake, onComplete: () => { completed += 1; } });
  assert.equal(fake.overlay.removed, false);
  assert.equal(fake.timers.size, 3);
  celebration.stop();
  assert.equal(completed, 0);
  assert.equal(fake.timers.size, 0);
});

test("completion uses a generated layered art asset while preserving the return control", () => {
  const fake = fakeDom();
  const celebration = startCompletionCelebration({ ...fake, random: () => 0, duration: 3000 });
  assert.match(fake.overlay.html, /completion-celebration-art/);
  assert.match(fake.overlay.html, /\/assets\/completion\/(?:confetti|fireworks|ribbons|cards)-v1\.webp/);
  assert.match(fake.overlay.html, /\/assets\/completion\/sprites\/foil-hero\.webp/);
  assert.match(fake.overlay.html, /data-completion-celebration-close/);
  assert.ok((fake.overlay.html.match(/data-sprite-index=/g) || []).length >= 6);
  assert.match(fake.overlay.html, /--duration:3000ms/);
  celebration.stop();
});

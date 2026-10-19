import test from 'node:test';
import assert from 'node:assert/strict';
import { playInteractionBurst, __resetInteractionEffectsForTest } from '../dist/interaction-effects.js';

function installDom({ reduced = false } = {}) {
  const calls = { append: 0, raf: [], cancel: 0, clear: 0, draw: 0, fill: 0, stroke: 0, resize: 0, removed: 0 };
  const context = {
    setTransform() {}, clearRect() { calls.clear += 1; }, save() {}, restore() {},
    translate() {}, rotate() {}, beginPath() {}, closePath() {}, moveTo() {}, lineTo() {},
    bezierCurveTo() {}, quadraticCurveTo() {}, fill() { calls.fill += 1; }, fillRect() { calls.fill += 1; }, stroke() { calls.stroke += 1; },
  };
  const canvas = { isConnected: true, dataset: {}, style: {}, setAttribute() {}, getContext() { return context; }, remove() { this.isConnected = false; calls.removed += 1; } };
  globalThis.innerWidth = 390; globalThis.innerHeight = 844; globalThis.devicePixelRatio = 4;
  globalThis.matchMedia = () => ({ matches: reduced });
  globalThis.requestAnimationFrame = (callback) => { calls.raf.push(callback); return calls.raf.length; };
  globalThis.cancelAnimationFrame = () => { calls.cancel += 1; };
  globalThis.addEventListener = (event) => { if (event === 'resize') calls.resize += 1; };
  globalThis.removeEventListener = (event) => { if (event === 'resize') calls.resize -= 1; };
  globalThis.performance = { now: () => 1000 };
  globalThis.document = { querySelector: () => null, createElement: () => canvas, body: { appendChild() { calls.append += 1; } } };
  return { calls, canvas, context };
}

test('SSR import and call are safe without document', () => {
  const previous = globalThis.document;
  delete globalThis.document;
  assert.equal(playInteractionBurst({ x: 10, y: 10 }), null);
  if (previous) globalThis.document = previous;
});

test('reuses a capped-DPR overlay and returns a cancellation cleanup', () => {
  const { calls, canvas } = installDom();
  try {
    const cancel = playInteractionBurst({ x: 120, y: 200, tone: 'confetti', participantCount: 4, width: 500 });
    const cancelSecond = playInteractionBurst({ x: 150, y: 220, tone: 'heart', participantCount: 2, width: 400 });
    assert.equal(calls.append, 1);
    assert.equal(canvas.width, 780);
    assert.equal(canvas.height, 1688);
    assert.equal(typeof cancel, 'function');
    cancel();
    cancelSecond?.();
    assert.ok(calls.clear > 0);
    assert.equal(calls.removed, 1);
  } finally { __resetInteractionEffectsForTest(); }
});

test('uses elapsed time, cleans up naturally, and resizes active overlay', () => {
  const { calls, canvas } = installDom();
  try {
    playInteractionBurst({ x: 0, y: 0, participantCount: 3, width: 420 });
    assert.equal(calls.resize, 1);
    globalThis.innerWidth = 500; globalThis.innerHeight = 700;
    playInteractionBurst({ x: 10, y: 20, participantCount: 3, width: 420 });
    assert.equal(canvas.width, 1000);
    calls.raf.at(-1)?.(1000);
    calls.raf.at(-1)?.(1016.667);
    calls.raf.at(-1)?.(1800);
    assert.equal(canvas.isConnected, false);
    assert.ok(calls.cancel > 0, 'natural completion should stop the scheduled frame');
  } finally { __resetInteractionEffectsForTest(); }
});

test('reduced motion uses a quiet burst and rapid taps remain bounded', () => {
  const { calls } = installDom({ reduced: true });
  try {
    for (let i = 0; i < 10; i += 1) playInteractionBurst({ x: 195, y: 300, tone: i % 2 ? 'bright' : 'heart', participantCount: 6, width: 500 });
    assert.ok(calls.raf.length <= 2);
    calls.raf.at(-1)?.(1000);
    assert.ok(calls.fill <= 2, 'reduced motion should draw only quiet sparkles');
    calls.raf.at(-1)?.(1200);
    assert.equal(calls.removed, 1, 'reduced motion should clean up quickly');
  } finally { __resetInteractionEffectsForTest(); }
});

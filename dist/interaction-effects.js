// Short, canvas-based feedback for successful interactions. This module has no
// app dependencies so it can be imported by both the browser bundle and SSR.
const TONES = new Set(['bright', 'confetti', 'heart', 'calm']);
const MAX_DPR = 2;
const MAX_PARTICLES = 96;
const MAX_ACTIVE = 4;
const DURATION = 760;
const REDUCED_DURATION = 180;
let overlay = null;
let context = null;
let frame = 0;
let lastFrameTime = 0;
let resizeBound = false;
let burstId = 0;
const bursts = new Map();

const palette = {
  bright: ['#1769e8', '#13a7a0', '#f2b84b', '#ef6b73', '#fff8d5'],
  confetti: ['#1769e8', '#ef6b73', '#f2b84b', '#13a7a0', '#7b61c8'],
  heart: ['#ef6b73', '#e85b80', '#f7a6b8', '#fff2a8', '#1769e8'],
  calm: ['#6d8bb8', '#9db7d9', '#c7d5e8', '#fff8d5'],
};

function random() { return Math.random(); }
function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
function reducedMotion() {
  try { return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true; } catch { return false; }
}
function getViewport() {
  const width = Number(globalThis.innerWidth) || 320;
  const height = Number(globalThis.innerHeight) || 640;
  return { width, height };
}
function ensureOverlay() {
  if (typeof document === 'undefined') return null;
  if (overlay?.isConnected && context) { resize(); return overlay; }
  overlay = document.querySelector('[data-interaction-effects]');
  if (!overlay) {
    overlay = document.createElement('canvas');
    overlay.dataset.interactionEffects = 'true';
    overlay.setAttribute('aria-hidden', 'true');
    overlay.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:90;display:block;';
    document.body?.appendChild(overlay);
  }
  context = overlay.getContext?.('2d') || null;
  if (!context) { overlay.remove?.(); overlay = null; return null; }
  resize();
  if (!resizeBound && globalThis.addEventListener) { globalThis.addEventListener('resize', resize); resizeBound = true; }
  return overlay;
}
function resize() {
  if (!overlay || !context) return;
  const { width, height } = getViewport();
  const dpr = clamp(Number(globalThis.devicePixelRatio) || 1, 1, MAX_DPR);
  overlay.width = Math.round(width * dpr);
  overlay.height = Math.round(height * dpr);
  overlay.style.width = `${width}px`;
  overlay.style.height = `${height}px`;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
}
function heartPath(ctx, size) {
  ctx.beginPath();
  ctx.moveTo(0, size * 0.3);
  ctx.bezierCurveTo(-size * 0.8, -size * 0.15, -size * 0.55, -size * 0.7, 0, -size * 0.25);
  ctx.bezierCurveTo(size * 0.55, -size * 0.7, size * 0.8, -size * 0.15, 0, size * 0.3);
  ctx.closePath();
}
function drawParticle(particle) {
  if (!context) return;
  const { x, y, size, rotation, alpha, kind, color } = particle;
  context.save();
  context.globalAlpha = alpha;
  context.translate(x, y);
  context.rotate(rotation);
  context.fillStyle = color;
  context.strokeStyle = color;
  context.lineWidth = Math.max(1, size * 0.12);
  if (kind === 'heart') {
    heartPath(context, size);
    context.fill();
  } else if (kind === 'spark') {
    context.beginPath();
    context.moveTo(0, -size); context.lineTo(size * 0.22, -size * 0.22);
    context.lineTo(size, 0); context.lineTo(size * 0.22, size * 0.22);
    context.lineTo(0, size); context.lineTo(-size * 0.22, size * 0.22);
    context.lineTo(-size, 0); context.lineTo(-size * 0.22, -size * 0.22);
    context.closePath(); context.fill();
  } else if (kind === 'ribbon') {
    context.beginPath(); context.moveTo(-size, -size * 0.45); context.quadraticCurveTo(0, size * 0.8, size, size * 0.25); context.stroke();
  } else {
    context.fillRect(-size * 0.65, -size * 0.35, size * 1.3, size * 0.7);
  }
  context.restore();
}
function particleKinds(tone) {
  if (tone === 'heart') return ['heart', 'heart', 'spark', 'ribbon'];
  if (tone === 'confetti') return ['confetti', 'confetti', 'ribbon', 'spark'];
  if (tone === 'calm') return ['spark', 'spark', 'ribbon'];
  return ['spark', 'spark', 'confetti', 'heart', 'ribbon'];
}
function createParticles({ x, y, tone, participantCount, width, quiet }) {
  const baseCount = tone === 'calm' ? (participantCount >= 2 ? 24 : 16) : participantCount >= 2 ? 52 : 30;
  const count = quiet ? 1 : clamp(Math.round(baseCount * clamp(width / 300, .75, 1.5)), tone === 'calm' ? 10 : 18, MAX_PARTICLES);
  const colors = palette[tone];
  const kinds = particleKinds(tone);
  const spread = quiet ? Math.min(70, width * .2) : clamp(width * (participantCount >= 2 ? 0.55 : 0.4), 100, 260);
  return Array.from({ length: count }, (_, index) => {
    const angle = -Math.PI / 2 + (random() - .5) * (participantCount >= 2 ? 1.45 : 1.05);
    const speed = quiet ? 0 : 2.8 + random() * (participantCount >= 2 ? 5.8 : 4.2);
    const kind = kinds[index % kinds.length];
    return { x: x + (random() - .5) * 16, y: y + (random() - .5) * 12, vx: Math.cos(angle) * speed * (random() > .56 ? 1.18 : .82), vy: Math.sin(angle) * speed, gravity: quiet ? 0 : .035 + random() * .045, drag: .985 + random() * .01, sway: (random() - .5) * .08, size: quiet ? 8 : 4 + random() * (participantCount >= 2 ? 10 : 7), rotation: random() * Math.PI, spin: (random() - .5) * .18, alpha: .9, age: random() * 35, life: quiet ? REDUCED_DURATION : DURATION, color: colors[Math.floor(random() * colors.length)], kind, spread };
  });
}
function draw(now) {
  if (!context || !overlay) return;
  const { width, height } = getViewport();
  const delta = lastFrameTime ? clamp((now - lastFrameTime) / 16.667, 0, 3) : 1;
  lastFrameTime = now;
  context.clearRect(0, 0, width, height);
  let active = false;
  for (const [id, burst] of bursts) {
    const elapsed = now - burst.started;
    const progress = elapsed / burst.duration;
    if (progress >= 1) { bursts.delete(id); continue; }
    active = true;
    for (const particle of burst.particles) {
      particle.age += delta;
      particle.x += particle.vx * delta;
      particle.y += particle.vy * delta;
      particle.vx = particle.vx * Math.pow(particle.drag, delta) + Math.sin(particle.age * particle.sway) * .025 * delta;
      particle.vy += particle.gravity * delta;
      particle.rotation += particle.spin * delta;
      const fade = progress < .68 ? 1 : 1 - (progress - .68) / .32;
      particle.alpha = Math.max(0, fade * (particle.kind === 'spark' ? .88 : .78));
      if (particle.x < -particle.spread || particle.x > width + particle.spread || particle.y > height + 40) continue;
      drawParticle(particle);
    }
  }
  if (active) frame = globalThis.requestAnimationFrame?.(draw) || 0;
  else cleanupOverlay(width, height);
}
function scheduleDraw() { if (!frame) frame = globalThis.requestAnimationFrame?.(draw) || 0; }
function cleanupOverlay(width = getViewport().width, height = getViewport().height) {
  if (frame && globalThis.cancelAnimationFrame) globalThis.cancelAnimationFrame(frame);
  frame = 0; lastFrameTime = 0;
  context?.clearRect(0, 0, width, height);
  if (resizeBound && globalThis.removeEventListener) { globalThis.removeEventListener('resize', resize); resizeBound = false; }
  overlay?.remove?.(); overlay = null; context = null;
}

export function playInteractionBurst({ x, y, tone = 'bright', participantCount = 1, width = 200 } = {}) {
  const canvas = ensureOverlay();
  if (!canvas || !context) return null;
  const { width: viewportWidth, height: viewportHeight } = getViewport();
  const quiet = reducedMotion();
  const safeTone = TONES.has(tone) ? tone : 'bright';
  const safeCount = Number.isFinite(participantCount) ? participantCount : 1;
  const safeWidth = Number.isFinite(width) ? clamp(width, 120, 500) : 200;
  const id = ++burstId;
  while (bursts.size >= (quiet ? 2 : MAX_ACTIVE)) bursts.delete(bursts.keys().next().value);
  const origin = { x: clamp(Number.isFinite(Number(x)) ? Number(x) : viewportWidth / 2, 0, viewportWidth), y: clamp(Number.isFinite(Number(y)) ? Number(y) : viewportHeight / 2, 0, viewportHeight) };
  const burst = { started: globalThis.performance?.now?.() || Date.now(), duration: quiet ? REDUCED_DURATION : DURATION, particles: createParticles({ ...origin, tone: safeTone, participantCount: safeCount, width: safeWidth, quiet }) };
  bursts.set(id, burst);
  scheduleDraw();
  return () => { bursts.delete(id); if (!bursts.size) cleanupOverlay(viewportWidth, viewportHeight); };
}

export function __resetInteractionEffectsForTest() {
  bursts.clear();
  cleanupOverlay();
}

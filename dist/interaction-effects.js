// Short, canvas-based feedback for successful interactions. This module has no
// app dependencies so it can be imported by both the browser bundle and SSR.
const TONES = new Set(['bright', 'confetti', 'heart', 'calm']);
const VARIANT_IDS = new Set(['card-fan', 'page-sweep', 'ribbon-relay', 'confetti-cannon', 'star-comet', 'heart-bloom', 'heart-orbit', 'soft-ripple', 'crossfan', 'fountain', 'swoosh', 'ribbon', 'bloom']);
const DEFAULT_VARIANT = { bright: 'card-fan', confetti: 'confetti-cannon', heart: 'heart-bloom', calm: 'soft-ripple' };
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
function easeOut(t) { const n = clamp(t, 0, 1); return 1 - (1 - n) ** 3; }
function normalizeVariant(tone, variant) { return VARIANT_IDS.has(variant) ? variant : DEFAULT_VARIANT[tone]; }
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
  context.fillStyle = particle.hero?.type === 'card' ? (particle.hero.index % 2 ? '#fffdf2' : '#fff8d5') : color;
  context.strokeStyle = color;
  context.lineWidth = Math.max(1, size * 0.12);
  if (kind === 'heart') {
    heartPath(context, size);
    context.fill();
  } else if (kind === 'spark') {
    if (particle.hero?.type === 'comet') {
      context.globalAlpha *= .45;
      context.lineWidth = Math.max(1, size * .18);
      context.beginPath(); context.moveTo(-size * 4.6, 0); context.lineTo(-size * .7, 0); context.stroke();
      context.globalAlpha /= .45;
    }
    context.beginPath();
    context.moveTo(0, -size); context.lineTo(size * 0.22, -size * 0.22);
    context.lineTo(size, 0); context.lineTo(size * 0.22, size * 0.22);
    context.lineTo(0, size); context.lineTo(-size * 0.22, size * 0.22);
    context.lineTo(-size, 0); context.lineTo(-size * 0.22, -size * 0.22);
    context.closePath(); context.fill();
  } else if (kind === 'ribbon') {
    context.beginPath(); context.moveTo(-size * 2.2, -size * 0.3); context.bezierCurveTo(-size, size * .85, size, -size * .85, size * 2.2, size * .25); context.stroke();
  } else if (kind === 'paper') {
    const cardWidth = particle.hero?.type === 'card' ? size * .72 : size * 1.44;
    const cardHeight = particle.hero?.type === 'card' ? size * 1.28 : size * .96;
    if (context.roundRect) { context.beginPath(); context.roundRect(-cardWidth / 2, -cardHeight / 2, cardWidth, cardHeight, Math.max(2, size * .12)); context.fill(); }
    else context.fillRect(-cardWidth / 2, -cardHeight / 2, cardWidth, cardHeight);
    context.strokeStyle = particle.hero?.type === 'card' ? '#244b88' : '#fff8d5'; context.lineWidth = Math.max(1, size * .08);
    context.beginPath(); context.moveTo(-cardWidth * .25, -cardHeight * .12); context.lineTo(cardWidth * .25, -cardHeight * .12); context.stroke();
    if (particle.hero?.type === 'card') { context.strokeStyle = '#6a8fc7'; context.lineWidth = Math.max(1, size * .055); context.beginPath(); context.arc(0, cardHeight * .17, size * .11, 0, Math.PI * 2); context.stroke(); }
  } else if (kind === 'ripple') {
    const radius = particle.radius || size * .72;
    context.beginPath(); context.arc(0, 0, radius, 0, Math.PI * 2); context.stroke();
    if (particle.hero) { context.globalAlpha *= .68; context.beginPath(); context.arc(0, 0, radius * .72, 0, Math.PI * 2); context.stroke(); }
  } else if (kind === 'hero-ribbon') {
    context.lineWidth = Math.max(2, size * .14);
    context.beginPath();
    context.moveTo(particle.tailX ?? -size * 4, particle.tailY ?? size);
    context.quadraticCurveTo((particle.tailX ?? -size * 4) * .45, -size * 2, 0, 0);
    context.stroke();
  } else {
    context.fillRect(-size * 0.65, -size * 0.35, size * 1.3, size * 0.7);
  }
  context.restore();
}
function particleKinds(tone, variant) {
  const hearts = tone === 'heart';
  if (variant === 'card-fan') return ['spark', 'ribbon', 'spark', 'ribbon'];
  if (variant === 'page-sweep') return ['spark', 'ribbon', 'spark', 'ribbon'];
  if (variant === 'ribbon-relay') return ['spark', 'spark', 'ribbon', 'spark'];
  if (variant === 'confetti-cannon') return ['paper', 'spark', 'paper', 'ribbon'];
  if (variant === 'star-comet') return ['spark', 'spark', 'ribbon', 'spark'];
  if (variant === 'heart-bloom') return hearts ? ['heart', 'heart', 'heart', 'spark'] : ['spark', 'spark', 'paper', 'ribbon'];
  if (variant === 'heart-orbit') return hearts ? ['heart', 'heart', 'spark', 'heart'] : ['spark', 'ribbon', 'spark', 'paper'];
  if (variant === 'soft-ripple') return ['spark', 'spark', 'spark', 'spark'];
  if (variant === 'fountain') return hearts ? ['heart', 'heart', 'spark', 'spark'] : ['spark', 'paper', 'spark', 'ribbon'];
  if (variant === 'swoosh' || variant === 'ribbon') return hearts ? ['heart', 'ribbon', 'spark', 'heart'] : ['ribbon', 'ribbon', 'spark', 'paper'];
  if (variant === 'bloom') return hearts ? ['heart', 'heart', 'heart', 'spark'] : ['spark', 'spark', 'ribbon'];
  if (hearts) return ['heart', 'heart', 'spark', 'ribbon'];
  if (tone === 'confetti') return ['confetti', 'confetti', 'ribbon', 'spark'];
  if (tone === 'calm') return ['spark', 'spark', 'ribbon'];
  return ['spark', 'spark', 'confetti', 'ribbon'];
}
function createParticles({ x, y, tone, participantCount, width, variant, quiet }) {
  const heroLightCount = { 'card-fan': 16, 'page-sweep': 14, 'ribbon-relay': 14, 'star-comet': 10, 'heart-bloom': 16, 'heart-orbit': 16, 'soft-ripple': 7 }[variant];
  const baseCount = heroLightCount || (tone === 'calm' ? (participantCount >= 2 ? 24 : 16) : participantCount >= 2 ? 52 : 30);
  const heroCount = quiet ? 0 : ({ 'card-fan': 6, 'page-sweep': 2, 'ribbon-relay': 3, 'star-comet': 3, 'heart-bloom': 5, 'heart-orbit': 6, 'soft-ripple': 3 }[variant] || 0);
  const countFloor = heroLightCount ? heroCount + 6 : tone === 'calm' ? 10 : 18;
  const count = quiet ? 1 : variant === 'soft-ripple' ? 7 : clamp(Math.round(baseCount * clamp(width / 300, .75, 1.5)), countFloor, MAX_PARTICLES);
  const colors = palette[tone];
  const kinds = particleKinds(tone, variant);
  const spread = quiet ? Math.min(70, width * .2) : clamp(width * (participantCount >= 2 ? 0.55 : 0.4), 100, 260);
  return Array.from({ length: count }, (_, index) => {
    const side = index % 2 === 0 ? -1 : 1;
    const angle = variant === 'heart-bloom' || variant === 'bloom'
      ? random() * Math.PI * 2
      : variant === 'heart-orbit'
        ? (side < 0 ? Math.PI * .66 : Math.PI * .34) + (random() - .5) * .25
        : variant === 'ribbon-relay' || variant === 'swoosh' || variant === 'ribbon'
        ? (side < 0 ? Math.PI * .92 : Math.PI * .08) + (random() - .5) * .48
        : variant === 'page-sweep'
          ? (random() - .5) * .22
          : variant === 'star-comet'
            ? (side < 0 ? -Math.PI * .72 : -Math.PI * .28) + (random() - .5) * .2
            : variant === 'card-fan' || variant === 'crossfan'
          ? (side < 0 ? -.2 : Math.PI + .2) + (random() - .5) * .9
          : variant === 'soft-ripple'
            ? random() * Math.PI * 2
          : -Math.PI / 2 + (random() - .5) * (participantCount >= 2 ? 1.45 : 1.05);
    const speed = quiet ? 0 : variant === 'soft-ripple' ? 2.6 + random() * 2.4 : variant === 'heart-bloom' || variant === 'bloom' ? 2.5 + random() * 5.4 : variant === 'heart-orbit' ? 3.2 + random() * 3.5 : 2.8 + random() * (participantCount >= 2 ? 5.8 : 4.2);
    const originX = variant === 'confetti-cannon' ? x + side * width * (.25 + random() * .08) : ['crossfan', 'card-fan', 'ribbon-relay'].includes(variant) ? x + side * (8 + random() * 14) : x + (random() - .5) * 16;
    const originY = variant === 'fountain' || variant === 'confetti-cannon' ? y + 4 + random() * 8 : y + (random() - .5) * 12;
    const isHero = index < heroCount;
    let kind = kinds[index % kinds.length];
    if (isHero && variant === 'card-fan') kind = 'paper';
    if (isHero && variant === 'page-sweep') kind = 'paper';
    if (isHero && variant === 'ribbon-relay') kind = 'hero-ribbon';
    if (isHero && variant === 'star-comet') kind = 'spark';
    if (isHero && (variant === 'heart-bloom' || variant === 'heart-orbit')) kind = 'heart';
    if (isHero && variant === 'soft-ripple') kind = 'ripple';
    const gravity = quiet ? 0 : variant === 'fountain' || variant === 'confetti-cannon' ? .09 + random() * .07 : variant === 'heart-bloom' || variant === 'heart-orbit' || variant === 'bloom' || variant === 'soft-ripple' ? .018 + random() * .028 : .035 + random() * .045;
    const delay = variant === 'confetti-cannon' ? (index % 2) * 100 : variant === 'heart-bloom' ? (index % 5) * 22 + random() * 18 : 0;
    const secondarySize = 3 + random() * 4;
    const heroScale = participantCount >= 2 && tone !== 'calm' ? 1 : .76;
    const size = quiet ? 8 : variant === 'confetti-cannon' ? 7 + random() * 5 : !isHero ? secondarySize
      : variant === 'card-fan' ? heroScale * (32 + random() * 12)
        : variant === 'page-sweep' ? heroScale * (30 + random() * 10)
          : variant === 'confetti-cannon' ? 9 + random() * 8
            : variant === 'ribbon-relay' ? heroScale * (14 + random() * 10)
              : variant === 'star-comet' ? heroScale * (index === 0 ? 24 : 14 + random() * 4)
                : variant === 'heart-bloom' || variant === 'heart-orbit' ? heroScale * (16 + random() * 12)
                  : variant === 'soft-ripple' ? heroScale * (18 + random() * 8)
                    : secondarySize;
    const hero = isHero ? { type: variant === 'card-fan' ? 'card' : variant === 'page-sweep' ? 'page' : variant === 'ribbon-relay' ? 'relay' : variant === 'star-comet' ? 'comet' : variant === 'heart-bloom' ? 'bloom' : variant === 'heart-orbit' ? 'orbit' : variant === 'soft-ripple' ? 'ripple' : null, index, count: heroCount } : null;
    if (hero) {
      hero.startX = x; hero.startY = y; hero.baseX = x; hero.baseY = y; hero.side = index % 2 ? 1 : -1; hero.scale = heroScale;
      hero.angle = variant === 'card-fan' ? -.92 + index * .36 : 0;
      hero.radius = variant === 'card-fan' ? (98 + (index % 3) * 18) * heroScale : 0;
      hero.endX = variant === 'page-sweep' ? (170 + index * 34) * heroScale : 0;
      hero.endY = variant === 'page-sweep' ? (-40 - index * 36) * heroScale : 0;
      hero.delay = delay;
      if (variant === 'heart-bloom') { hero.endX = (index - 2) * 34 * heroScale; hero.endY = (-118 - (index % 3) * 24) * heroScale; }
      if (variant === 'heart-orbit') { hero.startX = x + hero.side * (130 + (index % 3) * 32) * heroScale; hero.startY = y - 50 * heroScale + (index % 2) * 18 * heroScale; hero.endX = (index - 2.5) * 16 * heroScale; hero.endY = (-260 - (index % 2) * 28) * heroScale; hero.controlX = hero.side * 150 * heroScale; hero.controlY = (-300 - (index % 3) * 15) * heroScale; }
      if (variant === 'star-comet') { hero.startX = x + (index - 1) * 12 * heroScale; hero.startY = y + (index % 2) * 10 * heroScale; hero.endX = (index === 0 ? 120 : (index === 1 ? -82 : 78)) * heroScale; hero.endY = (-150 - index * 20) * heroScale; }
      if (variant === 'soft-ripple') hero.radius = (25 + index * 22) * heroScale;
    }
    return { x: originX, y: originY, baseX: x, baseY: y, vx: Math.cos(angle) * speed * (random() > .56 ? 1.18 : .82), vy: Math.sin(angle) * speed, gravity, drag: .985 + random() * .01, sway: variant === 'heart-orbit' || variant === 'ribbon-relay' || variant === 'swoosh' || variant === 'ribbon' ? (random() > .5 ? 1 : -1) * (.12 + random() * .13) : (random() - .5) * .08, size, rotation: random() * Math.PI, spin: (random() - .5) * .18, alpha: .9, age: random() * 35, delay, life: quiet ? REDUCED_DURATION : DURATION, color: colors[Math.floor(random() * colors.length)], kind, spread, variant, hero };
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
      if (elapsed < particle.delay) continue;
      if (particle.hero) {
        const local = easeOut((elapsed - particle.delay) / (burst.duration * .78));
        const h = particle.hero;
        if (h.type === 'card') {
          particle.x = h.startX + Math.sin(h.angle) * h.radius * local;
          particle.y = h.startY - Math.cos(h.angle) * h.radius * local;
          particle.rotation = h.angle * .72 + (local * (h.index % 2 ? .16 : -.12));
        } else if (h.type === 'page') {
          particle.x = h.startX + h.endX * local;
          particle.y = h.startY + h.endY * local;
          particle.rotation = (h.index ? -.18 : .14) + local * (h.index ? -.18 : .22);
        } else if (h.type === 'relay') {
          const direction = h.side;
          particle.x = h.startX + direction * (160 + h.index * 38) * local;
          particle.y = h.startY - (62 + h.index * 24) * local;
          particle.tailX = -direction * 150;
          particle.tailY = 38;
          particle.rotation = direction * .12;
        } else if (h.type === 'comet') {
          particle.x = h.startX + h.endX * local;
          particle.y = h.startY + h.endY * local;
          particle.rotation = Math.atan2(h.endY, h.endX);
        } else if (h.type === 'bloom') {
          particle.x = h.startX + h.endX * local;
          particle.y = h.startY + h.endY * local;
          particle.rotation = (h.index - 2) * .14;
        } else if (h.type === 'orbit') {
          const t = local;
          const startX = h.startX; const startY = h.startY;
          particle.x = ((1 - t) ** 2) * startX + 2 * (1 - t) * t * (h.startX + h.controlX) + (t ** 2) * (h.baseX + h.endX);
          particle.y = ((1 - t) ** 2) * startY + 2 * (1 - t) * t * (h.startY + h.controlY) + (t ** 2) * (h.baseY + h.endY);
          particle.rotation = h.side * .2;
        } else if (h.type === 'ripple') {
          particle.x = h.startX; particle.y = h.startY; particle.radius = h.radius + local * (95 + h.index * 20);
        }
        particle.alpha = Math.max(0, (progress < .68 ? 1 : 1 - (progress - .68) / .32) * .86);
        if (particle.x < -particle.spread || particle.x > width + particle.spread || particle.y > height + 40) continue;
        drawParticle(particle);
        continue;
      }
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

export function playInteractionBurst({ x, y, tone = 'bright', participantCount = 1, width = 200, variant } = {}) {
  const canvas = ensureOverlay();
  if (!canvas || !context) return null;
  const { width: viewportWidth, height: viewportHeight } = getViewport();
  const quiet = reducedMotion();
  const safeTone = TONES.has(tone) ? tone : 'bright';
  const safeVariant = normalizeVariant(safeTone, variant);
  const safeCount = Number.isFinite(participantCount) ? participantCount : 1;
  const safeWidth = Number.isFinite(width) ? clamp(width, 120, 500) : 200;
  const id = ++burstId;
  while (bursts.size >= (quiet ? 2 : MAX_ACTIVE)) bursts.delete(bursts.keys().next().value);
  const origin = { x: clamp(Number.isFinite(Number(x)) ? Number(x) : viewportWidth / 2, 0, viewportWidth), y: clamp(Number.isFinite(Number(y)) ? Number(y) : viewportHeight / 2, 0, viewportHeight) };
  const burst = { started: globalThis.performance?.now?.() || Date.now(), duration: quiet ? REDUCED_DURATION : DURATION, variant: safeVariant, particles: createParticles({ ...origin, tone: safeTone, participantCount: safeCount, width: safeWidth, variant: safeVariant, quiet }) };
  bursts.set(id, burst);
  scheduleDraw();
  return () => { bursts.delete(id); if (!bursts.size) cleanupOverlay(viewportWidth, viewportHeight); };
}

export function __resetInteractionEffectsForTest() {
  bursts.clear();
  cleanupOverlay();
}

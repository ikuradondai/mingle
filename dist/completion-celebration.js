const VARIANTS = Object.freeze(["confetti", "fireworks", "ribbons", "cards"]);
let previousVariant = -1;
let activeCelebrationStop = null;
export const celebrationVariants = VARIANTS;

export function chooseCelebrationVariant(random = Math.random) {
  const value = Math.max(0, Math.min(.999999, Number(random()) || 0));
  let index = Math.floor(value * VARIANTS.length);
  if (index === previousVariant) index = (index + 1) % VARIANTS.length;
  previousVariant = index;
  return index;
}
const palette = ["#1769e8", "#ff6b72", "#ffd160", "#14213d", "#5b8def"];
const pick = (i) => palette[i % palette.length];

function drawConfetti(ctx, items, width, height, dt) {
  for (const p of items) {
    p.x += p.vx * dt; p.y += p.vy * dt; p.vy += .075 * dt; p.rotation += p.spin * dt;
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rotation); ctx.fillStyle = p.color; ctx.fillRect(-p.size / 2, -p.size / 3, p.size, p.size * .66); ctx.restore();
    if (p.y > height + 24) { p.y = height + Math.random() * 90; p.x = p.left ? -20 : width + 20; p.vx = p.left ? 2 + Math.random() * 5 : -2 - Math.random() * 5; p.vy = -8 - Math.random() * 10; }
  }
}
function drawFireworks(ctx, bursts, dt) {
  for (const burst of bursts) {
    burst.age += dt * 16;
    if (burst.age < burst.delay) continue;
    const progress = (burst.age - burst.delay) / burst.life;
    if (progress >= 1) continue;
    ctx.globalAlpha = Math.max(0, 1 - progress);
    for (const spark of burst.sparks) {
      const elapsedFrames = (burst.age - burst.delay) / 16;
      const distance = spark.speed * elapsedFrames * 5;
      const x = burst.x + Math.cos(spark.angle) * distance; const y = burst.y + Math.sin(spark.angle) * distance + elapsedFrames ** 2 * .05;
      ctx.strokeStyle = spark.color; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(burst.x + Math.cos(spark.angle) * distance * .72, burst.y + Math.sin(spark.angle) * distance * .72); ctx.lineTo(x, y); ctx.stroke(); ctx.beginPath(); ctx.fillStyle = spark.color; ctx.arc(x, y, 3.8, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
}
function drawRibbons(ctx, ribbons, height, dt) {
  for (const r of ribbons) {
    r.time += r.speed * dt; r.y += r.fall * dt;
    if (r.y > height + 180) r.y = -180;
    ctx.save(); ctx.translate(r.x + Math.sin(r.time) * 90, r.y); ctx.rotate(Math.sin(r.time * .63) * .4); ctx.strokeStyle = r.color; ctx.lineWidth = r.width; ctx.lineCap = "round"; ctx.beginPath();
    ctx.moveTo(0, 0); ctx.bezierCurveTo(r.length * .35, 30, -r.length * .35, 70, r.length * .15, 110); ctx.bezierCurveTo(r.length * .55, 145, -r.length * .35, 175, r.length * .2, 205); ctx.stroke(); ctx.restore();
  }
}
function drawCards(ctx, cards, width, height, dt) {
  for (const c of cards) {
    c.y += c.vy * dt; c.rotation += c.spin * dt;
    if (c.y > height + 80) { c.y = -80; c.x = Math.random() * width; }
    ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(c.rotation); ctx.beginPath(); ctx.roundRect(-26, -36, 52, 72, 8, 8); ctx.fillStyle = c.face; ctx.fill(); ctx.strokeStyle = c.edge; ctx.lineWidth = 2; ctx.stroke();
    ctx.strokeStyle = c.edge; ctx.fillStyle = c.edge; ctx.lineWidth = 2.5;
    if (c.symbol === 0) { ctx.beginPath(); for (let i = 0; i < 10; i++) { const angle = -Math.PI / 2 + i * Math.PI / 5; const radius = i % 2 ? 7 : 13; const x = Math.cos(angle) * radius; const y = Math.sin(angle) * radius - 8; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); } ctx.closePath(); ctx.fill(); }
    else if (c.symbol === 1) { ctx.beginPath(); ctx.moveTo(0, 14); ctx.bezierCurveTo(-24, -2, -12, -17, 0, -7); ctx.bezierCurveTo(12, -17, 24, -2, 0, 14); ctx.fill(); }
    else { for (const y of [-13, -3, 7]) { ctx.beginPath(); ctx.moveTo(-13, y); ctx.lineTo(13, y); ctx.stroke(); } }
    ctx.restore();
  }
}
function particlesFor(variant, width, height) {
  if (variant === 0) return Array.from({ length: 260 }, (_, i) => { const left = i % 2 === 0; return { left, x: left ? -20 : width + 20, y: height + Math.random() * 90, vx: left ? 2 + Math.random() * 5 : -2 - Math.random() * 5, vy: -8 - Math.random() * 10, size: 6 + Math.random() * 10, rotation: Math.random() * 6, spin: (Math.random() - .5) * .2, color: pick(i) }; });
  if (variant === 1) return Array.from({ length: 8 }, (_, i) => ({ x: width * (.1 + Math.random() * .8), y: height * (.14 + Math.random() * .48), age: 0, delay: i * 210, life: 1100, sparks: Array.from({ length: 56 }, (__, j) => ({ angle: j / 56 * Math.PI * 2, speed: .7 + Math.random() * 1.9, color: pick(j + i) })) }));
  if (variant === 2) return Array.from({ length: 34 }, (_, i) => ({ x: Math.random() * width, y: Math.random() * height, time: Math.random() * 6, speed: .025 + Math.random() * .04, width: 3 + Math.random() * 7, length: 20 + Math.random() * 60, fall: .35 + Math.random() * 1.2, color: pick(i) }));
  return Array.from({ length: 40 }, (_, i) => ({ x: Math.random() * width, y: Math.random() * height, vy: .6 + Math.random() * 2.1, rotation: Math.random() * 6, spin: (Math.random() - .5) * .12, symbol: i % 3, face: i % 3 === 0 ? "#fffaf0" : i % 3 === 1 ? "#ffddd8" : "#dbe8ff", edge: pick(i) }));
}

export function startCompletionCelebration({ documentRef = document, windowRef = window, duration = 2800, returnDelay = 10000, random = Math.random, onComplete = null } = {}) {
  activeCelebrationStop?.();
  documentRef.querySelector("[data-completion-celebration]")?.remove();
  const variant = chooseCelebrationVariant(random); const reduced = Boolean(windowRef.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);
  const overlay = documentRef.createElement("div"); overlay.className = "completion-celebration"; overlay.dataset.completionCelebration = "true"; overlay.dataset.variant = VARIANTS[variant]; overlay.dataset.dark = String(variant === 1); overlay.setAttribute("role", "dialog"); overlay.setAttribute("aria-modal", "true"); overlay.setAttribute("aria-label", "終了のお祝い");
  overlay.innerHTML = `<canvas aria-hidden="true"></canvas><div class="completion-celebration-content"><p class="completion-celebration-kicker">MINGLE.CARDS</p><h2>おつかれさま！</h2><p>また、話そう！</p><p class="completion-celebration-countdown" data-completion-celebration-countdown>10秒後にトップへ戻ります</p><button type="button" class="completion-celebration-close" data-completion-celebration-close>戻る</button></div>`;
  documentRef.body.appendChild(overlay); const background = [...documentRef.body.children].filter((child) => child !== overlay); const inertBefore = background.map((child) => Boolean(child.inert)); background.forEach((child) => { child.inert = true; });
  let canvas; let ctx; let close;
  const restoreFailure = () => { background.forEach((child, index) => { child.inert = inertBefore[index]; }); overlay.remove(); onComplete?.(); (documentRef.querySelector('input[name="participant"]') || documentRef.querySelector("[data-index]") || documentRef.querySelector("[data-focus]"))?.focus({ preventScroll: true }); };
  try { canvas = overlay.querySelector("canvas"); ctx = canvas?.getContext?.("2d"); } catch { canvas = null; ctx = null; }
  try { close = overlay.querySelector("[data-completion-celebration-close]"); } catch { close = null; }
  if (!close) { restoreFailure(); return { variant: VARIANTS[variant], stop: () => {} }; }
  let raf = 0; let timer = 0; let animationTimer = 0; let countdownTimer = 0; let stopped = false; let animationStopped = false; let lastTime = 0; let particles = [];
  const resize = () => { try { if (!canvas || !ctx) return; const ratio = windowRef.devicePixelRatio || 1; canvas.width = Math.max(1, windowRef.innerWidth * ratio); canvas.height = Math.max(1, windowRef.innerHeight * ratio); canvas.style.width = `${windowRef.innerWidth}px`; canvas.style.height = `${windowRef.innerHeight}px`; ctx.setTransform(ratio, 0, 0, ratio, 0, 0); particles = particlesFor(variant, windowRef.innerWidth, windowRef.innerHeight); } catch { finishAnimation(); } };
  const returnFocus = () => documentRef.querySelector('input[name="participant"]') || documentRef.querySelector("[data-index]") || documentRef.querySelector("[data-focus]");
  const finishAnimation = () => { if (animationStopped) return; animationStopped = true; windowRef.cancelAnimationFrame?.(raf); windowRef.clearTimeout(animationTimer); };
  const cleanup = (complete = true) => { if (stopped) return; stopped = true; finishAnimation(); windowRef.clearTimeout(timer); windowRef.clearTimeout(countdownTimer); windowRef.removeEventListener("resize", resize); windowRef.removeEventListener("keydown", onKey); background.forEach((child, index) => { child.inert = inertBefore[index]; }); overlay.remove(); if (activeCelebrationStop === stopActive) activeCelebrationStop = null; if (complete) onComplete?.(); returnFocus()?.focus({ preventScroll: true }); };
  const stopActive = () => cleanup(false);
  const onKey = (event) => { if (event.key === "Escape") { event.preventDefault(); cleanup(); return; } if (event.key === "Tab") { event.preventDefault(); close?.focus({ preventScroll: true }); } };
  const draw = (time) => { if (stopped || animationStopped || !ctx || reduced) return; try { const dt = Math.min(32, lastTime ? time - lastTime : 16) / 16; lastTime = time; ctx.clearRect(0, 0, windowRef.innerWidth, windowRef.innerHeight); if (variant === 0) drawConfetti(ctx, particles, windowRef.innerWidth, windowRef.innerHeight, dt); else if (variant === 1) drawFireworks(ctx, particles, dt); else if (variant === 2) drawRibbons(ctx, particles, windowRef.innerHeight, dt); else drawCards(ctx, particles, windowRef.innerWidth, windowRef.innerHeight, dt); raf = windowRef.requestAnimationFrame(draw); } catch { finishAnimation(); } };
  close?.addEventListener("click", cleanup); windowRef.addEventListener("resize", resize); windowRef.addEventListener("keydown", onKey); resize(); if (stopped) return { variant: VARIANTS[variant], stop: cleanup }; close?.focus({ preventScroll: true });
  const countdown = overlay.querySelector("[data-completion-celebration-countdown]");
  const startedAt = Date.now();
  const updateCountdown = () => { if (stopped || !countdown) return; const remaining = Math.max(0, Math.ceil((returnDelay - (Date.now() - startedAt)) / 1000)); countdown.textContent = remaining > 0 ? `${remaining}秒後にトップへ戻ります` : "まもなくトップへ戻ります"; if (remaining > 0) countdownTimer = windowRef.setTimeout(updateCountdown, 1000); };
  updateCountdown(); timer = windowRef.setTimeout(cleanup, returnDelay); if (!animationStopped) animationTimer = windowRef.setTimeout(finishAnimation, duration); if (!reduced && !animationStopped) raf = windowRef.requestAnimationFrame(draw); else finishAnimation(); activeCelebrationStop = stopActive; return { variant: VARIANTS[variant], stop: stopActive };
}

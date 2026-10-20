const VARIANTS = Object.freeze(["confetti", "fireworks", "ribbons", "cards"]);
const ART_ASSETS = Object.freeze({
  confetti: "/assets/completion/confetti-v1.webp",
  fireworks: "/assets/completion/fireworks-v1.webp",
  ribbons: "/assets/completion/ribbons-v1.webp",
  cards: "/assets/completion/cards-v1.webp",
});
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
const SPRITES = Object.freeze({
  card: "/assets/completion/sprites/card-hero.webp",
  ribbon: "/assets/completion/sprites/ribbon-hero.webp",
  foil: "/assets/completion/sprites/foil-hero.webp",
  star: "/assets/completion/sprites/star-hero.webp",
  firework: "/assets/completion/sprites/firework-hero.webp",
});
const PLANS = Object.freeze({
  confetti: [["star",-30,36,12,-30,0.72,8,0],["foil",33,39,-8,-35,0.9,25,105],["foil",-36,42,4,-40,1.08,-38,210],["star",39,45,0,-45,0.8,-21,315],["foil",-42,36,-4,-50,0.72,-4,420],["foil",30,39,8,-55,0.9,13,525],["star",-33,42,-12,-30,1.08,30,630],["foil",36,45,-12,-35,0.8,-33,735],["foil",-39,36,8,-40,0.72,-16,840],["star",42,39,-4,-45,0.9,1,945],["foil",-30,42,0,-50,1.08,18,1050],["foil",33,45,4,-55,0.8,35,1155],["star",-36,36,-8,-30,0.72,-28,1260],["foil",39,39,12,-35,0.9,-11,1365],["foil",-42,42,12,-40,1.08,6,1470],["star",30,45,-8,-45,0.8,23,1575],["foil",-33,36,4,-50,0.72,-40,1680],["foil",36,39,0,-55,0.9,-23,1785],["star",-39,42,-4,-30,1.08,-6,1890],["foil",42,45,8,-35,0.8,11,1995],["foil",-30,36,-12,-40,0.72,28,2100],["star",33,39,-12,-45,0.9,-35,2205],["foil",-36,42,8,-50,1.08,-18,2310],["foil",39,45,-4,-55,0.8,-1,2415]],
  fireworks: [["firework",-34,-25,0,0,0.92,0,0],["star",-39,-21,9,-5,0.34,-20,180],["firework",31,-21,0,0,0.78,0,520],["star",26,-17,-9,-5,0.34,18,700],["firework",-6,28,0,0,0.68,0,1200],["star",-11,32,9,-5,0.34,-20,1380],["firework",35,25,0,0,0.58,0,2000],["star",30,29,-9,-5,0.34,18,2180],["firework",-34,24,0,0,0.52,0,3000],["star",-39,28,9,-5,0.34,-20,3180]],
  ribbons: [["ribbon",-40,32,70,-58,1.0,-22,0],["ribbon",38,28,-72,-54,0.92,26,500],["ribbon",-36,-30,68,44,0.82,18,1100],["ribbon",34,-34,-70,48,0.76,-28,1750],["foil",-22,34,42,-66,0.72,32,2500],["star",26,-30,-45,54,0.62,-26,3150]],
  cards: [["card",-40,30,-12,-34,0.72,0,0],["card",-30,35,1,-38,0.82,11,78],["card",-20,40,-11,-42,0.92,22,156],["card",-10,45,2,-46,1.02,-23,234],["card",0,30,-10,-50,0.78,-12,312],["card",10,35,3,-54,0.72,-1,390],["card",20,40,-9,-58,0.82,10,468],["card",30,45,4,-62,0.92,21,546],["card",40,30,-8,-34,1.02,-24,624],["card",-40,35,5,-38,0.78,-13,702],["card",-30,40,-7,-42,0.72,-2,780],["card",-20,45,6,-46,0.82,9,858],["card",-10,30,-6,-50,0.92,20,936],["card",0,35,7,-54,1.02,-25,1014],["card",10,40,-5,-58,0.78,-14,1092],["card",20,45,8,-62,0.72,-3,1170],["card",30,30,-4,-34,0.82,8,1248],["card",40,35,9,-38,0.92,19,1326],["card",-40,40,-3,-42,1.02,-26,1404],["card",-30,45,10,-46,0.78,-15,1482],["card",-20,30,-2,-50,0.72,-4,1560],["card",-10,35,11,-54,0.82,7,1638],["card",0,40,-1,-58,0.92,18,1716],["card",10,45,12,-62,1.02,-27,1794],["card",20,30,0,-34,0.78,-16,1872],["card",30,35,-12,-38,0.72,-5,1950],["card",40,40,1,-42,0.82,6,2028],["card",-40,45,-11,-46,0.92,17,2106],["card",-30,30,2,-50,1.02,-28,2184],["card",-20,35,-10,-54,0.78,-17,2262],["card",-10,40,3,-58,0.72,-6,2340],["card",0,45,-9,-62,0.82,5,2418],["card",10,30,4,-34,0.92,16,2496],["card",20,35,-8,-38,1.02,27,2574],["card",30,40,5,-42,0.78,-18,2652],["card",40,45,-7,-46,0.72,-7,2730],["card",-40,30,6,-50,0.82,4,2808],["card",-30,35,-6,-54,0.92,15,2886],["card",-20,40,7,-58,1.02,26,2964],["card",-10,45,-5,-62,0.78,-19,3042],["card",0,30,8,-34,0.72,-8,3120],["card",10,35,-4,-38,0.82,3,3198],["foil",-34,35,10,-30,0.58,-24,3400],["star",-24,35,-11,-33,0.6799999999999999,-15,3530],["foil",-14,35,12,-36,0.78,-6,3660],["star",-4,35,-13,-39,0.58,3,3790],["foil",6,35,14,-42,0.6799999999999999,12,3920],["star",16,35,-15,-45,0.78,21,4050],["foil",26,35,16,-48,0.58,30,4180],["star",36,35,-17,-51,0.6799999999999999,39,4310]],
});
function pieceMarkup(piece, index, duration) {
  const [kind,x,y,dx,dy,scale,rotate,delay] = piece;
  const phaseDelay = Math.min(Math.max(0, duration - 350), delay * duration / 5000);
  return '<img class="completion-celebration-sprite completion-celebration-sprite-' + kind + '" data-sprite-kind="' + kind + '" data-sprite-index="' + index + '" src="' + SPRITES[kind] + '" alt="" decoding="async" style="--sx:' + x + 'vw;--sy:' + y + 'vh;--dx:' + dx + 'vw;--dy:' + dy + 'vh;--scale:' + scale + ';--rotate:' + rotate + 'deg;--delay:' + phaseDelay + 'ms;--duration:' + Math.max(350, duration - phaseDelay) + 'ms;--fx-duration:' + (kind === 'firework' ? Math.min(1600, Math.max(500, duration - phaseDelay)) : Math.max(350, duration - phaseDelay)) + 'ms;--drop:' + Math.max(8, Math.abs(dy) * .6) + 'vh" />';
}
function artMarkup(variant, duration) {
  return '<div class="completion-celebration-art" aria-hidden="true"><img class="completion-celebration-backdrop" src="' + ART_ASSETS[variant] + '" alt="" decoding="async" /><div class="completion-celebration-sprite-layer">' + PLANS[variant].map((piece, index) => pieceMarkup(piece, index, duration)).join("") + '</div></div>';
}
function loaded(image) { return image.complete && image.naturalWidth > 0; }
function waitForImages(images) {
  const pending = images.filter((image) => !loaded(image));
  if (!pending.length) return { promise: Promise.resolve(), cancel() {} };
  let settled = false;
  let remaining = pending.length;
  const cleanups = [];
  let resolvePromise;
  const finish = () => {
    if (settled) return;
    settled = true;
    cleanups.splice(0).forEach((remove) => remove());
    resolvePromise?.();
  };
  const promise = new Promise((resolve) => {
    resolvePromise = resolve;
    pending.forEach((image) => {
      const done = () => {
        if (settled) return;
        remaining -= 1;
        if (remaining <= 0) finish();
      };
      image.addEventListener?.("load", done, { once: true });
      image.addEventListener?.("error", done, { once: true });
      cleanups.push(() => {
        image.removeEventListener?.("load", done);
        image.removeEventListener?.("error", done);
      });
    });
  });
  return { promise, cancel: finish };
}

export function startCompletionCelebration({ documentRef = document, windowRef = window, duration = 5000, returnDelay = 10000, random = Math.random, onComplete = null } = {}) {
  activeCelebrationStop?.();
  documentRef.querySelector("[data-completion-celebration]")?.remove();
  const variant = chooseCelebrationVariant(random); const reduced = Boolean(windowRef.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches);
  const overlay = documentRef.createElement("div"); overlay.className = "completion-celebration"; overlay.dataset.completionCelebration = "true"; overlay.dataset.variant = VARIANTS[variant]; overlay.dataset.dark = String(variant === 1); overlay.setAttribute("role", "dialog"); overlay.setAttribute("aria-modal", "true"); overlay.setAttribute("aria-label", "終了のお祝い");
  overlay.innerHTML = artMarkup(VARIANTS[variant], duration) + '<div class="completion-celebration-content"><p class="completion-celebration-kicker">MINGLE.CARDS</p><h2>おつかれさま！</h2><p>新しい発見はあった？</p><p class="completion-celebration-countdown" data-completion-celebration-countdown>10秒後にトップへ戻ります</p><button type="button" class="completion-celebration-close" data-completion-celebration-close>戻る</button></div>';
  documentRef.body.appendChild(overlay); const background = [...documentRef.body.children].filter((child) => child !== overlay); const inertBefore = background.map((child) => Boolean(child.inert)); background.forEach((child) => { child.inert = true; });
  let close;
  const restoreFailure = () => { background.forEach((child, index) => { child.inert = inertBefore[index]; }); overlay.remove(); onComplete?.(); (documentRef.querySelector('input[name="participant"]') || documentRef.querySelector("[data-index]") || documentRef.querySelector("[data-focus]"))?.focus({ preventScroll: true }); };
  try { close = overlay.querySelector("[data-completion-celebration-close]"); } catch { close = null; }
  if (!close) { restoreFailure(); return { variant: VARIANTS[variant], stop: () => {} }; }
  let timer = 0; let countdownTimer = 0; let readyTimer = 0; let stopped = false; let started = false; let cancelImageWait = () => {};
  const returnFocus = () => documentRef.querySelector('input[name="participant"]') || documentRef.querySelector("[data-index]") || documentRef.querySelector("[data-focus]");
  const cleanup = (complete = true) => { if (stopped) return; stopped = true; windowRef.clearTimeout(timer); windowRef.clearTimeout(countdownTimer); windowRef.clearTimeout(readyTimer); cancelImageWait(); windowRef.removeEventListener?.("keydown", onKey); background.forEach((child, index) => { child.inert = inertBefore[index]; }); overlay.remove(); if (activeCelebrationStop === stopActive) activeCelebrationStop = null; if (complete) onComplete?.(); returnFocus()?.focus?.({ preventScroll: true }); };
  const stopActive = () => cleanup(false);
  const onKey = (event) => { if (event.key === "Escape") { event.preventDefault(); cleanup(); } else if (event.key === "Tab") { event.preventDefault(); close?.focus?.({ preventScroll: true }); } };
  close?.addEventListener?.("click", cleanup); windowRef.addEventListener?.("keydown", onKey); close?.focus?.({ preventScroll: true });
  const countdown = overlay.querySelector("[data-completion-celebration-countdown]");
  const startedAt = Date.now();
  const updateCountdown = () => { if (stopped || !countdown) return; const remaining = Math.max(0, Math.ceil((returnDelay - (Date.now() - startedAt)) / 1000)); countdown.textContent = remaining > 0 ? `${remaining}秒後にトップへ戻ります` : "まもなくトップへ戻ります"; if (remaining > 0) countdownTimer = windowRef.setTimeout(updateCountdown, 1000); };
  const startMotion = () => { if (stopped || started) return; started = true; overlay.classList.add("is-ready"); };
  const images = [...overlay.querySelectorAll?.("img") || []];
  const imageWait = waitForImages(images); cancelImageWait = imageWait.cancel; imageWait.promise.then(startMotion).catch(startMotion);
  readyTimer = windowRef.setTimeout(startMotion, 950);
  updateCountdown(); timer = windowRef.setTimeout(cleanup, returnDelay); if (reduced) startMotion();
  activeCelebrationStop = stopActive; return { variant: VARIANTS[variant], stop: stopActive };
}

// Navigation can leave the completion screen before its delayed return fires.
// Keep the cancellation hook small and side-effect free for callers that own
// the surrounding state machine.
export function stopCompletionCelebration() {
  activeCelebrationStop?.();
}

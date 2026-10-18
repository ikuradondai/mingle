import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const playwrightModule = process.env.PLAYWRIGHT_MODULE || 'node_modules/playwright/index.mjs';
const { chromium } = await import(pathToFileURL(path.resolve(playwrightModule)).href);
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) });
const output = process.env.REACTION_QA_OUT || 'artifacts/qa-play/reaction-effect';
await mkdir(path.dirname(output), { recursive: true });
const viewport = { width: Number(process.env.QA_WIDTH || 390), height: Number(process.env.QA_HEIGHT || 844) };
const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
await context.route('**/api/**', async (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
const page = await context.newPage();

async function seed() {
  await page.goto(process.env.PLAY_URL || 'http://127.0.0.1:5180/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(async () => {
    const [{ createSession }, { decks }, { saveSession }] = await Promise.all([import('/engine.js'), import('/data/decks.js'), import('/session-storage.js')]);
    saveSession(createSession({ participants: ['青', '珊瑚', '金'], deck: decks.find((item) => item.id === 'friends'), participantRule: 'group' }));
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('[data-action="resume"]').click();
  await page.locator('.shared-question-card').click();
  await page.locator('.shared-question-card.is-revealed').waitFor({ state: 'visible' });
}

function rect(selector) {
  return page.locator(selector).first().evaluate((node) => {
    const r = node.getBoundingClientRect();
    return { left: r.left, top: r.top, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
  });
}

await seed();
const cardBefore = await rect('.shared-question-card');
await page.locator('[data-action="reaction"][data-reaction="surprise"]').click();
await page.locator('[data-reaction-effect="surprise"]').waitFor({ state: 'visible' });
const effect = page.locator('[data-reaction-effect="surprise"]');
assert.equal(await effect.evaluate((node) => getComputedStyle(node).pointerEvents), 'none');
assert.equal(await effect.locator('.reaction-effect-paper').count(), 5);
const animationNames = await effect.locator(':scope > *').evaluateAll((nodes) => nodes.map((node) => getComputedStyle(node).animationName));
assert.deepEqual(animationNames, ['reaction-surprise-hero-left', 'reaction-surprise-hero-main', 'reaction-surprise-hero-right', 'reaction-surprise-paper-one', 'reaction-surprise-paper-two', 'reaction-surprise-paper-three', 'reaction-surprise-paper-four', 'reaction-surprise-paper-five']);
assert.deepEqual(await rect('.shared-question-card'), cardBefore, 'reaction changed card geometry');
for (const [name, delay] of [['early', 180], ['impact', 340], ['tail', 900], ['late', 1800]]) {
  await page.waitForTimeout(delay);
  await page.screenshot({ path: `${output}-${name}-mobile.png`, fullPage: false });
  if (name === 'impact') await effect.screenshot({ path: `${output}-${name}-effect-crop.png` });
}
const heroBounds = await effect.locator('.reaction-effect-hero').evaluateAll((nodes) => nodes.map((node) => { const r = node.getBoundingClientRect(); return { left:r.left, right:r.right, top:r.top, bottom:r.bottom, width:r.width, height:r.height }; }));
for (const bounds of heroBounds) {
  assert.ok(bounds.left >= 16 && bounds.right <= viewport.width - 16, `hero escaped horizontal safe area: ${JSON.stringify(bounds)}`);
}
await page.waitForTimeout(2400);
await page.screenshot({ path: `${output}-end-mobile.png`, fullPage: false });
await page.emulateMedia({ reducedMotion: 'reduce' });
await page.reload({ waitUntil: 'domcontentloaded' });
if (await page.locator('[data-action="resume"]').count()) await page.locator('[data-action="resume"]').click();
if (!(await page.locator('.shared-question-card.is-revealed').count())) await page.locator('.shared-question-card').click();
await page.locator('[data-action="reaction"][data-reaction="surprise"]').click();
const reducedAnimation = await page.locator('[data-reaction-effect="surprise"] .reaction-effect-hero-main').evaluate((node) => getComputedStyle(node).animationName);
assert.equal(reducedAnimation, 'none');
await context.close();
await browser.close();
console.log(JSON.stringify({ ok: true, viewport: `${viewport.width}x${viewport.height}`, animationNames, heroBounds, screenshots: 5 }));

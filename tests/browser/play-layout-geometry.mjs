// Geometry QA for the shared play surface.
// Run against a prepared play URL (the normal app session can be seeded by a
// caller/fixture): PLAY_URL=http://127.0.0.1:5180/?... node tests/browser/play-layout-geometry.mjs
// The route mock deliberately answers every /api/** request so this check
// cannot write to an account, analytics, or other remote service.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const playwrightModule = process.env.PLAYWRIGHT_MODULE || 'node_modules/playwright/index.mjs';
const { chromium } = await import(pathToFileURL(path.resolve(playwrightModule)).href);

const viewports = [
  { name: 'desktop', width: 1280, height: 800 },
  { name: 'mobile', width: 390, height: 844 },
  { name: 'short-mobile', width: 390, height: 680 },
];
const tolerance = 1;

function rect(page, selector) {
  return page.locator(selector).evaluate((node) => {
    const r = node.getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height };
  });
}

async function settled(page) {
  await page.evaluate(async () => {
    if (document.fonts?.ready) await document.fonts.ready;
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
}

function assertSame(before, after, label) {
  for (const key of ['left', 'top', 'width', 'height']) {
    assert.ok(Math.abs(before[key] - after[key]) <= tolerance, `${label}.${key}: ${before[key]} -> ${after[key]}`);
  }
}

async function prepareSession(page, mode = 'group') {
  await page.goto(process.env.PLAY_URL || 'http://127.0.0.1:5180/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(async (sessionMode) => {
    const [{ createSession, createSoloSession }, { decks }, { soloDecks }, { saveSession }] = await Promise.all([
      import('/engine.js'), import('/data/decks.js'), import('/data/solo-decks.js'), import('/session-storage.js'),
    ]);
    const session = sessionMode === 'solo'
      ? createSoloSession({ deck: soloDecks.find((item) => item.id === 'self-values'), participant: 'QA' })
      : createSession({ participants: ['QA一人目', 'QA二人目', 'QA三人目'], deck: decks.find((item) => item.id === 'date'), participantRule: 'group', random: () => 0.37 });
    saveSession(session);
  }, mode);
  await page.reload({ waitUntil: 'domcontentloaded' });
  const resume = page.locator('[data-action="resume"]');
  if (await resume.count()) await resume.click();
  await page.locator('.shared-question-card').first().waitFor({ state: 'visible' });
}

async function runViewport(browser, viewport, mode) {
  const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height }, deviceScaleFactor: 1 });
  await context.route('**/api/**', async (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  const page = await context.newPage();
  await prepareSession(page, mode);
  await settled(page);
  const card = page.locator('.shared-question-card').first();
  if (!(await card.count())) throw new Error('PLAY_URL must open a prepared shared play session');
  const primary = page.locator('.shared-actions .play-action-button').first();
  const before = { card: await rect(page, '.shared-question-card'), primary: await rect(page, '.shared-actions .play-action-button') };
  const beforeScroll = await page.evaluate(() => ({ x: document.documentElement.scrollWidth, y: document.documentElement.scrollHeight, innerHeight: innerHeight }));
  const outputDir = path.resolve(process.env.QA_OUTPUT_DIR || 'artifacts/qa-play');
  await mkdir(outputDir, { recursive: true });
  await page.screenshot({ path: path.join(outputDir, `${mode}-${viewport.name}-before.png`), fullPage: false });
  await card.click();
  await page.locator('.shared-question-card.is-revealed').waitFor({ state: 'visible' });
  await settled(page);
  await page.waitForTimeout(160); // allow the revealed theme banner to finish decoding
  const after = { card: await rect(page, '.shared-question-card'), primary: await rect(page, '.shared-actions .play-action-button') };
  assertSame(before.card, after.card, `${viewport.name} card reveal`);
  assertSame(before.primary, after.primary, `${viewport.name} primary reveal`);
  const afterScroll = await page.evaluate(() => ({ x: document.documentElement.scrollWidth, y: document.documentElement.scrollHeight, innerHeight: innerHeight }));
  await page.screenshot({ path: path.join(outputDir, `${mode}-${viewport.name}-after.png`), fullPage: false });
  assert.ok(afterScroll.x <= viewport.width + tolerance, `${viewport.name} horizontal overflow: ${afterScroll.x}`);
  if (viewport.name !== 'short-mobile') assert.ok(afterScroll.y <= afterScroll.innerHeight + tolerance, `${viewport.name} unexpected vertical scroll: ${afterScroll.y}`);
  await context.close();
  return { mode, viewport: viewport.name, before, after, scroll: { before: beforeScroll, after: afterScroll } };
}

if (!process.env.PLAY_URL) console.warn('PLAY_URL not set; using the app root. Prepare a play session before running this fixture.');
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) });
try {
  const results = [];
  for (const mode of ['group', 'solo']) for (const viewport of viewports) results.push(await runViewport(browser, viewport, mode));
  console.log(JSON.stringify({ ok: true, results }, null, 2));
} finally {
  await browser.close();
}

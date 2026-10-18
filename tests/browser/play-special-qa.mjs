import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const playwrightModule = process.env.PLAYWRIGHT_MODULE || 'node_modules/playwright/index.mjs';
const { chromium } = await import(pathToFileURL(path.resolve(playwrightModule)).href);

const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
await context.route('**/api/**', async (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
const page = await context.newPage();

async function seedStyle(kind) {
  await page.goto(process.env.PLAY_URL || 'http://127.0.0.1:5180/', { waitUntil: 'domcontentloaded' });
  await page.evaluate(async (wanted) => {
    const [{ createSession }, { decks }, { saveSession }, { answerStyleForCard }] = await Promise.all([import('/engine.js'), import('/data/decks.js'), import('/session-storage.js'), import('/answer-style.js')]);
    let selected = null;
    for (let attempt = 0; attempt < 120 && !selected; attempt += 1) {
      const candidate = createSession({ participants: ['予想', '一緒', '三人'], deck: decks.find((item) => item.id === 'friends'), participantRule: 'group' });
      if (wanted === 'together') {
        const preferred = candidate.questions.find((item) => item.id === 'friends-08');
        if (preferred) candidate.questions = [preferred, ...candidate.questions.filter((item) => item !== preferred)];
      }
      const index = answerStyleForCard(candidate, 0) === wanted ? 0 : -1;
      if (index === 0) {
        selected = candidate;
      }
    }
    if (!selected) throw new Error(`could not seed ${wanted}`);
    saveSession(selected);
  }, kind);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('[data-action="resume"]').click();
  await page.locator('.shared-question-card').waitFor({ state: 'visible' });
}

async function box(selector) { return page.locator(selector).first().evaluate((node) => { const r = node.getBoundingClientRect(); return { left:r.left, top:r.top, right:r.right, bottom:r.bottom, width:r.width, height:r.height }; }); }
for (const kind of ['predict', 'together']) {
  await seedStyle(kind);
  const cardBefore = await box('.shared-question-card');
  await page.locator('.shared-question-card').click();
  await page.locator('.shared-question-card.is-revealed').waitFor({ state: 'visible' });
  await page.evaluate(async () => { if (document.fonts?.ready) await document.fonts.ready; await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); });
  const cardAfter = await box('.shared-question-card');
  assert.deepEqual(cardAfter, cardBefore, `${kind} card bounds changed`);
  const slot = await box('.answer-style-slot');
  const hint = await box('.answer-style-hint');
  assert.ok(hint.left >= slot.left - 1 && hint.right <= slot.right + 1 && hint.top >= slot.top - 1 && hint.bottom <= slot.bottom + 1, `${kind} hint escaped slot`);
  const speaker = await box('.shared-speaker');
  assert.ok(hint.bottom <= speaker.top + 1, `${kind} hint overlaps speaker`);
  const primary = page.locator('.shared-actions .play-action-button');
  assert.equal(await primary.innerText(), kind === 'together' ? '次のカード' : '次の人');
  const slotBeforeDismiss = await box('.answer-style-slot');
  await page.locator('[data-action="answer-style-dismiss"]').click();
  assert.deepEqual(await box('.answer-style-slot'), slotBeforeDismiss, `${kind} dismiss changed slot geometry`);
}
await context.close(); await browser.close();
console.log(JSON.stringify({ ok: true, viewport: '390x844', cases: ['predict', 'together'] }));

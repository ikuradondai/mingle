import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const playwrightModule = process.env.PLAYWRIGHT_MODULE || 'node_modules/playwright/index.mjs';
const { chromium } = await import(pathToFileURL(path.resolve(playwrightModule)).href);
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
await context.route('**/api/**', async (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
const page = await context.newPage();
async function box(selector) { return page.locator(selector).first().evaluate((node) => { const r=node.getBoundingClientRect(); return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height}; }); }
async function seed(mode) {
  await page.goto(process.env.PLAY_URL || 'http://127.0.0.1:5180/', { waitUntil: 'domcontentloaded' });
  const meta = await page.evaluate(async (wantedMode) => {
    const [{ createSession, createSoloSession }, { decks }, { soloDecks }, { saveSession }] = await Promise.all([import('/engine.js'), import('/data/decks.js'), import('/data/solo-decks.js'), import('/session-storage.js')]);
    const session = wantedMode === 'solo' ? createSoloSession({ deck: soloDecks.find((item) => item.id === 'self-values'), participant: '長文QA' }) : createSession({ participants: ['長文QA', '二人目', '三人目'], deck: decks.find((item) => item.id === 'date'), participantRule: 'group', random: () => 0.2 });
    const candidates = wantedMode === 'solo' ? session.questions.filter((_, index) => index % 6 !== 0) : session.questions;
    const longest = candidates.reduce((a,b) => (b.text.length > a.text.length ? b : a));
    if (wantedMode === 'group') session.questions = [longest, ...session.questions.filter((item) => item !== longest)];
    else {
      const index = session.questions.indexOf(longest);
      session.cursor = index;
      session.roundStart = Math.floor(index / 6) * 6;
      session.unlockedUntil = Math.min(session.roundStart + 6, session.questions.length);
      session.roundCount = index % 6;
      session.roundNumber = Math.floor(index / 6) + 1;
    }
    saveSession(session);
    return { id: longest.id, textLength: longest.text.length };
  }, mode);
  await page.reload({ waitUntil: 'domcontentloaded' }); await page.locator('[data-action="resume"]').click(); await page.locator('.shared-question-card').waitFor({state:'visible'}); return meta;
}
for (const mode of ['group','solo']) {
  const meta = await seed(mode); const before = await box('.shared-question-card'); await page.locator('.shared-question-card').click(); await page.locator('.shared-question-card.is-revealed').waitFor({state:'visible'}); await page.waitForTimeout(400); const after=await box('.shared-question-card');
  assert.deepEqual(after,before,`${mode} long card moved`); const copy=await box('.shared-card-copy'); assert.ok(copy.bottom <= after.bottom + 1,`${mode} long text overflow`); if (mode === 'solo') assert.equal(await page.locator('.shared-card-copy .solo-card-address').count(), 1, 'solo address missing'); console.log(JSON.stringify({ mode, questionId: meta.id, textLength: meta.textLength, before, after }));
}
await context.close(); await browser.close(); console.log(JSON.stringify({ok:true,viewport:'390x844',cases:['group-long','solo-long']}));

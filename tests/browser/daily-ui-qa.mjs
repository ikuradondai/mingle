import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const playwrightModule = process.env.PLAYWRIGHT_MODULE || 'node_modules/playwright/index.mjs';
const { chromium } = await import(pathToFileURL(playwrightModule).href);
const browser = await chromium.launch({ headless: true });
const id = '11111111-1111-4111-8111-111111111111';
const user = { id: '22222222-2222-4222-8222-222222222222', email: 'qa@example.test' };
const group = { id, name: '家族', sourceDeckId: 'date', sourceDeckName: '初デート', deliveryTime: '09:00', status: 'active', isOwner: true, myOptIn: true };
const vendor = `export function createClient(){return {auth:{getSession:async()=>({data:{session:{access_token:'token',user:${JSON.stringify(user)}}}}),onAuthStateChange:(cb)=>{window.__authCb=cb;return {data:{subscription:{unsubscribe(){}}}}},signInWithOAuth:async()=>({}),signInWithOtp:async()=>({}),verifyOtp:async()=>({}),signOut:async()=>({})}}}`;
async function setup(page, { deepDate = '', delayedMe = false, unconfigured = false } = {}) {
  let releaseMe;
  const meReady = delayedMe ? new Promise((resolve) => { releaseMe = resolve; }) : null;
  const errors = []; page.on('pageerror', (error) => errors.push(String(error)));
  await page.route('**/api/account/config', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ enabled: true, url: 'https://fake', publishableKey: 'public', googleEnabled: true, emailOtp: true }) }));
  await page.route('**/vendor/supabase.js', (r) => r.fulfill({ contentType: 'application/javascript', body: vendor }));
  await page.route('**/api/account/me', async (r) => { if (meReady) await meReady; return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ user }) }); });
  await page.route('**/api/daily/**', async (r) => { const u = new URL(r.request().url()); const path = u.pathname.replace('/api/daily', ''); if (path === '/readiness') return r.fulfill({ contentType: 'application/json', body: JSON.stringify(unconfigured ? { configured: false, lineConfigured: false, deliveryEnabled: false } : { configured: true, lineConfigured: true, deliveryEnabled: true }) }); if (path === '/eligible-decks') return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ decks: [{ id: 'date', name: '初デート' }] }) }); if (path === '/groups' && r.request().method() === 'GET') return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ groups: [group] }) }); if (path === '/line/status') return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ linked: true, deliveryPaused: false }) }); if (path === `/groups/${id}`) return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ group, members: [{ id: 'm1', displayName: 'いくら', role: 'owner', status: 'active', lineOptIn: true }] }) }); if (path.endsWith('/today')) return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ question: { date: '2026-10-06', text: '今日はどうだった？' } }) }); if (path.endsWith('/history')) return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ questions: u.searchParams.get('date') === deepDate ? [] : [] }) }); return r.fulfill({ contentType: 'application/json', body: '{}' }); });
  await page.goto(`http://127.0.0.1:5182/daily.html${deepDate ? `#group=${id}&date=${deepDate}` : ''}`, { waitUntil: 'domcontentloaded' });
  return { errors, releaseMe };
}
const results = [];
for (const viewport of [{ width: 1366, height: 768 }, { width: 375, height: 812 }]) {
  const page = await browser.newPage({ viewport }); const { errors } = await setup(page);
  await page.waitForSelector('.daily-question');
  assert.equal(await page.locator('.daily-question').innerText(), '今日はどうだった？');
  assert.equal(await page.locator('body').innerText().then((x) => x.includes('読み込み中…')), false);
  assert.equal(await page.locator('[data-settings]').count(), 1);
  assert.equal(errors.length, 0, errors.join('\n'));
  await page.screenshot({ path: `artifacts/daily-ui-${viewport.width}x${viewport.height}.png` });
  results.push({ case: 'normal', viewport, errors, question: true, loadingCleared: true, scrollWidth: await page.evaluate(() => document.documentElement.scrollWidth), innerWidth: viewport.width });
  await page.close();
}
{
  const page = await browser.newPage({ viewport: { width: 375, height: 812 } }); const { errors } = await setup(page, { deepDate: '2026-10-05' });
  await page.waitForSelector('.daily-group');
  await page.waitForFunction(() => document.body.innerText.includes('指定された日付の問いは見つかりません。'), null, { timeout: 5000 });
  assert.equal(await page.locator('.daily-question').count(), 0);
  assert.match(await page.locator('body').innerText(), /指定された日付の問いは見つかりません/);
  assert.equal(await page.locator('body').innerText().then((x) => x.includes('今日はどうだった？')), false);
  assert.equal(errors.length, 0, errors.join('\n'));
  results.push({ case: 'missing-deep-date', viewport: { width: 375, height: 812 }, errors, question: false });
  await page.close();
}
{
  const page = await browser.newPage({ viewport: { width: 375, height: 812 } }); const { errors, releaseMe } = await setup(page, { delayedMe: true });
  await page.waitForTimeout(100);
  await page.evaluate(() => window.__authCb?.('SIGNED_OUT', null));
  releaseMe();
  await page.waitForTimeout(300);
  assert.equal(await page.locator('.daily-question').count(), 0);
  assert.equal(await page.locator('.daily-groups').count(), 1);
  assert.equal(await page.locator('body').innerText().then((x) => x.includes('家族')), false);
  assert.equal(errors.length, 0, errors.join('\n'));
  results.push({ case: 'logout-race', viewport: { width: 375, height: 812 }, errors, privateDomCleared: true });
  await page.close();
}
{
  const page = await browser.newPage({ viewport: { width: 375, height: 812 } });
  const { errors } = await setup(page, { unconfigured: true });
  await page.waitForFunction(() => document.body.innerText.includes('1日1問は準備中です'), null, { timeout: 5000 });
  const body = await page.locator('body').innerText();
  assert.equal(body.includes('グループ管理と当日の問いの確認は利用できます'), false);
  const geometry = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth }));
  assert.equal(errors.length, 0, errors.join('\n'));
  assert.ok(geometry.scrollWidth <= geometry.innerWidth, JSON.stringify(geometry));
  results.push({ case: 'readiness-unconfigured', viewport: { width: 375, height: 812 }, errors, scrollWidth: geometry.scrollWidth, innerWidth: geometry.innerWidth });
  await page.close();
}
await browser.close();
console.log(JSON.stringify(results));

import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const playwrightModule = process.env.PLAYWRIGHT_MODULE || 'node_modules/playwright/index.mjs';
const { chromium } = await import(pathToFileURL(playwrightModule).href);
const browser = await chromium.launch({ headless: true });
const id = '11111111-1111-4111-8111-111111111111';
const owner = { id: '22222222-2222-4222-8222-222222222222', email: 'qa@example.test' };
const member = { id: '33333333-3333-4333-8333-333333333333', email: 'member@example.test' };
const baseGroup = { id, name: '家族', sourceDeckId: 'date', sourceDeckName: '初デート', deliveryTime: '09:00', status: 'active', isOwner: true, myOptIn: true };
async function setup(page, { authenticated = true, isOwner = true, invite = false, link = false, clipboardReject = false } = {}) {
  const user = isOwner ? owner : member; const calls = []; let currentGroup = { ...baseGroup, isOwner };
  const session = `{"access_token":"token","user":${JSON.stringify(user)}}`;
  const vendor = `export function createClient(){let current=${authenticated ? session : 'null'};return {auth:{getSession:async()=>({data:{session:current}}),onAuthStateChange:(cb)=>{window.__authCb=cb;setTimeout(()=>cb('INITIAL_SESSION',current),0);return {data:{subscription:{unsubscribe(){}}}}},signInWithOAuth:async()=>({}),signInWithOtp:async()=>({}),verifyOtp:async()=>{current={access_token:'token',user:${JSON.stringify(owner)}};window.__authCb?.('SIGNED_IN',current);return {data:{session:current}};},signOut:async()=>{current=null;window.__authCb?.('SIGNED_OUT',null);return {}}}}}`;
  if (clipboardReject) await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { value: { writeText: async () => { throw new Error('denied'); } }, configurable: true }));
  await page.route('**/api/account/config', r => r.fulfill({ contentType: 'application/json', body: JSON.stringify({ enabled: true, url: 'https://fake', publishableKey: 'public', googleEnabled: true, emailOtp: true }) }));
  await page.route('**/vendor/supabase.js', r => r.fulfill({ contentType: 'application/javascript', body: vendor }));
  await page.route('**/api/account/me', r => { const hasAuth = Boolean(r.request().headers().authorization); return r.fulfill({ status: hasAuth || authenticated ? 200 : 401, contentType: 'application/json', body: JSON.stringify({ user: hasAuth || authenticated ? user : null }) }); });
  await page.route('**/api/daily/**', async r => {
    const u = new URL(r.request().url()); const path = u.pathname.replace('/api/daily', ''); const method = r.request().method(); let body = {};
    try { body = r.request().postDataJSON() || {}; } catch {}
    calls.push({ method, path, body });
    if (path === '/readiness') return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ configured: true, lineConfigured: true, deliveryEnabled: true }) });
    if (path === '/eligible-decks') return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ decks: [{ id: 'date', name: '初デート' }] }) });
    if (path === '/invite-preview') return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ group: { name: '招待家族', sourceDeckName: '初デート' } }) });
    if (path === '/groups' && method === 'GET') return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ groups: [currentGroup] }) });
    if (path === '/groups' && method === 'POST') { currentGroup = { ...currentGroup, id: '44444444-4444-4444-8444-444444444444', name: body.name, isOwner: true }; return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ group: currentGroup }) }); }
    if (path === `/groups/${currentGroup.id}` && method === 'GET') return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ group: currentGroup, members: [{ id: 'm1', displayName: 'いくら', role: isOwner ? 'owner' : 'member', status: 'active', lineOptIn: false }] }) });
    if (path === `/groups/${currentGroup.id}` && method === 'PUT') { currentGroup = { ...currentGroup, name: body.name, deliveryTime: body.deliveryTime, isOwner: true }; return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ group: currentGroup }) }); }
    if (path === `/groups/${currentGroup.id}/today`) return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ question: { date: '2026-10-06', text: '今日はどうだった？' } }) });
    if (path === `/groups/${currentGroup.id}/history`) return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ questions: [] }) });
    if (path === '/line/status') return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ linked: true, deliveryPaused: false }) });
    if (path === `/groups/${currentGroup.id}/invite`) return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ token: 'invite-token-123' }) });
    if (path === '/join') return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ groupId: id, displayName: body.displayName }) });
    if (path === `/groups/${currentGroup.id}/line-opt-in`) return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ enabled: body.enabled === true }) });
    if (path === '/line/link/bind') return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ redirectUrl: 'https://access.line.me/dialog/bot/accountLink?ok=1' }) });
    return r.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'NOT_FOUND' }) });
  });
  await page.goto(`http://127.0.0.1:5182/daily.html${invite ? '#invite=invite-token-123' : link ? '#link=line-token&setup=setup-token' : ''}`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.daily-panel'); await page.waitForTimeout(100);
  return { calls };
}
const results = [];
{
  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } }); page.setDefaultTimeout(8000); const { calls } = await setup(page);
  await page.locator('[data-create]').first().click(); await page.locator('[data-close]').click(); assert.equal(calls.filter(x => x.method === 'POST' && x.path === '/groups').length, 0);
  await page.locator('[data-settings]').click(); await page.locator('[data-close]').click(); assert.equal(calls.filter(x => x.method === 'PUT').length, 0);
  await page.locator('[data-create]').first().click(); await page.locator('dialog input[name=name]').fill('新しい家族'); await page.locator('dialog form').evaluate(f => f.requestSubmit()); await page.waitForTimeout(150); assert.equal(calls.filter(x => x.method === 'POST' && x.path === '/groups').length, 1); assert.equal(await page.locator('.daily-main h2').innerText(), '新しい家族'); assert.equal(await page.locator('.daily-group.is-selected').getAttribute('data-select'), '44444444-4444-4444-8444-444444444444');
  await page.locator('[data-settings]').click(); await page.locator('dialog input[name=name]').fill('編集済み家族'); await page.locator('dialog form').evaluate(f => f.requestSubmit()); await page.waitForTimeout(100); assert.equal(calls.filter(x => x.method === 'PUT').length, 1); assert.match(await page.locator('body').innerText(), /編集済み家族/);
  results.push({ case: 'owner-create-settings', closeMutations: 0, createPosts: 1, editPuts: 1 }); await page.close();
}
{
  const page = await browser.newPage({ viewport: { width: 375, height: 812 } }); page.setDefaultTimeout(8000); const { calls } = await setup(page, { authenticated: false, invite: true });
  await page.locator('[data-otp] input[name=email]').fill('join@example.test'); await page.locator('[data-otp]').evaluate(f => f.requestSubmit()); await page.waitForTimeout(50); assert.equal(calls.filter(x => x.path === '/groups' && x.method === 'GET').length, 0);
  await page.locator('[data-otp] input[name=token]').fill('123456'); await page.locator('[data-otp]').evaluate(f => f.requestSubmit()); await page.waitForTimeout(1200); if (await page.locator('[data-join]').count() !== 1) throw new Error('join missing: ' + await page.locator('body').innerText()); await page.evaluate(() => { const f = document.querySelector('[data-join]'); const name = f.querySelector('[name=displayName]'); name.value = 'あおい'; f.querySelector('[name=lineOptIn]').checked = true; f.requestSubmit(); }); await page.waitForTimeout(150); assert.equal(calls.filter(x => x.path === '/join' && x.method === 'POST').length, 1); assert.equal(await page.locator('.daily-group.is-selected').count(), 1);
  results.push({ case: 'invite-otp-join', otp: true, joined: true, selected: true }); await page.close();
}
{
  const page = await browser.newPage({ viewport: { width: 375, height: 812 } }); page.setDefaultTimeout(8000); const { calls } = await setup(page, { isOwner: false, link: true });
  assert.match(await page.locator('body').innerText(), /qa@example.test|member@example.test/); await page.locator('[data-optin]').uncheck(); await page.waitForTimeout(150); const opt = calls.filter(x => x.path === `/groups/${id}/line-opt-in` && x.method === 'POST'); assert.equal(opt.length, 1); assert.deepEqual(opt.at(-1).body, { enabled: false }); await page.close(); results.push({ case: 'member-line-optin', requests: 1, finalBody: opt.at(-1).body });
}
{
  const page = await browser.newPage({ viewport: { width: 375, height: 812 } }); page.setDefaultTimeout(8000); const { calls } = await setup(page, { clipboardReject: true }); await page.locator('[data-invite]').click(); await page.locator('[data-copy]').click(); await page.waitForTimeout(30); assert.match(await page.locator('body').innerText(), /コピーできませんでした/); assert.equal(calls.filter(x => x.path === `/groups/${id}/invite`).length, 1); await page.close(); results.push({ case: 'clipboard-reject', successMessage: false, failureMessage: true });
}
{
  const page = await browser.newPage({ viewport: { width: 375, height: 812 } }); page.setDefaultTimeout(8000); await setup(page, { link: true }); assert.match(await page.locator('body').innerText(), /qa@example.test/); assert.equal(await page.locator('[data-bind]').count(), 1); await page.close(); results.push({ case: 'link-identity', emailVisible: true });
}
await browser.close(); console.log(JSON.stringify(results));

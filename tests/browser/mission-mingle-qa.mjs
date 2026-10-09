import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Browser QA for dist/mission-mingle.html against a local server (default http://127.0.0.1:5180), with every /api/group call mocked.
//   PLAYWRIGHT_MODULE=<path to playwright/index.mjs> node tests/browser/mission-mingle-qa.mjs
// 1. every phase renders without errors and without horizontal scroll at 375px and 1366px
// 2. a three-person game played through a small in-script fake server (create -> join -> configure -> start -> pocket/long press/auto-hide -> record -> swap once -> end -> reveal -> summary;
//    the summary is served for 5 minutes only: a later 'ended' read does not wipe a device that already holds it)
// 3. the polling interval follows the server hint (30s on a mission, 5s near the end, 1s in the lobby / reveal)
const playwrightModule = process.env.PLAYWRIGHT_MODULE || 'node_modules/playwright/index.mjs';
const { chromium } = await import(pathToFileURL(playwrightModule).href);
const base = process.env.MISSION_QA_BASE || 'http://127.0.0.1:5180';
const out = process.env.MISSION_QA_OUT || tmpdir();
const browser = await chromium.launch({ headless: true });
const roomId = '11111111-1111-4111-8111-111111111111';
const ids = { h: '22222222-2222-4222-8222-222222222222', a: '33333333-3333-4333-8333-333333333333', b: '55555555-5555-4555-8555-555555555555' };
const tokens = { h: 'H'.repeat(43), a: 'A'.repeat(43), b: 'B'.repeat(43) };
const names = { h: 'ハル', a: 'アオイ', b: 'ボブ' };
const results = [];
const json = (body, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

const membersList = [{ id: ids.h, name: names.h, role: 'host' }, { id: ids.a, name: names.a, role: 'guest' }, { id: ids.b, name: names.b, role: 'guest' }];
const missions = (who, statuses = ['active', 'active', 'active']) => [
  { assignmentId: `00000000-0000-4000-8000-00000000000${1}`, slot: 1, missionId: 'mission-001', text: `${who === 'a' ? 'ボブ' : 'アオイ'}の好きなおにぎりの具を聞き出せ`, difficulty: 1, category: 'ask' },
  { assignmentId: `00000000-0000-4000-8000-00000000000${2}`, slot: 2, missionId: 'mission-002', text: '誰かに「それ分かる」と言わせろ', difficulty: 2, category: 'make-say' },
  { assignmentId: `00000000-0000-4000-8000-00000000000${3}`, slot: 3, missionId: 'mission-003', text: 'ここにいる全員の共通点を1つ見つけろ', difficulty: 3, category: 'find' }
].map((item, i) => ({ ...item, status: statuses[i] }));
function fixture(phase, { host = false, extra = {} } = {}) {
  const me = host ? 'h' : 'a';
  const game = {
    phase, settings: { durationMinutes: 60, preset: 'standard', scene: 'party', seatMode: false }, memberCount: 3, serverNow: new Date().toISOString(),
    startedAt: new Date(Date.now() - 60000).toISOString(), endsAt: new Date(Date.now() + 40 * 60000).toISOString(), extensionsLeft: 2, revealOpenAt: null,
    pollMs: phase === 'mission' ? 30000 : 1000, swapsLeft: 1, myMissions: null, reveal: null, summary: null, ...extra
  };
  return { room: { id: roomId, gameType: 'mission_mingle', status: phase === 'lobby' ? 'lobby' : 'playing', revision: 5, expiresAt: new Date(Date.now() + 86400000).toISOString(), memberCount: 3, members: membersList }, member: { id: ids[me], name: names[me], role: host ? 'host' : 'guest' }, card: null, mission: game, host };
}
const revealedPeople = [
  { memberId: ids.a, name: names.a, missions: [{ text: 'ボブの好きなおにぎりの具を聞き出せ', difficulty: 1 }, { text: '誰かに「それ分かる」と言わせろ', difficulty: 2 }] },
  { memberId: ids.h, name: names.h, missions: [] },
  { memberId: ids.b, name: names.b, missions: [{ text: 'ここにいる全員の共通点を1つ見つけろ（長い文面でも折り返して横にはみ出さないことを確認するための、とても長い指令の文面です）', difficulty: 3 }] }
];
const CASES = [
  ['lobby-host', fixture('lobby', { host: true, extra: { startedAt: null, endsAt: null } }), {}],
  ['lobby-guest', fixture('lobby', { extra: { startedAt: null, endsAt: null } }), {}],
  ['intro-step0', fixture('mission', { extra: { myMissions: missions('a') } }), { intro: 0 }],
  ['intro-step1', fixture('mission', { extra: { myMissions: missions('a') } }), { intro: 1 }],
  ['pocket-guest', fixture('mission', { extra: { myMissions: missions('a') } }), { introSeen: true }],
  ['pocket-host', fixture('mission', { host: true, extra: { myMissions: missions('h') } }), { introSeen: true }],
  ['pocket-host-menu', fixture('mission', { host: true, extra: { myMissions: missions('h') } }), { introSeen: true, menu: true }],
  ['missions-shown', fixture('mission', { extra: { myMissions: missions('a', ['achieved', 'active', 'passed']) } }), { introSeen: true, hold: true }],
  ['reveal_ready-host', fixture('reveal_ready', { host: true, extra: { myMissions: missions('h', ['achieved', 'active', 'active']), revealOpenAt: new Date(Date.now() + 180000).toISOString() } }), {}],
  ['reveal_ready-guest', fixture('reveal_ready', { extra: { myMissions: missions('a', ['achieved', 'active', 'passed']), revealOpenAt: new Date(Date.now() - 1000).toISOString() } }), {}],
  ['reveal-guest-early', fixture('reveal', { extra: { revealOpenAt: new Date(Date.now() + 180000).toISOString(), reveal: { cursor: 0, total: 3, current: revealedPeople[0], revealed: [revealedPeople[0]] } } }), { late: false }],
  ['reveal-guest-late', fixture('reveal', { extra: { revealOpenAt: new Date(Date.now() - 1000).toISOString(), reveal: { cursor: 0, total: 3, current: revealedPeople[0], revealed: [revealedPeople[0]] } } }), { late: true }],
  ['reveal_ready-hold', fixture('reveal_ready', { extra: { myMissions: missions('a', ['achieved', 'active', 'passed']), revealOpenAt: new Date(Date.now() - 1000).toISOString() } }), { holdReady: true }],
  ['reveal-someone', fixture('reveal', { host: true, extra: { reveal: { cursor: 0, total: 3, current: revealedPeople[0], revealed: [revealedPeople[0]] } } }), {}],
  ['reveal-nobody-achieved', fixture('reveal', { extra: { reveal: { cursor: 1, total: 3, current: revealedPeople[1], revealed: revealedPeople.slice(0, 2) } } }), {}],
  ['reveal-long-text-last', fixture('reveal', { host: true, extra: { reveal: { cursor: 2, total: 3, current: revealedPeople[2], revealed: revealedPeople } } }), {}],
  ['summary-host', fixture('summary', { host: true, extra: { pollMs: 0, revealOpenAt: null, summary: { achievedTotal: 3, myAchieved: 0, myTitles: [] } } }), {}],
  ['summary-guest', fixture('summary', { extra: { pollMs: 0, revealOpenAt: null, summary: { achievedTotal: 3, myAchieved: 2, myTitles: ['聞き上手', '合いの手マスター', 'ナチュラル・スパイ'] } } }), {}],
  ['ended', fixture('ended', { host: true, extra: { pollMs: 0 } }), {}]
];

async function openWith(browserContext, { state, token = tokens.a, who = 'a', options = {}, onState }) {
  const page = await browserContext.newPage();
  const errors = []; const requests = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  page.on('console', (message) => { if (message.type() === 'error' && !/Failed to load resource/.test(message.text())) errors.push(message.text()); });
  await page.addInitScript(({ token: t, roomId: r, introSeen }) => {
    localStorage.setItem(`mingle.mission.room:${r}`, JSON.stringify({ schema: 1, roomId: r, invite: 'inv', token: t, createdAt: Date.now() - 1000, expiresAt: Date.now() + 3600000, introSeen: Boolean(introSeen) }));
  }, { token, roomId, introSeen: options.introSeen === true || options.intro === undefined && options.introSeen !== false && !('intro' in options) });
  await page.route('**/api/group/**', async (route) => {
    const request = route.request();
    requests.push({ method: request.method(), url: request.url() });
    if (onState) return route.fulfill(json(onState(request)));
    return route.fulfill(json(state));
  });
  await page.goto(`${base}/mission-mingle.html?room=${roomId}&invite=inv`, { waitUntil: 'domcontentloaded' });
  return { page, errors, requests, who };
}

// ---- 1. every phase at two widths
for (const viewport of [{ width: 375, height: 812 }, { width: 1366, height: 768 }]) {
  for (const [name, state, options] of CASES) {
    const context = await browser.newContext({ viewport });
    const { page, errors } = await openWith(context, { state, token: state.host ? tokens.h : tokens.a, options: { ...options, introSeen: options.intro === undefined } });
    await page.waitForSelector('#mission-app > *', { timeout: 5000 });
    await page.waitForTimeout(150);
    if (options.intro === 1) await page.click('[data-act="intro-next"]');
    if (options.menu) await page.click('[data-menu-toggle]');
    if (options.holdReady) {
      const before = await page.innerText('body');
      assert.equal(/ボブ|それ分かる|共通点/.test(before), false, 'reveal_ready: no mission text before a long press');
      const box = await page.locator('[data-pocket-zone]').boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down(); await page.waitForTimeout(700); await page.mouse.up();
      await page.waitForSelector('[data-missions]');
    }
    if (options.hold) {
      const box = await page.locator('[data-pocket-zone]').boundingBox();
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 3);
      await page.mouse.down(); await page.waitForTimeout(700); await page.mouse.up();
      await page.waitForSelector('[data-missions]');
    }
    await page.waitForTimeout(100);
    const geometry = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth, text: document.body.innerText, title: document.title, dark: document.body.classList.contains('mm-dark') }));
    assert.equal(errors.length, 0, `${name}@${viewport.width}: ${errors.join('\n')}`);
    assert.ok(geometry.scrollWidth <= geometry.innerWidth, `${name}@${viewport.width}: horizontal scroll ${geometry.scrollWidth} > ${geometry.innerWidth}`);
    assert.equal(geometry.title, 'Mingle.Cards', `${name}: neutral tab title`);
    if (name.startsWith('reveal_ready') && !options.holdReady) {
      const html = await page.locator('#mission-app').innerHTML();
      assert.equal(/ボブ|アオイの好き|それ分かる|共通点を1つ/.test(geometry.text + html.replace(/<script[\s\S]*?<\/script>/g, '')), false, `${name}: no mission text in the DOM`);
      assert.ok(geometry.text.includes('記録し忘れはありませんか？（長押しで確認）'));
    }
    if (name === 'reveal-guest-early' || name === 'reveal-guest-late') {
      const visible = await page.locator('[data-late-start]').isVisible();
      assert.equal(visible, options.late, `${name}: guests may drive the reveal only after the real end + 3 minutes`);
    }
    if (name.startsWith('pocket')) {
      assert.equal(geometry.dark, true, `${name}: dark background`);
      assert.equal(/ボブ|アオイ|聞き出せ|それ分かる|共通点/.test(geometry.text), false, `${name}: a mission leaked onto the pocket screen`);
      assert.ok(/\d\d:\d\d まで/.test(geometry.text), `${name}: end time only`);
      const dom = await page.locator('#mission-app').innerHTML();
      assert.equal(/秘密|指令|ミッション|Mingle|ミングル/.test(geometry.text + dom), false, `${name}: no wording (text, aria-label or attribute) about what is behind the screen`);
    }
    if (name === 'reveal-nobody-achieved') assert.ok(geometry.text.includes('今回は会話を楽しみました'));
    if (name === 'reveal-someone') assert.ok(geometry.text.includes('あの質問、指令だったの！？'));
    if (name === 'summary-guest') assert.ok(geometry.text.includes('みんなで3個達成！') && geometry.text.includes('聞き上手'));
    if (name.startsWith('summary')) {
      assert.equal(await page.locator('[data-act="finish"]').count(), 0, `${name}: the kept summary cannot be cut short`);
      assert.equal(await page.locator('[data-late-start]').count(), 0, `${name}: no late finish for guests`);
      assert.ok(geometry.text.includes('数分で消去'), `${name}: says the result is erased soon`);
      assert.equal(/ボブ|アオイの好き|それ分かる|共通点を1つ/.test(geometry.text), false, `${name}: the server sends no mission text any more`);
    }
    if (viewport.width === 375) await page.screenshot({ path: join(out, `mission-${name}.png`), fullPage: true });
    results.push({ case: name, width: viewport.width, scrollWidth: geometry.scrollWidth, errors: errors.length });
    await context.close();
  }
}

// ---- 2. a whole game through a fake server
const S = { phase: 'lobby', revision: 1, settings: { durationMinutes: 60, preset: 'standard', scene: 'party', seatMode: false }, endsAt: 0, extensions: 0, cursor: 0, order: [ids.b, ids.h, ids.a], members: [{ id: ids.h, name: names.h, role: 'host' }], status: {}, swaps: {}, ended: false };
const missionFor = (who) => missions(who, [1, 2, 3].map((slot) => S.status[`${who}${slot}`] || 'active')).map((item) => ({ ...item, assignmentId: `${who === 'h' ? '1' : who === 'a' ? '2' : '3'}0000000-0000-4000-8000-00000000000${item.slot}`, ...(S.swapped?.[`${who}${item.slot}`] ? { text: '誰かに「へえ〜！」と言わせろ' } : {}) }));
function projectFor(who) {
  // lazy expiry, as mission_expire does on the real server
  if (S.phase === 'mission' && Date.now() >= S.endsAt) { S.phase = 'reveal_ready'; S.revision += 1; }
  const phase = S.ended || S.lapsed ? 'ended' : S.phase;
  const left = S.endsAt - Date.now();
  const game = { phase, settings: S.settings, memberCount: S.members.length, serverNow: new Date().toISOString(), startedAt: null, endsAt: S.endsAt ? new Date(S.endsAt).toISOString() : null, extensionsLeft: 2 - S.extensions, revealOpenAt: ['reveal_ready', 'reveal'].includes(phase) ? new Date(S.endsAt + 180000).toISOString() : null, pollMs: phase === 'mission' ? (left <= 60000 ? 5000 : 30000) : ['ended', 'summary'].includes(phase) ? 0 : 1000, swapsLeft: S.swaps[who] ? 0 : 1, myMissions: null, reveal: null, summary: null };
  if (phase === 'mission' || phase === 'reveal_ready') game.myMissions = missionFor(who);
  if (phase === 'summary') game.summary = { achievedTotal: Object.values(S.status).filter((x) => x === 'achieved').length, myAchieved: 0, myTitles: [] }; // the kept 5-minute result: no mission is listed any more
  if (phase === 'reveal') {
    const reached = S.order.slice(0, S.cursor + 1);
    const people = reached.map((id) => { const w = Object.keys(ids).find((k) => ids[k] === id); return { memberId: id, name: names[w], missions: [1, 2, 3].filter((slot) => S.status[`${w}${slot}`] === 'achieved').map((slot) => ({ text: missionFor(w)[slot - 1].text, difficulty: slot })) }; });
    game.reveal = { cursor: S.cursor, total: S.order.length, current: people.at(-1), revealed: people };
  }
  return { room: { id: roomId, gameType: 'mission_mingle', status: S.ended || S.lapsed || S.phase === 'summary' ? 'ended' : S.phase === 'lobby' ? 'lobby' : 'playing', revision: S.revision, expiresAt: new Date(Date.now() + 86400000).toISOString(), memberCount: S.members.length, members: S.members }, member: { id: ids[who], name: names[who], role: who === 'h' ? 'host' : 'guest' }, card: null, mission: game, host: who === 'h' };
}
const whoOf = (request) => Object.keys(tokens).find((k) => tokens[k] === request.headers()['x-group-member-token']);
const counts = { stateGets: { h: 0, a: 0, b: 0 }, actions: [] };
function actionResult(request) {
  const who = whoOf(request); const body = request.postDataJSON();
  counts.actions.push({ who, action: body.action });
  const slotOf = (assignmentId) => Number(assignmentId.slice(-1));
  if (body.action === 'configure') { Object.assign(S.settings, body.settings); S.revision += 1; }
  else if (body.action === 'start') { S.phase = 'mission'; S.endsAt = Date.now() + 40000; S.revision += 1; }
  else if (['achieve', 'unachieve', 'pass'].includes(body.action)) S.status[`${who}${slotOf(body.assignmentId)}`] = { achieve: 'achieved', unachieve: 'active', pass: 'passed' }[body.action];
  else if (body.action === 'swap') { S.swaps[who] = 1; S.swapped = { ...(S.swapped || {}), [`${who}${slotOf(body.assignmentId)}`]: true }; }
  else if (body.action === 'end_now') { S.phase = 'reveal_ready'; S.endsAt = Date.now(); S.revision += 1; }
  else if (body.action === 'extend') { S.extensions += 1; S.endsAt += 900000; S.revision += 1; }
  else if (body.action === 'reveal_start') { S.phase = 'reveal'; S.cursor = 0; S.revision += 1; }
  else if (body.action === 'reveal_next') { assert.equal(body.cursor, S.cursor, 'reveal_next names the position it is looking at'); S.cursor += 1; if (S.cursor >= S.order.length) S.phase = 'summary'; S.revision += 1; }
  else if (body.action === 'finish') { S.ended = true; S.revision += 1; }
  return projectFor(who);
}
{
  const contexts = [];
  const pages = {};
  const errors = [];
  const wire = async (key, url) => {
    // one browser context per phone: storage must not be shared
    const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
    contexts.push(context);
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(`${key}: ${error}`));
    page.on('console', (message) => { if (message.type() === 'error' && !/Failed to load resource/.test(message.text())) errors.push(`${key}: ${message.text()}`); });
    await page.route('**/api/group/**', async (route) => {
      const request = route.request(); const path = new URL(request.url()).pathname; const who = whoOf(request);
      if (request.method() === 'POST' && path === '/api/group/rooms') return route.fulfill(json({ ...projectFor('h'), inviteToken: 'inv', memberToken: tokens.h, host: true }, 201));
      if (request.method() === 'POST' && path.endsWith('/preview')) return route.fulfill(json({ room: { id: roomId, status: 'lobby' } }));
      if (request.method() === 'POST' && path.endsWith('/join')) {
        const body = request.postDataJSON(); const k = key === 'a' ? 'a' : 'b';
        if (!S.members.some((m) => m.id === ids[k])) { S.members.push({ id: ids[k], name: body.name, role: 'guest' }); S.revision += 1; }
        return route.fulfill(json({ ...projectFor(k), memberToken: tokens[k], host: false }));
      }
      if (request.method() === 'GET') { counts.stateGets[who] += 1; return route.fulfill(json(projectFor(who))); }
      if (request.method() === 'POST' && path.endsWith('/action')) return route.fulfill(json(actionResult(request)));
      return route.fulfill(json({}, 404));
    });
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    pages[key] = page;
    return page;
  };
  const h = await wire('h', `${base}/mission-mingle.html?create=1`);
  await h.fill('input[name="name"]', names.h);
  await h.click('button[type="submit"]');
  await h.waitForSelector('.mm-settings');
  assert.ok((await h.innerText('body')).includes('参加者 1 / 8人'));
  const joinUrl = `${base}/mission-mingle.html?room=${roomId}&invite=inv`;
  for (const key of ['a', 'b']) {
    const page = await wire(key, joinUrl);
    await page.waitForSelector('input[name="name"]');
    await page.fill('input[name="name"]', names[key]);
    await page.click('button[type="submit"]');
    await page.waitForSelector('.mm-summary');
  }
  await h.waitForFunction(() => document.body.innerText.includes('参加者 3 / 8人'), null, { timeout: 4000 });
  // the representative picks settings (each tap is one configure action)
  await h.click('[data-set-key="durationMinutes"][data-set-value="30"]');
  await h.click('[data-set-key="preset"][data-set-value="hard"]');
  await h.click('[data-set-key="scene"][data-set-value="business"]');
  await h.check('[data-seat]');
  await h.waitForFunction(() => document.querySelector('[data-set-key="preset"][data-set-value="hard"]')?.getAttribute('aria-pressed') === 'true' && document.querySelector('[data-seat]')?.checked);
  assert.deepEqual(S.settings, { durationMinutes: 30, preset: 'hard', scene: 'business', seatMode: true });
  await pages.a.waitForFunction(() => document.body.innerText.includes('30分 · 攻め · 懇親会 · 席あり'), null, { timeout: 4000 });
  await h.click('[data-act="start"]');
  // everybody gets the one-time intro, then the pocket screen
  for (const key of ['h', 'a', 'b']) {
    const page = pages[key];
    await page.waitForSelector('[data-act="intro-next"]', { timeout: 4000 });
    await page.click('[data-act="intro-next"]');
    assert.equal((await page.locator('.mm-mission').count()), 3, `${key}: three missions in the intro`);
    await page.click('[data-act="intro-done"]');
    await page.waitForSelector('[data-pocket-zone]');
    assert.equal(/聞き出せ|それ分かる|共通点/.test(await page.innerText('body')), false, `${key}: pocket hides the missions`);
  }
  const guest = pages.a;
  const holdOnGuest = async () => { const box = await guest.locator('[data-pocket-zone]').boundingBox(); await guest.mouse.move(box.x + box.width / 2, box.y + box.height / 3); await guest.mouse.down(); await guest.waitForTimeout(350); assert.equal(await guest.locator('[data-missions]').count(), 0, 'not before the long press time'); await guest.waitForTimeout(350); await guest.mouse.up(); await guest.waitForSelector('[data-missions]'); };
  await holdOnGuest();
  const shownAt = Date.now();
  await guest.waitForSelector('[data-pocket-zone]', { timeout: 8000 });
  const hiddenAfter = Date.now() - shownAt;
  assert.ok(hiddenAfter >= 4500 && hiddenAfter <= 6500, `auto-hide after about 5s of no touch (took ${hiddenAfter}ms)`);
  await holdOnGuest();
  await guest.click('[data-mission="achieve"] >> nth=0');
  await guest.waitForSelector('.mm-mission.is-achieved');
  assert.ok((await guest.innerText('.mm-toast')).includes('記録しました'));
  await guest.click('[data-mission="unachieve"]');
  await guest.waitForSelector('.mm-mission.is-achieved', { state: 'detached' });
  await guest.click('[data-mission="achieve"] >> nth=0');
  await guest.waitForSelector('.mm-mission.is-achieved');
  await guest.click('[data-mission="swap"] >> nth=0');
  await guest.waitForFunction(() => document.body.innerText.includes('へえ〜'));
  assert.equal(await guest.locator('[data-mission="swap"]').count(), 0, 'swap is offered once');
  // passing asks once more; cancelling leaves the mission alone
  await guest.click('[data-ask-pass] >> nth=0');
  assert.ok((await guest.innerText('body')).includes('パスしますか？'));
  await guest.click('[data-cancel-pass]');
  assert.equal(await guest.locator('.mm-mission.is-passed').count(), 0);
  await guest.click('[data-ask-pass] >> nth=0');
  await guest.click('[data-mission="pass"]');
  await guest.waitForSelector('.mm-mission.is-passed');
  // host: menu with confirmation, extension counter
  await h.click('[data-menu-toggle]');
  await h.click('[data-confirm="end_now"]');
  assert.ok((await h.innerText('.mm-menu')).includes('今すぐ答え合わせに進みますか'));
  await h.click('[data-cancel-confirm]');
  await h.click('[data-act="extend"]');
  await h.waitForFunction(() => document.body.innerText.includes('あと1回'));
  S.endsAt = Date.now() + 700; // let the clock run out
  // the representative's device chimes, everyone lands on the "time is up" screen
  for (const key of ['h', 'a', 'b']) await pages[key].waitForSelector('text=時間です！', { timeout: 9000 });
  assert.ok((await guest.innerText('body')).includes('答え合わせを待ち'));
  await guest.waitForSelector('[data-pocket-zone]', { timeout: 7000 });
  assert.equal(/それ分かる|へえ〜|共通点|聞き出せ/.test(await guest.innerText('body')), false, 'the time-is-up screen shows no mission text');
  await h.click('[data-act="reveal_start"]');
  for (const key of ['h', 'a', 'b']) await pages[key].waitForSelector('text=あの質問、指令だったの！？', { timeout: 4000 });
  const firstName = await h.innerText('.mm-who');
  for (const key of ['a', 'b']) assert.equal(await pages[key].innerText('.mm-who'), firstName, 'all devices show the same person');
  assert.equal(await pages.a.locator('[data-act="reveal_next"]').isVisible(), false, 'only the representative advances (until the grace has passed)');
  await h.click('[data-act="reveal_next"]');
  await pages.a.waitForFunction((was) => document.querySelector('.mm-who')?.textContent !== was, firstName, { timeout: 4000 });
  await h.click('[data-act="reveal_next"]');
  await h.click('[data-act="reveal_next"]');
  for (const key of ['h', 'a', 'b']) await pages[key].waitForSelector('.mm-titles', { timeout: 4000 });
  assert.ok((await h.innerText('body')).includes('みんなで'));
  // the room ended when the summary began: stored credentials are gone on every phone, and nobody polls the frozen summary any more
  for (const key of ['h', 'a', 'b']) assert.equal(await pages[key].evaluate(() => Object.keys(localStorage).some((k) => k.startsWith('mingle.mission.room:'))), false, `${key}: credentials cleared once the room is known to be over`);
  const getsAtSummary = counts.stateGets.a; await pages.a.waitForTimeout(2500);
  assert.equal(counts.stateGets.a, getsAtSummary, 'no polling in the summary');
  // nobody can cut the kept summary short: no finish button for the representative, none for guests; the host may start a new room
  for (const key of ['h', 'a', 'b']) assert.equal(await pages[key].locator('[data-act="finish"], [data-late-start]').count(), 0, `${key}: no finish in the summary`);
  assert.ok((await h.innerText('body')).includes('新しいルームを作る'));
  // the answers shown during the reveal are kept in this device's memory for the recap (the server no longer lists them)
  assert.ok((await h.locator('.mm-recap li').count()) >= 3, 'the recap is built from what the reveal showed');
  // 5 minutes later the server answers 'ended'; a device that already holds the summary keeps showing it
  S.lapsed = true;
  const getsBefore = counts.stateGets.h;
  await h.evaluate(() => window.dispatchEvent(new Event('focus')));
  await h.waitForTimeout(600);
  assert.ok(counts.stateGets.h > getsBefore, 'the device asked again');
  assert.ok((await h.innerText('body')).includes('みんなで'), 'an ended read does not wipe the summary');
  assert.equal((await h.innerText('body')).includes('ゲーム終了'), false);
  assert.equal(errors.length, 0, errors.join('\n'));
  for (const key of ['h', 'a', 'b']) assert.ok(await pages[key].evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${key}: no horizontal scroll at the end`);
  results.push({ case: 'full-game', actions: counts.actions.length, stateGets: counts.stateGets, errors: errors.length });
  for (const context of contexts) await context.close();
}

// ---- 3. polling follows the server hint (fake timers)
async function pollsFor(pollMs, phase, state, windowMs) {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const page = await context.newPage();
  await page.clock.install();
  let gets = 0;
  await page.addInitScript(({ r }) => localStorage.setItem(`mingle.mission.room:${r}`, JSON.stringify({ schema: 1, roomId: r, invite: 'inv', token: 'A'.repeat(43), createdAt: Date.now() - 1000, expiresAt: Date.now() + 3600000, introSeen: true })), { r: roomId });
  await page.route('**/api/group/**', (route) => { if (route.request().method() === 'GET') gets += 1; return route.fulfill(json({ ...state, mission: { ...state.mission, phase, pollMs, serverNow: new Date().toISOString() } })); });
  await page.goto(`${base}/mission-mingle.html?room=${roomId}&invite=inv`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#mission-app > *');
  await page.waitForTimeout(100);
  const first = gets;
  assert.equal(first, 1, 'one state fetch on load');
  await page.clock.runFor(windowMs - 300); await page.waitForTimeout(50);
  const before = gets;
  await page.clock.runFor(600); await page.waitForTimeout(50);
  const after = gets;
  await context.close();
  return { before: before - first, after: after - first };
}
{
  const mission = fixture('mission', { extra: { myMissions: missions('a') } });
  const slow = await pollsFor(30000, 'mission', mission, 30000);
  assert.deepEqual(slow, { before: 0, after: 1 }, `mission phase polls once per 30s: ${JSON.stringify(slow)}`);
  const final = await pollsFor(5000, 'mission', mission, 5000);
  assert.deepEqual(final, { before: 0, after: 1 }, `the last minute polls every 5s: ${JSON.stringify(final)}`);
  const lobby = await pollsFor(1000, 'lobby', fixture('lobby', { extra: { startedAt: null, endsAt: null } }), 1000);
  assert.deepEqual(lobby, { before: 0, after: 1 }, `lobby polls every second: ${JSON.stringify(lobby)}`);
  results.push({ case: 'poll-intervals', slow, final, lobby });
}
// ---- 4. every screen that shows mission text hides itself: blur, hidden tab, 5 seconds without a touch
async function secretPage(state, { introSeen = false, token = 'A'.repeat(43) } = {}) {
  const context = await browser.newContext({ viewport: { width: 375, height: 812 } });
  const page = await context.newPage();
  const errors = []; page.on('pageerror', (error) => errors.push(String(error)));
  await page.clock.install();
  await page.addInitScript(({ r, t, seen }) => localStorage.setItem(`mingle.mission.room:${r}`, JSON.stringify({ schema: 1, roomId: r, invite: 'inv', token: t, createdAt: Date.now() - 1000, expiresAt: Date.now() + 3600000, introSeen: seen })), { r: roomId, t: token, seen: introSeen });
  await page.route('**/api/group/**', (route) => route.fulfill(json(state)));
  await page.goto(`${base}/mission-mingle.html?room=${roomId}&invite=inv`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#mission-app > *');
  return { page, context, errors };
}
const introState = fixture('mission', { extra: { myMissions: missions('a') } });
for (const way of ['blur', 'idle-step0', 'idle-step1', 'hidden-tab', 'touch-keeps-it']) {
  const { page, context, errors } = await secretPage(introState);
  await page.waitForSelector('[data-act="intro-next"]');
  if (way !== 'idle-step0') await page.click('[data-act="intro-next"]');
  if (way.endsWith('step1') || way === 'blur' || way === 'hidden-tab' || way === 'touch-keeps-it') assert.ok((await page.innerText('body')).includes('聞き出せ'), `${way}: the intro shows the missions first`);
  if (way === 'touch-keeps-it') {
    await page.clock.runFor(4000); await page.mouse.click(10, 10); await page.clock.runFor(4000);
    assert.equal(await page.locator('[data-pocket-zone]').count(), 0, 'a touch restarts the 5 seconds');
    await page.clock.runFor(1500);
  } else if (way === 'blur') await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  else if (way === 'hidden-tab') await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }); document.dispatchEvent(new Event('visibilitychange')); });
  else await page.clock.runFor(5200);
  await page.waitForSelector('[data-pocket-zone]', { timeout: 2000 });
  const text = await page.innerText('body');
  assert.equal(/聞き出せ|それ分かる|共通点|指令/.test(text), false, `${way}: intro hidden, pocket shows no mission wording`);
  const stored = await page.evaluate((r) => JSON.parse(localStorage.getItem(`mingle.mission.room:${r}`)), roomId);
  assert.equal(stored.introSeen, true, `${way}: the intro-seen flag lives in the expiring credential record`);
  assert.equal(await page.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith('mingle.mission.intro:'))), false);
  assert.equal(errors.length, 0, errors.join('\n'));
  await context.close();
}
{
  // the long-press view and the time-is-up check hide after 5 seconds too
  for (const phase of ['mission', 'reveal_ready']) {
    const state = fixture(phase, { extra: { myMissions: missions('a'), revealOpenAt: new Date(Date.now() + 180000).toISOString() } });
    const { page, context } = await secretPage(state, { introSeen: true });
    await page.waitForSelector('[data-pocket-zone]');
    const box = await page.locator('[data-pocket-zone]').boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.clock.runFor(600); await page.mouse.up();
    await page.waitForSelector('[data-missions]');
    await page.click('[data-ask-pass] >> nth=0');
    assert.ok((await page.innerText('body')).includes('パスしますか？'));
    await page.clock.runFor(5200);
    assert.equal(await page.locator('[data-missions]').count(), 0, `${phase}: auto-hidden`);
    assert.equal(/それ分かる|共通点|聞き出せ/.test(await page.innerText('body')), false);
    await context.close();
  }
  results.push({ case: 'secret-screens-auto-hide', ok: true });
}
await browser.close();
console.log(JSON.stringify(results, null, 1));

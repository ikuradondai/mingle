import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

process.env.ANALYTICS_LOCAL_STORE = '1';
process.env.NODE_ENV = 'test';
process.env.ANALYTICS_NAMESPACE = `test-${process.pid}-${Date.now()}`;
process.env.ANALYTICS_LOCAL_PATH = join(await mkdtemp(join(tmpdir(), 'mingle-torisetsu-')), 'analytics.json');
const { default: track } = await import('../api/track.js');
const { PAGE_IDS } = await import('../server-side/config.mjs');
const ts = await import('../dist/torisetsu.js');
const { SECTIONS } = await import('../dist/data/torisetsu-content.js');

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const code = (path) => read(path).replace(/\/\*[\S\s]*?\*\//g, "").split(/\r?\n/).map((line) => line.replace(/^\s*\/\/.*$/, "")).join("\n");
const FORBIDDEN_NETWORK = [/\bfetch\s*\(/, /XMLHttpRequest/, /sendBeacon/, /WebSocket/, /EventSource/];
const FORBIDDEN_IMPORTS = [/import[^;\n]*analytics/, /import[^;\n]*account/, /import[^;\n]*session-storage/, /sessionStorage/, /from\s+['"][^'"]*feedback/];

test('builder modules contain no network calls and import no analytics/account/session code', () => {
  for (const path of ['dist/torisetsu.js', 'dist/data/torisetsu-content.js', 'dist/torisetsu-image.js']) {
    const source = code(path);
    for (const pattern of FORBIDDEN_NETWORK) assert.doesNotMatch(source, pattern, `${path}: ${pattern}`);
    for (const pattern of FORBIDDEN_IMPORTS) assert.doesNotMatch(source, pattern, `${path}: ${pattern}`);
    assert.doesNotMatch(source, /history\.(push|replace)State|location\.(hash|search)\s*=/, `${path}: must not touch the URL`);
    assert.doesNotMatch(source, /document\.cookie/, path);
  }
});

test('the image module only draws locally (canvas -> blob -> share/download)', () => {
  const source = code('dist/torisetsu-image.js');
  assert.match(source, /toBlob/);
  assert.doesNotMatch(source, /\.src\s*=\s*['"]https?:/);
  assert.doesNotMatch(source, /https?:\/\//);
});

test('app.js never routes builder content to analytics, session storage, accounts or the network', () => {
  const lines = read('dist/app.js').split(/\r?\n/);
  const FORBIDDEN_LINE = [/trackPage\(/, /trackThemeStart\(/, /trackSessionProgress\(/, /saveCurrentSession\(/, /saveSession\(/, /sessionStorage\.setItem\(/, /accountApi\./, /\bfetch\(/, /submitFeedback/, /submitThemeLike/, /buildFeedbackPayload/];
  let touched = 0;
  lines.forEach((line, index) => {
    if (!/state\.torisetsu|torisetsu(Context|Scope)|ts\.answers|\.answers\b.*torisetsu/i.test(line)) return;
    touched += 1;
    for (const pattern of FORBIDDEN_LINE) assert.doesNotMatch(line, pattern, `app.js:${index + 1}: ${pattern}`);
  });
  assert.ok(touched > 0);
  // 通信は theme_start('self-values') だけ。page_view は render() の既存呼び出しが画面名 'torisetsu' を渡す。
  const source = read('dist/app.js');
  const open = source.slice(source.indexOf('function openTorisetsu()'), source.indexOf('function leaveTorisetsu()'));
  assert.match(open, /trackThemeStart\("self-values"\)/);
  assert.equal((open.match(/track[A-Z]\w*\(/g) || []).length, 1);
  const builderBlock = source.slice(source.indexOf('let torisetsuUndoTimer'), source.indexOf('function startSelectedSoloDeck()'));
  assert.equal((builderBlock.match(/trackPage\(|trackSessionProgress\(|saveCurrentSession\(|accountApi\.|fetch\(|sendBeacon/g) || []).length, 0);
});

test('saveAuthReturnIntent writes nothing for the torisetsu screen', () => {
  const source = read('dist/app.js');
  const start = source.indexOf('function saveAuthReturnIntent');
  assert.ok(start > 0);
  const body = source.slice(start, source.indexOf('function ', start + 10));
  assert.doesNotMatch(body, /torisetsu/i);
  assert.match(body, /if \(state\.screen !== "decks" && state\.screen !== "participants"\) return;/);
});

test('using every part of the builder triggers no fetch/beacon', () => {
  const calls = [];
  const original = { fetch: globalThis.fetch, XMLHttpRequest: globalThis.XMLHttpRequest, sendBeacon: globalThis.navigator?.sendBeacon };
  globalThis.fetch = (...args) => { calls.push(args); return Promise.reject(new Error('blocked')); };
  globalThis.XMLHttpRequest = function XHR() { calls.push(['xhr']); };
  try {
    const storage = { data: new Map(), getItem(k) { return this.data.get(k) ?? null; }, setItem(k, v) { this.data.set(k, v); }, removeItem(k) { this.data.delete(k); } };
    const ctx = { storage, today: '2026-10-13', now: () => 1 };
    const state = ts.createTorisetsuState();
    ts.applyAction(state, 'torisetsu-begin', {}, ctx);
    for (const section of SECTIONS) {
      ts.applyAction(state, 'torisetsu-chapter', { chapter: section.chapterId }, ctx);
      ts.applyAction(state, 'torisetsu-write', {}, ctx);
      ts.setDraftText(state, '秘密のメモ', 'text');
      if (section.mode === 'name') ts.setDraftText(state, 'のんびり号', 'name');
      ts.applyAction(state, 'torisetsu-chip', { chip: section.chips[0].id }, ctx);
      ts.applyAction(state, 'torisetsu-commit', {}, ctx);
    }
    ts.composeManual(state.answers, { today: '2026-10-13' });
    ts.applyAction(state, 'torisetsu-manual', {}, ctx);
    ts.applyAction(state, 'torisetsu-save', {}, ctx);
    ts.torisetsuView(state, { esc: String, today: '2026-10-13' });
    ts.applyAction(state, 'torisetsu-delete', {}, ctx);
    ts.applyAction(state, 'torisetsu-undo', {}, ctx);
    assert.equal(calls.length, 0);
    assert.deepEqual([...storage.data.keys()], []);
  } finally {
    globalThis.fetch = original.fetch;
    if (original.XMLHttpRequest) globalThis.XMLHttpRequest = original.XMLHttpRequest; else delete globalThis.XMLHttpRequest;
  }
});

test('analytics knows the torisetsu page id and still rejects extra keys (no content can ride along)', async () => {
  assert.ok(PAGE_IDS.includes('torisetsu'));
  async function invoke(payload) {
    const req = Readable.from([Buffer.from(JSON.stringify(payload))]); req.method = 'POST'; req.url = '/api/track'; req.socket = { remoteAddress: 'torisetsu-test' }; req.headers = { 'content-type': 'application/json' };
    let status; let result; const res = { setHeader() {}, writeHead(code) { status = code; }, end(value) { result = JSON.parse(value); } };
    await track(req, res); return { status, result };
  }
  assert.equal((await invoke({ type: 'page_view', pageId: 'torisetsu', eventId: 'torisetsu-page-event-1' })).status, 202);
  assert.equal((await invoke({ type: 'page_view', pageId: 'torisetsu', eventId: 'torisetsu-page-event-2', answers: { name: 'x' } })).status, 400);
  assert.equal((await invoke({ type: 'theme_start', themeId: 'self-values', eventId: 'torisetsu-theme-event-1' })).status, 202);
  assert.equal((await invoke({ type: 'theme_start', themeId: 'self-values', eventId: 'torisetsu-theme-event-2', text: 'x' })).status, 400);
});

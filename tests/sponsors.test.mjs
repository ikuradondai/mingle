import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createSponsorHandlers, createSponsorService } from '../server-side/sponsors.mjs';

const env = { SUPABASE_URL: 'https://sponsor.test.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test', SUPABASE_SERVICE_ROLE_KEY: 'service-test' };
const cards = Array.from({ length: 6 }, (_, i) => ({ id: `11111111-1111-4111-8111-${String(i + 1).padStart(4, '0')}11111111`.slice(0, 36), text: `質問 ${i}` }));
function response(value, status = 200) { return { ok: status >= 200 && status < 300, status, async json() { return value; } }; }

test('public list filters published and detail returns cards', async () => {
  const calls = [];
  const service = createSponsorService({ env, fetchImpl: async (url) => { calls.push(url); return response([{ id: '11111111-1111-4111-8111-111111111111', provider_name: '公式', title: 'Title', description: '', categories: ['friends'], audience: 'group', cards, card_count: 6, status: 'published', end_message: '', site_url: null, cta_label: '', is_r18: false, updated_at: '2026-01-01T00:00:00Z' }]); } });
  const list = await service.list(); const detail = await service.list({ id: '11111111-1111-4111-8111-111111111111' });
  assert.equal(list[0].cardCount, 6); assert.equal(list[0].cards, undefined); assert.equal(detail[0].cards.length, 6);
  assert.match(calls[0], /status=eq\.published/); assert.match(calls[1], /id=eq\./);
});

test('create validates 6..40 and sends stable cards without generated count', async () => {
  let sent;
  const service = createSponsorService({ env, fetchImpl: async (_url, options) => { sent = JSON.parse(options.body); return response([{ ...sent, card_count: sent.cards.length, updated_at: '' }]); } });
  const created = await service.create({ providerName: '提供元', title: 'Title', description: '', categories: ['work'], audience: 'group', cards, status: 'draft', endMessage: 'ありがとう', siteUrl: 'https://example.com/path', ctaLabel: '見る' });
  assert.equal(created.cardCount, 6); assert.equal(sent.card_count, undefined); assert.equal(sent.site_url, 'https://example.com/path');
  const forty = await service.create({ providerName: '提供元', title: 'Title', categories: ['work'], audience: 'group', cards: [...cards, ...Array.from({ length: 34 }, (_, i) => ({ text: `extra ${i}` }))], status: 'draft' }); assert.equal(forty.cardCount, 40);
  await service.create({ providerName: '提供元', title: 'Title', description: '一行目\r\n二行目', categories: ['work'], audience: 'group', cards, status: 'draft', endMessage: '終了\nメッセージ' }); assert.equal(sent.description, '一行目\n二行目'); assert.equal(sent.end_message, '終了\nメッセージ');
  await assert.rejects(() => service.create({ providerName: 'x', title: 'x', categories: ['work'], audience: 'group', cards: cards.slice(0, 5), status: 'draft' }), (error) => error.code === 'INVALID_CARD_COUNT');
  await assert.rejects(() => service.create({ providerName: 'x', title: 'x', categories: ['work'], audience: 'group', cards: [...cards, ...Array.from({ length: 35 }, (_, i) => ({ text: `extra ${i}` }))], status: 'draft' }), (error) => error.code === 'INVALID_CARD_COUNT');
  await assert.rejects(() => service.create({ providerName: 'x', title: 'x', categories: ['work'], audience: 'group', cards, status: 'draft', siteUrl: 'http://example.com' }), (error) => error.code === 'INVALID_REQUEST');
});

test('patch preserves card ids when cards are supplied and rejects invalid id', async () => {
  let sent;
  const service = createSponsorService({ env, fetchImpl: async (_url, options) => { sent = JSON.parse(options.body); return response([{ id: '11111111-1111-4111-8111-111111111111', provider_name: 'P', title: 'T', description: '', categories: ['friends'], audience: 'both', cards, card_count: 6, status: 'published', end_message: '', site_url: null, cta_label: '', is_r18: false, updated_at: '' }]); } });
  await service.update('11111111-1111-4111-8111-111111111111', { cards, status: 'published' });
  assert.deepEqual(sent.cards, cards); assert.equal(sent.status, 'published');
  await assert.rejects(() => service.update('bad', { status: 'draft' }), (error) => error.code === 'INVALID_REQUEST');
});

test('card IDs and text bounds are strict, and adult category cannot be cleared', async () => {
  let sent;
  const service = createSponsorService({ env, fetchImpl: async (_url, options) => { sent = JSON.parse(options.body); return response([{ id: '11111111-1111-4111-8111-111111111111', provider_name: 'P', title: 'T', description: '', categories: sent.categories || ['adult'], audience: 'both', cards, card_count: 6, status: 'published', end_message: '', site_url: null, cta_label: '', is_r18: sent.is_r18, updated_at: '' }]); } });
  await service.create({ providerName: 'P', title: 'T', categories: ['friends'], audience: 'group', cards, status: 'draft', isR18: true }); assert.equal(sent.is_r18, true);
  await service.update('11111111-1111-4111-8111-111111111111', { categories: ['friends'] }); assert.equal(sent.is_r18, undefined);
  await service.update('11111111-1111-4111-8111-111111111111', { categories: ['friends'], isR18: false }); assert.equal(sent.is_r18, false);
  await assert.rejects(() => service.create({ providerName: 'P', title: 'T', categories: ['friends'], audience: 'group', cards: [{ id: 'bad', text: 'x' }, ...cards.slice(1)], status: 'draft' }), (error) => error.code === 'INVALID_CARD_ID');
  await assert.rejects(() => service.create({ providerName: 'P', title: 'T', categories: ['friends'], audience: 'group', cards: [{ id: cards[0].id, text: 'x' }, ...cards], status: 'draft' }), (error) => error.code === 'DUPLICATE_CARD_ID');
  await assert.rejects(() => service.create({ providerName: 'P', title: 'T', categories: ['friends'], audience: 'group', cards: cards.map((card, i) => ({ ...card, text: i === 0 ? 'あ'.repeat(301) : card.text })), status: 'draft' }), (error) => error.code === 'INVALID_REQUEST');
});

function reply() { const result = {}; return { result, res: { writeHead(status, headers) { result.status = status; result.headers = headers; }, end(value) { result.body = JSON.parse(value); } } }; }
test('public route is GET-only and unknown UUID details are 404; admin rejects missing session', async () => {
  const handlers = createSponsorHandlers({ service: { async list({ id }) { return id ? [] : []; }, async create() {}, async update() {} } });
  let x = reply(); await handlers.publicList({ method: 'POST', url: '/api/sponsors', headers: {} }, x.res); assert.equal(x.result.status, 405);
  x = reply(); await handlers.publicList({ method: 'GET', url: '/api/sponsors?id=bad', headers: {} }, x.res); assert.equal(x.result.status, 400);
  x = reply(); await handlers.publicList({ method: 'GET', url: '/api/sponsors?id=11111111-1111-4111-8111-111111111111', headers: {} }, x.res); assert.equal(x.result.status, 404);
  x = reply(); await handlers.admin({ method: 'GET', url: '/api/admin/sponsors', headers: {} }, x.res); assert.equal(x.result.status, 401);
  x = reply(); await handlers.admin({ method: 'POST', url: '/api/admin/sponsors', headers: {} }, x.res); assert.equal(x.result.status, 401);
  x = reply(); await handlers.admin({ method: 'PATCH', url: '/api/admin/sponsors?id=11111111-1111-4111-8111-111111111111', headers: {} }, x.res); assert.equal(x.result.status, 401);
  x = reply(); await handlers.publicList({ method: 'GET', url: '/api/sponsors', headers: { origin: 'https://evil.example', host: 'mingle.cards' } }, x.res); assert.equal(x.result.status, 403);
});

test('public route returns published metadata and status changes remain service-backed', async () => {
  let state = { id: '11111111-1111-4111-8111-111111111111', providerName: 'Provider', title: 'Title', status: 'published' };
  const handlers = createSponsorHandlers({ service: { async list({ id }) { return state.status === 'published' ? (id ? [state] : [state]) : []; }, async update() { state = { ...state, status: 'draft' }; return state; }, async create() { return state; } } });
  let x = reply(); await handlers.publicList({ method: 'GET', url: '/api/sponsors', headers: {} }, x.res); assert.equal(x.result.status, 200); assert.equal(x.result.body.sets[0].status, 'published');
  state = { ...state, status: 'draft' }; x = reply(); await handlers.publicList({ method: 'GET', url: '/api/sponsors', headers: {} }, x.res); assert.equal(x.result.status, 200); assert.deepEqual(x.result.body.sets, []);
});

test('asset upload validates raster bytes and returns stable public asset URL', async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  let upload;
  const service = createSponsorService({ env, fetchImpl: async (url, options = {}) => { if (url.includes('/storage/v1/object/')) { upload = { url, options }; return response(null, 200); } return response([]); } });
  const result = await service.uploadAsset({ kind: 'thumbnail', imageData: `data:image/png;base64,${png.toString('base64')}` });
  assert.equal(result.kind, 'thumbnail'); assert.equal(result.width, 1); assert.equal(result.height, 1); assert.match(result.path, /^sponsor-assets\/[0-9a-f-]{36}\.png$/); assert.match(result.url, /\/storage\/v1\/object\/public\/sponsor-assets\//); assert.ok(Buffer.isBuffer(upload.options.body));
  await assert.rejects(() => service.uploadAsset({ kind: 'thumbnail', imageData: 'data:image/png;base64,AAAA' }), (error) => error.code === 'UNSUPPORTED_IMAGE');
  await assert.rejects(() => service.uploadAsset({ kind: 'thumbnail', imageData: `data:image/svg+xml;base64,${Buffer.from('<svg/>').toString('base64')}` }), (error) => error.code === 'INVALID_IMAGE');
});

test('set metadata preserves design and optional asset paths', async () => {
  let sent; let infoUrl;
  const service = createSponsorService({ env, fetchImpl: async (url, options) => { if (options.method === 'HEAD') { infoUrl = url; return response(null, 200); } sent = JSON.parse(options.body); return response([{ id: '11111111-1111-4111-8111-111111111111', provider_name: 'P', title: 'T', description: '', categories: ['friends'], audience: 'group', cards, card_count: 6, status: 'draft', end_message: '', site_url: null, cta_label: '', is_r18: false, design: sent.design, thumbnail_path: sent.thumbnail_path, card_front_path: sent.card_front_path, card_back_path: sent.card_back_path, updated_at: '' }]); } });
  const result = await service.create({ providerName: 'P', title: 'T', categories: ['friends'], audience: 'group', cards, status: 'draft', design: { version: 1, kind: 'preset', presetId: 'friends' }, thumbnailPath: 'sponsor-assets/11111111-1111-4111-8111-111111111111.webp', cardFrontPath: null, cardBackPath: null });
  assert.deepEqual(sent.design, { version: 1, kind: 'preset', presetId: 'friends' }); assert.match(sent.thumbnail_path, /^sponsor-assets\//); assert.equal(result.design.presetId, 'friends'); assert.equal(result.thumbnailUrl, 'https://sponsor.test.supabase.co/storage/v1/object/public/sponsor-assets/11111111-1111-4111-8111-111111111111.webp'); assert.match(infoUrl, /\/storage\/v1\/object\/info\/sponsor-assets\//);
  await assert.rejects(() => service.create({ providerName: 'P', title: 'T', categories: ['friends'], audience: 'group', cards, status: 'draft', thumbnailPath: 'https://evil.example/image.png' }), (error) => error.code === 'INVALID_ASSET_PATH');
  const missing = createSponsorService({ env, fetchImpl: async (_url, options) => options.method === 'HEAD' ? response(null, 404) : response([]) });
  await assert.rejects(() => missing.create({ providerName: 'P', title: 'T', categories: ['friends'], audience: 'group', cards, status: 'draft', thumbnailPath: 'sponsor-assets/11111111-1111-4111-8111-111111111111.webp' }), (error) => error.code === 'ASSET_NOT_FOUND');
});

test('real PNG and WebP fixtures pass upload validation', async () => {
  const calls = []; const service = createSponsorService({ env, fetchImpl: async (url) => { calls.push(url); return response(null, 200); } });
  const png = await readFile(new URL('../dist/assets/completion-feel-neutral-v4.png', import.meta.url));
  const webp = await readFile(new URL('../dist/assets/card-families/friends-front.webp', import.meta.url));
  const pngResult = await service.uploadAsset({ kind: 'thumbnail', imageData: `data:image/png;base64,${png.toString('base64')}` });
  const webpResult = await service.uploadAsset({ kind: 'cardFront', imageData: `data:image/webp;base64,${webp.toString('base64')}` });
  assert.ok(pngResult.width > 0 && pngResult.height > 0); assert.ok(webpResult.width > 0 && webpResult.height > 0); assert.equal(calls.length, 2);
});

test('real JPEG fixture passes upload validation', async () => {
  const jpeg = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9k=';
  const service = createSponsorService({ env, fetchImpl: async () => response(null, 200) });
  const result = await service.uploadAsset({ kind: 'cardBack', imageData: `data:image/jpeg;base64,${jpeg}` });
  assert.equal(result.width, 1); assert.equal(result.height, 1); assert.match(result.path, /\.jpg$/);
});

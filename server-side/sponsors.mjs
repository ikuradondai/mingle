import { randomUUID } from 'node:crypto';
import { accountConfig } from './accounts.mjs';
import { adminSession, bodyWithLimit, json, sameOrigin, verifySessionAsync } from './http.mjs';
import { normalizeCreatorDesign } from '../dist/creator-metadata.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CATEGORIES = new Set(['self', 'relationship', 'friends', 'family', 'work', 'sports', 'first-meeting', 'roleplay', 'adult', 'game', 'love', 'school']);
const AUDIENCES = new Set(['group', 'solo', 'both']);
const STATUSES = new Set(['draft', 'published']);
const SPONSOR_ASSET_BUCKET = 'sponsor-assets';
const SPONSOR_ASSET_MAX_BYTES = 3 * 1024 * 1024;
const SPONSOR_ASSET_MAX_DIMENSION = 4096;
const SPONSOR_ASSET_KINDS = new Set(['thumbnail', 'cardFront', 'cardBack']);
const IMAGE_FORMATS = Object.freeze({ png: { mime: 'image/png', ext: 'png' }, jpeg: { mime: 'image/jpeg', ext: 'jpg' }, webp: { mime: 'image/webp', ext: 'webp' } });
const fail = (status, code) => Object.assign(new Error(code), { status, code });
const text = (value, max, optional = false, multiline = false) => {
  if (optional && (value == null || value === '')) return '';
  if (typeof value !== 'string' || value.trim().length < 1 || Array.from(value.trim()).length > max || (multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u2028\u2029]/u : /[\u0000-\u001f\u007f\u2028\u2029]/u).test(value)) throw fail(400, 'INVALID_REQUEST');
  return multiline ? value.trim().replace(/\r\n?/g, '\n') : value.trim();
};
function imageInfo(buffer) {
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > SPONSOR_ASSET_MAX_BYTES) throw fail(413, 'IMAGE_TOO_LARGE');
  if (buffer.length >= 24 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && buffer.toString('ascii', 12, 16) === 'IHDR') {
    return { ...IMAGE_FORMATS.png, width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) { offset += 1; continue; }
      const marker = buffer[offset + 1]; offset += 2;
      if (marker === 0xd8 || marker === 0xd9) continue;
      if (offset + 2 > buffer.length) break;
      const length = buffer.readUInt16BE(offset); if (length < 2 || offset + length > buffer.length) break;
      if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
        return { ...IMAGE_FORMATS.jpeg, height: buffer.readUInt16BE(offset + 3), width: buffer.readUInt16BE(offset + 5) };
      }
      offset += length;
    }
  }
  if (buffer.length >= 30 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = buffer.toString('ascii', 12, 16);
    if (chunk === 'VP8X') return { ...IMAGE_FORMATS.webp, width: 1 + buffer.readUIntLE(24, 3), height: 1 + buffer.readUIntLE(27, 3) };
    if (chunk === 'VP8 ' && buffer.length >= 30 && buffer[23] === 0x9d && buffer[24] === 0x01 && buffer[25] === 0x2a) return { ...IMAGE_FORMATS.webp, width: buffer.readUInt16LE(26) & 0x3fff, height: buffer.readUInt16LE(28) & 0x3fff };
    if (chunk === 'VP8L' && buffer.length >= 25 && buffer[20] === 0x2f) return { ...IMAGE_FORMATS.webp, width: 1 + (((buffer[21] | (buffer[22] << 8)) & 0x3fff)), height: 1 + (((buffer[22] >> 6 | (buffer[23] << 2) | ((buffer[24] || 0) << 10)) & 0x3fff)) };
  }
  throw fail(415, 'UNSUPPORTED_IMAGE');
}
function imagePayload(value) {
  if (typeof value !== 'string') throw fail(400, 'INVALID_IMAGE');
  const match = value.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]*={0,2})$/u); if (!match) throw fail(400, 'INVALID_IMAGE');
  const encoded = match[2]; if (!encoded || encoded.length % 4 !== 0) throw fail(400, 'INVALID_IMAGE');
  const buffer = Buffer.from(encoded, 'base64'); if (buffer.toString('base64') !== encoded) throw fail(400, 'INVALID_IMAGE');
  const info = imageInfo(buffer); if (info.mime !== match[1] || !Number.isInteger(info.width) || !Number.isInteger(info.height) || info.width < 1 || info.height < 1 || info.width > SPONSOR_ASSET_MAX_DIMENSION || info.height > SPONSOR_ASSET_MAX_DIMENSION) throw fail(415, 'INVALID_IMAGE_DIMENSIONS');
  return { buffer, ...info };
}
function assetPath(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !/^sponsor-assets\/[0-9a-f-]{36}\.(?:png|jpg|webp)$/iu.test(value)) throw fail(400, 'INVALID_ASSET_PATH');
  return value;
}
function assetUrl(cfg, path) { return path && cfg?.url ? `${cfg.url}/storage/v1/object/public/${path}` : null; }
function httpsUrl(value) {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || value.length > 2048) throw fail(400, 'INVALID_REQUEST');
  let url; try { url = new URL(value); } catch { throw fail(400, 'INVALID_REQUEST'); }
  if (url.protocol !== 'https:' || url.username || url.password) throw fail(400, 'INVALID_REQUEST');
  return url.toString();
}
function cards(value) {
  if (!Array.isArray(value) || value.length < 6 || value.length > 40) throw fail(400, 'INVALID_CARD_COUNT');
  const result = value.map((card) => {
    if (!card || typeof card !== 'object') throw fail(400, 'INVALID_CARDS');
    if (Object.hasOwn(card, 'id') && (typeof card.id !== 'string' || !UUID.test(card.id))) throw fail(400, 'INVALID_CARD_ID');
    return { id: Object.hasOwn(card, 'id') ? card.id : randomUUID(), text: text(card.text, 300) };
  });
  if (new Set(result.map((card) => card.id)).size !== result.length) throw fail(400, 'DUPLICATE_CARD_ID');
  return result;
}
function categories(value) {
  if (!Array.isArray(value) || !value.length || value.length > 12 || value.some((x) => typeof x !== 'string' || !CATEGORIES.has(x))) throw fail(400, 'INVALID_CATEGORIES');
  return [...new Set(value)];
}
function meta(input, partial = false) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw fail(400, 'INVALID_REQUEST');
  const out = {};
  if (!partial || Object.hasOwn(input, 'providerName')) out.providerName = text(input.providerName, 80);
  if (!partial || Object.hasOwn(input, 'title')) out.title = text(input.title, 120);
  if (!partial || Object.hasOwn(input, 'description')) out.description = text(input.description, 500, true, true);
  if (!partial || Object.hasOwn(input, 'categories')) out.categories = categories(input.categories);
  if (!partial || Object.hasOwn(input, 'audience')) { if (!AUDIENCES.has(input.audience)) throw fail(400, 'INVALID_AUDIENCE'); out.audience = input.audience; }
  if (!partial || Object.hasOwn(input, 'endMessage')) out.endMessage = text(input.endMessage, 500, true, true);
  if (!partial || Object.hasOwn(input, 'siteUrl')) out.siteUrl = httpsUrl(input.siteUrl);
  if (!partial || Object.hasOwn(input, 'ctaLabel')) out.ctaLabel = text(input.ctaLabel, 40, true);
  if (!partial || Object.hasOwn(input, 'status')) { if (!STATUSES.has(input.status)) throw fail(400, 'INVALID_STATUS'); out.status = input.status; }
  if (!partial || Object.hasOwn(input, 'cards')) out.cards = cards(input.cards);
  if (!partial || Object.hasOwn(input, 'isR18')) { if (input.isR18 !== undefined && typeof input.isR18 !== 'boolean') throw fail(400, 'INVALID_R18'); out.isR18 = input.isR18 === true; }
  if (!partial || Object.hasOwn(input, 'design')) { try { out.design = normalizeCreatorDesign(input.design, { strict: input.design != null && input.design !== '' }); } catch { throw fail(400, 'INVALID_DESIGN'); } }
  for (const field of ['thumbnailPath', 'cardFrontPath', 'cardBackPath']) if (!partial || Object.hasOwn(input, field)) out[field] = assetPath(input[field]);
  return out;
}
function config(env = process.env) { return accountConfig(env); }
async function rest(cfg, path, options = {}, fetchImpl = fetch) {
  const response = await fetchImpl(`${cfg.url}${path}`, { ...options, headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.serviceKey}`, Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json', Prefer: 'return=representation' } : {}), ...options.headers } });
  let data = null; try { data = await response.json(); } catch {}
  if (!response.ok) throw fail(response.status === 404 ? 503 : 502, 'SPONSOR_STORE_UNAVAILABLE');
  return data;
}
function map(row, full = false, cfg = config()) {
  const value = { id: row.id, providerName: row.provider_name, title: row.title, description: row.description || '', categories: row.categories || [], audience: row.audience, cardCount: Number(row.card_count), status: row.status, endMessage: row.end_message || '', siteUrl: row.site_url || null, ctaLabel: row.cta_label || '', updatedAt: row.updated_at, isR18: Boolean(row.is_r18), design: normalizeCreatorDesign(row.design), thumbnailPath: row.thumbnail_path || null, cardFrontPath: row.card_front_path || null, cardBackPath: row.card_back_path || null };
  if (value.thumbnailPath) value.thumbnailUrl = assetUrl(cfg, value.thumbnailPath); if (value.cardFrontPath) value.cardFrontUrl = assetUrl(cfg, value.cardFrontPath); if (value.cardBackPath) value.cardBackUrl = assetUrl(cfg, value.cardBackPath);
  if (full) value.cards = Array.isArray(row.cards) ? row.cards.map((card) => ({ id: card.id, text: card.text })) : [];
  return value;
}
export function createSponsorService({ env = process.env, fetchImpl = fetch } = {}) {
  const cfg = config(env);
  async function list({ admin = false, id = '' } = {}) {
    if (!cfg?.serviceKey) throw fail(503, 'SPONSOR_STORE_UNAVAILABLE');
    if (id && !UUID.test(id)) throw fail(400, 'INVALID_REQUEST');
    const filter = id ? `&id=eq.${encodeURIComponent(id)}` : '';
    const rows = await rest(cfg, `/rest/v1/sponsor_sets?select=*&order=updated_at.desc${admin ? '' : '&status=eq.published'}${filter}`, {}, fetchImpl);
    return (Array.isArray(rows) ? rows : []).map((row) => map(row, admin || Boolean(id), cfg));
  }
  async function create(input) {
    if (!cfg?.serviceKey) throw fail(503, 'SPONSOR_STORE_UNAVAILABLE');
    const value = meta(input); await ensureAssetPaths(value); const now = new Date().toISOString();
    const row = { id: randomUUID(), provider_name: value.providerName, title: value.title, description: value.description, categories: value.categories, audience: value.audience, cards: value.cards, status: value.status, end_message: value.endMessage, site_url: value.siteUrl, cta_label: value.ctaLabel, is_r18: Boolean(value.isR18 || value.categories.includes('adult')), design: value.design, thumbnail_path: value.thumbnailPath, card_front_path: value.cardFrontPath, card_back_path: value.cardBackPath, created_by: 'admin', created_at: now, updated_at: now };
    const result = await rest(cfg, '/rest/v1/sponsor_sets', { method: 'POST', body: JSON.stringify(row) }, fetchImpl); return map(Array.isArray(result) ? result[0] : row, true, cfg);
  }
  async function update(id, input) {
    if (!UUID.test(id)) throw fail(400, 'INVALID_REQUEST'); if (!cfg?.serviceKey) throw fail(503, 'SPONSOR_STORE_UNAVAILABLE');
    const value = meta(input, true); if (value.cards && value.cards.length < 6) throw fail(400, 'INVALID_CARD_COUNT'); await ensureAssetPaths(value);
    if (value.categories?.includes('adult')) value.isR18 = true;
    if (Object.hasOwn(value, 'isR18')) value.is_r18 = value.isR18;
    delete value.isR18;
    value.updated_at = new Date().toISOString();
    const row = Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'cards' || Array.isArray(value.cards)).map(([key, val]) => [({ providerName: 'provider_name', description: 'description', categories: 'categories', audience: 'audience', endMessage: 'end_message', siteUrl: 'site_url', ctaLabel: 'cta_label', cards: 'cards', title: 'title', status: 'status', isR18: 'is_r18', design: 'design', thumbnailPath: 'thumbnail_path', cardFrontPath: 'card_front_path', cardBackPath: 'card_back_path', updated_at: 'updated_at' }[key] || key), val]));
    const result = await rest(cfg, `/rest/v1/sponsor_sets?id=eq.${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(row) }, fetchImpl); const item = Array.isArray(result) ? result[0] : null; if (!item) throw fail(404, 'NOT_FOUND'); return map(item, true, cfg);
  }
  async function uploadAsset(input) {
    if (!cfg?.serviceKey) throw fail(503, 'SPONSOR_STORE_UNAVAILABLE');
    if (!input || typeof input !== 'object' || !SPONSOR_ASSET_KINDS.has(input.kind)) throw fail(400, 'INVALID_IMAGE_KIND');
    const image = imagePayload(input.imageData); const path = `${SPONSOR_ASSET_BUCKET}/${randomUUID()}.${image.ext}`;
    const response = await fetchImpl(`${cfg.url}/storage/v1/object/${path}`, { method: 'POST', body: image.buffer, headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.serviceKey}`, 'Content-Type': image.mime, 'Cache-Control': 'public, max-age=31536000, immutable', 'x-upsert': 'false' } });
    if (!response.ok) throw fail(response.status === 409 ? 409 : 502, response.status === 409 ? 'ASSET_EXISTS' : 'SPONSOR_STORE_UNAVAILABLE');
    return { kind: input.kind, path, url: assetUrl(cfg, path), width: image.width, height: image.height, bytes: image.buffer.length };
  }
  async function ensureAssetPaths(value) {
    if (!cfg?.serviceKey) throw fail(503, 'SPONSOR_STORE_UNAVAILABLE');
    for (const path of [value.thumbnailPath, value.cardFrontPath, value.cardBackPath].filter(Boolean)) {
      const response = await fetchImpl(`${cfg.url}/storage/v1/object/info/${path}`, { method: 'HEAD', headers: { apikey: cfg.key, Authorization: `Bearer ${cfg.serviceKey}` } });
      if (!response.ok) throw fail(response.status === 404 ? 400 : 502, response.status === 404 ? 'ASSET_NOT_FOUND' : 'SPONSOR_STORE_UNAVAILABLE');
    }
  }
  return { list, create, update, uploadAsset };
}
export function createSponsorHandlers({ service = createSponsorService() } = {}) {
  const admin = async (req, res) => {
    if (!sameOrigin(req)) return json(res, 403, { error: 'forbidden' }); if (!await verifySessionAsync(adminSession(req))) return json(res, 401, { error: 'unauthorized' });
    try { const url = new URL(req.url || '/', 'http://localhost'); const id = url.searchParams.get('id') || ''; if (url.searchParams.get('asset') === '1') { if (req.method !== 'POST') return json(res, 405, { error: 'METHOD_NOT_ALLOWED' }); return json(res, 201, { asset: await service.uploadAsset(await bodyWithLimit(req, 4.5 * 1024 * 1024)) }); } if (req.method === 'GET') return json(res, 200, { sets: await service.list({ admin: true, id }) }); if (req.method === 'POST') return json(res, 201, { set: await service.create(await bodyWithLimit(req, 256 * 1024)) }); if (req.method === 'PATCH' && id) return json(res, 200, { set: await service.update(id, await bodyWithLimit(req, 256 * 1024)) }); return json(res, 405, { error: 'METHOD_NOT_ALLOWED' }); } catch (error) { return json(res, error.status || 502, { error: error.code || 'SPONSOR_ERROR' }); }
  };
  const publicList = async (req, res) => { if (!sameOrigin(req)) return json(res, 403, { error: 'forbidden' }); if (req.method !== 'GET') return json(res, 405, { error: 'METHOD_NOT_ALLOWED' }); try { const url = new URL(req.url || '/', 'http://localhost'); const id = url.searchParams.get('id') || ''; if (id && !UUID.test(id)) return json(res, 400, { error: 'INVALID_REQUEST' }); const sets = await service.list({ id }); if (id && !sets[0]) return json(res, 404, { error: 'NOT_FOUND' }); return json(res, 200, id ? { set: sets[0] } : { sets }); } catch (error) { return json(res, error.status || 502, { error: error.code || 'SPONSOR_ERROR' }); } };
  return { admin, publicList };
}

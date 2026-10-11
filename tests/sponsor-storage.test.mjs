import assert from 'node:assert/strict';
import test from 'node:test';
import { createSponsorSession } from '../dist/engine.js';
import { normalizeSponsorCards, normalizeSponsorMeta } from '../dist/sponsor.js';
import { loadSession, saveSession } from '../dist/session-storage.js';

const id = '22222222-2222-4222-8222-222222222222';
const cards = Array.from({ length: 6 }, (_, i) => ({ id: `22222222-2222-4222-8222-${String(i + 1).padStart(4, '0')}22222222`.slice(0, 36), text: `質問${i}`, r18: false }));
function storageWith(value = null) { const data = new Map(value ? [['mingle.cards.session.v1', JSON.stringify(value)]] : []); return { getItem: (key) => data.get(key) || null, setItem: (key, value) => data.set(key, value), removeItem: (key) => data.delete(key), data }; }
function session(overrides = {}) { const sponsor = { id, status: 'published', providerName: '提供元', title: 'T'.repeat(120), description: '説\n'.repeat(249) + '明明', categories: ['friends'], audience: 'both', cardCount: 6, endMessage: '終\n'.repeat(249) + '了了', siteUrl: 'https://example.com/path#ok', ctaLabel: '見る', isR18: false, updatedAt: '2026-01-01' }; const value = createSponsorSession({ sponsor, cards, participants: ['A', 'B'] }); return { ...value, ...overrides }; }

test('sponsor snapshot keeps 120/500 metadata, HTTPS URL, audience and validated cards', () => {
  const storage = storageWith(); const value = session(); assert.equal(saveSession(value, { storage, now: 1000 }), true); const restored = loadSession({ storage, now: 1001 }); assert.equal(restored.sponsor.title.length, 120); assert.equal(restored.sponsor.description.length, 500); assert.equal(restored.sponsor.endMessage.length, 500); assert.equal(restored.sponsor.audience, 'both'); assert.equal(restored.sponsor.siteUrl, 'https://example.com/path#ok'); assert.equal(restored.questions.length, 6);
});

test('malformed or unsafe sponsor storage is discarded', () => {
  const storage = storageWith(); const value = session(); assert.equal(saveSession(value, { storage, now: 1000 }), true); const raw = JSON.parse(storage.data.get('mingle.cards.session.v1')); raw.sponsor.siteUrl = 'javascript:alert(1)'; assert.equal(loadSession({ storage: storageWith(raw), now: 1001 }), null); const duplicate = JSON.parse(storage.data.get('mingle.cards.session.v1')); duplicate.sponsorCards[1].id = duplicate.sponsorCards[0].id; assert.equal(loadSession({ storage: storageWith(duplicate), now: 1001 }), null); const invalidId = JSON.parse(storage.data.get('mingle.cards.session.v1')); invalidId.sponsorCards[0].id = 'bad'; assert.equal(loadSession({ storage: storageWith(invalidId), now: 1001 }), null); assert.equal(storageWith().data.size, 0);
});

test('API-shaped cards without r18 flow through normalizer, engine and storage', () => {
  const rawMeta = { id, status: 'published', providerName: '提供元', title: 'API', description: '', categories: ['friends'], audience: 'group', cardCount: 6, isR18: false };
  const rawCards = cards.map(({ id: cardId, text }) => ({ id: cardId, text }));
  const sponsor = normalizeSponsorMeta(rawMeta); const normalized = normalizeSponsorCards({ ...rawMeta, cards: rawCards }); const value = createSponsorSession({ sponsor, cards: normalized, participants: ['A', 'B'] }); const storage = storageWith(); assert.equal(saveSession(value, { storage, now: 1000 }), true); assert.equal(loadSession({ storage, now: 1001 }).questions.length, 6);
});

test('sponsor asset metadata accepts only validated bucket paths and creator presets', () => {
  const path = 'sponsor-assets/33333333-3333-4333-8333-333333333333.webp';
  const value = normalizeSponsorMeta({ id, status: 'published', providerName: '提供元', title: '画像', description: '', categories: ['friends'], audience: 'group', cardCount: 6, isR18: false, design: { version: 1, kind: 'preset', presetId: 'friends' }, thumbnailPath: path, thumbnailUrl: `https://storage.example/storage/v1/object/public/${path}` });
  assert.equal(value.design.presetId, 'friends'); assert.equal(value.thumbnailPath, path); assert.match(value.thumbnailUrl, /storage\/v1\/object\/public/);
  const unsafe = normalizeSponsorMeta({ id, status: 'published', providerName: '提供元', title: '画像', description: '', categories: ['friends'], audience: 'group', cardCount: 6, isR18: false, thumbnailPath: 'https://evil.example/a.png', thumbnailUrl: 'https://evil.example/a.png' });
  assert.equal(unsafe.thumbnailPath, null); assert.equal(unsafe.thumbnailUrl, null);
  const queryUrl = normalizeSponsorMeta({ id, status: 'published', providerName: '提供元', title: '画像', description: '', categories: ['friends'], audience: 'group', cardCount: 6, isR18: false, thumbnailPath: path, thumbnailUrl: `https://storage.example/storage/v1/object/public/${path}?x=%22` });
  assert.equal(queryUrl.thumbnailUrl, null);
});

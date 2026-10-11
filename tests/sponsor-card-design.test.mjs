import test from 'node:test';
import assert from 'node:assert/strict';
import { cardDesignForSession } from '../dist/card-design.js';
import { createSponsorSession } from '../dist/engine.js';
import { normalizeSponsorCards, normalizeSponsorMeta } from '../dist/sponsor.js';
import { loadSession, saveSession } from '../dist/session-storage.js';

const sponsorId = '11111111-1111-4111-8111-111111111111';
const assetBase = 'https://storage.example/storage/v1/object/public/sponsor-assets/';
const paths = {
  thumbnail: 'sponsor-assets/33333333-3333-4333-8333-333333333331.webp',
  front: 'sponsor-assets/33333333-3333-4333-8333-333333333332.webp',
  back: 'sponsor-assets/33333333-3333-4333-8333-333333333333.webp',
};
const imageUrls = {
  thumbnail: `${assetBase}33333333-3333-4333-8333-333333333331.webp`,
  front: `${assetBase}33333333-3333-4333-8333-333333333332.webp`,
  back: `${assetBase}33333333-3333-4333-8333-333333333333.webp`,
};
const cardIds = [
  '22222222-2222-4222-8222-222222222220', '22222222-2222-4222-8222-222222222221',
  '22222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222223',
  '22222222-2222-4222-8222-222222222224', '22222222-2222-4222-8222-222222222225',
];
function storageWith(value = null) {
  const data = new Map(value ? [['mingle.cards.session.v1', JSON.stringify(value)]] : []);
  return { getItem: (key) => data.get(key) || null, setItem: (key, next) => data.set(key, next), removeItem: (key) => data.delete(key) };
}

test('sponsor session selects the existing family art from its category', () => {
  const design = cardDesignForSession({ sponsorSet: true, sponsor: { id: '11111111-1111-4111-8111-111111111111', categories: ['work'] }, mode: 'group' });
  assert.equal(design.family, 'work');
  assert.match(design.front, /card-families\/work-front/);
  assert.match(design.back, /card-families\/work-back/);
});

test('sponsor preset wins over category and uploaded faces win over preset faces', () => {
  const design = cardDesignForSession({ sponsorSet: true, sponsor: { id: sponsorId, categories: ['work'], design: { version: 1, kind: 'preset', presetId: 'friends' }, thumbnailUrl: imageUrls.thumbnail, cardFrontUrl: imageUrls.front, cardBackUrl: imageUrls.back }, mode: 'group' });
  assert.equal(design.family, 'friends');
  assert.equal(design.thumbnail, imageUrls.thumbnail);
  assert.equal(design.front, imageUrls.front);
  assert.equal(design.back, imageUrls.back);
  assert.equal(design.sponsorCustomFront, true);
  assert.equal(design.sponsorCustomBack, true);
});

test('normalized sponsor metadata survives session save/load and card design resolution', () => {
  const raw = { id: sponsorId, providerName: '提供元', title: 'セット', description: '友人向け', categories: ['work'], audience: 'group', cardCount: 6, status: 'published', isR18: false, design: { version: 1, kind: 'preset', presetId: 'work-future' }, thumbnailPath: paths.thumbnail, thumbnailUrl: imageUrls.thumbnail, cardFrontPath: paths.front, cardFrontUrl: imageUrls.front, cardBackPath: paths.back, cardBackUrl: imageUrls.back };
  const sponsor = normalizeSponsorMeta(raw);
  const cards = normalizeSponsorCards({ ...raw, cards: cardIds.map((id, index) => ({ id, text: `質問${index + 1}` })) });
  const session = createSponsorSession({ mode: 'group', participants: ['A', 'B'], sponsor, cards, random: () => .5 });
  const storage = storageWith();
  assert.equal(saveSession(session, { storage, now: 1000 }), true);
  const restored = loadSession({ storage, now: 1001 });
  assert.equal(restored.sponsor.cardFrontUrl, imageUrls.front);
  assert.equal(restored.sponsor.cardBackUrl, imageUrls.back);
  const design = cardDesignForSession(restored);
  assert.equal(design.thumbnail, imageUrls.thumbnail);
  assert.equal(design.front, imageUrls.front);
  assert.equal(design.back, imageUrls.back);
});

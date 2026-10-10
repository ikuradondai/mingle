import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSponsorMeta, normalizeSponsorCards, shuffleSponsors } from '../dist/sponsor.js';
import { createSponsorSession } from '../dist/engine.js';
import { saveSession, loadSession } from '../dist/session-storage.js';

const id = '11111111-1111-4111-8111-111111111111';
const meta = { id, status: 'published', providerName: '公式提供者', title: '友人との時間', description: '友人向けの6枚', categories: ['friends'], audience: 'group', cardCount: 6, isR18: false };
const cards = Array.from({ length: 6 }, (_, index) => ({ id: `11111111-1111-4111-8111-${String(index + 1).padStart(4, '0')}11111111`.slice(0, 36), text: `質問${index}`, r18: false }));

test('sponsor metadata and cards are strict and normalize the public contract', () => {
  const value = normalizeSponsorMeta(meta);
  assert.equal(value.status, 'published');
  assert.equal(normalizeSponsorCards({ ...meta, cards }).length, 6);
  assert.equal(normalizeSponsorCards({ ...meta, cards: cards.map(({ id, text }) => ({ id, text })) })[0].r18, false);
  assert.equal(normalizeSponsorMeta({ ...meta, siteUrl: 'javascript:alert(1)' }), null);
  assert.throws(() => normalizeSponsorCards({ ...meta, cards: [...cards, { ...cards[0] }] }));
});

test('sponsor shuffle is deterministic when injected and direct sessions retain an isolated snapshot', () => {
  const sponsor = normalizeSponsorMeta(meta);
  const order = shuffleSponsors([{ id: 'a' }, { id: 'b' }, { id: 'c' }], () => 0.1).map((item) => item.id);
  assert.deepEqual(order, ['b', 'c', 'a']);
  const session = createSponsorSession({ sponsor, cards, participants: ['A', 'B'], random: () => 0.2 });
  assert.equal(session.sponsorSet, true);
  assert.equal(session.deckId, `sponsor-${id}`);
  const storage = new Map(); const adapter = { getItem: (key) => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) };
  assert.equal(saveSession(session, { storage: adapter, now: 1000 }), true);
  const restored = loadSession({ storage: adapter, now: 1001 });
  assert.equal(restored.sponsorSet, true);
  assert.equal(restored.sponsor.id, id);
  assert.deepEqual(restored.questions.map((card) => card.id).sort(), cards.map((card) => card.id).sort());
});

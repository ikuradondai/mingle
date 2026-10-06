import test from 'node:test';
import assert from 'node:assert/strict';
import { CREATOR_PRESETS, CREATOR_PRESET_IDS, effectiveCreatorAdult, normalizeCreatorDesign } from '../dist/creator-metadata.js';
import { createSavedSession, createSharedSession } from '../dist/engine.js';

test('creator preset registry is finite and maps each preset to existing family art', () => {
  assert.equal(CREATOR_PRESET_IDS.length, 8);
  for (const id of CREATOR_PRESET_IDS) {
    assert.equal(CREATOR_PRESETS[id].front.startsWith('/assets/card-families/'), true);
    assert.equal(CREATOR_PRESETS[id].back.startsWith('/assets/card-families/'), true);
  }
});

test('effective R18 is explicit theme flag OR any child question and cannot be downgraded by false', () => {
  assert.equal(effectiveCreatorAdult(false, [{ r18: false }]), false);
  assert.equal(effectiveCreatorAdult(false, [{ r18: true }]), true);
  assert.equal(effectiveCreatorAdult(true, [{ r18: false }]), true);
});

test('design descriptors normalize legacy and reject unknown presets', () => {
  assert.deepEqual(normalizeCreatorDesign({ version: 1, kind: 'preset', presetId: 'friends' }), { version: 1, kind: 'preset', presetId: 'friends' });
  assert.equal(normalizeCreatorDesign(null), null);
  assert.equal(normalizeCreatorDesign({ version: 1, kind: 'preset', presetId: 'https://evil.invalid/card.png' }), null);
  assert.throws(() => normalizeCreatorDesign({ version: 1, kind: 'preset', presetId: 'unknown' }, { strict: true }), /INVALID_DESIGN/);
});

test('saved and shared sessions retain design and effective R18 metadata', () => {
  const cards = Array.from({ length: 6 }, (_, index) => ({ id: `custom:11111111-1111-4111-8111-11111111111${index}`, text: `質問${index}`, r18: index === 0 }));
  const saved = createSavedSession({ mode: 'group', participants: ['いくら', 'あおい'], cardIds: cards.map((card) => card.id), customCards: cards, ownerUserId: '11111111-1111-4111-8111-111111111111', setId: '11111111-1111-4111-8111-111111111112', adultConfirmed: true, design: { version: 1, kind: 'preset', presetId: 'friends' } });
  assert.equal(saved.includeR18, true);
  assert.deepEqual(saved.design, { version: 1, kind: 'preset', presetId: 'friends' });
  const shared = createSharedSession({ participants: ['いくら', 'あおい'], cards, adultConfirmed: true, r18: false, design: { version: 1, kind: 'preset', presetId: 'sports' } });
  assert.equal(shared.includeR18, true);
  assert.deepEqual(shared.design, { version: 1, kind: 'preset', presetId: 'sports' });
});

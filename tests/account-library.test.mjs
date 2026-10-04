import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalCard, renderLibrary } from '../dist/account-library.js';

const custom = [{ id: '11111111-1111-4111-8111-111111111111', text: '<質問>', r18: false, origin: 'user' }];

test('library escapes set metadata and keeps ready set actions', () => {
  const html = renderLibrary({ sets: [{ id: 'set-1', name: '<private>', card_ids: ['unknown'] }] });
  assert.match(html, /&lt;private&gt;/);
  assert.match(html, /data-action="studio-edit-set"/);
  assert.match(html, /data-action="set-delete"/);
  assert.match(html, /data-action="set-share"/);
});

test('unknown favorite IDs are omitted from picker and favorites management', () => {
  assert.doesNotMatch(renderLibrary({ studioMode: 'picker', favorites: new Set(['missing']) }), /missing/);
  assert.doesNotMatch(renderLibrary({ studioMode: 'favorites', favorites: new Set(['missing']) }), /missing/);
});

test('editor uses studioItems as its only source and keeps selectedCards out of the editor', () => {
  const html = renderLibrary({ studioMode: 'editor', setName: '自分のセット', selectedCards: new Set(['missing']), studioItems: [{ kind: 'custom', text: '<script>質問</script>', r18: false, origin: 'ai' }] });
  assert.match(html, /&lt;script&gt;質問&lt;\/script&gt;/);
  assert.match(html, /data-studio-item-text/);
  assert.match(html, /data-action="studio-remove-item"/);
  assert.match(html, /data-action="studio-replace-item"/);
  assert.doesNotMatch(html, /missing/);
});

test('editor exposes draft and ready save labels with the 80/300 limits', () => {
  const draft = renderLibrary({ studioMode: 'editor', setName: '下書き', studioItems: [{ kind: 'custom', text: '質問', r18: false, origin: 'user' }] });
  assert.match(draft, /下書きを保存/);
  assert.match(draft, /maxlength="80"/);
  assert.match(draft, /maxlength="300"/);
  const ready = renderLibrary({ studioMode: 'editor', setName: 'ready', studioItems: Array.from({ length: 6 }, (_, i) => ({ kind: 'custom', text: `質問${i}`, r18: false, origin: 'user' })) });
  assert.match(ready, /セットを保存/);
});

test('picker is limited to favorites and own custom cards and has a completion action', () => {
  const html = renderLibrary({ studioMode: 'picker', favorites: new Set(), customCards: custom, selectedCards: new Set(['custom:11111111-1111-4111-8111-111111111111']) });
  assert.match(html, /data-select-card/);
  assert.match(html, /data-action="studio-back"/);
  assert.match(html, /&lt;質問&gt;/);
  assert.doesNotMatch(html, /既製カード/);
});

test('AI preview edits are constrained and can be adopted or discarded', () => {
  const html = renderLibrary({ studioMode: 'ai', aiGenerationAvailable: true, aiQuestions: [{ text: 'AIの質問', r18: false, selected: true }] });
  assert.match(html, /data-ai-theme/);
  assert.match(html, /data-ai-text/);
  assert.match(html, /data-action="studio-ai-adopt"/);
  assert.match(html, /data-action="studio-ai-discard"/);
  assert.match(html, /maxlength="300"/);
});

test('custom card management keeps its dedicated editor view', () => {
  const html = renderLibrary({ studioMode: 'custom', customEditorOpen: true, customDraft: '自分の質問', customDraftR18: false });
  assert.match(html, /data-form="custom-card"/);
  assert.match(html, /data-custom-text/);
  assert.match(html, /maxlength="300"/);
  assert.doesNotMatch(html, /data-form="studio"/);
});

test('completion unavailable still offers draft save', () => {
  const html = renderLibrary({ studioMode: 'editor', setName: '保留', completionAvailable: false, draftsAvailable: true, studioItems: Array.from({ length: 6 }, (_, i) => ({ kind: 'custom', text: `質問${i}`, r18: false, origin: 'user' })) });
  assert.match(html, /下書きを保存/);
  assert.match(html, /現在セットを保存できません/);
});

test('canonicalCard normalizes custom ids', () => {
  assert.equal(canonicalCard('custom:11111111-1111-4111-8111-111111111111', custom).text, '<質問>');
});

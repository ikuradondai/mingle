import test from 'node:test';
import assert from 'node:assert/strict';
import { renderLibrary } from '../dist/account-library.js';
test('library escapes set metadata and exposes private actions', () => { const html = renderLibrary({ sets: [{ id: 'set-1', name: '<private>', card_ids: [] }] }); assert.match(html, /&lt;private&gt;/); assert.match(html, /data-action="set-play"/); });
test('library omits unknown favorite IDs', () => { assert.doesNotMatch(renderLibrary({ favorites: new Set(['missing']) }), /missing/); });

test('library renders custom cards escaped, hides R18 text, and enables set creation from custom cards', () => {
  const html = renderLibrary({ customCards: [{ id: '11111111-1111-4111-8111-111111111111', text: '<script>質問</script>', r18: false }, { id: '22222222-2222-4222-8222-222222222222', text: '大人の質問', r18: true }] });
  assert.match(html, /質問カードを作る/); assert.match(html, /data-action="custom-card-edit"/); assert.match(html, /&lt;script&gt;質問&lt;\/script&gt;/); assert.match(html, /R18の質問/); assert.doesNotMatch(html, /大人の質問/); assert.doesNotMatch(html, /data-action="set-new" disabled/);
});
test('custom editor permits fewer than six cards but keeps save disabled until six selections', () => {
  const html = renderLibrary({ customEditorOpen: true, customDraft: '自作', customCards: [{ id: '11111111-1111-4111-8111-111111111111', text: '自作', r18: false }] });
  assert.match(html, /data-form="custom-card"/); assert.match(html, /data-action="set-new"/); assert.match(html, /新しいセット/);
});

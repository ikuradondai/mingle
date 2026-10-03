import test from 'node:test';
import assert from 'node:assert/strict';
import { renderLibrary } from '../dist/account-library.js';
test('library escapes set metadata and exposes private actions', () => { const html = renderLibrary({ sets: [{ id: 'set-1', name: '<private>', card_ids: [] }] }); assert.match(html, /&lt;private&gt;/); assert.match(html, /data-action="set-play"/); });
test('library omits unknown favorite IDs', () => { assert.doesNotMatch(renderLibrary({ favorites: new Set(['missing']) }), /missing/); });

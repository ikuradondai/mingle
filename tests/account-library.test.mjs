import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalCard, renderLibrary } from '../dist/account-library.js';
import { decks } from '../dist/data/decks.js';

const custom = [{ id: '11111111-1111-4111-8111-111111111111', text: '<質問>', r18: false, origin: 'user' }];
const guestAccount = { enabled: true, authReady: true, user: null };
const memberAccount = { enabled: true, authReady: true, user: { id: 'member-1' } };
const confirmedAccount = { enabled: true, authReady: true, user: { id: 'member-1' }, ageConfirmedAt: '2026-10-05T09:12:00.000Z' };

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

test('AI creation keeps the R18 option off by default and preserves an explicit choice', () => {
  const safe = renderLibrary({ ...confirmedAccount, studioMode: 'ai', aiGenerationAvailable: true, aiR18: false });
  assert.match(safe, /data-ai-r18/);
  assert.doesNotMatch(safe, /data-ai-r18[^>]+checked/);
  const adult = renderLibrary({ ...confirmedAccount, studioMode: 'ai', aiGenerationAvailable: true, aiR18: true });
  assert.match(adult, /data-ai-r18[^>]+checked/);
  assert.match(adult, /R18の話題を含める/);
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

const intimacy = decks.find((deck) => deck.id === 'intimacy');
const adultCard = intimacy.questions[0];
const adultCustom = [{ id: '22222222-2222-4222-8222-222222222222', text: '内緒のR18質問', r18: true, origin: 'user' }, ...custom];
const adultCustomId = 'custom:22222222-2222-4222-8222-222222222222';
const HIDDEN = 'R18の質問（年齢確認後に表示）';

test('unconfirmed accounts see no R18 switches in custom card, AI, or editor views', () => {
  assert.doesNotMatch(renderLibrary({ studioMode: 'ai', aiGenerationAvailable: true, aiR18: true }), /data-ai-r18|R18の話題を含める/);
  assert.doesNotMatch(renderLibrary({ studioMode: 'custom', customEditorOpen: true, customDraft: '自分の質問', customDraftR18: true }), /data-custom-r18|R18の話題にする/);
  assert.doesNotMatch(renderLibrary({ studioMode: 'editor', setName: 'x', customCards: adultCustom, studioItems: [{ kind: 'saved', cardId: adultCustomId }], revealAdult: true }), /data-library-adult/);
  assert.doesNotMatch(renderLibrary({ ...guestAccount, studioMode: 'ai', aiGenerationAvailable: true }), /data-ai-r18/);
  assert.doesNotMatch(renderLibrary({ ...memberAccount, studioMode: 'ai', aiGenerationAvailable: true }), /data-ai-r18/);
});

test('confirmed accounts keep the R18 switches and consent exactly as before', () => {
  assert.match(renderLibrary({ ...confirmedAccount, studioMode: 'ai', aiGenerationAvailable: true }), /data-ai-r18/);
  assert.match(renderLibrary({ ...confirmedAccount, studioMode: 'custom', customEditorOpen: true }), /data-custom-r18/);
  assert.match(renderLibrary({ ...confirmedAccount, studioMode: 'editor', setName: 'x', customCards: adultCustom, studioItems: [{ kind: 'saved', cardId: adultCustomId }] }), /data-library-adult/);
});

test('R18 card text is replaced with the age-gate placeholder for unconfirmed accounts only', () => {
  const favorites = new Set([adultCard.id, adultCustomId]);
  for (const account of [memberAccount, guestAccount, { ...memberAccount, revealAdult: true }]) {
    const html = renderLibrary({ ...account, studioMode: 'favorites', favorites, customCards: adultCustom });
    assert.match(html, new RegExp(HIDDEN));
    assert.doesNotMatch(html, new RegExp(adultCard.text));
    assert.doesNotMatch(html, /内緒のR18質問/);
    const library = renderLibrary({ ...account, studioMode: 'custom', customCards: adultCustom });
    assert.match(library, new RegExp(HIDDEN));
    assert.doesNotMatch(library, /内緒のR18質問/);
    assert.match(library, /data-action="custom-card-delete"/);
  }
  const revealed = renderLibrary({ ...confirmedAccount, revealAdult: true, studioMode: 'favorites', favorites, customCards: adultCustom });
  assert.match(revealed, new RegExp(adultCard.text));
  assert.match(revealed, /内緒のR18質問/);
  const masked = renderLibrary({ ...confirmedAccount, studioMode: 'favorites', favorites, customCards: adultCustom });
  assert.match(masked, /R18の質問/);
  assert.doesNotMatch(masked, new RegExp(adultCard.text));
});

test('R18 cards are left out of the picker for unconfirmed accounts', () => {
  const favorites = new Set([adultCard.id, adultCustomId, custom[0].id.startsWith('custom:') ? custom[0].id : `custom:${custom[0].id}`]);
  const hidden = renderLibrary({ ...memberAccount, studioMode: 'picker', favorites, customCards: adultCustom });
  assert.doesNotMatch(hidden, new RegExp(adultCard.id));
  assert.doesNotMatch(hidden, new RegExp(adultCustomId));
  assert.match(hidden, /&lt;質問&gt;/);
  const shown = renderLibrary({ ...confirmedAccount, studioMode: 'picker', favorites, customCards: adultCustom });
  assert.match(shown, new RegExp(adultCard.id));
  assert.match(shown, new RegExp(adultCustomId));
});

test('R18 sets cannot be played or shared before age confirmation but can still be edited and deleted', () => {
  const sets = [{ id: 'set-r18', name: '大人のセット', card_ids: [adultCard.id, ...intimacy.questions.slice(1, 6).map((card) => card.id)] }, { id: 'set-plain', name: '普通のセット', card_ids: decks.find((deck) => deck.id === 'friends').questions.slice(0, 6).map((card) => card.id) }];
  const row = (html, id) => html.split('<article').find((chunk) => chunk.includes(`data-set-id="${id}"`));
  const locked = renderLibrary({ ...memberAccount, sets });
  const r18Row = row(locked, 'set-r18');
  assert.match(r18Row, /R18を含む · 年齢確認後に遊べます/);
  assert.match(r18Row, /data-action="set-play"[^>]*disabled/);
  assert.match(r18Row, /data-action="set-share"[^>]*disabled/);
  assert.match(r18Row, /data-action="studio-edit-set"(?![^>]*disabled)/);
  assert.match(r18Row, /data-action="set-delete"(?![^>]*disabled)/);
  const plainRow = row(locked, 'set-plain');
  assert.doesNotMatch(plainRow, /disabled/);
  assert.doesNotMatch(plainRow, /年齢確認後/);
  const open = renderLibrary({ ...confirmedAccount, sets });
  assert.doesNotMatch(row(open, 'set-r18'), /disabled|年齢確認後/);
});

test('R18 custom cards cannot be opened for editing before age confirmation', () => {
  const html = renderLibrary({ ...memberAccount, studioMode: 'custom', customCards: adultCustom });
  const rows = html.split('<article').filter((chunk) => chunk.includes('custom-card-edit'));
  assert.equal(rows.length, 2);
  assert.match(rows.find((chunk) => chunk.includes(adultCustomId)), /custom-card-edit"[^>]*disabled/);
  assert.doesNotMatch(rows.find((chunk) => !chunk.includes(adultCustomId)), /disabled/);
});

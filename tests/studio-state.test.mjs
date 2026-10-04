import test from 'node:test';
import assert from 'node:assert/strict';
import { resetStudioEntryState } from '../dist/studio-state.js';

function aiState() {
  return {
    studioRequestId: 7,
    studioMode: 'ai',
    studioAiReturnMode: 'editor',
    studioReplaceIndex: 2,
    customEditorOpen: true,
    busy: true,
    error: 'old error',
    aiName: '入力中のセット名',
    aiTheme: '入力中のテーマ',
    aiTone: '入力中の雰囲気',
    aiQuestions: [{ text: '未承認のAI候補', selected: true }],
    studioItems: [{ kind: 'custom', text: '編集中の質問' }],
    editingDraftId: 'draft-1',
    editingSetId: 'set-1',
  };
}

test('reopening the library returns to the list without discarding the in-progress AI state', () => {
  const account = aiState();
  resetStudioEntryState(account); // header back to the account menu
  assert.equal(account.studioMode, 'list');
  assert.equal(account.studioAiReturnMode, 'list');
  assert.equal(account.studioReplaceIndex, null);
  assert.equal(account.customEditorOpen, false);
  assert.equal(account.busy, false);
  assert.equal(account.error, '');
  assert.equal(account.aiTheme, '入力中のテーマ');
  assert.deepEqual(account.aiQuestions, [{ text: '未承認のAI候補', selected: true }]);
  assert.deepEqual(account.studioItems, [{ kind: 'custom', text: '編集中の質問' }]);

  resetStudioEntryState(account); // account menu -> library open again
  assert.equal(account.studioMode, 'list');
  assert.equal(account.aiName, '入力中のセット名');
  assert.equal(account.editingDraftId, 'draft-1');
  assert.equal(account.studioRequestId, 8);
});

test('entry reset leaves non-AI saves busy and does not invalidate their request', () => {
  const account = { studioRequestId: 4, studioMode: 'editor', busy: true, customEditorOpen: true, error: 'saving' };
  resetStudioEntryState(account);
  assert.equal(account.studioRequestId, 4);
  assert.equal(account.busy, true);
  assert.equal(account.studioMode, 'list');
});

test('resetting an in-flight AI view invalidates its stale completion', () => {
  const account = aiState();
  const requestId = account.studioRequestId;
  resetStudioEntryState(account);
  assert.notEqual(account.studioRequestId, requestId);
  assert.equal(requestId === account.studioRequestId, false);
  assert.equal(account.busy, false);
});

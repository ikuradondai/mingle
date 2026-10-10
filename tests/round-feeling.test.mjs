import test from 'node:test';
import assert from 'node:assert/strict';
import { completionFeelingChoices, completionFeelingFor, completionFeelingKey } from '../dist/round-feeling.js';

test('group and solo choices are allowlisted and prototype keys are rejected', () => {
  assert.equal(completionFeelingChoices(false).length, 4);
  assert.equal(completionFeelingChoices(true).length, 4);
  assert.equal(completionFeelingFor(false, 'newPerspective')?.label, '新しい一面');
  assert.equal(completionFeelingFor(true, 'felt')?.label, '気持ちが見えた');
  assert.equal(completionFeelingFor(false, '__proto__'), null);
  assert.equal(completionFeelingFor(false, 'toString'), null);
  assert.equal(completionFeelingFor(false, 'felt'), null);
  assert.equal(completionFeelingFor(true, 'newPerspective'), null);
});

test('feeling keys match roundCompletionInfo across full and final rounds', () => {
  const base = { sessionId: 's', questions: Array(40) };
  assert.equal(completionFeelingKey({ ...base, cursor: 6, roundStart: 0 }), 's:0:6');
  assert.equal(completionFeelingKey({ ...base, cursor: 12, roundStart: 6 }), 's:6:12');
  assert.equal(completionFeelingKey({ ...base, cursor: 40, roundStart: 36 }), 's:36:40');
  assert.notEqual(completionFeelingKey({ ...base, cursor: 6, roundStart: 0 }), completionFeelingKey({ ...base, cursor: 12, roundStart: 6 }));
  assert.notEqual(completionFeelingKey({ ...base, cursor: 12, roundStart: 6 }), completionFeelingKey({ ...base, cursor: 40, roundStart: 36 }));
});

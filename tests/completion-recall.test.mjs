import test from 'node:test';
import assert from 'node:assert/strict';
import { completionRecallKey, completionRecallCandidates, chooseRecallEntry } from '../dist/completion-recall.js';

test('recall key stays stable while the six-card round advances and changes after continue', () => {
  assert.equal(completionRecallKey({ sessionId: 's', roundStart: 0, cursor: 6 }), 's:0');
  assert.equal(completionRecallKey({ sessionId: 's', roundStart: 0, cursor: 3 }), 's:0');
  assert.notEqual(completionRecallKey({ sessionId: 's', roundStart: 6, cursor: 9 }), 's:0');
});

test('recall candidates keep same-card answers from different participants and deduplicate exact pairs', () => {
  const entries = completionRecallCandidates([
    { cardId: 'q1', participantIndex: 0, name: 'A', text: 'x' },
    { cardId: 'q1', participantIndex: 0, name: 'A', text: 'x' },
    { cardId: 'q1', participantIndex: 1, name: 'B', text: 'x' },
    { cardId: 'q2', participantIndex: 1, name: 'B', text: 'y' },
  ]);
  assert.equal(entries.length, 3);
  assert.equal(entries.filter((entry) => entry.cardId === 'q1').length, 2);
});

test('choosing another recall entry excludes the current card and participant pair', () => {
  const entries = [{ cardId: 'q1', participantIndex: 0 }, { cardId: 'q1', participantIndex: 1 }, { cardId: 'q2', participantIndex: 0 }];
  assert.deepEqual(chooseRecallEntry(entries, entries[0], () => 0), entries[1]);
  assert.equal(chooseRecallEntry(entries, { cardId: 'q1', participantIndex: 0 }, () => 0.99).cardId, 'q2');
  assert.equal(chooseRecallEntry(entries, { cardId: 'q1', participantIndex: 0 }, () => 0.99).participantIndex, 0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { completionReplyContext, completionReplyKey, completionReplyCopy } from '../dist/completion-reply.js';

const session = (overrides = {}) => ({ sessionId: 's1', roundStart: 0, cursor: 6, participants: ['A', 'B'], ...overrides });

test('reply context keeps explicit safety precedence', () => {
  assert.equal(completionReplyContext(session({ mode: 'solo', deckId: 'founders' })), 'solo');
  assert.equal(completionReplyContext(session({ businessSession: true, deckId: 'date' })), 'business');
  assert.equal(completionReplyContext(session({ businessSession: true, count: 1, participants: ['A'] })), 'solo');
  assert.equal(completionReplyContext(session({ participants: ['A', 'B'], count: 2 })), 'pair');
  assert.equal(completionReplyContext(session({ deckIds: ['date', 'acquaintance-date'] })), 'romance');
  assert.equal(completionReplyContext(session({ deckIds: ['date', 'friends'] })), 'pair');
  assert.equal(completionReplyContext(session({ participants: ['A', 'B', 'C'] })), 'group');
  assert.equal(completionReplyContext(session({ deckIds: ['team', 'date'] })), 'business');
  assert.equal(completionReplyContext(session({ sponsorSet: true, sponsor: { categories: ['work'] }, participants: ['A', 'B'] })), 'business');
});

test('reply key separates rounds and sessions', () => {
  assert.notEqual(completionReplyKey(session({ roundStart: 0, cursor: 6 })), completionReplyKey(session({ roundStart: 6, cursor: 12 })));
  assert.notEqual(completionReplyKey(session({ sessionId: 's1' })), completionReplyKey(session({ sessionId: 's2' })));
  assert.equal(completionReplyKey(session({ organizationId: 'org', sessionId: 's1', roundKey: 'stable' })), 'org:s1:stable');
});

test('copy supplies complete spoken instructions for every context', () => {
  for (const context of ['solo', 'group', 'business', 'pair', 'romance']) {
    const copy = completionReplyCopy(context);
    assert.ok(copy.prompt && copy.action && copy.doneLabel && copy.complete);
    assert.ok(copy.title && copy.completeTitle && copy.image);
  }
  assert.match(completionReplyCopy('solo').prompt, /声に出/u);
  assert.match(completionReplyCopy('business').prompt, /拍手/u);
  assert.match(completionReplyCopy('pair').prompt, /ありがとう/u);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { completionReplyContext, completionReplyKey, completionReplyCopy } from '../dist/completion-reply.js';

const session = (overrides = {}) => ({ sessionId: 's1', roundStart: 0, cursor: 6, participants: ['A', 'B'], ...overrides });

test('reply context keeps explicit safety precedence', () => {
  assert.equal(completionReplyContext(session({ mode: 'solo', deckId: 'founders' })), 'solo');
  assert.equal(completionReplyContext(session({ businessSession: true, deckId: 'date' })), 'business');
  assert.equal(completionReplyContext(session({ businessSession: true, count: 1, participants: ['A'] })), 'solo');
  assert.equal(completionReplyContext(session({ participants: ['A', 'B'], count: 2 })), 'pair');
  assert.equal(completionReplyContext(session({ deckIds: ['date', 'acquaintance-date'] })), 'candidate');
  assert.equal(completionReplyContext(session({ deckIds: ['date', 'friends'] })), 'pair');
  assert.equal(completionReplyContext(session({ deckId: 'friends' })), 'friend');
  assert.equal(completionReplyContext(session({ deckId: 'new-couple' })), 'partner');
  assert.equal(completionReplyContext(session({ deckId: 'couples' })), 'married');
  assert.equal(completionReplyContext(session({ deckId: 'team' })), 'business');
  assert.equal(completionReplyContext(session({ deckId: 'party-first-meeting' })), 'first');
  assert.equal(completionReplyContext(session({ deckId: 'family-reunion' })), 'family');
  assert.equal(completionReplyContext(session({ deckIds: ['friends', 'reunion'] })), 'friend');
  assert.equal(completionReplyContext(session({ deckIds: ['friends', 'new-couple'] })), 'pair');
  assert.equal(completionReplyContext(session({ deckId: 'sports-teammates', participants: ['A', 'B', 'C'] })), 'group');
  assert.equal(completionReplyContext(session({ participants: ['A', 'B', 'C'] })), 'group');
  assert.equal(completionReplyContext(session({ business: true, deckIds: ['team', 'date'] })), 'business');
  assert.equal(completionReplyContext(session({ deckIds: ['team', 'friends'] })), 'pair');
  assert.equal(completionReplyContext(session({ deckIds: ['team', 'date'], participants: ['A', 'B', 'C'] })), 'group');
  assert.equal(completionReplyContext(session({ deckIds: ['team', 'founders'] })), 'business');
  assert.equal(completionReplyContext(session({ sponsorSet: true, sponsor: { categories: ['work'] }, participants: ['A', 'B'] })), 'business');
});

test('reply key separates rounds and sessions', () => {
  assert.notEqual(completionReplyKey(session({ roundStart: 0, cursor: 6 })), completionReplyKey(session({ roundStart: 6, cursor: 12 })));
  assert.notEqual(completionReplyKey(session({ sessionId: 's1' })), completionReplyKey(session({ sessionId: 's2' })));
  assert.equal(completionReplyKey(session({ organizationId: 'org', sessionId: 's1', roundKey: 'stable' })), 'org:s1:stable');
});

test('copy supplies complete spoken instructions for every context', () => {
  for (const context of ['solo', 'group', 'business', 'pair', 'romance', 'friend', 'candidate', 'partner', 'married', 'first', 'family']) {
    const copy = completionReplyCopy(context);
    assert.ok(copy.prompt && copy.action && copy.doneLabel && copy.complete);
    assert.ok(copy.title && copy.completeTitle && copy.image);
  }
  assert.match(completionReplyCopy('solo').prompt, /声に出/u);
  assert.match(completionReplyCopy('business').prompt, /参考になりました/u);
  assert.doesNotMatch(completionReplyCopy('business').prompt, /拍手/u);
  assert.match(completionReplyCopy('pair').prompt, /ありがとう/u);
  assert.match(completionReplyCopy('friend').prompt, /聞けてよかった/u);
  assert.match(completionReplyCopy('candidate').prompt, /いいなと思った/u);
  assert.match(completionReplyCopy('partner').prompt, /好き/u);
  assert.match(completionReplyCopy('married').prompt, /ありがとう/u);
  assert.match(completionReplyCopy('first').prompt, /聞けてよかったです/u);
  assert.match(completionReplyCopy('family').prompt, /家族/u);
  assert.equal(completionReplyCopy('friend', { participantCount: 2 }).image, '/assets/completion-reply-pair.webp');
  assert.equal(completionReplyCopy('friend', { participantCount: 3 }).image, '/assets/completion-reply-group.webp');
  assert.match(completionReplyCopy('solo').complete, /伝えたい言葉/u);
});

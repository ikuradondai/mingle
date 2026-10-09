import test from 'node:test';
import assert from 'node:assert/strict';
import { businessActivities } from '../server-side/data/business-activities.mjs';

test('business activities stay server-only and satisfy the agreed contract', () => {
  const expected = new Map([
    ['1on1-mutual', [2, 2, 6]], ['1on1-consult', [2, 2, 6]], ['1on1-reflect', [2, 2, 6]],
    ['meeting-checkin', [2, 8, 12]], ['onboarding-day1', [2, 8, 8]], ['onboarding-week1', [2, 8, 8]],
    ['onboarding-month1', [2, 8, 8]], ['colleague-prediction', [2, 2, 12]],
  ]);
  assert.deepEqual(new Set(businessActivities.map((item) => item.id)), new Set(expected.keys()));
  assert.equal(new Set(businessActivities.flatMap((item) => item.cards.map((card) => card.id))).size, businessActivities.reduce((n, item) => n + item.cards.length, 0));
  for (const activity of businessActivities) {
    const [min, max, count] = expected.get(activity.id);
    assert.equal(activity.minParticipants, min); assert.equal(activity.maxParticipants, max); assert.equal(activity.cards.length, count);
    assert.ok(['conversation', 'prediction'].includes(activity.kind));
    for (const card of activity.cards) {
      assert.ok(card.question.trim());
      assert.equal(card.question.endsWith('？'), true, card.id);
      if (activity.kind === 'prediction') assert.deepEqual(card.options?.length, 2);
      else assert.equal('options' in card, false);
    }
  }
});

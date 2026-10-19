import test from 'node:test';
import assert from 'node:assert/strict';
import { interactionFeedbackFor, __resetInteractionFeedbackForTest } from '../dist/interaction-feedback.js';

test('feedback catalog avoids adjacent visual repeats across real interaction actions', () => {
  __resetInteractionFeedbackForTest();
  for (const tone of ['bright', 'confetti', 'heart', 'calm']) {
    const values = ['theme', 'reveal', 'next-person', 'next-card', 'pass'].map((action) => interactionFeedbackFor({ tone, action, participantCount: 2 }));
    for (let index = 1; index < values.length; index += 1) {
      assert.notEqual(values[index].variant, values[index - 1].variant, `${tone} repeats visual variant`);
      if (tone !== 'calm') assert.notEqual(values[index].soundKey, values[index - 1].soundKey, `${tone} repeats sound`);
    }
    assert.ok(values.every((item) => ['feedback-group', 'feedback-confetti', 'feedback-sparkle', 'feedback-heart', 'feedback-calm'].includes(item.soundKey)));
  }
});

test('unknown profiles fall back safely and preserve participant intensity', () => {
  __resetInteractionFeedbackForTest();
  const solo = interactionFeedbackFor({ tone: 'unknown', action: 'unknown', participantCount: 1 });
  const group = interactionFeedbackFor({ tone: 'confetti', action: 'theme', participantCount: 5 });
  assert.equal(solo.tone, 'bright');
  assert.equal(solo.intensity, 'solo');
  assert.equal(group.intensity, 'group');
});

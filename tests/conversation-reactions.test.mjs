import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { reactionEffectMarkup } from '../dist/conversation-reactions.js';

function particleCount(markup) {
  return (markup.match(/class="reaction-particle reaction-particle-/g) || []).length;
}

function imageWidth(markup) {
  return Number(markup.match(/--reaction-image-width:([\d.]+)px/)?.[1]);
}

test('reaction effects preserve host contract and scale the image plus halo by stage', () => {
  const first = reactionEffectMarkup('same', 1, { participantCount: 4, tone: 'heart' });
  const peak = reactionEffectMarkup('same', 20, { participantCount: 4, tone: 'heart' });
  assert.match(first, /conversation-reaction-effect-same/);
  assert.match(first, /data-reaction-effect="same"/);
  assert.match(first, /aria-hidden="true"/);
  assert.ok(imageWidth(peak) > imageWidth(first) * 3, 'peak artwork should be substantially larger');
  assert.ok(particleCount(peak) > particleCount(first), 'peak halo should grow richer');
  assert.ok(particleCount(peak) <= 60, 'a burst remains bounded');
});

test('heart tone always includes both dimensional hearts and fine sparkles', () => {
  const markup = reactionEffectMarkup('same', 10, { participantCount: 2, tone: 'heart' });
  assert.match(markup, /reaction-particle-heart/);
  assert.match(markup, /reaction-particle-sparkle/);
  assert.match(markup, /--particle-drift-x:[^;]+px/);
  assert.match(markup, /--particle-rotate:[^;]+deg/);
});

test('WOW uses star accents without accidentally emitting hearts', () => {
  const markup = reactionEffectMarkup('surprise', 20, { participantCount: 4, tone: 'bright' });
  assert.doesNotMatch(markup, /reaction-particle-heart/);
  assert.match(markup, /reaction-particle-sparkle/);
  assert.match(markup, /reaction-yes|reaction-wow/);
});

test('solo and calm profiles keep density below a group heart burst', () => {
  const solo = reactionEffectMarkup('same', 20, { participantCount: 1, tone: 'calm' });
  const group = reactionEffectMarkup('same', 20, { participantCount: 4, tone: 'heart' });
  assert.ok(particleCount(solo) < particleCount(group));
  assert.match(solo, /conversation-reaction-effect-calm/);
});

test('reduced motion hides travel particles while retaining the artwork fallback', () => {
  const css = fs.readFileSync(new URL('../dist/conversation-reactions.css', import.meta.url), 'utf8');
  assert.match(css, /prefers-reduced-motion:reduce/);
  assert.match(css, /\.reaction-particle\s*\{[^}]*animation:none;[^}]*opacity:0;[^}]*display:none/);
  assert.match(css, /\.reaction-effect-image[^}]*animation:none;[^}]*opacity:1/);
});

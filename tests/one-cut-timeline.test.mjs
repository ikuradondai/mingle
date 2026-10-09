import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTION_AFTER_START_MS, addClockSample, bestClockOffset, cueTimes, makeClockSample, pendingCues, serverNowFrom, stageAt } from '../dist/one-cut-timeline.js';

// ready at S -> T0 = S + 1s; action = T0 + 5.5s; cut = action + 3s (all supplied by the server)
const T0 = Date.parse('2026-10-09T00:00:10.000Z');
const take = { takeStartedAt: new Date(T0).toISOString(), actionAt: new Date(T0 + ACTION_AFTER_START_MS).toISOString(), cutAt: new Date(T0 + ACTION_AFTER_START_MS + 3000).toISOString() };
const at = (offset) => stageAt(take, T0 + offset);

test('stageAt walks standby -> slate -> yoi -> 3 -> 2 -> 1 -> action -> cut -> vote', () => {
  assert.equal(ACTION_AFTER_START_MS, 5500);
  assert.equal(at(-1).stage, 'standby');
  assert.equal(at(-1).nextInMs, 1);
  assert.deepEqual([at(0).stage, at(0).nextInMs], ['slate', 1500]);
  assert.equal(at(1499).stage, 'slate');
  assert.equal(at(1500).stage, 'yoi');
  assert.equal(at(2499).stage, 'yoi');
  assert.deepEqual([at(2500).stage, at(2500).count], ['count', 3]);
  assert.deepEqual([at(3499).stage, at(3499).count], ['count', 3]);
  assert.deepEqual([at(3500).stage, at(3500).count], ['count', 2]);
  assert.deepEqual([at(4500).stage, at(4500).count], ['count', 1]);
  assert.deepEqual([at(5499).stage, at(5499).count], ['count', 1]);
  assert.deepEqual([at(5500).stage, at(5500).nextInMs], ['action', 3000]);
  assert.equal(at(8499).stage, 'action');
  assert.equal(at(8500).stage, 'cut');
  assert.equal(at(8999).stage, 'cut');
  assert.deepEqual([at(9000).stage, at(9000).nextInMs], ['vote', null]);
  assert.equal(at(60000).stage, 'vote');
});

test('a device that learns about the take late starts from the stage that matches the clock', () => {
  assert.equal(at(3700).stage, 'count');
  assert.equal(at(3700).count, 2);
  assert.equal(at(6000).stage, 'action');
});

test('missing or broken times fall back to standby instead of throwing', () => {
  assert.equal(stageAt({}, 1).stage, 'standby');
  assert.equal(stageAt(null, 1).stage, 'standby');
  assert.equal(stageAt({ ...take, cutAt: 'nope' }, T0).stage, 'standby');
  assert.equal(stageAt(take, NaN).stage, 'standby');
});

test('cues: beeps on 3 / 2 / 1, the clapper on action and on cut; past cues are not replayed', () => {
  assert.deepEqual(cueTimes(take).map((cue) => [cue.kind, cue.at - T0]), [['beep', 2500], ['beep', 3500], ['beep', 4500], ['clap', 5500], ['clap', 8500]]);
  assert.deepEqual(pendingCues(take, T0 + 3000).map((cue) => [cue.kind, cue.delayMs]), [['beep', 500], ['beep', 1500], ['clap', 2500], ['clap', 5500]]);
  assert.deepEqual(pendingCues(take, T0 + 9000), []);
  assert.deepEqual(pendingCues(take, T0 + 5500).map((cue) => cue.kind), ['clap']); // a cue exactly now is already past
  assert.deepEqual(cueTimes({}), []);
});

test('clock sync takes the sample with the smallest round trip and survives bad input', () => {
  // server 1000 ms ahead of the local performance clock; a symmetrical 40 ms round trip
  const good = makeClockSample({ sentAt: 100, receivedAt: 140, serverNowMs: 1120 });
  assert.equal(good.rtt, 40); assert.equal(good.offset, 1000);
  // a slow, asymmetric round trip estimates the offset worse
  const slow = makeClockSample({ sentAt: 200, receivedAt: 600, serverNowMs: 1400 });
  assert.equal(slow.rtt, 400); assert.equal(slow.offset, 1000 + 0);
  const skewed = makeClockSample({ sentAt: 300, receivedAt: 700, serverNowMs: 1700 });
  assert.equal(skewed.offset, 1200);
  let samples = [];
  for (const sample of [skewed, good, slow]) samples = addClockSample(samples, sample);
  assert.equal(bestClockOffset(samples), 1000, 'the 40 ms sample wins');
  assert.equal(bestClockOffset([]), null);
  assert.equal(makeClockSample({ sentAt: 5, receivedAt: 1, serverNowMs: 3 }), null);
  assert.equal(makeClockSample({ sentAt: NaN, receivedAt: 1, serverNowMs: 3 }), null);
  assert.deepEqual(addClockSample(samples, null), samples);
  // only the latest five samples are kept
  let many = [];
  for (let i = 0; i < 9; i += 1) many = addClockSample(many, { rtt: 10 + i, offset: i });
  assert.equal(many.length, 5); assert.equal(many[0].offset, 4);
  assert.equal(bestClockOffset(many), 4);
  assert.equal(serverNowFrom(500, 1000), 1500); assert.equal(serverNowFrom(500, null), 500);
});

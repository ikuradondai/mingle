import test from 'node:test';
import assert from 'node:assert/strict';
import { oneCutScenes } from '../dist/data/one-cut-scenes.js';
import { ONE_CUT_SCENES_EXHAUSTED, actorForTake, defaultLapsFor, isLastTakeOfLap, lapAwardWinners, lapOfTake, pickSceneSet, scoreSoloTake, validateSceneSet } from '../dist/one-cut-rules.js';

// Deterministic generator so a failure is reproducible.
const seeded = (seed) => () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
const byId = new Map(oneCutScenes.map((scene) => [scene.id, scene]));
const EXPRESSIONS = ['surprise', 'joy', 'anticipation', 'shy', 'panic', 'chill', 'puzzled', 'fed-up', 'letdown', 'relief', 'endure', 'smirk', 'torn'];

test('1000 sets from the real scene data always satisfy every set rule', () => {
  const random = seeded(2026);
  for (let i = 0; i < 1000; i += 1) {
    const { options, answerIndex } = pickSceneSet({ scenes: oneCutScenes, random });
    assert.equal(options.length, 6);
    assert.equal(new Set(options).size, 6);
    assert.ok(answerIndex >= 0 && answerIndex <= 5);
    const chosen = options.map((id) => byId.get(id));
    assert.ok(chosen.every(Boolean));
    assert.equal(new Set(chosen.map((scene) => scene.expression)).size, 6, 'expressions differ inside a set');
    const groups = chosen.map((scene) => scene.similarGroup).filter(Boolean);
    assert.equal(new Set(groups).size, groups.length, 'similarGroup is not repeated');
    const perCategory = {};
    for (const scene of chosen) perCategory[scene.category] = (perCategory[scene.category] || 0) + 1;
    assert.ok(Object.values(perCategory).every((count) => count <= 2), 'at most two per category');
    assert.ok((perCategory.love || 0) <= 1, 'love is limited to one per set');
    assert.deepEqual(validateSceneSet(oneCutScenes, options), { ok: true, reason: null });
  }
});

test('a whole game never repeats an answer, even at the maximum 8 players x 3 laps (24 takes)', () => {
  for (let game = 0; game < 40; game += 1) {
    const random = seeded(500 + game);
    const usedAnswers = []; const usedOptions = [];
    for (let take = 0; take < 24; take += 1) {
      const { options, answerIndex } = pickSceneSet({ scenes: oneCutScenes, usedAnswerIds: usedAnswers, usedOptionIds: usedOptions, random });
      assert.equal(usedAnswers.includes(options[answerIndex]), false, `game ${game} take ${take}`);
      assert.equal(options.some((id) => usedAnswers.includes(id)), false, 'an earlier answer is not offered as an option either');
      usedAnswers.push(options[answerIndex]);
      for (const id of options) if (!usedOptions.includes(id)) usedOptions.push(id);
    }
    assert.equal(new Set(usedAnswers).size, 24);
  }
});

test('scenes not yet shown as options are preferred over ones that were', () => {
  const random = seeded(9);
  const unseen = new Set(oneCutScenes.filter((_, index) => index % 2 === 0).map((scene) => scene.id));
  const seen = oneCutScenes.filter((_, index) => index % 2 === 1).map((scene) => scene.id);
  for (let i = 0; i < 200; i += 1) {
    const { options } = pickSceneSet({ scenes: oneCutScenes, usedOptionIds: seen, random });
    assert.ok(options.every((id) => unseen.has(id)), 'only unseen scenes while enough remain');
  }
  // when the unseen ones run out, shown ones fill the gap instead of failing
  const nearlyAll = oneCutScenes.filter((scene) => scene.id !== oneCutScenes[0].id).map((scene) => scene.id);
  const { options } = pickSceneSet({ scenes: oneCutScenes, usedOptionIds: nearlyAll, random });
  assert.equal(options.length, 6);
});

test('the answer is spread evenly over A to F (rough chi-square) and every position is reachable', () => {
  const random = seeded(77);
  const counts = [0, 0, 0, 0, 0, 0];
  const N = 6000;
  for (let i = 0; i < N; i += 1) counts[pickSceneSet({ scenes: oneCutScenes, random }).answerIndex] += 1;
  const expected = N / 6;
  const chi = counts.reduce((sum, count) => sum + (count - expected) ** 2 / expected, 0);
  assert.ok(chi < 20.5, `chi-square ${chi.toFixed(1)} (df=5, p=0.001), counts ${counts}`);
  assert.ok(counts.every((count) => count > 0));
});

test('an impossible pool throws ONE_CUT_SCENES_EXHAUSTED instead of looping', () => {
  const fail = (scenes, extra = {}) => assert.throws(() => pickSceneSet({ scenes, random: seeded(1), ...extra }), (error) => error.code === ONE_CUT_SCENES_EXHAUSTED && error.status === 409);
  fail(oneCutScenes.slice(0, 5));
  fail([]);
  fail(undefined);
  fail(Array.from({ length: 30 }, (_, i) => ({ id: `s${i}`, text: 'x', category: 'daily', expression: 'joy' }))); // one expression only
  fail(Array.from({ length: 30 }, (_, i) => ({ id: `s${i}`, text: 'x', category: 'daily', expression: ['joy', 'shy', 'panic'][i % 3] }))); // three expressions can never fill six
  fail(oneCutScenes, { usedAnswerIds: oneCutScenes.map((scene) => scene.id) });
  // love scenes alone can never fill a set (one per set)
  fail(Array.from({ length: 13 }, (_, i) => ({ id: `l${i}`, text: 'x', category: 'love', expression: EXPRESSIONS[i] })));
});

test('validateSceneSet names the broken rule', () => {
  const pool = [
    { id: 'a', text: 't', category: 'daily', expression: 'joy' }, { id: 'b', text: 't', category: 'food', expression: 'shy' },
    { id: 'c', text: 't', category: 'people', expression: 'panic' }, { id: 'd', text: 't', category: 'outing', expression: 'chill' },
    { id: 'e', text: 't', category: 'fandom', expression: 'torn' }, { id: 'f', text: 't', category: 'work-school', expression: 'relief' },
    { id: 'g', text: 't', category: 'daily', expression: 'joy' }, { id: 'h', text: 't', category: 'love', expression: 'smirk', similarGroup: 'x' },
    { id: 'i', text: 't', category: 'love', expression: 'endure' }, { id: 'j', text: 't', category: 'money-luck', expression: 'letdown', similarGroup: 'x' },
    { id: 'k', text: 't', category: 'daily', expression: 'puzzled' }, { id: 'l', text: 't', category: 'daily', expression: 'fed-up' }
  ];
  assert.deepEqual(validateSceneSet(pool, ['a', 'b', 'c', 'd', 'e', 'f']), { ok: true, reason: null });
  assert.equal(validateSceneSet(pool, ['a', 'b', 'c', 'd', 'e']).reason, 'size');
  assert.equal(validateSceneSet(pool, ['a', 'a', 'c', 'd', 'e', 'f']).reason, 'duplicate-id');
  assert.equal(validateSceneSet(pool, ['a', 'b', 'c', 'd', 'e', 'zz']).reason, 'unknown-id');
  assert.equal(validateSceneSet(pool, ['a', 'g', 'c', 'd', 'e', 'f']).reason, 'expression');
  assert.equal(validateSceneSet(pool, ['h', 'j', 'c', 'd', 'e', 'f']).reason, 'similar-group');
  assert.equal(validateSceneSet(pool, ['h', 'i', 'c', 'd', 'e', 'f']).reason, 'category'); // two love scenes
  assert.equal(validateSceneSet(pool, ['a', 'k', 'l', 'd', 'e', 'f']).reason, 'category'); // three daily scenes
});

test('rotation: take k belongs to members[(k-1) % n]; laps and the last-take test follow', () => {
  const members = ['host', 'a', 'b', 'c'];
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9].map((k) => actorForTake(members, k)), ['host', 'a', 'b', 'c', 'host', 'a', 'b', 'c', 'host']);
  assert.deepEqual([1, 4, 5, 8, 9].map((k) => lapOfTake(4, k)), [1, 1, 2, 2, 3]);
  assert.deepEqual([1, 3, 4, 8].map((k) => isLastTakeOfLap(4, k)), [false, false, true, true]);
  assert.throws(() => actorForTake([], 1)); assert.throws(() => actorForTake(members, 0)); assert.throws(() => actorForTake(members, 1.5));
  assert.deepEqual([2, 3, 4, 5, 6, 8].map(defaultLapsFor), [2, 2, 2, 1, 1, 1]);
});

test('scoring: correct voters +1, the actor gets one point per correct voter, passes and absentees score nothing', () => {
  const base = { answerIndex: 2, actorId: 'actor' };
  assert.deepEqual(scoreSoloTake({ ...base, votes: [{ voterId: 'a', choice: 2 }, { voterId: 'b', choice: 2 }, { voterId: 'c', choice: 4 }, { voterId: 'd', choice: null }] }),
    { tally: [0, 0, 2, 0, 1, 0], passCount: 1, correctMemberIds: ['a', 'b'], gained: { a: 1, b: 1, actor: 2 }, actorGain: 2 });
  const none = scoreSoloTake({ ...base, votes: [] });
  assert.deepEqual(none.gained, { actor: 0 }); assert.deepEqual(none.correctMemberIds, []); assert.equal(none.passCount, 0);
  const allPass = scoreSoloTake({ ...base, votes: [{ voterId: 'a', choice: null }, { voterId: 'b', choice: undefined }, { voterId: 'c', choice: 9 }, { voterId: 'd', choice: -1 }] });
  assert.equal(allPass.passCount, 4); assert.deepEqual(allPass.gained, { actor: 0 });
  // the actor never scores from their own vote row, and a choice at A (index 0) counts
  const odd = scoreSoloTake({ answerIndex: 0, actorId: 'actor', votes: [{ voterId: 'actor', choice: 0 }, { voterId: 'a', choice: 0 }] });
  assert.deepEqual(odd.gained, { a: 1, actor: 1 }); assert.deepEqual(odd.tally, [1, 0, 0, 0, 0, 0]);
});

test('lap award: everyone tied for the most likes, nobody without likes', () => {
  assert.deepEqual(lapAwardWinners([]), []);
  assert.deepEqual(lapAwardWinners([{ targetId: 'a' }, { targetId: 'b' }, { targetId: 'a' }]), ['a']);
  assert.deepEqual(lapAwardWinners([{ targetId: 'a' }, { targetId: 'b' }]).sort(), ['a', 'b']);
});

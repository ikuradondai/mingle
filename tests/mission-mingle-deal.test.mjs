import test from 'node:test';
import assert from 'node:assert/strict';
import { missionCards } from '../dist/data/mission-mingle-cards.js';
import { MISSION_PRESETS, dealMissions, dealMissionsWithLevel, dealReplacement, eligibleMissionCards } from '../server-side/mission-mingle.mjs';

const RUNS = 500;
const byId = new Map(missionCards.map((card) => [card.id, card]));
const rosterOf = (n) => Array.from({ length: n }, (_, i) => ({ id: `member-${i}` }));
// mulberry32: a small seeded generator so every failure is reproducible
function seeded(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function assertHardRules(deal, { n, preset, scene, seatMode, label }) {
  const ids = rosterOf(n).map((item) => item.id);
  assert.equal(deal.length, n * 3, `${label}: three per member`);
  assert.equal(new Set(deal.map((row) => row.missionId)).size, deal.length, `${label}: H1 a mission id is dealt once`);
  const pairs = new Set();
  for (const id of ids) {
    const rows = deal.filter((row) => row.memberId === id);
    assert.deepEqual(rows.map((row) => row.slot), [1, 2, 3], `${label}: slots`);
    assert.deepEqual(rows.map((row) => row.difficulty), [...MISSION_PRESETS[preset]], `${label}: H4 preset difficulties by slot`);
  }
  for (const row of deal) {
    const card = byId.get(row.missionId);
    assert.ok(card, `${label}: known card`);
    assert.equal(card.difficulty, row.difficulty); assert.equal(card.topic, row.topic);
    assert.ok(card.retired !== true && card.scenes.includes(scene) && card.minPlayers <= n, `${label}: eligible card ${card.id}`);
    if (card.target === 'seat') assert.equal(seatMode, true, `${label}: seat card only with seatMode`);
    if (card.target === 'named') {
      assert.ok(ids.includes(row.targetMemberId), `${label}: named target is a member`);
      assert.notEqual(row.targetMemberId, row.memberId, `${label}: H2 never yourself`);
      const key = `${row.targetMemberId}|${row.topic}`;
      assert.equal(pairs.has(key), false, `${label}: H3 same topic on the same person`);
      pairs.add(key);
    } else assert.equal(row.targetMemberId, null, `${label}: only named missions carry a target`);
  }
}

test('dealing keeps every hard rule and the soft rules across 3-8 players x 3 presets x 3 scenes x seat on/off (500 seeded deals each)', () => {
  let deals = 0; const relaxed = {}; let worstSpread = 0;
  for (let n = 3; n <= 8; n += 1) for (const preset of Object.keys(MISSION_PRESETS)) for (const scene of ['party', 'mixer', 'business']) for (const seatMode of [false, true]) {
    for (let seed = 1; seed <= RUNS; seed += 1) {
      const label = `n=${n} ${preset} ${scene} seat=${seatMode} seed=${seed}`;
      const { assignments: deal, level } = dealMissionsWithLevel({ roster: rosterOf(n), preset, scene, seatMode, random: seeded(seed * 7919 + n) });
      assertHardRules(deal, { n, preset, scene, seatMode, label });
      deals += 1; relaxed[level] = (relaxed[level] || 0) + 1;
      // S1 / S2 / S4 hold whenever the strictest pass succeeded; S3 holds unless the last level was needed
      if (level === 0) {
        for (const id of rosterOf(n).map((item) => item.id)) {
          const rows = deal.filter((row) => row.memberId === id).map((row) => ({ row, card: byId.get(row.missionId) }));
          assert.equal(new Set(rows.map(({ card }) => card.category)).size, 3, `${label}: S1`);
          const targets = rows.filter(({ row }) => row.targetMemberId).map(({ row }) => row.targetMemberId);
          assert.equal(new Set(targets).size, targets.length, `${label}: S2`);
          assert.ok(rows.filter(({ card }) => card.target === 'seat').length <= 1, `${label}: S4`);
        }
      }
      if (level < 4) {
        const counts = new Map(rosterOf(n).map((item) => [item.id, 0]));
        for (const row of deal) if (row.targetMemberId) counts.set(row.targetMemberId, counts.get(row.targetMemberId) + 1);
        const spread = Math.max(...counts.values()) - Math.min(...counts.values());
        worstSpread = Math.max(worstSpread, spread);
        assert.ok(spread <= 2, `${label}: S3 spread ${spread}`);
      }
    }
  }
  assert.equal(deals, 6 * 3 * 3 * 2 * RUNS);
  assert.deepEqual(Object.keys(relaxed), ['0'], `the real catalog never needs a relaxed pass: ${JSON.stringify(relaxed)}`);
  assert.ok(worstSpread <= 2);
});

test('a deal is reproducible from its seed and differs between seeds', () => {
  const args = { roster: rosterOf(5), preset: 'standard', scene: 'party', seatMode: true };
  assert.deepEqual(dealMissions({ ...args, random: seeded(42) }), dealMissions({ ...args, random: seeded(42) }));
  assert.notDeepEqual(dealMissions({ ...args, random: seeded(1) }), dealMissions({ ...args, random: seeded(2) }));
});

test('excluded (already dealt) ids are never dealt again', () => {
  const first = dealMissions({ roster: rosterOf(4), preset: 'hard', scene: 'party', random: seeded(3) });
  const exclude = first.map((row) => row.missionId);
  const second = dealMissions({ roster: rosterOf(4), preset: 'hard', scene: 'party', exclude, random: seeded(4) });
  assert.equal(second.some((row) => exclude.includes(row.missionId)), false);
});

test('seat missions are held back unless the host says seats are fixed; retired and too-big-for-the-room cards never appear', () => {
  assert.equal(eligibleMissionCards(missionCards, { scene: 'party', seatMode: false, playerCount: 4 }).some((card) => card.target === 'seat'), false);
  assert.equal(eligibleMissionCards(missionCards, { scene: 'party', seatMode: true, playerCount: 4 }).some((card) => card.target === 'seat'), true);
  const pool = [{ id: 'mission-901', text: 'x', difficulty: 1, category: 'ask', target: 'anyone', topic: 'a', scenes: ['party'], minPlayers: 3 }, { id: 'mission-902', text: 'x', difficulty: 1, category: 'ask', target: 'anyone', topic: 'b', scenes: ['party'], minPlayers: 3, retired: true }, { id: 'mission-903', text: 'x', difficulty: 1, category: 'ask', target: 'anyone', topic: 'c', scenes: ['party'], minPlayers: 5 }];
  assert.deepEqual(eligibleMissionCards(pool, { scene: 'party', seatMode: true, playerCount: 3 }).map((card) => card.id), ['mission-901']);
});

test('a catalog too small to fill the room reports MISSION_POOL_EXHAUSTED (409)', () => {
  const tiny = Array.from({ length: 5 }, (_, i) => ({ id: `mission-90${i}`, text: 'x', difficulty: 1 + (i % 3), category: 'ask', target: 'anyone', topic: `t${i}`, scenes: ['party'], minPlayers: 3 }));
  assert.throws(() => dealMissions({ roster: rosterOf(3), cards: tiny, preset: 'standard', scene: 'party', random: seeded(1) }), (error) => error.status === 409 && error.code === 'MISSION_POOL_EXHAUSTED');
});

test('the soft rules relax in steps instead of failing when the catalog is thin', () => {
  // only two categories and a single target-friendly topic pool: S1 (three distinct categories) cannot hold
  const thin = [];
  for (let d = 1; d <= 3; d += 1) for (let i = 0; i < 12; i += 1) thin.push({ id: `mission-${String(100 + d * 20 + i)}`, text: '{target}x', difficulty: d, category: i % 2 ? 'ask' : 'call', target: 'named', topic: `t${d}-${i}`, scenes: ['party'], minPlayers: 3 });
  const { assignments, level } = dealMissionsWithLevel({ roster: rosterOf(3), cards: thin, preset: 'standard', scene: 'party', random: seeded(9) });
  assert.equal(assignments.length, 9);
  assert.ok(level >= 3, `S1 had to be relaxed (level ${level})`);
});

test('a replacement keeps the difficulty, avoids every dealt id and never reuses a live (target, topic) pair', () => {
  const roster = rosterOf(4);
  for (let seed = 1; seed <= 100; seed += 1) {
    const deal = dealMissions({ roster, preset: 'standard', scene: 'party', seatMode: true, random: seeded(seed) });
    const rows = deal.map((row, i) => ({ id: `a-${i}`, member_id: row.memberId, slot: row.slot, mission_id: row.missionId, difficulty: row.difficulty, topic: row.topic, target_member_id: row.targetMemberId, status: 'active' }));
    const pick = rows[seed % rows.length];
    const fresh = dealReplacement({ roster, scene: 'party', seatMode: true, assignments: rows, assignmentId: pick.id, random: seeded(seed + 1000) });
    assert.equal(fresh.difficulty, pick.difficulty);
    assert.equal(rows.some((row) => row.mission_id === fresh.missionId), false, 'H1: not a dealt id');
    if (fresh.targetMemberId) {
      assert.notEqual(fresh.targetMemberId, pick.member_id);
      assert.equal(rows.some((row) => row.id !== pick.id && row.target_member_id === fresh.targetMemberId && row.topic === fresh.topic), false, 'H3');
    }
  }
});

test('a swapped-out id stays unavailable, a passed one holds no (target, topic) pair, and an unknown assignment is refused', () => {
  const roster = rosterOf(3);
  const cards = [
    { id: 'mission-801', text: '{target}a', difficulty: 1, category: 'ask', target: 'named', topic: 'x', scenes: ['party'], minPlayers: 3 },
    { id: 'mission-802', text: '{target}b', difficulty: 1, category: 'ask', target: 'named', topic: 'x', scenes: ['party'], minPlayers: 3 },
    { id: 'mission-803', text: '{target}c', difficulty: 1, category: 'ask', target: 'named', topic: 'y', scenes: ['party'], minPlayers: 3 }
  ];
  const row = (id, member, mission, topic, target, status) => ({ id, member_id: member, slot: 1, mission_id: mission, difficulty: 1, topic, target_member_id: target, status });
  // member-0 holds 801 on member-1 (topic x). Replacing it: 801 is gone, 802 is the same topic on the same person only if member-1 stays the target
  const assignments = [row('r0', 'member-0', 'mission-801', 'x', 'member-1', 'active'), row('r1', 'member-2', 'mission-802', 'z', 'member-0', 'swapped')];
  const fresh = dealReplacement({ roster, cards, scene: 'party', assignments, assignmentId: 'r0', random: seeded(5) });
  assert.equal(fresh.missionId, 'mission-803', '801 is dealt, 802 was swapped out earlier');
  // a passed row frees its (target, topic) pair; an active one holds it
  const only = [{ ...cards[1], id: 'mission-804' }];
  const targetsSeen = (status) => new Set(Array.from({ length: 40 }, (_, seed) => dealReplacement({ roster, cards: only, scene: 'party', assignments: [row('r0', 'member-0', 'mission-801', 'x', 'member-2', 'active'), row('r2', 'member-2', 'mission-802', 'x', 'member-1', status)], assignmentId: 'r0', random: seeded(seed + 1) }).targetMemberId));
  assert.deepEqual([...targetsSeen('passed')].sort(), ['member-1', 'member-2']);
  assert.deepEqual([...targetsSeen('active')], ['member-2']);
  assert.throws(() => dealReplacement({ roster, cards, scene: 'party', assignments, assignmentId: 'nope' }), (error) => error.status === 403);
  assert.throws(() => dealReplacement({ roster, cards: [cards[0]], scene: 'party', assignments, assignmentId: 'r0' }), (error) => error.code === 'MISSION_POOL_EXHAUSTED' && error.status === 409);
});

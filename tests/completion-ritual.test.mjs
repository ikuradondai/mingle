import assert from "node:assert/strict";
import test from "node:test";

const storage = (seed = null) => ({ data: seed, getItem() { return this.data; }, setItem(_key, value) { this.data = String(value); } });
const blocked = ({ read = false, write = false } = {}) => ({ getItem() { if (read) throw new Error("read blocked"); return null; }, setItem() { if (write) throw new Error("write blocked"); } });
const pools = Object.fromEntries(["group", "business", "solo", "romance"].map((context) => [context, [0, 1, 2, 3].map((n) => ({ id: `candidate-${n}` }))]));
const { createCompletionRitualSampler, completionRitualCandidates, completionRitualFor, completionRitualKey, nextCompletionRitual } = await import("../dist/completion-ritual.js");
const base = (overrides = {}) => ({ sessionId: "qa", roundStart: 0, cursor: 6, questions: Array(40).fill({}), participants: ["a", "b"], deckId: "friends", ...overrides });

test("routing prioritizes solo, business, romance allowlist, then group", () => {
  assert.equal(completionRitualFor(base({ mode: "solo", participants: ["a", "b"] })).context, "solo");
  assert.equal(completionRitualFor(base({ count: 1 })).context, "solo");
  assert.equal(completionRitualFor(base({ participants: ["a"] })).context, "solo");
  assert.equal(completionRitualFor(base({ participants: ["a", "b", "c"] })).context, "group");
  assert.equal(completionRitualFor(base({ businessSession: true, participants: ["a", "b"] })).context, "business");
  assert.equal(completionRitualFor(base({ businessSession: true, participants: ["a"] })).context, "solo");
  for (const id of ["founders", "team", "new-colleagues", "business-meetup"]) assert.equal(completionRitualFor(base({ deckId: id })).context, "business");
  for (const id of ["date", "acquaintance-date", "omiai", "new-couple", "couples", "moving-in", "engaged-couple", "intimacy", "first-intimacy", "intimacy-refresh", "intimacy-distance"]) assert.equal(completionRitualFor(base({ deckId: id })).context, "romance");
  assert.equal(completionRitualFor(base({ deckIds: ["date", "friends"] })).context, "group");
  assert.equal(completionRitualFor(base({ deckIds: ["team", "date"] })).context, "business");
  assert.equal(completionRitualFor(base({ deckIds: [] })).context, "group");
});

test("each context completes a Fisher-Yates bag before reuse and keeps boundary distinct", () => {
  const sampler = createCompletionRitualSampler(pools, { storage: storage(), random: () => .25 });
  const sequences = Object.fromEntries(Object.keys(pools).map((context) => [context, []]));
  for (let i = 0; i < 12; i += 1) for (const context of Object.keys(pools)) sequences[context].push(sampler.draw(context, `${context}:round-${i}`).id);
  for (const context of Object.keys(pools)) {
    const ids = sequences[context];
    assert.equal(new Set(ids.slice(0, 4)).size, 4, `${context} repeats before bag end`);
    assert.equal(new Set(ids.slice(4, 8)).size, 4, `${context} repeats in second bag`);
    assert.ok(ids.every((id, i) => i === 0 || id !== ids[i - 1]), `${context} repeats at boundary`);
  }
});

test("same round key is stable while round changes consume the shared bag", () => {
  const sampler = createCompletionRitualSampler(pools, { storage: storage(), random: () => .5 });
  const first = sampler.draw("group", "org:session:0:6").id;
  assert.equal(sampler.draw("group", "org:session:0:6").id, first);
  const next = sampler.draw("group", "org:session:6:12").id;
  assert.notEqual(next, first);
  assert.notEqual(sampler.draw("group", "other-org:session:0:6").id, undefined);
});

test("reload hydrates bag and current action from storage", () => {
  const store = storage();
  const before = createCompletionRitualSampler(pools, { storage: store, random: () => .25 });
  const key = "org:reload:0:6";
  const first = before.draw("group", key).id;
  const expectedNext = before.draw("group", "org:reload:6:12").id;
  const after = createCompletionRitualSampler(pools, { storage: store, random: () => .99 });
  assert.equal(after.draw("group", key).id, first);
  assert.equal(after.draw("group", "org:reload:6:12").id, expectedNext);
});

test("blocked read/write and corrupt state recover in memory", () => {
  const readBlocked = createCompletionRitualSampler(pools, { storage: blocked({ read: true, write: true }), random: () => .25 });
  const stable = readBlocked.draw("solo", "key").id;
  assert.equal(readBlocked.draw("solo", "key").id, stable);
  const writeBlocked = createCompletionRitualSampler(pools, { storage: blocked({ write: true }), random: () => .25 });
  const blockedFirst = writeBlocked.draw("group", "a").id;
  assert.equal(writeBlocked.draw("group", "a").id, blockedFirst);
  const blockedNext = writeBlocked.draw("group", "b").id;
  assert.notEqual(blockedNext, blockedFirst);
  assert.equal(new Set([blockedFirst, blockedNext, writeBlocked.draw("group", "c").id, writeBlocked.draw("group", "d").id]).size, 4);
  const corrupt = JSON.stringify({ bags: { group: ["group-0", "group-0", "invalid"] }, last: { group: "group-0" }, current: { group: { bad: "group-0" } } });
  const recovered = createCompletionRitualSampler(pools, { storage: storage(corrupt), random: () => .25 });
  assert.ok(pools.group.some((item) => item.id === recovered.draw("group", "recovered").id));
});

test("public key includes organization and round boundaries", () => {
  assert.equal(completionRitualKey(base({ organizationId: "org", sessionId: "s", roundStart: 0, cursor: 6 })), "org:s:0:6");
  assert.notEqual(completionRitualKey(base({ roundStart: 0, cursor: 6 })), completionRitualKey(base({ roundStart: 6, cursor: 12 })));
});

test("public candidate pools retain four actions per context", () => {
  for (const context of ["group", "business", "solo", "romance"]) assert.equal(completionRitualCandidates(context).length, 4);
  assert.equal(nextCompletionRitual(base({ sessionId: "reroll" })).context, "group");
});

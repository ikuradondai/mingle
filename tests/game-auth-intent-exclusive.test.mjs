import test from "node:test";
import assert from "node:assert/strict";
import { saveMinorityAuthIntent, consumeMinorityAuthIntent } from "../dist/minority-auth-intent.js";
import { saveQuestionWolfAuthIntent, consumeQuestionWolfAuthIntent } from "../dist/question-wolf-auth-intent.js";
import { saveOchiAuthIntent, consumeOchiAuthIntent } from "../dist/ochi-auth-intent.js";
import { saveOneCutAuthIntent, consumeOneCutAuthIntent } from "../dist/one-cut-auth-intent.js";
import { saveMissionAuthIntent, consumeMissionAuthIntent } from "../dist/mission-mingle-auth-intent.js";
import { gameAuthIntentKeys } from "../dist/game-auth-intent-keys.js";

function storage() {
  const map = new Map();
  return { getItem: (key) => map.get(key) ?? null, setItem: (key, value) => map.set(key, String(value)), removeItem: (key) => map.delete(key), keys: () => [...map.keys()].sort() };
}
const games = {
  minority: { save: saveMinorityAuthIntent, consume: consumeMinorityAuthIntent },
  questionWolf: { save: saveQuestionWolfAuthIntent, consume: consumeQuestionWolfAuthIntent },
  ochi: { save: saveOchiAuthIntent, consume: consumeOchiAuthIntent },
  oneCut: { save: saveOneCutAuthIntent, consume: consumeOneCutAuthIntent },
  mission: { save: saveMissionAuthIntent, consume: consumeMissionAuthIntent },
};

test("the five games use five distinct keys", () => {
  assert.equal(new Set(Object.values(gameAuthIntentKeys)).size, 5);
  assert.deepEqual(Object.keys(gameAuthIntentKeys).sort(), Object.keys(games).sort());
});

for (const [newer, nGame] of Object.entries(games)) {
  for (const [older, oGame] of Object.entries(games)) {
    if (older === newer) continue;
    test(`saving the ${newer} return intent clears a pending ${older} one`, () => {
      const store = storage();
      assert.equal(oGame.save({ venueToken: "", name: "古い" }, store, () => 1000), true);
      assert.deepEqual(store.keys(), [gameAuthIntentKeys[older]]);
      assert.equal(nGame.save({ venueToken: "", name: "新しい" }, store, () => 1001), true);
      assert.deepEqual(store.keys(), [gameAuthIntentKeys[newer]]);
      assert.equal(oGame.consume(store, () => 1002), null);
      assert.equal(nGame.consume(store, () => 1002)?.name, "新しい");
    });
  }
}

test("a rejected save leaves the other games' intents alone", () => {
  const store = storage();
  assert.equal(saveOchiAuthIntent({ venueToken: "", name: "のこる" }, store, () => 1000), true);
  assert.equal(saveOneCutAuthIntent({ venueToken: "bad token", name: "x" }, store, () => 1001), false);
  assert.deepEqual(store.keys(), [gameAuthIntentKeys.ochi]);
});

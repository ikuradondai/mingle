import test from "node:test";
import assert from "node:assert/strict";
import {
  saveMissionAuthIntent,
  consumeMissionAuthIntent,
} from "../dist/mission-mingle-auth-intent.js";

function storage() {
  const map = new Map();
  return {
    getItem: (key) => map.get(key) || null,
    setItem: (key, value) => map.set(key, value),
    removeItem: (key) => map.delete(key),
  };
}

test("mission auth intent keeps only short-lived venue and name context", () => {
  const store = storage();
  assert.equal(
    saveMissionAuthIntent(
      { venueToken: "", name: "いくら" },
      store,
      () => 1000,
    ),
    true,
  );
  assert.deepEqual(
    consumeMissionAuthIntent(store, () => 1001),
    { venueToken: "", name: "いくら" },
  );
  assert.equal(
    consumeMissionAuthIntent(store, () => 1001),
    null,
  );
});

test("mission auth intent rejects invalid name and expired values", () => {
  const store = storage();
  assert.equal(
    saveMissionAuthIntent({ name: "x".repeat(41) }, store, () => 1000),
    false,
  );
  assert.equal(
    saveMissionAuthIntent({ name: "ok" }, store, () => 1000),
    true,
  );
  assert.equal(
    consumeMissionAuthIntent(store, () => 31 * 60 * 1000),
    null,
  );
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  saveOneCutAuthIntent,
  consumeOneCutAuthIntent,
} from "../dist/one-cut-auth-intent.js";

function storage() {
  const map = new Map();
  return {
    getItem: (key) => map.get(key) || null,
    setItem: (key, value) => map.set(key, value),
    removeItem: (key) => map.delete(key),
  };
}

test("one-cut auth intent keeps only short-lived venue and name context", () => {
  const store = storage();
  assert.equal(
    saveOneCutAuthIntent(
      { venueToken: "", name: "いくら" },
      store,
      () => 1000,
    ),
    true,
  );
  assert.deepEqual(
    consumeOneCutAuthIntent(store, () => 1001),
    { venueToken: "", name: "いくら" },
  );
  assert.equal(
    consumeOneCutAuthIntent(store, () => 1001),
    null,
  );
});

test("one-cut auth intent rejects invalid name and expired values", () => {
  const store = storage();
  assert.equal(
    saveOneCutAuthIntent({ name: "x".repeat(41) }, store, () => 1000),
    false,
  );
  assert.equal(
    saveOneCutAuthIntent({ name: "ok" }, store, () => 1000),
    true,
  );
  assert.equal(
    consumeOneCutAuthIntent(store, () => 31 * 60 * 1000),
    null,
  );
});

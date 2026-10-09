import test from "node:test";
import assert from "node:assert/strict";
import {
  saveOchiAuthIntent,
  consumeOchiAuthIntent,
} from "../dist/ochi-auth-intent.js";

function storage() {
  const map = new Map();
  return {
    getItem: (key) => map.get(key) || null,
    setItem: (key, value) => map.set(key, value),
    removeItem: (key) => map.delete(key),
  };
}

test("ochi auth intent keeps only short-lived venue and name context", () => {
  const store = storage();
  assert.equal(
    saveOchiAuthIntent(
      { venueToken: "", name: "いくら" },
      store,
      () => 1000,
    ),
    true,
  );
  assert.deepEqual(
    consumeOchiAuthIntent(store, () => 1001),
    { venueToken: "", name: "いくら" },
  );
  assert.equal(
    consumeOchiAuthIntent(store, () => 1001),
    null,
  );
});

test("ochi auth intent rejects invalid name and expired values", () => {
  const store = storage();
  assert.equal(
    saveOchiAuthIntent({ name: "x".repeat(41) }, store, () => 1000),
    false,
  );
  assert.equal(
    saveOchiAuthIntent({ name: "ok" }, store, () => 1000),
    true,
  );
  assert.equal(
    consumeOchiAuthIntent(store, () => 31 * 60 * 1000),
    null,
  );
});

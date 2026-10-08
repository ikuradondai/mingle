import test from "node:test";
import assert from "node:assert/strict";
import {
  saveQuestionWolfAuthIntent,
  consumeQuestionWolfAuthIntent,
} from "../dist/question-wolf-auth-intent.js";

function storage() {
  const map = new Map();
  return {
    getItem: (key) => map.get(key) || null,
    setItem: (key, value) => map.set(key, value),
    removeItem: (key) => map.delete(key),
  };
}

test("question wolf auth intent keeps only short-lived venue and name context", () => {
  const store = storage();
  assert.equal(
    saveQuestionWolfAuthIntent(
      { venueToken: "", name: "いくら" },
      store,
      () => 1000,
    ),
    true,
  );
  assert.deepEqual(
    consumeQuestionWolfAuthIntent(store, () => 1001),
    { venueToken: "", name: "いくら" },
  );
  assert.equal(
    consumeQuestionWolfAuthIntent(store, () => 1001),
    null,
  );
});

test("question wolf auth intent rejects invalid name and expired values", () => {
  const store = storage();
  assert.equal(
    saveQuestionWolfAuthIntent({ name: "x".repeat(41) }, store, () => 1000),
    false,
  );
  assert.equal(
    saveQuestionWolfAuthIntent({ name: "ok" }, store, () => 1000),
    true,
  );
  assert.equal(
    consumeQuestionWolfAuthIntent(store, () => 31 * 60 * 1000),
    null,
  );
});

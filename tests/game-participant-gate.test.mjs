import test from "node:test";
import assert from "node:assert/strict";
import { gameParticipantGate } from "../dist/game-participant-gate.js";
import { groupGames } from "../dist/data/game-registry.js";

const game = (id) => groupGames.find((entry) => entry.id === id);

test("participant gate includes both boundaries and rejects adjacent counts", () => {
  for (const id of ["minority-topic", "question-wolf"]) {
    const entry = game(id);
    assert.equal(gameParticipantGate(entry, 2).valid, false);
    assert.equal(gameParticipantGate(entry, 3).valid, true);
    assert.equal(gameParticipantGate(entry, 8).valid, true);
    assert.equal(gameParticipantGate(entry, 9).valid, false);
  }
  for (const count of [2, 3, 8]) assert.equal(gameParticipantGate(game("match"), count).valid, true);
  assert.equal(gameParticipantGate(game("match"), 1).valid, false);
  assert.equal(gameParticipantGate(game("match"), 9).valid, false);
  assert.equal(gameParticipantGate(game("choice"), 2).valid, true);
  assert.equal(gameParticipantGate(game("choice"), 1).valid, false);
  assert.equal(gameParticipantGate(game("choice"), 3).valid, false);
});

test("participant gate rejects unknown bounds and non-integer counts", () => {
  assert.equal(gameParticipantGate(undefined, 2).valid, false);
  assert.equal(gameParticipantGate({ minParticipants: 3 }, 3).valid, false);
  assert.equal(gameParticipantGate(game("match"), 2.5).valid, false);
});

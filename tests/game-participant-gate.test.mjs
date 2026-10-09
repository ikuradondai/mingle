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
  const ochi = game("ochi-kara");
  assert.equal(ochi.href, "/ochi-room.html?create=1");
  assert.equal(gameParticipantGate(ochi, 1).valid, false);
  assert.equal(gameParticipantGate(ochi, 2).valid, true);
  assert.equal(gameParticipantGate(ochi, 8).valid, true);
  assert.equal(gameParticipantGate(ochi, 9).valid, false);
  const oneCut = game("one-cut");
  assert.equal(oneCut.href, "/one-cut.html?create=1");
  assert.equal(gameParticipantGate(oneCut, 1).valid, false);
  assert.equal(gameParticipantGate(oneCut, 2).valid, true);
  assert.equal(gameParticipantGate(oneCut, 8).valid, true);
  assert.equal(gameParticipantGate(oneCut, 9).valid, false);
  const mission = game("mission-mingle");
  assert.equal(mission.href, "/mission-mingle.html?create=1");
  assert.equal(gameParticipantGate(mission, 2).valid, false);
  assert.equal(gameParticipantGate(mission, 3).valid, true);
  assert.equal(gameParticipantGate(mission, 8).valid, true);
  assert.equal(gameParticipantGate(mission, 9).valid, false);
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

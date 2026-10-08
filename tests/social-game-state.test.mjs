import test from 'node:test';
import assert from 'node:assert/strict';
import { createMatchGame, matchAction, createChoiceGame, choiceAction } from '../dist/social-game-state.js';

const prompts = Array.from({ length: 8 }, (_, i) => ({ id: `p${i}`, text: `お題${i}`, options: ['A', 'B'] }));
const fixed = () => 0;

test('match rejects invalid phases and duplicate judgement', () => {
  let game = createMatchGame({ names: ['A', 'B'], prompts, rng: fixed, rounds: 1 });
  assert.equal(matchAction(game, 'tick'), game);
  game = matchAction(game, 'start-countdown');
  game = matchAction(game, 'tick');
  game = matchAction(game, 'tick');
  game = matchAction(game, 'tick');
  assert.equal(game.phase, 'countdown');
  game = matchAction(game, 'tick');
  game = matchAction(game, 'match');
  assert.equal(game.score, 1);
  assert.equal(matchAction(game, 'split'), game);
});

test('choice alternates predictor and scores correct predictions', () => {
  let game = createChoiceGame({ names: ['A', 'B'], prompts, rng: fixed, rounds: 2 });
  assert.equal(game.turn, 0);
  game = choiceAction(game, 'predict', 1);
  assert.equal(choiceAction(game, 'predict', 0), game);
  game = choiceAction(game, 'ready');
  game = choiceAction(game, 'actual', 1);
  assert.equal(game.phase, 'result');
  assert.equal(choiceAction(game, 'actual', 0), game);
  game = choiceAction(game, 'next');
  assert.equal(game.turn, 1);
  game = choiceAction(game, 'predict', 0);
  game = choiceAction(game, 'ready');
  game = choiceAction(game, 'actual', 1);
  assert.equal(game.phase, 'result');
  game = choiceAction(game, 'next');
  assert.equal(game.score, 1);
  assert.equal(game.phase, 'complete');
});

test('player counts are validated', () => {
  assert.equal(createMatchGame({ names: ['A'], prompts }).phase, 'error');
  assert.equal(createMatchGame({ names: Array.from({ length: 9 }, (_, i) => String(i)), prompts }).phase, 'error');
  assert.equal(createChoiceGame({ names: ['A'], prompts }).phase, 'error');
});

test('prompt continuation excludes used ids and supports a shorter final set', () => {
  const first = createMatchGame({ names: ['A', 'B'], prompts, usedPromptIds: [], rng: fixed, rounds: 6 });
  const second = createMatchGame({ names: ['A', 'B'], prompts, usedPromptIds: first.usedPromptIds, rng: fixed, rounds: 6 });
  assert.equal(first.prompts.length, 6);
  assert.equal(second.prompts.length, 2);
  assert.equal(new Set([...first.usedPromptIds, ...second.usedPromptIds]).size, 8);
  const exhausted = createMatchGame({ names: ['A', 'B'], prompts, usedPromptIds: [...first.usedPromptIds, ...second.usedPromptIds], rounds: 6 });
  assert.equal(exhausted.phase, 'exhausted');
});

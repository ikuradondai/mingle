// Pure in-memory state machines for the two one-device social games.
// No answer text is accepted or persisted by these APIs.
const ROUNDS = 6;
function pickPrompts(pool, rounds, usedIds = [], rng = Math.random) {
  const source = Array.isArray(pool) ? pool : [];
  const used = new Set(usedIds);
  const available = source.filter((p) => p && typeof p.id === 'string' && !used.has(p.id));
  if (available.length === 0) return { prompts: [], exhausted: true };
  const target = Math.min(rounds, available.length);
  const prompts = [];
  while (prompts.length < target) { const index = Math.max(0, Math.min(available.length - 1, Math.floor(rng() * available.length))); prompts.push(available.splice(index, 1)[0]); }
  return { prompts, exhausted: false };
}
function validNames(names, exact) { return Array.isArray(names) && names.length === exact && names.every((name) => typeof name === 'string' && name.trim()); }
export function createMatchGame({ names = [], prompts = [], usedPromptIds = [], rng = Math.random, rounds = ROUNDS } = {}) {
  if (!validNames(names, names.length) || names.length < 2 || names.length > 8) return { kind: 'match', phase: 'error', error: '一致ゲームは2〜8人で遊べます。' };
  const chosen = pickPrompts(prompts, rounds, usedPromptIds, rng);
  return { kind: 'match', names: names.slice(), prompts: chosen.prompts, cursor: 0, phase: chosen.exhausted ? 'exhausted' : 'question', countdown: 3, score: 0, results: [], usedPromptIds: chosen.prompts.map((p) => p.id), exhausted: chosen.exhausted, actionTaken: false };
}
export function matchAction(state, action) {
  if (!state || state.kind !== 'match' || state.phase === 'exhausted' || state.phase === 'complete') return state;
  if (state.phase === 'question' && action === 'start-countdown') return { ...state, phase: 'countdown', countdown: 3, actionTaken: false };
  if (state.phase === 'countdown' && action === 'tick') { if (state.countdown === 0) return { ...state, phase: 'judgement', actionTaken: false }; return { ...state, countdown: state.countdown - 1 }; }
  if (state.phase === 'judgement' && (action === 'match' || action === 'split') && !state.actionTaken) {
    const matched = action === 'match'; const results = state.results.concat({ promptId: state.prompts[state.cursor].id, matched }); const score = state.score + (matched ? 1 : 0);
    if (state.cursor + 1 >= state.prompts.length) return { ...state, phase: 'complete', results, score, actionTaken: true };
    return { ...state, phase: 'question', cursor: state.cursor + 1, results, score, actionTaken: true };
  }
  return state;
}
export function createChoiceGame({ names = [], prompts = [], usedPromptIds = [], rng = Math.random, rounds = ROUNDS } = {}) {
  if (!validNames(names, 2)) return { kind: 'choice', phase: 'error', error: '二択ゲームは2人で遊びます。' };
  const chosen = pickPrompts(prompts, rounds, usedPromptIds, rng);
  return { kind: 'choice', names: names.slice(0, 2), prompts: chosen.prompts, cursor: 0, phase: chosen.exhausted ? 'exhausted' : 'predict', turn: 0, prediction: null, actual: null, score: 0, results: [], usedPromptIds: chosen.prompts.map((p) => p.id), exhausted: chosen.exhausted };
}
export function choiceAction(state, action, value) {
  if (!state || state.kind !== 'choice' || state.phase === 'exhausted' || state.phase === 'complete') return state;
  if (state.phase === 'predict' && action === 'predict' && (value === 0 || value === 1)) return { ...state, phase: 'handoff', prediction: value };
  if (state.phase === 'handoff' && action === 'ready') return { ...state, phase: 'actual' };
  if (state.phase === 'actual' && action === 'actual' && (value === 0 || value === 1)) {
    const correct = value === state.prediction; const result = { promptId: state.prompts[state.cursor].id, prediction: state.prediction, actual: value, correct }; return { ...state, phase: 'result', actual: value, result, score: state.score + (correct ? 1 : 0) };
  }
  if (state.phase === 'result' && action === 'next' && state.result) {
    const results = state.results.concat(state.result);
    if (state.cursor + 1 >= state.prompts.length) return { ...state, phase: 'complete', results, result: null };
    return { ...state, phase: 'predict', cursor: state.cursor + 1, turn: state.turn === 0 ? 1 : 0, prediction: null, actual: null, result: null, results };
  }
  return state;
}
export function nextUsedPromptIds(state) { return Array.isArray(state?.usedPromptIds) ? state.usedPromptIds.slice() : []; }

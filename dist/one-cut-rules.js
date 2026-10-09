// Pure rules for 「ワンカット」. Shared by the server (server-side/one-cut.mjs), the browser and the tests.
// No I/O: randomness is injected (`random()` returns a float in [0, 1)).
export const ONE_CUT_SET_SIZE = 6;
export const ONE_CUT_LABELS = Object.freeze(['A', 'B', 'C', 'D', 'E', 'F']);
export const ONE_CUT_SCENES_EXHAUSTED = 'ONE_CUT_SCENES_EXHAUSTED';
const MAX_ATTEMPTS = 20;
const LOVE_LIMIT = 1;
const CATEGORY_LIMIT = 2;

const exhausted = () => Object.assign(new Error(ONE_CUT_SCENES_EXHAUSTED), { status: 409, code: ONE_CUT_SCENES_EXHAUSTED });

export function shuffled(items, random = Math.random) {
  const output = [...items];
  for (let i = output.length - 1; i > 0; i -= 1) {
    const n = Math.min(i, Math.floor(random() * (i + 1)));
    [output[i], output[n]] = [output[n], output[i]];
  }
  return output;
}

const categoryLimit = (category) => (category === 'love' ? LOVE_LIMIT : CATEGORY_LIMIT);

// Can `scene` join the already chosen scenes? (same expression is the most important rule)
function accepts(chosen, scene) {
  if (chosen.some((item) => item.expression === scene.expression)) return false;
  if (scene.similarGroup && chosen.some((item) => item.similarGroup === scene.similarGroup)) return false;
  return chosen.filter((item) => item.category === scene.category).length < categoryLimit(scene.category);
}

// Picks `size` scenes for one take and the index of the one the actor will perform.
//  - scenes already used as an answer never appear again
//  - scenes never shown as an option are preferred; shown ones fill the gap
export function pickSceneSet({ scenes, size = ONE_CUT_SET_SIZE, usedAnswerIds = [], usedOptionIds = [], random = Math.random }) {
  const usedAnswers = new Set(usedAnswerIds);
  const usedOptions = new Set(usedOptionIds);
  const candidates = (Array.isArray(scenes) ? scenes : []).filter((scene) => scene && !usedAnswers.has(scene.id));
  if (candidates.length < size) throw exhausted();
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const order = shuffled(candidates, random);
    const prioritized = [...order.filter((scene) => !usedOptions.has(scene.id)), ...order.filter((scene) => usedOptions.has(scene.id))];
    const chosen = [];
    for (const scene of prioritized) {
      if (accepts(chosen, scene)) chosen.push(scene);
      if (chosen.length === size) break;
    }
    if (chosen.length < size) continue;
    const options = shuffled(chosen, random).map((scene) => scene.id);
    const answerIndex = Math.min(size - 1, Math.floor(random() * size));
    return { options, answerIndex };
  }
  throw exhausted();
}

// Checks a set the same way pickSceneSet builds one. The database only checks ids / counts; this is the expression / category check.
export function validateSceneSet(scenes, optionIds, { size = ONE_CUT_SET_SIZE } = {}) {
  if (!Array.isArray(optionIds) || optionIds.length !== size) return { ok: false, reason: 'size' };
  if (new Set(optionIds).size !== optionIds.length) return { ok: false, reason: 'duplicate-id' };
  const byId = new Map((scenes || []).map((scene) => [scene.id, scene]));
  const chosen = optionIds.map((id) => byId.get(id));
  if (chosen.some((scene) => !scene)) return { ok: false, reason: 'unknown-id' };
  if (new Set(chosen.map((scene) => scene.expression)).size !== chosen.length) return { ok: false, reason: 'expression' };
  const groups = chosen.map((scene) => scene.similarGroup).filter(Boolean);
  if (new Set(groups).size !== groups.length) return { ok: false, reason: 'similar-group' };
  const perCategory = new Map();
  for (const scene of chosen) perCategory.set(scene.category, (perCategory.get(scene.category) || 0) + 1);
  for (const [category, count] of perCategory) if (count > categoryLimit(category)) return { ok: false, reason: 'category' };
  return { ok: true, reason: null };
}

// Take k (1-based) is played by members[(k - 1) % n]; `members` is already in room order (host first, then join order).
export function actorForTake(members, takeNo) {
  if (!Array.isArray(members) || !members.length || !Number.isInteger(takeNo) || takeNo < 1) throw new RangeError('invalid take');
  return members[(takeNo - 1) % members.length];
}
export const lapOfTake = (memberCount, takeNo) => Math.floor((takeNo - 1) / memberCount) + 1;
export const isLastTakeOfLap = (memberCount, takeNo) => takeNo % memberCount === 0;
// Default number of laps when the host did not choose: 2..4 players -> 2, 5..8 players -> 1.
export const defaultLapsFor = (memberCount) => (memberCount <= 4 ? 2 : 1);

// Scores one solo-actor take. votes: [{ voterId, choice }] (choice null / out of range = "わからない").
// Voters who never voted are simply absent. The actor's own entry in `votes` is ignored.
export function scoreSoloTake({ answerIndex, actorId, votes = [], size = ONE_CUT_SET_SIZE }) {
  const tally = Array.from({ length: size }, () => 0);
  let passCount = 0;
  const correctMemberIds = [];
  for (const vote of votes) {
    if (vote.voterId === actorId) continue;
    if (Number.isInteger(vote.choice) && vote.choice >= 0 && vote.choice < size) {
      tally[vote.choice] += 1;
      if (vote.choice === answerIndex) correctMemberIds.push(vote.voterId);
    } else passCount += 1;
  }
  const gained = Object.fromEntries(correctMemberIds.map((id) => [id, 1]));
  gained[actorId] = (gained[actorId] || 0) + correctMemberIds.length;
  return { tally, passCount, correctMemberIds, gained, actorGain: correctMemberIds.length };
}

// Winners of a lap's 主演賞: everyone tied for the most likes, nobody when there are no likes. `likes`: [{ targetId }].
export function lapAwardWinners(likes) {
  const counts = new Map();
  for (const like of likes) counts.set(like.targetId, (counts.get(like.targetId) || 0) + 1);
  const best = Math.max(0, ...counts.values());
  return best > 0 ? [...counts].filter(([, count]) => count === best).map(([id]) => id) : [];
}

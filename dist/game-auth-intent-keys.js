// The sessionStorage keys of the "log in, then come back and create the room" intents of the five group games.
// Only one game can be waiting for a login at a time, so saving one clears the other four.
const KEYS = {
  minority: "mingle.cards.minority-auth-return.v1",
  questionWolf: "mingle.cards.question-wolf-auth-return.v1",
  ochi: "mingle.cards.ochi-auth-return.v1",
  oneCut: "mingle.cards.one-cut-auth-return.v1",
  mission: "mingle.cards.mission-auth-return.v1",
};
export const gameAuthIntentKeys = Object.freeze({ ...KEYS });
export function clearOtherGameAuthIntents(own, storage) {
  for (const [game, key] of Object.entries(KEYS)) {
    if (game === own) continue;
    try {
      storage?.removeItem(key);
    } catch {}
  }
}

// Artwork used by the game cards in the group theme explorer.
// Keep this mapping separate from launch metadata so new game entries can
// retain the generic card fallback until their art is ready.
export const gameCardImages = {
  "minority-topic": "/assets/game-cards/minority-topic-v1.webp",
  match: "/assets/game-cards/match-v1.webp",
  choice: "/assets/game-cards/choice-v1.webp",
  "question-wolf": "/assets/game-cards/question-wolf-v1.webp",
};

export function gameCardImage(id) {
  return Object.prototype.hasOwnProperty.call(gameCardImages, id) ? gameCardImages[id] : "";
}

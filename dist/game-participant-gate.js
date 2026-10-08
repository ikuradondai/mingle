export function gameParticipantGate(game, participantCount) {
  const minParticipants = Number(game?.minParticipants);
  const maxParticipants = Number(game?.maxParticipants);
  const count = Number(participantCount);
  const hasBounds = Number.isInteger(minParticipants) && Number.isInteger(maxParticipants) && minParticipants > 0 && minParticipants <= maxParticipants;
  const valid = hasBounds && Number.isInteger(count) && count >= minParticipants && count <= maxParticipants;
  const label = !hasBounds ? "参加人数を確認してください" : minParticipants === maxParticipants ? `${minParticipants}人で遊べます` : `${minParticipants}〜${maxParticipants}人で遊べます`;
  return { valid, minParticipants, maxParticipants, label };
}

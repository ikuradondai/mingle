export function rankFor(rows, index) {
  return rows.findIndex((item) => item.score === rows[index].score) + 1;
}

export function answerDeadline(round) {
  const values = [round?.answerDueAt, round?.overallDueAt]
    .filter(Boolean)
    .map(Date.parse)
    .filter(Number.isFinite);
  return values.length ? new Date(Math.min(...values)).toISOString() : null;
}

export function normalizeQuizPhase(game = {}, room = {}) {
  const outer = String(game.phase || game.status || "lobby").toLowerCase();
  const inner = String(game.round?.phase || "").toLowerCase();
  const phase = outer === "playing" && inner ? inner : outer;
  if (room.status === "ended" || ["ended", "complete", "completed", "finished"].includes(phase)) return "ended";
  if (["waiting", "ready", "open", "lobby"].includes(phase)) return "lobby";
  if (["answering", "buzzing", "buzz", "question"].includes(phase)) return "question";
  if (["answer", "answering_choice"].includes(phase)) return "answer";
  if (["revealed", "reveal", "answer_reveal"].includes(phase)) return "reveal";
  return phase;
}

export function deadlineForPhase(game = {}, room = {}) {
  const round = game.round || game.currentRound || {};
  const phase = normalizeQuizPhase(game, room);
  if (phase === "reveal") return round.revealDueAt || null;
  if (phase === "question") return round.overallDueAt || null;
  if (phase === "answer") return answerDeadline(round);
  return null;
}

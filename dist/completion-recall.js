export function completionRecallKey(session) {
  return `${session?.sessionId || "session"}:${session?.roundStart ?? 0}`;
}

export function completionRecallCandidates(entries) {
  if (!Array.isArray(entries)) return [];
  const seen = new Set();
  return entries.filter((entry) => {
    const key = `${entry?.cardId || ""}:${entry?.participantIndex ?? ""}`;
    if (!entry?.cardId || !Number.isInteger(entry?.participantIndex) || seen.has(key)) return false;
    seen.add(key); return true;
  });
}

export function chooseRecallEntry(entries, current = null, random = Math.random) {
  const candidates = completionRecallCandidates(entries).filter((entry) => !current || entry.cardId !== current.cardId || entry.participantIndex !== current.participantIndex);
  if (!candidates.length) return null;
  return candidates[Math.min(candidates.length - 1, Math.floor(Math.max(0, Math.min(0.999999, Number(random()) || 0)) * candidates.length))];
}

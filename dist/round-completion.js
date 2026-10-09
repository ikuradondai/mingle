export const COMPLETION_ROUND_SIZE = 6;

export function roundCompletionInfo(session, roundSize = COMPLETION_ROUND_SIZE) {
  const total = Array.isArray(session?.questions) ? session.questions.length : 0;
  const cursor = Math.max(0, Math.min(Number(session?.cursor) || 0, total));
  const start = Math.max(0, Math.min(Number(session?.roundStart) || 0, cursor));
  const completed = cursor - start;
  const final = cursor >= total && total > 0;
  const remaining = Math.max(0, total - cursor);
  const size = Number.isInteger(roundSize) && roundSize > 0 ? roundSize : COMPLETION_ROUND_SIZE;
  return {
    total, cursor, start, completed, final, remaining,
    nextCount: Math.min(size, remaining),
    key: `${session?.sessionId || 'session'}:${start}:${cursor}`,
  };
}

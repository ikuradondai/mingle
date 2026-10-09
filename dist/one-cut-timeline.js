// Shooting-sequence timeline for 「ワンカット」. All instants come from the server (takeStartedAt / actionAt / cutAt);
// the client only replays them against a server-time estimate. Pure functions, no DOM.
export const SLATE_MS = 1500; // カチンコ「シーン◯、テイク1」
export const YOI_MS = 1000; // 「よーい…」
export const COUNT_STEP_MS = 1000; // 3 / 2 / 1
export const ACTION_HOLD_MS = 3000; // アクション -> カット
export const VOTE_DELAY_MS = 500; // カット -> 投票画面 (サーバーの遅延遷移と同じ値)
export const VOTE_WINDOW_MS = 40000; // カットから投票締切まで
export const START_LEAD_MS = 1000; // ready を受けてから T0 まで
export const ACTION_AFTER_START_MS = SLATE_MS + YOI_MS + COUNT_STEP_MS * 3; // 5500

const ms = (value) => {
  const t = Date.parse(value || '');
  return Number.isFinite(t) ? t : null;
};

// Stage of the sequence at server time `nowMs`.
// stage: 'standby' (before T0) | 'slate' | 'yoi' | 'count' (count = 3|2|1) | 'action' | 'cut' | 'vote'
export function stageAt(take, nowMs) {
  const start = ms(take?.takeStartedAt);
  const action = ms(take?.actionAt);
  const cut = ms(take?.cutAt);
  if (start === null || action === null || cut === null || !Number.isFinite(nowMs)) return { stage: 'standby', count: null, nextInMs: null };
  const result = (stage, nextAt, count = null) => ({ stage, count, nextInMs: nextAt === null ? null : Math.max(0, nextAt - nowMs) });
  if (nowMs < start) return result('standby', start);
  if (nowMs < action - COUNT_STEP_MS * 3 - YOI_MS) return result('slate', action - COUNT_STEP_MS * 3 - YOI_MS);
  if (nowMs < action - COUNT_STEP_MS * 3) return result('yoi', action - COUNT_STEP_MS * 3);
  for (const count of [3, 2, 1]) {
    const from = action - COUNT_STEP_MS * count;
    if (nowMs >= from && nowMs < from + COUNT_STEP_MS) return result('count', from + COUNT_STEP_MS, count);
  }
  if (nowMs < cut) return result('action', cut);
  if (nowMs < cut + VOTE_DELAY_MS) return result('cut', cut + VOTE_DELAY_MS);
  return result('vote', null);
}

// Sound cues (server-time instants) in playback order. Beeps on 3 / 2 / 1, the clapper on action and again on cut.
export function cueTimes(take) {
  const action = ms(take?.actionAt);
  const cut = ms(take?.cutAt);
  if (action === null || cut === null) return [];
  return [
    { kind: 'beep', at: action - COUNT_STEP_MS * 3 },
    { kind: 'beep', at: action - COUNT_STEP_MS * 2 },
    { kind: 'beep', at: action - COUNT_STEP_MS },
    { kind: 'clap', at: action },
    { kind: 'clap', at: cut },
  ];
}
// Cues still ahead of us, as delays in milliseconds. Cues already in the past are never replayed.
export function pendingCues(take, nowMs) {
  return cueTimes(take).filter((cue) => cue.at > nowMs).map((cue) => ({ kind: cue.kind, delayMs: cue.at - nowMs }));
}

// --- clock sync -------------------------------------------------------------------------------------------------
// A sample is one state fetch: { sentAt, receivedAt } on the local performance.now() clock and the response's serverNow (epoch ms).
// offset = serverNow - (sentAt + receivedAt) / 2, i.e. server epoch time = performance.now() + offset.
export const CLOCK_SAMPLES = 5;
export function makeClockSample({ sentAt, receivedAt, serverNowMs }) {
  if (![sentAt, receivedAt, serverNowMs].every(Number.isFinite) || receivedAt < sentAt) return null;
  return { rtt: receivedAt - sentAt, offset: serverNowMs - (sentAt + receivedAt) / 2 };
}
export function addClockSample(samples, sample, max = CLOCK_SAMPLES) {
  return sample ? [...samples, sample].slice(-max) : samples;
}
// Of the recent samples the one with the smallest round trip is the most trustworthy.
export function bestClockOffset(samples) {
  if (!samples.length) return null;
  return samples.reduce((best, sample) => (sample.rtt < best.rtt ? sample : best)).offset;
}
export const serverNowFrom = (perfNow, offset) => perfNow + (offset ?? 0);

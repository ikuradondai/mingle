// テスト用：トリセツ v2 の画面操作（applyAction）を、フィクスチャの答えで最後まで進める。
import { applyAction, setDraftText, createTorisetsuState } from '../../dist/torisetsu.js';
import { CHAPTERS } from '../../dist/data/torisetsu-content.js';

export function spyStorage(initial = {}, { throwOn = [] } = {}) {
  const data = new Map(Object.entries(initial));
  const calls = { getItem: 0, setItem: 0, removeItem: 0 };
  const guard = (name) => { calls[name] += 1; if (throwOn.includes(name)) throw new Error(`${name} blocked`); };
  return {
    data, calls,
    getItem(key) { guard('getItem'); return data.has(key) ? data.get(key) : null; },
    setItem(key, value) { guard('setItem'); data.set(key, String(value)); },
    removeItem(key) { guard('removeItem'); data.delete(key); },
  };
}

export const makeCtx = (storage = spyStorage(), extra = {}) => ({ storage, today: '2026-10-13', now: () => 1_000_000, ...extra });

const pick = (ts, ctx, group, ids) => { for (const chip of [].concat(ids)) if (chip) applyAction(ts, 'torisetsu-chip', { group, chip }, ctx); };

// 1 件分（1日／1出来事）を入力して「記録する」を押す
export function fillAndRecord(ts, ctx, chapterId, record) {
  if (chapterId === 'energy') {
    pick(ts, ctx, 'who', record.who); pick(ts, ctx, 'where', record.where); pick(ts, ctx, 'doing', record.doing);
    pick(ts, ctx, 'sleep', record.sleep); pick(ts, ctx, 'body', record.body);
  } else if (chapterId === 'values') {
    pick(ts, ctx, 'situation', record.situation); pick(ts, ctx, 'feeling', record.feeling);
  } else {
    pick(ts, ctx, 'kind', record.kind); pick(ts, ctx, 'task', record.task); pick(ts, ctx, 'who', record.who);
  }
  if (record.memo) setDraftText(ts, record.memo, 'memo', ctx);
  return applyAction(ts, 'torisetsu-record', {}, ctx);
}

// 章を最初から最後（トリセツに書く）まで進める。sides: { good: [...], bad: [...] } など。
export function runChapter(ts, ctx, chapterId, input, { surprise = '', experiment = '', surpriseText = '', experimentText = '', stopAt = 'done' } = {}) {
  const cfg = CHAPTERS.find((chapter) => chapter.id === chapterId);
  applyAction(ts, 'torisetsu-begin', {}, ctx);
  applyAction(ts, 'torisetsu-chapter-start', { chapter: chapterId }, ctx);
  for (const id of (chapterId === 'others' ? input.self : input.prediction) || []) applyAction(ts, 'torisetsu-chip', { group: 'prediction', chip: id }, ctx);
  applyAction(ts, 'torisetsu-next', {}, ctx);
  for (const side of cfg.sides) {
    const records = chapterId === 'others' ? input.episodes : input[side];
    applyAction(ts, 'torisetsu-recall-start', {}, ctx);
    for (let i = 0; i < cfg.init; i += 1) {
      if (records[i]) fillAndRecord(ts, ctx, chapterId, records[i]); else applyAction(ts, 'torisetsu-skip-item', {}, ctx);
    }
  }
  if (stopAt === 'lineup') return;
  applyAction(ts, 'torisetsu-find', {}, ctx);
  if (stopAt === 'insight') return;
  applyAction(ts, 'torisetsu-compare', {}, ctx);
  if (ts.step === 'gap') applyAction(ts, 'torisetsu-gap-next', {}, ctx);
  if (surprise) applyAction(ts, 'torisetsu-pick', { kind: 'surprise', key: surprise }, ctx);
  if (surpriseText) setDraftText(ts, surpriseText, 'surprise', ctx);
  applyAction(ts, 'torisetsu-surprise-next', {}, ctx);
  if (experiment) applyAction(ts, 'torisetsu-pick', { kind: 'experiment', key: experiment }, ctx);
  if (experimentText) setDraftText(ts, experimentText, 'experiment', ctx);
  applyAction(ts, 'torisetsu-finish', {}, ctx);
}

export { createTorisetsuState };

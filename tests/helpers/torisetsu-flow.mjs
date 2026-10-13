// テスト用：トリセツ v3 の画面操作（applyAction）を、フィクスチャの答えで最後まで進める。
import { applyAction, setDraftText, createTorisetsuState } from '../../dist/torisetsu.js';
import { CHAPTERS, LAYERS } from '../../dist/data/torisetsu-content.js';

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

// 第 1 章の 1 つの出来事を、層ごとに下りて「記録する」まで進める
export function fillLayers(ts, ctx, side, record) {
  const layers = LAYERS[side];
  layers.forEach((layer, index) => {
    if (index === 0) {
      if (record.memo) setDraftText(ts, record.memo, 'memo', ctx);
      pick(ts, ctx, 'scene', record.scene);
    } else {
      const key = layer.id;
      const ids = key === 'surface' ? record.surface : record[key];
      pick(ts, ctx, key, ids);
    }
    applyAction(ts, index === layers.length - 1 ? 'torisetsu-record' : 'torisetsu-layer-next', {}, ctx);
  });
}

// 第 2・3 章の 1 件（場面／出来事／いいなと思った人）を入力して「記録する」を押す
export function fillEpisode(ts, ctx, chapterId, side, record) {
  if (chapterId === 'voice') { pick(ts, ctx, 'scene', record.scene); pick(ts, ctx, 'thoughts', record.thoughts); }
  else if (side === 'admire') { pick(ts, ctx, 'who', record.who); pick(ts, ctx, 'qualities', record.qualities.map((q) => q.id || q)); }
  else pick(ts, ctx, 'situation', record.situation);
  if (record.memo) setDraftText(ts, record.memo, 'memo', ctx);
  return applyAction(ts, 'torisetsu-record', {}, ctx);
}

// 章を最初から最後（トリセツに書く）まで進める。data はフィクスチャの data（保存の形と同じ）。
export function runChapter(ts, ctx, chapterId, data, { surprise = '', experiment = '', surpriseText = '', experimentText = '', stopAt = 'done' } = {}) {
  const cfg = CHAPTERS.find((chapter) => chapter.id === chapterId);
  applyAction(ts, 'torisetsu-begin', {}, ctx);
  applyAction(ts, 'torisetsu-chapter-start', { chapter: chapterId }, ctx);
  if (cfg.predict) {
    for (const id of data.prediction || []) applyAction(ts, 'torisetsu-chip', { group: 'prediction', chip: id }, ctx);
    applyAction(ts, 'torisetsu-next', {}, ctx);
  }
  for (const side of cfg.sides) {
    const records = chapterId === 'voice' ? data.episodes : data[side];
    applyAction(ts, 'torisetsu-recall-start', {}, ctx);
    for (let i = 0; i < cfg.inits[side]; i += 1) {
      const record = records[i];
      if (!record) applyAction(ts, 'torisetsu-skip-item', {}, ctx);
      else if (chapterId === 'needs') fillLayers(ts, ctx, side, record);
      else fillEpisode(ts, ctx, chapterId, side, record);
    }
  }
  if (chapterId === 'values') {
    if (data.admire) fillEpisode(ts, ctx, 'values', 'admire', data.admire); else applyAction(ts, 'torisetsu-admire-skip', {}, ctx);
    // 並べる画面で「大事なこと」を選び直す
    for (const side of ['neg', 'pos']) (data[side] || []).filter(Boolean).forEach((record, index) => {
      if (record.value) applyAction(ts, 'torisetsu-value-set', { side, index: String(index), chip: record.value }, ctx);
    });
    (data.admire?.qualities || []).forEach((q, index) => { if (q.value) applyAction(ts, 'torisetsu-value-set', { side: 'admire', index: String(index), chip: q.value }, ctx); });
  }
  if (stopAt === 'lineup') return;
  applyAction(ts, 'torisetsu-find', {}, ctx);
  if (stopAt === 'insight') return;
  applyAction(ts, 'torisetsu-compare', {}, ctx);
  if (chapterId === 'voice') {
    pick(ts, ctx, 'intents', data.intents || []);
    applyAction(ts, 'torisetsu-protect-next', {}, ctx);
    if (data.reply) pick(ts, ctx, 'reply', data.reply);
    if (data.replyText) setDraftText(ts, data.replyText, 'reply', ctx);
    applyAction(ts, 'torisetsu-reply-next', {}, ctx);
  }
  if (ts.step === 'gap') applyAction(ts, 'torisetsu-gap-next', {}, ctx);
  if (surprise) applyAction(ts, 'torisetsu-pick', { kind: 'surprise', key: surprise }, ctx);
  if (surpriseText) setDraftText(ts, surpriseText, 'surprise', ctx);
  applyAction(ts, 'torisetsu-surprise-next', {}, ctx);
  if (experiment) applyAction(ts, 'torisetsu-pick', { kind: 'experiment', key: experiment }, ctx);
  if (experimentText) setDraftText(ts, experimentText, 'experiment', ctx);
  applyAction(ts, 'torisetsu-finish', {}, ctx);
}

export { createTorisetsuState };

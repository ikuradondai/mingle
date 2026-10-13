// 「自分のトリセツ」v2（気づき型）ビルダー。中身（答え）は端末の外に出さない。
// - このファイルは通信しない（fetch / XHR / sendBeacon / WebSocket / EventSource を使わない）。
// - analytics・account・session-storage を読み込まない。
// - storage は引数で受け取る（window / document に直接触れない）。
import {
  CHAPTERS, CHAPTER_IDS, COPY, MANUAL_COPY, MANUAL_SECTIONS, TEXT_MAX, NAME_MAX, DAY_MAX,
  DAY_GROUPS, DAY_CHIPS, ENERGY_PREDICTIONS, VALUE_PREDICTIONS, SITUATIONS, FEELINGS, VALUES, STRENGTHS, TASKS, KINDS, FROMS,
  STEP_LABELS, STEP_LABELS_OTHERS, SIDE_COPY, INTRO, DAY_MEMO, EPISODE_MEMO, episodeGroups,
} from './data/torisetsu-content.js';
import {
  energyInsights, valuesInsights, othersInsights, energyLineup, othersLineup, chapterReady, gapFor,
  teaser, othersPhrase, surpriseOptions, tryOptions, pruneChoices, shortOfSurprise, textOfTry, valueById,
} from './torisetsu-insight.js';

export { CHAPTERS, COPY };
export const STORAGE_KEY = 'mingle.torisetsu.v2';
export const STORAGE_KEY_V1 = 'mingle.torisetsu.v1';
export const UNDO_MS = 5000;
export const SAVE_MAX_LENGTH = 16000;

const CHAPTER_BY_ID = Object.fromEntries(CHAPTERS.map((chapter) => [chapter.id, chapter]));
export const chapterById = (id) => CHAPTER_BY_ID[id] || null;

// ---------- 文字の整え ----------
// 制御文字・改行を除き、コードポイント単位で max 字に切る。typing 中は trim しない。
export function sanitizeText(value, max = TEXT_MAX, { trim = true } = {}) {
  let text = typeof value === 'string' ? value : value == null ? '' : String(value);
  text = text.replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, ' ').replace(/\p{Cf}/gu, '');
  if (trim) text = text.replace(/\s+/g, ' ').trim();
  return Array.from(text).slice(0, max).join('');
}

// ---------- データの形 ----------
const emptyChoice = () => ({ surprise: '', surpriseText: '', experiment: '', experimentText: '', done: false });
export const emptyData = () => ({
  name: '',
  energy: { prediction: [], good: [], bad: [], ...emptyChoice() },
  values: { prediction: [], neg: [], pos: [], ...emptyChoice() },
  others: { self: [], episodes: [], ...emptyChoice() },
});
const clone = (value) => JSON.parse(JSON.stringify(value));

const idSet = (list) => new Set(list.map((item) => item.id));
const GROUP_CHIPS = Object.fromEntries(DAY_GROUPS.map((group) => [group.id, idSet(DAY_CHIPS.filter((chip) => chip.group === group.id))]));
const ENERGY_PREDICTION_IDS = idSet(ENERGY_PREDICTIONS);
const VALUE_IDS = idSet(VALUES);
const STRENGTH_IDS = idSet(STRENGTHS);
const SITUATION_BY_ID = Object.fromEntries(['neg', 'pos'].flatMap((side) => SITUATIONS[side].map((item) => [item.id, { ...item, side }])));
const FEELING_IDS = { neg: idSet(FEELINGS.neg), pos: idSet(FEELINGS.pos) };
const TASK_IDS = idSet(TASKS); const KIND_IDS = idSet(KINDS); const FROM_IDS = idSet(FROMS);
const KEY_PATTERN = /^[a-z:_]{1,40}$/;

const idList = (raw, allowed, max) => {
  const seen = new Set();
  return (Array.isArray(raw) ? raw : []).filter((id) => typeof id === 'string' && allowed.has(id) && !seen.has(id) && seen.add(id)).slice(0, max);
};
const one = (raw, allowed) => (typeof raw === 'string' && allowed.has(raw) ? raw : '');

function normalizeDay(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const day = {
    who: idList(raw.who, GROUP_CHIPS.who, 2), where: idList(raw.where, GROUP_CHIPS.where, 2), doing: idList(raw.doing, GROUP_CHIPS.doing, 3),
    sleep: one(raw.sleep, GROUP_CHIPS.sleep), body: one(raw.body, GROUP_CHIPS.body), memo: sanitizeText(raw.memo),
  };
  return day.who.length && day.where.length && day.doing.length && day.sleep && day.body ? day : null;
}
const normalizeSideEpisode = (side) => (raw) => {
  if (!raw || typeof raw !== 'object') return null;
  const situation = one(raw.situation, idSet(SITUATIONS[side]));
  const feeling = one(raw.feeling, FEELING_IDS[side]);
  if (!situation || !feeling) return null;
  const value = one(raw.value, VALUE_IDS) || SITUATION_BY_ID[situation].value;
  return { situation, value, feeling, memo: sanitizeText(raw.memo) };
};
function normalizeOther(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const kind = one(raw.kind, KIND_IDS); const task = one(raw.task, TASK_IDS);
  return kind && task ? { kind, task, who: one(raw.who, FROM_IDS), memo: sanitizeText(raw.memo) } : null;
}
function normalizeChoice(raw) {
  const out = emptyChoice();
  if (!raw || typeof raw !== 'object') return out;
  const text = (value) => sanitizeText(value);
  out.surpriseText = text(raw.surpriseText); out.experimentText = text(raw.experimentText);
  out.surprise = !out.surpriseText && typeof raw.surprise === 'string' && KEY_PATTERN.test(raw.surprise) ? raw.surprise : '';
  out.experiment = !out.experimentText && typeof raw.experiment === 'string' && KEY_PATTERN.test(raw.experiment) ? raw.experiment : '';
  out.done = raw.done === true;
  return out;
}

// 検査してきれいな形にする。知らない id は捨て、上限を超えたら先頭から。
export function normalizeData(raw) {
  const data = emptyData();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return data;
  data.name = sanitizeText(raw.name, NAME_MAX);
  const energy = raw.energy && typeof raw.energy === 'object' ? raw.energy : {};
  data.energy = {
    prediction: idList(energy.prediction, ENERGY_PREDICTION_IDS, 2),
    good: (Array.isArray(energy.good) ? energy.good : []).map(normalizeDay).filter(Boolean).slice(0, DAY_MAX),
    bad: (Array.isArray(energy.bad) ? energy.bad : []).map(normalizeDay).filter(Boolean).slice(0, DAY_MAX),
    ...normalizeChoice(energy),
  };
  const values = raw.values && typeof raw.values === 'object' ? raw.values : {};
  data.values = {
    prediction: idList(values.prediction, VALUE_IDS, 1),
    neg: (Array.isArray(values.neg) ? values.neg : []).map(normalizeSideEpisode('neg')).filter(Boolean).slice(0, 3),
    pos: (Array.isArray(values.pos) ? values.pos : []).map(normalizeSideEpisode('pos')).filter(Boolean).slice(0, 3),
    ...normalizeChoice(values),
  };
  const others = raw.others && typeof raw.others === 'object' ? raw.others : {};
  data.others = {
    self: idList(others.self, STRENGTH_IDS, 3),
    episodes: (Array.isArray(others.episodes) ? others.episodes : []).map(normalizeOther).filter(Boolean).slice(0, DAY_MAX),
    ...normalizeChoice(others),
  };
  pruneChoices(data);
  return data;
}

export function hasAnyAnswer(data) {
  if (!data) return false;
  if (data.name) return true;
  return CHAPTER_IDS.some((id) => chapterHasData(data, id) || data[id].done);
}
function chapterHasData(data, id) {
  const d = data[id];
  if (id === 'energy') return d.prediction.length + d.good.length + d.bad.length > 0;
  if (id === 'values') return d.prediction.length + d.neg.length + d.pos.length > 0;
  return d.self.length + d.episodes.length > 0;
}
export const doneCount = (data) => CHAPTER_IDS.filter((id) => data[id].done).length;
const hasDoneChapter = (data) => doneCount(data) > 0;
export function chapterStatus(data, id) {
  if (data[id].done) return 'done';
  return chapterHasData(data, id) ? 'doing' : 'todo';
}

// ---------- 端末への保存（localStorage。明示的に残すと選んだときだけ） ----------
export function resolveStorage(source) {
  try { const storage = typeof source === 'function' ? source() : source; return storage && typeof storage.getItem === 'function' ? storage : null; } catch { return null; }
}

const V1_TO_PREDICTION = { eat: 'do_eat', music: 'do_hobby', oshi: 'do_hobby', walk: 'out', sleep: 'sleep_good', chat: 'do_talk', bath: 'do_rest', free: 'do_rest' };
const isDate = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);

export function saveTorisetsu(source, data, today) {
  const storage = resolveStorage(source);
  if (!storage || typeof storage.setItem !== 'function') return { ok: false };
  try {
    const clean = normalizeData(data);
    const text = JSON.stringify({ version: 2, savedAt: isDate(today) ? today : '', data: clean });
    if (text.length > SAVE_MAX_LENGTH) return { ok: false };
    storage.setItem(STORAGE_KEY, text);
    try { storage.removeItem(STORAGE_KEY_V1); } catch { /* v1 が消せなくても v2 の保存は成功 */ }
    return { ok: true };
  } catch { return { ok: false }; }
}

// v1 の保存を読み、名前と「元気になるスイッチ」だけを v2 の形にする。
function migrateV1(storage, today) {
  let raw = null;
  try { raw = storage.getItem(STORAGE_KEY_V1); } catch { return null; }
  if (raw == null) return null;
  const dropV1 = () => { try { storage.removeItem(STORAGE_KEY_V1); } catch {} };
  let old;
  try { old = JSON.parse(raw); } catch { dropV1(); return null; }
  if (!old || typeof old !== 'object' || old.version !== 1 || !old.answers || typeof old.answers !== 'object') { dropV1(); return null; }
  const data = emptyData();
  data.name = sanitizeText(old.answers.name?.name, NAME_MAX);
  const chips = Array.isArray(old.answers.switch?.chips) ? old.answers.switch.chips : [];
  const prediction = [];
  for (const chip of chips) { const id = V1_TO_PREDICTION[chip]; if (id && !prediction.includes(id)) prediction.push(id); }
  data.energy.prediction = prediction.slice(0, 2);
  const moved = Boolean(data.name || data.energy.prediction.length);
  if (!moved) { dropV1(); return { data, savedAt: '', persisted: false, notice: COPY.noticeDiscarded, fromV1: false }; }
  const saved = saveTorisetsu(storage, data, today);
  if (saved.ok) dropV1(); // 書けなかったときは v1 を残し、次回また移行を試す
  return { data, savedAt: saved.ok && isDate(today) ? today : '', persisted: saved.ok, notice: COPY.noticeMigrated, fromV1: data.energy.prediction.length > 0 };
}

export function loadTorisetsu(source, { today = '' } = {}) {
  const storage = resolveStorage(source);
  if (!storage) return null;
  let raw = null;
  try { raw = storage.getItem(STORAGE_KEY); } catch { return null; }
  if (raw == null) return migrateV1(storage, today);
  const discard = () => { try { storage.removeItem(STORAGE_KEY); } catch {} return null; };
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return discard(); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || parsed.version !== 2 || !parsed.data || typeof parsed.data !== 'object' || Array.isArray(parsed.data)) return discard();
  const data = normalizeData(parsed.data);
  if (!hasAnyAnswer(data)) return discard();
  return { data, savedAt: isDate(parsed.savedAt) ? parsed.savedAt : '', persisted: true, notice: '', fromV1: false };
}

// v2 と v1 の両方を消す。
export function clearTorisetsu(source) {
  const storage = resolveStorage(source);
  if (!storage || typeof storage.removeItem !== 'function') return { ok: false };
  let ok = true;
  for (const key of [STORAGE_KEY, STORAGE_KEY_V1]) { try { storage.removeItem(key); } catch { ok = false; } }
  return { ok };
}

// ---------- 状態 ----------
const emptyDraft = (chapterId) => ({ ...Object.fromEntries(episodeGroups(chapterId, chapterId === 'values' ? 'neg' : 'good').map((group) => [group.id, []])), memo: '' });

export function createTorisetsuState({ stored = null } = {}) {
  const data = stored?.data ? clone(normalizeData(stored.data)) : emptyData();
  const has = hasAnyAnswer(data);
  return {
    view: 'start', chapterId: null, step: null, side: null, index: 0, phase: 'init', target: -1, returnTo: null,
    data, draft: null, stash: Object.create(null), slotMap: Object.create(null), lastStep: Object.create(null),
    textOpen: { surprise: false, experiment: false }, valuePicker: '', nameOpen: false,
    persisted: Boolean(stored?.persisted) && has, savedAt: stored?.persisted && has ? (stored.savedAt || '') : '',
    saveDeclined: false, saveError: '', notice: stored?.notice || '', v1Prediction: Boolean(stored?.fromV1),
    limitMessage: '', limitGroup: '', missingMessage: '', undo: null, leaveConfirm: false, imageStatus: '', imageBusy: false,
  };
}

export function expireUndo(ts, now = Date.now()) {
  if (ts.undo && now >= ts.undo.expiresAt) { ts.undo = null; return true; }
  return false;
}

const cfgOf = (ts) => CHAPTER_BY_ID[ts.chapterId];
export const sideList = (data, chapterId, side) => (chapterId === 'energy' ? data.energy[side] : chapterId === 'values' ? data.values[side] : data.others.episodes);
const stashKey = (ts) => `${ts.chapterId}:${ts.side}:${ts.phase}:${ts.index}`;
const slotMapOf = (ts, chapterId, side) => { const root = (ts.slotMap[chapterId] ||= {}); return (root[side] ||= []); };

function draftFromRecord(chapterId, record) {
  if (chapterId === 'energy') return { who: [...record.who], where: [...record.where], doing: [...record.doing], sleep: [record.sleep], body: [record.body], memo: record.memo };
  if (chapterId === 'values') return { situation: [record.situation], feeling: [record.feeling], memo: record.memo };
  return { kind: [record.kind], task: [record.task], who: record.who ? [record.who] : [], memo: record.memo };
}

function recordFromDraft(ts) {
  const draft = ts.draft; const memo = sanitizeText(draft.memo);
  if (ts.chapterId === 'energy') {
    return normalizeDay({ who: draft.who, where: draft.where, doing: draft.doing, sleep: draft.sleep[0], body: draft.body[0], memo });
  }
  if (ts.chapterId === 'values') {
    const existing = ts.target >= 0 ? sideList(ts.data, 'values', ts.side)[ts.target] : null;
    const situation = draft.situation[0];
    const value = existing && existing.situation === situation ? existing.value : SITUATION_BY_ID[situation]?.value;
    return normalizeSideEpisode(ts.side)({ situation, value, feeling: draft.feeling[0], memo });
  }
  return normalizeOther({ kind: draft.kind[0], task: draft.task[0], who: draft.who[0] || '', memo });
}

function missingGroupNames(ts) {
  return episodeGroups(ts.chapterId, ts.side).filter((group) => group.required && !(ts.draft[group.id] || []).length).map((group) => group.label.replace(/[？?]$/, ''));
}

function autosave(ts, ctx) {
  if (!ts.persisted) return;
  const result = saveTorisetsu(ctx.storage, ts.data, ctx.today);
  if (result.ok) { ts.savedAt = ctx.today || ts.savedAt; ts.saveError = ''; } else { ts.persisted = false; ts.saveError = COPY.saveFailed; }
}
function touch(ts, ctx) { pruneChoices(ts.data); autosave(ts, ctx); }

function setStep(ts, step, patch = {}) {
  Object.assign(ts, patch);
  ts.view = 'step'; ts.step = step;
  ts.limitMessage = ''; ts.limitGroup = ''; ts.missingMessage = ''; ts.valuePicker = '';
  if (ts.chapterId) ts.lastStep[ts.chapterId] = { step, side: ts.side, index: ts.index, phase: ts.phase, target: ts.target, returnTo: ts.returnTo };
}

function openSlot(ts, side, index, phase, target, returnTo) {
  const cfg = cfgOf(ts);
  ts.side = side; ts.index = index; ts.phase = phase; ts.target = target; ts.returnTo = returnTo;
  const record = target >= 0 ? sideList(ts.data, ts.chapterId, side)[target] : null;
  ts.draft = record ? draftFromRecord(ts.chapterId, record) : ts.stash[stashKey(ts)] ? clone(ts.stash[stashKey(ts)]) : emptyDraft(ts.chapterId);
  setStep(ts, cfg.unit === 'day' ? 'day' : 'episode');
}

function openIntro(ts, sideIndex) {
  const cfg = cfgOf(ts);
  setStep(ts, 'recall-intro', { side: cfg.sides[sideIndex], index: 0, phase: 'init', target: -1, returnTo: null });
}

function afterRecall(ts) {
  if (chapterReady(ts.chapterId, ts.data)) setStep(ts, 'lineup', { returnTo: null, phase: 'init' });
  else setStep(ts, 'short', { returnTo: null, phase: 'init' });
}

// 初回の流れで1枠すすむ（記録しても飛ばしても同じ）
function advanceInit(ts) {
  const cfg = cfgOf(ts);
  const sideIndex = cfg.sides.indexOf(ts.side);
  if (ts.index + 1 < cfg.init) { openSlot(ts, ts.side, ts.index + 1, 'init', slotMapOf(ts, ts.chapterId, ts.side)[ts.index + 1] ?? -1, null); return; }
  if (sideIndex + 1 < cfg.sides.length) { openIntro(ts, sideIndex + 1); return; }
  afterRecall(ts);
}

function leaveSlot(ts) {
  // 編集・追加の画面から、戻り先へ
  const target = ts.returnTo;
  ts.stash = Object.create(null);
  if (target === 'days') setStep(ts, 'days', { returnTo: null });
  else if (target === 'insight') setStep(ts, chapterReady(ts.chapterId, ts.data) ? 'insight' : 'short', { returnTo: null });
  else afterRecall(ts);
}

// 足りない側（足せる側）を選ぶ
function shortSide(ts) {
  const cfg = cfgOf(ts);
  const len = (side) => sideList(ts.data, ts.chapterId, side).length;
  if (ts.chapterId === 'values') {
    if (len('neg') === 0) return 'neg';
    if (len('pos') === 0) return 'pos';
    return len('neg') <= len('pos') && len('neg') < cfg.max ? 'neg' : len('pos') < cfg.max ? 'pos' : 'neg';
  }
  return cfg.sides.find((side) => len(side) < cfg.min) || cfg.sides.find((side) => len(side) < cfg.max) || cfg.sides[0];
}

function stepAfterInsight(ts) {
  const d = ts.data[ts.chapterId];
  if (ts.chapterId !== 'others' && d.prediction.length) {
    const gap = gapFor(ts.chapterId, ts.data);
    if (gap.rows.length) { setStep(ts, 'gap'); return; }
  }
  setStep(ts, 'surprise');
}

function resumeStep(ts, chapterId) {
  ts.chapterId = chapterId; ts.view = 'step'; ts.leaveConfirm = false; ts.notice = '';
  const last = ts.lastStep[chapterId];
  const data = ts.data; const ready = chapterReady(chapterId, data);
  if (last && (last.step === 'day' || last.step === 'episode')) {
    openSlot(ts, last.side, last.index, last.phase, last.target, last.returnTo); return;
  }
  if (last && last.step === 'recall-intro') { setStep(ts, 'recall-intro', { side: last.side, index: 0, phase: 'init', target: -1, returnTo: null }); return; }
  if (last && ['predict', 'lineup', 'insight', 'gap', 'surprise', 'try', 'days', 'short'].includes(last.step) && (ready || ['predict', 'short', 'days'].includes(last.step))) {
    setStep(ts, last.step, { side: last.side, index: last.index, phase: last.phase, target: last.target, returnTo: last.returnTo }); return;
  }
  if (ready) { setStep(ts, 'insight'); return; }
  if (chapterHasData(data, chapterId)) {
    const cfg = CHAPTER_BY_ID[chapterId];
    const hasRecords = cfg.sides.some((side) => sideList(data, chapterId, side).length > 0);
    setStep(ts, hasRecords ? 'short' : 'predict', { side: null, index: 0, phase: 'init', target: -1, returnTo: null }); return;
  }
  setStep(ts, 'predict', { side: null, index: 0, phase: 'init', target: -1, returnTo: null });
}

function openChapter(ts, chapterId, mode = 'smart') {
  if (!CHAPTER_BY_ID[chapterId]) return;
  ts.notice = ''; ts.chapterId = chapterId;
  const data = ts.data; const ready = chapterReady(chapterId, data);
  if (mode === 'start') { setStep(ts, 'predict', { side: null, index: 0, phase: 'init', target: -1, returnTo: null }); return; }
  if (mode === 'insight' && ready) { setStep(ts, 'insight', { returnTo: null }); return; }
  if (mode === 'days' && chapterHasData(data, chapterId)) { setStep(ts, 'days', { returnTo: null }); return; }
  if (mode === 'smart' && data[chapterId].done && ready) { setStep(ts, 'insight', { returnTo: null }); return; }
  resumeStep(ts, chapterId);
}

function requestLeave(ts) {
  if (!ts.persisted && hasAnyAnswer(ts.data)) { ts.leaveConfirm = true; return { render: true, focus: '[data-ts-default]' }; }
  return { leave: true };
}

function toggleIn(list, id, max, allowOff) {
  const index = list.indexOf(id);
  if (index >= 0) { if (allowOff || max > 1) list.splice(index, 1); return { changed: allowOff || max > 1 }; }
  if (max === 1) { list.splice(0, list.length, id); return { changed: true }; }
  if (list.length >= max) return { changed: false, full: true };
  list.push(id); return { changed: true };
}

function backFromStep(ts) {
  const cfg = cfgOf(ts);
  const stashDraft = () => { if (ts.draft && Object.values(ts.draft).some((value) => (Array.isArray(value) ? value.length : String(value).trim()))) ts.stash[stashKey(ts)] = clone(ts.draft); else delete ts.stash[stashKey(ts)]; };
  switch (ts.step) {
    case 'predict': ts.view = 'contents'; ts.step = null; return;
    case 'recall-intro': {
      const sideIndex = cfg.sides.indexOf(ts.side);
      if (sideIndex === 0) { setStep(ts, 'predict', { side: null }); return; }
      const prev = cfg.sides[sideIndex - 1];
      openSlot(ts, prev, cfg.init - 1, 'init', slotMapOf(ts, ts.chapterId, prev)[cfg.init - 1] ?? -1, null); return;
    }
    case 'day': case 'episode': {
      stashDraft();
      if (ts.phase === 'edit') { leaveSlot(ts); return; }
      if (ts.index > 0) { openSlot(ts, ts.side, ts.index - 1, 'init', slotMapOf(ts, ts.chapterId, ts.side)[ts.index - 1] ?? -1, null); return; }
      setStep(ts, 'recall-intro', { index: 0 }); return;
    }
    case 'short': {
      const last = cfg.sides[cfg.sides.length - 1];
      openSlot(ts, last, cfg.init - 1, 'init', slotMapOf(ts, ts.chapterId, last)[cfg.init - 1] ?? -1, null); return;
    }
    case 'lineup': setStep(ts, 'days', { returnTo: null }); return;
    case 'insight': setStep(ts, 'lineup'); return;
    case 'gap': setStep(ts, 'insight'); return;
    case 'surprise': { const gap = ts.chapterId !== 'others' && ts.data[ts.chapterId].prediction.length && gapFor(ts.chapterId, ts.data).rows.length; setStep(ts, gap ? 'gap' : 'insight'); return; }
    case 'try': setStep(ts, 'surprise'); return;
    case 'days': setStep(ts, chapterReady(ts.chapterId, ts.data) ? 'insight' : 'short'); return;
    case 'done': ts.view = 'contents'; ts.step = null; return;
    default: ts.view = 'contents'; ts.step = null;
  }
}

// 画面からの操作。状態を書きかえ、app.js に「何をするか」を返す。
export function applyAction(ts, action, data = {}, ctx = {}) {
  const now = typeof ctx.now === 'function' ? ctx.now() : Date.now();
  expireUndo(ts, now);
  const cfg = ts.chapterId ? CHAPTER_BY_ID[ts.chapterId] : null;
  switch (action) {
    case 'torisetsu-back': {
      if (ts.view === 'step') { backFromStep(ts); return { render: true, scrollTop: true }; }
      if (ts.view === 'manual') { ts.view = 'contents'; return { render: true, scrollTop: true }; }
      return requestLeave(ts);
    }
    case 'torisetsu-begin': case 'torisetsu-contents': ts.view = 'contents'; ts.step = null; ts.leaveConfirm = false; ts.notice = ''; ts.nameOpen = false; return { render: true, scrollTop: true };
    case 'torisetsu-manual': ts.view = 'manual'; ts.step = null; ts.leaveConfirm = false; ts.notice = ''; return { render: true, scrollTop: true };
    case 'torisetsu-chapter': openChapter(ts, data.chapter, 'smart'); return { render: true, scrollTop: true };
    case 'torisetsu-chapter-start': openChapter(ts, data.chapter, 'start'); return { render: true, scrollTop: true };
    case 'torisetsu-chapter-insight': openChapter(ts, data.chapter, 'insight'); return { render: true, scrollTop: true };
    case 'torisetsu-chapter-days': openChapter(ts, data.chapter, 'days'); return { render: true, scrollTop: true };
    case 'torisetsu-chip': {
      if (ts.view !== 'step') return { render: true };
      const focus = `[data-chip="${data.chip}"][data-group="${data.group}"]`;
      if (ts.step === 'predict') {
        const max = cfg.predict.max;
        const allowed = ts.chapterId === 'energy' ? ENERGY_PREDICTION_IDS : ts.chapterId === 'values' ? VALUE_IDS : STRENGTH_IDS;
        if (!allowed.has(data.chip)) return { render: true };
        const list = ts.chapterId === 'others' ? ts.data.others.self : ts.data[ts.chapterId].prediction;
        const result = toggleIn(list, data.chip, max, true);
        ts.limitMessage = result.full ? COPY.limitMessage(max) : ''; ts.limitGroup = result.full ? 'prediction' : '';
        ts.v1Prediction = false;
        if (result.changed) touch(ts, ctx);
        return { render: true, focus };
      }
      if ((ts.step === 'day' || ts.step === 'episode') && ts.draft) {
        const group = episodeGroups(ts.chapterId, ts.side).find((item) => item.id === data.group);
        if (!group || !group.chips.some((chip) => chip.id === data.chip) || !ts.draft[group.id]) return { render: true };
        const result = toggleIn(ts.draft[group.id], data.chip, group.max, !group.required);
        ts.limitMessage = result.full ? COPY.limitMessage(group.max) : ''; ts.limitGroup = result.full ? group.id : '';
        ts.missingMessage = '';
        return { render: true, focus };
      }
      return { render: true };
    }
    case 'torisetsu-next': { // 予想 → 思い出す（案内）
      if (ts.step !== 'predict') return { render: true };
      ts.v1Prediction = false;
      if (ts.chapterId === 'others' && !ts.data.others.self.length) return { render: true };
      openIntro(ts, 0); return { render: true, scrollTop: true };
    }
    case 'torisetsu-recall-start': {
      if (ts.step !== 'recall-intro') return { render: true };
      openSlot(ts, ts.side, 0, 'init', slotMapOf(ts, ts.chapterId, ts.side)[0] ?? -1, null); return { render: true, scrollTop: true };
    }
    case 'torisetsu-record': {
      if (ts.view !== 'step' || !(ts.step === 'day' || ts.step === 'episode') || !ts.draft) return { render: true };
      const record = recordFromDraft(ts);
      if (!record) { ts.missingMessage = COPY.missingGroups(missingGroupNames(ts)); return { render: true, focus: '[data-ts-missing]' }; }
      const list = sideList(ts.data, ts.chapterId, ts.side);
      let target = ts.target;
      if (ts.phase === 'init') target = slotMapOf(ts, ts.chapterId, ts.side)[ts.index] ?? -1;
      if (target >= 0 && target < list.length) list[target] = record;
      else if (list.length < cfg.max) { list.push(record); target = list.length - 1; }
      if (ts.phase === 'init') slotMapOf(ts, ts.chapterId, ts.side)[ts.index] = target;
      delete ts.stash[stashKey(ts)];
      touch(ts, ctx);
      if (ts.phase === 'init') advanceInit(ts); else leaveSlot(ts);
      return { render: true, scrollTop: true };
    }
    case 'torisetsu-skip-item': {
      if (ts.view !== 'step' || !(ts.step === 'day' || ts.step === 'episode')) return { render: true };
      delete ts.stash[stashKey(ts)];
      if (ts.phase === 'init') advanceInit(ts); else leaveSlot(ts);
      return { render: true, scrollTop: true };
    }
    case 'torisetsu-delete-item': {
      if (ts.view !== 'step' || ts.target < 0) return { render: true };
      const list = sideList(ts.data, ts.chapterId, ts.side);
      list.splice(ts.target, 1);
      // 初回の枠との結びつきをずらす
      const map = slotMapOf(ts, ts.chapterId, ts.side);
      for (let i = 0; i < map.length; i += 1) { if (map[i] === ts.target) map[i] = -1; else if (map[i] > ts.target) map[i] -= 1; }
      touch(ts, ctx);
      leaveSlot(ts);
      return { render: true, scrollTop: true };
    }
    case 'torisetsu-find': { if (ts.step === 'lineup') setStep(ts, 'insight'); return { render: true, scrollTop: true }; }
    case 'torisetsu-compare': { if (ts.step === 'insight') stepAfterInsight(ts); return { render: true, scrollTop: true }; }
    case 'torisetsu-gap-next': { if (ts.step === 'gap') setStep(ts, 'surprise'); return { render: true, scrollTop: true }; }
    case 'torisetsu-days': { if (ts.view === 'step') setStep(ts, 'days', { returnTo: null }); return { render: true, scrollTop: true }; }
    case 'torisetsu-days-done': {
      if (ts.step !== 'days') return { render: true };
      setStep(ts, chapterReady(ts.chapterId, ts.data) ? 'insight' : 'short'); return { render: true, scrollTop: true };
    }
    case 'torisetsu-edit-item': {
      if (ts.view !== 'step' || !cfg) return { render: true };
      const side = data.side || cfg.sides[0]; const index = Number(data.index);
      const list = sideList(ts.data, ts.chapterId, side);
      if (!cfg.sides.includes(side) || !Number.isInteger(index) || index < 0 || index >= list.length) return { render: true };
      openSlot(ts, side, index, 'edit', index, 'days'); return { render: true, scrollTop: true };
    }
    case 'torisetsu-add-item': {
      if (ts.view !== 'step' || !cfg) return { render: true };
      let side = data.side;
      if (!cfg.sides.includes(side)) side = shortSide(ts);
      const list = sideList(ts.data, ts.chapterId, side);
      if (list.length >= cfg.max) return { render: true };
      const returnTo = data.returnTo === 'insight' ? 'insight' : data.returnTo === 'days' ? 'days' : 'short';
      openSlot(ts, side, list.length, 'edit', -1, returnTo); return { render: true, scrollTop: true };
    }
    case 'torisetsu-skip-short': ts.view = 'contents'; ts.step = null; return { render: true, scrollTop: true };
    case 'torisetsu-value-open': { const key = `${data.side}:${data.index}`; ts.valuePicker = ts.valuePicker === key ? '' : key; return { render: true, focus: `[data-value-key="${key}"]` }; }
    case 'torisetsu-value-set': {
      const list = ts.chapterId === 'values' ? sideList(ts.data, 'values', data.side) : null;
      const index = Number(data.index);
      if (list && VALUE_IDS.has(data.chip) && list[index]) { list[index].value = data.chip; touch(ts, ctx); }
      const key = `${data.side}:${index}`; ts.valuePicker = '';
      return { render: true, focus: `[data-value-key="${key}"]` };
    }
    case 'torisetsu-pick': {
      if (!cfg || (data.kind !== 'surprise' && data.kind !== 'experiment')) return { render: true };
      const options = data.kind === 'surprise' ? surpriseOptions(ts.chapterId, ts.data) : tryOptions(ts.chapterId, ts.data);
      if (!options.some((item) => item.key === data.key)) return { render: true };
      const d = ts.data[ts.chapterId];
      d[data.kind] = d[data.kind] === data.key ? '' : data.key; d[`${data.kind}Text`] = '';
      ts.textOpen[data.kind] = false;
      touch(ts, ctx);
      return { render: true, focus: `[data-pick-key="${data.key}"]` };
    }
    case 'torisetsu-text-open': {
      if (data.kind !== 'surprise' && data.kind !== 'experiment') return { render: true };
      ts.textOpen[data.kind] = true; return { render: true, focus: `[data-ts-text="${data.kind}"]` };
    }
    case 'torisetsu-surprise-next': { if (ts.step === 'surprise') setStep(ts, 'try'); return { render: true, scrollTop: true }; }
    case 'torisetsu-finish': {
      if (ts.step !== 'try' || !cfg) return { render: true };
      ts.data[ts.chapterId].done = true; touch(ts, ctx);
      setStep(ts, 'done'); return { render: true, scrollTop: true };
    }
    case 'torisetsu-name-open': ts.nameOpen = true; return { render: true, focus: '[data-ts-name]' };
    case 'torisetsu-name-close': ts.nameOpen = false; return { render: true };
    case 'torisetsu-save': {
      if (!ts.persisted && !hasDoneChapter(ts.data)) return { render: false }; // 章が1つできるまでは残せない
      const result = saveTorisetsu(ctx.storage, ts.data, ctx.today);
      if (result.ok) { ts.persisted = true; ts.savedAt = ctx.today || ''; ts.saveError = ''; ts.saveDeclined = false; }
      else { ts.persisted = false; ts.saveError = COPY.saveFailed; }
      return { render: true };
    }
    case 'torisetsu-decline': ts.saveDeclined = true; ts.saveError = ''; return { render: true };
    case 'torisetsu-resave': ts.saveDeclined = false; return { render: true };
    case 'torisetsu-delete': {
      clearTorisetsu(ctx.storage);
      ts.undo = { data: clone(ts.data), expiresAt: now + UNDO_MS };
      ts.data = emptyData(); ts.stash = Object.create(null); ts.slotMap = Object.create(null); ts.lastStep = Object.create(null); ts.draft = null;
      ts.persisted = false; ts.savedAt = ''; ts.saveDeclined = false; ts.saveError = ''; ts.leaveConfirm = false; ts.notice = ''; ts.v1Prediction = false; ts.nameOpen = false;
      ts.view = 'start'; ts.step = null; ts.chapterId = null; ts.side = null; ts.returnTo = null;
      return { render: true, scrollTop: true, undoTimer: UNDO_MS };
    }
    case 'torisetsu-undo': {
      if (!ts.undo || now >= ts.undo.expiresAt) { ts.undo = null; return { render: true }; }
      ts.data = normalizeData(ts.undo.data); ts.undo = null; // 復元のみ。保存し直しはしない。
      ts.persisted = false; ts.view = 'contents'; ts.step = null;
      return { render: true, scrollTop: true };
    }
    case 'torisetsu-leave-confirm': return { leave: true };
    case 'torisetsu-leave-cancel': ts.leaveConfirm = false; return { render: true, focus: '[data-action="torisetsu-back"]' };
    case 'torisetsu-leave-keep': ts.leaveConfirm = false; ts.view = 'manual'; ts.step = null; return { render: true, scrollTop: true, focus: '[data-action="torisetsu-back"]' };
    case 'torisetsu-image': return { image: 'save' };
    case 'torisetsu-share': return { image: 'share' };
    default: return { render: false };
  }
}

// 自由文の入力（メモ・意外・ためす・製品名）
export function setDraftText(ts, value, field = 'memo', ctx = null) {
  if (field === 'name') { ts.data.name = sanitizeText(value, NAME_MAX, { trim: false }); if (ctx) autosave(ts, ctx); return; }
  if (field === 'memo') { if (ts.draft) ts.draft.memo = sanitizeText(value, TEXT_MAX, { trim: false }); return; }
  if ((field === 'surprise' || field === 'experiment') && ts.chapterId) {
    const d = ts.data[ts.chapterId];
    d[`${field}Text`] = sanitizeText(value, TEXT_MAX, { trim: false });
    if (d[`${field}Text`].trim()) d[field] = '';
    if (ctx) autosave(ts, ctx);
  }
}

export const draftComplete = (ts) => Boolean(ts.draft) && missingGroupNames(ts).length === 0;
export function isPicked(ts, kind, key) {
  const d = ts.data[ts.chapterId]; return Boolean(d) && !d[`${kind}Text`]?.trim() && d[kind] === key;
}
export function finishLabel(ts) {
  const d = ts.data[ts.chapterId];
  return d && (d.experiment || d.experimentText?.trim()) ? COPY.tryWrite : COPY.tryWriteNone;
}

// ---------- トリセツの組み立て ----------
function versionLabel(today) {
  const match = /^(\d{4})-(\d{2})/.exec(today || '');
  return match ? `第1版　${match[1]}年${Number(match[2])}月　｜　${COPY.manualAuthor}` : `第1版　｜　${COPY.manualAuthor}`;
}

const bullet = (text) => ({ kind: 'bullet', text });
const para = (text) => ({ kind: 'p', text });

export function composeManual(rawData, { today = '' } = {}) {
  const data = normalizeData(rawData);
  const ready = Object.fromEntries(CHAPTER_IDS.map((id) => [id, chapterReady(id, data)]));
  const energy = ready.energy ? energyInsights(data.energy.good, data.energy.bad) : null;
  const values = ready.values ? valuesInsights(data.values.neg, data.values.pos) : null;
  const others = ready.others ? othersInsights(data.others.self, data.others.episodes) : null;
  const build = {
    power: () => {
      if (!energy) return { state: 'todo' };
      const good = energy.ordered.good;
      const powered = good.filter((item) => item.feature.power).slice(0, 3);
      if (powered.length) return { state: 'filled', lines: [...powered.map((item) => bullet(item.feature.power)), para(MANUAL_COPY.powerOutro)] };
      if (good.length) return { state: 'filled', lines: [para(MANUAL_COPY.powerNoPower(good[0].tag))] };
      return { state: 'none' };
    },
    warning: () => {
      if (!energy) return { state: 'todo' };
      const lamps = energy.ordered.bad.filter((item) => item.feature.lamp).slice(0, 3);
      if (!lamps.length) return { state: 'none' };
      return { state: 'filled', lines: [para(MANUAL_COPY.warningIntro), ...lamps.map((item) => bullet(item.feature.lamp)), para(MANUAL_COPY.warningOutro)] };
    },
    values: () => {
      if (!values) return { state: 'todo' };
      if (values.empty) {
        const labels = values.candidates.slice(0, 3);
        return labels.length ? { state: 'filled', lines: [para(MANUAL_COPY.valuesCandidates), ...labels.map((item) => bullet(item.label))] } : { state: 'none' };
      }
      const shown = values.items;
      const hasNeg = shown.some((item) => item.a >= 1); const hasPos = shown.some((item) => item.p >= 1);
      const closing = hasNeg && hasPos ? MANUAL_COPY.valuesBoth : hasNeg ? MANUAL_COPY.valuesNeg : MANUAL_COPY.valuesPos;
      return { state: 'filled', lines: [...shown.map((item) => bullet(item.label)), para(closing)] };
    },
    request: () => {
      if (!values) return { state: 'todo' };
      if (values.empty) return { state: 'hidden' };
      return { state: 'filled', lines: [...values.items.map((item) => bullet(valueById(item.id).request)), para(MANUAL_COPY.requestOutro)] };
    },
    strengths: () => {
      if (!others) return { state: 'todo' };
      const lines = [];
      const main = [...others.both.map((row) => MANUAL_COPY.strengthsAndSelf(row.label)), ...others.onlyOthers.map((row) => MANUAL_COPY.strengthsOthers(row.label, othersPhrase(row.kinds, 'present')))].slice(0, 4);
      main.forEach((text) => lines.push(bullet(text)));
      if (others.selfOnly.length) { lines.push({ kind: 'sub', text: MANUAL_COPY.strengthsWaiting }); others.selfOnly.forEach((row) => lines.push(bullet(row.label))); }
      return lines.length ? { state: 'filled', lines } : { state: 'none' };
    },
    try: () => {
      const items = CHAPTERS.map((chapter) => textOfTry(chapter.id, data)).filter(Boolean);
      return items.length ? { state: 'filled', lines: [...items.map(bullet), para(MANUAL_COPY.tryOutro)] } : { state: 'hidden' };
    },
    surprise: () => {
      const items = CHAPTERS.map((chapter) => { const text = shortOfSurprise(chapter.id, data); return text ? `${chapter.short}：${text}` : ''; }).filter(Boolean);
      return items.length ? { state: 'filled', lines: items.map(bullet) } : { state: 'hidden' };
    },
  };
  const sections = MANUAL_SECTIONS.map((section, index) => {
    const built = build[section.id]();
    return {
      id: section.id, chapterId: section.chapterId, title: section.title, icon: section.icon, number: index + 1,
      chapterLabel: section.chapterId ? CHAPTER_BY_ID[section.chapterId].label : '', state: built.state, empty: built.state !== 'filled', lines: built.lines || [],
    };
  });
  const name = data.name;
  return {
    title: name ? `${name} 取扱説明書` : COPY.noName,
    nameEmpty: !name,
    version: versionLabel(today),
    sections,
    warranty: COPY.warranty,
  };
}

export const manualHasContent = (manual) => manual.sections.some((section) => section.state === 'filled');

export function sectionPlainText(section) {
  return section.lines.map((line) => (line.kind === 'bullet' ? `・${line.text}` : line.text)).join('\n');
}

// ---------- 見た目 ----------
const ICONS = {
  tag: '<path d="M4 12V5h7l9 9-7 7Z"/><circle cx="8" cy="9" r="1"/>',
  star: '<path d="m12 4 2.4 5 5.4.7-4 3.8 1 5.4-4.8-2.6-4.8 2.6 1-5.4-4-3.8 5.4-.7Z"/>',
  power: '<path d="M12 4v8"/><path d="M7.5 7.5a7 7 0 1 0 9 0"/>',
  lamp: '<path d="M12 4 3.5 19h17Z"/><path d="M12 10v4M12 16.6v.2"/>',
  wrench: '<path d="M14.5 5.5a4 4 0 0 0-4.6 5.2L4.5 16.1a1.9 1.9 0 0 0 2.7 2.7l5.4-5.4a4 4 0 0 0 5.2-4.6l-2.4 2.4-2.3-.6-.6-2.3Z"/>',
  drop: '<path d="M12 4s6 6.2 6 10.2A6 6 0 0 1 6 14.2C6 10.2 12 4 12 4Z"/>',
  hand: '<path d="M8 12V6.5a1.2 1.2 0 0 1 2.4 0V11M10.4 10V5a1.2 1.2 0 0 1 2.4 0v5.5M12.8 10.5V6a1.2 1.2 0 0 1 2.4 0v6M15.2 9.5a1.2 1.2 0 0 1 2.4 0V14a6 6 0 0 1-6 6h-.6a5 5 0 0 1-4-2L4.5 14.5a1.3 1.3 0 0 1 2-1.6L8 14.5"/>',
  bubble: '<path d="M5 6h14v9H11l-4 3.5V15H5Z"/>',
  doc: '<path d="M6 4h12v16H6z"/><path d="M9 8h6M9 12h6M9 16h4"/>',
  pencil: '<path d="m5 17-1 4 4-1L19 9l-3-3Z"/><path d="m14 7 3 3"/>',
  left: '<path d="m14 6-6 6 6 6"/>',
  lock: '<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7.5a4 4 0 0 1 8 0V10"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
};
export function iconSvg(name, size = 18) {
  return `<svg class="ts-icon" aria-hidden="true" focusable="false" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICONS[name] || ICONS.doc}</svg>`;
}
export const COVER_ICON = ICONS.doc;

function formatSavedDate(savedAt) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(savedAt || '');
  return match ? `${match[1]}年${Number(match[2])}月${Number(match[3])}日に保存` : '';
}

const STEP_INDEX = { predict: 0, 'recall-intro': 1, day: 1, episode: 1, short: 1, days: 1, lineup: 2, insight: 3, gap: 3, surprise: 4, try: 4 };

function stepperMarkup(ts, esc) {
  const labels = ts.chapterId === 'others' ? STEP_LABELS_OTHERS : STEP_LABELS;
  const now = STEP_INDEX[ts.step];
  if (now == null) return '';
  return `<ol class="ts-steps5" aria-label="進み具合">${labels.map((label, i) => `<li class="${i === now ? 'is-now' : i < now ? 'is-past' : ''}"${i === now ? ' aria-current="step"' : ''}>${esc(label)}</li>`).join('')}</ol>`;
}

function progressMarkup(ts, esc) {
  const done = doneCount(ts.data);
  const label = done >= CHAPTERS.length ? COPY.allDone : COPY.progressLabel(done);
  const cells = CHAPTERS.map((chapter) => `<span class="ts-cell${ts.data[chapter.id].done ? ' is-done' : ''}"></span>`).join('');
  return `<div class="ts-progress"><div class="ts-cells" role="img" aria-label="${esc(label)}">${cells}</div><p class="ts-progress-label">${esc(label)}</p></div>`;
}

function linesMarkup(lines, esc) {
  const out = []; let bullets = [];
  const flush = () => { if (bullets.length) out.push(`<ul class="ts-list">${bullets.join('')}</ul>`); bullets = []; };
  for (const line of lines) {
    if (line.kind === 'bullet') bullets.push(`<li>${esc(line.text)}</li>`);
    else if (line.kind === 'sub') { flush(); out.push(`<p class="ts-sub-head">${esc(line.text)}</p>`); }
    else { flush(); out.push(`<p>${esc(line.text)}</p>`); }
  }
  flush();
  return out.join('');
}

function sectionMarkup(section, { esc, editable }) {
  if (section.state === 'hidden') return '';
  const lampDot = section.id === 'warning' ? '<span class="ts-lamp" aria-hidden="true"></span>' : '';
  const chapterTag = section.chapterLabel ? `<span class="ts-sec-chapter">${esc(section.chapterLabel)}</span>` : '';
  const head = `<h3 class="ts-sec-title"><span class="ts-num" aria-hidden="true">${section.number}</span>${iconSvg(section.icon)}<span>${esc(section.title)}</span>${lampDot}</h3>${chapterTag}`;
  if (section.state === 'todo' || section.state === 'none') {
    const todo = section.state === 'todo';
    const button = editable && section.chapterId
      ? `<button type="button" class="ts-mini-button" data-action="${todo ? 'torisetsu-chapter' : 'torisetsu-chapter-days'}" data-chapter="${esc(section.chapterId)}" aria-label="${esc(section.title)}を${esc(todo ? COPY.todoButton : COPY.noneButton)}">${esc(todo ? COPY.todoButton : COPY.noneButton)}</button>` : '';
    return `<section class="ts-sec is-empty" data-ts-sec="${esc(section.id)}">${head}<div class="ts-empty"><span>${esc(todo ? COPY.todoBox : COPY.noneBox)}</span>${button}</div></section>`;
  }
  const edit = editable && section.chapterId
    ? `<button type="button" class="ts-edit" data-action="torisetsu-chapter-insight" data-chapter="${esc(section.chapterId)}" aria-label="${esc(section.title)}を直す" title="${esc(COPY.editSection)}">${iconSvg('pencil', 16)}<span>${esc(COPY.editSection)}</span></button>` : '';
  return `<section class="ts-sec" data-ts-sec="${esc(section.id)}">${head}${edit}<div class="ts-sec-body">${linesMarkup(section.lines, esc)}</div></section>`;
}

function nameBlock(ts, manual, esc, editable) {
  if (!editable) return '';
  if (ts.nameOpen || ts.data.name) {
    return `<div class="ts-name-edit">${ts.nameOpen ? `<label class="ts-field"><span>${esc(COPY.nameLabel)}</span><input type="text" inputmode="text" autocomplete="off" maxlength="${NAME_MAX}" data-ts-name value="${esc(ts.data.name)}" placeholder="${esc(COPY.namePlaceholder)}" /><small>${NAME_MAX}字まで</small></label><button type="button" class="ts-mini-button" data-action="torisetsu-name-close">${esc(COPY.nameDone)}</button>` : `<button type="button" class="ts-mini-button" data-action="torisetsu-name-open">製品名を直す</button>`}</div>`;
  }
  return `<div class="ts-empty ts-empty-cover"><span>${esc(COPY.nameEmpty)}</span><button type="button" class="ts-mini-button" data-action="torisetsu-name-open">${esc(COPY.nameButton)}</button></div>`;
}

function manualPaper(ts, { esc, today }, { sections = null, editable = true, cover = true } = {}) {
  const manual = composeManual(ts.data, { today });
  const list = sections ? sections(manual) : manual.sections;
  if (!cover && !list.length) return '';
  const coverMarkup = cover ? `<div class="ts-cover"><div class="ts-cover-text"><small>取扱説明書</small><strong>${esc(manual.title)}</strong></div><svg class="ts-cover-icon" aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${COVER_ICON}</svg></div><p class="ts-cover-meta">${esc(manual.version)}</p>${nameBlock(ts, manual, esc, editable)}` : '';
  const warranty = cover ? `<p class="ts-warranty">${esc(manual.warranty)}</p>` : '';
  return `<article class="ts-paper" aria-label="${esc(manual.title)}">${coverMarkup}${list.map((section) => sectionMarkup(section, { esc, editable })).join('')}${warranty}</article>`;
}

function saveCardMarkup(ts, esc) {
  if (!ts.persisted && !hasDoneChapter(ts.data)) return `<p class="ts-note ts-save-locked">${esc(COPY.saveLocked)}</p>`;
  if (ts.persisted) return `<section class="ts-save is-saved" aria-label="${esc(COPY.saveYes)}"><p class="ts-save-title">${iconSvg('lock', 16)}<span>${esc(COPY.saving)}</span></p><p>${esc(COPY.savedDone)}</p><button type="button" class="text-button ts-danger" data-action="torisetsu-delete">${esc(COPY.deleteManual)}</button></section>`;
  const error = ts.saveError ? `<p class="ts-save-error" role="alert">${esc(ts.saveError)}</p>` : '';
  if (ts.saveDeclined) return `<section class="ts-save is-declined">${error}<button type="button" class="text-button" data-action="torisetsu-resave">${esc(COPY.saveYes)}</button></section>`;
  return `<section class="ts-save" aria-labelledby="ts-save-title"><p class="ts-save-title" id="ts-save-title">${iconSvg('lock', 16)}<span>${esc(COPY.saveCardTitle)}</span></p><p>${esc(COPY.saveCardBody1)}<br>${esc(COPY.saveCardBody2)}</p>${error}<div class="ts-save-actions"><button type="button" class="primary-button" data-action="torisetsu-save">${esc(COPY.saveYes)}</button><button type="button" class="secondary-button" data-action="torisetsu-decline">${esc(COPY.saveNo)}</button></div></section>`;
}

// --- チップ ---
function chipGroupMarkup(ts, esc, { name, label, hint, max, chips, selected, groupId, radio, limitGroup }) {
  const full = selected.length >= max && max > 1;
  const message = ts.limitGroup === limitGroup ? ts.limitMessage : '';
  const buttons = chips.map((chip) => {
    const on = selected.includes(chip.id);
    const attrs = radio ? `role="radio" aria-checked="${on}"` : `aria-pressed="${on}"`;
    return `<button type="button" class="ts-chip${on ? ' is-on' : ''}${!on && full ? ' is-dim' : ''}" ${attrs} data-action="torisetsu-chip" data-group="${esc(groupId)}" data-chip="${esc(chip.id)}"><span>${esc(chip.label)}</span></button>`;
  }).join('');
  return `<div class="ts-group" data-ts-group="${esc(groupId)}"><h2 class="ts-group-head" id="ts-g-${esc(groupId)}">${esc(label)}${hint ? `<small>${esc(hint)}</small>` : ''}</h2><div class="ts-chips" role="${radio ? 'radiogroup' : 'group'}" aria-labelledby="ts-g-${esc(groupId)}">${buttons}</div><p class="ts-limit" role="status" aria-live="polite">${esc(message)}</p></div>`;
}

function predictView(ts, h) {
  const { esc } = h; const cfg = cfgOf(ts); const d = ts.data[ts.chapterId];
  const list = ts.chapterId === 'energy' ? ENERGY_PREDICTIONS : ts.chapterId === 'values' ? VALUE_PREDICTIONS : STRENGTHS.map(({ id, label }) => ({ id, label }));
  const selected = ts.chapterId === 'others' ? d.self : d.prediction;
  const ok = ts.chapterId !== 'others' || d.self.length > 0;
  return `<div class="ts-step" data-ts-key="predict">
    ${stepperMarkup(ts, esc)}
    <p class="ts-chapter-name">${esc(cfg.label)}</p>
    <h1 class="ts-q" tabindex="-1" data-focus>${esc(cfg.predict.title || cfg.predict.question)}</h1>
    ${cfg.predict.title ? `<p class="ts-lead">${esc(cfg.predict.question)}</p>` : ''}
    ${ts.v1Prediction && ts.chapterId === 'energy' ? `<p class="ts-note ts-v1note">${esc(COPY.predictFromV1)}</p>` : ''}
    ${chipGroupMarkup(ts, esc, { label: cfg.predict.hint, max: cfg.predict.max, chips: list, selected, groupId: 'prediction', radio: cfg.predict.max === 1, limitGroup: 'prediction' })}
    ${cfg.predict.footer ? `<p class="ts-note">${esc(cfg.predict.footer)}</p>` : ''}
    <div class="ts-actions"><button type="button" class="primary-button" data-action="torisetsu-next" ${ok ? '' : 'aria-disabled="true"'}>${esc(COPY.predictNext)}</button></div>
  </div>`;
}

function introView(ts, h) {
  const { esc } = h; const intro = INTRO[ts.side];
  return `<div class="ts-step" data-ts-key="intro:${esc(ts.side)}">
    ${stepperMarkup(ts, esc)}
    <h1 class="ts-q" tabindex="-1" data-focus>${esc(intro.title)}</h1>
    <div class="ts-intro ts-side-${SIDE_COPY[ts.side].color}">${intro.lines.map((line) => `<p>${esc(line)}</p>`).join('')}</div>
    <div class="ts-actions"><button type="button" class="primary-button" data-action="torisetsu-recall-start">${esc(intro.button)}</button></div>
  </div>`;
}

function itemView(ts, h) {
  const { esc } = h; const cfg = cfgOf(ts); const side = SIDE_COPY[ts.side];
  const groups = episodeGroups(ts.chapterId, ts.side);
  const isDay = cfg.unit === 'day';
  const n = ts.phase === 'init' ? ts.index + 1 : ts.target >= 0 ? ts.target + 1 : sideList(ts.data, ts.chapterId, ts.side).length + 1;
  const total = ts.phase === 'init' ? cfg.init : 0;
  const heading = ts.chapterId === 'others' ? `${side.label}　${COPY.episodeHeading(n, total)}` : isDay ? `${side.label}　${COPY.dayHeading(ts.side, n, total)}` : `${side.label}　${COPY.episodeHeading(n, total)}`;
  const placeholder = isDay ? DAY_MEMO[ts.side] : EPISODE_MEMO[ts.chapterId === 'others' ? 'others' : ts.side];
  const complete = missingGroupNames(ts).length === 0;
  const memoLen = Array.from(ts.draft.memo || '').length;
  const groupMarkup = groups.map((group) => chipGroupMarkup(ts, esc, {
    label: group.label, hint: group.optionalNote ? `（1つ・${group.optionalNote}）` : group.max > 1 ? `（${group.max}つまで）` : group.id === 'sleep' || group.id === 'body' ? '' : '（1つ）',
    max: group.max, chips: group.chips, selected: ts.draft[group.id] || [], groupId: group.id, radio: group.max === 1, limitGroup: group.id,
  })).join('');
  const record = isDay ? COPY.recordDay : ts.chapterId === 'values' ? COPY.recordEpisode : COPY.recordOther;
  const del = ts.phase === 'edit' && ts.target >= 0 ? `<button type="button" class="text-button ts-danger" data-action="torisetsu-delete-item">${esc(COPY.deleteDay)}</button>` : '';
  return `<div class="ts-step" data-ts-key="item">
    ${stepperMarkup(ts, esc)}
    <h1 class="ts-q" tabindex="-1" data-focus>${esc(heading)}</h1>
    ${groupMarkup}
    <label class="ts-field"><span>${esc(COPY.memoLabel)}</span><input type="text" inputmode="text" autocomplete="off" maxlength="${TEXT_MAX}" data-ts-text="memo" value="${esc(ts.draft.memo)}" placeholder="${esc(placeholder)}" /><small data-ts-count="memo">${esc(COPY.memoCount(memoLen, TEXT_MAX))}</small></label>
    <p class="ts-missing" role="status" aria-live="polite" tabindex="-1" data-ts-missing>${esc(ts.missingMessage)}</p>
    <div class="ts-actions"><button type="button" class="primary-button" data-action="torisetsu-record" data-ts-record ${complete ? '' : 'aria-disabled="true"'}>${esc(record)}</button><button type="button" class="text-button ts-skip" data-action="torisetsu-skip-item">${esc(COPY.skipItem)}</button>${del}</div>
    <p class="ts-sidebar ts-side-${side.color}" aria-hidden="true">${esc(side.label)}</p>
  </div>`;
}

function shortView(ts, h) {
  const { esc } = h; const cfg = cfgOf(ts);
  const text = ts.chapterId === 'energy' ? COPY.shortTitleEnergy : ts.chapterId === 'values' ? COPY.shortTitleValues : COPY.shortTitleOthers;
  const addSide = shortSide(ts);
  const addLabel = ts.chapterId === 'energy' ? COPY.addMoreDay : COPY.addMoreEpisode;
  return `<div class="ts-step" data-ts-key="short">
    ${stepperMarkup(ts, esc)}
    <h1 class="ts-q" tabindex="-1" data-focus>${esc(text)}</h1>
    <div class="ts-actions"><button type="button" class="primary-button" data-action="torisetsu-add-item" data-side="${esc(addSide)}" data-return-to="short">${esc(addLabel)}</button><button type="button" class="secondary-button" data-action="torisetsu-skip-short">${esc(COPY.later)}</button></div>
  </div>`;
}

const dotCell = (on, esc, cls = '') => `<td class="${[on ? 'is-on' : '', cls].filter(Boolean).join(' ')}"><span role="img" aria-label="${esc(on ? COPY.lineupYes : COPY.lineupNo)}">${on ? '●' : '・'}</span></td>`;

function lineupView(ts, h) {
  const { esc } = h;
  let body = '';
  if (ts.chapterId === 'energy') {
    const { good, bad } = ts.data.energy;
    const ins = energyInsights(good, bad);
    const found = new Set([...ins.ordered.good, ...ins.ordered.bad, ...ins.extra.good, ...ins.extra.bad].map((item) => item.id));
    const rows = energyLineup(good, bad);
    const days = (row) => row.good.filter(Boolean).length + row.bad.filter(Boolean).length;
    const main = rows.filter((row) => found.has(row.id) || days(row) >= 2);
    const single = rows.filter((row) => !found.has(row.id) && days(row) < 2);
    const head1 = `<tr><th scope="col" rowspan="2" class="ts-lineup-name"><span class="visually-hidden">特徴</span></th><th scope="colgroup" colspan="${good.length}" class="is-good">${esc(COPY.lineupGood)}</th><th scope="colgroup" colspan="${bad.length}" class="is-bad is-bad-first">${esc(COPY.lineupBad)}</th></tr>`;
    const head2 = `<tr>${good.map((_, i) => `<th scope="col" class="is-good">${i + 1}</th>`).join('')}${bad.map((_, i) => `<th scope="col" class="is-bad${i === 0 ? ' is-bad-first' : ''}">${i + 1}</th>`).join('')}</tr>`;
    const table = (list, offset) => {
      const trs = list.map((row, index) => `<tr class="${found.has(row.id) ? 'is-found' : ''}" style="--i:${offset + index}"><th scope="row">${esc(row.tag)}</th>${row.good.map((on) => dotCell(on, esc, 'is-good')).join('')}${row.bad.map((on, i) => dotCell(on, esc, `is-bad${i === 0 ? ' is-bad-first' : ''}`)).join('')}</tr>`).join('');
      return `<div class="ts-lineup-wrap" role="region" aria-label="並べた表" tabindex="0"><table class="ts-lineup"><caption class="visually-hidden">${esc(COPY.lineupTitle)}</caption><thead>${head1}${head2}</thead><tbody>${trs}</tbody></table></div>`;
    };
    const folded = single.length ? `<details class="ts-lineup-more"><summary>${esc(COPY.lineupOneDay(single.length))}</summary>${table(single, main.length)}</details>` : '';
    const memos = [...good.map((day, i) => day.memo ? `${COPY.lineupGood}${i + 1}「${day.memo}」` : ''), ...bad.map((day, i) => day.memo ? `${COPY.lineupBad}${i + 1}「${day.memo}」` : '')].filter(Boolean);
    body = `<p class="ts-lead">${esc(COPY.lineupLeadEnergy)}</p>${main.length ? table(main, 0) : ''}${folded}${memos.length ? `<p class="ts-memos">${esc(COPY.lineupMemo)}：${memos.map((m) => esc(m)).join('　')}</p>` : ''}`;
  } else if (ts.chapterId === 'values') {
    const ins = valuesInsights(ts.data.values.neg, ts.data.values.pos);
    const found = new Set(ins.ordered.map((item) => item.id));
    const section = (side) => {
      const list = ts.data.values[side];
      if (!list.length) return '';
      const items = list.map((ep, index) => {
        const situation = SITUATION_BY_ID[ep.situation]; const feeling = FEELINGS[side].find((item) => item.id === ep.feeling);
        const key = `${side}:${index}`; const open = ts.valuePicker === key;
        const picker = open ? `<div class="ts-chips" role="radiogroup" aria-label="${esc(COPY.changeValue)}">${VALUES.map((value) => `<button type="button" class="ts-chip${value.id === ep.value ? ' is-on' : ''}" role="radio" aria-checked="${value.id === ep.value}" data-action="torisetsu-value-set" data-side="${esc(side)}" data-index="${index}" data-chip="${esc(value.id)}"><span>${esc(value.label)}</span></button>`).join('')}</div>` : '';
        return `<li class="ts-ep${found.has(ep.value) ? ' is-found' : ''}" style="--i:${index}"><span class="ts-ep-text">${esc(situation.label)}（${esc(feeling?.label || '')}）</span><button type="button" class="ts-valbtn" data-action="torisetsu-value-open" data-side="${esc(side)}" data-index="${index}" data-value-key="${esc(key)}" aria-expanded="${open}" aria-label="${esc(valueById(ep.value).label)}。${esc(COPY.changeValue)}">→ ${esc(valueById(ep.value).label)}</button>${picker}</li>`;
      }).join('');
      return `<section class="ts-ep-group ts-side-${SIDE_COPY[side].color}"><h2>${esc(SIDE_COPY[side].label)}</h2><ol>${items}</ol></section>`;
    };
    body = `<p class="ts-lead">${esc(COPY.lineupLeadValues)}</p>${section('neg')}${section('pos')}<p class="ts-note">${esc(COPY.lineupNoteValues)}</p>`;
  } else {
    const ins = othersInsights(ts.data.others.self, ts.data.others.episodes);
    const rows = othersLineup(ts.data.others.self, ts.data.others.episodes);
    const foundIds = new Set(ins.onlyOthers.concat(ins.both).map((row) => row.id));
    const trs = rows.map((row, index) => `<tr class="${foundIds.has(row.id) ? 'is-found' : ''}" style="--i:${index}"><th scope="row">${esc(row.label)}</th><td class="${row.self ? 'is-on' : ''}"><span role="img" aria-label="${esc(row.self ? COPY.lineupYes : COPY.lineupNo)}">${row.self ? '✓' : '・'}</span></td><td class="${row.count ? 'is-on' : ''}"><span role="img" aria-label="${row.count}回">${row.count ? '●'.repeat(row.count) : '・'}</span></td></tr>`).join('');
    body = `<p class="ts-lead">${esc(COPY.lineupLeadOthers)}</p><div class="ts-lineup-wrap" role="region" aria-label="並べた表" tabindex="0"><table class="ts-lineup ts-lineup-others"><caption class="visually-hidden">${esc(COPY.lineupTitle)}</caption><thead><tr><th scope="col"><span class="visually-hidden">特長</span></th><th scope="col">${esc(COPY.lineupSelf)}</th><th scope="col">${esc(COPY.lineupOthers)}</th></tr></thead><tbody>${trs}</tbody></table></div>`;
  }
  return `<div class="ts-step" data-ts-key="lineup">
    ${stepperMarkup(ts, esc)}
    <h1 class="ts-q" tabindex="-1" data-focus>${esc(COPY.lineupTitle)}</h1>
    ${body}
    <p class="ts-lead">${esc(COPY.lineupAsk)}</p>
    <div class="ts-actions"><button type="button" class="primary-button" data-action="torisetsu-find">${esc(COPY.findCommon)}</button></div>
  </div>`;
}

function insightView(ts, h) {
  const { esc } = h; const cfg = cfgOf(ts); const d = ts.data[ts.chapterId];
  let body = ''; let actions = '';
  const hasGap = ts.chapterId !== 'others' && d.prediction.length > 0 && gapFor(ts.chapterId, ts.data).rows.length > 0;
  const primary = `<button type="button" class="primary-button" data-action="torisetsu-compare">${esc(hasGap ? COPY.compareGap : COPY.nextButton)}</button>`;
  if (ts.chapterId === 'energy') {
    const ins = energyInsights(d.good, d.bad);
    const dots = (cells) => cells.map((on) => (on ? '●' : '・')).join('');
    const findLi = (item, i) => {
      const row = item.row;
      return `<li class="ts-find" style="--i:${i}"><span class="visually-hidden">${esc(item.sentence)}</span><span class="ts-find-tag" aria-hidden="true">『${esc(row.tag)}』</span><span class="ts-count-row" aria-hidden="true"><span class="ts-count-own">${esc(row.own.label)} <span class="ts-dots">${dots(row.own.cells)}</span> ${esc(row.own.count)}</span><span class="ts-count-bar">｜</span><span class="ts-count-other">${esc(row.other.label)} <span class="ts-dots">${dots(row.other.cells)}</span> ${esc(row.other.count)}</span></span></li>`;
    };
    const band = (side, headA, headB) => {
      const items = ins[side]; const note = ins.sideNote[side];
      if (!items.length && !note && !ins.extra[side].length) return '';
      let index = 0;
      const group = (stage, label, cls) => {
        const list = items.filter((item) => item.stage === stage);
        return list.length ? `<h2 class="${cls}">${esc(label)}</h2><ul class="ts-finds">${list.map((item) => findLi(item, index++)).join('')}</ul>` : '';
      };
      const extra = ins.extra[side].length ? `<p class="ts-extra">${esc(COPY.extraEnergy)}${ins.extra[side].map((item) => `『${esc(item.tag)}』`).join('')}</p>` : '';
      return `<section class="ts-band ts-side-${side}">${group('A', headA, 'ts-band-head')}${group('B', headB, 'ts-band-sub')}${note ? `<p class="ts-note">${esc(note)}</p>` : ''}${extra}</section>`;
    };
    if (ins.empty) {
      const near = ins.nearMiss ? `<section class="ts-near"><h2>${esc(COPY.nearMissTitle)}</h2><ul class="ts-list"><li>${esc(ins.nearMiss.text)}</li></ul></section>` : '';
      body = `<p class="ts-insight-headline">${esc(COPY.insightNoneTitle)}</p><p class="ts-lead">${esc(COPY.insightNoneBody)}</p>${near}`;
      actions = `${d.good.length < DAY_MAX ? `<button type="button" class="secondary-button" data-action="torisetsu-add-item" data-side="good" data-return-to="insight">${esc(COPY.addGood)}</button>` : ''}${d.bad.length < DAY_MAX ? `<button type="button" class="secondary-button" data-action="torisetsu-add-item" data-side="bad" data-return-to="insight">${esc(COPY.addBad)}</button>` : ''}<button type="button" class="primary-button" data-action="torisetsu-compare">${esc(COPY.goOn)}</button>`;
    } else {
      body = `<p class="ts-insight-lead">${esc(COPY.insightIntro)}</p><p class="ts-compare-line">${esc(ins.compareLine)}</p>${ins.summary ? `<p class="ts-summary-line">${esc(ins.summary)}</p>` : ''}${band('good', COPY.bandGoodA, COPY.bandGood)}${band('bad', COPY.bandBadA, COPY.bandBad)}<p class="ts-note">${esc(ins.footerShort)}${esc(ins.footerAdd)}</p>`;
      actions = `${primary}<button type="button" class="secondary-button" data-action="torisetsu-days">${esc(COPY.fixDays)}</button>`;
    }
  } else if (ts.chapterId === 'values') {
    const ins = valuesInsights(d.neg, d.pos);
    if (ins.empty) {
      body = `<p class="ts-insight-headline">${esc(COPY.insightNoneValuesTitle)}</p><ul class="ts-list ts-cands">${ins.candidates.map((item) => `<li>${esc(item.label)}</li>`).join('')}</ul><p class="ts-lead">${esc(COPY.insightNoneValuesBody)}</p>`;
      actions = `${d.neg.length < 3 ? `<button type="button" class="secondary-button" data-action="torisetsu-add-item" data-side="neg" data-return-to="insight">${esc(COPY.addNeg)}</button>` : ''}${d.pos.length < 3 ? `<button type="button" class="secondary-button" data-action="torisetsu-add-item" data-side="pos" data-return-to="insight">${esc(COPY.addPos)}</button>` : ''}<button type="button" class="primary-button" data-action="torisetsu-compare">${esc(COPY.goOn)}</button>`;
    } else {
      const lis = ins.items.map((item, i) => `<li class="ts-find ts-find-block" style="--i:${i}"><span class="ts-find-text">${esc(item.sentence)}</span></li>`).join('');
      const extra = ins.extra.length ? `<p class="ts-extra">ほかに：${ins.extra.map((item) => `『${esc(item.label)}』`).join('')}</p>` : '';
      body = `<p class="ts-insight-lead">${esc(COPY.insightIntro)}</p><section class="ts-band ts-side-good"><ul class="ts-finds">${lis}</ul></section>${extra}<p class="ts-insight-summary">${esc(ins.summary)}</p><p class="ts-note">${esc(ins.footer)}</p>`;
      actions = `${primary}<button type="button" class="secondary-button" data-action="torisetsu-days">${esc(COPY.fixEpisodes)}</button>`;
    }
  } else {
    const ins = othersInsights(d.self, d.episodes);
    const lineBand = (kinds, label, cls) => {
      const lines = ins.lines.filter((line) => kinds.includes(line.kind));
      if (!lines.length) return '';
      return `<section class="ts-band ts-side-${cls}"><h2>${esc(label)}</h2><ul class="ts-finds">${lines.map((line, i) => `<li class="ts-find ts-find-block" style="--i:${i}"><span class="ts-find-text">${esc(line.text)}</span></li>`).join('')}</ul></section>`;
    };
    body = `<h2 class="ts-insight-headline">自分で思っていたこと と 人から見たこと</h2><p class="ts-insight-lead">${esc(COPY.insightIntro)}</p>${lineBand(['others'], ins.bandOthersLabel, 'good')}${lineBand(['both', 'match'], COPY.bandBoth, 'both')}${lineBand(['self'], COPY.bandSelfOnly, 'self')}<p class="ts-note">${esc(ins.footer)}</p>`;
    actions = `<button type="button" class="primary-button" data-action="torisetsu-compare">${esc(COPY.nextButton)}</button><button type="button" class="secondary-button" data-action="torisetsu-days">${esc(COPY.fixEpisodes)}</button>`;
  }
  return `<div class="ts-step ts-insight" data-ts-key="insight">
    ${stepperMarkup(ts, esc)}
    <h1 class="ts-q" tabindex="-1" data-focus>${esc(COPY.insightTitle)}</h1>
    ${body}
    <div class="ts-actions">${actions}</div>
  </div>`;
}

function gapView(ts, h) {
  const { esc } = h;
  const gap = gapFor(ts.chapterId, ts.data);
  const rows = gap.rows.map((row) => `<div class="ts-gap-row ts-verdict-${esc(row.verdict)}"><p class="ts-gap-thought">${esc(row.thought)}</p><p class="ts-gap-result">${esc(row.text)}</p></div>`).join('');
  return `<div class="ts-step ts-gap" data-ts-key="gap">
    ${stepperMarkup(ts, esc)}
    <h1 class="ts-q" tabindex="-1" data-focus>${esc(COPY.gapTitle)}</h1>
    ${rows}
    ${gap.actual ? `<p class="ts-gap-actual">${esc(gap.actual)}</p>` : ''}
    <div class="ts-actions"><button type="button" class="primary-button" data-action="torisetsu-gap-next">${esc(COPY.nextButton)}</button></div>
  </div>`;
}

function choiceListMarkup(ts, esc, kind, options) {
  const d = ts.data[ts.chapterId];
  const buttons = options.map((item) => { const on = isPicked(ts, kind, item.key); return `<button type="button" class="ts-chip ts-chip-wide${on ? ' is-on' : ''}" role="radio" aria-checked="${on}" data-action="torisetsu-pick" data-kind="${kind}" data-pick-kind="${kind}" data-pick-key="${esc(item.key)}" data-key="${esc(item.key)}"><span>${esc(item.label ?? item.text)}</span></button>`; }).join('');
  const open = ts.textOpen[kind] || Boolean(d[`${kind}Text`]);
  const placeholder = kind === 'surprise' ? COPY.surprisePlaceholder : COPY.tryPlaceholder;
  const free = open
    ? `<label class="ts-field ts-free"><span class="visually-hidden">${esc(COPY.freeWrite)}</span><input type="text" inputmode="text" autocomplete="off" maxlength="${TEXT_MAX}" data-ts-text="${kind}" value="${esc(d[`${kind}Text`])}" placeholder="${esc(placeholder)}" /><small data-ts-count="${kind}">${esc(COPY.freeCount(Array.from(d[`${kind}Text`]).length))}</small></label>`
    : `<button type="button" class="ts-write" data-action="torisetsu-text-open" data-kind="${kind}">＋ ${esc(COPY.freeWrite)}</button>`;
  return `<div class="ts-chips ts-chips-col" role="radiogroup" aria-labelledby="ts-pick-title">${buttons}</div>${free}`;
}

function surpriseView(ts, h) {
  const { esc } = h;
  return `<div class="ts-step" data-ts-key="surprise">
    ${stepperMarkup(ts, esc)}
    <h1 class="ts-q" tabindex="-1" data-focus id="ts-pick-title">${esc(COPY.surpriseTitle)}</h1>
    <p class="ts-hint">${esc(COPY.surpriseHint)}</p>
    ${choiceListMarkup(ts, esc, 'surprise', surpriseOptions(ts.chapterId, ts.data))}
    <div class="ts-actions"><button type="button" class="primary-button" data-action="torisetsu-surprise-next">${esc(COPY.nextButton)}</button></div>
  </div>`;
}

function tryView(ts, h) {
  const { esc } = h;
  return `<div class="ts-step" data-ts-key="try">
    ${stepperMarkup(ts, esc)}
    <h1 class="ts-q" tabindex="-1" data-focus id="ts-pick-title">${esc(COPY.tryTitle)}</h1>
    <p class="ts-hint">${esc(COPY.tryHint)}</p>
    ${choiceListMarkup(ts, esc, 'experiment', tryOptions(ts.chapterId, ts.data))}
    <p class="ts-note">${esc(COPY.tryFooter)}</p>
    <div class="ts-actions"><button type="button" class="primary-button" data-action="torisetsu-finish" data-ts-finish>${esc(finishLabel(ts))}</button></div>
  </div>`;
}

function daysView(ts, h) {
  const { esc } = h; const cfg = cfgOf(ts);
  const title = ts.chapterId === 'energy' ? COPY.daysTitleEnergy : COPY.daysTitleValues;
  const summaryOf = (record) => {
    if (ts.chapterId === 'energy') {
      const chip = (id) => DAY_CHIPS.find((item) => item.id === id)?.label || '';
      return [...record.doing, ...record.who, ...record.where].map(chip).filter(Boolean).slice(0, 4).join('・');
    }
    if (ts.chapterId === 'values') return `${SITUATION_BY_ID[record.situation]?.label || ''}（${(FEELINGS.neg.concat(FEELINGS.pos).find((item) => item.id === record.feeling) || {}).label || ''}）`;
    return `${KINDS.find((item) => item.id === record.kind)?.label || ''}：${TASKS.find((item) => item.id === record.task)?.label || ''}`;
  };
  const section = (side) => {
    const list = sideList(ts.data, ts.chapterId, side);
    const rows = list.map((record, index) => `<li><span class="ts-days-n">${index + 1}${ts.chapterId === 'energy' ? '日目' : 'つ目'}</span><span class="ts-days-text">${esc(summaryOf(record))}</span><button type="button" class="ts-mini-button" data-action="torisetsu-edit-item" data-side="${esc(side)}" data-index="${index}" aria-label="${index + 1}${ts.chapterId === 'energy' ? '日目' : 'つ目'}を${esc(COPY.fixOne)}">${esc(COPY.fixOne)}</button></li>`).join('');
    const add = list.length < cfg.max ? `<button type="button" class="secondary-button ts-add" data-action="torisetsu-add-item" data-side="${esc(side)}" data-return-to="days">${esc(ts.chapterId === 'energy' ? COPY.addOneDay : COPY.addOneEpisode)}</button>` : '';
    const heading = cfg.sides.length > 1 ? `<h2>${esc(SIDE_COPY[side].label)}</h2>` : '';
    return `<section class="ts-days-group ts-side-${SIDE_COPY[side].color}">${heading}<ol class="ts-days-list">${rows}</ol>${add}</section>`;
  };
  return `<div class="ts-step" data-ts-key="days">
    ${stepperMarkup(ts, esc)}
    <h1 class="ts-q" tabindex="-1" data-focus>${esc(title)}</h1>
    ${cfg.sides.map(section).join('')}
    <div class="ts-actions"><button type="button" class="primary-button" data-action="torisetsu-days-done">${esc(COPY.backToInsight)}</button></div>
  </div>`;
}

function doneView(ts, h) {
  const { esc, support } = h; const cfg = cfgOf(ts);
  const complete = doneCount(ts.data) >= CHAPTERS.length;
  const nextChapter = CHAPTERS.find((item) => !ts.data[item.id].done && item.id !== ts.chapterId);
  const primary = nextChapter && !complete
    ? `<button type="button" class="primary-button" data-action="torisetsu-chapter" data-chapter="${esc(nextChapter.id)}">${esc(COPY.doneNext(nextChapter.label))}</button>`
    : `<button type="button" class="primary-button" data-action="torisetsu-manual">${esc(COPY.viewManual)}</button>`;
  const paper = manualPaper(ts, h, { cover: false, editable: false, sections: (manual) => {
    const own = manual.sections.filter((section) => section.chapterId === ts.chapterId && section.state === 'filled');
    const tryText = textOfTry(ts.chapterId, ts.data);
    if (tryText) own.push({ id: 'try', chapterId: null, title: '来週ためしてみること', icon: 'wrench', number: 6, chapterLabel: '', state: 'filled', lines: [bullet(tryText), para(MANUAL_COPY.tryOutro)] });
    return own;
  } });
  return `<div class="ts-done" data-ts-key="done:${esc(ts.chapterId)}">
    <h1 class="ts-title" tabindex="-1" data-focus><span class="ts-done-check">${iconSvg('check', 22)}</span>${esc(cfg.done.title)}</h1>
    <p class="ts-lead">${esc(cfg.done.body)}</p>
    ${paper}
    ${progressMarkup(ts, esc)}
    <div class="ts-actions">${primary}<button type="button" class="secondary-button" data-action="torisetsu-contents">${esc(COPY.toContents)}</button></div>
    ${saveCardMarkup(ts, esc)}
    ${support ? support() : ''}
  </div>`;
}

function startView(ts, h) {
  const { esc } = h;
  const notice = ts.notice ? `<p class="ts-notice" role="status">${esc(ts.notice)}</p>` : '';
  const hasSaved = ts.persisted && hasAnyAnswer(ts.data);
  if (hasSaved) {
    const date = formatSavedDate(ts.savedAt);
    return `<div class="ts-start" data-ts-key="start">
      ${notice}
      <h1 class="ts-title" tabindex="-1" data-focus>${esc(COPY.savedTitle)}</h1>
      ${date ? `<p class="ts-sub">（${esc(date)}）</p>` : ''}
      <div class="ts-actions"><button type="button" class="primary-button" data-action="torisetsu-manual">${esc(COPY.viewManual)}</button><button type="button" class="secondary-button" data-action="torisetsu-contents">${esc(COPY.continueEdit)}</button></div>
      <p class="ts-note">${esc(COPY.deviceOnly)}</p>
      <button type="button" class="text-button ts-danger" data-action="torisetsu-delete">${esc(COPY.deleteManual)}</button>
    </div>`;
  }
  return `<div class="ts-start" data-ts-key="start">
    ${notice}
    <div class="ts-hero" aria-hidden="true"><svg viewBox="0 0 24 24" width="44" height="44" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${COVER_ICON}</svg></div>
    <h1 class="ts-title" tabindex="-1" data-focus>${esc(COPY.startTitle)}</h1>
    <p class="ts-lead">${esc(COPY.startLead)}</p>
    <div class="ts-privacy" role="note">${iconSvg('lock', 20)}<div><strong>${esc(COPY.privacyTitle)}</strong><p>${esc(COPY.privacyBody)}</p></div></div>
    <p class="ts-note">${esc(COPY.startGuide)}</p>
    <div class="ts-actions"><button type="button" class="primary-button" data-action="torisetsu-begin">${esc(COPY.begin)}</button></div>
  </div>`;
}

function contentsView(ts, h) {
  const { esc } = h;
  const done = doneCount(ts.data);
  const dots = CHAPTERS.map((chapter) => `<span class="ts-cell${ts.data[chapter.id].done ? ' is-done' : ''}"></span>`).join('');
  const rows = CHAPTERS.map((chapter) => {
    const status = chapterStatus(ts.data, chapter.id);
    const full = status === 'done';
    const label = full ? COPY.chapterReview : status === 'doing' ? COPY.chapterContinue : COPY.chapterStart;
    const line = chapterReady(chapter.id, ts.data) ? teaser(chapter.id, ts.data) : '';
    return `<li class="ts-chapter${full ? ' is-done' : ''}"><div><strong>${esc(chapter.label)}</strong><small>${esc(chapter.subtitle)}${full ? `　${iconSvg('check', 14)}${esc(COPY.chapterDoneMark)}` : ''}</small>${line ? `<small class="ts-teaser">${esc(line)}</small>` : ''}</div><button type="button" class="${full ? 'secondary-button' : 'primary-button'} ts-chapter-button" data-action="torisetsu-chapter" data-chapter="${esc(chapter.id)}" aria-label="${esc(chapter.label)}を${esc(label)}">${esc(label)}</button></li>`;
  }).join('');
  const label = done >= CHAPTERS.length ? COPY.allDone : COPY.progressLabel(done);
  const view = done > 0 || CHAPTER_IDS.some((id) => chapterReady(id, ts.data)) ? `<button type="button" class="secondary-button ts-view" data-action="torisetsu-manual">${esc(COPY.viewManual)}</button>` : '';
  return `<div class="ts-contents" data-ts-key="contents">
    <h1 class="ts-title" tabindex="-1" data-focus>${esc(COPY.contentsTitle)}</h1>
    <div class="ts-progress"><div class="ts-cells" role="img" aria-label="${esc(label)}">${dots}</div><p class="ts-progress-label">${esc(label)}</p></div>
    <ul class="ts-chapters">${rows}</ul>
    ${view}
  </div>`;
}

// 「送る」を出してよい端末か：ファイル共有ができて、タッチ操作が主の端末だけ。
export function canSendImage() {
  try {
    if (typeof File !== 'function' || typeof navigator === 'undefined') return false;
    if (typeof navigator.share !== 'function') return false;
    if (!window.matchMedia?.('(pointer: coarse)').matches) return false;
    const probe = new File([new Uint8Array(1)], 'my-torisetsu.png', { type: 'image/png' });
    return Boolean(navigator.canShare?.({ files: [probe] }));
  } catch { return false; }
}

function manualView(ts, helpers) {
  const { esc, support, imageEnabled, canSend, today } = helpers;
  const manual = composeManual(ts.data, { today });
  const image = imageEnabled !== false && manualHasContent(manual)
    ? `<section class="ts-share"><p>${esc(COPY.shareNote)}</p><div class="ts-share-buttons"><button type="button" class="secondary-button" data-action="torisetsu-image" ${ts.imageBusy ? 'disabled' : ''}>${esc(ts.imageBusy ? COPY.imageMaking : COPY.makeImage)}</button>${canSend ? `<button type="button" class="secondary-button" data-action="torisetsu-share" ${ts.imageBusy ? 'disabled' : ''}>${esc(COPY.sendImage)}</button>` : ''}</div>${canSend ? `<p class="ts-share-hint">${esc(COPY.sendHint)}</p>` : ''}<p class="ts-image-status" role="status" aria-live="polite">${esc(ts.imageStatus)}</p></section>`
    : '';
  return `<div class="ts-manual" data-ts-key="manual">
    <h1 class="visually-hidden" tabindex="-1" data-focus>わたしのトリセツ</h1>
    ${progressMarkup(ts, esc)}
    ${manualPaper(ts, helpers)}
    ${saveCardMarkup(ts, esc)}
    ${image}
    <div class="ts-actions"><button type="button" class="secondary-button" data-action="torisetsu-contents">${esc(COPY.toContents)}</button></div>
    ${support ? support() : ''}
  </div>`;
}

function stepView(ts, h) {
  switch (ts.step) {
    case 'predict': return predictView(ts, h);
    case 'recall-intro': return introView(ts, h);
    case 'day': case 'episode': return ts.draft ? itemView(ts, h) : contentsView(ts, h);
    case 'short': return shortView(ts, h);
    case 'lineup': return lineupView(ts, h);
    case 'insight': return insightView(ts, h);
    case 'gap': return gapView(ts, h);
    case 'surprise': return surpriseView(ts, h);
    case 'try': return tryView(ts, h);
    case 'days': return daysView(ts, h);
    case 'done': return doneView(ts, h);
    default: return contentsView(ts, h);
  }
}

export function torisetsuView(ts, helpers) {
  const { esc } = helpers;
  const h = { today: '', ...helpers };
  const body = ts.view === 'step' && ts.chapterId ? stepView(ts, h)
    : ts.view === 'contents' ? contentsView(ts, h)
    : ts.view === 'manual' ? manualView(ts, h)
    : startView(ts, h);
  const canKeep = hasDoneChapter(ts.data);
  const leaveButtons = canKeep
    ? `<button type="button" class="primary-button" data-ts-default data-action="torisetsu-leave-keep">${esc(COPY.leaveKeep)}</button><button type="button" class="secondary-button" data-action="torisetsu-leave-confirm">${esc(COPY.leaveClose)}</button>`
    : `<button type="button" class="primary-button" data-ts-default data-action="torisetsu-leave-cancel">${esc(COPY.leaveContinue)}</button><button type="button" class="secondary-button" data-action="torisetsu-leave-confirm">${esc(COPY.leaveClose)}</button>`;
  const leave = ts.leaveConfirm
    ? `<div class="ts-modal" data-ts-modal role="alertdialog" aria-modal="true" aria-labelledby="ts-leave-title"><div class="ts-modal-card"><p id="ts-leave-title">${esc(canKeep ? COPY.leaveTitle : COPY.leaveTitleLoss)}</p><div class="ts-save-actions">${leaveButtons}</div></div></div>`
    : '';
  const toast = ts.undo ? `<div class="ts-toast" role="status"><span>${esc(COPY.deletedToast)}</span><button type="button" class="ts-toast-button" data-action="torisetsu-undo">${esc(COPY.undo)}</button></div>` : '';
  return `<header class="topbar ts-topbar"><button type="button" class="ts-back" data-action="torisetsu-back" aria-label="${esc(COPY.back)}">${iconSvg('left', 20)}<span>${esc(COPY.back)}</span></button><strong class="ts-topbar-title">${esc(COPY.appTitle)}</strong><span class="ts-topbar-space" aria-hidden="true"></span></header><section class="content ts-content"><div class="ts-screen" data-ts-view="${esc(ts.view)}">${body}</div></section>${leave}${toast}`;
}

export function torisetsuViewKey(ts) {
  return `${ts.view}:${ts.chapterId || ''}:${ts.step || ''}:${ts.side || ''}:${ts.index}:${ts.phase}:${ts.target}`;
}

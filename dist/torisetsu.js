// 「自分のトリセツ」v3（内面をたどる型）ビルダー。中身（答え）は端末の外に出さない。
// - このファイルは通信しない（fetch / XHR / sendBeacon / WebSocket / EventSource を使わない）。
// - analytics・account・session-storage を読み込まない。
// - storage は引数で受け取る（window / document に直接触れない）。
import {
  CHAPTERS, CHAPTER_IDS, COPY, MANUAL_COPY, MANUAL_SECTIONS, TEXT_MAX, NAME_MAX,
  SCENES, SURFACE_HARD, DEEP, SURFACE_HAPPY, NEEDS, NEED_PREDICTIONS, LAYERS, layerGroups, episodeGroups,
  THOUGHTS, PATTERNS, REPLIES, INTENTS, VALUES, VALUE_PREDICTIONS, SITUATIONS, ADMIRE_WHO, QUALITIES,
  STEP_LABELS, STEP_LABELS_VOICE, SIDE_COPY, INTRO, MEMO_PLACEHOLDER,
} from './data/torisetsu-content.js';
import {
  needsInsights, voiceInsights, valuesInsights, needsLineup, voiceLineup, chapterReady, gapFor, heavyNote, crossLink,
  teaser, surpriseOptions, tryOptions, pruneChoices, shortOfSurprise, textOfTry, effectiveFocus, focusVoices, focusChoices, replyOptions,
  needById, valueById, qualityById, patternById, sceneById, surfaceById, deepById, thoughtById, intentById, admireWhoById, dotsOf,
} from './torisetsu-insight.js';

export { CHAPTERS, COPY };
export const STORAGE_KEY = 'mingle.torisetsu.v3';
export const STORAGE_KEY_V2 = 'mingle.torisetsu.v2';
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
  needs: { prediction: [], happy: [], hard: [], ...emptyChoice() },
  voice: { episodes: [], focus: '', intents: [], reply: '', replyText: '', ...emptyChoice() },
  values: { prediction: [], neg: [], pos: [], admire: null, ...emptyChoice() },
});
const clone = (value) => JSON.parse(JSON.stringify(value));

const idSet = (list) => new Set(list.map((item) => item.id));
const SCENE_IDS = idSet(SCENES); const SURFACE_IDS = idSet(SURFACE_HARD); const DEEP_IDS = idSet(DEEP); const FEELING_IDS = idSet(SURFACE_HAPPY);
const NEED_IDS = idSet(NEEDS); const THOUGHT_IDS = idSet(THOUGHTS); const PATTERN_IDS = idSet(PATTERNS); const REPLY_IDS = idSet(REPLIES);
const INTENT_IDS = idSet(INTENTS); const VALUE_IDS = idSet(VALUES); const WHO_IDS = idSet(ADMIRE_WHO); const QUALITY_BY_ID = new Map(QUALITIES.map((q) => [q.id, q]));
const SITUATION_BY_ID = Object.fromEntries(['neg', 'pos'].flatMap((side) => SITUATIONS[side].map((item) => [item.id, { ...item, side }])));
const KEY_PATTERN = /^[a-z:_]{1,48}$/;

const idList = (raw, allowed, max) => {
  const seen = new Set();
  return (Array.isArray(raw) ? raw : []).filter((id) => typeof id === 'string' && allowed.has(id) && !seen.has(id) && seen.add(id)).slice(0, max);
};
const one = (raw, allowed) => (typeof raw === 'string' && allowed.has(raw) ? raw : '');
const isObject = (raw) => Boolean(raw) && typeof raw === 'object' && !Array.isArray(raw);

function normalizeHappy(raw) {
  if (!isObject(raw)) return null;
  const ep = { scene: one(raw.scene, SCENE_IDS), memo: sanitizeText(raw.memo), feelings: idList(raw.feelings, FEELING_IDS, 2), needs: idList(raw.needs, NEED_IDS, 2) };
  return ep.scene || ep.memo || ep.feelings.length || ep.needs.length ? ep : null;
}
function normalizeHard(raw) {
  if (!isObject(raw)) return null;
  const ep = { scene: one(raw.scene, SCENE_IDS), memo: sanitizeText(raw.memo), surface: one(raw.surface, SURFACE_IDS), deep: idList(raw.deep, DEEP_IDS, 2), needs: idList(raw.needs, NEED_IDS, 2) };
  return ep.scene || ep.memo || ep.surface || ep.deep.length || ep.needs.length ? ep : null;
}
function normalizeVoiceEp(raw) {
  if (!isObject(raw)) return null;
  const thoughts = idList(raw.thoughts, THOUGHT_IDS, 2);
  return thoughts.length ? { scene: one(raw.scene, SCENE_IDS), memo: sanitizeText(raw.memo), thoughts } : null;
}
const normalizeSideEpisode = (side) => (raw) => {
  if (!isObject(raw)) return null;
  const situation = one(raw.situation, idSet(SITUATIONS[side]));
  if (!situation) return null;
  const value = one(raw.value, VALUE_IDS) || SITUATION_BY_ID[situation].value;
  return { situation, value, memo: sanitizeText(raw.memo) };
};
function normalizeAdmire(raw) {
  if (!isObject(raw)) return null;
  const seen = new Set(); const qualities = [];
  for (const q of Array.isArray(raw.qualities) ? raw.qualities : []) {
    const id = typeof q === 'string' ? q : q?.id;
    if (typeof id !== 'string' || !QUALITY_BY_ID.has(id) || seen.has(id) || qualities.length >= 2) continue;
    seen.add(id);
    qualities.push({ id, value: one(q?.value, VALUE_IDS) || QUALITY_BY_ID.get(id).value });
  }
  return qualities.length ? { who: one(raw.who, WHO_IDS), qualities, memo: sanitizeText(raw.memo) } : null;
}
function normalizeChoice(raw) {
  const out = emptyChoice();
  if (!isObject(raw)) return out;
  const text = (value) => sanitizeText(value);
  out.surpriseText = text(raw.surpriseText); out.experimentText = text(raw.experimentText);
  out.surprise = !out.surpriseText && typeof raw.surprise === 'string' && KEY_PATTERN.test(raw.surprise) ? raw.surprise : '';
  out.experiment = !out.experimentText && typeof raw.experiment === 'string' && KEY_PATTERN.test(raw.experiment) ? raw.experiment : '';
  out.done = raw.done === true;
  return out;
}
const list = (raw, fn, max) => (Array.isArray(raw) ? raw : []).map(fn).filter(Boolean).slice(0, max);

// 検査してきれいな形にする。知らない id は捨て、上限を超えたら先頭から。
export function normalizeData(raw) {
  const data = emptyData();
  if (!isObject(raw)) return data;
  data.name = sanitizeText(raw.name, NAME_MAX);
  const needs = isObject(raw.needs) ? raw.needs : {};
  data.needs = {
    prediction: idList(needs.prediction, NEED_IDS, 1),
    happy: list(needs.happy, normalizeHappy, CHAPTER_BY_ID.needs.maxes.happy),
    hard: list(needs.hard, normalizeHard, CHAPTER_BY_ID.needs.maxes.hard),
    ...normalizeChoice(needs),
  };
  const voice = isObject(raw.voice) ? raw.voice : {};
  const replyText = sanitizeText(voice.replyText);
  data.voice = {
    episodes: list(voice.episodes, normalizeVoiceEp, CHAPTER_BY_ID.voice.maxes.voice),
    focus: one(voice.focus, PATTERN_IDS),
    intents: idList(voice.intents, INTENT_IDS, 2),
    reply: replyText ? '' : one(voice.reply, REPLY_IDS),
    replyText,
    ...normalizeChoice(voice),
  };
  const values = isObject(raw.values) ? raw.values : {};
  data.values = {
    prediction: idList(values.prediction, VALUE_IDS, 1),
    neg: list(values.neg, normalizeSideEpisode('neg'), CHAPTER_BY_ID.values.maxes.neg),
    pos: list(values.pos, normalizeSideEpisode('pos'), CHAPTER_BY_ID.values.maxes.pos),
    admire: normalizeAdmire(values.admire),
    ...normalizeChoice(values),
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
  if (id === 'needs') return d.prediction.length + d.happy.length + d.hard.length > 0;
  if (id === 'voice') return d.episodes.length > 0;
  return d.prediction.length + d.neg.length + d.pos.length + (d.admire ? 1 : 0) > 0;
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
const isDate = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);

export function saveTorisetsu(source, data, today) {
  const storage = resolveStorage(source);
  if (!storage || typeof storage.setItem !== 'function') return { ok: false };
  try {
    const clean = normalizeData(data);
    const text = JSON.stringify({ version: 3, savedAt: isDate(today) ? today : '', data: clean });
    if (text.length > SAVE_MAX_LENGTH) return { ok: false };
    storage.setItem(STORAGE_KEY, text);
    for (const key of [STORAGE_KEY_V2, STORAGE_KEY_V1]) { try { storage.removeItem(key); } catch { /* 古い保存が消せなくても v3 の保存は成功 */ } }
    return { ok: true };
  } catch { return { ok: false }; }
}

// v2・v1 の保存から「製品名」だけを引き継ぐ。ほかの答えは新しい作り方では使えないので捨てる。
function migrateOld(storage, today) {
  let raw2 = null; let raw1 = null;
  try { raw2 = storage.getItem(STORAGE_KEY_V2); raw1 = storage.getItem(STORAGE_KEY_V1); } catch { return null; }
  if (raw2 == null && raw1 == null) return null;
  const parse = (raw, version) => { try { const old = JSON.parse(raw); return isObject(old) && old.version === version ? old : null; } catch { return null; } };
  const dropOld = () => { for (const key of [STORAGE_KEY_V2, STORAGE_KEY_V1]) { try { storage.removeItem(key); } catch { /* 消せなくても画面は進める */ } } };
  let name = ''; let readable = false;
  const old2 = raw2 != null ? parse(raw2, 2) : null;
  if (old2) { readable = true; name = sanitizeText(old2.data?.name, NAME_MAX); }
  if (!name && raw1 != null) {
    const old1 = parse(raw1, 1);
    if (old1) { readable = true; name = sanitizeText(old1.answers?.name?.name, NAME_MAX); }
  }
  if (!name) { dropOld(); return readable ? { data: emptyData(), savedAt: '', persisted: false, notice: COPY.noticeDiscarded } : null; }
  const data = emptyData(); data.name = name;
  const saved = saveTorisetsu(storage, data, today); // 書けたら v2・v1 も消える。書けなければ古いキーは残し、次回また試す。
  return { data, savedAt: saved.ok && isDate(today) ? today : '', persisted: saved.ok, notice: COPY.noticeMigrated };
}

export function loadTorisetsu(source, { today = '' } = {}) {
  const storage = resolveStorage(source);
  if (!storage) return null;
  let raw = null;
  try { raw = storage.getItem(STORAGE_KEY); } catch { return null; }
  if (raw == null) return migrateOld(storage, today);
  const discard = () => { try { storage.removeItem(STORAGE_KEY); } catch { /* 消せなくても保存なし扱い */ } return null; };
  let parsed;
  try { parsed = JSON.parse(raw); } catch { return discard(); }
  if (!isObject(parsed) || parsed.version !== 3 || !isObject(parsed.data)) return discard();
  const data = normalizeData(parsed.data);
  if (!hasAnyAnswer(data)) return discard();
  return { data, savedAt: isDate(parsed.savedAt) ? parsed.savedAt : '', persisted: true, notice: '' };
}

// v3・v2・v1 のすべてを消す。
export function clearTorisetsu(source) {
  const storage = resolveStorage(source);
  if (!storage || typeof storage.removeItem !== 'function') return { ok: false };
  let ok = true;
  for (const key of [STORAGE_KEY, STORAGE_KEY_V2, STORAGE_KEY_V1]) { try { storage.removeItem(key); } catch { ok = false; } }
  return { ok };
}

// ---------- 状態 ----------
function emptyDraft(chapterId, side) {
  if (chapterId === 'needs') return { scene: [], surface: [], deep: [], feelings: [], needs: [], memo: '' };
  if (chapterId === 'voice') return { scene: [], thoughts: [], memo: '' };
  if (side === 'admire') return { who: [], qualities: [], memo: '' };
  return { situation: [], memo: '' };
}

export function createTorisetsuState({ stored = null } = {}) {
  const data = stored?.data ? clone(normalizeData(stored.data)) : emptyData();
  const has = hasAnyAnswer(data);
  return {
    view: 'start', chapterId: null, step: null, side: null, layer: 0, index: 0, phase: 'init', target: -1, returnTo: null,
    data, draft: null, stash: Object.create(null), slotMap: Object.create(null), lastStep: Object.create(null),
    textOpen: { surprise: false, experiment: false, reply: false }, valuePicker: '', focusPicker: false, nameOpen: false,
    manualSectionId: '', insightPage: 0, feedback: null, feedbackNonce: 0,
    persisted: Boolean(stored?.persisted) && has, savedAt: stored?.persisted && has ? (stored.savedAt || '') : '',
    saveDeclined: false, saveError: '', notice: stored?.notice || '',
    limitMessage: '', limitGroup: '', missingMessage: '', undo: null, leaveConfirm: false, imageStatus: '', imageBusy: false,
  };
}

export function expireUndo(ts, now = Date.now()) {
  if (ts.undo && now >= ts.undo.expiresAt) { ts.undo = null; return true; }
  return false;
}

const cfgOf = (ts) => CHAPTER_BY_ID[ts.chapterId];
function markFeedback(ts, group, chip) {
  ts.feedbackNonce = (ts.feedbackNonce || 0) + 1;
  ts.feedback = { group, chip, nonce: ts.feedbackNonce };
}
export function sideList(data, chapterId, side) {
  if (chapterId === 'needs') return data.needs[side];
  if (chapterId === 'voice') return data.voice.episodes;
  if (side === 'admire') return data.values.admire ? [data.values.admire] : [];
  return data.values[side];
}
const initOf = (cfg, side) => (side === 'admire' ? 1 : cfg.inits[side]);
const maxOf = (cfg, side) => (side === 'admire' ? 1 : cfg.maxes[side]);
const lastLayer = (side) => (LAYERS[side] ? LAYERS[side].length - 1 : 0);
const stashKey = (ts) => `${ts.chapterId}:${ts.side}:${ts.phase}:${ts.index}`;
const slotMapOf = (ts, chapterId, side) => { const root = (ts.slotMap[chapterId] ||= {}); return (root[side] ||= []); };

// 画面に出ている入力グループ
function currentGroups(ts) {
  if (ts.step === 'layer') return layerGroups(ts.side, LAYERS[ts.side][ts.layer].id);
  if (ts.step === 'admire') return episodeGroups('values', 'admire');
  if (ts.step === 'episode') return episodeGroups(ts.chapterId, ts.side);
  return [];
}

function draftFromRecord(chapterId, side, record) {
  if (chapterId === 'needs') {
    return {
      scene: record.scene ? [record.scene] : [], surface: record.surface ? [record.surface] : [], deep: [...(record.deep || [])],
      feelings: [...(record.feelings || [])], needs: [...record.needs], memo: record.memo,
    };
  }
  if (chapterId === 'voice') return { scene: record.scene ? [record.scene] : [], thoughts: [...record.thoughts], memo: record.memo };
  if (side === 'admire') return { who: record.who ? [record.who] : [], qualities: record.qualities.map((q) => q.id), memo: record.memo };
  return { situation: [record.situation], memo: record.memo };
}

function recordFromDraft(ts) {
  const draft = ts.draft; const memo = sanitizeText(draft.memo);
  const scene = draft.scene?.[0] || '';
  if (ts.chapterId === 'needs') {
    return ts.side === 'happy'
      ? normalizeHappy({ scene, memo, feelings: draft.feelings, needs: draft.needs })
      : normalizeHard({ scene, memo, surface: draft.surface[0] || '', deep: draft.deep, needs: draft.needs });
  }
  if (ts.chapterId === 'voice') return normalizeVoiceEp({ scene, memo, thoughts: draft.thoughts });
  if (ts.side === 'admire') {
    const existing = ts.data.values.admire;
    const qualities = draft.qualities.map((id) => ({ id, value: existing?.qualities.find((q) => q.id === id)?.value || QUALITY_BY_ID.get(id)?.value }));
    return normalizeAdmire({ who: draft.who[0] || '', qualities, memo });
  }
  const existing = ts.target >= 0 ? sideList(ts.data, 'values', ts.side)[ts.target] : null;
  const situation = draft.situation[0];
  const value = existing && existing.situation === situation ? existing.value : SITUATION_BY_ID[situation]?.value;
  return normalizeSideEpisode(ts.side)({ situation, value, memo });
}

function missingGroupNames(ts) {
  if (ts.chapterId === 'needs' || !ts.draft) return [];
  return currentGroups(ts).filter((group) => group.required && !(ts.draft[group.id] || []).length).map((group) => group.name || group.label.replace(/[？?]$/, ''));
}

function autosave(ts, ctx) {
  if (!ts.persisted) return;
  const result = saveTorisetsu(ctx.storage, ts.data, ctx.today);
  if (result.ok) { ts.savedAt = ctx.today || ts.savedAt; ts.saveError = ''; } else { ts.persisted = false; ts.saveError = COPY.saveFailed; }
}
function touch(ts, ctx) { pruneChoices(ts.data); autosave(ts, ctx); }

function setStep(ts, step, patch = {}) {
  Object.assign(ts, patch);
  if (!('layer' in patch)) ts.layer = 0;
  ts.view = 'step'; ts.step = step;
  ts.limitMessage = ''; ts.limitGroup = ''; ts.missingMessage = ''; ts.valuePicker = ''; ts.focusPicker = false;
  ts.feedback = null;
  if (step === 'insight') ts.insightPage = 0;
  if (ts.chapterId) ts.lastStep[ts.chapterId] = { step, side: ts.side, index: ts.index, phase: ts.phase, target: ts.target, returnTo: ts.returnTo, layer: ts.layer };
}

function manualSectionIds(ts, today = '') {
  return composeManual(ts.data, { today }).sections.filter((section) => section.state !== 'hidden').map((section) => section.id);
}

function setManualSection(ts, id = '', today = '') {
  const ids = manualSectionIds(ts, today);
  ts.manualSectionId = ids.includes(id) ? id : (ids[0] || '');
}

function openSlot(ts, side, index, phase, target, returnTo, layer = 0) {
  ts.side = side; ts.index = index; ts.phase = phase; ts.target = target; ts.returnTo = returnTo;
  const items = sideList(ts.data, ts.chapterId, side);
  const record = target >= 0 ? items[target] : null;
  ts.draft = record ? draftFromRecord(ts.chapterId, side, record) : ts.stash[stashKey(ts)] ? clone(ts.stash[stashKey(ts)]) : emptyDraft(ts.chapterId, side);
  if (ts.chapterId === 'needs') setStep(ts, 'layer', { layer });
  else setStep(ts, side === 'admire' ? 'admire' : 'episode');
}

function openAdmire(ts, phase, returnTo) { openSlot(ts, 'admire', 0, phase, ts.data.values.admire ? 0 : -1, returnTo); }

function openIntro(ts, sideIndex) {
  const cfg = cfgOf(ts);
  setStep(ts, 'recall-intro', { side: cfg.sides[sideIndex], index: 0, phase: 'init', target: -1, returnTo: null });
}

function afterRecall(ts) {
  if (chapterReady(ts.chapterId, ts.data)) setStep(ts, 'lineup', { returnTo: null, phase: 'init' });
  else setStep(ts, 'short', { returnTo: null, phase: 'init' });
}

// 初回の流れで 1 枠すすむ（記録しても飛ばしても同じ）
function advanceInit(ts) {
  const cfg = cfgOf(ts);
  if (ts.side === 'admire') { afterRecall(ts); return; }
  if (ts.index + 1 < cfg.inits[ts.side]) { openSlot(ts, ts.side, ts.index + 1, 'init', slotMapOf(ts, ts.chapterId, ts.side)[ts.index + 1] ?? -1, null); return; }
  const sideIndex = cfg.sides.indexOf(ts.side);
  if (sideIndex + 1 < cfg.sides.length) { openIntro(ts, sideIndex + 1); return; }
  if (ts.chapterId === 'values') { openAdmire(ts, 'init', null); return; }
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
    return len('neg') <= len('pos') && len('neg') < cfg.maxes.neg ? 'neg' : len('pos') < cfg.maxes.pos ? 'pos' : 'neg';
  }
  return cfg.sides.find((side) => len(side) < cfg.inits[side]) || cfg.sides.find((side) => len(side) < cfg.maxes[side]) || cfg.sides[0];
}

function stepAfterInsight(ts) {
  if (ts.chapterId === 'voice') { setStep(ts, 'protect'); return; }
  const d = ts.data[ts.chapterId];
  if (d.prediction.length && gapFor(ts.chapterId, ts.data).rows.length) { setStep(ts, 'gap'); return; }
  setStep(ts, 'surprise');
}

const firstStep = (chapterId) => (CHAPTER_BY_ID[chapterId].predict ? 'predict' : 'recall-intro');
function openFirst(ts, chapterId) {
  const patch = { side: null, index: 0, phase: 'init', target: -1, returnTo: null };
  if (CHAPTER_BY_ID[chapterId].predict) setStep(ts, 'predict', patch);
  else setStep(ts, 'recall-intro', { ...patch, side: CHAPTER_BY_ID[chapterId].sides[0] });
}

function resumeStep(ts, chapterId) {
  ts.chapterId = chapterId; ts.view = 'step'; ts.leaveConfirm = false; ts.notice = '';
  const last = ts.lastStep[chapterId];
  const data = ts.data; const ready = chapterReady(chapterId, data);
  if (last && (last.step === 'layer' || last.step === 'episode' || last.step === 'admire')) {
    openSlot(ts, last.side, last.index, last.phase, last.target, last.returnTo, last.layer || 0); return;
  }
  if (last && last.step === 'recall-intro') { setStep(ts, 'recall-intro', { side: last.side, index: 0, phase: 'init', target: -1, returnTo: null }); return; }
  if (last && ['predict', 'lineup', 'insight', 'gap', 'protect', 'reply', 'surprise', 'try', 'days', 'short'].includes(last.step) && (ready || ['predict', 'short', 'days'].includes(last.step))) {
    setStep(ts, last.step, { side: last.side, index: last.index, phase: last.phase, target: last.target, returnTo: last.returnTo }); return;
  }
  if (ready) { setStep(ts, 'insight'); return; }
  if (chapterHasData(data, chapterId)) {
    const cfg = CHAPTER_BY_ID[chapterId];
    const hasRecords = cfg.sides.some((side) => sideList(data, chapterId, side).length > 0) || (chapterId === 'values' && Boolean(data.values.admire));
    if (hasRecords) setStep(ts, 'short', { side: null, index: 0, phase: 'init', target: -1, returnTo: null });
    else openFirst(ts, chapterId);
    return;
  }
  openFirst(ts, chapterId);
}

function openChapter(ts, chapterId, mode = 'smart') {
  if (!CHAPTER_BY_ID[chapterId]) return;
  ts.notice = ''; ts.chapterId = chapterId;
  const data = ts.data; const ready = chapterReady(chapterId, data);
  if (mode === 'start') { openFirst(ts, chapterId); return; }
  if (mode === 'insight' && ready) { setStep(ts, 'insight', { returnTo: null }); return; }
  if (mode === 'days' && chapterHasData(data, chapterId)) { setStep(ts, 'days', { returnTo: null }); return; }
  if (mode === 'smart' && data[chapterId].done && ready) { setStep(ts, 'insight', { returnTo: null }); return; }
  resumeStep(ts, chapterId);
}

function requestLeave(ts) {
  if (!ts.persisted && hasAnyAnswer(ts.data)) { ts.leaveConfirm = true; return { render: true, focus: '[data-ts-default]' }; }
  return { leave: true };
}

function toggleIn(items, id, max, allowOff) {
  const index = items.indexOf(id);
  if (index >= 0) { if (allowOff || max > 1) items.splice(index, 1); return { changed: allowOff || max > 1 }; }
  if (max === 1) { items.splice(0, items.length, id); return { changed: true }; }
  if (items.length >= max) return { changed: false, full: true };
  items.push(id); return { changed: true };
}

function backFromStep(ts) {
  const cfg = cfgOf(ts);
  const stashDraft = () => { if (ts.draft && Object.values(ts.draft).some((value) => (Array.isArray(value) ? value.length : String(value).trim()))) ts.stash[stashKey(ts)] = clone(ts.draft); else delete ts.stash[stashKey(ts)]; };
  const openPrev = (side, index) => openSlot(ts, side, index, 'init', slotMapOf(ts, ts.chapterId, side)[index] ?? -1, null, lastLayer(side));
  switch (ts.step) {
    case 'predict': ts.view = 'contents'; ts.step = null; return;
    case 'recall-intro': {
      const sideIndex = cfg.sides.indexOf(ts.side);
      if (sideIndex <= 0) { if (cfg.predict) setStep(ts, 'predict', { side: null }); else { ts.view = 'contents'; ts.step = null; } return; }
      const prev = cfg.sides[sideIndex - 1];
      openPrev(prev, cfg.inits[prev] - 1); return;
    }
    case 'layer': {
      if (ts.layer > 0) { setStep(ts, 'layer', { layer: ts.layer - 1 }); return; }
      stashDraft();
      if (ts.phase === 'edit') { leaveSlot(ts); return; }
      if (ts.index > 0) { openPrev(ts.side, ts.index - 1); return; }
      setStep(ts, 'recall-intro', { index: 0 }); return;
    }
    case 'episode': {
      stashDraft();
      if (ts.phase === 'edit') { leaveSlot(ts); return; }
      if (ts.index > 0) { openPrev(ts.side, ts.index - 1); return; }
      setStep(ts, 'recall-intro', { index: 0 }); return;
    }
    case 'admire': {
      stashDraft();
      if (ts.phase === 'edit') { leaveSlot(ts); return; }
      openPrev('pos', cfg.inits.pos - 1); return;
    }
    case 'short': {
      if (ts.chapterId === 'values') { openAdmire(ts, 'init', null); return; }
      const last = cfg.sides[cfg.sides.length - 1];
      openPrev(last, cfg.inits[last] - 1); return;
    }
    case 'lineup': setStep(ts, 'days', { returnTo: null }); return;
    case 'insight': setStep(ts, 'lineup'); return;
    case 'gap': setStep(ts, 'insight'); return;
    case 'protect': setStep(ts, 'insight'); return;
    case 'reply': setStep(ts, 'protect'); return;
    case 'surprise': {
      if (ts.chapterId === 'voice') { setStep(ts, 'reply'); return; }
      const gap = ts.data[ts.chapterId].prediction.length && gapFor(ts.chapterId, ts.data).rows.length;
      setStep(ts, gap ? 'gap' : 'insight'); return;
    }
    case 'try': setStep(ts, 'surprise'); return;
    case 'days': setStep(ts, chapterReady(ts.chapterId, ts.data) ? 'insight' : 'short'); return;
    case 'done': ts.view = 'contents'; ts.step = null; return;
    default: ts.view = 'contents'; ts.step = null;
  }
}

// 記録する（最後の層・第2章の場面・第3章の出来事・いいなと思った人）
function commitDraft(ts, ctx) {
  const cfg = cfgOf(ts);
  const record = recordFromDraft(ts);
  if (!record) {
    if (ts.chapterId === 'needs') return dropDraft(ts); // 全部空なら、やめておくと同じ
    ts.missingMessage = COPY.missingGroups(missingGroupNames(ts));
    return { render: true, focus: '[data-ts-missing]' };
  }
  if (ts.side === 'admire') {
    ts.data.values.admire = record;
  } else {
    const items = sideList(ts.data, ts.chapterId, ts.side);
    let target = ts.target;
    if (ts.phase === 'init') target = slotMapOf(ts, ts.chapterId, ts.side)[ts.index] ?? -1;
    if (target >= 0 && target < items.length) items[target] = record;
    else if (items.length < maxOf(cfg, ts.side)) { items.push(record); target = items.length - 1; }
    if (ts.phase === 'init') slotMapOf(ts, ts.chapterId, ts.side)[ts.index] = target;
  }
  delete ts.stash[stashKey(ts)];
  touch(ts, ctx);
  if (ts.phase === 'init') advanceInit(ts); else leaveSlot(ts);
  return { render: true, scrollTop: true };
}

function dropDraft(ts) {
  delete ts.stash[stashKey(ts)];
  if (ts.phase === 'init') advanceInit(ts); else leaveSlot(ts);
  return { render: true, scrollTop: true };
}

const isEntryStep = (ts) => ts.view === 'step' && (ts.step === 'layer' || ts.step === 'episode' || ts.step === 'admire');

// 画面からの操作。状態を書きかえ、app.js に「何をするか」を返す。
export function applyAction(ts, action, data = {}, ctx = {}) {
  const now = typeof ctx.now === 'function' ? ctx.now() : Date.now();
  expireUndo(ts, now);
  // Feedback is a one-render effect; do not carry an old highlight into a
  // later action or a rejected/no-op render.
  ts.feedback = null;
  const cfg = ts.chapterId ? CHAPTER_BY_ID[ts.chapterId] : null;
  switch (action) {
    case 'torisetsu-back': {
      if (ts.view === 'step') { if (ts.step === 'insight' && ts.insightPage > 0) { ts.insightPage -= 1; return { render: true, scrollTop: true }; } backFromStep(ts); return { render: true, scrollTop: true }; }
      if (ts.view === 'manual') { ts.view = 'contents'; return { render: true, scrollTop: true }; }
      return requestLeave(ts);
    }
    case 'torisetsu-begin': case 'torisetsu-contents': ts.view = 'contents'; ts.step = null; ts.leaveConfirm = false; ts.notice = ''; ts.nameOpen = false; return { render: true, scrollTop: true };
    case 'torisetsu-manual': ts.view = 'manual'; ts.step = null; ts.leaveConfirm = false; ts.notice = ''; setManualSection(ts, ts.manualSectionId, ctx.today); return { render: true, scrollTop: true };
    case 'torisetsu-manual-section':
      if (ts.view === 'manual' && typeof data.id === 'string') { setManualSection(ts, data.id, ctx.today); return { render: true, scrollTop: true, focus: `[data-manual-section="${data.id}"]` }; }
      return { render: true };
    case 'torisetsu-chapter': openChapter(ts, data.chapter, 'smart'); return { render: true, scrollTop: true };
    case 'torisetsu-chapter-start': openChapter(ts, data.chapter, 'start'); return { render: true, scrollTop: true };
    case 'torisetsu-chapter-insight': openChapter(ts, data.chapter, 'insight'); return { render: true, scrollTop: true };
    case 'torisetsu-chapter-days': openChapter(ts, data.chapter, 'days'); return { render: true, scrollTop: true };
    case 'torisetsu-chip': {
      if (ts.view !== 'step') return { render: true };
      const focus = `[data-chip="${data.chip}"][data-group="${data.group}"]`;
      if (ts.step === 'predict') {
        const allowed = ts.chapterId === 'needs' ? NEED_IDS : VALUE_IDS;
        if (!cfg.predict || !allowed.has(data.chip)) return { render: true };
        const max = cfg.predict.max;
        // Predictions are rendered as a radio group: clicking the current choice is a no-op.
        const result = toggleIn(ts.data[ts.chapterId].prediction, data.chip, max, false);
        ts.limitMessage = result.full ? COPY.limitMessage(max) : ''; ts.limitGroup = result.full ? 'prediction' : '';
        if (result.changed) { touch(ts, ctx); markFeedback(ts, data.group, data.chip); }
        return { render: true, focus };
      }
      if (ts.step === 'protect' && data.group === 'intents') {
        if (!INTENT_IDS.has(data.chip)) return { render: true };
        const result = toggleIn(ts.data.voice.intents, data.chip, 2, true);
        ts.limitMessage = result.full ? COPY.limitMessage(2) : ''; ts.limitGroup = result.full ? 'intents' : '';
        if (result.changed) { touch(ts, ctx); markFeedback(ts, data.group, data.chip); }
        return { render: true, focus };
      }
      if (ts.step === 'reply' && data.group === 'reply') {
        if (!replyOptions(effectiveFocus(ts.data.voice)).some((item) => item.id === data.chip)) return { render: true };
        const voice = ts.data.voice;
        if (voice.reply === data.chip && !voice.replyText) return { render: true, focus };
        voice.reply = data.chip; voice.replyText = ''; ts.textOpen.reply = false;
        touch(ts, ctx); markFeedback(ts, data.group, data.chip);
        return { render: true, focus };
      }
      if (isEntryStep(ts) && ts.draft) {
        const group = currentGroups(ts).find((item) => item.id === data.group);
        if (!group || !group.chips.some((chip) => chip.id === data.chip) || !ts.draft[group.id]) return { render: true };
        const result = toggleIn(ts.draft[group.id], data.chip, group.max, group.max === 1 ? false : !group.required);
        ts.limitMessage = result.full ? COPY.limitMessage(group.max) : ''; ts.limitGroup = result.full ? group.id : '';
        ts.missingMessage = '';
        if (result.changed) markFeedback(ts, data.group, data.chip);
        return { render: true, focus };
      }
      return { render: true };
    }
    case 'torisetsu-next': { // 予想 → 思い出す（案内）
      if (ts.step !== 'predict') return { render: true };
      openIntro(ts, 0); return { render: true, scrollTop: true };
    }
    case 'torisetsu-recall-start': {
      if (ts.step !== 'recall-intro') return { render: true };
      openSlot(ts, ts.side, 0, 'init', slotMapOf(ts, ts.chapterId, ts.side)[0] ?? -1, null); return { render: true, scrollTop: true };
    }
    case 'torisetsu-copy-hard': { // 第1章のしんどかった出来事の「場面」と「ひとこと」だけを写す（参照ではなくコピー）
      if (ts.step !== 'recall-intro' || ts.chapterId !== 'voice') return { render: true };
      const hard = ts.data.needs.hard.slice(0, cfg.inits.voice);
      ts.side = 'voice'; ts.phase = 'init';
      hard.forEach((ep, index) => {
        ts.index = index;
        ts.stash[stashKey(ts)] = { scene: ep.scene ? [ep.scene] : [], thoughts: [], memo: ep.memo };
      });
      openSlot(ts, 'voice', 0, 'init', slotMapOf(ts, 'voice', 'voice')[0] ?? -1, null); return { render: true, scrollTop: true };
    }
    case 'torisetsu-layer-next': {
      if (ts.step !== 'layer' || !ts.draft || ts.layer >= lastLayer(ts.side)) return { render: true };
      setStep(ts, 'layer', { layer: ts.layer + 1 }); return { render: true, scrollTop: true };
    }
    case 'torisetsu-layer-skip': {
      if (ts.step !== 'layer' || !ts.draft) return { render: true };
      // 「直す」で開いた出来事は、記録済みの答えを消さない（そのまま進む）
      if (ts.phase !== 'edit') for (const group of currentGroups(ts)) if (ts.draft[group.id]) ts.draft[group.id] = [];
      if (ts.layer < lastLayer(ts.side)) { setStep(ts, 'layer', { layer: ts.layer + 1 }); return { render: true, scrollTop: true }; }
      return commitDraft(ts, ctx);
    }
    case 'torisetsu-record': {
      if (!isEntryStep(ts) || !ts.draft) return { render: true };
      if (ts.step === 'layer' && ts.layer < lastLayer(ts.side)) return { render: true };
      return commitDraft(ts, ctx);
    }
    case 'torisetsu-skip-item': case 'torisetsu-admire-skip': {
      if (!isEntryStep(ts)) return { render: true };
      return dropDraft(ts);
    }
    case 'torisetsu-delete-item': {
      if (!isEntryStep(ts) || ts.target < 0) return { render: true };
      if (ts.side === 'admire') ts.data.values.admire = null;
      else {
        const items = sideList(ts.data, ts.chapterId, ts.side);
        items.splice(ts.target, 1);
        // 初回の枠との結びつきをずらす
        const map = slotMapOf(ts, ts.chapterId, ts.side);
        for (let i = 0; i < map.length; i += 1) { if (map[i] === ts.target) map[i] = -1; else if (map[i] > ts.target) map[i] -= 1; }
      }
      touch(ts, ctx);
      leaveSlot(ts);
      return { render: true, scrollTop: true };
    }
    case 'torisetsu-find': { if (ts.step === 'lineup') setStep(ts, 'insight'); return { render: true, scrollTop: true }; }
    case 'torisetsu-insight-page': {
      if (ts.step !== 'insight') return { render: true };
      const total = insightResultCount(ts);
      const next = data.direction === 'prev' ? ts.insightPage - 1 : ts.insightPage + 1;
      if (data.direction !== 'prev' && next > total - 1) stepAfterInsight(ts);
      else ts.insightPage = Math.max(0, Math.min(next, Math.max(0, total - 1)));
      return { render: true, scrollTop: true };
    }
    case 'torisetsu-compare': { if (ts.step === 'insight') stepAfterInsight(ts); return { render: true, scrollTop: true }; }
    case 'torisetsu-gap-next': { if (ts.step === 'gap') setStep(ts, 'surprise'); return { render: true, scrollTop: true }; }
    case 'torisetsu-protect-next': {
      if (ts.step !== 'protect') return { render: true };
      if (data.key === 'skip') { ts.data.voice.intents = []; touch(ts, ctx); }
      setStep(ts, 'reply'); return { render: true, scrollTop: true };
    }
    case 'torisetsu-reply-next': { if (ts.step === 'reply') setStep(ts, 'surprise'); return { render: true, scrollTop: true }; }
    case 'torisetsu-focus-open': { ts.focusPicker = !ts.focusPicker; return { render: true, focus: '[data-action="torisetsu-focus-open"]' }; }
    case 'torisetsu-focus-set': {
      if (ts.step === 'protect' && focusChoices(ts.data.voice).some((p) => p.id === data.chip)) { ts.data.voice.focus = data.chip; touch(ts, ctx); }
      ts.focusPicker = false;
      return { render: true, focus: '[data-action="torisetsu-focus-open"]' };
    }
    case 'torisetsu-days': { if (ts.view === 'step') setStep(ts, 'days', { returnTo: null }); return { render: true, scrollTop: true }; }
    case 'torisetsu-days-done': {
      if (ts.step !== 'days') return { render: true };
      setStep(ts, chapterReady(ts.chapterId, ts.data) ? 'insight' : 'short'); return { render: true, scrollTop: true };
    }
    case 'torisetsu-edit-item': {
      if (ts.view !== 'step' || !cfg) return { render: true };
      const side = data.side || cfg.sides[0]; const index = Number(data.index);
      if (side === 'admire' && ts.chapterId === 'values') {
        if (!ts.data.values.admire) return { render: true };
        openSlot(ts, 'admire', 0, 'edit', 0, 'days'); return { render: true, scrollTop: true };
      }
      const items = sideList(ts.data, ts.chapterId, side);
      if (!cfg.sides.includes(side) || !Number.isInteger(index) || index < 0 || index >= items.length) return { render: true };
      openSlot(ts, side, index, 'edit', index, 'days'); return { render: true, scrollTop: true };
    }
    case 'torisetsu-add-item': {
      if (ts.view !== 'step' || !cfg) return { render: true };
      const returnTo = data.returnTo === 'insight' ? 'insight' : data.returnTo === 'days' ? 'days' : 'short';
      if (data.side === 'admire' && ts.chapterId === 'values') {
        if (ts.data.values.admire) return { render: true };
        openAdmire(ts, 'edit', returnTo); return { render: true, scrollTop: true };
      }
      let side = data.side;
      if (!cfg.sides.includes(side)) side = shortSide(ts);
      const items = sideList(ts.data, ts.chapterId, side);
      if (items.length >= maxOf(cfg, side)) return { render: true };
      openSlot(ts, side, items.length, 'edit', -1, returnTo); return { render: true, scrollTop: true };
    }
    case 'torisetsu-skip-short': ts.view = 'contents'; ts.step = null; return { render: true, scrollTop: true };
    case 'torisetsu-value-open': { const key = `${data.side}:${data.index}`; ts.valuePicker = ts.valuePicker === key ? '' : key; return { render: true, focus: `[data-value-key="${key}"]` }; }
    case 'torisetsu-value-set': {
      const index = Number(data.index);
      if (ts.chapterId === 'values' && VALUE_IDS.has(data.chip)) {
        if (data.side === 'admire') { const q = ts.data.values.admire?.qualities[index]; if (q) { q.value = data.chip; touch(ts, ctx); } }
        else { const items = data.side === 'neg' || data.side === 'pos' ? ts.data.values[data.side] : null; if (items && items[index]) { items[index].value = data.chip; touch(ts, ctx); } }
      }
      const key = `${data.side}:${index}`; ts.valuePicker = '';
      return { render: true, focus: `[data-value-key="${key}"]` };
    }
    case 'torisetsu-pick': {
      if (!cfg || (data.kind !== 'surprise' && data.kind !== 'experiment')) return { render: true };
      const options = data.kind === 'surprise' ? surpriseOptions(ts.chapterId, ts.data) : tryOptions(ts.chapterId, ts.data);
      if (!options.some((item) => item.key === data.key)) return { render: true };
      const d = ts.data[ts.chapterId];
      if (d[data.kind] === data.key && !d[`${data.kind}Text`]) return { render: true, focus: `[data-pick-key="${data.key}"]` };
      d[data.kind] = d[data.kind] === data.key ? '' : data.key; d[`${data.kind}Text`] = '';
      ts.textOpen[data.kind] = false;
      touch(ts, ctx);
      markFeedback(ts, data.kind, data.key);
      return { render: true, focus: `[data-pick-key="${data.key}"]` };
    }
    case 'torisetsu-text-open': {
      if (data.kind !== 'surprise' && data.kind !== 'experiment' && data.kind !== 'reply') return { render: true };
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
      if (!ts.persisted && !hasDoneChapter(ts.data)) return { render: false }; // 章が 1 つできるまでは残せない
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
      ts.persisted = false; ts.savedAt = ''; ts.saveDeclined = false; ts.saveError = ''; ts.leaveConfirm = false; ts.notice = ''; ts.nameOpen = false;
      ts.textOpen = { surprise: false, experiment: false, reply: false }; ts.focusPicker = false;
      ts.view = 'start'; ts.step = null; ts.chapterId = null; ts.side = null; ts.returnTo = null; ts.layer = 0; ts.manualSectionId = ''; ts.insightPage = 0; ts.feedback = null;
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

// 自由文の入力（ひとこと・意外・ためす・返す言葉・製品名）
export function setDraftText(ts, value, field = 'memo', ctx = null) {
  if (field === 'name') { ts.data.name = sanitizeText(value, NAME_MAX, { trim: false }); if (ctx) autosave(ts, ctx); return; }
  if (field === 'memo') { if (ts.draft) ts.draft.memo = sanitizeText(value, TEXT_MAX, { trim: false }); return; }
  if (field === 'reply') {
    const voice = ts.data.voice;
    voice.replyText = sanitizeText(value, TEXT_MAX, { trim: false });
    if (voice.replyText.trim()) voice.reply = '';
    if (ctx) autosave(ts, ctx);
    return;
  }
  if ((field === 'surprise' || field === 'experiment') && ts.chapterId) {
    const d = ts.data[ts.chapterId];
    d[`${field}Text`] = sanitizeText(value, TEXT_MAX, { trim: false });
    if (d[`${field}Text`].trim()) d[field] = '';
    if (ctx) autosave(ts, ctx);
  }
}

export const draftComplete = (ts) => Boolean(ts.draft) && missingGroupNames(ts).length === 0;
export function isPicked(ts, kind, key) {
  if (kind === 'reply') { const voice = ts.data.voice; return !voice.replyText?.trim() && voice.reply === key; }
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
const sub = (text) => ({ kind: 'sub', text });

export function composeManual(rawData, { today = '' } = {}) {
  const data = normalizeData(rawData);
  const ready = Object.fromEntries(CHAPTER_IDS.map((id) => [id, chapterReady(id, data)]));
  const needs = ready.needs ? needsInsights(data.needs.happy, data.needs.hard) : null;
  const voice = ready.voice ? voiceInsights(data.voice.episodes) : null;
  const values = ready.values ? valuesInsights(data.values.neg, data.values.pos, data.values.admire) : null;
  const fuelPicks = needs ? needs.ordered.filter((item) => item.kind === 'X' || item.kind === 'H' || item.kind === 'J').slice(0, 3) : [];
  const SUFFIX = { X: MANUAL_COPY.suffixCross, H: MANUAL_COPY.suffixHard, J: MANUAL_COPY.suffixHappy };
  const build = {
    fuel: () => {
      if (!needs) return { state: 'todo' };
      if (fuelPicks.length) return { state: 'filled', lines: fuelPicks.map((item) => bullet(`${needById(item.id).fuel}${SUFFIX[item.kind]}`)) };
      if (needs.nearNeed) return { state: 'filled', lines: [para(MANUAL_COPY.fuelCandidates), bullet(needById(needs.nearNeed.id).fuel)] };
      return { state: 'none' };
    },
    shaky: () => {
      if (!needs) return { state: 'todo' };
      const picks = needs.ordered.filter((item) => item.kind === 'LD' || item.kind === 'LN' || item.kind === 'D').slice(0, 3);
      if (!picks.length) return { state: 'none' };
      const text = (item) => {
        if (item.kind === 'LD') return `『${surfaceById(item.surface).tag}』の奥に『${deepById(item.deep).tag}』`;
        if (item.kind === 'LN') return `『${surfaceById(item.surface).tag}』のとき、本当は『${needById(item.id).wish}』`;
        return `しんどいときの奥に『${deepById(item.id).tag}』`;
      };
      return { state: 'filled', lines: [para(MANUAL_COPY.shakyIntro), ...picks.map((item) => bullet(text(item))), para(MANUAL_COPY.shakyOutro)] };
    },
    request: () => {
      if (!needs) return { state: 'todo' };
      if (!fuelPicks.length) return { state: 'hidden' };
      return { state: 'filled', lines: [...fuelPicks.slice(0, 2).map((item) => bullet(needById(item.id).request)), para(MANUAL_COPY.requestOutro)] };
    },
    voice: () => {
      if (!voice) return { state: 'todo' };
      const lines = [];
      const top = voice.items[0];
      const focus = effectiveFocus(data.voice);
      if (top) {
        const head = top.kind === 'RP' ? `『${patternById(top.id).name}』声` : `『${thoughtById(top.id).label}』という声`;
        lines.push(para(`しんどいとき、${head}がしやすいようです（${voice.n}つのうち${top.c}つ）。`));
      } else lines.push(para(MANUAL_COPY.voiceNone));
      focusVoices(data.voice, focus).slice(0, 3).forEach((t) => lines.push(bullet(`『${t.label}』`)));
      const intents = data.voice.intents.map((id) => intentById(id)).filter(Boolean);
      if (intents.length) lines.push(para(`その声は、${intents.map((item) => `『${item.label}』`).join('')}と、守ろうとしているのかもしれません。`));
      const reply = data.voice.replyText || REPLIES.find((item) => item.id === data.voice.reply)?.label || '';
      if (reply) { lines.push(sub(MANUAL_COPY.voiceReplyHead)); lines.push(bullet(`「${reply}」`)); }
      else if (!intents.length && focusVoices(data.voice, focus).length) {
        lines.push(para(MANUAL_COPY.voiceSoft)); lines.push(sub(MANUAL_COPY.voiceReplyHead)); lines.push(bullet(`「${REPLIES.find((item) => item.id === 'rp_any1').label}」`));
      }
      return { state: 'filled', lines };
    },
    values: () => {
      if (!values) return { state: 'todo' };
      const lines = [];
      if (values.empty) {
        const labels = values.candidates.slice(0, 3);
        if (labels.length) { lines.push(para(MANUAL_COPY.valuesCandidates)); labels.forEach((item) => lines.push(bullet(item.label))); }
      } else {
        const shown = values.items;
        shown.forEach((item) => lines.push(bullet(item.label)));
        const hasNeg = shown.some((item) => item.a >= 1); const hasPos = shown.some((item) => item.p >= 1);
        const closing = hasNeg && hasPos ? MANUAL_COPY.valuesBoth : hasNeg ? MANUAL_COPY.valuesNeg : hasPos ? MANUAL_COPY.valuesPos : '';
        if (closing) lines.push(para(closing));
      }
      const admire = data.values.admire;
      if (admire) { lines.push(sub(MANUAL_COPY.admireHead)); admire.qualities.slice(0, 2).forEach((q) => lines.push(bullet(qualityById(q.id).wish))); }
      const link = crossLink(data);
      if (link) lines.push(bullet(link));
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
  voice: '<path d="M4 4.5h11v7H9l-3 2.6v-2.6H4Z"/><path d="M12 14.5v2.5h5l3 2.6V17h.5v-5.5H17"/>',
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

const STEP_INDEX = { predict: 0, 'recall-intro': 1, layer: 1, episode: 1, admire: 1, short: 1, days: 1, lineup: 2, insight: 3, gap: 3, surprise: 4, try: 4 };
const STEP_INDEX_VOICE = { 'recall-intro': 0, episode: 0, short: 0, days: 0, lineup: 1, insight: 2, protect: 3, reply: 3, surprise: 4, try: 4 };

function stepperMarkup(ts, esc) {
  const voice = ts.chapterId === 'voice';
  const now = (voice ? STEP_INDEX_VOICE : STEP_INDEX)[ts.step];
  if (now == null) return '';
  const labels = voice ? STEP_LABELS_VOICE : STEP_LABELS;
  const localSteps = new Set(['episode', 'admire', 'layer']);
  const cfg = cfgOf(ts); const items = ts.side && cfg ? sideList(ts.data, ts.chapterId, ts.side) : [];
  let local = '';
  if (localSteps.has(ts.step) && ts.side && cfg) {
    if (ts.phase === 'init') local = `${Math.min(ts.index + 1, initOf(cfg, ts.side))} / ${initOf(cfg, ts.side)}`;
    else if (ts.target >= 0) local = `編集 ${ts.target + 1} / ${items.length}`;
    else local = `追加 ${items.length + 1}つ目`;
  }
  return `<div class="ts-step-progress"><ol class="ts-steps5" data-ts-phase="${esc(labels[now] || '')}" data-ts-local-progress="${esc(local)}" aria-label="進み具合">${labels.map((label, i) => `<li class="${i === now ? 'is-now' : i < now ? 'is-past' : ''}"${i === now ? ' aria-current="step"' : ''}>${esc(label)}</li>`).join('')}</ol>${local ? `<span class="ts-step-local" aria-label="${esc(local)}">${esc(local)}</span>` : ''}</div>`;
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
  const lampDot = section.id === 'shaky' ? '<span class="ts-lamp" aria-hidden="true"></span>' : '';
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
  const lines = section.lines || [];
  // Only the voice chapter has a useful primary/reply split. Other chapters
  // stay in source order so bullets and sub-heads retain their meaning.
  const voiceIndex = section.chapterId === 'voice' ? lines.findIndex((line) => line.kind === 'sub') : -1;
  const body = section.chapterId === 'voice'
    ? (() => {
      const intro = lines.slice(0, 1);
      const supplemental = lines.slice(1, voiceIndex >= 0 ? voiceIndex : lines.length);
      const reply = voiceIndex >= 0 ? lines.slice(voiceIndex) : [];
      return `${linesMarkup(intro, esc)}${reply.length ? `<div class="ts-sec-key">${linesMarkup(reply, esc)}</div>` : ''}${supplemental.length ? `<details class="ts-sec-details"><summary>補足・根拠</summary><div class="ts-sec-body">${linesMarkup(supplemental, esc)}</div></details>` : ''}`;
    })()
    : `<div class="ts-sec-body">${linesMarkup(lines, esc)}</div>`;
  return `<section class="ts-sec" data-ts-sec="${esc(section.id)}">${head}${edit}${body}</section>`;
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
  const shown = sections ? sections(manual) : manual.sections;
  if (!cover && !shown.length) return '';
  const coverMarkup = cover ? `<div class="ts-cover"><div class="ts-cover-text"><small>取扱説明書</small><strong>${esc(manual.title)}</strong></div><img class="ts-cover-icon" src="./assets/torisetsu-gallery/book-cover-architecture.png" alt="" aria-hidden="true" width="120" height="120" /></div><p class="ts-cover-meta">${esc(manual.version)}</p>${nameBlock(ts, manual, esc, editable)}` : '';
  const warranty = cover ? `<p class="ts-warranty">${esc(manual.warranty)}</p>` : '';
  return `<article class="ts-paper" aria-label="${esc(manual.title)}">${coverMarkup}${shown.map((section) => sectionMarkup(section, { esc, editable })).join('')}${warranty}</article>`;
}

function saveCardMarkup(ts, esc) {
  if (!ts.persisted && !hasDoneChapter(ts.data)) return `<p class="ts-note ts-save-locked">${esc(COPY.saveLocked)}</p>`;
  if (ts.persisted) return `<section class="ts-save is-saved" aria-label="${esc(COPY.saveYes)}"><p class="ts-save-title">${iconSvg('lock', 16)}<span>${esc(COPY.saving)}</span></p><p>${esc(COPY.savedDone)}</p><button type="button" class="text-button ts-danger" data-action="torisetsu-delete">${esc(COPY.deleteManual)}</button></section>`;
  const error = ts.saveError ? `<p class="ts-save-error" role="alert">${esc(ts.saveError)}</p>` : '';
  if (ts.saveDeclined) return `<section class="ts-save is-declined">${error}<button type="button" class="text-button" data-action="torisetsu-resave">${esc(COPY.saveYes)}</button></section>`;
  return `<section class="ts-save" aria-labelledby="ts-save-title"><p class="ts-save-title" id="ts-save-title">${iconSvg('lock', 16)}<span>${esc(COPY.saveCardTitle)}</span></p><p>${esc(COPY.saveCardBody1)}<br>${esc(COPY.saveCardBody2)}</p>${error}<div class="ts-save-actions"><button type="button" class="primary-button" data-action="torisetsu-save">${esc(COPY.saveYes)}</button><button type="button" class="secondary-button" data-action="torisetsu-decline">${esc(COPY.saveNo)}</button></div></section>`;
}

// --- チップ ---
function chipGroupMarkup(ts, esc, { label, hint, max, chips, selected, groupId, radio, limitGroup }) {
  const full = selected.length >= max && max > 1;
  const message = ts.limitGroup === limitGroup ? ts.limitMessage : '';
  const buttons = chips.map((chip) => {
    const on = selected.includes(chip.id);
    const attrs = radio ? `role="radio" aria-checked="${on}"` : `aria-pressed="${on}"`;
    const feedback = ts.feedback?.group === groupId && ts.feedback?.chip === chip.id ? ' is-feedback' : '';
    return `<button type="button" class="ts-chip${on ? ' is-on' : ''}${!on && full ? ' is-dim' : ''}${feedback}" ${attrs} data-action="torisetsu-chip" data-group="${esc(groupId)}" data-chip="${esc(chip.id)}"><span>${esc(chip.label)}</span></button>`;
  }).join('');
  return `<div class="ts-group" data-ts-group="${esc(groupId)}"><h2 class="ts-group-head" id="ts-g-${esc(groupId)}">${esc(label)}${hint ? `<small>${esc(hint)}</small>` : ''}</h2><div class="ts-chips" role="${radio ? 'radiogroup' : 'group'}" aria-labelledby="ts-g-${esc(groupId)}">${buttons}</div><p class="ts-limit" role="status" aria-live="polite">${esc(message)}</p></div>`;
}

const groupMarkup = (ts, esc, group) => chipGroupMarkup(ts, esc, {
  label: group.label, hint: group.hint, max: group.max, chips: group.chips, selected: ts.draft[group.id] || [], groupId: group.id, radio: group.max === 1, limitGroup: group.id,
});

function memoField(ts, esc, label, placeholder) {
  const memoLen = Array.from(ts.draft.memo || '').length;
  return `<label class="ts-field"><span>${esc(label)}</span><input type="text" inputmode="text" autocomplete="off" maxlength="${TEXT_MAX}" data-ts-text="memo" value="${esc(ts.draft.memo)}" placeholder="${esc(placeholder)}" /><small data-ts-count="memo">${esc(COPY.memoCount(memoLen, TEXT_MAX))}</small></label>`;
}

function predictView(ts, h) {
  const { esc } = h; const cfg = cfgOf(ts); const d = ts.data[ts.chapterId];
  const choices = ts.chapterId === 'needs' ? NEED_PREDICTIONS : VALUE_PREDICTIONS;
  return `<section class="ts-step ts-gallery" data-ts-key="predict" data-ts-scene="gallery" data-gallery-stage="arrival">
    ${stepperMarkup(ts, esc)}
    <figure class="ts-gallery-scene"><img class="ts-scene-art ts-scene-art-arrival" src="./assets/torisetsu-gallery/arrival-gallery.png" alt="" aria-hidden="true" width="360" height="260" loading="lazy" /></figure><div class="ts-gallery-copy">
      <p class="ts-chapter-name">${esc(cfg.label)}</p>
      <h1 class="ts-q" tabindex="-1" data-focus>${esc(cfg.predict.title)}</h1>
      <p class="ts-lead">${esc(cfg.predict.question)}</p>
      ${chipGroupMarkup(ts, esc, { label: cfg.predict.hint, max: cfg.predict.max, chips: choices, selected: d.prediction, groupId: 'prediction', radio: true, limitGroup: 'prediction' })}
      ${cfg.predict.footer ? `<details class="ts-context"><summary>ヒントを見る</summary><p class="ts-note">${esc(cfg.predict.footer)}</p></details>` : ''}
      <div class="ts-actions"><button type="button" class="primary-button" data-action="torisetsu-next">${esc(COPY.predictNext)}</button></div>
    </div>
  </section>`;
}

function introView(ts, h) {
  const { esc } = h; const intro = INTRO[ts.side];
  const canCopy = ts.chapterId === 'voice' && ts.data.needs.hard.length > 0 && ts.data.voice.episodes.length === 0;
  const chapter = ts.chapterId === 'voice' ? `<p class="ts-chapter-name">${esc(cfgOf(ts).label)}</p>` : '';
  return `<section class="ts-step ts-gallery" data-ts-key="intro:${esc(ts.side)}" data-ts-scene="gallery" data-gallery-stage="arrival">
    ${stepperMarkup(ts, esc)}
    <figure class="ts-gallery-scene"><img class="ts-scene-art ts-scene-art-arrival" src="./assets/torisetsu-gallery/arrival-gallery.png" alt="" aria-hidden="true" width="360" height="260" loading="lazy" /></figure><div class="ts-gallery-copy">
      ${chapter}
      <h1 class="ts-q" tabindex="-1" data-focus>${esc(intro.title)}</h1>
      <div class="ts-intro ts-side-${SIDE_COPY[ts.side].color}">${intro.lines.map((line) => `<p>${esc(line)}</p>`).join('')}</div>
      <div class="ts-actions"><button type="button" class="primary-button" data-action="torisetsu-recall-start">${esc(intro.button)}</button>${canCopy ? `<button type="button" class="secondary-button" data-action="torisetsu-copy-hard">${esc(COPY.useNeedsHard)}</button>` : ''}</div>
    </div>
  </section>`;
}

// 出来事の見出し（「しんどかった出来事　1つ目（3つ中）」）
function episodeHeadingText(ts) {
  const cfg = cfgOf(ts); const side = SIDE_COPY[ts.side];
  const items = sideList(ts.data, ts.chapterId, ts.side);
  const n = ts.phase === 'init' ? ts.index + 1 : ts.target >= 0 ? ts.target + 1 : items.length + 1;
  const total = ts.phase === 'init' ? initOf(cfg, ts.side) : 0;
  return `${side.label}　${COPY.episodeHeading(n, total)}`;
}

const labelOfChip = (chips, id) => chips.find((chip) => chip.id === id)?.label || '';

// 第 1 章：1 つの出来事を、層ごと（1 層 1 画面）に下りていく
function layerView(ts, h) {
  const { esc } = h; const side = SIDE_COPY[ts.side];
  const layers = LAYERS[ts.side]; const layer = layers[ts.layer]; const last = lastLayer(ts.side);
  const groups = layerGroups(ts.side, layer.id);
  const depth = `<div class="ts-layer-progress"><ol class="ts-depth" aria-label="${esc(COPY.depthLabel)}">${layers.map((item, i) => `<li class="${i === ts.layer ? 'is-now' : i < ts.layer ? 'is-past' : ''}"${i === ts.layer ? ' aria-current="step"' : ''}>${esc(item.depth)}</li>`).join('')}</ol><span class="ts-layer-count">${ts.layer + 1} / ${layers.length}</span></div>`;
  // 前の層の答えを、小さく 1 行で見せる
  let crumb = '';
  if (ts.layer > 0) {
    const scene = labelOfChip(layerGroups(ts.side, 'scene')[0].chips, ts.draft.scene[0]);
    const parts = [ts.draft.memo || scene];
    for (const earlier of layers.slice(1, ts.layer)) {
      for (const group of layerGroups(ts.side, earlier.id)) parts.push((ts.draft[group.id] || []).map((id) => labelOfChip(group.chips, id)).filter(Boolean).join('、'));
    }
    const shown = parts.filter(Boolean);
    if (shown.length) crumb = `<p class="ts-crumb">${shown.map((part) => esc(part)).join(' ／ ')}</p>`;
  }
  const title = typeof layer.title === 'function' ? layer.title(labelOfChip(layerGroups(ts.side, 'surface')[0]?.chips || [], ts.draft.surface[0])) : layer.title;
  const memo = ts.layer === 0 ? memoField(ts, esc, COPY.memoLabelEpisode, MEMO_PLACEHOLDER[ts.side]) : '';
  const lead = layer.lead ? `<p class="ts-lead">${esc(layer.lead)}</p>` : '';
  const context = [crumb, lead].filter(Boolean).length ? `<details class="ts-context"><summary>前の答え・ヒント</summary>${[crumb, lead].filter(Boolean).join('')}</details>` : '';
  const chips = groups.map((group) => groupMarkup(ts, esc, group)).join('');
  const del = ts.phase === 'edit' && ts.target >= 0 ? `<button type="button" class="text-button ts-danger" data-action="torisetsu-delete-item">${esc(COPY.deleteEpisode)}</button>` : '';
  let actions;
  if (ts.layer === 0) actions = `<button type="button" class="primary-button" data-action="torisetsu-layer-next">${esc(COPY.layerNext)}</button><button type="button" class="text-button ts-skip" data-action="torisetsu-skip-item">${esc(COPY.dropEpisode)}</button>${del}`;
  else if (ts.layer < last) actions = `<button type="button" class="primary-button" data-action="torisetsu-layer-next">${esc(COPY.layerNext)}</button><button type="button" class="text-button ts-skip" data-action="torisetsu-layer-skip">${esc(ts.phase === 'edit' ? COPY.layerKeep : COPY.layerSkip)}</button>${del}`;
  else actions = `<button type="button" class="primary-button" data-action="torisetsu-record" data-ts-record>${esc(COPY.recordEpisode)}</button><button type="button" class="text-button ts-skip" data-action="torisetsu-layer-skip">${esc(ts.phase === 'edit' ? COPY.layerKeep : COPY.layerSkip)}</button>${del}`;
  return `<section class="ts-step ts-gallery ts-layer" data-ts-key="layer" data-ts-scene="gallery" data-gallery-stage="deep">
    ${stepperMarkup(ts, esc)}
    <figure class="ts-gallery-scene"><img class="ts-scene-art" src="./assets/torisetsu-gallery/deep-layers.png" alt="" aria-hidden="true" width="360" height="260" loading="lazy" /></figure><div class="ts-gallery-copy">
      <p class="ts-chapter-name${ts.side === 'hard' ? ' is-bad' : ''}">${esc(episodeHeadingText(ts))}</p>
      ${depth}
      ${context}
      <div class="ts-step-heading"><h1 class="ts-q" tabindex="-1" data-focus>${esc(title)}</h1></div>
      ${memo}
      ${chips}
      <div class="ts-actions">${actions}</div>
    </div>
    <p class="ts-sidebar ts-side-${side.color}" aria-hidden="true">${esc(side.label)}</p>
  </section>`;
}

// 第 2・3 章：1 つの場面／出来事（1 画面）
function itemView(ts, h) {
  const { esc } = h; const side = SIDE_COPY[ts.side]; const voice = ts.chapterId === 'voice';
  const groups = currentGroups(ts);
  const complete = missingGroupNames(ts).length === 0;
  const memo = memoField(ts, esc, voice ? COPY.memoLabelEpisode : COPY.memoLabel, MEMO_PLACEHOLDER[ts.side]);
  const del = ts.phase === 'edit' && ts.target >= 0 ? `<button type="button" class="text-button ts-danger" data-action="torisetsu-delete-item">${esc(voice ? COPY.deleteVoice : COPY.deleteEpisode)}</button>` : '';
  const body = voice
    ? `<h2 class="ts-subq">何があった？</h2>${memo}${groupMarkup(ts, esc, groups[0])}${groupMarkup(ts, esc, groups[1])}`
    : `${groupMarkup(ts, esc, groups[0])}${memo}`;
  return `<section class="ts-step ts-gallery" data-ts-key="item" data-ts-scene="gallery" data-gallery-stage="arrival">
    ${stepperMarkup(ts, esc)}
    <figure class="ts-gallery-scene"><img class="ts-scene-art ts-scene-art-arrival" src="./assets/torisetsu-gallery/arrival-gallery.png" alt="" aria-hidden="true" width="360" height="260" loading="lazy" /></figure><div class="ts-gallery-copy">
    <h1 class="ts-q" tabindex="-1" data-focus>${esc(episodeHeadingText(ts))}</h1>
    ${body}
    <p class="ts-missing" role="status" aria-live="polite" tabindex="-1" data-ts-missing>${esc(ts.missingMessage)}</p>
    <div class="ts-actions"><button type="button" class="primary-button" data-action="torisetsu-record" data-ts-record ${complete ? '' : 'aria-disabled="true"'}>${esc(voice ? COPY.recordVoice : COPY.recordEpisode)}</button><button type="button" class="text-button ts-skip" data-action="torisetsu-skip-item">${esc(voice ? COPY.skipVoice : COPY.skipValues)}</button>${del}</div>
    <p class="ts-sidebar ts-side-${side.color}" aria-hidden="true">${esc(side.label)}</p>
    </div>
  </section>`;
}

function admireView(ts, h) {
  const { esc } = h; const groups = currentGroups(ts);
  const complete = missingGroupNames(ts).length === 0;
  const del = ts.phase === 'edit' && ts.target >= 0 ? `<button type="button" class="text-button ts-danger" data-action="torisetsu-delete-item">${esc(COPY.deleteAdmire)}</button>` : '';
  return `<section class="ts-step ts-gallery" data-ts-key="admire" data-ts-scene="gallery" data-gallery-stage="arrival">
    ${stepperMarkup(ts, esc)}
    <figure class="ts-gallery-scene"><img class="ts-scene-art ts-scene-art-arrival" src="./assets/torisetsu-gallery/arrival-gallery.png" alt="" aria-hidden="true" width="360" height="260" loading="lazy" /></figure><div class="ts-gallery-copy">
    <h1 class="ts-q" tabindex="-1" data-focus>いいなと思った人</h1>
    <p class="ts-lead">最近「いいな」「あんなふうになれたら」と思った人はいる？</p>
    <p class="ts-note">身近な人でも、有名な人でも、物語の人でもOKです。</p>
    ${groupMarkup(ts, esc, groups[0])}
    ${groupMarkup(ts, esc, groups[1])}
    ${memoField(ts, esc, COPY.memoLabel, MEMO_PLACEHOLDER.admire)}
    <p class="ts-missing" role="status" aria-live="polite" tabindex="-1" data-ts-missing>${esc(ts.missingMessage)}</p>
    <div class="ts-actions"><button type="button" class="primary-button" data-action="torisetsu-record" data-ts-record ${complete ? '' : 'aria-disabled="true"'}>${esc(COPY.recordAdmire)}</button><button type="button" class="text-button ts-skip" data-action="torisetsu-admire-skip">${esc(COPY.skipAdmire)}</button>${del}</div>
    <p class="ts-sidebar ts-side-good" aria-hidden="true">${esc(SIDE_COPY.admire.label)}</p>
    </div>
  </section>`;
}

function shortView(ts, h) {
  const { esc } = h;
  const text = ts.chapterId === 'needs' ? COPY.shortTitleNeeds : ts.chapterId === 'voice' ? COPY.shortTitleVoice : COPY.shortTitleValues;
  const addSide = shortSide(ts);
  return `<section class="ts-step ts-gallery" data-ts-key="short" data-ts-scene="gallery" data-gallery-stage="arrival">
    ${stepperMarkup(ts, esc)}
    <figure class="ts-gallery-scene"><img class="ts-scene-art ts-scene-art-arrival" src="./assets/torisetsu-gallery/arrival-gallery.png" alt="" aria-hidden="true" width="360" height="260" loading="lazy" /></figure><div class="ts-gallery-copy">
    <h1 class="ts-q" tabindex="-1" data-focus>${esc(text)}</h1>
    <div class="ts-actions"><button type="button" class="primary-button" data-action="torisetsu-add-item" data-side="${esc(addSide)}" data-return-to="short">${esc(COPY.addMoreEpisode)}</button><button type="button" class="secondary-button" data-action="torisetsu-skip-short">${esc(COPY.later)}</button></div>
    </div>
  </section>`;
}

const dotCell = (on, esc, cls = '') => {
  if (on === null) return `<td class="${['is-na', cls].filter(Boolean).join(' ')}"><span role="img" aria-label="${esc(COPY.lineupNa)}">–</span></td>`;
  return `<td class="${[on ? 'is-on' : '', cls].filter(Boolean).join(' ')}"><span role="img" aria-label="${esc(on ? COPY.lineupYes : COPY.lineupNo)}">${on ? '●' : '・'}</span></td>`;
};

function memosLine(memos, esc, label) {
  const items = memos.map((m) => `${m.label}${m.scene ? ` ${m.scene}` : ''}${m.memo ? `「${m.memo}」` : ''}`);
  return items.length ? `<p class="ts-memos">${esc(label)}：${items.map((item) => esc(item)).join('　')}</p>` : '';
}

function needsLineupBody(ts, esc) {
  const { happy, hard } = ts.data.needs;
  const ins = needsInsights(happy, hard);
  const found = new Set();
  ins.ordered.forEach((item) => {
    if (item.surface) found.add(`surface:${item.surface}`);
    if (item.deep) found.add(`deep:${item.deep}`);
    if (item.kind === 'D') found.add(`deep:${item.id}`);
    if (item.kind !== 'LD' && item.kind !== 'D') found.add(`needs:${item.id}`);
  });
  const lineup = needsLineup(happy, hard);
  const cols = lineup.nJ + lineup.nH;
  const main = []; const single = [];
  for (const group of lineup.groups) {
    const m = group.rows.filter((row) => found.has(`${group.id}:${row.id}`) || row.total >= 2);
    const s = group.rows.filter((row) => !(found.has(`${group.id}:${row.id}`) || row.total >= 2));
    if (m.length) main.push({ ...group, rows: m });
    if (s.length) single.push({ ...group, rows: s });
  }
  const colspans = [lineup.nJ ? `<th scope="colgroup" colspan="${lineup.nJ}" class="is-good">${esc(COPY.lineupHappy)}</th>` : '', lineup.nH ? `<th scope="colgroup" colspan="${lineup.nH}" class="is-bad${lineup.nJ ? ' is-bad-first' : ''}">${esc(COPY.lineupHard)}</th>` : ''].join('');
  const head1 = `<tr><th scope="col" rowspan="2" class="ts-lineup-name"><span class="visually-hidden">奥にあったもの</span></th>${colspans}</tr>`;
  const head2 = `<tr>${Array.from({ length: lineup.nJ }, (_, i) => `<th scope="col" class="is-good">${i + 1}</th>`).join('')}${Array.from({ length: lineup.nH }, (_, i) => `<th scope="col" class="is-bad${i === 0 && lineup.nJ ? ' is-bad-first' : ''}">${i + 1}</th>`).join('')}</tr>`;
  let counter = 0;
  const table = (groups) => {
    const trs = groups.map((group) => `<tr class="ts-lineup-group"><th scope="rowgroup" colspan="${cols + 1}">${esc(group.label)}</th></tr>${group.rows.map((row) => {
      const cells = row.cells.map((on, i) => dotCell(on, esc, i < lineup.nJ ? 'is-good' : `is-bad${i === lineup.nJ && lineup.nJ ? ' is-bad-first' : ''}`)).join('');
      const index = counter++;
      return `<tr class="${found.has(`${group.id}:${row.id}`) ? 'is-found' : ''}" style="--i:${index}"><th scope="row">${esc(row.label)}</th>${cells}</tr>`;
    }).join('')}`).join('');
    return `<div class="ts-lineup-wrap" role="region" aria-label="並べた表" tabindex="0"><table class="ts-lineup"><caption class="visually-hidden">${esc(COPY.lineupTitle)}</caption><thead>${head1}${head2}</thead><tbody>${trs}</tbody></table></div>`;
  };
  const mainHtml = main.length ? table(main) : '';
  const singleCount = single.reduce((sum, group) => sum + group.rows.length, 0);
  const folded = singleCount ? `<details class="ts-lineup-more"><summary>${esc(COPY.lineupOneEpisode(singleCount))}</summary>${table(single)}</details>` : '';
  return `<p class="ts-lead">${esc(COPY.lineupLeadNeeds)}</p>${mainHtml}${folded}${memosLine(lineup.memos, esc, COPY.lineupMemo)}`;
}

function voiceLineupBody(ts, esc) {
  const episodes = ts.data.voice.episodes;
  const ins = voiceInsights(episodes);
  const foundP = new Set(ins.ordered.filter((item) => item.kind === 'RP').map((item) => item.id));
  const foundT = new Set(ins.ordered.filter((item) => item.kind === 'RT').map((item) => item.id));
  const lineup = voiceLineup(episodes);
  const head = `<tr><th scope="col" class="ts-lineup-name"><span class="visually-hidden">声</span></th>${Array.from({ length: lineup.n }, (_, i) => `<th scope="col" class="is-bad">${i + 1}</th>`).join('')}</tr>`;
  let counter = 0;
  const trs = lineup.groups.map((group) => {
    const gf = foundP.has(group.id) || group.rows.some((row) => foundT.has(row.id));
    const header = `<tr class="ts-lineup-group${gf ? ' is-found' : ''}" style="--i:${counter++}"><th scope="row">${esc(`── ${group.name} ──`)}</th>${group.cells.map((on) => dotCell(on, esc, 'is-bad')).join('')}</tr>`;
    const rows = group.rows.map((row) => `<tr class="${foundT.has(row.id) ? 'is-found' : ''}" style="--i:${counter++}"><th scope="row">${esc(row.label)}</th>${row.cells.map((on) => dotCell(on, esc, 'is-bad')).join('')}</tr>`).join('');
    return header + rows;
  }).join('');
  return `<p class="ts-lead">${esc(COPY.lineupLeadVoice)}</p><div class="ts-lineup-wrap" role="region" aria-label="並べた表" tabindex="0"><table class="ts-lineup ts-lineup-voice"><caption class="visually-hidden">${esc(COPY.lineupTitle)}</caption><thead>${head}</thead><tbody>${trs}</tbody></table></div>${memosLine(lineup.memos, esc, COPY.lineupScenes)}`;
}

function valuesLineupBody(ts, esc) {
  const { neg, pos, admire } = ts.data.values;
  const ins = valuesInsights(neg, pos, admire);
  const found = new Set(ins.ordered.map((item) => item.id));
  const picker = (key, side, index, current) => {
    const open = ts.valuePicker === key;
    const box = open ? `<div class="ts-chips" role="radiogroup" aria-label="${esc(COPY.changeValue)}">${VALUES.map((value) => `<button type="button" class="ts-chip${value.id === current ? ' is-on' : ''}" role="radio" aria-checked="${value.id === current}" data-action="torisetsu-value-set" data-side="${esc(side)}" data-index="${index}" data-chip="${esc(value.id)}"><span>${esc(value.label)}</span></button>`).join('')}</div>` : '';
    return `<button type="button" class="ts-valbtn" data-action="torisetsu-value-open" data-side="${esc(side)}" data-index="${index}" data-value-key="${esc(key)}" aria-expanded="${open}" aria-label="${esc(valueById(current).label)}。${esc(COPY.changeValue)}">→ ${esc(valueById(current).label)}</button>${box}`;
  };
  const section = (side) => {
    const items = ts.data.values[side];
    if (!items.length) return '';
    const lis = items.map((ep, index) => `<li class="ts-ep${found.has(ep.value) ? ' is-found' : ''}" style="--i:${index}"><span class="ts-ep-text">${esc(SITUATION_BY_ID[ep.situation].label)}${ep.memo ? `「${esc(ep.memo)}」` : ''}</span>${picker(`${side}:${index}`, side, index, ep.value)}</li>`).join('');
    return `<section class="ts-ep-group ts-side-${SIDE_COPY[side].color}"><h2>${esc(SIDE_COPY[side].label)}</h2><ol>${lis}</ol></section>`;
  };
  let admireHtml = '';
  if (admire) {
    const who = admireWhoById(admire.who)?.label;
    const lis = admire.qualities.map((q, index) => `<li class="ts-ep${found.has(q.value) ? ' is-found' : ''}" style="--i:${index}"><span class="ts-ep-text">${esc(qualityById(q.id).label)}</span>${picker(`admire:${index}`, 'admire', index, q.value)}</li>`).join('');
    admireHtml = `<section class="ts-ep-group ts-side-good"><h2>${esc(COPY.lineupAdmire)}${who ? `（${esc(who)}${admire.memo ? `「${esc(admire.memo)}」` : ''}）` : admire.memo ? `（「${esc(admire.memo)}」）` : ''}</h2><ol>${lis}</ol></section>`;
  }
  return `<p class="ts-lead">${esc(COPY.lineupLeadValues)}</p>${section('neg')}${section('pos')}${admireHtml}<p class="ts-note">${esc(COPY.lineupNoteValues)}</p>`;
}

function lineupView(ts, h) {
  const { esc } = h;
  const body = ts.chapterId === 'needs' ? needsLineupBody(ts, esc) : ts.chapterId === 'voice' ? voiceLineupBody(ts, esc) : valuesLineupBody(ts, esc);
  const ask = ts.chapterId === 'needs' ? COPY.lineupAskNeeds : ts.chapterId === 'voice' ? COPY.lineupAskVoice : COPY.lineupAskValues;
  return `<div class="ts-step" data-ts-key="lineup" data-ts-scene="gallery">
    ${stepperMarkup(ts, esc)}
    <h1 class="ts-q" tabindex="-1" data-focus>${esc(COPY.lineupTitle)}</h1>
    <details class="ts-lineup-details"><summary>並べた表を見る</summary>${body}</details>
    <p class="ts-lead">${esc(ask)}</p>
    <div class="ts-actions"><button type="button" class="primary-button ts-find-primary" data-ts-primary="find" data-action="torisetsu-find">${esc(COPY.findCommon)}</button></div>
  </div>`;
}

const BAND_CLASS = { cross: 'ts-side-cross', link: 'ts-side-bad', hard: 'ts-side-bad', happy: 'ts-side-good' };
const BAND_LABEL = { cross: COPY.bandCross, link: COPY.bandLink, hard: COPY.bandHard, happy: COPY.bandHappy };

function insightResultCount(ts) {
  const d = ts.data[ts.chapterId];
  if (ts.chapterId === 'needs') return needsInsights(d.happy, d.hard).rows.length;
  if (ts.chapterId === 'voice') return voiceInsights(d.episodes).items.length;
  return valuesInsights(d.neg, d.pos, d.admire).items.length;
}

function insightPagerMarkup(ts, esc, total) {
  if (total <= 1) return '';
  const page = Math.max(0, Math.min(ts.insightPage, total - 1));
  return `<nav class="ts-insight-pager" aria-label="発見のページ"><span>${page + 1} / ${total}</span><button type="button" class="ts-mini-button" data-action="torisetsu-insight-page" data-direction="prev"${page === 0 ? ' disabled' : ''}>前の発見</button></nav>`;
}

function countRowMarkup(parts, esc) {
  return `<span class="ts-count-row" aria-hidden="true">${parts.map((part, i) => `${i ? '<span class="ts-count-bar">｜</span>' : ''}<span class="${i === 0 ? 'ts-count-own' : 'ts-count-other'}">${esc(part.label)} <span class="ts-dots">${dotsOf(part.cells)}</span> ${esc(part.count)}</span>`).join('')}</span>`;
}

function insightEvidence(sentence, details) {
  return `<details class="ts-evidence"><summary>根拠を見る</summary><div class="ts-evidence-detail"><p class="ts-find-sentence">${sentence}</p>${details}</div></details>`;
}

function insightView(ts, h) {
  const { esc, support } = h; const d = ts.data[ts.chapterId];
  let body = ''; let actions = '';
  const insightTotal = insightResultCount(ts);
  const insightPage = Math.max(0, Math.min(ts.insightPage, Math.max(0, insightTotal - 1)));
  const hasGap = ts.chapterId !== 'voice' && d.prediction.length > 0 && gapFor(ts.chapterId, ts.data).rows.length > 0;
  const primary = insightTotal > 1 && insightPage < insightTotal - 1
    ? `<button type="button" class="primary-button" data-action="torisetsu-insight-page" data-direction="next">次の発見</button>`
    : `<button type="button" class="primary-button" data-action="torisetsu-compare">${esc(hasGap ? COPY.compareGap : COPY.nextButton)}</button>`;
  const extraLine = (text) => `<p class="ts-extra">${esc(text)}</p>`;
  const contextDetails = (parts) => {
    const visible = parts.filter(Boolean);
    return visible.length ? `<details class="ts-insight-context"><summary>答えのつながりを見る</summary>${visible.join('')}</details>` : '';
  };
  const heavy = heavyNote(ts.chapterId, ts.data) ? `<section class="ts-heavy"><p>${esc(COPY.heavyNote)}</p>${support ? support() : ''}</section>` : '';
  if (ts.chapterId === 'needs') {
    const ins = needsInsights(d.happy, d.hard);
    if (ins.empty) {
      const near = ins.near ? `<section class="ts-near"><h2>${esc(COPY.nearTitle)}</h2><ul class="ts-list"><li>${esc(ins.near.text)}</li></ul></section>` : '';
      const list = ins.listLine ? `<p class="ts-extra">${esc(ins.listLine.label)}${ins.listLine.tags.map((tag) => `『${esc(tag)}』`).join('')}</p>` : '';
      body = `<p class="ts-insight-headline">${esc(COPY.insightNoneTitle)}</p><p class="ts-lead">${esc(COPY.insightNoneBody)}</p>${near}${list}${heavy}`;
      actions = `${d.happy.length < cfgOf(ts).maxes.happy ? `<button type="button" class="secondary-button" data-action="torisetsu-add-item" data-side="happy" data-return-to="insight">${esc(COPY.addHappy)}</button>` : ''}${d.hard.length < cfgOf(ts).maxes.hard ? `<button type="button" class="secondary-button" data-action="torisetsu-add-item" data-side="hard" data-return-to="insight">${esc(COPY.addHard)}</button>` : ''}<button type="button" class="primary-button" data-action="torisetsu-compare">${esc(COPY.goOn)}</button><button type="button" class="text-button" data-action="torisetsu-days">${esc(COPY.fixEpisodes)}</button>`;
    } else {
      const bands = ins.rows.slice(insightPage, insightPage + 1).map((item, i) => `<section class="ts-band ${BAND_CLASS[item.band]}"><h2>${esc(BAND_LABEL[item.band])}</h2><ul class="ts-finds"><li class="ts-find" style="--i:${i}"><span class="ts-find-tag">${esc(item.heading)}</span>${insightEvidence(esc(item.sentence), countRowMarkup(item.parts, esc))}</li></ul></section>`).join('');
      const extra = ins.extra.length ? extraLine(`${COPY.extraHead}${ins.extra.map((item) => item.short).join('')}`) : '';
      body = `${bands}<p class="ts-note">今回の答えから見えた傾向です。</p>${contextDetails([`<p class="ts-insight-lead">${esc(COPY.insightIntro)}</p>`, ins.sceneLine ? `<p class="ts-compare-line">${esc(ins.sceneLine)}</p>` : '', extra, ins.footer || ins.footerAdd ? `<p class="ts-note">${esc(ins.footer || '')}${esc(ins.footerAdd || '')}</p>` : ''])}${heavy}`;
      actions = `${primary}<button type="button" class="secondary-button" data-action="torisetsu-days">${esc(COPY.fixEpisodes)}</button>`;
    }
  } else if (ts.chapterId === 'voice') {
    const ins = voiceInsights(d.episodes);
    if (ins.empty) {
      body = `<p class="ts-insight-headline">${esc(COPY.voiceNoneTitle)}</p><ul class="ts-list ts-cands">${ins.candidates.map((item) => `<li>『${esc(item.label)}』</li>`).join('')}</ul><p class="ts-lead">${esc(COPY.voiceNoneBody)}</p>${heavy}`;
      actions = `${d.episodes.length < cfgOf(ts).maxes.voice ? `<button type="button" class="secondary-button" data-action="torisetsu-add-item" data-side="voice" data-return-to="insight">${esc(COPY.addScene)}</button>` : ''}${primary}<button type="button" class="text-button" data-action="torisetsu-days">${esc(COPY.fixScenes)}</button>`;
    } else {
      const bands = ins.items.slice(insightPage, insightPage + 1).map((item, i) => `<section class="ts-band ts-side-bad"><h2>${esc(COPY.bandVoice)}</h2><ul class="ts-finds"><li class="ts-find" style="--i:${i}"><span class="ts-find-tag">${esc(item.heading)}</span>${insightEvidence(esc(item.sentence), `<span class="ts-count-row" aria-hidden="true"><span class="ts-count-own"><span class="ts-dots">${dotsOf(item.cells)}</span> ${esc(item.count)}${esc(item.paren)}</span></span>`)}</li></ul></section>`).join('');
      const extra = ins.extra.length ? extraLine(`${COPY.extraHead}${ins.extra.map((item) => item.heading).join('')}`) : '';
      body = `${bands}<p class="ts-note">今回の答えから見えた傾向です。</p>${contextDetails([`<p class="ts-insight-lead">${esc(COPY.insightIntro)}</p>`, extra, ins.footer || ins.footerAdd ? `<p class="ts-note">${esc(ins.footer || '')}${esc(ins.footerAdd || '')}</p>` : ''])}${heavy}`;
      actions = `${primary}<button type="button" class="secondary-button" data-action="torisetsu-days">${esc(COPY.fixScenes)}</button>`;
    }
  } else {
    const ins = valuesInsights(d.neg, d.pos, d.admire);
    if (ins.empty) {
      body = `<p class="ts-insight-headline">${esc(COPY.valuesNoneTitle)}</p><ul class="ts-list ts-cands">${ins.candidates.map((item) => `<li>${esc(item.label)}</li>`).join('')}</ul><p class="ts-lead">${esc(COPY.valuesNoneBody)}</p>`;
      actions = `${d.neg.length < cfgOf(ts).maxes.neg ? `<button type="button" class="secondary-button" data-action="torisetsu-add-item" data-side="neg" data-return-to="insight">${esc(COPY.addNeg)}</button>` : ''}${d.pos.length < cfgOf(ts).maxes.pos ? `<button type="button" class="secondary-button" data-action="torisetsu-add-item" data-side="pos" data-return-to="insight">${esc(COPY.addPos)}</button>` : ''}<button type="button" class="primary-button" data-action="torisetsu-compare">${esc(COPY.goOn)}</button><button type="button" class="text-button" data-action="torisetsu-days">${esc(COPY.fixEpisodes)}</button>`;
    } else {
      const lis = ins.items.slice(insightPage, insightPage + 1).map((item, i) => {
        const row = [item.a > 0 ? `イラッと ${dotsOf(d.neg.map((ep) => ep.value === item.id))}` : '', item.p > 0 ? `じーんと ${dotsOf(d.pos.map((ep) => ep.value === item.id))}` : '', item.m > 0 ? `いいなと思った人 ●` : ''].filter(Boolean).join('｜');
        return `<li class="ts-find" style="--i:${i}"><span class="ts-find-tag">『${esc(item.label)}』</span>${insightEvidence(esc(item.sentence), `<span class="ts-count-row" aria-hidden="true"><span class="ts-count-own"><span class="ts-dots">${esc(row)}</span></span></span>`)}</li>`;
      }).join('');
      const extra = ins.extra.length ? extraLine(`${COPY.extraValues}${ins.extra.map((item) => `『${item.label}』`).join('')}`) : '';
      body = `<section class="ts-band ts-side-good"><ul class="ts-finds">${lis}</ul></section><p class="ts-note">今回の答えから見えた傾向です。</p>${contextDetails([`<p class="ts-insight-lead">${esc(COPY.insightIntro)}</p>`, extra, ins.summary ? `<p class="ts-insight-summary">${esc(ins.summary)}</p>` : '', ins.footer ? `<p class="ts-note">${esc(ins.footer)}</p>` : ''])}`;
      actions = `${primary}<button type="button" class="secondary-button" data-action="torisetsu-days">${esc(COPY.fixEpisodes)}</button>`;
    }
  }
  return `<section class="ts-step ts-gallery ts-insight" data-ts-key="insight" data-ts-scene="insight" data-gallery-stage="discovery">
    ${stepperMarkup(ts, esc)}
    <figure class="ts-gallery-scene"><img class="ts-scene-art" src="./assets/torisetsu-gallery/discovery-sculpture.png" alt="" aria-hidden="true" width="360" height="260" loading="lazy" /></figure><div class="ts-gallery-copy">
      <div class="ts-step-heading"><h1 class="ts-q" tabindex="-1" data-focus>${esc(COPY.insightTitle)}</h1></div>
      ${insightPagerMarkup(ts, esc, insightTotal)}
      ${body}
      <div class="ts-actions">${actions}</div>
    </div>
  </section>`;
}

function gapView(ts, h) {
  const { esc } = h;
  const gap = gapFor(ts.chapterId, ts.data);
  const rows = gap.rows.map((row) => `<div class="ts-gap-row ts-verdict-${esc(row.verdict)}"><p class="ts-gap-thought">${esc(row.thought)}</p><p class="ts-gap-result">${esc(row.text)}</p></div>`).join('');
  return `<div class="ts-step ts-gap" data-ts-key="gap" data-ts-scene="insight">
    ${stepperMarkup(ts, esc)}
    <h1 class="ts-q" tabindex="-1" data-focus>${esc(COPY.gapTitle)}</h1>
    ${rows}
    ${gap.actual ? `<p class="ts-gap-actual">${esc(gap.actual)}</p>` : ''}
    <div class="ts-actions"><button type="button" class="primary-button" data-action="torisetsu-gap-next">${esc(COPY.nextButton)}</button></div>
  </div>`;
}

// 第 2 章：その声は、何を守ろうとしている？
function protectView(ts, h) {
  const { esc } = h; const voice = ts.data.voice;
  const focus = effectiveFocus(voice); const voices = focusVoices(voice, focus).map((t) => t.label);
  const choices = focusChoices(voice);
  const other = choices.length >= 2 ? `<button type="button" class="ts-mini-button ts-other-voice" data-action="torisetsu-focus-open" aria-expanded="${ts.focusPicker}">${esc(COPY.otherVoice)}</button>` : '';
  const picker = ts.focusPicker ? `<div class="ts-chips" role="radiogroup" aria-label="${esc(COPY.otherVoiceTitle)}">${choices.map((p) => `<button type="button" class="ts-chip${p.id === focus ? ' is-on' : ''}" role="radio" aria-checked="${p.id === focus}" data-action="torisetsu-focus-set" data-chip="${esc(p.id)}"><span>${esc(p.name)}声</span></button>`).join('')}</div>` : '';
  return `<section class="ts-step ts-gallery" data-ts-key="protect" data-ts-scene="gallery" data-gallery-stage="arrival">
    ${stepperMarkup(ts, esc)}
    <figure class="ts-gallery-scene"><img class="ts-scene-art ts-scene-art-arrival" src="./assets/torisetsu-gallery/arrival-gallery.png" alt="" aria-hidden="true" width="360" height="260" loading="lazy" /></figure><div class="ts-gallery-copy">
    <p class="ts-voice-head">${esc(COPY.protectVoiceHead(voices))}</p>
    ${other}${picker}
    <h1 class="ts-q" tabindex="-1" data-focus>${esc(COPY.protectTitle)}</h1>
    <p class="ts-lead">${esc(COPY.protectLead)}</p>
    ${chipGroupMarkup(ts, esc, { label: '2つまで', hint: '', max: 2, chips: INTENTS.map(({ id, label }) => ({ id, label })), selected: voice.intents, groupId: 'intents', radio: false, limitGroup: 'intents' })}
    <div class="ts-actions"><button type="button" class="primary-button" data-action="torisetsu-protect-next">${esc(COPY.protectNext)}</button><button type="button" class="text-button ts-skip" data-action="torisetsu-protect-next" data-key="skip">${esc(COPY.layerSkip)}</button></div>
    </div>
  </section>`;
}

// 第 2 章：大事な友だちなら、何て返す？
function replyView(ts, h) {
  const { esc } = h; const voice = ts.data.voice;
  const focus = effectiveFocus(voice); const voices = focusVoices(voice, focus).map((t) => t.label);
  const buttons = replyOptions(focus).map((item) => { const on = isPicked(ts, 'reply', item.id); const feedback = ts.feedback?.group === 'reply' && ts.feedback?.chip === item.id ? ' is-feedback' : ''; return `<button type="button" class="ts-chip ts-chip-wide${on ? ' is-on' : ''}${feedback}" role="radio" aria-checked="${on}" data-action="torisetsu-chip" data-group="reply" data-chip="${esc(item.id)}" data-pick-kind="reply" data-pick-key="${esc(item.id)}"><span>${esc(item.label)}</span></button>`; }).join('');
  const open = ts.textOpen.reply || Boolean(voice.replyText);
  const free = open
    ? `<label class="ts-field ts-free"><span class="visually-hidden">${esc(COPY.freeWrite)}</span><input type="text" inputmode="text" autocomplete="off" maxlength="${TEXT_MAX}" data-ts-text="reply" value="${esc(voice.replyText)}" placeholder="${esc(COPY.replyPlaceholder)}" /><small data-ts-count="reply">${esc(COPY.freeCount(Array.from(voice.replyText).length))}</small></label>`
    : `<button type="button" class="ts-write" data-action="torisetsu-text-open" data-kind="reply">＋ ${esc(COPY.freeWrite)}</button>`;
  return `<section class="ts-step ts-gallery" data-ts-key="reply" data-ts-scene="gallery" data-gallery-stage="arrival">
    ${stepperMarkup(ts, esc)}
    <figure class="ts-gallery-scene"><img class="ts-scene-art ts-scene-art-arrival" src="./assets/torisetsu-gallery/arrival-gallery.png" alt="" aria-hidden="true" width="360" height="260" loading="lazy" /></figure><div class="ts-gallery-copy">
    <h1 class="ts-q" tabindex="-1" data-focus id="ts-reply-title">${esc(COPY.replyTitle)}</h1>
    <p class="ts-lead">${esc(COPY.replyLead(voices))}</p>
    <p class="ts-hint">${esc(COPY.replyHint)}</p>
    <div class="ts-chips ts-chips-col" role="radiogroup" aria-labelledby="ts-reply-title">${buttons}</div>${free}
    <p class="ts-note">${esc(COPY.replyClosing)}</p>
    <div class="ts-actions"><button type="button" class="primary-button" data-action="torisetsu-reply-next">${esc(COPY.replyNext)}</button></div>
    </div>
  </section>`;
}

function choiceListMarkup(ts, esc, kind, options) {
  const d = ts.data[ts.chapterId];
  const buttons = options.map((item) => { const on = isPicked(ts, kind, item.key); const feedback = ts.feedback?.group === kind && ts.feedback?.chip === item.key ? ' is-feedback' : ''; return `<button type="button" class="ts-chip ts-chip-wide${on ? ' is-on' : ''}${feedback}" role="radio" aria-checked="${on}" data-action="torisetsu-pick" data-kind="${kind}" data-pick-kind="${kind}" data-pick-key="${esc(item.key)}" data-key="${esc(item.key)}"><span>${esc(item.label ?? item.text)}</span></button>`; }).join('');
  const open = ts.textOpen[kind] || Boolean(d[`${kind}Text`]);
  const placeholder = kind === 'surprise' ? COPY.surprisePlaceholder : COPY.tryPlaceholder;
  const free = open
    ? `<label class="ts-field ts-free"><span class="visually-hidden">${esc(COPY.freeWrite)}</span><input type="text" inputmode="text" autocomplete="off" maxlength="${TEXT_MAX}" data-ts-text="${kind}" value="${esc(d[`${kind}Text`])}" placeholder="${esc(placeholder)}" /><small data-ts-count="${kind}">${esc(COPY.freeCount(Array.from(d[`${kind}Text`]).length))}</small></label>`
    : `<button type="button" class="ts-write" data-action="torisetsu-text-open" data-kind="${kind}">＋ ${esc(COPY.freeWrite)}</button>`;
  return `<div class="ts-chips ts-chips-col" role="radiogroup" aria-labelledby="ts-pick-title">${buttons}</div>${free}`;
}

function surpriseView(ts, h) {
  const { esc } = h;
  return `<section class="ts-step ts-gallery" data-ts-key="surprise" data-ts-scene="gallery" data-gallery-stage="arrival">
    ${stepperMarkup(ts, esc)}
    <figure class="ts-gallery-scene"><img class="ts-scene-art ts-scene-art-arrival" src="./assets/torisetsu-gallery/arrival-gallery.png" alt="" aria-hidden="true" width="360" height="260" loading="lazy" /></figure><div class="ts-gallery-copy">
    <h1 class="ts-q" tabindex="-1" data-focus id="ts-pick-title">${esc(COPY.surpriseTitle)}</h1>
    <p class="ts-hint">${esc(COPY.surpriseHint)}</p>
    ${choiceListMarkup(ts, esc, 'surprise', surpriseOptions(ts.chapterId, ts.data))}
    <div class="ts-actions"><button type="button" class="primary-button" data-action="torisetsu-surprise-next">${esc(COPY.nextButton)}</button></div>
    </div>
  </section>`;
}

function tryView(ts, h) {
  const { esc } = h;
  return `<section class="ts-step ts-gallery" data-ts-key="try" data-ts-scene="gallery" data-gallery-stage="arrival">
    ${stepperMarkup(ts, esc)}
    <figure class="ts-gallery-scene"><img class="ts-scene-art ts-scene-art-arrival" src="./assets/torisetsu-gallery/arrival-gallery.png" alt="" aria-hidden="true" width="360" height="260" loading="lazy" /></figure><div class="ts-gallery-copy">
    <h1 class="ts-q" tabindex="-1" data-focus id="ts-pick-title">${esc(COPY.tryTitle)}</h1>
    <p class="ts-hint">${esc(COPY.tryHint)}</p>
    ${choiceListMarkup(ts, esc, 'experiment', tryOptions(ts.chapterId, ts.data))}
    <p class="ts-note">${esc(COPY.tryFooter)}</p>
    <div class="ts-actions"><button type="button" class="primary-button" data-action="torisetsu-finish" data-ts-finish>${esc(finishLabel(ts))}</button></div>
    </div>
  </section>`;
}

function daysView(ts, h) {
  const { esc } = h; const cfg = cfgOf(ts);
  const title = ts.chapterId === 'needs' ? COPY.daysTitleNeeds : ts.chapterId === 'voice' ? COPY.daysTitleVoice : COPY.daysTitleValues;
  const headOf = (record) => {
    const scene = sceneById(record.scene)?.short || '';
    return `${scene}${record.memo ? `「${record.memo}」` : ''}`;
  };
  const summaryOf = (side, record) => {
    if (ts.chapterId === 'needs') {
      const tail = side === 'hard' ? surfaceById(record.surface)?.label : SURFACE_HAPPY.find((item) => item.id === record.feelings[0])?.label;
      const fallback = side === 'hard' ? deepById(record.deep[0])?.label : '';
      return [headOf(record), tail || fallback || ''].filter(Boolean).join('／');
    }
    if (ts.chapterId === 'voice') return [headOf(record), record.thoughts.map((id) => thoughtById(id)?.label).filter(Boolean).join('、')].filter(Boolean).join('／');
    return `${SITUATION_BY_ID[record.situation]?.label || ''}${record.memo ? `「${record.memo}」` : ''}`;
  };
  const section = (side) => {
    const items = sideList(ts.data, ts.chapterId, side);
    const rows = items.map((record, index) => `<li><span class="ts-days-n">${index + 1}つ目</span><span class="ts-days-text">${esc(summaryOf(side, record))}</span><button type="button" class="ts-mini-button" data-action="torisetsu-edit-item" data-side="${esc(side)}" data-index="${index}" aria-label="${index + 1}つ目を${esc(COPY.fixOne)}">${esc(COPY.fixOne)}</button></li>`).join('');
    const add = items.length < maxOf(cfg, side) ? `<button type="button" class="secondary-button ts-add" data-action="torisetsu-add-item" data-side="${esc(side)}" data-return-to="days">${esc(COPY.addOneEpisode)}</button>` : '';
    const heading = cfg.sides.length > 1 ? `<h2>${esc(SIDE_COPY[side].label)}</h2>` : '';
    return `<section class="ts-days-group ts-side-${SIDE_COPY[side].color}">${heading}<ol class="ts-days-list">${rows}</ol>${add}</section>`;
  };
  let admire = '';
  if (ts.chapterId === 'values') {
    const a = ts.data.values.admire;
    if (a) admire = `<section class="ts-days-group ts-side-good"><h2>${esc(SIDE_COPY.admire.label)}</h2><ol class="ts-days-list"><li><span class="ts-days-n">1つ目</span><span class="ts-days-text">${esc([admireWhoById(a.who)?.label || '', a.qualities.map((q) => qualityById(q.id).label).join('、')].filter(Boolean).join('／'))}</span><button type="button" class="ts-mini-button" data-action="torisetsu-edit-item" data-side="admire" data-index="0" aria-label="いいなと思った人を${esc(COPY.fixOne)}">${esc(COPY.fixOne)}</button></li></ol></section>`;
    else admire = `<section class="ts-days-group ts-side-good"><button type="button" class="secondary-button ts-add" data-action="torisetsu-add-item" data-side="admire" data-return-to="days">${esc(COPY.addOneAdmire)}</button></section>`;
  }
  return `<section class="ts-step ts-gallery" data-ts-key="days" data-ts-scene="gallery" data-gallery-stage="arrival">
    ${stepperMarkup(ts, esc)}
    <figure class="ts-gallery-scene"><img class="ts-scene-art ts-scene-art-arrival" src="./assets/torisetsu-gallery/arrival-gallery.png" alt="" aria-hidden="true" width="360" height="260" loading="lazy" /></figure><div class="ts-gallery-copy">
    <h1 class="ts-q" tabindex="-1" data-focus>${esc(title)}</h1>
    ${cfg.sides.map(section).join('')}${admire}
    <div class="ts-actions"><button type="button" class="primary-button" data-action="torisetsu-days-done">${esc(COPY.backToInsight)}</button></div>
    </div>
  </section>`;
}

function doneView(ts, h) {
  const { esc, support } = h; const cfg = cfgOf(ts);
  const complete = doneCount(ts.data) >= CHAPTERS.length;
  const chapterIndex = Math.max(0, CHAPTERS.findIndex((chapter) => chapter.id === ts.chapterId));
  const chapterNumber = chapterIndex + 1;
  const chapterProgress = `完了 ${doneCount(ts.data)} / ${CHAPTERS.length}`;
  const chapterMarkers = CHAPTERS.map((chapter, index) => `<li class="ts-done-chapter-marker${ts.data[chapter.id].done ? ' is-done' : ''}${index === chapterIndex ? ' is-current' : ''}"${index === chapterIndex ? ' aria-current="step"' : ''}><span>${index + 1}</span><small>${esc(chapter.short || chapter.label)}</small></li>`).join('');
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
  const book = `<figure class="ts-done-book"><img src="./assets/torisetsu-gallery/done-book-cover.png" alt="" aria-hidden="true" width="1086" height="1448" /><figcaption class="ts-done-book-label"><small>CHAPTER ${String(chapterNumber).padStart(2, '0')}</small><strong>${esc(cfg.label)}</strong></figcaption><span class="ts-done-book-brand">わたしのトリセツ<br>Mingle.cards</span></figure>`;
  return `<section class="ts-done ts-done-gallery" data-ts-key="done:${esc(ts.chapterId)}" data-ts-scene="gallery" data-gallery-stage="manual" data-ts-done-chapter="${esc(ts.chapterId)}">
    <nav class="ts-done-progress" aria-label="章の進み具合"><ol>${chapterMarkers}</ol><span class="ts-done-progress-count">${esc(chapterProgress)}</span></nav>
    <div class="ts-done-layout"><div class="ts-done-visual">${book}<details class="ts-done-details"><summary>この章の内容</summary>${paper}</details></div><div class="ts-done-content">
      <p class="ts-done-marker"><span aria-hidden="true"></span>CHAPTER ${String(chapterNumber).padStart(2, '0')}　${esc(cfg.short || cfg.label)}</p>
      <h1 class="ts-title" tabindex="-1" data-focus>${esc(complete ? 'トリセツが、できました。' : 'この章が、できました。')}</h1>
      <p class="ts-lead">${esc(cfg.done.body)}</p>
      <div class="ts-done-actions"><div class="ts-actions">${primary}</div><button type="button" class="text-button ts-done-contents" data-action="torisetsu-contents">${esc(COPY.toContents)}</button></div>
      <section class="ts-done-save" aria-label="保存設定">${saveCardMarkup(ts, esc)}</section>
      ${support ? `<div class="ts-done-support">${support()}</div>` : ''}
    </div></div>
  </section>`;
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
    <div class="ts-hero"><img class="ts-scene-art ts-scene-art-arrival" src="./assets/torisetsu-gallery/arrival-gallery.png" alt="" aria-hidden="true" width="360" height="220" loading="lazy" /></div>
    <h1 class="ts-title" tabindex="-1" data-focus>${esc(COPY.startTitle)}</h1>
    <p class="ts-lead">${esc(COPY.startLead)}</p>
    <div class="ts-privacy" role="note">${iconSvg('lock', 20)}<div><strong>${esc(COPY.privacyTitle)}</strong><p>${esc(COPY.privacyBody)}</p></div></div>
    <p class="ts-note">${esc(COPY.startGuide)}<br>${esc(COPY.startGuide2)}</p>
    <div class="ts-actions"><button type="button" class="primary-button" data-action="torisetsu-begin">${esc(COPY.begin)}</button></div>
  </div>`;
}

function contentsView(ts, h) {
  const { esc } = h;
  const done = doneCount(ts.data);
  const dots = CHAPTERS.map((chapter) => `<span class="ts-cell${ts.data[chapter.id].done ? ' is-done' : ''}"></span>`).join('');
  const chapterArt = { needs: 'arrival-gallery.png', voice: 'deep-layers.png', values: 'discovery-sculpture.png' };
  const statusLabel = { todo: '未着手', doing: '途中', done: '完了' };
  const rows = CHAPTERS.map((chapter) => {
    const status = chapterStatus(ts.data, chapter.id);
    const full = status === 'done';
    const label = full ? COPY.chapterReview : status === 'doing' ? COPY.chapterContinue : COPY.chapterStart;
    const line = chapterReady(chapter.id, ts.data) ? teaser(chapter.id, ts.data) : '';
    const number = String(CHAPTERS.indexOf(chapter) + 1).padStart(2, '0');
    return `<li class="ts-chapter ts-contents-card ts-status-${esc(status)}${full ? ' is-done' : ''}" data-ts-chapter="${esc(chapter.id)}" data-ts-status="${esc(status)}"><div class="ts-chapter-copy"><small class="ts-chapter-number">CHAPTER ${number}</small><strong>${esc(chapter.label)}</strong><small class="ts-chapter-subtitle">${esc(chapter.subtitle)}</small>${line ? `<small class="ts-teaser">${esc(line)}</small>` : ''}</div><img class="ts-chapter-thumb" src="./assets/torisetsu-gallery/${chapterArt[chapter.id]}" alt="" aria-hidden="true" width="360" height="260" loading="lazy" /><div class="ts-chapter-footer"><span class="ts-chapter-status"><span aria-hidden="true">${full ? iconSvg('check', 14) : status === 'doing' ? '◐' : '○'}</span>${statusLabel[status]}</span><button type="button" class="${full ? 'secondary-button' : 'primary-button'} ts-chapter-button" data-action="torisetsu-chapter" data-chapter="${esc(chapter.id)}" aria-label="${esc(chapter.label)}を${esc(label)}">${esc(label)}<span aria-hidden="true">　→</span></button></div></li>`;
  }).join('');
  const label = done >= CHAPTERS.length ? COPY.allDone : COPY.progressLabel(done);
  const view = done > 0 || CHAPTER_IDS.some((id) => chapterReady(id, ts.data)) ? `<button type="button" class="secondary-button ts-view" data-action="torisetsu-manual">${esc(COPY.viewManual)}</button>` : '';
  return `<div class="ts-contents ts-contents-editorial" data-ts-key="contents">
    <header class="ts-contents-header"><h1 class="ts-title" tabindex="-1" data-focus>${esc(COPY.contentsTitle)}</h1><div class="ts-contents-progress"><p class="ts-progress-label">${esc(label)}</p><div class="ts-progress"><div class="ts-cells" role="img" aria-label="${esc(label)}">${dots}</div><span>${done} / ${CHAPTERS.length}</span></div></div></header>
    <ul class="ts-chapters">${rows}</ul>
    ${view ? `<div class="ts-contents-manual">${view}</div>` : ''}
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
  const available = manual.sections.filter((section) => section.state !== 'hidden');
  const active = available.find((section) => section.id === ts.manualSectionId) || available[0] || null;
  if (active && ts.manualSectionId !== active.id) ts.manualSectionId = active.id;
  const nav = available.length ? `<nav class="ts-manual-nav" aria-label="章を選ぶ">${available.map((section) => `<button type="button" class="ts-manual-nav-item${section.id === active?.id ? ' is-active' : ''}" data-action="torisetsu-manual-section" data-id="${esc(section.id)}" data-manual-section="${esc(section.id)}" aria-current="${section.id === active?.id ? 'page' : 'false'}"><span>${section.number}</span>${esc(section.title)}</button>`).join('')}</nav>` : '';
  const paper = manualPaper(ts, helpers, { cover: false, sections: (manualData) => active ? manualData.sections.filter((section) => section.id === active.id) : manualData.sections });
  const image = imageEnabled !== false && manualHasContent(manual)
    ? `<section class="ts-share"><p>${esc(COPY.shareNote)}</p><div class="ts-share-buttons"><button type="button" class="secondary-button" data-action="torisetsu-image" ${ts.imageBusy ? 'disabled' : ''}>${esc(ts.imageBusy ? COPY.imageMaking : COPY.makeImage)}</button>${canSend ? `<button type="button" class="secondary-button" data-action="torisetsu-share" ${ts.imageBusy ? 'disabled' : ''}>${esc(COPY.sendImage)}</button>` : ''}</div>${canSend ? `<p class="ts-share-hint">${esc(COPY.sendHint)}</p>` : ''}<p class="ts-image-status" role="status" aria-live="polite">${esc(ts.imageStatus)}</p></section>`
    : '';
  return `<section class="ts-manual ts-gallery" data-ts-key="manual" data-ts-scene="manual" data-gallery-stage="manual" data-manual-active="${esc(active?.id || '')}">
    <h1 class="visually-hidden" tabindex="-1" data-focus>わたしのトリセツ</h1>
    ${progressMarkup(ts, esc)}
    <figure class="ts-gallery-scene"><img class="ts-scene-art" src="./assets/torisetsu-gallery/book-cover-architecture.png" alt="" aria-hidden="true" width="360" height="300" /></figure><div class="ts-gallery-copy">
      <header class="ts-manual-heading"><small>取扱説明書</small><h1>${esc(manual.title)}</h1><p>${esc(manual.version)}</p></header>
      ${nav}
      ${nameBlock(ts, manual, esc, true)}
      ${paper}
      <p class="ts-warranty ts-manual-warranty">${esc(manual.warranty)}</p>
    ${saveCardMarkup(ts, esc)}
    ${image}
    <div class="ts-actions"><button type="button" class="secondary-button" data-action="torisetsu-contents">${esc(COPY.toContents)}</button></div>
    ${support ? support() : ''}
    </div>
  </section>`;
}

function stepView(ts, h) {
  switch (ts.step) {
    case 'predict': return predictView(ts, h);
    case 'recall-intro': return introView(ts, h);
    case 'layer': return ts.draft ? layerView(ts, h) : contentsView(ts, h);
    case 'episode': return ts.draft ? itemView(ts, h) : contentsView(ts, h);
    case 'admire': return ts.draft ? admireView(ts, h) : contentsView(ts, h);
    case 'short': return shortView(ts, h);
    case 'lineup': return lineupView(ts, h);
    case 'insight': return insightView(ts, h);
    case 'gap': return gapView(ts, h);
    case 'protect': return protectView(ts, h);
    case 'reply': return replyView(ts, h);
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
  return `<header class="topbar ts-topbar"><button type="button" class="ts-back" data-action="torisetsu-back" aria-label="${esc(COPY.back)}">${iconSvg('left', 20)}<span>${esc(COPY.back)}</span></button><strong class="ts-topbar-title"><span class="ts-topbar-name">${esc(COPY.appTitle)}</span><span class="ts-topbar-by"> by Mingle.cards</span></strong><span class="ts-topbar-space" aria-hidden="true"></span></header><section class="content ts-content ts-gallery-content"><div class="ts-screen" data-ts-view="${esc(ts.view)}" data-ts-view-key="${esc(torisetsuViewKey(ts))}">${body}</div></section>${leave}${toast}`;
}

export function torisetsuViewKey(ts) {
  return `${ts.view}:${ts.chapterId || ''}:${ts.step || ''}:${ts.side || ''}:${ts.index}:${ts.layer}:${ts.phase}:${ts.target}:${ts.manualSectionId || ''}:${ts.insightPage || 0}`;
}

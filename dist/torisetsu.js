// 「自分のトリセツ」ビルダー。中身（答え）は端末の外に出さない。
// - このファイルは通信しない（fetch / XHR / sendBeacon / WebSocket / EventSource を使わない）。
// - analytics・account・session-storage を読み込まない。
// - storage は引数で受け取る（window / document に直接触れない）。
import { CHAPTERS, SECTIONS, COPY, TEXT_MAX, NAME_MAX, TYPE_TEXT_MAX } from './data/torisetsu-content.js';

export { CHAPTERS, SECTIONS, COPY };
export const STORAGE_KEY = 'mingle.torisetsu.v1';
export const UNDO_MS = 5000;
export const TOTAL_SECTIONS = SECTIONS.length;

const SECTION_BY_ID = Object.fromEntries(SECTIONS.map((section) => [section.id, section]));
const CHAPTER_BY_ID = Object.fromEntries(CHAPTERS.map((chapter) => [chapter.id, chapter]));
export const sectionById = (id) => SECTION_BY_ID[id] || null;
export const chapterById = (id) => CHAPTER_BY_ID[id] || null;
const chipOf = (section, chipId) => section.chips.find((item) => item.id === chipId) || null;

// ---------- 文字の整え ----------
// 制御文字・改行を除き、コードポイント単位で max 字に切る。typing 中は trim しない。
export function sanitizeText(value, max = TEXT_MAX, { trim = true } = {}) {
  let text = typeof value === 'string' ? value : value == null ? '' : String(value);
  text = text.replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, ' ').replace(/\p{Cf}/gu, '');
  if (trim) text = text.replace(/\s+/g, ' ').trim();
  return Array.from(text).slice(0, max).join('');
}

const textLimit = (section) => section.textMax || TEXT_MAX;
const hasText = (answer) => Boolean(answer && typeof answer.text === 'string' && answer.text.trim());

export function isAnswered(section, answer) {
  if (!section || !answer) return false;
  const chips = Array.isArray(answer.chips) ? answer.chips.length : 0;
  if (chips > 0 || hasText(answer)) return true;
  return section.mode === 'name' && typeof answer.name === 'string' && Boolean(answer.name.trim());
}

// 答え 1 欄を検査してきれいな形にする。知らないチップ id は捨てる。空なら null。
export function normalizeAnswer(section, raw) {
  if (!section || !raw || typeof raw !== 'object') return null;
  const text = sanitizeText(raw.text, textLimit(section));
  const seen = new Set();
  let chips = (Array.isArray(raw.chips) ? raw.chips : []).filter((id) => typeof id === 'string' && chipOf(section, id) && !seen.has(id) && seen.add(id));
  chips = chips.slice(0, section.max);
  if (text && chips.length >= section.max) chips = chips.slice(0, section.max - 1);
  const answer = { chips, text };
  if (section.mode === 'name') answer.name = sanitizeText(raw.name, NAME_MAX);
  return isAnswered(section, answer) ? answer : null;
}

export function normalizeAnswers(raw) {
  const answers = {};
  if (!raw || typeof raw !== 'object') return answers;
  for (const section of SECTIONS) {
    if (!Object.prototype.hasOwnProperty.call(raw, section.id)) continue;
    const answer = normalizeAnswer(section, raw[section.id]);
    if (answer) answers[section.id] = answer;
  }
  return answers;
}

const cloneAnswers = (answers) => JSON.parse(JSON.stringify(answers || {}));

// ---------- 進み具合 ----------
export function progress(answers) {
  const byChapter = {};
  let done = 0;
  for (const chapter of CHAPTERS) {
    const count = chapter.sections.filter((id) => isAnswered(SECTION_BY_ID[id], answers?.[id])).length;
    byChapter[chapter.id] = { done: count, total: chapter.sections.length };
    done += count;
  }
  return { done, total: TOTAL_SECTIONS, byChapter };
}

// ---------- 文の組み立て（活用はコードでしない。形はデータに書いてある） ----------
function partsFor(section, answer, formKey) {
  const parts = answer.chips.map((id) => ({ chip: chipOf(section, id), form: chipOf(section, id)?.[formKey] }));
  const out = parts.map((item) => ({ label: item.chip.label, value: item.form }));
  if (answer.text) {
    const t = answer.text;
    const form = section.textForms ? section.textForms(t)[formKey] : section.textLine ? section.textLine(t, answer.chips.length > 0) : `「${t}」`;
    out.push({ label: `「${t}」`, value: form, free: true });
  }
  return out;
}

export function composeSection(sectionId, rawAnswer) {
  const section = SECTION_BY_ID[sectionId];
  const base = { id: sectionId, chapterId: section?.chapterId, title: section?.title || '', icon: section?.icon, empty: true, lines: [] };
  if (!section) return base;
  const answer = normalizeAnswer(section, rawAnswer);
  if (!answer) return base;
  const lines = [];
  if (section.mode === 'name') {
    lines.push({ kind: 'p', text: `製品名：${answer.name || 'わたし'}` });
    const labels = [...answer.chips.map((id) => chipOf(section, id).label), ...(answer.text ? [`「${answer.text}」`] : [])];
    if (labels.length) lines.push({ kind: 'p', text: `タイプ：${labels.join('・')}モデル` });
  } else if (section.mode === 'list' || section.mode === 'steps') {
    const parts = partsFor(section, answer, 'line');
    const single = parts.length === 1;
    const intro = single && section.introSingle ? section.introSingle : section.intro;
    const outro = single && section.outroSingle ? section.outroSingle : section.outro;
    if (intro) lines.push({ kind: 'p', text: intro });
    parts.forEach((part, index) => lines.push(section.mode === 'steps' && !single ? { kind: 'step', n: index + 1, text: part.value } : section.mode === 'steps' ? { kind: 'p', text: part.value } : { kind: 'bullet', text: part.value }));
    if (outro) lines.push({ kind: 'p', text: outro });
    else if (section.outroFromFirst && parts.length) lines.push({ kind: 'p', text: section.outroFromFirst(parts[0].free ? answer.text : parts[0].label, parts.length) });
  } else if (section.mode === 'cond') {
    const single = answer.chips.length + (answer.text ? 1 : 0) === 1;
    if (single) lines.push({ kind: 'p', text: `${partsFor(section, answer, 'cond')[0].value}、${section.tail}` });
    else {
      const tari = partsFor(section, answer, 'tari').map((part) => part.value);
      lines.push({ kind: 'p', text: `${tari.join('、')}したら、${section.tail}` });
    }
  } else if (section.mode === 'toki') {
    const toki = partsFor(section, answer, 'toki').map((part) => part.value);
    lines.push({ kind: 'p', text: `${toki.join('や、')}は、${section.tail}` });
  }
  return { ...base, empty: false, lines };
}

export function sectionPlainText(composed) {
  return composed.lines.map((line) => line.kind === 'bullet' ? `・${line.text}` : line.kind === 'step' ? `${line.n}. ${line.text}` : line.text).join('\n');
}

function versionLabel(today) {
  const match = /^(\d{4})-(\d{2})/.exec(today || '');
  return match ? `第1版 ${match[1]}年${Number(match[2])}月` : '第1版';
}

export function composeManual(answers, { today = '' } = {}) {
  const nameComposed = composeSection('name', answers?.name);
  const name = nameComposed.empty ? '' : sanitizeText(answers.name?.name, NAME_MAX);
  const typeLine = nameComposed.lines.find((line) => line.text.startsWith('タイプ：'))?.text || '';
  const sections = [];
  let number = 0;
  for (const chapter of CHAPTERS) {
    for (const id of chapter.sections) {
      if (id === 'name') continue;
      number += 1;
      sections.push({ ...composeSection(id, answers?.[id]), number, chapterLabel: chapter.label, firstOfChapter: false });
    }
  }
  const seenChapter = new Set();
  for (const section of sections) { if (!seenChapter.has(section.chapterId)) { seenChapter.add(section.chapterId); section.firstOfChapter = true; } }
  return {
    title: name ? `${name} 取扱説明書` : 'わたしの取扱説明書',
    typeLine,
    nameEmpty: nameComposed.empty,
    version: versionLabel(today),
    sections,
    warranty: COPY.warranty,
  };
}

// ---------- 端末への保存（localStorage。明示的に残すと選んだときだけ） ----------
export function resolveStorage(source) {
  try { const storage = typeof source === 'function' ? source() : source; return storage && typeof storage.getItem === 'function' ? storage : null; } catch { return null; }
}

export function loadTorisetsu(source) {
  const storage = resolveStorage(source);
  if (!storage) return null;
  let raw = null;
  try { raw = storage.getItem(STORAGE_KEY); } catch { return null; }
  if (raw == null) return null;
  const discard = () => { try { storage.removeItem(STORAGE_KEY); } catch {} return null; };
  let data;
  try { data = JSON.parse(raw); } catch { return discard(); }
  if (!data || typeof data !== 'object' || Array.isArray(data) || data.version !== 1 || !data.answers || typeof data.answers !== 'object' || Array.isArray(data.answers)) return discard();
  const answers = normalizeAnswers(data.answers);
  if (!Object.keys(answers).length) return discard();
  const savedAt = typeof data.savedAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(data.savedAt) ? data.savedAt : '';
  return { answers, savedAt };
}

export function saveTorisetsu(source, answers, today) {
  const storage = resolveStorage(source);
  if (!storage || typeof storage.setItem !== 'function') return { ok: false };
  try {
    const clean = normalizeAnswers(answers);
    const savedAt = typeof today === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(today) ? today : '';
    storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, savedAt, answers: clean }));
    return { ok: true };
  } catch { return { ok: false }; }
}

export function clearTorisetsu(source) {
  const storage = resolveStorage(source);
  if (!storage || typeof storage.removeItem !== 'function') return { ok: false };
  try { storage.removeItem(STORAGE_KEY); return { ok: true }; } catch { return { ok: false }; }
}

// ---------- 状態 ----------
const emptyDraft = () => ({ chips: [], text: '', name: '', textOpen: false });

export function createTorisetsuState({ stored = null } = {}) {
  const answers = stored?.answers ? cloneAnswers(normalizeAnswers(stored.answers)) : {};
  const has = Object.keys(answers).length > 0;
  return {
    view: 'start', sectionId: null, chapterId: null, returnTo: null,
    answers, draft: emptyDraft(), pending: Object.create(null),
    persisted: has, savedAt: has ? (stored.savedAt || '') : '',
    saveDeclined: false, saveError: '', limitMessage: '', undo: null, leaveConfirm: false, imageStatus: '', imageBusy: false,
  };
}

const draftFromAnswer = (answer) => ({
  chips: answer ? [...answer.chips] : [], text: answer?.text || '', name: answer?.name || '', textOpen: Boolean(answer?.text),
});
const draftToAnswer = (section, draft) => {
  const answer = { chips: [...draft.chips], text: sanitizeText(draft.text, textLimit(section)) };
  if (section.mode === 'name') answer.name = sanitizeText(draft.name, NAME_MAX);
  return answer;
};
const draftHasContent = (draft) => draft.chips.length > 0 || Boolean(draft.text.trim()) || Boolean(draft.name.trim());

export function chipCapacity(section, draft) {
  return section.max - (draft.text.trim() ? 1 : 0);
}

export function selectChip(ts, chipId) {
  const section = SECTION_BY_ID[ts.sectionId];
  if (!section || !chipOf(section, chipId)) return false;
  const draft = ts.draft;
  const index = draft.chips.indexOf(chipId);
  ts.limitMessage = '';
  if (index >= 0) { draft.chips.splice(index, 1); return true; }
  if (draft.chips.length >= chipCapacity(section, draft)) { ts.limitMessage = section.max === 2 ? COPY.limitMessage2 : COPY.limitMessage; return false; }
  draft.chips.push(chipId);
  return true;
}

export function setDraftText(ts, value, field = 'text') {
  const section = SECTION_BY_ID[ts.sectionId];
  if (!section) return;
  if (field === 'name') ts.draft.name = sanitizeText(value, NAME_MAX, { trim: false });
  else ts.draft.text = sanitizeText(value, textLimit(section), { trim: false });
}

export function draftComplete(ts) {
  const section = SECTION_BY_ID[ts.sectionId];
  return Boolean(section) && isAnswered(section, draftToAnswer(section, ts.draft));
}

export function expireUndo(ts, now = Date.now()) {
  if (ts.undo && now >= ts.undo.expiresAt) { ts.undo = null; return true; }
  return false;
}

function openSection(ts, id, returnTo = ts.returnTo) {
  const section = SECTION_BY_ID[id];
  if (!section) return;
  ts.view = 'item'; ts.sectionId = id; ts.chapterId = section.chapterId; ts.returnTo = returnTo || null;
  ts.draft = ts.pending[id] ? { ...ts.pending[id], chips: [...ts.pending[id].chips] } : draftFromAnswer(ts.answers[id]);
  ts.limitMessage = '';
}

function openChapter(ts, chapterId) {
  const chapter = CHAPTER_BY_ID[chapterId];
  if (!chapter) return;
  const target = chapter.sections.find((id) => !isAnswered(SECTION_BY_ID[id], ts.answers[id])) || chapter.sections[0];
  openSection(ts, target, null);
}

function chapterIsDone(ts, chapterId) {
  return CHAPTER_BY_ID[chapterId].sections.every((id) => isAnswered(SECTION_BY_ID[id], ts.answers[id]));
}

function goNext(ts, id) {
  const section = SECTION_BY_ID[id];
  const chapter = CHAPTER_BY_ID[section.chapterId];
  if (ts.returnTo === 'manual') { ts.view = 'manual'; ts.returnTo = null; ts.sectionId = null; return; }
  const index = chapter.sections.indexOf(id);
  if (index < chapter.sections.length - 1) { openSection(ts, chapter.sections[index + 1], null); return; }
  if (chapterIsDone(ts, chapter.id)) { ts.view = 'chapterDone'; ts.chapterId = chapter.id; ts.sectionId = null; return; }
  ts.view = 'contents'; ts.sectionId = null;
}

function autosave(ts, ctx) {
  if (!ts.persisted) return;
  const result = saveTorisetsu(ctx.storage, ts.answers, ctx.today);
  if (result.ok) { ts.savedAt = ctx.today || ts.savedAt; ts.saveError = ''; } else { ts.persisted = false; ts.saveError = COPY.saveFailed; }
}

function requestLeave(ts) {
  if (!ts.persisted && progress(ts.answers).done > 0) { ts.leaveConfirm = true; return { render: true, focus: '[data-ts-default]' }; }
  return { leave: true };
}

// 画面からの操作。状態を書きかえ、app.js に「何をするか」を返す。
export function applyAction(ts, action, data = {}, ctx = {}) {
  const now = typeof ctx.now === 'function' ? ctx.now() : Date.now();
  expireUndo(ts, now);
  switch (action) {
    case 'torisetsu-back': {
      if (ts.view === 'item') {
        const id = ts.sectionId; const section = SECTION_BY_ID[id];
        if (draftHasContent(ts.draft)) ts.pending[id] = { ...ts.draft, chips: [...ts.draft.chips] }; else delete ts.pending[id];
        const index = CHAPTER_BY_ID[section.chapterId].sections.indexOf(id);
        if (ts.returnTo === 'manual') { ts.view = 'manual'; ts.returnTo = null; ts.sectionId = null; }
        else if (index > 0) openSection(ts, CHAPTER_BY_ID[section.chapterId].sections[index - 1], null);
        else { ts.view = 'contents'; ts.sectionId = null; }
        return { render: true };
      }
      if (ts.view === 'chapterDone' || ts.view === 'manual') { ts.view = 'contents'; return { render: true }; }
      return requestLeave(ts);
    }
    case 'torisetsu-begin': case 'torisetsu-contents': ts.view = 'contents'; ts.leaveConfirm = false; return { render: true };
    case 'torisetsu-manual': ts.view = 'manual'; ts.leaveConfirm = false; return { render: true };
    case 'torisetsu-chapter': openChapter(ts, data.chapter); return { render: true };
    case 'torisetsu-edit': openSection(ts, data.section, 'manual'); return { render: true };
    case 'torisetsu-chip': { selectChip(ts, data.chip); return { render: true, focus: `[data-chip="${data.chip}"]` }; }
    case 'torisetsu-write': {
      const section = SECTION_BY_ID[ts.sectionId];
      if (section && ts.draft.chips.length >= section.max && !ts.draft.text) { ts.limitMessage = section.max === 2 ? COPY.limitMessage2 : COPY.limitMessage; return { render: true }; }
      ts.draft.textOpen = true; ts.limitMessage = ''; return { render: true, focus: '[data-ts-text]' };
    }
    case 'torisetsu-commit': {
      const id = ts.sectionId; const section = SECTION_BY_ID[id];
      if (ts.view !== 'item' || !section) return { render: true };
      const answer = normalizeAnswer(section, draftToAnswer(section, ts.draft));
      if (!answer) return { render: true };
      ts.answers[id] = answer; delete ts.pending[id];
      autosave(ts, ctx);
      goNext(ts, id);
      return { render: true, scrollTop: true };
    }
    case 'torisetsu-skip': {
      const id = ts.sectionId;
      if (ts.view !== 'item' || !SECTION_BY_ID[id]) return { render: true };
      delete ts.pending[id];
      goNext(ts, id);
      return { render: true, scrollTop: true };
    }
    case 'torisetsu-save': {
      const result = saveTorisetsu(ctx.storage, ts.answers, ctx.today);
      if (result.ok) { ts.persisted = true; ts.savedAt = ctx.today || ''; ts.saveError = ''; ts.saveDeclined = false; }
      else { ts.persisted = false; ts.saveError = COPY.saveFailed; }
      return { render: true };
    }
    case 'torisetsu-decline': ts.saveDeclined = true; ts.saveError = ''; return { render: true };
    case 'torisetsu-resave': ts.saveDeclined = false; return { render: true };
    case 'torisetsu-delete': {
      clearTorisetsu(ctx.storage);
      ts.undo = { answers: cloneAnswers(ts.answers), expiresAt: now + UNDO_MS };
      ts.answers = {}; ts.pending = Object.create(null); ts.draft = emptyDraft();
      ts.persisted = false; ts.savedAt = ''; ts.saveDeclined = false; ts.saveError = ''; ts.leaveConfirm = false;
      ts.view = 'start'; ts.sectionId = null; ts.chapterId = null; ts.returnTo = null;
      return { render: true, scrollTop: true, undoTimer: UNDO_MS };
    }
    case 'torisetsu-undo': {
      if (!ts.undo || now >= ts.undo.expiresAt) { ts.undo = null; return { render: true }; }
      ts.answers = normalizeAnswers(ts.undo.answers); ts.undo = null; // 復元のみ。保存し直しはしない。
      ts.persisted = false; ts.view = 'contents';
      return { render: true, scrollTop: true };
    }
    case 'torisetsu-leave-confirm': return { leave: true };
    case 'torisetsu-leave-cancel': ts.leaveConfirm = false; return { render: true, focus: '[data-action="torisetsu-back"]' };
    case 'torisetsu-leave-keep': ts.leaveConfirm = false; ts.view = 'manual'; return { render: true, scrollTop: true, focus: '[data-action="torisetsu-back"]' };
    case 'torisetsu-image': return { image: true };
    default: return { render: false };
  }
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

const CIRCLED = ['①', '②', '③'];

function formatSavedDate(savedAt) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(savedAt || '');
  return match ? `${match[1]}年${Number(match[2])}月${Number(match[3])}日に保存` : '';
}

function progressMarkup(ts, esc) {
  const { done, total } = progress(ts.answers);
  const label = done >= total ? COPY.allDone : `${total}欄中${done}欄できた`;
  const cells = SECTIONS.map((section) => `<span class="ts-cell${isAnswered(section, ts.answers[section.id]) ? ' is-done' : ''}"></span>`).join('');
  return `<div class="ts-progress"><div class="ts-cells" role="img" aria-label="${esc(label)}">${cells}</div><p class="ts-progress-label">${esc(label)}</p></div>`;
}

function linesMarkup(composed, esc) {
  const out = [];
  let bullets = []; let steps = [];
  const flush = () => {
    if (bullets.length) out.push(`<ul class="ts-list">${bullets.join('')}</ul>`);
    if (steps.length) out.push(`<ol class="ts-steps">${steps.join('')}</ol>`);
    bullets = []; steps = [];
  };
  for (const line of composed.lines) {
    if (line.kind === 'bullet') bullets.push(`<li>${esc(line.text)}</li>`);
    else if (line.kind === 'step') steps.push(`<li>${esc(line.text)}</li>`);
    else { flush(); out.push(`<p>${esc(line.text)}</p>`); }
  }
  flush();
  return out.join('');
}

function sectionMarkup(section, { esc, editable }) {
  const lampDot = section.id === 'warning' ? '<span class="ts-lamp" aria-hidden="true"></span>' : '';
  const head = `<h3 class="ts-sec-title"><span class="ts-num" aria-hidden="true">${section.number}</span>${iconSvg(section.icon)}<span>${esc(section.title)}</span>${lampDot}</h3>`;
  const chapter = section.firstOfChapter ? `<p class="ts-chapter-label">${esc(section.chapterLabel)}</p>` : '';
  if (section.empty) {
    const write = editable ? `<button type="button" class="ts-mini-button" data-action="torisetsu-edit" data-section="${esc(section.id)}" aria-label="${esc(section.title)}を書く">${esc(COPY.writeSection)}</button>` : '';
    return `${chapter}<section class="ts-sec is-empty" data-ts-sec="${esc(section.id)}">${head}<div class="ts-empty"><span>${esc(COPY.emptyBox)}</span>${write}</div></section>`;
  }
  const edit = editable ? `<button type="button" class="ts-edit" data-action="torisetsu-edit" data-section="${esc(section.id)}" aria-label="${esc(section.title)}を直す" title="${esc(COPY.editSection)}">${iconSvg('pencil', 16)}<span>${esc(COPY.editSection)}</span></button>` : '';
  return `${chapter}<section class="ts-sec" data-ts-sec="${esc(section.id)}">${head}${edit}<div class="ts-sec-body">${linesMarkup(section, esc)}</div></section>`;
}

function manualPaper(ts, { esc, today }, { onlyChapter = null, editable = true } = {}) {
  const manual = composeManual(ts.answers, { today });
  const sections = onlyChapter ? manual.sections.filter((section) => section.chapterId === onlyChapter) : manual.sections;
  const cover = onlyChapter && onlyChapter !== 'basic' ? '' : `<div class="ts-cover"><div class="ts-cover-text"><small>取扱説明書</small><strong>${esc(manual.title)}</strong></div><svg class="ts-cover-icon" aria-hidden="true" focusable="false" viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${COVER_ICON}</svg></div><p class="ts-cover-meta">${manual.typeLine ? `${esc(manual.typeLine)}　｜　` : ''}${esc(manual.version)}</p>${manual.nameEmpty && editable ? `<div class="ts-empty ts-empty-cover"><span>製品名・タイプ：${esc(COPY.emptyBox)}</span><button type="button" class="ts-mini-button" data-action="torisetsu-edit" data-section="name" aria-label="製品名を書く">${esc(COPY.writeSection)}</button></div>` : ''}`;
  const warranty = onlyChapter ? '' : `<p class="ts-warranty">${esc(manual.warranty)}</p>`;
  return `<article class="ts-paper" aria-label="${esc(manual.title)}">${cover}${sections.map((section) => sectionMarkup(section, { esc, editable })).join('')}${warranty}</article>`;
}

function saveCardMarkup(ts, esc) {
  if (!ts.persisted && !CHAPTERS.some((chapter) => chapterIsDone(ts, chapter.id))) return `<p class="ts-note ts-save-locked">${esc(COPY.saveLocked)}</p>`;
  if (ts.persisted) return `<section class="ts-save is-saved" aria-label="${esc(COPY.saveYes)}"><p class="ts-save-title">${iconSvg('lock', 16)}<span>${esc(COPY.saving)}</span></p><p>${esc(COPY.savedDone)}</p><button type="button" class="text-button ts-danger" data-action="torisetsu-delete">${esc(COPY.deleteManual)}</button></section>`;
  const error = ts.saveError ? `<p class="ts-save-error" role="alert">${esc(ts.saveError)}</p>` : '';
  if (ts.saveDeclined) return `<section class="ts-save is-declined">${error}<button type="button" class="text-button" data-action="torisetsu-resave">${esc(COPY.saveYes)}</button></section>`;
  return `<section class="ts-save" aria-labelledby="ts-save-title"><p class="ts-save-title" id="ts-save-title">${iconSvg('lock', 16)}<span>${esc(COPY.saveCardTitle)}</span></p><p>${esc(COPY.saveCardBody1)}<br>${esc(COPY.saveCardBody2)}</p>${error}<div class="ts-save-actions"><button type="button" class="primary-button" data-action="torisetsu-save">${esc(COPY.saveYes)}</button><button type="button" class="secondary-button" data-action="torisetsu-decline">${esc(COPY.saveNo)}</button></div></section>`;
}

export function previewMarkup(ts, esc) {
  const section = SECTION_BY_ID[ts.sectionId];
  if (!section) return '';
  const composed = composeSection(section.id, draftToAnswer(section, ts.draft));
  const body = composed.empty ? `<p class="ts-preview-empty">${esc(COPY.previewEmpty)}</p>` : linesMarkup(composed, esc);
  return `<p class="ts-preview-head">${esc(COPY.previewTitle)}</p><div class="ts-preview-card"><strong>${esc(section.title)}</strong>${body}</div>`;
}

function chipsMarkup(ts, section, esc) {
  const capacity = chipCapacity(section, ts.draft);
  const full = ts.draft.chips.length >= capacity;
  return `<div class="ts-chips" role="group" aria-label="${esc(section.mode === 'name' ? section.typeQuestion : section.question)}">${section.chips.map((item) => {
    const index = ts.draft.chips.indexOf(item.id);
    const on = index >= 0;
    const num = on && section.ordered ? `<span class="ts-chip-num" aria-hidden="true">${CIRCLED[index] || ''}</span>` : '';
    const order = on && section.ordered ? `（${index + 1}番目）` : '';
    return `<button type="button" class="ts-chip${on ? ' is-on' : ''}${!on && full ? ' is-dim' : ''}" aria-pressed="${on}" data-action="torisetsu-chip" data-chip="${esc(item.id)}"${order ? ` aria-label="${esc(item.label + order)}"` : ''}>${num}<span>${esc(item.label)}</span></button>`;
  }).join('')}</div>`;
}

function itemView(ts, helpers) {
  const { esc } = helpers;
  const section = SECTION_BY_ID[ts.sectionId];
  const chapter = CHAPTER_BY_ID[section.chapterId];
  const position = chapter.sections.indexOf(section.id);
  const dots = chapter.sections.map((id, index) => `<span class="ts-dot${index === position ? ' is-current' : ''}${isAnswered(SECTION_BY_ID[id], ts.answers[id]) ? ' is-done' : ''}"></span>`).join('');
  const answered = isAnswered(section, ts.answers[section.id]);
  const max = textLimit(section);
  const nameInput = section.mode === 'name'
    ? `<label class="ts-field"><span>${esc(section.nameLabel)}</span><input type="text" inputmode="text" autocomplete="off" maxlength="${NAME_MAX}" data-ts-name value="${esc(ts.draft.name)}" placeholder="${esc(section.namePlaceholder)}" /><small>${NAME_MAX}字まで</small></label><h2 class="ts-subq">${esc(section.typeQuestion)}</h2>`
    : '';
  const textBlock = ts.draft.textOpen
    ? `<label class="ts-field ts-free"><span class="visually-hidden">${esc(COPY.freeWrite)}</span><input type="text" inputmode="text" autocomplete="off" maxlength="${max}" data-ts-text value="${esc(ts.draft.text)}" placeholder="${esc(section.textPlaceholder)}" /><small data-ts-count>${Array.from(ts.draft.text).length}/${max}字</small></label>`
    : `<button type="button" class="ts-write" data-action="torisetsu-write">＋ ${esc(COPY.freeWrite)}</button>`;
    return `<div class="ts-item" data-ts-key="item:${esc(section.id)}">
    <div class="ts-item-head"><span class="ts-where">${esc(chapter.label)}　｜　${esc(section.title)}</span><span class="ts-dots" aria-label="${esc(chapter.label)}の${position + 1}つ目">${dots}</span></div>
    ${progressMarkup(ts, esc)}
    <h1 class="ts-q" tabindex="-1" data-focus>${esc(section.question)}</h1>
    ${nameInput}
    <p class="ts-hint">${esc(section.hint)}</p>
    ${chipsMarkup(ts, section, esc)}
    <p class="ts-limit" role="status" aria-live="polite">${esc(ts.limitMessage)}</p>
    ${textBlock}
    <div class="ts-preview" data-ts-preview>${previewMarkup(ts, esc)}</div>
    <div class="ts-actions"><button type="button" class="primary-button" data-action="torisetsu-commit" ${draftComplete(ts) ? '' : 'disabled'}>${esc(answered ? COPY.rewriteButton : COPY.writeButton)}</button><button type="button" class="text-button ts-skip" data-action="torisetsu-skip">${esc(COPY.skip)}</button></div>
  </div>`;
}

function startView(ts, helpers) {
  const { esc } = helpers;
  const hasSaved = ts.persisted && Object.keys(ts.answers).length > 0;
  if (hasSaved) {
    const date = formatSavedDate(ts.savedAt);
    return `<div class="ts-start" data-ts-key="start">
      <h1 class="ts-title" tabindex="-1" data-focus>${esc(COPY.savedTitle)}</h1>
      ${date ? `<p class="ts-sub">（${esc(date)}）</p>` : ''}
      <div class="ts-actions"><button type="button" class="primary-button" data-action="torisetsu-manual">${esc(COPY.viewManual)}</button><button type="button" class="secondary-button" data-action="torisetsu-contents">${esc(COPY.continueEdit)}</button></div>
      <p class="ts-note">${esc(COPY.deviceOnly)}</p>
      <button type="button" class="text-button ts-danger" data-action="torisetsu-delete">${esc(COPY.deleteManual)}</button>
    </div>`;
  }
  return `<div class="ts-start" data-ts-key="start">
    <div class="ts-hero" aria-hidden="true"><svg viewBox="0 0 24 24" width="44" height="44" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${COVER_ICON}</svg><span class="ts-hero-lines"><i></i><i></i><i></i></span></div>
    <h1 class="ts-title" tabindex="-1" data-focus>${esc(COPY.startTitle)}</h1>
    <p class="ts-lead">${esc(COPY.startLead)}</p>
    <div class="ts-privacy" role="note">${iconSvg('lock', 20)}<div><strong>${esc(COPY.privacyTitle)}</strong><p>${esc(COPY.privacyBody)}</p></div></div>
    <p class="ts-note">${esc(COPY.startGuide)}</p>
    <div class="ts-actions"><button type="button" class="primary-button" data-action="torisetsu-begin">${esc(COPY.begin)}</button></div>
  </div>`;
}

function contentsView(ts, helpers) {
  const { esc } = helpers;
  const mini = SECTIONS.map((section) => `<li class="${isAnswered(section, ts.answers[section.id]) ? 'is-done' : ''}">${esc(section.title)}</li>`).join('');
  const rows = CHAPTERS.map((chapter) => {
    const p = progress(ts.answers).byChapter[chapter.id];
    const full = p.done === p.total;
    const label = full ? COPY.chapterReview : p.done > 0 ? COPY.chapterContinue : COPY.chapterStart;
    return `<li class="ts-chapter${full ? ' is-done' : ''}"><div><strong>${esc(chapter.label)}　${esc(chapter.subtitle)}</strong><small>${p.total}欄中${p.done}欄${full ? `　${iconSvg('check', 14)}できた` : ''}</small></div><button type="button" class="${full ? 'secondary-button' : 'primary-button'} ts-chapter-button" data-action="torisetsu-chapter" data-chapter="${esc(chapter.id)}" aria-label="${esc(chapter.label)}を${esc(label)}">${esc(label)}</button></li>`;
  }).join('');
  const view = progress(ts.answers).done > 0 ? `<button type="button" class="secondary-button ts-view" data-action="torisetsu-manual">${esc(COPY.viewManual)}</button>` : '';
  return `<div class="ts-contents" data-ts-key="contents">
    <h1 class="ts-title" tabindex="-1" data-focus>${esc(COPY.contentsTitle)}</h1>
    ${progressMarkup(ts, esc)}
    <ul class="ts-mini" aria-label="8つの欄">${mini}</ul>
    <ul class="ts-chapters">${rows}</ul>
    ${view}
  </div>`;
}

function chapterDoneView(ts, helpers) {
  const { esc, support } = helpers;
  const chapter = CHAPTER_BY_ID[ts.chapterId];
  const p = progress(ts.answers);
  const complete = p.done >= p.total;
  const nextChapter = CHAPTERS.find((item) => !chapterIsDone(ts, item.id));
  const title = complete ? COPY.completeTitle : `${chapter.label}ができました`;
  const body = complete ? COPY.completeBody : chapter.done;
  const primary = nextChapter && !complete
    ? `<button type="button" class="primary-button" data-action="torisetsu-chapter" data-chapter="${esc(nextChapter.id)}">${esc(COPY.chapterDoneNext(nextChapter.label))}</button>`
    : `<button type="button" class="primary-button" data-action="torisetsu-manual">${esc(COPY.viewManual)}</button>`;
  return `<div class="ts-done" data-ts-key="done:${esc(chapter.id)}">
    <h1 class="ts-title" tabindex="-1" data-focus>${complete ? '' : `<span class="ts-done-check">${iconSvg('check', 22)}</span>`}${esc(title)}</h1>
    <p class="ts-lead">${esc(body)}</p>
    ${manualPaper(ts, helpers, { onlyChapter: chapter.id, editable: false })}
    ${progressMarkup(ts, esc)}
    <div class="ts-actions">${primary}<button type="button" class="secondary-button" data-action="torisetsu-contents">${esc(COPY.toContents)}</button></div>
    ${saveCardMarkup(ts, esc)}
    ${support ? support() : ''}
  </div>`;
}

function manualView(ts, helpers) {
  const { esc, support, imageEnabled } = helpers;
  const image = imageEnabled !== false && progress(ts.answers).done > 0
    ? `<section class="ts-share"><p>${esc(COPY.shareNote)}</p><button type="button" class="secondary-button" data-action="torisetsu-image" ${ts.imageBusy ? 'disabled' : ''}>${esc(ts.imageBusy ? COPY.imageMaking : COPY.makeImage)}</button><p class="ts-image-status" role="status" aria-live="polite">${esc(ts.imageStatus)}</p></section>`
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

export function torisetsuView(ts, helpers) {
  const { esc } = helpers;
  const h = { today: '', ...helpers };
  const body = ts.view === 'item' && ts.sectionId ? itemView(ts, h)
    : ts.view === 'contents' ? contentsView(ts, h)
    : ts.view === 'chapterDone' ? chapterDoneView(ts, h)
    : ts.view === 'manual' ? manualView(ts, h)
    : startView(ts, h);
  const canKeep = CHAPTERS.some((chapter) => chapterIsDone(ts, chapter.id));
  const leaveButtons = canKeep
    ? `<button type="button" class="primary-button" data-ts-default data-action="torisetsu-leave-keep">${esc(COPY.leaveKeep)}</button><button type="button" class="secondary-button" data-action="torisetsu-leave-confirm">${esc(COPY.leaveClose)}</button>`
    : `<button type="button" class="primary-button" data-ts-default data-action="torisetsu-leave-cancel">${esc(COPY.leaveContinue)}</button><button type="button" class="secondary-button" data-action="torisetsu-leave-confirm">${esc(COPY.leaveClose)}</button>`;
  const leave = ts.leaveConfirm
    ? `<div class="ts-modal" data-ts-modal role="alertdialog" aria-modal="true" aria-labelledby="ts-leave-title"><div class="ts-modal-card"><p id="ts-leave-title">${esc(canKeep ? COPY.leaveTitle : COPY.leaveTitleLoss)}</p><div class="ts-save-actions">${leaveButtons}</div></div></div>`
    : '';
  const toast = ts.undo ? `<div class="ts-toast" role="status"><span>${esc(COPY.deletedToast)}</span><button type="button" class="ts-toast-button" data-action="torisetsu-undo">${esc(COPY.undo)}</button></div>` : '';
  return `<header class="topbar ts-topbar"><button type="button" class="ts-back" data-action="torisetsu-back" aria-label="戻る">${iconSvg('left', 20)}<span>戻る</span></button><strong class="ts-topbar-title">${esc(COPY.appTitle)}</strong><span class="ts-topbar-space" aria-hidden="true"></span></header><section class="content ts-content"><div class="ts-screen" data-ts-view="${esc(ts.view)}">${body}</div></section>${leave}${toast}`;
}

export function torisetsuViewKey(ts) {
  return `${ts.view}:${ts.sectionId || ''}:${ts.chapterId || ''}`;
}

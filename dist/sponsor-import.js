import { readSponsorXlsx } from './vendor/sponsor-import-excel.js';

const QUESTION_HEADERS = ['質問', 'question', 'text', 'お題', 'カード', '内容'];
const MAX_QUESTIONS = 40;
const MAX_TEXT_LENGTH = 300;
const MAX_COLUMNS = 64;
const MAX_ROWS = 1000;

function error(code, message = code) { return Object.assign(new Error(message), { code }); }
function clean(value) { return String(value ?? '').replace(/^\uFEFF/, '').trim(); }
function makeColumnCandidates(headers) { return headers.map((header, index) => ({ header, index, score: QUESTION_HEADERS.includes(header.toLowerCase()) ? 2 : 0 })); }
function buildResult(source, rows, hasHeader, headers = [], selectedColumn = null) {
  const sourceRows = rows.map((row) => Array.from(row || [], clean));
  if (sourceRows.some((row) => row.length > MAX_COLUMNS)) throw error('COLUMN_LIMIT');
  if (sourceRows.length > MAX_ROWS + (hasHeader ? 1 : 0)) throw error('ROW_LIMIT');
  const rawRows = hasHeader ? sourceRows.slice(1) : sourceRows;
  const columnCount = Math.max(0, ...sourceRows.map((row) => row.length));
  const headerSource = hasHeader ? (headers.length ? headers.map(clean) : sourceRows[0]?.map(clean) || []) : [];
  const effectiveHeaders = Array.from({ length: columnCount }, (_, index) => headerSource[index] || `列${index + 1}`);
  const candidates = makeColumnCandidates(effectiveHeaders).sort((a, b) => b.score - a.score || a.index - b.index);
  const selected = selectedColumn == null ? (candidates.find((candidate) => candidate.score > 0) || (!hasHeader && effectiveHeaders.length === 1 ? { index: 0, score: 0 } : null)) : (Number.isInteger(selectedColumn) && selectedColumn >= 0 && selectedColumn < columnCount ? { index: selectedColumn, score: candidates[selectedColumn]?.score || 0 } : null);
  const questions = selected ? rawRows.map((row, index) => ({ row: index + (hasHeader ? 2 : 1), text: clean(row[selected.index]) })).filter(({ text }) => text) : [];
  const errors = [];
  if (!selected) errors.push({ code: 'QUESTION_COLUMN_REQUIRED' });
  for (const question of questions) if (Array.from(question.text).length > MAX_TEXT_LENGTH) errors.push({ row: question.row, code: 'QUESTION_TOO_LONG' });
  if (questions.length < 6 || questions.length > MAX_QUESTIONS) errors.push({ code: 'QUESTION_COUNT', count: questions.length });
  return { source, rawRows: sourceRows, rows: rawRows, sourceRows, headers: effectiveHeaders, hasHeader, selectedColumn: selected?.index ?? null, questionColumn: selected?.index ?? null, candidates, questions, errors };
}
function parseCsvText(text, forcedHeader = null) {
  const rows = []; let row = []; let field = ''; let quoted = false;
  const push = () => { if (row.length || field) rows.push([...row, field]); row = []; field = ''; };
  for (let i = 0; i < text.length; i += 1) { const c = text[i]; if (quoted) { if (c === '"' && text[i + 1] === '"') { field += '"'; i += 1; } else if (c === '"') quoted = false; else field += c; } else if (c === '"' && field === '') quoted = true; else if (c === ',') { row.push(field); field = ''; } else if (c === '\n') push(); else if (c !== '\r') field += c; }
  if (quoted) throw error('CSV_INVALID'); if (row.length || field) push(); if (!rows.length) throw error('CSV_EMPTY');
  const headerLike = forcedHeader ?? rows[0].some((value) => QUESTION_HEADERS.includes(clean(value).toLowerCase()));
  return buildResult('csv', rows, headerLike);
}
function decodeText(bytes, encoding) { try { return new TextDecoder(encoding, { fatal: true }).decode(bytes).replace(/^\uFEFF/, ''); } catch { throw error('TEXT_ENCODING_UNSUPPORTED'); } }
function decodeAuto(bytes) {
  try { return decodeText(bytes, 'utf-8'); } catch (utf8Error) {
    try { return decodeText(bytes, 'shift_jis'); } catch { throw utf8Error; }
  }
}
export function selectQuestionColumn(result, column) {
  if (!result || !Array.isArray(result.rows) || !Number.isInteger(column) || column < 0 || column >= MAX_COLUMNS) throw error('QUESTION_COLUMN_INVALID');
  return buildResult(result.source, result.sourceRows, result.hasHeader, result.headers, column);
}
export async function parseSponsorImport(input, { encoding = 'auto', hasHeader = null, readXlsx = readSponsorXlsx } = {}) {
  const name = typeof input?.name === 'string' ? input.name.toLowerCase() : '';
  if (Number.isInteger(input?.size) && input.size > 5 * 1024 * 1024) throw error('FILE_TOO_LARGE');
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(await input.arrayBuffer());
  if (bytes.length > 5 * 1024 * 1024) throw error('FILE_TOO_LARGE');
  if (name.endsWith('.xls')) throw error('XLS_UNSUPPORTED');
  if (name.endsWith('.xlsx') || bytes[0] === 0x50 && bytes[1] === 0x4b) { const rows = await readXlsx(input); const headerMode = hasHeader ?? (rows[0]?.some((value) => QUESTION_HEADERS.includes(clean(value).toLowerCase())) === true); return buildResult('xlsx', rows, headerMode); }
  return parseCsvText(encoding === 'auto' ? decodeAuto(bytes) : decodeText(bytes, encoding), hasHeader);
}
export const SPONSOR_IMPORT_LIMITS = Object.freeze({ minQuestions: 6, maxQuestions: MAX_QUESTIONS, maxQuestionLength: MAX_TEXT_LENGTH, maxColumns: MAX_COLUMNS, maxBytes: 5 * 1024 * 1024 });

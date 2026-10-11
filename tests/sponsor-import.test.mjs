import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSponsorImport, selectQuestionColumn } from '../dist/sponsor-import.js';
import { zipSync, strToU8 } from 'fflate';

const csv = (value) => new TextEncoder().encode(value);
function zipStored(entries) {
  return zipSync(Object.fromEntries(Object.entries(entries).map(([name, value]) => [name, strToU8(value)])));
}

test('CSV detects question column, removes blank rows, and keeps formulas as text', async () => {
  const result = await parseSponsorImport(new File([csv('\uFEFFtitle,質問,notes\nセット,問い1,=1+1\n,,\nセット,問い2,説明')], 'cards.csv'));
  assert.equal(result.questionColumn, 1);
  assert.deepEqual(result.questions.map(({ text }) => text), ['問い1', '問い2']);
  assert.equal(result.questions.length, 2);
});

test('CSV rejects oversized question text and reports the import count', async () => {
  const result = await parseSponsorImport(new File([csv(`質問\n${'あ'.repeat(301)}\n問い`)], 'cards.csv'));
  assert.equal(result.errors[0].code, 'QUESTION_TOO_LONG');
  assert.equal(result.errors.at(-1).code, 'QUESTION_COUNT');
});

test('unknown headers return a stable column-selection result', async () => {
  const result = await parseSponsorImport(new File([csv('分類,メモ\nA,問い1\nA,問い2')], 'cards.csv'), { hasHeader: true });
  assert.equal(result.selectedColumn, null);
  assert.equal(result.questions.length, 0);
  const selected = selectQuestionColumn(result, 1);
  assert.equal(selected.selectedColumn, 1);
  assert.deepEqual(selected.questions.map(({ text }) => text), ['問い1', '問い2']);
});

test('headerless and explicit column selection use the selected column without rewriting headers', async () => {
  const result = await parseSponsorImport(new File([csv('分類,"問い1,続き"\nA,"問い2"')], 'cards.csv'), { hasHeader: false });
  assert.equal(result.hasHeader, false); assert.equal(result.selectedColumn, null); assert.equal(result.headers.length, 2);
  const selected = selectQuestionColumn(result, 1); assert.equal(selected.selectedColumn, 1); assert.deepEqual(selected.questions.map(({ text }) => text), ['問い1,続き', '問い2']);
});

test('header rows shorter than data generate columns through the maximum row width', async () => {
  const result = await parseSponsorImport(new File([csv('分類\nA,問い1\nA,問い2')], 'cards.csv'), { hasHeader: true });
  assert.equal(result.headers.length, 2); assert.equal(result.selectedColumn, null); const selected = selectQuestionColumn(result, 1); assert.deepEqual(selected.questions.map(({ text }) => text), ['問い1', '問い2']);
});

test('quoted newlines and explicit Shift-JIS decoding remain text', async () => {
  const quoted = await parseSponsorImport(new File([csv('質問,備考\n"一行目\n二行目",メモ')], 'cards.csv'));
  assert.equal(quoted.questions[0].text, '一行目\n二行目');
  const shiftJisCompatible = await parseSponsorImport(new File([new Uint8Array([0x71, 0x75, 0x65, 0x73, 0x74, 0x69, 0x6f, 0x6e, 0x0a, 0x41])], 'cards.csv'), { encoding: 'shift_jis', hasHeader: true });
  assert.equal(shiftJisCompatible.questions[0].text, 'A');
});

test('CSV defaults to UTF-8 then falls back to Shift-JIS for Japanese files', async () => {
  const shiftJis = new Uint8Array([
    ...new TextEncoder().encode('question\n'),
    0x82, 0xa0,
  ]);
  const result = await parseSponsorImport(new File([shiftJis], 'cards.csv'));
  assert.equal(result.questions[0].text, 'あ');
});

test('large input is rejected before reading its arrayBuffer and row limit is enforced', async () => {
  let read = false; await assert.rejects(() => parseSponsorImport({ name: 'large.csv', size: 5 * 1024 * 1024 + 1, async arrayBuffer() { read = true; return new ArrayBuffer(0); } }), (error) => error.code === 'FILE_TOO_LARGE'); assert.equal(read, false);
  const rows = ['質問', ...Array.from({ length: 1001 }, (_, index) => `問い${index}`)].join('\n');
  await assert.rejects(() => parseSponsorImport(new File([csv(rows)], 'cards.csv')), (error) => error.code === 'ROW_LIMIT');
});

test('XLSX reads first sheet/shared strings without executing formulas', async () => {
  const bytes = zipStored({
    'xl/workbook.xml': '<workbook xmlns:r="r"><sheets><sheet name="Sheet1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/sharedStrings.xml': '<sst><si><t>質問</t></si><si><t>問いA</t></si><si><t>問いB</t></si></sst>',
    'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row><c r="A1" t="s"><v>0</v></c></row><row><c r="A2" t="s"><v>1</v></c></row><row><c r="A3" t="s"><v>2</v></c></row></sheetData></worksheet>',
  });
  assert.equal(bytes[0], 0x50, 'fixture is a compressed XLSX ZIP');
  const result = await parseSponsorImport(new File([bytes], 'cards.xlsx'), { readXlsx: async () => [['質問'], ['問いA'], ['問いB']] });
  assert.deepEqual(result.questions.map(({ text }) => text), ['問いA', '問いB']);
  await assert.rejects(() => parseSponsorImport(new File([zipSync({ 'xl/workbook.xml': strToU8('<workbook/>') })], 'formula.xlsx'), { readXlsx: async () => { throw new Error('formula rejected by reader'); } }), /formula rejected/);
});

test('XLSX hasHeader option is honored instead of auto detection', async () => {
  const result = await parseSponsorImport(new File([new Uint8Array([0x50, 0x4b])], 'cards.xlsx'), { hasHeader: false, readXlsx: async () => [['質問', 'メモ'], ['問いA', 'x'], ['問いB', 'y']] });
  assert.equal(result.hasHeader, false); const selected = selectQuestionColumn(result, 0); assert.equal(selected.questions[0].text, '質問');
});

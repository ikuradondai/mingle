import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBusinessCsv } from '../dist/business-csv.js';

const header = 'email,display_name,department\n';
const bytes = (value) => new TextEncoder().encode(value);
const valid = (count = 1) => bytes(`${header}${Array.from({ length: count }, (_, i) => `u${i}@example.test,Name ${i},Sales`).join('\n')}\n`);
const rejectsCsv = (value, code = 'CSV_INVALID') => assert.throws(() => parseBusinessCsv(typeof value === 'string' ? bytes(value) : value), (error) => error.code === code);

test('BOM, quoted commas, escaped quotes, and empty lines', () => {
  const rows = parseBusinessCsv(bytes(`\uFEFF${header}"a@example.test","A, Team","He said ""hi"""\n\n`));
  assert.deepEqual(rows, [{ email: 'a@example.test', display_name: 'A, Team', department: 'He said "hi"' }]);
});

test('strict malformed CSV and empty/header-only input', () => {
  rejectsCsv('');
  rejectsCsv(header);
  rejectsCsv(`${header}a@example.test,Name,Sales"\n`);
  rejectsCsv(`${header}"a@example.test,Name,Sales\n`);
  rejectsCsv(`${header}"a@example.test"x,Name,Sales\n`);
  rejectsCsv(`${header}a@example.test,Name\n`);
  rejectsCsv(`${header}a@example.test,Name,Sales,Extra\n`);
  rejectsCsv(new Uint8Array([0xc3, 0x28]));
});

test('row and byte limits', () => {
  assert.equal(parseBusinessCsv(valid(500)).length, 500);
  rejectsCsv(valid(501), 'CSV_LIMIT');
  assert.throws(() => parseBusinessCsv(new Uint8Array(256 * 1024 + 1)), (error) => error.code === 'BODY_TOO_LARGE' && error.status === 413);
});

test('empty data fields are retained for service validation', () => {
  const rows = parseBusinessCsv(bytes(`${header},,\n`));
  assert.deepEqual(rows, [{ email: '', display_name: '', department: '' }]);
});

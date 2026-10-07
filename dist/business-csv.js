const HEADERS = ['email', 'display_name', 'department'];

function csvError(code = 'CSV_INVALID', status = 400) {
  return Object.assign(new Error(code), { status, code });
}

export function parseBusinessCsv(raw) {
  if (!(raw instanceof Uint8Array)) throw csvError();
  if (raw.byteLength > 256 * 1024) throw csvError('BODY_TOO_LARGE', 413);
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(raw).replace(/^\uFEFF/, ''); } catch { throw csvError(); }
  if (!text.length) throw csvError();
  const rows = [];
  let row = [], field = '', state = 'unquoted', hadContent = false;
  const pushRow = () => { if (hadContent || row.length || field.length) { row.push(field); rows.push(row); } row = []; field = ''; state = 'unquoted'; hadContent = false; };
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (state === 'quoted') {
      if (character === '"') {
        if (text[index + 1] === '"') { field += '"'; index += 1; } else state = 'closed';
      } else { field += character; }
      hadContent = true;
      continue;
    }
    if (state === 'closed') {
      if (character === ',') { row.push(field); field = ''; state = 'unquoted'; hadContent = true; continue; }
      if (character === '\n') { pushRow(); continue; }
      if (character === '\r') { if (text[index + 1] === '\n') index += 1; pushRow(); continue; }
      throw csvError();
    }
    if (character === '"') {
      if (field !== '') throw csvError();
      state = 'quoted'; hadContent = true; continue;
    }
    if (character === ',') { row.push(field); field = ''; hadContent = true; continue; }
    if (character === '\n') { pushRow(); continue; }
    if (character === '\r') { if (text[index + 1] === '\n') index += 1; pushRow(); continue; }
    field += character; hadContent = true;
  }
  if (state === 'quoted') throw csvError();
  if (state === 'closed' || field.length || row.length || hadContent) pushRow();
  if (!rows.length || rows[0].length !== 3 || rows[0].join(',') !== HEADERS.join(',')) throw csvError();
  const data = rows.slice(1);
  if (!data.length || data.length > 500 || data.some((value) => value.length !== 3)) throw csvError(data.length > 500 ? 'CSV_LIMIT' : 'CSV_INVALID', data.length > 500 ? 400 : 400);
  return data.map((value) => Object.fromEntries(HEADERS.map((header, index) => [header, value[index]])));
}

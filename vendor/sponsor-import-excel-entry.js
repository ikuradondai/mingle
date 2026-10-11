import { readSheet } from 'read-excel-file/browser';

export async function readSponsorXlsx(file) {
  const result = await readSheet(file);
  return result?.data || result;
}

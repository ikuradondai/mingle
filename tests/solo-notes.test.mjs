import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createSoloNoteService } from '../server-side/solo-notes.mjs';

const userA = '11111111-1111-4111-8111-111111111111';
const session = '22222222-2222-4222-8222-222222222222';
const noteId = '33333333-3333-4333-8333-333333333333';
const key = `x.${Buffer.from(JSON.stringify({ role: 'anon' })).toString('base64url')}.x`;
const env = { SUPABASE_URL: 'https://notes.test.supabase.co', SUPABASE_ANON_KEY: key };
const req = (url, method = 'GET', body, authorization = 'Bearer token') => ({ url, method, body, headers: { authorization, host: 'localhost' } });
const response = (status, data) => ({ ok: status >= 200 && status < 300, status, async json() { return data; } });

function fakeFetch({ anonymous = false } = {}) {
  const calls = [];
  const rows = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith('/auth/v1/user')) return response(200, { id: userA, is_anonymous: anonymous });
    if (url.includes('/my_sets')) return response(200, [{ id: '44444444-4444-4444-8444-444444444444', name: 'Solo set', audience: 'both', card_ids: ['date-01'] }]);
    if (url.includes('/custom_cards')) return response(200, []);
    if (url.includes('/solo_notes') && options.method === 'POST') {
      const payload = JSON.parse(options.body); const row = { ...payload, id: noteId, created_at: '2026-10-05T00:00:00.000Z', updated_at: '2026-10-05T00:00:00.000Z' }; rows.push(row); return response(201, [row]);
    }
    if (url.includes('/solo_notes') && options.method === 'PATCH') return response(200, [{ ...rows[0], note: JSON.parse(options.body).note, updated_at: '2026-10-05T00:01:00.000Z' }]);
    if (url.includes('/solo_notes') && options.method === 'DELETE') return response(200, rows.splice(0));
    if (url.includes('/solo_notes')) return response(200, rows);
    return response(200, []);
  };
  return { fetchImpl, calls };
}

test('solo note PUT resolves canonical question and upserts only the owner', async () => {
  const fake = fakeFetch(); const service = createSoloNoteService({ env, fetchImpl: fake.fetchImpl });
  const result = await service.upsert(req('/api/account/solo-notes', 'PUT', { sessionId: session, sourceType: 'deck', sourceId: 'self-values', questionId: 'self-values-01', roundNumber: 1, slotKind: 'question', note: '一行目\r\n二行目' }));
  assert.equal(result.note.questionText, '機嫌がよくなるスイッチは？');
  assert.equal(JSON.parse(fake.calls.at(-1).options.body).note, '一行目\n二行目');
  await assert.rejects(() => service.upsert(req('/api/account/solo-notes', 'PUT', { sessionId: session, sourceType: 'deck', sourceId: 'date', questionId: 'date-01', roundNumber: 1, slotKind: 'question', note: 'x' })), (error) => error.code === 'SOLO_SOURCE_REQUIRED');
  await assert.rejects(() => service.upsert(req('/api/account/solo-notes', 'PUT', { sessionId: session, sourceType: 'deck', sourceId: 'self-values', questionId: 'self-values-01', roundNumber: 1, slotKind: 'question', note: 'x'.repeat(2001) })), (error) => error.status === 400);
});

test('anonymous users cannot save notes and edits are owner scoped', async () => {
  const anonymous = createSoloNoteService({ env, fetchImpl: fakeFetch({ anonymous: true }).fetchImpl });
  await assert.rejects(() => anonymous.list(req('/api/account/solo-notes')), (error) => error.status === 403);
  const fake = fakeFetch(); const service = createSoloNoteService({ env, fetchImpl: fake.fetchImpl });
  await service.upsert(req('/api/account/solo-notes', 'PUT', { sessionId: session, sourceType: 'deck', sourceId: 'self-values', questionId: 'self-values-02', roundNumber: 1, slotKind: 'question', note: '保存' }));
  const edited = await service.edit(req(`/api/account/solo-notes/${noteId}`, 'PATCH', { note: '編集済み' }), noteId);
  assert.equal(edited.note.note, '編集済み');
});

test('summary slots are round keyed and pagination stays bounded', async () => {
  const fake = fakeFetch(); const service = createSoloNoteService({ env, fetchImpl: fake.fetchImpl });
  const result = await service.upsert(req('/api/account/solo-notes', 'PUT', { sessionId: session, sourceType: 'deck', sourceId: 'self-checkin', roundNumber: 2, slotKind: 'summary', note: 'まとめ' }));
  assert.equal(result.note.questionId, null); assert.equal(result.note.roundNumber, 2);
  const page = await service.list(req('/api/account/solo-notes?limit=1'));
  assert.ok(Array.isArray(page.notes)); assert.equal(page.notes.length, 1);
});

test('R18 notes retain their snapshot, lock list output without age confirmation, and gate edits', async () => {
  const r18Set = '44444444-4444-4444-8444-444444444444';
  const customId = '55555555-5555-4555-8555-555555555555';
  const r18Note = '66666666-6666-4666-8666-666666666666';
  let confirmed = false; let sourcePresent = true; let row;
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url, options });
    if (url.endsWith('/auth/v1/user')) return response(200, { id: userA });
    if (url.includes('/account_profiles')) return response(200, confirmed ? [{ adult_confirmed_at: '2026-10-05T00:00:00.000Z' }] : [{ adult_confirmed_at: null }]);
    if (url.includes('/my_sets')) return response(200, sourcePresent ? [{ id: r18Set, name: 'R18 set', audience: 'solo', card_ids: [`custom:${customId}`] }] : []);
    if (url.includes('/custom_cards')) return response(200, [{ id: customId, text: '成人向けの質問', r18: true }]);
    if (url.includes('/solo_notes') && options.method === 'POST') {
      const payload = JSON.parse(options.body); row = { ...payload, id: r18Note, r18: true, created_at: '2026-10-05T00:00:00.000Z', updated_at: '2026-10-05T00:00:00.000Z' }; return response(201, [row]);
    }
    if (url.includes('/solo_notes') && options.method === 'PATCH') { row = { ...row, note: JSON.parse(options.body).note }; return response(200, [row]); }
    if (url.includes('/solo_notes') && options.method === 'DELETE') return response(200, [row]);
    if (url.includes('/solo_notes')) return response(200, row ? [row] : []);
    return response(200, []);
  };
  const service = createSoloNoteService({ env, fetchImpl });
  const requestBody = { sessionId: session, sourceType: 'set', sourceId: r18Set, questionId: `custom:${customId}`, roundNumber: 1, slotKind: 'question', note: '成人向けメモ' };
  await assert.rejects(() => service.upsert(req('/api/account/solo-notes', 'PUT', requestBody)), (error) => error.code === 'AGE_CONFIRMATION_REQUIRED');
  confirmed = true;
  const saved = await service.upsert(req('/api/account/solo-notes', 'PUT', requestBody));
  assert.equal(saved.note.r18, true); assert.equal(saved.note.note, '成人向けメモ');
  confirmed = false; sourcePresent = false;
  const locked = await service.list(req('/api/account/solo-notes?limit=20'));
  assert.equal(locked.notes[0].locked, true); assert.equal(locked.notes[0].note, null); assert.equal(locked.notes[0].questionText, null);
  await assert.rejects(() => service.edit(req(`/api/account/solo-notes/${r18Note}`, 'PATCH', { note: '変更' }), r18Note), (error) => error.code === 'AGE_CONFIRMATION_REQUIRED');
  const removed = await service.remove(req(`/api/account/solo-notes/${r18Note}`, 'DELETE'), r18Note);
  assert.equal(removed.deleted, true); assert.ok(calls.some(({ url, options }) => url.includes('/account_profiles')));
});

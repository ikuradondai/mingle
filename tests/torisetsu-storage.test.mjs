import assert from 'node:assert/strict';
import test from 'node:test';
import {
  STORAGE_KEY, loadTorisetsu, saveTorisetsu, clearTorisetsu, createTorisetsuState, applyAction, UNDO_MS,
} from '../dist/torisetsu.js';

function spyStorage(initial = {}, { throwOn = [] } = {}) {
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

const ANSWERS = {
  name: { name: 'のんびり号', chips: ['mypace', 'listener'], text: '' },
  warning: { chips: ['sleepy', 'quiet'], text: '' },
  recovery: { chips: ['warm-drink', 'sleep-early'], text: '誰かに電話' },
};

test('nothing is written to storage unless the user opts in', () => {
  const storage = spyStorage();
  const ctx = { storage, today: '2026-10-13' };
  const ts = createTorisetsuState();
  applyAction(ts, 'torisetsu-begin', {}, ctx);
  applyAction(ts, 'torisetsu-chapter', { chapter: 'basic' }, ctx);
  applyAction(ts, 'torisetsu-chip', { chip: 'mypace' }, ctx);
  applyAction(ts, 'torisetsu-commit', {}, ctx);
  applyAction(ts, 'torisetsu-chip', { chip: 'listen' }, ctx);
  applyAction(ts, 'torisetsu-commit', {}, ctx);
  applyAction(ts, 'torisetsu-skip', {}, ctx);
  applyAction(ts, 'torisetsu-manual', {}, ctx);
  applyAction(ts, 'torisetsu-decline', {}, ctx);
  assert.equal(ts.persisted, false);
  assert.equal(storage.calls.setItem, 0);
  assert.equal(storage.data.size, 0);
});

test('opt-in save writes exactly one key with the documented schema and stays small', () => {
  const storage = spyStorage();
  assert.deepEqual(saveTorisetsu(storage, ANSWERS, '2026-10-13'), { ok: true });
  assert.deepEqual([...storage.data.keys()], [STORAGE_KEY]);
  assert.equal(STORAGE_KEY, 'mingle.torisetsu.v1');
  const saved = JSON.parse(storage.data.get(STORAGE_KEY));
  assert.deepEqual(Object.keys(saved).sort(), ['answers', 'savedAt', 'version']);
  assert.equal(saved.version, 1);
  assert.equal(saved.savedAt, '2026-10-13');
  assert.deepEqual(saved.answers.warning, { chips: ['sleepy', 'quiet'], text: '' });
  const full = {};
  for (const id of ['name', 'strengths', 'switch', 'warning', 'recovery', 'upkeep', 'handle', 'request']) full[id] = { chips: ['x'], text: 'あ'.repeat(30) };
  assert.ok(storage.data.get(STORAGE_KEY).length < 1536);
  const big = spyStorage();
  saveTorisetsu(big, { ...ANSWERS, strengths: { chips: ['listen', 'promise', 'steady'], text: '' }, request: { chips: ['hear', 'first'], text: 'あ'.repeat(30) } }, '2026-10-13');
  assert.ok(big.data.get(STORAGE_KEY).length < 1536);
});

test('the save action opts in; later edits are written automatically', () => {
  const storage = spyStorage();
  const ctx = { storage, today: '2026-10-13' };
  const ts = createTorisetsuState();
  applyAction(ts, 'torisetsu-chapter', { chapter: 'basic' }, ctx);
  applyAction(ts, 'torisetsu-chip', { chip: 'mypace' }, ctx);
  applyAction(ts, 'torisetsu-commit', {}, ctx);
  assert.equal(storage.calls.setItem, 0);
  applyAction(ts, 'torisetsu-save', {}, ctx);
  assert.equal(ts.persisted, true);
  assert.equal(storage.calls.setItem, 1);
  applyAction(ts, 'torisetsu-chip', { chip: 'listen' }, ctx);
  applyAction(ts, 'torisetsu-commit', {}, ctx);
  assert.equal(storage.calls.setItem, 2);
  assert.ok(JSON.parse(storage.data.get(STORAGE_KEY)).answers.strengths);
});

test('storage failures never throw and are reported', () => {
  assert.deepEqual(saveTorisetsu(spyStorage({}, { throwOn: ['setItem'] }), ANSWERS, '2026-10-13'), { ok: false });
  assert.deepEqual(saveTorisetsu(() => { throw new Error('SecurityError'); }, ANSWERS, '2026-10-13'), { ok: false });
  assert.deepEqual(saveTorisetsu(null, ANSWERS, '2026-10-13'), { ok: false });
  assert.equal(loadTorisetsu(() => { throw new Error('SecurityError'); }), null);
  assert.equal(loadTorisetsu(spyStorage({}, { throwOn: ['getItem'] })), null);
  assert.deepEqual(clearTorisetsu(spyStorage({}, { throwOn: ['removeItem'] })), { ok: false });
  assert.deepEqual(clearTorisetsu(() => { throw new Error('x'); }), { ok: false });
  const ts = createTorisetsuState();
  const ctx = { storage: spyStorage({}, { throwOn: ['setItem'] }), today: '2026-10-13' };
  applyAction(ts, 'torisetsu-chapter', { chapter: 'basic' }, ctx);
  applyAction(ts, 'torisetsu-chip', { chip: 'mypace' }, ctx);
  applyAction(ts, 'torisetsu-commit', {}, ctx);
  applyAction(ts, 'torisetsu-save', {}, ctx);
  assert.equal(ts.persisted, false);
  assert.match(ts.saveError, /保存できませんでした/);
  assert.equal(Object.keys(ts.answers).length, 1, 'work stays in memory');
});

test('load rejects broken or foreign data, removing the key', () => {
  for (const raw of ['not json', '{"version":2,"answers":{}}', '{"version":1}', '[]', 'null', '{"version":1,"answers":{"unknown":{"chips":["a"],"text":""}}}', '{"version":1,"answers":[]}']) {
    const storage = spyStorage({ [STORAGE_KEY]: raw });
    assert.equal(loadTorisetsu(storage), null, raw);
    assert.equal(storage.data.has(STORAGE_KEY), false, `${raw} should be removed`);
  }
  assert.equal(loadTorisetsu(spyStorage()), null);
});

test('load drops unknown ids, clamps lengths and chip counts, strips control characters', () => {
  const raw = JSON.stringify({
    version: 1, savedAt: '2026-10-13',
    answers: {
      name: { name: 'あ'.repeat(40), chips: ['mypace', 'steady', 'listener'], text: '' },
      warning: { chips: ['sleepy', 'ghost', 'quiet', 'heavy', 'phone'], text: 'a\nb' + 'い'.repeat(60) },
      mystery: { chips: ['x'], text: 'y' },
      request: { chips: [], text: '' },
    },
  });
  const loaded = loadTorisetsu(spyStorage({ [STORAGE_KEY]: raw }));
  assert.deepEqual(Object.keys(loaded.answers).sort(), ['name', 'warning']);
  assert.equal(loaded.answers.name.name.length, 12);
  assert.deepEqual(loaded.answers.name.chips, ['mypace', 'steady']);
  assert.equal(loaded.answers.warning.text.length, 30);
  assert.doesNotMatch(loaded.answers.warning.text, /\n/);
  assert.deepEqual(loaded.answers.warning.chips, ['sleepy', 'quiet']);
  assert.equal(loaded.savedAt, '2026-10-13');
});

test('save then load round-trips; saved state shows the revisit screen data', () => {
  const storage = spyStorage();
  saveTorisetsu(storage, ANSWERS, '2026-10-13');
  const loaded = loadTorisetsu(storage);
  assert.deepEqual(loaded.answers, { ...ANSWERS, name: { ...ANSWERS.name } });
  const ts = createTorisetsuState({ stored: loaded });
  assert.equal(ts.persisted, true);
  assert.equal(ts.view, 'start');
  assert.equal(ts.savedAt, '2026-10-13');
});

test('delete removes the key at once, clears memory and offers a 5 second undo that does not re-save', () => {
  const storage = spyStorage();
  saveTorisetsu(storage, ANSWERS, '2026-10-13');
  const ts = createTorisetsuState({ stored: loadTorisetsu(storage) });
  let now = 1_000_000;
  const ctx = { storage, today: '2026-10-13', now: () => now };
  const writesBefore = storage.calls.setItem;
  const result = applyAction(ts, 'torisetsu-delete', {}, ctx);
  assert.equal(result.undoTimer, UNDO_MS);
  assert.equal(storage.data.has(STORAGE_KEY), false);
  assert.deepEqual(ts.answers, {});
  assert.equal(ts.persisted, false);
  assert.equal(ts.view, 'start');
  assert.ok(ts.undo);
  now += 3000;
  applyAction(ts, 'torisetsu-undo', {}, ctx);
  assert.deepEqual(Object.keys(ts.answers).sort(), ['name', 'recovery', 'warning']);
  assert.equal(ts.persisted, false, 'undo does not mark as saved');
  assert.equal(storage.data.has(STORAGE_KEY), false, 'undo does not write to the device');
  assert.equal(storage.calls.setItem, writesBefore);
  assert.equal(ts.undo, null);
});

test('undo after 5 seconds restores nothing', () => {
  const storage = spyStorage();
  saveTorisetsu(storage, ANSWERS, '2026-10-13');
  const ts = createTorisetsuState({ stored: loadTorisetsu(storage) });
  let now = 1_000_000;
  const ctx = { storage, today: '2026-10-13', now: () => now };
  applyAction(ts, 'torisetsu-delete', {}, ctx);
  now += UNDO_MS + 1;
  applyAction(ts, 'torisetsu-undo', {}, ctx);
  assert.deepEqual(ts.answers, {});
  assert.equal(ts.undo, null);
});

test('delete still clears the screen when removeItem throws', () => {
  const storage = spyStorage({ [STORAGE_KEY]: JSON.stringify({ version: 1, savedAt: '2026-10-13', answers: ANSWERS }) }, { throwOn: ['removeItem'] });
  const ts = createTorisetsuState({ stored: loadTorisetsu(storage) });
  assert.doesNotThrow(() => applyAction(ts, 'torisetsu-delete', {}, { storage, today: '2026-10-13' }));
  assert.deepEqual(ts.answers, {});
  assert.equal(ts.persisted, false);
});

test('leaving with unsaved work asks first; saved or empty work leaves at once', () => {
  const ts = createTorisetsuState();
  assert.deepEqual(applyAction(ts, 'torisetsu-back', {}, {}), { leave: true });
  applyAction(ts, 'torisetsu-chapter', { chapter: 'basic' }, {});
  applyAction(ts, 'torisetsu-chip', { chip: 'mypace' }, {});
  applyAction(ts, 'torisetsu-commit', {}, {});
  applyAction(ts, 'torisetsu-contents', {}, {});
  const ask = applyAction(ts, 'torisetsu-back', {}, {});
  assert.equal(ts.leaveConfirm, true);
  assert.equal(ask.leave, undefined);
  assert.deepEqual(applyAction(ts, 'torisetsu-leave-confirm', {}, {}), { leave: true });
  applyAction(ts, 'torisetsu-leave-keep', {}, {});
  assert.equal(ts.leaveConfirm, false);
  assert.equal(ts.view, 'manual');
  const saved = createTorisetsuState({ stored: { answers: ANSWERS, savedAt: '2026-10-13' } });
  assert.deepEqual(applyAction(saved, 'torisetsu-back', {}, {}), { leave: true });
});

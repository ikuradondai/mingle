import assert from 'node:assert/strict';
import test from 'node:test';
import {
  STORAGE_KEY, STORAGE_KEY_V1, loadTorisetsu, saveTorisetsu, clearTorisetsu, createTorisetsuState, applyAction, UNDO_MS, normalizeData, emptyData, hasAnyAnswer, setDraftText, SAVE_MAX_LENGTH,
} from '../dist/torisetsu.js';
import { DAY_CHIPS } from '../dist/data/torisetsu-content.js';
import { spyStorage, makeCtx, runChapter, fillAndRecord } from './helpers/torisetsu-flow.mjs';
import * as ex1 from './fixtures/torisetsu/example1-office-worker.mjs';
import * as ex2 from './fixtures/torisetsu/example2-retired.mjs';
import * as ex3 from './fixtures/torisetsu/example3-student.mjs';
import * as ex4 from './fixtures/torisetsu/example4-no-pattern.mjs';

const choice = { surprise: '', surpriseText: '', experiment: '', experimentText: '', done: false };
const savedData = () => ({
  name: 'のんびり号',
  energy: { prediction: ['do_eat', 'sleep_good'], good: ex1.input.good, bad: ex1.input.bad, surprise: 'g:do_talk', surpriseText: '', experiment: 'try:do_talk:more', experimentText: '', done: true },
  values: { prediction: ['v_care'], neg: ex2.input.neg, pos: ex2.input.pos, ...choice },
  others: { self: ex3.input.self, episodes: ex3.input.episodes, ...choice },
});

test('nothing is written to storage unless the user opts in (all three chapters, through to try)', () => {
  const storage = spyStorage();
  const ctx = makeCtx(storage);
  const ts = createTorisetsuState();
  runChapter(ts, ctx, 'energy', ex1.input, { surprise: 'g:do_talk', experiment: 'try:do_talk:more' });
  runChapter(ts, ctx, 'values', ex2.input, { surprise: 'v:v_honest', experiment: 'try:v_honest' });
  runChapter(ts, ctx, 'others', ex3.input, { surpriseText: '意外', experimentText: '来週' });
  applyAction(ts, 'torisetsu-manual', {}, ctx);
  applyAction(ts, 'torisetsu-decline', {}, ctx);
  assert.equal(ts.persisted, false);
  assert.equal(ts.data.energy.done && ts.data.values.done && ts.data.others.done, true);
  assert.equal(storage.calls.setItem, 0);
  assert.equal(storage.data.size, 0);
});

test('opting in writes only mingle.torisetsu.v2, with the documented shape, and autosaves afterwards', () => {
  const storage = spyStorage();
  const ctx = makeCtx(storage);
  const ts = createTorisetsuState();
  runChapter(ts, ctx, 'energy', ex1.input, { surprise: 'g:do_talk', experiment: 'try:do_talk:more' });
  assert.equal(storage.calls.setItem, 0, 'answers alone are not saved');
  applyAction(ts, 'torisetsu-save', {}, ctx);
  assert.deepEqual([...storage.data.keys()], [STORAGE_KEY]);
  assert.equal(STORAGE_KEY, 'mingle.torisetsu.v2');
  const saved = JSON.parse(storage.data.get(STORAGE_KEY));
  assert.deepEqual(Object.keys(saved), ['version', 'savedAt', 'data']);
  assert.equal(saved.version, 2);
  assert.equal(saved.savedAt, '2026-10-13');
  assert.deepEqual(Object.keys(saved.data), ['name', 'energy', 'values', 'others']);
  assert.deepEqual(saved.data.energy.good[0], { who: ['who_friend'], where: ['where_town'], doing: ['do_talk', 'do_eat'], sleep: 'sleep_ok', body: 'body_good', memo: '土曜、友だちとランチ' });
  assert.equal(saved.data.energy.surprise, 'g:do_talk');
  assert.equal(saved.data.energy.done, true);
  // 保存しない物：集計結果や文
  assert.doesNotMatch(storage.data.get(STORAGE_KEY), /今回の答えでは|ありました/);
  const writes = storage.calls.setItem;
  runChapter(ts, ctx, 'values', ex2.input);
  assert.ok(storage.calls.setItem > writes, 'autosave after opt-in');
  assert.equal(JSON.parse(storage.data.get(STORAGE_KEY)).data.values.neg.length, 2);
});

test('the largest possible answer stays under 8KB and the size guard exists', () => {
  const day = { who: ['who_alone', 'who_family'], where: ['where_home', 'where_work'], doing: ['do_work', 'do_chores', 'do_hobby'], sleep: 'sleep_unknown', body: 'body_tired', memo: 'あ'.repeat(30) };
  const data = {
    name: 'あ'.repeat(12),
    energy: { prediction: ['do_eat', 'out'], good: Array(5).fill(day), bad: Array(5).fill(day), surprise: 'g:do_new', surpriseText: '', experiment: 'try:do_help:more', experimentText: '', done: true },
    values: { prediction: ['v_honest'], neg: Array(3).fill({ situation: 'n_rushed', value: 'v_respect', feeling: 'f_hurried', memo: 'あ'.repeat(30) }), pos: Array(3).fill({ situation: 'p_together', value: 'v_calm', feeling: 'f_proud', memo: 'あ'.repeat(30) }), surprise: '', surpriseText: 'あ'.repeat(30), experiment: '', experimentText: 'あ'.repeat(30), done: true },
    others: { self: ['s_listen', 's_explain', 's_solve'], episodes: Array(5).fill({ kind: 'k_praised', task: 't_steady', who: 'w_local', memo: 'あ'.repeat(30) }), surprise: '', surpriseText: 'あ'.repeat(30), experiment: '', experimentText: 'あ'.repeat(30), done: true },
  };
  const storage = spyStorage();
  assert.deepEqual(saveTorisetsu(storage, data, '2026-10-13'), { ok: true });
  const text = storage.data.get(STORAGE_KEY);
  assert.ok(Buffer.byteLength(text, 'utf8') < 8 * 1024, `${Buffer.byteLength(text, 'utf8')} bytes`);
  assert.ok(text.length < SAVE_MAX_LENGTH);
  assert.equal(SAVE_MAX_LENGTH, 16000);
});

test('storage exceptions are handled everywhere', () => {
  const boom = () => { throw new Error('SecurityError'); };
  assert.deepEqual(saveTorisetsu(boom, savedData(), '2026-10-13'), { ok: false });
  assert.deepEqual(saveTorisetsu(null, savedData(), '2026-10-13'), { ok: false });
  assert.equal(loadTorisetsu(boom), null);
  assert.equal(loadTorisetsu(spyStorage({}, { throwOn: ['getItem'] })), null);
  assert.deepEqual(clearTorisetsu(spyStorage({}, { throwOn: ['removeItem'] })), { ok: false });
  assert.deepEqual(clearTorisetsu(boom), { ok: false });
  const ts = createTorisetsuState();
  const ctx = makeCtx(spyStorage({}, { throwOn: ['setItem'] }));
  runChapter(ts, ctx, 'energy', ex1.input);
  applyAction(ts, 'torisetsu-save', {}, ctx);
  assert.equal(ts.persisted, false);
  assert.match(ts.saveError, /保存できませんでした/);
  assert.equal(ts.data.energy.good.length, 3, 'work stays in memory');
  // localStorage の取得自体が投げる環境でも、開く・残す・消すが例外を出さない
  const throwingCtx = { storage: boom, today: '2026-10-13', now: () => 1 };
  assert.doesNotThrow(() => { applyAction(ts, 'torisetsu-save', {}, throwingCtx); applyAction(ts, 'torisetsu-delete', {}, throwingCtx); });
  assert.deepEqual(ts.data, emptyData());
});

test('load rejects broken or foreign data and removes the key', () => {
  const bad = ['not json', '{"version":1,"data":{}}', '{"version":3}', '[]', 'null', '{"version":2}', '{"version":2,"data":[]}', '{"version":2,"data":{"name":"","energy":{"good":[{"who":["ghost"]}]}}}', '{"version":2,"data":{}}'];
  for (const raw of bad) {
    const storage = spyStorage({ [STORAGE_KEY]: raw });
    assert.equal(loadTorisetsu(storage), null, raw);
    assert.equal(storage.data.has(STORAGE_KEY), false, `${raw} should be removed`);
  }
  assert.equal(loadTorisetsu(spyStorage()), null);
});

test('load drops unknown ids, clamps lengths and counts, strips control characters', () => {
  const day = { who: ['who_alone', 'who_family', 'who_friend', 'ghost'], where: ['where_home'], doing: ['do_work', 'do_talk', 'do_eat', 'do_new'], sleep: 'sleep_ok', body: 'body_ok', memo: 'a\nb' + 'い'.repeat(60) };
  const raw = JSON.stringify({
    version: 2, savedAt: '2026-10-13',
    data: {
      name: 'あ'.repeat(40),
      energy: { prediction: ['do_eat', 'ghost', 'out', 'do_talk'], good: [day, { ...day, sleep: '' }, ...Array(8).fill(day)], bad: [], surprise: 'Bad Key!', surpriseText: 'x\u0000y', experiment: 'try:ghost:more', experimentText: '', done: 'yes' },
      values: { prediction: ['v_care', 'v_fair'], neg: [{ situation: 'n_promise', value: 'ghost', feeling: 'f_happy', memo: '' }, { situation: 'n_promise', value: 'v_fair', feeling: 'f_sad', memo: 'ok' }], pos: [], surprise: '', surpriseText: '', experiment: '', experimentText: '', done: false },
      others: { self: ['s_listen', 'x', 's_try', 's_cheer', 's_calm'], episodes: [{ kind: 'k_asked', task: 't_listen', who: 'nobody', memo: '' }, { kind: 'zz', task: 't_listen' }], surprise: '', surpriseText: '', experiment: '', experimentText: '', done: false },
      mystery: { x: 1 },
    },
  });
  const loaded = loadTorisetsu(spyStorage({ [STORAGE_KEY]: raw }));
  const d = loaded.data;
  assert.equal(d.name.length, 12);
  assert.deepEqual(d.energy.prediction, ['do_eat', 'out']);
  assert.equal(d.energy.good.length, 5);
  assert.deepEqual(d.energy.good[0].who, ['who_alone', 'who_family']);
  assert.deepEqual(d.energy.good[0].doing, ['do_work', 'do_talk', 'do_eat']);
  assert.equal(d.energy.good[0].memo.length, 30);
  assert.doesNotMatch(d.energy.good[0].memo, /\n/);
  assert.equal(d.energy.surprise, '', 'key with illegal characters is dropped');
  assert.equal(d.energy.surpriseText, 'x y');
  assert.equal(d.energy.experiment, '', 'key that is not a candidate is dropped');
  assert.equal(d.energy.done, false);
  assert.deepEqual(d.values.prediction, ['v_care']);
  assert.equal(d.values.neg.length, 1, 'feeling of the wrong side drops the episode');
  assert.equal(d.values.neg[0].value, 'v_fair');
  assert.deepEqual(d.others.self, ['s_listen', 's_try', 's_cheer']);
  assert.equal(d.others.episodes.length, 1);
  assert.equal(d.others.episodes[0].who, '');
  assert.equal('mystery' in d, false);
  assert.equal(loaded.savedAt, '2026-10-13');
});

test('save then load round-trips; the saved state starts on the revisit screen', () => {
  const storage = spyStorage();
  saveTorisetsu(storage, savedData(), '2026-10-13');
  const loaded = loadTorisetsu(storage);
  assert.deepEqual(loaded.data, normalizeData(savedData()));
  const ts = createTorisetsuState({ stored: loaded });
  assert.equal(ts.persisted, true);
  assert.equal(ts.view, 'start');
  assert.equal(ts.savedAt, '2026-10-13');
  assert.equal(ts.notice, '');
});

// ---- v1 からの移行 ----
const v1 = (answers) => JSON.stringify({ version: 1, savedAt: '2026-10-10', answers });

test('v1 migration: name and the switch (as a chapter-1 prediction) move over, the rest is dropped, v1 is removed', () => {
  const storage = spyStorage({ [STORAGE_KEY_V1]: v1({ name: { name: 'のんびり号', chips: ['mypace'], text: '' }, switch: { chips: ['walk', 'eat', 'sleep'], text: '紅茶' }, warning: { chips: ['sleepy'], text: '' } }) });
  const loaded = loadTorisetsu(storage, { today: '2026-10-13' });
  assert.equal(loaded.data.name, 'のんびり号');
  assert.deepEqual(loaded.data.energy.prediction, ['out', 'do_eat'], 'first two, mapped');
  assert.deepEqual(loaded.data.energy.good, []);
  assert.equal(loaded.persisted, true);
  assert.equal(loaded.notice, 'トリセツの作り方が新しくなりました。前のトリセツから「製品名」と「元気になるスイッチ」を引き継ぎました。ほかの欄は、新しい作り方で書き直してね。');
  assert.equal(storage.data.has(STORAGE_KEY_V1), false);
  assert.equal(JSON.parse(storage.data.get(STORAGE_KEY)).data.name, 'のんびり号');
  const ts = createTorisetsuState({ stored: loaded });
  assert.equal(ts.persisted, true);
  assert.equal(ts.notice, loaded.notice);
  assert.equal(ts.v1Prediction, true);
  assert.equal(hasAnyAnswer(ts.data), true);
});

test('v1 migration: each v1 switch chip maps to a prediction that exists', () => {
  const map = { eat: 'do_eat', music: 'do_hobby', oshi: 'do_hobby', walk: 'out', sleep: 'sleep_good', chat: 'do_talk', bath: 'do_rest', free: 'do_rest' };
  for (const [chip, prediction] of Object.entries(map)) {
    const storage = spyStorage({ [STORAGE_KEY_V1]: v1({ switch: { chips: [chip], text: '' } }) });
    assert.deepEqual(loadTorisetsu(storage).data.energy.prediction, [prediction], chip);
  }
  const storage = spyStorage({ [STORAGE_KEY_V1]: v1({ switch: { chips: ['music', 'oshi', 'animals', 'praised'], text: '' } }) });
  assert.deepEqual(loadTorisetsu(storage).data.energy.prediction, ['do_hobby'], 'duplicates and unmapped chips are dropped');
});

test('v1 migration: nothing to carry over -> notice only, v1 removed, no v2 written', () => {
  const storage = spyStorage({ [STORAGE_KEY_V1]: v1({ warning: { chips: ['sleepy'], text: '' }, switch: { chips: ['animals'], text: '紅茶' } }) });
  const loaded = loadTorisetsu(storage, { today: '2026-10-13' });
  assert.equal(loaded.notice, 'トリセツの作り方が新しくなりました。前のトリセツの答えは新しい作り方では使えないため、この端末から消しました。');
  assert.equal(loaded.persisted, false);
  assert.equal(hasAnyAnswer(loaded.data), false);
  assert.equal(storage.data.size, 0);
  assert.equal(storage.calls.setItem, 0);
  const ts = createTorisetsuState({ stored: loaded });
  assert.equal(ts.persisted, false);
  assert.equal(ts.notice, loaded.notice);
});

test('v1 migration: a broken v1 is discarded silently; v2 present means v1 is not read', () => {
  const broken = spyStorage({ [STORAGE_KEY_V1]: 'not json' });
  assert.equal(loadTorisetsu(broken), null);
  assert.equal(broken.data.has(STORAGE_KEY_V1), false);
  const both = spyStorage({ [STORAGE_KEY_V1]: v1({ name: { name: 'ふるい', chips: [], text: '' } }) });
  const donor = spyStorage(); saveTorisetsu(donor, savedData(), '2026-10-13');
  both.data.set(STORAGE_KEY, donor.data.get(STORAGE_KEY)); // v1 と v2 が両方ある状態
  const loaded = loadTorisetsu(both);
  assert.equal(loaded.data.name, 'のんびり号');
  assert.equal(loaded.notice, '');
  assert.equal(both.data.has(STORAGE_KEY_V1), true, 'v1 untouched when v2 exists');
});

test('v1 migration: when writing v2 fails, v1 stays and the work stays in memory (not persisted)', () => {
  const storage = spyStorage({ [STORAGE_KEY_V1]: v1({ name: { name: 'のんびり号', chips: [], text: '' } }) }, { throwOn: ['setItem'] });
  const loaded = loadTorisetsu(storage, { today: '2026-10-13' });
  assert.equal(loaded.data.name, 'のんびり号');
  assert.equal(loaded.persisted, false);
  assert.equal(storage.data.has(STORAGE_KEY_V1), true, 'v1 kept so the next visit can try again');
  assert.equal(createTorisetsuState({ stored: loaded }).persisted, false);
});

// ---- 消す・元に戻す・閉じる ----
test('delete removes v2 and v1 at once, clears memory and offers a 5 second undo that does not re-save', () => {
  const storage = spyStorage({ [STORAGE_KEY_V1]: v1({ name: { name: 'ふるい', chips: [], text: '' } }) });
  saveTorisetsu(storage, savedData(), '2026-10-13');
  const ts = createTorisetsuState({ stored: loadTorisetsu(storage) });
  let now = 1_000_000;
  const ctx = { storage, today: '2026-10-13', now: () => now };
  const writesBefore = storage.calls.setItem;
  const result = applyAction(ts, 'torisetsu-delete', {}, ctx);
  assert.equal(result.undoTimer, UNDO_MS);
  assert.equal(storage.data.has(STORAGE_KEY), false);
  assert.equal(storage.data.has(STORAGE_KEY_V1), false);
  assert.deepEqual(ts.data, emptyData());
  assert.equal(ts.persisted, false);
  assert.equal(ts.view, 'start');
  assert.ok(ts.undo);
  now += 3000;
  applyAction(ts, 'torisetsu-undo', {}, ctx);
  assert.equal(ts.data.name, 'のんびり号');
  assert.equal(ts.data.energy.good.length, 3);
  assert.equal(ts.persisted, false, 'undo does not mark as saved');
  assert.equal(storage.data.has(STORAGE_KEY), false, 'undo does not write to the device');
  assert.equal(storage.calls.setItem, writesBefore);
  assert.equal(ts.undo, null);
});

test('undo after 5 seconds restores nothing', () => {
  const storage = spyStorage();
  saveTorisetsu(storage, savedData(), '2026-10-13');
  const ts = createTorisetsuState({ stored: loadTorisetsu(storage) });
  let now = 1_000_000;
  const ctx = { storage, today: '2026-10-13', now: () => now };
  applyAction(ts, 'torisetsu-delete', {}, ctx);
  now += UNDO_MS + 1;
  applyAction(ts, 'torisetsu-undo', {}, ctx);
  assert.deepEqual(ts.data, emptyData());
  assert.equal(ts.undo, null);
});

test('delete still clears the screen when removeItem throws', () => {
  const storage = spyStorage({ [STORAGE_KEY]: JSON.stringify({ version: 2, savedAt: '2026-10-13', data: savedData() }) }, { throwOn: ['removeItem'] });
  const ts = createTorisetsuState({ stored: loadTorisetsu(storage) });
  assert.doesNotThrow(() => applyAction(ts, 'torisetsu-delete', {}, { storage, today: '2026-10-13' }));
  assert.deepEqual(ts.data, emptyData());
  assert.equal(ts.persisted, false);
});

test('leaving with unsaved work asks first (even a prediction alone); saved or empty work leaves at once', () => {
  const ts = createTorisetsuState();
  const ctx = makeCtx();
  assert.deepEqual(applyAction(ts, 'torisetsu-back', {}, ctx), { leave: true });
  applyAction(ts, 'torisetsu-begin', {}, ctx);
  applyAction(ts, 'torisetsu-chapter', { chapter: 'energy' }, ctx);
  applyAction(ts, 'torisetsu-chip', { group: 'prediction', chip: 'do_eat' }, ctx);
  applyAction(ts, 'torisetsu-back', {}, ctx); // predict -> contents
  assert.equal(ts.view, 'contents');
  const ask = applyAction(ts, 'torisetsu-back', {}, ctx);
  assert.equal(ts.leaveConfirm, true);
  assert.equal(ask.leave, undefined);
  assert.deepEqual(applyAction(ts, 'torisetsu-leave-confirm', {}, ctx), { leave: true });
  applyAction(ts, 'torisetsu-leave-keep', {}, ctx);
  assert.equal(ts.leaveConfirm, false);
  assert.equal(ts.view, 'manual');
  const saved = createTorisetsuState({ stored: { data: savedData(), savedAt: '2026-10-13', persisted: true } });
  assert.deepEqual(applyAction(saved, 'torisetsu-back', {}, ctx), { leave: true });
});

// ---- 画面の流れ ----
test('chapter 1 flow: 3 good days then 3 bad days, then line up, find, compare, surprise, try, done', () => {
  const ctx = makeCtx();
  const ts = createTorisetsuState();
  applyAction(ts, 'torisetsu-begin', {}, ctx);
  applyAction(ts, 'torisetsu-chapter', { chapter: 'energy' }, ctx);
  assert.equal(ts.step, 'predict');
  applyAction(ts, 'torisetsu-chip', { group: 'prediction', chip: 'do_eat' }, ctx);
  applyAction(ts, 'torisetsu-chip', { group: 'prediction', chip: 'sleep_good' }, ctx);
  const full = applyAction(ts, 'torisetsu-chip', { group: 'prediction', chip: 'out' }, ctx);
  assert.equal(ts.limitMessage, '2つまでです。どれかを外すと選べます。');
  assert.deepEqual(ts.data.energy.prediction, ['do_eat', 'sleep_good']);
  assert.equal(full.render, true);
  applyAction(ts, 'torisetsu-next', {}, ctx);
  assert.deepEqual([ts.step, ts.side], ['recall-intro', 'good']);
  applyAction(ts, 'torisetsu-recall-start', {}, ctx);
  assert.deepEqual([ts.step, ts.side, ts.index], ['day', 'good', 0]);
  for (let i = 0; i < 3; i += 1) fillAndRecord(ts, ctx, 'energy', ex1.input.good[i]);
  assert.deepEqual([ts.step, ts.side], ['recall-intro', 'bad']);
  applyAction(ts, 'torisetsu-recall-start', {}, ctx);
  for (let i = 0; i < 3; i += 1) fillAndRecord(ts, ctx, 'energy', ex1.input.bad[i]);
  assert.equal(ts.step, 'lineup');
  applyAction(ts, 'torisetsu-find', {}, ctx);
  assert.equal(ts.step, 'insight');
  applyAction(ts, 'torisetsu-compare', {}, ctx);
  assert.equal(ts.step, 'gap');
  applyAction(ts, 'torisetsu-gap-next', {}, ctx);
  assert.equal(ts.step, 'surprise');
  applyAction(ts, 'torisetsu-pick', { kind: 'surprise', key: 'g:do_talk' }, ctx);
  applyAction(ts, 'torisetsu-surprise-next', {}, ctx);
  assert.equal(ts.step, 'try');
  applyAction(ts, 'torisetsu-pick', { kind: 'experiment', key: 'try:do_talk:more' }, ctx);
  applyAction(ts, 'torisetsu-finish', {}, ctx);
  assert.equal(ts.step, 'done');
  assert.equal(ts.data.energy.done, true);
  assert.equal(ts.persisted, false);
});

test('a day needs every required group; the message names the missing ones and nothing is recorded', () => {
  const ctx = makeCtx();
  const ts = createTorisetsuState();
  applyAction(ts, 'torisetsu-chapter-start', { chapter: 'energy' }, ctx);
  applyAction(ts, 'torisetsu-next', {}, ctx);
  applyAction(ts, 'torisetsu-recall-start', {}, ctx);
  applyAction(ts, 'torisetsu-chip', { group: 'who', chip: 'who_alone' }, ctx);
  applyAction(ts, 'torisetsu-record', {}, ctx);
  assert.equal(ts.step, 'day');
  assert.equal(ts.data.energy.good.length, 0);
  assert.equal(ts.missingMessage, '選んでいないところがあります：どこにいた、何をしていた、前の晩は、体の調子は');
  // 上限と、1つだけのグループの入れかわり
  applyAction(ts, 'torisetsu-chip', { group: 'who', chip: 'who_family' }, ctx);
  applyAction(ts, 'torisetsu-chip', { group: 'who', chip: 'who_friend' }, ctx);
  assert.deepEqual(ts.draft.who, ['who_alone', 'who_family']);
  assert.equal(ts.limitMessage, '2つまでです。どれかを外すと選べます。');
  assert.equal(ts.limitGroup, 'who');
  applyAction(ts, 'torisetsu-chip', { group: 'sleep', chip: 'sleep_ok' }, ctx);
  applyAction(ts, 'torisetsu-chip', { group: 'sleep', chip: 'sleep_good' }, ctx);
  assert.deepEqual(ts.draft.sleep, ['sleep_good']);
});

test('back keeps what was typed; going back and re-recording a day does not duplicate it', () => {
  const ctx = makeCtx();
  const ts = createTorisetsuState();
  applyAction(ts, 'torisetsu-chapter-start', { chapter: 'energy' }, ctx);
  applyAction(ts, 'torisetsu-next', {}, ctx);
  applyAction(ts, 'torisetsu-recall-start', {}, ctx);
  fillAndRecord(ts, ctx, 'energy', ex1.input.good[0]);
  assert.equal(ts.index, 1);
  applyAction(ts, 'torisetsu-chip', { group: 'who', chip: 'who_pet' }, ctx);
  setDraftText(ts, 'まだ途中', 'memo', ctx);
  applyAction(ts, 'torisetsu-back', {}, ctx);
  assert.equal(ts.index, 0);
  assert.deepEqual(ts.draft.who, ['who_friend'], 'the recorded day is shown again');
  applyAction(ts, 'torisetsu-record', {}, ctx);
  assert.equal(ts.data.energy.good.length, 1, 'no duplicate');
  assert.equal(ts.index, 1);
  assert.deepEqual(ts.draft.who, ['who_pet'], 'draft kept');
  assert.equal(ts.draft.memo, 'まだ途中');
});

test('skipping leaves fewer than 2 days: the short screen offers to add one, then the chapter continues', () => {
  const ctx = makeCtx();
  const ts = createTorisetsuState();
  runChapter(ts, ctx, 'energy', { prediction: [], good: [ex1.input.good[0]], bad: ex1.input.bad.slice(0, 2) }, { stopAt: 'lineup' });
  assert.equal(ts.step, 'short');
  applyAction(ts, 'torisetsu-add-item', { side: 'good', returnTo: 'short' }, ctx);
  assert.deepEqual([ts.step, ts.phase, ts.side], ['day', 'edit', 'good']);
  fillAndRecord(ts, ctx, 'energy', ex1.input.good[1]);
  assert.equal(ts.step, 'lineup');
  assert.equal(ts.data.energy.good.length, 2);
  const later = createTorisetsuState();
  runChapter(later, ctx, 'energy', { prediction: [], good: [], bad: [] }, { stopAt: 'lineup' });
  applyAction(later, 'torisetsu-skip-short', {}, ctx);
  assert.equal(later.view, 'contents');
});

test('days list: fix, add up to 5, delete, then return to a recalculated insight', () => {
  const ctx = makeCtx();
  const ts = createTorisetsuState();
  runChapter(ts, ctx, 'energy', ex1.input, { stopAt: 'insight' });
  applyAction(ts, 'torisetsu-days', {}, ctx);
  assert.equal(ts.step, 'days');
  applyAction(ts, 'torisetsu-edit-item', { side: 'good', index: '1' }, ctx);
  assert.deepEqual(ts.draft.doing, ['do_work', 'do_talk']);
  applyAction(ts, 'torisetsu-chip', { group: 'doing', chip: 'do_talk' }, ctx); // 外す
  applyAction(ts, 'torisetsu-record', {}, ctx);
  assert.equal(ts.step, 'days');
  assert.deepEqual(ts.data.energy.good[1].doing, ['do_work']);
  for (let i = 0; i < 2; i += 1) { applyAction(ts, 'torisetsu-add-item', { side: 'good', returnTo: 'days' }, ctx); fillAndRecord(ts, ctx, 'energy', ex1.input.good[0]); }
  assert.equal(ts.data.energy.good.length, 5);
  applyAction(ts, 'torisetsu-add-item', { side: 'good', returnTo: 'days' }, ctx);
  assert.equal(ts.step, 'days', 'the 6th day is refused');
  applyAction(ts, 'torisetsu-edit-item', { side: 'good', index: '4' }, ctx);
  applyAction(ts, 'torisetsu-delete-item', {}, ctx);
  assert.equal(ts.data.energy.good.length, 4);
  applyAction(ts, 'torisetsu-days-done', {}, ctx);
  assert.equal(ts.step, 'insight');
});

test('no-pattern insight can add a day and come back; "go on" moves forward', () => {
  const ctx = makeCtx();
  const ts = createTorisetsuState();
  runChapter(ts, ctx, 'energy', ex4.input, { stopAt: 'insight' });
  assert.equal(ts.step, 'insight');
  applyAction(ts, 'torisetsu-add-item', { side: 'bad', returnTo: 'insight' }, ctx);
  fillAndRecord(ts, ctx, 'energy', ex4.input.bad[0]);
  assert.equal(ts.step, 'insight');
  assert.equal(ts.data.energy.bad.length, 3);
  applyAction(ts, 'torisetsu-compare', {}, ctx);
  assert.equal(ts.step, 'surprise', 'no prediction -> straight to surprise');
});

test('values and others flows: 2+2 episodes, value re-pick, and chapter 3 skips the separate gap screen', () => {
  const ctx = makeCtx();
  const ts = createTorisetsuState();
  runChapter(ts, ctx, 'values', ex2.input, { stopAt: 'lineup' });
  assert.equal(ts.step, 'lineup');
  applyAction(ts, 'torisetsu-value-open', { side: 'neg', index: '1' }, ctx);
  assert.equal(ts.valuePicker, 'neg:1');
  applyAction(ts, 'torisetsu-value-set', { side: 'neg', index: '1', chip: 'v_honest' }, ctx);
  assert.equal(ts.data.values.neg[1].value, 'v_honest');
  assert.equal(ts.data.values.neg[1].situation, 'n_ignored');
  applyAction(ts, 'torisetsu-find', {}, ctx);
  applyAction(ts, 'torisetsu-compare', {}, ctx);
  assert.equal(ts.step, 'gap');
  const other = createTorisetsuState();
  runChapter(other, ctx, 'others', ex3.input, { stopAt: 'insight' });
  applyAction(other, 'torisetsu-compare', {}, ctx);
  assert.equal(other.step, 'surprise');
});

test('surprise / try accept either a candidate or free text, never both; chapter reopens at the insight', () => {
  const ctx = makeCtx();
  const ts = createTorisetsuState();
  runChapter(ts, ctx, 'energy', ex1.input, { surprise: 'g:do_talk', experimentText: '月曜の朝は散歩する' });
  assert.equal(ts.data.energy.surprise, 'g:do_talk');
  assert.equal(ts.data.energy.experiment, '');
  assert.equal(ts.data.energy.experimentText, '月曜の朝は散歩する');
  applyAction(ts, 'torisetsu-contents', {}, ctx);
  applyAction(ts, 'torisetsu-chapter', { chapter: 'energy' }, ctx);
  assert.equal(ts.step, 'insight', 'a finished chapter reopens at "見つける"');
  applyAction(ts, 'torisetsu-pick', { kind: 'surprise', key: 'nonsense' }, ctx);
  assert.equal(ts.data.energy.surprise, 'g:do_talk', 'unknown keys are ignored');
});

test('the option labels used on screen are in DAY_CHIPS (smoke)', () => {
  assert.ok(DAY_CHIPS.length >= 29);
});

test('a successful v2 save also removes the v1 key (failed migration, then a later save)', () => {
  const storage = spyStorage({ [STORAGE_KEY_V1]: v1({ name: { name: 'ふるい', chips: [], text: '' } }) });
  assert.equal(saveTorisetsu(storage, savedData(), '2026-10-13').ok, true);
  assert.equal(storage.data.has(STORAGE_KEY), true);
  assert.equal(storage.data.has(STORAGE_KEY_V1), false);
  // v1 を消せない環境でも、v2 の保存は成功のまま
  const stuck = spyStorage({ [STORAGE_KEY_V1]: v1({}) });
  stuck.removeItem = () => { throw new Error('blocked'); };
  assert.equal(saveTorisetsu(stuck, savedData(), '2026-10-13').ok, true);
  assert.equal(stuck.data.has(STORAGE_KEY), true);
  // 保存に失敗したときは v1 に触らない
  const failing = spyStorage({ [STORAGE_KEY_V1]: v1({}) }, { throwOn: ['setItem'] });
  assert.equal(saveTorisetsu(failing, savedData(), '2026-10-13').ok, false);
  assert.equal(failing.data.has(STORAGE_KEY_V1), true);
});

test('torisetsu-save does nothing before a chapter is done and nothing was persisted', () => {
  const storage = spyStorage(); const ctx = makeCtx(storage);
  const ts = createTorisetsuState();
  ts.data.energy.prediction = ['do_talk'];
  const result = applyAction(ts, 'torisetsu-save', {}, ctx);
  assert.equal(result.render, false);
  assert.equal(ts.persisted, false);
  assert.equal(storage.calls.setItem, 0);
  assert.equal(storage.data.has(STORAGE_KEY), false);
  ts.data.energy.done = true; // 章が1つできたら保存できる
  applyAction(ts, 'torisetsu-save', {}, ctx);
  assert.equal(ts.persisted, true);
  assert.equal(storage.data.has(STORAGE_KEY), true);
});

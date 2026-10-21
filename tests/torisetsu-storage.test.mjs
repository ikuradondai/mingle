import assert from 'node:assert/strict';
import test from 'node:test';
import {
  STORAGE_KEY, STORAGE_KEY_V2, STORAGE_KEY_V1, loadTorisetsu, saveTorisetsu, clearTorisetsu, createTorisetsuState, applyAction, UNDO_MS, normalizeData, emptyData, hasAnyAnswer, SAVE_MAX_LENGTH, torisetsuView,
} from '../dist/torisetsu.js';
import { COPY } from '../dist/data/torisetsu-content.js';
import { spyStorage, makeCtx, runChapter } from './helpers/torisetsu-flow.mjs';
import * as A from './fixtures/torisetsu/v3-a-office.mjs';
import * as B from './fixtures/torisetsu/v3-b-student.mjs';
import * as Cx from './fixtures/torisetsu/v3-c-retired.mjs';

const runAll = (ts, ctx) => {
  runChapter(ts, ctx, 'needs', A.data, { surprise: A.data.surprise, experiment: A.data.experiment });
  runChapter(ts, ctx, 'voice', B.data, { surprise: B.data.surprise, experiment: B.data.experiment });
  runChapter(ts, ctx, 'values', Cx.data, { surprise: Cx.data.surprise, experiment: Cx.data.experiment });
};
const full = () => normalizeData({ name: 'のんびり号', needs: A.data, voice: B.data, values: Cx.data });
const oldV2 = (name = 'のんびり号') => JSON.stringify({ version: 2, savedAt: '2026-10-01', data: { name, energy: { prediction: ['do_eat'], good: [], bad: [] }, values: { neg: [], pos: [] }, others: { self: ['s_listen'], episodes: [] } } });
const oldV1 = (name = '昔の名前') => JSON.stringify({ version: 1, answers: { name: { name }, switch: { chips: ['eat'] } } });

test('nothing is written to storage unless the user opts in (all three chapters, through to try)', () => {
  const storage = spyStorage();
  const ctx = makeCtx(storage);
  const ts = createTorisetsuState();
  runAll(ts, ctx);
  applyAction(ts, 'torisetsu-manual', {}, ctx);
  applyAction(ts, 'torisetsu-decline', {}, ctx);
  assert.equal(ts.persisted, false);
  assert.equal(ts.data.needs.done && ts.data.voice.done && ts.data.values.done, true);
  assert.equal(storage.calls.setItem, 0);
  assert.equal(storage.data.size, 0);
});

test('saving is refused until one chapter is finished', () => {
  const storage = spyStorage();
  const ctx = makeCtx(storage);
  const ts = createTorisetsuState();
  applyAction(ts, 'torisetsu-save', {}, ctx);
  assert.equal(ts.persisted, false); assert.equal(storage.calls.setItem, 0);
  runChapter(ts, ctx, 'needs', A.data, { stopAt: 'insight' });
  applyAction(ts, 'torisetsu-save', {}, ctx);
  assert.equal(storage.calls.setItem, 0, 'answers alone are not enough: a finished chapter is');
  runChapter(ts, ctx, 'needs', A.data);
  applyAction(ts, 'torisetsu-save', {}, ctx);
  assert.equal(storage.calls.setItem, 1);
});

test('opting in writes only mingle.torisetsu.v3, with the documented shape, and autosaves afterwards', () => {
  const storage = spyStorage();
  const ctx = makeCtx(storage);
  const ts = createTorisetsuState();
  runChapter(ts, ctx, 'needs', A.data, { surprise: A.data.surprise, experiment: A.data.experiment });
  assert.equal(storage.calls.setItem, 0, 'answers alone are not saved');
  applyAction(ts, 'torisetsu-save', {}, ctx);
  assert.deepEqual([...storage.data.keys()], [STORAGE_KEY]);
  assert.equal(STORAGE_KEY, 'mingle.torisetsu.v3');
  const saved = JSON.parse(storage.data.get(STORAGE_KEY));
  assert.deepEqual(Object.keys(saved), ['version', 'savedAt', 'data']);
  assert.equal(saved.version, 3); assert.equal(saved.savedAt, '2026-10-13');
  assert.deepEqual(Object.keys(saved.data), ['name', 'needs', 'voice', 'values']);
  assert.deepEqual(Object.keys(saved.data.needs), ['prediction', 'predictionText', 'happy', 'hard', 'surprise', 'surpriseText', 'experiment', 'experimentText', 'done']);
  assert.deepEqual(Object.keys(saved.data.voice), ['episodes', 'focus', 'intents', 'intentsText', 'reply', 'replyText', 'surprise', 'surpriseText', 'experiment', 'experimentText', 'done']);
  assert.deepEqual(Object.keys(saved.data.values), ['prediction', 'predictionText', 'neg', 'pos', 'admire', 'surprise', 'surpriseText', 'experiment', 'experimentText', 'done']);
  assert.deepEqual(saved.data.needs.happy[0], { scene: 'sc_friend', memo: '久しぶりに友だちと長電話', feelings: ['hf_relief'], needs: ['nd_understood', 'nd_belong'] });
  assert.deepEqual(saved.data.needs.hard[0], { scene: 'sc_work', memo: '会議で意見を流された', surface: 'sf_irritated', deep: ['dp_uncared', 'dp_anxious'], needs: ['nd_understood'] });
  assert.equal(saved.data.needs.surprise, 'x:nd_understood'); assert.equal(saved.data.needs.done, true);
  assert.doesNotMatch(storage.data.get(STORAGE_KEY), /今回の答えでは|ありました|わかってほしかった/, 'no sentences or labels, only ids and the free text');
  const writes = storage.calls.setItem;
  runChapter(ts, ctx, 'values', Cx.data);
  assert.ok(storage.calls.setItem > writes, 'autosave after opt-in');
  assert.equal(JSON.parse(storage.data.get(STORAGE_KEY)).data.values.neg.length, 2);
  assert.equal(JSON.parse(storage.data.get(STORAGE_KEY)).data.values.admire.qualities[0].value, 'vl_respect');
});

test('round trip: what is saved loads back the same', () => {
  const storage = spyStorage();
  const data = full();
  assert.equal(saveTorisetsu(storage, data, '2026-10-13').ok, true);
  const loaded = loadTorisetsu(storage, { today: '2026-10-13' });
  assert.deepEqual(loaded.data, data); assert.equal(loaded.persisted, true); assert.equal(loaded.savedAt, '2026-10-13'); assert.equal(loaded.notice, '');
});

test('the largest possible answer set stays under 10KB and under the save limit', () => {
  const memo = 'あ'.repeat(30);
  const eps = (n, extra) => Array.from({ length: n }, () => ({ scene: 'sc_work', memo, ...extra }));
  const data = normalizeData({
    name: 'あ'.repeat(12),
    needs: { prediction: ['nd_choose'], happy: eps(3, { feelings: ['hf_glad', 'hf_relief'], needs: ['nd_understood', 'nd_belong'] }), hard: eps(5, { surface: 'sf_irritated', deep: ['dp_anxious', 'dp_full'], needs: ['nd_understood', 'nd_rest'] }), surprise: 'x:nd_understood', surpriseText: memo, experiment: 'again', experimentText: memo, done: true },
    voice: { episodes: eps(5, { thoughts: ['th_nogood', 'th_others'] }), focus: 'pt_blame', intents: ['in_fail', 'in_shame'], reply: '', replyText: memo, done: true, surpriseText: memo, experimentText: memo },
    values: { prediction: ['vl_kind'], neg: eps(3, { situation: 'sn_mean' }), pos: eps(3, { situation: 'sp_respect' }), admire: { who: 'aw_near', qualities: [{ id: 'ql_respect' }, { id: 'ql_free' }], memo }, done: true, surpriseText: memo, experimentText: memo },
  });
  assert.equal(data.needs.hard.length, 5); assert.equal(data.voice.episodes.length, 5);
  const text = JSON.stringify({ version: 3, savedAt: '2026-10-13', data });
  assert.ok(text.length < 10000, `${text.length}`);
  assert.ok(text.length < SAVE_MAX_LENGTH);
  assert.equal(saveTorisetsu(spyStorage(), data, '2026-10-13').ok, true);
});

test('loading discards broken, wrong-version and empty saves; unknown ids and extra items are cleaned', () => {
  for (const raw of ['{broken', JSON.stringify({ version: 2, data: {} }), JSON.stringify({ version: 3 }), JSON.stringify({ version: 3, data: [] }), JSON.stringify({ version: 3, data: emptyData() }), 'null', '[]']) {
    const storage = spyStorage({ [STORAGE_KEY]: raw });
    assert.equal(loadTorisetsu(storage, { today: '2026-10-13' }), null, raw);
    assert.equal(storage.data.has(STORAGE_KEY), false, `discarded: ${raw}`);
  }
  const messy = JSON.stringify({ version: 3, savedAt: 'ひどい日付', data: {
    name: '  ながすぎるなまえがあるよ１２３４５６７  ',
    needs: {
      prediction: ['nd_choose', 'nd_rest', 'zzz'],
      happy: [{ scene: 'sc_friend', memo: 'x'.repeat(100), feelings: ['hf_glad', 'hf_glad', 'hf_relief', 'hf_warm', 'bogus'], needs: ['nd_belong', 'nd_belong'] }, { feelings: [] }, 5, null],
      hard: Array.from({ length: 8 }, (_, i) => ({ scene: 'sc_work', memo: `m${i}`, surface: 'sf_down', deep: ['dp_sad', 'nope', 'dp_lonely', 'dp_empty'], needs: ['nd_safe'] })),
      surprise: 'Bad Key!', experiment: 'try:nd_safe', done: 'yes',
    },
    voice: { episodes: [{ thoughts: [] }, { thoughts: ['th_nogood', 'th_myfault', 'th_end'], memo: '　\n改行　' }, { scene: 'sc_x', thoughts: ['th_nobody'] }], focus: 'pt_unknown', intents: ['in_fail', 'in_fail', 'in_shame', 'in_stop'], reply: 'rp_any1', replyText: '自分の言葉' },
    values: { neg: [{ situation: 'sp_honest' }, { situation: 'sn_lie', value: 'vl_unknown' }, { situation: 'sn_lie', value: 'vl_fair' }], pos: [], admire: { who: 'aw_x', qualities: [{ id: 'ql_kind', value: 'zzz' }, { id: 'ql_kind' }, { id: 'ql_calm' }, { id: 'ql_try' }] } },
  } });
  const storage = spyStorage({ [STORAGE_KEY]: messy });
  const loaded = loadTorisetsu(storage, { today: '2026-10-13' });
  assert.equal(loaded.savedAt, '');
  const d = loaded.data;
  assert.equal(Array.from(d.name).length, 12);
  assert.deepEqual(d.needs.prediction, ['nd_choose']);
  assert.equal(d.needs.happy.length, 1, 'an answer with nothing in it is dropped'); assert.deepEqual(d.needs.happy[0].feelings, ['hf_glad', 'hf_relief']); assert.deepEqual(d.needs.happy[0].needs, ['nd_belong']);
  assert.equal(Array.from(d.needs.happy[0].memo).length, 30);
  assert.equal(d.needs.hard.length, 5); assert.deepEqual(d.needs.hard[0].deep, ['dp_sad', 'dp_lonely']);
  assert.equal(d.needs.surprise, ''); assert.equal(d.needs.experiment, 'try:nd_safe'); assert.equal(d.needs.done, false);
  assert.equal(d.voice.episodes.length, 2); assert.deepEqual(d.voice.episodes[0].thoughts, ['th_nogood', 'th_myfault']); assert.equal(d.voice.episodes[0].memo, '改行');
  assert.equal(d.voice.episodes[1].scene, '');
  assert.equal(d.voice.focus, ''); assert.deepEqual(d.voice.intents, ['in_fail', 'in_shame']);
  assert.equal(d.voice.reply, '', 'a written reply replaces a chosen one'); assert.equal(d.voice.replyText, '自分の言葉');
  assert.equal(d.values.neg.length, 2); assert.equal(d.values.neg[0].value, 'vl_honest', 'unknown value falls back to the situation default');
  assert.equal(d.values.neg[1].value, 'vl_fair');
  assert.equal(d.values.admire.who, ''); assert.deepEqual(d.values.admire.qualities, [{ id: 'ql_kind', value: 'vl_kind' }, { id: 'ql_calm', value: 'vl_calm' }]);
  assert.equal(JSON.stringify(d).includes('x'.repeat(31)), false);
});

test('migration: from v2 only the product name is carried over; the old keys are removed; the notice appears once', () => {
  const storage = spyStorage({ [STORAGE_KEY_V2]: oldV2(), [STORAGE_KEY_V1]: oldV1() });
  const loaded = loadTorisetsu(storage, { today: '2026-10-13' });
  assert.equal(loaded.data.name, 'のんびり号');
  assert.deepEqual({ ...loaded.data, name: '' }, { ...emptyData(), name: '' }, 'nothing else survives');
  assert.equal(loaded.persisted, true); assert.equal(loaded.savedAt, '2026-10-13');
  assert.equal(loaded.notice, 'トリセツの作り方が新しくなりました。前のトリセツから『製品名』だけ引き継ぎました。ほかは、新しい作り方で書いてね。');
  assert.deepEqual([...storage.data.keys()], [STORAGE_KEY]);
  assert.equal(JSON.parse(storage.data.get(STORAGE_KEY)).data.name, 'のんびり号');
  // 2 回目以降は案内なし
  const again = loadTorisetsu(storage, { today: '2026-10-14' });
  assert.equal(again.notice, ''); assert.equal(again.data.name, 'のんびり号');
  const ts = createTorisetsuState({ stored: loaded });
  const html = torisetsuView(ts, { esc: String, today: '2026-10-13' });
  assert.ok(html.includes(loaded.notice), 'the start screen shows the notice');
  applyAction(ts, 'torisetsu-begin', {}, makeCtx(storage));
  assert.equal(ts.notice, '', 'the notice is not kept');
});

test('migration: from v1 only the name; nothing carried → old keys removed and the other notice', () => {
  const storage = spyStorage({ [STORAGE_KEY_V1]: oldV1('ひとつ前') });
  const loaded = loadTorisetsu(storage, { today: '2026-10-13' });
  assert.equal(loaded.data.name, 'ひとつ前'); assert.equal(loaded.persisted, true);
  assert.deepEqual([...storage.data.keys()], [STORAGE_KEY]);
  const none = spyStorage({ [STORAGE_KEY_V2]: oldV2('') });
  const result = loadTorisetsu(none, { today: '2026-10-13' });
  assert.equal(result.notice, COPY.noticeDiscarded);
  assert.equal(result.notice, 'トリセツの作り方が新しくなりました。前のトリセツの答えは新しい作り方では使えないため、この端末から消しました。');
  assert.equal(hasAnyAnswer(result.data), false); assert.equal(result.persisted, false);
  assert.equal(none.data.size, 0); assert.equal(none.calls.setItem, 0);
});

test('migration: a broken v2 is removed quietly; a failing v3 write keeps the old keys and works in memory', () => {
  const broken = spyStorage({ [STORAGE_KEY_V2]: '{oops' });
  assert.equal(loadTorisetsu(broken, { today: '2026-10-13' }), null);
  assert.equal(broken.data.size, 0);
  const failing = spyStorage({ [STORAGE_KEY_V2]: oldV2() }, { throwOn: ['setItem'] });
  const loaded = loadTorisetsu(failing, { today: '2026-10-13' });
  assert.equal(loaded.data.name, 'のんびり号'); assert.equal(loaded.persisted, false); assert.equal(loaded.savedAt, '');
  assert.equal(loaded.notice, COPY.noticeMigrated);
  assert.equal(failing.data.has(STORAGE_KEY_V2), true, 'the old save stays so the next visit can try again');
  const ts = createTorisetsuState({ stored: loaded });
  assert.equal(ts.persisted, false); assert.equal(ts.data.name, 'のんびり号');
});

test('a v3 save is read without looking at v2 / v1', () => {
  const storage = spyStorage({ [STORAGE_KEY]: JSON.stringify({ version: 3, savedAt: '2026-10-12', data: full() }), [STORAGE_KEY_V2]: oldV2('ちがう名前') });
  const loaded = loadTorisetsu(storage, { today: '2026-10-13' });
  assert.equal(loaded.data.name, 'のんびり号'); assert.equal(loaded.notice, '');
  assert.equal(storage.calls.getItem, 1); assert.equal(storage.data.has(STORAGE_KEY_V2), true);
});

test('storage that throws never breaks loading, saving or clearing', () => {
  assert.equal(loadTorisetsu(spyStorage({}, { throwOn: ['getItem'] }), { today: '2026-10-13' }), null);
  assert.equal(loadTorisetsu(() => { throw new Error('denied'); }), null);
  assert.equal(loadTorisetsu(null), null);
  assert.equal(saveTorisetsu(spyStorage({}, { throwOn: ['setItem'] }), full(), '2026-10-13').ok, false);
  assert.equal(saveTorisetsu(null, full(), '2026-10-13').ok, false);
  assert.doesNotThrow(() => clearTorisetsu(spyStorage({}, { throwOn: ['removeItem'] })));
  assert.equal(clearTorisetsu(spyStorage({}, { throwOn: ['removeItem'] })).ok, false);
  const ts = createTorisetsuState();
  const ctx = makeCtx(spyStorage({}, { throwOn: ['setItem'] }));
  runChapter(ts, ctx, 'needs', A.data);
  applyAction(ts, 'torisetsu-save', {}, ctx);
  assert.equal(ts.persisted, false); assert.equal(ts.saveError, COPY.saveFailed);
  assert.ok(torisetsuView(ts, { esc: String, today: '2026-10-13' }).includes(COPY.saveFailed));
});

test('a failing autosave turns persistence off and shows the message', () => {
  const storage = spyStorage();
  const ctx = makeCtx(storage);
  const ts = createTorisetsuState();
  runChapter(ts, ctx, 'needs', A.data);
  applyAction(ts, 'torisetsu-save', {}, ctx);
  assert.equal(ts.persisted, true);
  const failing = makeCtx(spyStorage({}, { throwOn: ['setItem'] }));
  runChapter(ts, failing, 'voice', B.data);
  assert.equal(ts.persisted, false); assert.equal(ts.saveError, COPY.saveFailed);
});

test('delete removes v3, v2 and v1; it works even when removeItem throws; undo is memory only and lasts 5 seconds', () => {
  const storage = spyStorage({ [STORAGE_KEY_V2]: oldV2(), [STORAGE_KEY_V1]: oldV1() });
  let now = 1_000_000;
  const ctx = makeCtx(storage, { now: () => now });
  const ts = createTorisetsuState();
  runChapter(ts, ctx, 'needs', A.data);
  applyAction(ts, 'torisetsu-save', {}, ctx);
  storage.data.set(STORAGE_KEY_V2, oldV2()); storage.data.set(STORAGE_KEY_V1, oldV1());
  const result = applyAction(ts, 'torisetsu-delete', {}, ctx);
  assert.equal(result.undoTimer, UNDO_MS);
  assert.equal(storage.data.size, 0, 'all three keys are gone');
  assert.equal(ts.persisted, false); assert.equal(hasAnyAnswer(ts.data), false); assert.equal(ts.view, 'start');
  const writes = storage.calls.setItem;
  now += 1000;
  applyAction(ts, 'torisetsu-undo', {}, ctx);
  assert.equal(ts.data.needs.hard.length, 3, 'restored');
  assert.equal(storage.calls.setItem, writes, 'undo writes nothing to the device'); assert.equal(storage.data.size, 0); assert.equal(ts.persisted, false);
  // 5 秒を過ぎたら戻せない
  applyAction(ts, 'torisetsu-save', {}, ctx);
  applyAction(ts, 'torisetsu-delete', {}, ctx);
  now += UNDO_MS + 1;
  applyAction(ts, 'torisetsu-undo', {}, ctx);
  assert.equal(hasAnyAnswer(ts.data), false);
  assert.equal(ts.undo, null);
  // removeItem が投げても、画面上は消えた扱い
  const bad = spyStorage({}, { throwOn: ['removeItem'] });
  const ts2 = createTorisetsuState({ stored: { data: full(), persisted: true, savedAt: '2026-10-13' } });
  assert.doesNotThrow(() => applyAction(ts2, 'torisetsu-delete', {}, makeCtx(bad)));
  assert.equal(hasAnyAnswer(ts2.data), false); assert.equal(ts2.persisted, false);
});

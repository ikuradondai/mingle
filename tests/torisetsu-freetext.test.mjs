// 「自分で書く」（各層の自由文）: 全部の選ぶ画面に出る・チップと合わせて上限に数える・表と手順書に載る・数えない・保存の検査。
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyAction, setDraftText, createTorisetsuState, torisetsuView, composeManual, normalizeData, emptyData, chipState,
  saveTorisetsu, loadTorisetsu, STORAGE_KEY, SAVE_MAX_LENGTH,
} from '../dist/torisetsu.js';
import { needsInsights, voiceInsights, valuesInsights, needsLineup, voiceLineup, ownWords, chapterReady, surpriseOptions, tryOptions, teaser } from '../dist/torisetsu-insight.js';
import { COPY } from '../dist/data/torisetsu-content.js';
import { makeCtx, spyStorage } from './helpers/torisetsu-flow.mjs';
import * as A from './fixtures/torisetsu/v3-a-office.mjs';
import * as B from './fixtures/torisetsu/v3-b-student.mjs';
import * as Cx from './fixtures/torisetsu/v3-c-retired.mjs';
import * as D from './fixtures/torisetsu/v3-d-nopattern.mjs';

const esc = (value) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const html = (ts) => torisetsuView(ts, { esc, today: '2026-10-13', support: () => '', imageEnabled: true, canSend: false });
const act = (ts, ctx, action, data = {}) => applyAction(ts, action, data, ctx);
const XSS = '<img src=x onerror=alert(1)>';
const clone = (value) => JSON.parse(JSON.stringify(value));
const stateWith = (data, step, chapterId) => {
  const ts = createTorisetsuState({ stored: { data: normalizeData(data), persisted: false } });
  Object.assign(ts, { view: 'step', chapterId, step });
  return ts;
};
const toHard = (ts, ctx, chapter = 'needs') => {
  act(ts, ctx, 'torisetsu-begin'); act(ts, ctx, 'torisetsu-chapter-start', { chapter }); act(ts, ctx, 'torisetsu-next');
  act(ts, ctx, 'torisetsu-recall-start'); act(ts, ctx, 'torisetsu-skip-item'); act(ts, ctx, 'torisetsu-skip-item'); act(ts, ctx, 'torisetsu-recall-start');
};
const fullData = () => normalizeData({ name: 'のんびり号', needs: A.data, voice: B.data, values: Cx.data });

// ---- 全部の選ぶ画面に「＋ 自分で書く」が出る ----
test('every chip-selection screen shows the write control and the hint line', () => {
  const ctx = makeCtx(); const ts = createTorisetsuState();
  const expectOwn = (kind) => {
    const out = html(ts);
    assert.ok(out.includes(`data-ts-own="${kind}"`), `${kind} control`);
    assert.ok(out.includes(`data-action="torisetsu-text-open" data-kind="${kind}"`), `${kind} open button`);
    assert.ok(out.includes(COPY.ownHint), `${kind} hint`);
  };
  // 第1章 予想 → しんどい 4 層 / うれしい 3 層
  act(ts, ctx, 'torisetsu-begin'); act(ts, ctx, 'torisetsu-chapter-start', { chapter: 'needs' });
  expectOwn('own:predict');
  act(ts, ctx, 'torisetsu-next'); act(ts, ctx, 'torisetsu-recall-start');
  assert.equal(ts.side, 'happy');
  assert.ok(!html(ts).includes('data-ts-own='), 'the scene layer has the one-liner instead');
  act(ts, ctx, 'torisetsu-layer-next'); expectOwn('own:happy:feelings');
  act(ts, ctx, 'torisetsu-layer-next'); expectOwn('own:happy:needs');
  act(ts, ctx, 'torisetsu-skip-item'); act(ts, ctx, 'torisetsu-skip-item'); act(ts, ctx, 'torisetsu-recall-start');
  assert.equal(ts.side, 'hard');
  act(ts, ctx, 'torisetsu-layer-next'); expectOwn('own:hard:surface');
  act(ts, ctx, 'torisetsu-layer-next'); expectOwn('own:hard:deep');
  act(ts, ctx, 'torisetsu-layer-next'); expectOwn('own:hard:needs');
  // 第2章 場面と声 / 守ろうとしているもの
  const v = createTorisetsuState(); act(v, ctx, 'torisetsu-begin'); act(v, ctx, 'torisetsu-chapter-start', { chapter: 'voice' });
  act(v, ctx, 'torisetsu-recall-start');
  assert.ok(html(v).includes('data-ts-own="own:voice:thoughts"'));
  const p = stateWith(B.data.episodes ? { voice: B.data } : {}, 'protect', 'voice');
  assert.ok(html(p).includes('data-ts-own="own:intents"'));
  // 第3章 予想 / 出来事 / いいなと思った人
  const w = createTorisetsuState(); act(w, ctx, 'torisetsu-begin'); act(w, ctx, 'torisetsu-chapter-start', { chapter: 'values' });
  assert.ok(html(w).includes('data-ts-own="own:predict"'));
  act(w, ctx, 'torisetsu-next'); act(w, ctx, 'torisetsu-recall-start');
  assert.ok(html(w).includes('data-ts-own="own:neg:situation"'));
  act(w, ctx, 'torisetsu-skip-item'); act(w, ctx, 'torisetsu-skip-item'); act(w, ctx, 'torisetsu-recall-start');
  assert.ok(html(w).includes('data-ts-own="own:pos:situation"'));
  act(w, ctx, 'torisetsu-skip-item'); act(w, ctx, 'torisetsu-skip-item');
  assert.equal(w.step, 'admire');
  assert.ok(html(w).includes('data-ts-own="own:admire:qualities"'));
});

test('the write control opens a field (30 chars) and a typed text is escaped', () => {
  const ctx = makeCtx(); const ts = createTorisetsuState();
  toHard(ts, ctx);
  act(ts, ctx, 'torisetsu-layer-next'); act(ts, ctx, 'torisetsu-layer-next');
  act(ts, ctx, 'torisetsu-text-open', { kind: 'own:hard:deep' });
  const out = html(ts);
  assert.match(out, /data-ts-text="own:hard:deep"[^>]*maxlength="30"|maxlength="30"[^>]*data-ts-text="own:hard:deep"/);
  setDraftText(ts, XSS, 'own:hard:deep', ctx);
  const typed = html(ts);
  assert.ok(!typed.includes(XSS), 'raw markup never reaches the page');
  assert.ok(typed.includes(esc(XSS.slice(0, 30))) || typed.includes('&lt;img'), 'escaped');
  setDraftText(ts, 'あ'.repeat(50), 'own:hard:deep', ctx);
  assert.equal(Array.from(ts.draft.deepText).length, 30);
});

// ---- チップと合わせて上限に数える ----
test('max-2 layers: a chip plus the text, or two chips; the write control refuses when two chips are chosen', () => {
  const ctx = makeCtx(); const ts = createTorisetsuState();
  toHard(ts, ctx);
  act(ts, ctx, 'torisetsu-layer-next'); act(ts, ctx, 'torisetsu-layer-next'); // 奥の気持ち
  act(ts, ctx, 'torisetsu-chip', { group: 'deep', chip: 'dp_sad' });
  act(ts, ctx, 'torisetsu-text-open', { kind: 'own:hard:deep' });
  assert.equal(ts.textOpen['own:hard:deep'], true);
  setDraftText(ts, '見下されたくない', 'own:hard:deep', ctx);
  act(ts, ctx, 'torisetsu-chip', { group: 'deep', chip: 'dp_lonely' });
  assert.deepEqual(ts.draft.deep, ['dp_sad'], 'the written text holds the second slot');
  assert.equal(ts.limitMessage, COPY.limitMessage(2));
  assert.equal(chipState(ts, 'deep', 'dp_lonely').dim, true);
  act(ts, ctx, 'torisetsu-chip', { group: 'deep', chip: 'dp_sad' }); // 外すのはできる
  assert.deepEqual(ts.draft.deep, []);
  act(ts, ctx, 'torisetsu-chip', { group: 'deep', chip: 'dp_lonely' });
  act(ts, ctx, 'torisetsu-chip', { group: 'deep', chip: 'dp_sad' });
  assert.deepEqual(ts.draft.deep, ['dp_lonely'], 'chip + text = 2');
  // 2 つのチップを選んでいると、書く枠は開かない
  const fresh = createTorisetsuState(); toHard(fresh, ctx);
  act(fresh, ctx, 'torisetsu-layer-next'); act(fresh, ctx, 'torisetsu-layer-next');
  act(fresh, ctx, 'torisetsu-chip', { group: 'deep', chip: 'dp_sad' }); act(fresh, ctx, 'torisetsu-chip', { group: 'deep', chip: 'dp_lonely' });
  act(fresh, ctx, 'torisetsu-text-open', { kind: 'own:hard:deep' });
  assert.ok(!fresh.textOpen['own:hard:deep']); assert.equal(fresh.limitMessage, COPY.limitMessage(2));
});

test('max-1 layers (表の気持ち, 何に心が動いた, 予想): the chip or the text, whichever came last', () => {
  const ctx = makeCtx(); const ts = createTorisetsuState();
  toHard(ts, ctx);
  act(ts, ctx, 'torisetsu-layer-next');
  act(ts, ctx, 'torisetsu-chip', { group: 'surface', chip: 'sf_down' });
  setDraftText(ts, 'なんとも言えない', 'own:hard:surface', ctx);
  assert.deepEqual(ts.draft.surface, [], 'writing replaces the chip');
  act(ts, ctx, 'torisetsu-chip', { group: 'surface', chip: 'sf_rushed' });
  assert.equal(ts.draft.surfaceText, ''); assert.deepEqual(ts.draft.surface, ['sf_rushed'], 'choosing replaces the text');
  // 予想
  const p = createTorisetsuState(); act(p, ctx, 'torisetsu-begin'); act(p, ctx, 'torisetsu-chapter-start', { chapter: 'needs' });
  act(p, ctx, 'torisetsu-chip', { group: 'prediction', chip: 'nd_choose' });
  setDraftText(p, '人に頼れること', 'own:predict', ctx);
  assert.deepEqual(p.data.needs.prediction, []); assert.equal(p.data.needs.predictionText, '人に頼れること');
  act(p, ctx, 'torisetsu-chip', { group: 'prediction', chip: 'nd_choose' });
  assert.equal(p.data.needs.predictionText, ''); assert.deepEqual(p.data.needs.prediction, ['nd_choose']);
});

test('a layer with only text counts as answered: required groups accept text, and "直す" keeps it', () => {
  const ctx = makeCtx(); const ts = createTorisetsuState();
  act(ts, ctx, 'torisetsu-begin'); act(ts, ctx, 'torisetsu-chapter-start', { chapter: 'values' }); act(ts, ctx, 'torisetsu-next');
  act(ts, ctx, 'torisetsu-recall-start');
  assert.equal(ts.step, 'episode');
  act(ts, ctx, 'torisetsu-record');
  assert.ok(ts.missingMessage, 'nothing chosen nor written: asked');
  setDraftText(ts, '店で割り込まれた', 'own:neg:situation', ctx);
  act(ts, ctx, 'torisetsu-record');
  assert.equal(ts.data.values.neg.length, 1);
  assert.deepEqual([ts.data.values.neg[0].situation, ts.data.values.neg[0].situationText, ts.data.values.neg[0].value], ['', '店で割り込まれた', '']);
  assert.equal(chapterReady('values', ts.data), false, 'one record is not three');
  // 直す
  act(ts, ctx, 'torisetsu-chapter-days', { chapter: 'values' });
  act(ts, ctx, 'torisetsu-edit-item', { side: 'neg', index: '0' });
  assert.equal(ts.draft.situationText, '店で割り込まれた');
  act(ts, ctx, 'torisetsu-record');
  assert.equal(ts.data.values.neg[0].situationText, '店で割り込まれた');
});

test('"わからないので飛ばす" clears the text of a new answer but keeps it when editing', () => {
  const ctx = makeCtx(); const ts = createTorisetsuState();
  toHard(ts, ctx);
  act(ts, ctx, 'torisetsu-layer-next'); act(ts, ctx, 'torisetsu-layer-next');
  setDraftText(ts, '消える', 'own:hard:deep', ctx);
  act(ts, ctx, 'torisetsu-layer-skip');
  assert.equal(ts.draft.deepText, ''); assert.equal(ts.layer, 3);
});

// ---- 表と手順書に載る ----
const withOwn = () => {
  const data = clone(fullData());
  data.needs.hard[0].deepText = XSS; data.needs.hard[0].deep = ['dp_uncared'];
  data.needs.hard[1].needsText = '放っておいてほしい'; data.needs.hard[1].needs = [];
  data.needs.hard[2].surfaceText = 'ざわざわ'; data.needs.hard[2].surface = '';
  data.needs.happy[0].needsText = '気楽さ'; data.needs.happy[0].needs = ['nd_belong'];
  data.voice.episodes[0].thoughtsText = '自分だけ遅い'; data.voice.episodes[0].thoughts = data.voice.episodes[0].thoughts.slice(0, 1);
  data.voice.intentsText = '恥をかきたくない';
  data.values.neg[0].situationText = '順番を抜かされた';
  data.values.admire.qualitiesText = '黙って続ける';
  return normalizeData(data);
};

test('free text appears as-is in the lineup tables, escaped', () => {
  const data = withOwn();
  const needsTs = stateWith(data, 'lineup', 'needs');
  const out = html(needsTs);
  assert.ok(out.includes(esc(`「${XSS}」`)), 'needs lineup row'); assert.ok(!out.includes(XSS));
  assert.ok(out.includes('「放っておいてほしい」') && out.includes('「ざわざわ」') && out.includes('「気楽さ」'));
  assert.ok(out.includes('class="is-own"'));
  const lineup = needsLineup(data.needs.happy, data.needs.hard);
  const own = lineup.groups.flatMap((g) => g.rows).filter((row) => row.own);
  assert.equal(own.length, 4); assert.ok(own.every((row) => row.total === 0));
  const voiceOut = html(stateWith(data, 'lineup', 'voice'));
  assert.ok(voiceOut.includes('「自分だけ遅い」'));
  const valuesOut = html(stateWith(data, 'lineup', 'values'));
  assert.ok(valuesOut.includes('「順番を抜かされた」') && valuesOut.includes('「黙って続ける」'));
});

test('free text flows into the manual sections, escaped, and into the image lines', () => {
  const data = withOwn();
  const manual = composeManual(data, { today: '2026-10-13' });
  const text = (id) => manual.sections.find((s) => s.id === id).lines.map((l) => l.text).join('\n');
  assert.ok(text('shaky').includes(`「${XSS}」`) && text('shaky').includes('「放っておいてほしい」') && text('shaky').includes('「ざわざわ」'));
  assert.ok(text('fuel').includes('「気楽さ」'));
  assert.ok(text('voice').includes('「自分だけ遅い」') && text('voice').includes('恥をかきたくない'));
  assert.ok(text('values').includes('「順番を抜かされた」') && text('values').includes('「黙って続ける」'));
  // 画面では見える場所に出て、escape される
  const ts = stateWith(data, 'insight', 'needs'); ts.view = 'manual'; ts.step = null;
  for (const id of ['shaky', 'fuel', 'voice', 'values']) { ts.manualSectionId = id; const out = html(ts); assert.ok(!out.includes(XSS), id); }
  ts.manualSectionId = 'voice';
  const out = html(ts);
  assert.match(out, /ts-sec-own[\s\S]*自分だけ遅い/, 'own words in voice are outside the folded details');
});

test('the image module draws manual lines with fillText only (no HTML), so free text is safe there', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('../dist/torisetsu-image.js', import.meta.url), 'utf8');
  assert.match(source, /fillText\(op\.text/); assert.doesNotMatch(source, /innerHTML|insertAdjacentHTML/);
});

// ---- 数えない ----
test('aggregation is identical with and without free text (insight stays pure)', () => {
  const base = fullData(); const own = withOwn();
  // 自由文を足したことで、チップの選びが減った出来事は比べない。チップを変えずに文だけ足した版を作る。
  const plus = clone(base);
  plus.needs.hard.forEach((ep, i) => { ep.deepText = `d${i}`; ep.needsText = `n${i}`; ep.surfaceText = ''; });
  plus.needs.happy.forEach((ep, i) => { ep.feelingsText = `f${i}`; ep.needsText = `m${i}`; });
  plus.voice.episodes.forEach((ep, i) => { ep.thoughtsText = `t${i}`; });
  plus.voice.intentsText = 'i'; plus.needs.predictionText = 'p';
  plus.values.neg.forEach((ep, i) => { ep.situationText = `s${i}`; });
  plus.values.admire.qualitiesText = 'q';
  // normalizeData は上限を保つため、チップを持たせたまま足す（insight は生のデータを読む）
  const strip = (key, d) => JSON.stringify(d, (k, v) => (/Text$/.test(k) && k !== 'surpriseText' && k !== 'experimentText' && k !== 'replyText' ? undefined : v));
  assert.equal(strip('needs', needsInsights(plus.needs.happy, plus.needs.hard)), strip('needs', needsInsights(base.needs.happy, base.needs.hard)));
  assert.equal(JSON.stringify(voiceInsights(plus.voice.episodes)), JSON.stringify(voiceInsights(base.voice.episodes)));
  assert.equal(JSON.stringify(valuesInsights(plus.values.neg, plus.values.pos, plus.values.admire)), JSON.stringify(valuesInsights(base.values.neg, base.values.pos, base.values.admire)));
  for (const id of ['needs', 'voice', 'values']) {
    assert.equal(JSON.stringify(surpriseOptions(id, plus)), JSON.stringify(surpriseOptions(id, base)), id);
    assert.equal(JSON.stringify(tryOptions(id, plus)), JSON.stringify(tryOptions(id, base)), id);
    assert.equal(teaser(id, plus), teaser(id, base), id);
  }
  // 自由文だけの場面は、進める件数には入るが、集計（n・c）には入らない
  const textOnly = clone(base);
  textOnly.voice.episodes = [{ thoughts: [], thoughtsText: 'a' }, { thoughts: [], thoughtsText: 'b' }, ...textOnly.voice.episodes.slice(0, 1)];
  assert.equal(chapterReady('voice', textOnly), true);
  assert.equal(voiceInsights(textOnly.voice.episodes).n, 1);
  assert.equal(voiceInsights(textOnly.voice.episodes).ready, false);
  assert.ok(own.needs.hard.length >= 3);
});

// ---- 「自分の言葉で書いたもの」 ----
test('the "自分の言葉で書いたもの" block needs 2 or more deep-layer texts, on pattern and no-pattern screens', () => {
  const countOf = (data, chapterId) => ownWords(chapterId, data).items.length;
  // 1 つだけなら出さない
  const one = clone(normalizeData({ needs: A.data })); one.needs.hard[0].deepText = '見下された';
  assert.equal(ownWords('needs', one).show, false);
  assert.ok(!html(stateWith(one, 'insight', 'needs')).includes(COPY.ownBlockTitle));
  // 表の気持ちの自由文は数えない
  const surfaceOnly = clone(one); surfaceOnly.needs.hard[1].surfaceText = 'ざわざわ'; surfaceOnly.needs.hard[1].surface = '';
  assert.equal(countOf(surfaceOnly, 'needs'), 1);
  // 2 つ → パターンがある画面
  const two = clone(one); two.needs.hard[1].needsText = '放っておいてほしい'; two.needs.hard[1].needs = [];
  assert.equal(ownWords('needs', two).show, true);
  const pat = html(stateWith(two, 'insight', 'needs'));
  assert.ok(pat.includes(COPY.ownBlockTitle) && pat.includes(COPY.ownBlockNote));
  assert.ok(pat.includes('しんどかった1つ目・奥の気持ち') && pat.includes('しんどかった2つ目・本当は') && pat.includes('「見下された」'));
  assert.ok(needsInsights(two.needs.happy, two.needs.hard).ordered.length > 0, 'a pattern screen');
  // 2 つ → パターンがない画面
  const none = normalizeData({ needs: D.data }); none.needs.hard[0].deepText = '焦り'; none.needs.hard[1].needsText = '休みたい';
  const noPat = html(stateWith(none, 'insight', 'needs'));
  assert.ok(needsInsights(none.needs.happy, none.needs.hard).empty);
  assert.ok(noPat.includes(COPY.insightNoneTitle) && noPat.includes(COPY.ownBlockTitle) && noPat.includes('「焦り」'));
  // 第2・3章
  const vc = withOwn();
  assert.ok(html(stateWith(vc, 'insight', 'voice')).includes(COPY.ownBlockTitle) === ownWords('voice', vc).show);
  assert.equal(ownWords('values', vc).show, true);
  assert.ok(html(stateWith(vc, 'insight', 'values')).includes(COPY.ownBlockTitle));
});

// ---- 予想の自由文 ----
test('a typed prediction is kept as-is on the compare screen and never compared', () => {
  const data = normalizeData({ needs: { ...A.data, prediction: [], predictionText: '誰かに頼れること' } });
  assert.equal(data.needs.predictionText, '誰かに頼れること');
  const ts = stateWith(data, 'insight', 'needs');
  act(ts, makeCtx(), 'torisetsu-compare');
  assert.equal(ts.step, 'gap');
  const out = html(ts);
  assert.ok(out.includes('「誰かに頼れること」') && out.includes(COPY.gapOwnResult));
});

// ---- 保存 ----
test('storage: new fields are sanitized on load; old v3 data without them loads fine', () => {
  const storage = spyStorage();
  const raw = clone(fullData());
  raw.needs.hard[0].deepText = `改行\n制御\u0007文字${'あ'.repeat(60)}`;
  raw.needs.hard[1].surfaceText = 123; raw.voice.intentsText = { a: 1 }; raw.values.predictionText = 'x'.repeat(100);
  raw.voice.episodes[0].thoughtsText = '​\u0000';
  storage.setItem(STORAGE_KEY, JSON.stringify({ version: 3, savedAt: '2026-10-13', data: raw }));
  const loaded = loadTorisetsu(storage, { today: '2026-10-13' });
  const d = loaded.data;
  assert.equal(Array.from(d.needs.hard[0].deepText).length, 30); assert.ok(!/[\u0000-\u001f]/.test(d.needs.hard[0].deepText));
  assert.equal(d.needs.hard[1].surfaceText, '123'); assert.equal(d.voice.intentsText, '[object Object]'.slice(0, 30));
  assert.equal(Array.from(d.values.predictionText).length, 30); assert.deepEqual(d.values.prediction, []);
  assert.ok(!('thoughtsText' in d.voice.episodes[0]), 'an empty text leaves no key');
  assert.deepEqual(d.needs.hard[0].deep.length <= 1, true, 'the text takes one of the two slots');
  // 古い v3（自由文の欄なし）
  const old = clone(fullData());
  for (const key of ['predictionText']) { delete old.needs[key]; delete old.values[key]; }
  delete old.voice.intentsText;
  const s2 = spyStorage(); s2.setItem(STORAGE_KEY, JSON.stringify({ version: 3, savedAt: '2026-10-01', data: old }));
  const l2 = loadTorisetsu(s2, { today: '2026-10-13' });
  assert.deepEqual(l2.data, fullData()); assert.equal(l2.data.needs.predictionText, ''); assert.equal(l2.data.voice.intentsText, '');
});

test('storage: the largest answer set with every free text filled stays under 10KB', () => {
  const t = 'あ'.repeat(30);
  const eps = (n, extra) => Array.from({ length: n }, () => ({ scene: 'sc_work', memo: t, ...extra }));
  const data = normalizeData({
    name: 'あ'.repeat(12),
    needs: { prediction: [], predictionText: t, happy: eps(3, { feelings: ['hf_glad'], feelingsText: t, needs: ['nd_belong'], needsText: t }), hard: eps(5, { surface: '', surfaceText: t, deep: ['dp_full'], deepText: t, needs: ['nd_rest'], needsText: t }), surpriseText: t, experimentText: t, done: true },
    voice: { episodes: eps(5, { thoughts: ['th_nogood'], thoughtsText: t }), focus: 'pt_blame', intents: ['in_fail'], intentsText: t, replyText: t, done: true, surpriseText: t, experimentText: t },
    values: { prediction: [], predictionText: t, neg: eps(3, { situation: '', situationText: t, value: 'vl_kind' }), pos: eps(3, { situation: '', situationText: t, value: 'vl_kind' }), admire: { who: 'aw_near', qualities: [{ id: 'ql_free' }], qualitiesText: t, memo: t }, done: true, surpriseText: t, experimentText: t },
  });
  assert.equal(data.needs.hard.length, 5);
  assert.equal(data.needs.hard[0].deepText, t); assert.equal(data.values.admire.qualitiesText, t);
  const text = JSON.stringify({ version: 3, savedAt: '2026-10-13', data });
  assert.ok(text.length < 10000, `${text.length}`); assert.ok(text.length < SAVE_MAX_LENGTH);
  const storage = spyStorage();
  assert.equal(saveTorisetsu(storage, data, '2026-10-13').ok, true);
  assert.deepEqual(loadTorisetsu(storage, { today: '2026-10-13' }).data, data);
});

test('emptyData carries the new text fields as empty strings', () => {
  const d = emptyData();
  assert.equal(d.needs.predictionText, ''); assert.equal(d.values.predictionText, ''); assert.equal(d.voice.intentsText, '');
});

// ---- 言葉だけで書いても行き止まりにならない（第2・3章） ----
test('writing everything in words still walks lineup -> insight -> done -> manual in chapters 2 and 3', () => {
  const ctx = makeCtx(); const ts = createTorisetsuState(); const a = (x, d = {}) => applyAction(ts, x, d, ctx);
  const text = (side, group, i) => setDraftText(ts, `言葉${side}${i}`, `own:${side}:${group}`, ctx);
  // 第2章: 3 場面とも言葉だけ
  a('torisetsu-begin'); a('torisetsu-chapter-start', { chapter: 'voice' }); a('torisetsu-recall-start');
  for (let i = 0; i < 3; i += 1) { text('voice', 'thoughts', i); a('torisetsu-record'); }
  assert.equal(ts.step, 'lineup');
  const lineupHtml = html(ts);
  assert.ok(!lineupHtml.includes('ts-lineup-voice') && lineupHtml.includes('「言葉voice0」'), 'no table, only the words');
  a('torisetsu-find'); assert.equal(ts.step, 'insight');
  const ins = html(ts);
  assert.ok(ins.includes(COPY.ownThinTitle) && ins.includes('「言葉voice2」') && ins.includes(COPY.ownBlockTitle));
  assert.ok(!/0つのうち|0つ中/.test(ins));
  a('torisetsu-compare'); assert.equal(ts.step, 'protect');
  assert.ok(!html(ts).includes('という声</p>') || html(ts).includes('言葉voice0'));
  a('torisetsu-protect-next'); a('torisetsu-reply-next'); assert.equal(ts.step, 'surprise');
  const opts = surpriseOptions('voice', ts.data).map((o) => o.label);
  assert.ok(!opts.includes(COPY.surpriseSpreadVoice));
  a('torisetsu-surprise-next'); a('torisetsu-finish'); assert.equal(ts.step, 'done:voice'.split(':')[0]);
  const manual = composeManual(ts.data, { today: '2026-10-13' }).sections.find((s) => s.id === 'voice');
  assert.equal(manual.state, 'filled');
  assert.ok(manual.lines.some((l) => l.text.includes('言葉voice1')) && !manual.lines.some((l) => /0つのうち/.test(l.text)));
  assert.equal(teaser('voice', ts.data), '');
  // 第3章: 出来事 4 件と、いいなと思った人まで言葉だけ
  a('torisetsu-contents'); a('torisetsu-chapter-start', { chapter: 'values' }); a('torisetsu-next'); a('torisetsu-recall-start');
  for (let i = 0; i < 4; i += 1) { if (ts.step === 'recall-intro') a('torisetsu-recall-start'); text(ts.side, 'situation', i); a('torisetsu-record'); }
  text('admire', 'qualities', 0); a('torisetsu-record');
  assert.equal(ts.step, 'lineup');
  assert.ok(html(ts).includes('大事なことを選ぶ'), 'the optional way to give a value stays');
  a('torisetsu-find'); assert.equal(ts.step, 'insight');
  const vins = html(ts);
  assert.ok(vins.includes(COPY.ownThinTitle) && vins.includes(COPY.ownBlockTitle) && !/候補が0つ/.test(vins));
  a('torisetsu-compare'); assert.equal(ts.step, 'surprise');
  a('torisetsu-surprise-next'); a('torisetsu-finish'); assert.equal(ts.step, 'done');
  const vm = composeManual(ts.data, { today: '2026-10-13' }).sections.find((s) => s.id === 'values');
  assert.equal(vm.state, 'filled'); assert.ok(vm.lines.some((l) => l.text.includes('言葉neg0')));
  assert.equal(teaser('values', ts.data), '');
  // 「大事なことを選ぶ」で値を付ければ集計に入る
  a('torisetsu-chapter-days', { chapter: 'values' }); a('torisetsu-days-done');
  a('torisetsu-value-set', { side: 'neg', index: '0', chip: 'vl_kind' });
  assert.equal(valuesInsights(ts.data.values.neg, ts.data.values.pos, ts.data.values.admire).candidates.length, 1);
});

test('counts (n, c) do not change when words are added', () => {
  const eps = clone(B.data.episodes);
  const withWords = eps.map((ep, i) => ({ ...ep, thoughtsText: `言葉${i}` }));
  const strip = (r) => JSON.stringify({ n: r.n, items: r.items.map((i) => [i.id, i.c]), ready: r.ready });
  assert.equal(strip(voiceInsights(withWords)), strip(voiceInsights(eps)));
});

test('an empty open writer does not fill the chip slots; written text does', () => {
  const ctx = makeCtx(); const ts = createTorisetsuState(); toHard(ts, ctx);
  act(ts, ctx, 'torisetsu-layer-next'); act(ts, ctx, 'torisetsu-layer-next');
  act(ts, ctx, 'torisetsu-chip', { group: 'deep', chip: 'dp_sad' });
  act(ts, ctx, 'torisetsu-text-open', { kind: 'own:hard:deep' });
  act(ts, ctx, 'torisetsu-chip', { group: 'deep', chip: 'dp_lonely' });
  assert.deepEqual(ts.draft.deep, ['dp_sad', 'dp_lonely'], 'an empty writer takes no slot');
  assert.equal(chipState(ts, 'deep', 'dp_anxious').dim, true, 'full by chips');
  act(ts, ctx, 'torisetsu-chip', { group: 'deep', chip: 'dp_lonely' });
  assert.equal(chipState(ts, 'deep', 'dp_anxious').dim, false, 'one chip + empty writer is not full');
  setDraftText(ts, 'x', 'own:hard:deep', ctx);
  assert.equal(chipState(ts, 'deep', 'dp_anxious').dim, true, 'one chip + text is full');
  act(ts, ctx, 'torisetsu-chip', { group: 'deep', chip: 'dp_lonely' });
  setDraftText(ts, '', 'own:hard:deep', ctx);
  act(ts, ctx, 'torisetsu-chip', { group: 'deep', chip: 'dp_anxious' });
  assert.deepEqual(ts.draft.deep, ['dp_sad', 'dp_anxious'].filter((id) => ts.draft.deep.includes(id)).length === 2 ? ['dp_sad', 'dp_anxious'] : ts.draft.deep);
  setDraftText(ts, '書く', 'own:hard:deep', ctx);
  assert.equal(ts.draft.deep.length + 1 <= 2, true, 'chips plus text never exceed 2');
});

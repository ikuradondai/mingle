import assert from 'node:assert/strict';
import test from 'node:test';
import * as I from '../dist/torisetsu-insight.js';
import { normalizeData, composeManual, sectionPlainText } from '../dist/torisetsu.js';
import { COPY } from '../dist/data/torisetsu-content.js';
import { BANNED, STIFF_WORDS } from './helpers/banned-words.mjs';
import * as A from './fixtures/torisetsu/v3-a-office.mjs';
import * as B from './fixtures/torisetsu/v3-b-student.mjs';
import * as Cx from './fixtures/torisetsu/v3-c-retired.mjs';
import * as D from './fixtures/torisetsu/v3-d-nopattern.mjs';
import * as E from './fixtures/torisetsu/v3-e-hardonly.mjs';

const full = (chapter, d) => normalizeData({ [chapter]: d });
const BAND = { cross: 'しんどい時もうれしい時も', link: '表の気持ちの奥', hard: 'しんどいときの奥', happy: 'うれしかったとき' };
const countRow = (item) => item.parts.map((p) => `${p.label} ${I.dotsOf(p.cells)} ${p.count}`).join('｜');
const manualText = (data, id) => {
  const section = composeManual(data, { today: '2026-10-13' }).sections.find((s) => s.id === id);
  return section.lines.map((line) => (line.kind === 'bullet' ? `・${line.text}` : line.text));
};
const sections = (data) => Object.fromEntries(composeManual(data, { today: '2026-10-13' }).sections.map((s) => [s.id, s]));

// 小さな入力の作り方（集計関数には生の配列を渡せる）
const hard = (surface, deep = [], needs = [], extra = {}) => ({ scene: '', memo: '', surface, deep, needs, ...extra });
const happy = (needs = [], extra = {}) => ({ scene: '', memo: '', feelings: [], needs, ...extra });
const keys = (ins) => ins.ordered.map((item) => item.key);

// ---------- 例 A ----------
test('example A (chapter 1): findings, counts, sentences, gap, choices, teaser', () => {
  const data = full('needs', A.data);
  const ins = I.needsInsights(data.needs.happy, data.needs.hard);
  assert.equal(ins.ready, true);
  assert.equal(ins.sceneLine, A.expected.sceneLine);
  assert.deepEqual(ins.rows.map((item) => ({ band: BAND[item.band], heading: item.heading, counts: countRow(item), sentence: item.sentence })), A.expected.rows);
  assert.deepEqual(ins.extra, []);
  assert.equal(ins.footer, A.expected.footer);
  assert.equal(ins.footerAdd, A.expected.footerAdd);
  const gap = I.gapFor('needs', data);
  assert.equal(gap.rows[0].thought, A.expected.gapThought);
  assert.equal(gap.rows[0].text, A.expected.gap);
  assert.equal(gap.actual, A.expected.actual);
  assert.deepEqual(I.surpriseOptions('needs', data).map((o) => o.label), A.expected.surprise);
  assert.deepEqual(I.tryOptions('needs', data).map((o) => o.text), A.expected.tries);
  assert.equal(I.teaser('needs', data), A.expected.teaser);
});

test('example A: manual sections 1, 2, 3, 6, 7 are fixed strings', () => {
  const data = full('needs', A.data);
  assert.deepEqual(manualText(data, 'fuel'), A.expected.manual.fuel);
  assert.deepEqual(manualText(data, 'shaky'), A.expected.manual.shaky);
  assert.deepEqual(manualText(data, 'request'), A.expected.manual.request);
  assert.deepEqual(manualText(data, 'try'), A.expected.manual.try);
  assert.deepEqual(manualText(data, 'surprise'), A.expected.manual.surprise);
  const s = sections(data);
  assert.equal(s.voice.state, 'todo'); assert.equal(s.values.state, 'todo');
});

// ---------- 例 B ----------
test('example B (chapter 2): voices repeat as a pattern, choices, manual section 4', () => {
  const data = full('voice', B.data);
  const ins = I.voiceInsights(data.voice.episodes);
  assert.equal(ins.items.length, 1);
  const row = ins.items[0];
  assert.deepEqual({ heading: row.heading, counts: `${I.dotsOf(row.cells)} ${row.count}${row.paren}`, sentence: row.sentence }, B.expected.rows[0]);
  assert.equal(ins.footer, B.expected.footer); assert.equal(ins.footerAdd, B.expected.footerAdd);
  assert.equal(I.effectiveFocus(data.voice), B.expected.focus);
  assert.deepEqual(I.focusVoices(data.voice).map((t) => t.label), ['嫌われたかも', '迷惑をかけている']);
  assert.equal(I.teaser('voice', data), B.expected.teaser);
  assert.deepEqual(I.surpriseOptions('voice', data).map((o) => o.label), B.expected.surprise);
  assert.deepEqual(I.tryOptions('voice', data).map((o) => o.text), B.expected.tries);
  assert.equal(I.heavyNote('voice', data), B.expected.heavy);
  assert.deepEqual(manualText(data, 'voice'), B.expected.manual.voice);
  assert.deepEqual(manualText(data, 'try'), B.expected.manual.try);
  assert.deepEqual(manualText(data, 'surprise'), B.expected.manual.surprise);
  assert.equal(I.gapFor('voice', data).rows.length, 0, 'no prediction in the voice chapter');
});

// ---------- 例 C ----------
test('example C (chapter 3): admire counts as one item, ties follow the value order', () => {
  const data = full('values', Cx.data);
  const ins = I.valuesInsights(data.values.neg, data.values.pos, data.values.admire);
  assert.equal(ins.T, 5); assert.equal(ins.E, 4);
  assert.deepEqual(ins.items.map((item) => ({ id: item.id, sentence: item.sentence })), Cx.expected.items);
  assert.equal(ins.summary, Cx.expected.summary);
  assert.equal(ins.footer, Cx.expected.footer);
  const gap = I.gapFor('values', data);
  assert.equal(gap.rows[0].thought, Cx.expected.gapThought); assert.equal(gap.rows[0].text, Cx.expected.gap); assert.equal(gap.actual, Cx.expected.actual);
  assert.equal(I.teaser('values', data), Cx.expected.teaser);
  assert.deepEqual(I.surpriseOptions('values', data).map((o) => o.label), Cx.expected.surprise);
  assert.deepEqual(I.tryOptions('values', data).map((o) => o.text), Cx.expected.tries);
  assert.deepEqual(manualText(data, 'values'), Cx.expected.manual.values);
});

// ---------- 例 D / E ----------
test('example D (no pattern): nothing repeats, near-miss and the list of deeper feelings', () => {
  const data = full('needs', D.data);
  const ins = I.needsInsights(data.needs.happy, data.needs.hard);
  assert.equal(ins.empty, true);
  assert.equal(COPY.insightNoneTitle, D.expected.title); assert.equal(COPY.insightNoneBody, D.expected.body);
  assert.equal(ins.near.text, D.expected.near);
  assert.equal(`${ins.listLine.label}${ins.listLine.tags.map((t) => `『${t}』`).join('')}`, D.expected.list);
  assert.equal(I.teaser('needs', data), D.expected.teaser);
  assert.deepEqual(I.surpriseOptions('needs', data).map((o) => o.label), D.expected.surprise);
  assert.deepEqual(manualText(data, 'fuel'), D.expected.manual.fuel);
  const s = sections(data);
  assert.equal(s.shaky.state, D.expected.manual.shakyState);
  assert.equal(s.request.state, D.expected.manual.requestState);
});

test('example E (hard side only): 3 answers are enough; same feeling / wish / surface appears once', () => {
  const data = full('needs', E.data);
  const ins = I.needsInsights(data.needs.happy, data.needs.hard);
  assert.equal(ins.ready, true); assert.equal(ins.nA, 3);
  assert.deepEqual(ins.ordered.map((item) => ({ kind: item.kind, sentence: item.sentence })), E.expected.rows);
  assert.equal(ins.footer, E.expected.footer); assert.equal(ins.footerAdd, E.expected.footerAdd);
  assert.equal(ins.sceneLine, E.expected.sceneLine);
});

// ---------- しきい値 ----------
test('thresholds: repeat is 2 or more and at least half', () => {
  assert.equal(I.repeat(2, 3), true); assert.equal(I.repeat(2, 4), true); assert.equal(I.repeat(2, 5), false);
  assert.equal(I.repeat(3, 5), true); assert.equal(I.repeat(1, 2), false); assert.equal(I.repeat(0, 0), false);
});

test('thresholds: crossing needs both sides, 3 or more in total, and at least half of all answers', () => {
  const crossOf = (nJ, nH, jHits, hHits) => {
    const happyList = Array.from({ length: nJ }, (_, i) => happy(i < jHits ? ['nd_belong'] : ['nd_rest']));
    const hardList = Array.from({ length: nH }, (_, i) => hard('', [], i < hHits ? ['nd_belong'] : ['nd_safe']));
    const ins = I.needsInsights(happyList, hardList);
    return ins.pre.X.includes('nd_belong');
  };
  assert.equal(crossOf(2, 3, 1, 1), false, 'hH1 + hJ1 = 2 is not enough');
  assert.equal(crossOf(2, 3, 1, 2), true, 'hH2 + hJ1 = 3 of 5');
  assert.equal(crossOf(2, 4, 2, 1), true, 'hH1 + hJ2 = 3 of 6');
  assert.equal(crossOf(2, 5, 1, 2), false, 'hH2 + hJ1 = 3 of 7');
  assert.equal(crossOf(3, 3, 0, 2), false, 'needs the happy side too');
});

test('thresholds: a surface feeling links to a deeper one when 2/2 or 2/3, not 1/2 or a single answer', () => {
  const linkOf = (deepLists) => {
    const ins = I.needsInsights([], deepLists.map((deep) => hard('sf_irritated', deep, [])).concat([hard('sf_down', ['dp_sad']), hard('sf_foggy', ['dp_lonely'])]));
    return ins.ordered.some((item) => item.kind === 'LD' && item.surface === 'sf_irritated');
  };
  assert.equal(linkOf([['dp_anxious'], ['dp_anxious']]), true, '2/2');
  assert.equal(linkOf([['dp_anxious'], ['dp_anxious'], ['dp_full']]), true, '2/3');
  assert.equal(linkOf([['dp_anxious'], ['dp_full']]), false, '1/2');
  assert.equal(linkOf([['dp_anxious']]), false, 'only one answer for the feeling');
});

test('overlap: a need shown as crossing is not shown again; a deeper feeling shown with its surface is not shown again; one LD/LN per surface', () => {
  const a = full('needs', A.data);
  const ins = I.needsInsights(a.needs.happy, a.needs.hard);
  assert.deepEqual(ins.ordered.map((i) => i.kind), ['X', 'LD'], 'no H, D or LN for the same ids');
  assert.deepEqual(ins.pre.X, ['nd_understood']); assert.ok(ins.pre.H.includes('nd_understood'));
  const e = I.needsInsights([], [hard('sf_rushed', ['dp_expect'], ['nd_safe']), hard('sf_rushed', ['dp_expect'], ['nd_safe']), hard('sf_down', ['dp_sad'], ['nd_rest'])]);
  assert.deepEqual(e.ordered.map((i) => i.kind), ['LD', 'H'], 'the LN for the same surface is dropped; the need is still shown as H');
});

test('one episode counts a repeated choice once', () => {
  const doubled = I.needsInsights([], [hard('', ['dp_anxious', 'dp_anxious'], []), hard('', [], []), hard('', [], [])]);
  assert.equal(doubled.ordered.length, 0);
  const counts = I.needsCounts([], [hard('', ['dp_anxious', 'dp_anxious'], ['nd_safe', 'nd_safe'])]);
  assert.equal(counts.dH.get('dp_anxious'), 1); assert.equal(counts.hH.get('nd_safe'), 1);
});

test('the result does not depend on the order of the answers', () => {
  const a = full('needs', A.data);
  const reversed = I.needsInsights([...a.needs.happy].reverse(), [...a.needs.hard].reverse());
  const normal = I.needsInsights(a.needs.happy, a.needs.hard);
  assert.deepEqual(reversed.ordered.map((i) => [i.key, i.sentence]), normal.ordered.map((i) => [i.key, i.sentence]));
  const v = full('voice', B.data).voice.episodes;
  assert.deepEqual(I.voiceInsights([...v].reverse()).ordered.map((i) => i.sentence), I.voiceInsights(v).ordered.map((i) => i.sentence));
});

test('free text never changes the result (a memo saying 不安 counts for nothing)', () => {
  const a = full('needs', A.data);
  const noisy = a.needs.hard.map((ep) => ({ ...ep, memo: '不安 わかってほしかった イライラ' }));
  const before = I.needsInsights(a.needs.happy, a.needs.hard); const after = I.needsInsights(a.needs.happy, noisy);
  assert.deepEqual(after.ordered.map((i) => i.sentence), before.ordered.map((i) => i.sentence));
  const d = full('needs', D.data);
  const withMemo = I.needsInsights(d.needs.happy, d.needs.hard.map((ep) => ({ ...ep, memo: '不安' })));
  assert.equal(withMemo.empty, true);
});

test('scenes: the "scattered" line needs 2 or more kinds and at least one finding; sc_other is skipped', () => {
  const same = I.needsInsights([], [hard('sf_irritated', ['dp_anxious'], [], { scene: 'sc_work' }), hard('sf_irritated', ['dp_anxious'], [], { scene: 'sc_work' }), hard('sf_down', [], [], { scene: 'sc_work' })]);
  assert.equal(same.ordered.length > 0 && same.sceneLine, '');
  const onlyOther = I.needsInsights([], [hard('sf_irritated', ['dp_anxious'], [], { scene: 'sc_work' }), hard('sf_irritated', ['dp_anxious'], [], { scene: 'sc_other' }), hard('sf_down', [], [])]);
  assert.equal(onlyOther.sceneLine, '');
  const two = I.needsInsights([], [hard('sf_irritated', ['dp_anxious'], [], { scene: 'sc_work' }), hard('sf_irritated', ['dp_anxious'], [], { scene: 'sc_friend' }), hard('sf_down', [], [])]);
  assert.equal(two.sceneLine, '出来事は、友だちのこと、学校や仕事のことと、バラバラでした。でも、奥にはくり返し出てくるものがありました。');
});

// ---------- 第 2 章 ----------
test('voice: when the same episodes carry both the voice and its pattern, the specific voice is shown', () => {
  const eps = [{ thoughts: ['th_disliked'] }, { thoughts: ['th_disliked'] }, { thoughts: ['th_nogood'] }];
  const ins = I.voiceInsights(eps);
  assert.deepEqual(ins.ordered.map((i) => `${i.kind}:${i.id}`), ['RT:th_disliked']);
  assert.equal(ins.ordered[0].sentence, '3つのうち2つで、『嫌われたかも』という声がしていました。');
  const spread = I.voiceInsights([{ thoughts: ['th_disliked'] }, { thoughts: ['th_burden'] }, { thoughts: ['th_nogood'] }]);
  assert.deepEqual(spread.ordered.map((i) => `${i.kind}:${i.id}`), ['RP:pt_read'], 'different voices, same pattern');
  const all = I.voiceInsights([{ thoughts: ['th_disliked'] }, { thoughts: ['th_burden'] }]);
  assert.equal(all.ordered[0].sentence, '声はちがっても、2つとも『人の気持ちを先に読む』声でした（『嫌われたかも』『迷惑をかけている』）。');
});

test('voice: a pattern counts once per scene even when two of its voices are chosen', () => {
  const ins = I.voiceInsights([{ thoughts: ['th_nogood', 'th_myfault'] }, { thoughts: ['th_others'] }, { thoughts: ['th_end'] }]);
  assert.equal(ins.countOf('pt_blame'), 1); assert.equal(ins.empty, true);
  assert.equal(ins.candidates.length, 4);
});

test('voice: focus starts at the repeating pattern, can be switched, and replies follow the focus', () => {
  const voice = full('voice', B.data).voice;
  assert.equal(I.effectiveFocus(voice), 'pt_read');
  assert.deepEqual(I.focusChoices(voice).map((p) => p.id), ['pt_blame', 'pt_read', 'pt_compare']);
  assert.deepEqual(I.replyOptions('pt_read').map((r) => r.id), ['rp_read1', 'rp_read2', 'rp_any1', 'rp_any2']);
  assert.equal(I.effectiveFocus({ ...voice, focus: 'pt_blame' }), 'pt_blame');
  assert.equal(I.effectiveFocus({ ...voice, focus: 'pt_alone' }), 'pt_read', 'a pattern that did not appear falls back');
  const data = full('voice', { ...B.data, focus: 'pt_blame' });
  assert.equal(data.voice.reply, '', 'a reply that no longer belongs to the focus is dropped');
  const keep = full('voice', { ...B.data, focus: 'pt_blame', reply: 'rp_any2' });
  assert.equal(keep.voice.reply, 'rp_any2');
  const none = I.defaultFocus([{ thoughts: ['th_nogood'] }, { thoughts: ['th_myfault', 'th_hopeless'] }]);
  assert.equal(none, 'pt_blame', 'no repeat: the pattern that appeared in the most scenes');
});

test('heavy note: two or more hard answers that include むなしさ/いっぱいいっぱい, or every voice about carrying alone / blaming', () => {
  const need = (h) => ({ needs: { happy: [], hard: h } });
  assert.equal(I.heavyNote('needs', need([hard('', ['dp_empty'], []), hard('', ['dp_full'], []), hard('', [], [])])), true);
  assert.equal(I.heavyNote('needs', need([hard('', ['dp_empty', 'dp_full'], []), hard('', [], []), hard('', [], [])])), false, 'one episode is one');
  assert.equal(I.heavyNote('needs', need([hard('', ['dp_empty'], []), hard('', [], []), hard('', [], [])])), false);
  const voice = (eps) => ({ voice: { episodes: eps } });
  assert.equal(I.heavyNote('voice', voice([{ thoughts: ['th_noweak'] }, { thoughts: ['th_nogood'] }])), true);
  assert.equal(I.heavyNote('voice', voice([{ thoughts: ['th_noweak'] }, { thoughts: ['th_disliked'] }])), false);
  assert.equal(I.heavyNote('voice', voice([{ thoughts: ['th_noweak'] }])), false, 'needs at least 2 scenes');
});

// ---------- 第 3 章 ----------
test('values: the two qualities of one admired person count as one item; re-choosing a value changes the count', () => {
  const admire = { who: 'aw_near', qualities: [{ id: 'ql_respect', value: 'vl_respect' }, { id: 'ql_listen', value: 'vl_respect' }], memo: '' };
  const counts = I.valuesCounts([], [], admire);
  assert.equal(counts.get('vl_respect').m, 1); assert.equal(counts.get('vl_respect').c, 1);
  const base = { neg: [{ situation: 'sn_mean', value: 'vl_respect' }], pos: [{ situation: 'sp_respect', value: 'vl_respect' }], admire: null };
  assert.equal(I.valuesInsights(base.neg, base.pos, null).T, 2);
  const three = I.valuesInsights([...base.neg, { situation: 'sn_forced', value: 'vl_free' }], base.pos, null);
  assert.equal(three.ordered[0].id, 'vl_respect');
  const changed = I.valuesInsights([...base.neg, { situation: 'sn_forced', value: 'vl_respect' }], base.pos, null);
  assert.equal(changed.ordered[0].c, 3);
  assert.equal(changed.ordered[0].sentence, 'イラッとした出来事にも、うれしかった出来事にも、『一人ひとりを大切にすること』が関わっていました（3つのうち3つ）。');
});

test('values: a single side reads as "守られなかったとき" / "あったとき"; nothing in common reads as candidates', () => {
  const neg = I.valuesInsights([{ value: 'vl_fair' }, { value: 'vl_fair' }], [{ value: 'vl_kind' }], null);
  assert.equal(neg.ordered[0].sentence, 'イラッとした出来事のうち2つは、『公平さ』が守られなかったときでした。');
  const pos = I.valuesInsights([{ value: 'vl_kind' }], [{ value: 'vl_fair' }, { value: 'vl_fair' }], null);
  assert.equal(pos.ordered[0].sentence, 'うれしかった出来事のうち2つは、『公平さ』があったときでした。');
  const none = I.valuesInsights([{ value: 'vl_kind' }], [{ value: 'vl_fair' }, { value: 'vl_free' }], null);
  assert.equal(none.empty, true); assert.equal(none.candidates.length, 3);
});

// ---------- 全体 ----------
test('every composed sentence in the examples is within 80 characters and free of banned words', () => {
  const all = [
    ...I.needsInsights(...[A.data, D.data, E.data].flatMap((d) => [d.happy, d.hard])).ordered.map((i) => i.sentence),
  ];
  for (const fx of [A, D, E]) {
    const d = full('needs', fx.data);
    for (const item of I.needsInsights(d.needs.happy, d.needs.hard).ordered) all.push(item.sentence);
    for (const section of composeManual(d, { today: '2026-10-13' }).sections) for (const line of section.lines) all.push(line.text);
  }
  const v = full('voice', B.data); const c = full('values', Cx.data);
  all.push(...I.voiceInsights(v.voice.episodes).ordered.map((i) => i.sentence), ...I.valuesInsights(c.values.neg, c.values.pos, c.values.admire).ordered.map((i) => i.sentence));
  for (const data of [v, c]) for (const section of composeManual(data, { today: '2026-10-13' }).sections) for (const line of section.lines) all.push(line.text);
  for (const text of all) {
    for (const sentence of text.split('。').filter(Boolean)) assert.ok(Array.from(sentence).length <= 80, sentence);
    for (const re of [...BANNED, ...STIFF_WORDS, /タイプ/u, /性格/u, /傾向/u, /型/u, /な人です/u, /向いていない/u, /べき/u, /必ず/u, /絶対/u, /自己/u, /欲求/u, /ニーズ/u, /感情/u, /思考/u, /価値観/u, /批判/u, /自傷/u, /死/u, /消えたい/u]) assert.doesNotMatch(text, re, text);
    assert.doesNotMatch(text.replace(/『[^』]*』/g, ''), /ダメ/u, text);
  }
});

test('the longest crossing sentence stays within 80 characters', () => {
  const longest = [{ kind: 'X', id: 'nd_cared', hH: 2, hJ: 1 }];
  const sentence = I.renderNeedsSentence(longest[0], 2, 3);
  for (const part of sentence.split('。').filter(Boolean)) assert.ok(Array.from(part).length <= 80, part);
});

test('choices are pruned when the findings change', () => {
  const data = full('needs', { ...A.data, surprise: 'x:nd_understood', experiment: 'try:l:sf_irritated:dp_anxious' });
  assert.equal(data.needs.surprise, 'x:nd_understood');
  const gone = full('needs', { ...A.data, hard: A.data.hard.slice(2), surprise: 'x:nd_understood', experiment: 'try:l:sf_irritated:dp_anxious' });
  assert.equal(gone.needs.surprise, ''); assert.equal(gone.needs.experiment, '');
  const text = full('needs', { ...A.data, surpriseText: '自分の言葉', experimentText: '来週の約束', surprise: 'x:nd_understood' });
  assert.equal(I.shortOfSurprise('needs', text), '「自分の言葉」'); assert.equal(I.textOfTry('needs', text), '「来週の約束」');
});

test('cross-chapter link: only when both chapters are ready and the need maps to a shown value', () => {
  const both = normalizeData({
    needs: { happy: [{ feelings: ['hf_glad'], needs: ['nd_choose'] }, { feelings: ['hf_glad'], needs: ['nd_choose'] }], hard: [{ surface: 'sf_down', deep: ['dp_small'], needs: ['nd_choose'] }] },
    values: { neg: [{ situation: 'sn_forced' }], pos: [{ situation: 'sp_choose' }, { situation: 'sp_self' }] },
  });
  assert.equal(I.crossLink(both), '満たされるものの『自分で決められること』と、大事にしていることの『自分で選ぶこと』は、つながっているようです。');
  assert.equal(I.crossLink(full('needs', A.data)), '');
  assert.equal(I.sceneById('sc_work').label, '学校や仕事のこと');
  void sectionPlainText;
});

test('a side with one episode reads 「1つ」 and 「…1つで『…』」, never 「1つとも」', () => {
  assert.equal(I.countText(1, 1), '1つ'); assert.equal(I.countText(2, 2), '2つとも'); assert.equal(I.countText(0, 1), '0つ');
  const ins = I.needsInsights([happy(['nd_understood'])], [hard('sf_down', [], ['nd_understood']), hard('sf_down', [], ['nd_understood']), hard('', [], [])]);
  const x = ins.ordered.find((item) => item.kind === 'X');
  assert.ok(x.sentence.includes('うれしかった1つで『わかってもらえた』')); assert.ok(!x.sentence.includes('1つとも'));
  const one = I.needsInsights([happy(['nd_understood']), happy([])], [hard('', [], ['nd_understood'])]);
  const y = one.ordered.find((item) => item.kind === 'X');
  if (y) assert.ok(y.sentence.includes('しんどかった1つで『わかってほしかった』'));
});

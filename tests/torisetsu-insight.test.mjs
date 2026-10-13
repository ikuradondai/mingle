import assert from 'node:assert/strict';
import test from 'node:test';
import * as I from '../dist/torisetsu-insight.js';
import * as C from '../dist/data/torisetsu-content.js';
import * as ex5 from './fixtures/torisetsu/example5-mirror.mjs';
import { composeManual, normalizeData, emptyData } from '../dist/torisetsu.js';
import * as ex1 from './fixtures/torisetsu/example1-office-worker.mjs';
import * as ex2 from './fixtures/torisetsu/example2-retired.mjs';
import * as ex3 from './fixtures/torisetsu/example3-student.mjs';
import * as ex4 from './fixtures/torisetsu/example4-no-pattern.mjs';

const choice = { surprise: '', surpriseText: '', experiment: '', experimentText: '', done: false };
const energyData = (input) => ({ name: '', energy: { prediction: input.prediction || [], good: input.good, bad: input.bad, ...choice }, values: { prediction: [], neg: [], pos: [], ...choice }, others: { self: [], episodes: [], ...choice } });
const valuesData = (input) => ({ name: '', energy: { prediction: [], good: [], bad: [], ...choice }, values: { prediction: input.prediction || [], neg: input.neg, pos: input.pos, ...choice }, others: { self: [], episodes: [], ...choice } });
const othersData = (input) => ({ name: '', energy: { prediction: [], good: [], bad: [], ...choice }, values: { prediction: [], neg: [], pos: [], ...choice }, others: { self: input.self, episodes: input.episodes, ...choice } });

test('example 1 (office worker): sentences, order and extras are fixed', () => {
  const ins = I.energyInsights(ex1.input.good, ex1.input.bad);
  assert.deepEqual(ins.good.map((item) => item.sentence), ex1.expected.good);
  assert.deepEqual(ins.bad.map((item) => item.sentence), ex1.expected.bad);
  assert.deepEqual(ins.extra.bad.map((item) => item.tag), ex1.expected.extraBad);
  assert.deepEqual(ins.extra.good.map((item) => item.tag), ex1.expected.extraGood);
  // 体の調子は帯にも、電源の入れ方・警告ランプにも使わない。いつも「ほかに見えたこと」へ
  assert.equal([...ins.good, ...ins.bad, ...ins.ordered.good, ...ins.ordered.bad].some((item) => item.feature.group === 'body'), false);
  assert.equal(ins.footer, ex1.expected.footer);
  assert.equal(ins.footerAdd, ex1.expected.footerAdd);
  assert.equal(ins.empty, false);
  // 整理: out は home_only に、people は who_alone に負けて外れる
  const ids = [...ins.ordered.good, ...ins.ordered.bad].map((item) => item.id);
  assert.equal(ids.includes('out'), false);
  assert.equal(ids.includes('people'), false);
  assert.deepEqual(ins.bad.map((item) => item.id), ['sleep_short', 'do_screen', 'home_only']);
});

test('example 1: prediction vs reality, surprise and try options, teaser', () => {
  const ins = I.energyInsights(ex1.input.good, ex1.input.bad);
  const gap = I.energyGap(ex1.input.prediction, ins, ex1.input.good, ex1.input.bad);
  assert.deepEqual(gap.rows.map((row) => row.text), ex1.expected.gap);
  assert.deepEqual(gap.rows.map((row) => row.thought), ['思っていた：おいしい物を食べること', '思っていた：よく眠ること']);
  assert.equal(gap.actual, ex1.expected.actual);
  const data = energyData(ex1.input);
  assert.deepEqual(I.surpriseOptions('energy', data).map((item) => item.label), ex1.expected.surprise);
  assert.deepEqual(I.tryOptions('energy', data).map((item) => item.text), ex1.expected.tries);
  assert.equal(I.teaser('energy', data), ex1.expected.teaser);
});

test('example 1: manual excerpt (power / warning / try / surprise)', () => {
  const data = energyData(ex1.input);
  data.energy.surprise = 'g:do_talk'; data.energy.experiment = 'try:do_talk:more';
  const manual = composeManual(data, { today: '2026-10-13' });
  const text = (id) => manual.sections.find((section) => section.id === id).lines.map((line) => (line.kind === 'bullet' ? `・${line.text}` : line.text));
  assert.deepEqual(text('power'), ['・誰かとゆっくり話す', '今回の答えでは、調子がよかった日にこれがありました。']);
  assert.deepEqual(text('warning'), ['こんな日は、調子が下がりやすいようです。', '・前の晩が寝不足の日', '・スマホや動画を長く見た日', '・一日家にいた日', 'そんな日は、早めに休ませてあげてください。']);
  assert.deepEqual(text('try'), ['・誰かとゆっくり話す時間を、来週1回つくってみる', '合わなければ、やめてOKです。']);
  assert.deepEqual(text('surprise'), ['・元気のもと：よかった日の『ゆっくり話した』']);
  assert.equal(manual.version, '第1版　2026年10月　｜　今回の答えから作りました');
});

test('example 2 (retired): values sentences, gap, options, manual', () => {
  const ins = I.valuesInsights(ex2.input.neg, ex2.input.pos);
  assert.deepEqual(ins.items.map((item) => item.sentence), ex2.expected.sentences);
  assert.equal(ins.summary, ex2.expected.summary);
  assert.equal(ins.footer, ex2.expected.footer);
  const gap = I.valuesGap(ex2.input.prediction, ins, ex2.input.neg, ex2.input.pos);
  assert.deepEqual(gap.rows.map((row) => row.text), ex2.expected.gap);
  assert.equal(gap.actual, ex2.expected.actual);
  const data = valuesData(ex2.input);
  assert.deepEqual(I.tryOptions('values', data).map((item) => item.text), ex2.expected.tries);
  assert.equal(I.teaser('values', data), ex2.expected.teaser);
  const manual = composeManual(data, { today: '2026-10-13' });
  const lines = (id) => manual.sections.find((section) => section.id === id).lines.map((line) => (line.kind === 'bullet' ? `・${line.text}` : line.text));
  assert.deepEqual(lines('values'), ['・約束や正直さ', 'これが守られないと心が波立ち、守られるとうれしくなるようです。']);
  assert.deepEqual(lines('request'), ['・できない約束は、早めに言ってもらえると助かります。', 'いつも、ありがとう。']);
});

test('example 3 (student): others lines, teaser and manual', () => {
  const ins = I.othersInsights(ex3.input.self, ex3.input.episodes);
  assert.deepEqual(ins.lines.map((line) => line.text), ex3.expected.lines);
  assert.equal(ins.footer, ex3.expected.footer);
  assert.equal(I.teaser('others', othersData(ex3.input)), ex3.expected.teaser);
  const manual = composeManual(othersData(ex3.input), { today: '2026-10-13' });
  const section = manual.sections.find((item) => item.id === 'strengths');
  assert.deepEqual(section.lines.filter((line) => line.kind === 'bullet').map((line) => line.text), [...ex3.expected.manual, ...ex3.expected.waiting]);
  assert.equal(section.lines.find((line) => line.kind === 'sub').text, 'まだ出番を待っている特長');
});

test('example 4 (boundary, 2 vs 2): no pattern, near miss, teaser', () => {
  const ins = I.energyInsights(ex4.input.good, ex4.input.bad);
  assert.equal(ins.ready, true);
  assert.equal(ins.empty, true);
  assert.equal(ins.nearMiss.text, ex4.expected.nearMiss);
  assert.equal(ins.footer, ex4.expected.footer);
  assert.equal(I.teaser('energy', energyData(ex4.input)), ex4.expected.teaser);
  const manual = composeManual(energyData(ex4.input), { today: '2026-10-13' });
  assert.equal(manual.sections.find((section) => section.id === 'power').state, 'none');
  assert.equal(manual.sections.find((section) => section.id === 'warning').state, 'none');
});

// ---- しきい値 ----
const day = (hit) => ({ who: ['who_pet'], where: ['where_home'], doing: hit ? ['do_work', 'do_talk'] : ['do_work'], sleep: 'sleep_ok', body: 'body_ok', memo: '' });
const mk = (hits, n) => Array.from({ length: n }, (_, i) => day(i < hits));
const stageOf = (g, nG, b, nB, side = 'good') => {
  const ins = I.energyInsights(mk(g, nG), mk(b, nB));
  return ins.ordered[side].find((item) => item.id === 'do_talk')?.stage || null;
};

test('thresholds: A is 2/3 or more on one side and none on the other; B is a gap of 1/2 or more', () => {
  assert.equal(stageOf(2, 3, 0, 3), 'A');
  assert.equal(stageOf(2, 3, 1, 3), null);
  assert.equal(stageOf(3, 3, 1, 3), 'B');
  assert.equal(stageOf(2, 2, 1, 2), 'B');
  assert.equal(stageOf(2, 2, 0, 3), 'A');
  assert.equal(stageOf(4, 5, 0, 4), 'A');
  assert.equal(stageOf(4, 5, 1, 4), 'B');
  assert.equal(stageOf(2, 5, 0, 5), null);
  assert.equal(stageOf(1, 3, 0, 3), null, 'a single day is never a pattern');
  assert.equal(stageOf(0, 3, 2, 3, 'bad'), 'A');
  assert.equal(stageOf(1, 3, 3, 3, 'bad'), 'B');
  // 設計書の例 3/5 対 0/5: 式（差 1/2 以上）では B になる。A ではない（3/5 < 2/3）。
  assert.equal(stageOf(3, 5, 0, 5), 'B');
});

test('fewer than 2 days on a side is not ready', () => {
  assert.equal(I.energyInsights(mk(1, 1), mk(0, 3)).ready, false);
  assert.equal(I.chapterReady('energy', energyData({ good: mk(2, 2), bad: mk(0, 2) })), true);
});

const withWhere = (where, n) => Array.from({ length: n }, () => ({ who: ['who_pet'], where, doing: ['do_work'], sleep: 'sleep_ok', body: 'body_ok', memo: '' }));

test('overlap: a combined feature is dropped when a finer one has the same counts', () => {
  const ins = I.energyInsights(withWhere(['where_nature'], 3), withWhere(['where_home'], 3));
  const ids = ins.ordered.good.map((item) => item.id);
  assert.ok(ids.includes('where_nature'));
  assert.equal(ids.includes('out'), false);
});

const withWho = (whoList) => whoList.map((who) => ({ who, where: ['where_home'], doing: ['do_work'], sleep: 'sleep_ok', body: 'body_ok', memo: '' }));

test('opposite pairs keep only the stronger one (stage, gap, days, then the good side)', () => {
  const good = withWho([['who_alone'], ['who_alone'], ['who_alone']]);
  const bad = withWho([['who_family'], ['who_friend'], ['who_mates']]);
  const tie = I.energyInsights(good, bad);
  assert.ok(tie.ordered.good.some((item) => item.id === 'who_alone'));
  assert.equal(tie.ordered.bad.some((item) => item.id === 'people'), false, 'good side wins a complete tie');
  // 悪かった日側のほうが差が大きい → 悪かった日側が残る
  const good2 = withWho([['who_alone'], ['who_alone'], ['who_pet']]);
  const bad2 = withWho([['who_family'], ['who_friend'], ['who_mates']]);
  const stronger = I.energyInsights(good2, bad2);
  assert.ok(stronger.ordered.bad.some((item) => item.id === 'people'));
  assert.equal(stronger.ordered.good.some((item) => item.id === 'who_alone'), false);
});

test('result does not depend on the order of days or on free text', () => {
  const reverse = (list) => [...list].reverse();
  const a = I.energyInsights(ex1.input.good, ex1.input.bad);
  const b = I.energyInsights(reverse(ex1.input.good), reverse(ex1.input.bad));
  assert.deepEqual(b.ordered.good.map((x) => x.sentence), a.ordered.good.map((x) => x.sentence));
  assert.deepEqual(b.ordered.bad.map((x) => x.sentence), a.ordered.bad.map((x) => x.sentence));
  const noisy = (list) => list.map((d) => ({ ...d, memo: 'ゆっくり話した 寝不足 ゆっくり話した' }));
  const c = I.energyInsights(noisy(ex1.input.good), noisy(ex1.input.bad));
  assert.deepEqual(c.ordered.good.map((x) => [x.id, x.sentence]), a.ordered.good.map((x) => [x.id, x.sentence]));
  assert.deepEqual(c.ordered.bad.map((x) => x.sentence), a.ordered.bad.map((x) => x.sentence));
  const plain = energyData(ex1.input); const loud = energyData(ex1.input);
  loud.energy.good[0].memo = '話した'.repeat(10); loud.energy.surpriseText = '寝不足'; loud.energy.experimentText = 'ゆっくり話した';
  assert.deepEqual(I.surpriseOptions('energy', loud), I.surpriseOptions('energy', plain));
  assert.deepEqual(I.tryOptions('energy', loud), I.tryOptions('energy', plain));
});

test('one side only without a pattern gets a short note', () => {
  const ins = I.energyInsights(mk(3, 3), mk(1, 3));
  assert.equal(ins.ordered.good.length >= 1, true);
  assert.equal(ins.sideNote.bad, '調子が悪かった日だけにある共通点は、まだ見えません。');
  assert.equal(ins.sideNote.good, '');
});

test('B sentences carry both counts and unequal day counts use the long footer', () => {
  const ins = I.energyInsights(mk(3, 3), mk(1, 3));
  assert.equal(ins.ordered.good.find((x) => x.id === 'do_talk').sentence, '『ゆっくり話した』は、調子がよかった日に多く出ていました（よかった日3日中3日、悪かった日3日中1日）。');
  const unequal = I.energyInsights(mk(2, 2), mk(0, 4));
  assert.equal(unequal.footer, 'よかった日2日・悪かった日4日の答えから見えたことです。決まりではありません。');
  assert.equal(I.energyInsights(mk(5, 5), mk(0, 5)).footerAdd, '');
});

test('prediction verdicts: hit, both, partial, reverse, unseen, and none', () => {
  const talk = (id, good, bad) => { const ins = I.energyInsights(good, bad); return I.energyGap([id], ins, good, bad).rows[0]; };
  assert.equal(talk('do_talk', mk(3, 3), mk(0, 3)).verdict, 'hit');
  assert.equal(talk('do_talk', mk(3, 3), mk(3, 3)).verdict, 'both');
  assert.equal(talk('do_talk', mk(1, 3), mk(0, 3)).verdict, 'partial');
  assert.equal(talk('do_talk', mk(0, 3), mk(3, 3)).verdict, 'reverse');
  assert.equal(talk('do_eat', mk(3, 3), mk(0, 3)).verdict, 'unseen');
  const good = mk(3, 3); const bad = mk(0, 3);
  assert.equal(I.energyGap([], I.energyInsights(good, bad), good, bad).rows.length, 0);
  assert.equal(I.energyGap([], I.energyInsights(good, bad), good, bad).actual, '実際は：調子がよかった日には『ゆっくり話した』がありました。');
  assert.equal(I.energyGap(['do_talk'], I.energyInsights(good, bad), good, bad).actual, '', 'no "actual" line when the top item was predicted');
  const empty = I.energyInsights(ex4.input.good, ex4.input.bad);
  assert.equal(I.energyGap(['do_eat'], empty, ex4.input.good, ex4.input.bad).actual, 'まだ見えないだけかもしれません。日を足すと、比べやすくなります。');
});

// ---- 第2章 ----
const ep = (situation, value, feeling = 'f_sad') => ({ situation, value, feeling, memo: '' });

test('values: both sides, one side only, no overlap, and the user can re-pick a value', () => {
  const both = I.valuesInsights([ep('n_promise', 'v_honest')], [ep('p_honest', 'v_honest'), ep('p_thanks', 'v_seen', 'f_happy')]);
  assert.equal(both.items[0].kind, 'both');
  assert.equal(both.items[0].sentence, 'イラッと・がっかりした出来事と、うれしかった出来事。反対の気持ちなのに、どちらにも『約束や正直さ』が関わっていました。（3つの出来事のうち2つ）');
  const negOnly = I.valuesInsights([ep('n_promise', 'v_honest'), ep('n_lie', 'v_honest')], [ep('p_thanks', 'v_seen', 'f_happy')]);
  assert.equal(negOnly.items[0].sentence, 'イラッと・がっかりした出来事のうち2つは、『約束や正直さ』が守られなかったときでした。');
  const posOnly = I.valuesInsights([ep('n_stuck', 'v_grow')], [ep('p_thanks', 'v_seen', 'f_happy'), ep('p_praised', 'v_seen', 'f_proud')]);
  assert.equal(posOnly.items[0].sentence, 'うれしかった出来事のうち2つは、『がんばりを認められること』があったときでした。');
  assert.equal(posOnly.summary, '『がんばりを認められること』を大事にしているのかもしれません。');
  const none = I.valuesInsights([ep('n_promise', 'v_honest'), ep('n_ignored', 'v_respect')], [ep('p_understood', 'v_bond', 'f_moved')]);
  assert.equal(none.empty, true);
  assert.deepEqual(none.candidates.map((x) => x.label), ['約束や正直さ', '気持ちを大切にされること', '人と分かり合うこと']);
  assert.equal(I.teaser('values', valuesData({ neg: [ep('n_promise', 'v_honest'), ep('n_ignored', 'v_respect')], pos: [ep('p_understood', 'v_bond', 'f_moved')] })), '見つけたこと：大事なことの候補が3つ見つかりました');
  // 本人が value を変えると集計が変わる
  const changed = I.valuesInsights([ep('n_promise', 'v_respect'), ep('n_ignored', 'v_respect')], [ep('p_understood', 'v_bond', 'f_moved')]);
  assert.equal(changed.items[0].id, 'v_respect');
  assert.equal(I.valuesInsights([ep('n_promise', 'v_honest')], [ep('p_honest', 'v_honest')]).ready, false, 'under 3 episodes');
});

test('values: gap verdicts', () => {
  const neg = [ep('n_promise', 'v_honest'), ep('n_lie', 'v_honest')]; const pos = [ep('p_honest', 'v_honest', 'f_happy')];
  const ins = I.valuesInsights(neg, pos);
  assert.equal(I.valuesGap(['v_honest'], ins, neg, pos).rows[0].text, '→ 思っていたとおり。心が動いた出来事のうち3つに関わっていました。');
  assert.equal(I.valuesGap(['v_honest'], ins, neg, pos).actual, '');
  assert.equal(I.valuesGap(['v_care'], ins, neg, pos).rows[0].verdict, 'unseen');
  const one = [ep('n_unfair', 'v_fair'), ep('n_lie', 'v_honest')]; const p2 = [ep('p_honest', 'v_honest', 'f_happy')];
  assert.equal(I.valuesGap(['v_fair'], I.valuesInsights(one, p2), one, p2).rows[0].text, '→ 少し当たり。1つの出来事に関わっていました。');
});

// ---- 第3章 ----
const other = (task) => ({ kind: 'k_asked', task, who: '', memo: '' });

test('others: self-only, both, others-only and the all-match note', () => {
  const both = I.othersInsights(['s_listen'], [other('t_listen'), other('t_listen')]);
  assert.equal(both.lines[0].text, '『話を聞くこと』は、自分でも得意だと思っていて、人からも2回頼りにされていました。');
  assert.equal(both.allMatch, true);
  assert.equal(both.lines[1].text, '選んだ得意が、そのまま人にも伝わっているようです。');
  const mixed = I.othersInsights(['s_listen', 's_try'], [other('t_listen'), other('t_teach'), other('t_listen')]);
  assert.deepEqual(mixed.lines.map((l) => l.kind), ['others', 'both', 'self']);
  assert.equal(mixed.lines[2].text, '『新しいことに挑戦すること』は、今回の出来事には出てきませんでした。見せる場面があると、頼りにされるかもしれません。');
  assert.equal(I.othersInsights([], [other('t_listen'), other('t_teach')]).ready, false, 'at least one self pick');
});

test('surprise / try options are pruned when answers change', () => {
  const data = energyData(ex1.input);
  data.energy.surprise = 'b:do_screen'; data.energy.experiment = 'try:do_talk:more';
  assert.equal(I.pruneChoices(data), false);
  data.energy.bad = data.energy.bad.slice(0, 2).map((d) => ({ ...d, doing: ['do_work'], sleep: 'sleep_ok' }));
  assert.equal(I.pruneChoices(data), true);
  assert.equal(data.energy.surprise, '');
  const norm = normalizeData({ ...data, energy: { ...data.energy, surprise: 'g:ghost', experiment: 'try:ghost:more' } });
  assert.equal(norm.energy.surprise, '');
  assert.equal(norm.energy.experiment, '');
});

test('composeManual: no chapter, one chapter, three chapters', () => {
  const none = composeManual(emptyData(), { today: '2026-10-13' });
  assert.equal(none.title, 'わたしの取扱説明書');
  assert.deepEqual(none.sections.map((s) => [s.id, s.state]), [['power', 'todo'], ['warning', 'todo'], ['values', 'todo'], ['request', 'todo'], ['strengths', 'todo'], ['try', 'hidden'], ['surprise', 'hidden']]);
  const one = composeManual({ ...energyData(ex1.input), name: 'のんびり号' }, { today: '2026-10-13' });
  assert.equal(one.title, 'のんびり号 取扱説明書');
  assert.deepEqual(one.sections.map((s) => s.state), ['filled', 'filled', 'todo', 'todo', 'todo', 'hidden', 'hidden']);
  const all = energyData(ex1.input);
  all.values = { prediction: ex2.input.prediction, neg: ex2.input.neg, pos: ex2.input.pos, ...choice };
  all.others = { self: ex3.input.self, episodes: ex3.input.episodes, ...choice };
  all.energy.surpriseText = '話すだけで変わるなんて'; all.values.experiment = 'try:v_honest';
  const three = composeManual(all, { today: '2026-10-13' });
  assert.deepEqual(three.sections.map((s) => s.state), ['filled', 'filled', 'filled', 'filled', 'filled', 'filled', 'filled']);
  assert.deepEqual(three.sections.find((s) => s.id === 'surprise').lines.map((l) => l.text), ['元気のもと：「話すだけで変わるなんて」']);
  assert.deepEqual(three.sections.map((s) => s.number), [1, 2, 3, 4, 5, 6, 7]);
});

test('composeManual: only power-less candidates, and values with no pattern', () => {
  const mkDay = (doing, body = 'body_ok') => ({ who: ['who_pet'], where: ['where_home'], doing: [doing], sleep: 'sleep_ok', body, memo: '' });
  const data = energyData({ good: [mkDay('do_screen'), mkDay('do_screen')], bad: [mkDay('do_work'), mkDay('do_work')] });
  const power = composeManual(data, { today: '2026-10-13' }).sections.find((s) => s.id === 'power');
  assert.deepEqual(power.lines.map((l) => l.text), ['今回の答えでは、調子がよかった日は『スマホや動画を長く見た』でした。']);
  // 体の調子だけの違いは、電源の入れ方にも警告ランプにも使わない
  const bodyOnly = energyData({ good: [mkDay('do_work', 'body_good'), mkDay('do_work', 'body_good')], bad: [mkDay('do_work', 'body_tired'), mkDay('do_work', 'body_tired')] });
  const manualBody = composeManual(bodyOnly, { today: '2026-10-13' });
  assert.equal(manualBody.sections.find((s) => s.id === 'power').state, 'none');
  assert.equal(manualBody.sections.find((s) => s.id === 'warning').state, 'none');
  const insBody = I.energyInsights(bodyOnly.energy.good, bodyOnly.energy.bad);
  assert.equal(insBody.empty, true);
  assert.deepEqual(insBody.extra.good.map((x) => x.tag), ['体が軽い']);
  assert.deepEqual(insBody.extra.bad.map((x) => x.tag), ['疲れていた・だるい']);
  const noPattern = valuesData({ neg: [ep('n_promise', 'v_honest'), ep('n_ignored', 'v_respect')], pos: [ep('p_understood', 'v_bond', 'f_moved')] });
  const manual = composeManual(noPattern, { today: '2026-10-13' });
  assert.equal(manual.sections.find((s) => s.id === 'request').state, 'hidden');
  assert.deepEqual(manual.sections.find((s) => s.id === 'values').lines.map((l) => l.text), ['大事にしていることの候補です。', '約束や正直さ', '気持ちを大切にされること', '人と分かり合うこと']);
});

// ---- 見つける画面の1行（renderEnergyRow） ----
test('renderEnergyRow: tag, both sides with cells and count wording (n日とも / n日中k日 / 0日)', () => {
  const ins = I.energyInsights(ex1.input.good, ex1.input.bad);
  assert.deepEqual(ins.good[0].row, {
    tag: 'ゆっくり話した',
    own: { label: 'よかった日', cells: [true, true, true], count: '3日とも' },
    other: { label: '悪かった日', cells: [false, false, false], count: '0日' },
  });
  assert.deepEqual(ins.bad[0].row, {
    tag: '前の晩が寝不足',
    own: { label: '悪かった日', cells: [true, true, false], count: '3日中2日' },
    other: { label: 'よかった日', cells: [false, false, false], count: '0日' },
  });
  assert.deepEqual(I.renderEnergyRow({ tag: 'x', side: 'good', g: 2, b: 1, nG: 2, nB: 3, goodCells: [true, true], badCells: [true, false, false] }), {
    tag: 'x', own: { label: 'よかった日', cells: [true, true], count: '2日とも' }, other: { label: '悪かった日', cells: [true, false, false], count: '3日中1日' },
  });
  // 既存の文はそのまま（画面では読み上げ用に残す）
  assert.equal(ins.good[0].sentence, ex1.expected.good[0]);
  assert.equal(ins.compareLine, 'よかった日3日と、悪かった日3日を比べました。');
  assert.equal(I.energyInsights(mk(2, 2), mk(0, 4)).compareLine, 'よかった日2日と、悪かった日4日を比べました。');
  assert.equal(ins.summary, 'よかった日には『ゆっくり話した』、悪かった日には『前の晩が寝不足』がありました。');
  assert.equal(I.energyInsights(mk(3, 3), mk(1, 3)).summary, 'よかった日には『ゆっくり話した』がありました。');
});

// ---- 予想と実際：反対が悪かった日に出ていた ----
test('prediction mirror: a missed prediction whose opposite shows up on bad days', () => {
  const ins = I.energyInsights(ex5.input.good, ex5.input.bad);
  const gap = I.energyGap(ex5.input.prediction, ins, ex5.input.good, ex5.input.bad);
  assert.equal(gap.rows[0].verdict, ex5.expected.verdict);
  assert.equal(gap.rows[0].text, ex5.expected.gap);
  assert.equal(gap.hasMiss, true);
  // 当たり（hit）が先
  const mkSleep = (sleep) => Array.from({ length: 3 }, () => ({ who: ['who_pet'], where: ['where_home'], doing: ['do_work'], sleep, body: 'body_ok', memo: '' }));
  const hitGood = mkSleep('sleep_good'); const hitBad = mkSleep('sleep_short');
  assert.equal(I.energyGap(['sleep_good'], I.energyInsights(hitGood, hitBad), hitGood, hitBad).rows[0].verdict, 'hit');
  // 反対が見つけたことになっていなければ mirror にならない
  assert.notEqual(I.energyGap(['do_talk'], I.energyInsights(mk(3, 3), mk(0, 3)), mk(3, 3), mk(0, 3)).rows[0].verdict, 'mirror');
  // 誰かと一緒にいること ↔ ひとりだった：悪かった日にひとりが多ければ mirror
  const mkWho = (list) => list.map((who) => ({ who, where: ['where_home'], doing: ['do_work'], sleep: 'sleep_ok', body: 'body_ok', memo: '' }));
  const peopleGood = mkWho([['who_family'], ['who_pet'], ['who_pet']]);
  const aloneBad = mkWho([['who_alone'], ['who_alone'], ['who_pet']]);
  assert.equal(I.energyGap(['people'], I.energyInsights(peopleGood, aloneBad), peopleGood, aloneBad).rows[0].verdict, 'mirror');
});

test('MIRROR only maps true opposites between existing feature ids', () => {
  const ids = new Set(C.ENERGY_FEATURES.map((f) => f.id));
  for (const [from, to] of Object.entries(C.MIRROR)) { assert.ok(ids.has(from) && ids.has(to), from); assert.notEqual(from, to); }
  assert.deepEqual(C.MIRROR, { sleep_good: 'sleep_short', out: 'home_only', people: 'who_alone', who_alone: 'people' });
});

// ---- 第3章：お礼・ほめられた ----
test('others: wording covers asked / thanked / praised', () => {
  const ep3 = (kind, task = 't_listen') => ({ kind, task, who: '', memo: '' });
  assert.equal(I.othersPhrase(new Set(['k_asked']), 'past'), '頼りにされていました');
  assert.equal(I.othersPhrase(new Set(['k_thanked']), 'past'), 'お礼を言われていました');
  assert.equal(I.othersPhrase(new Set(['k_praised']), 'present'), 'ほめられています');
  assert.equal(I.othersPhrase(new Set(['k_asked', 'k_thanked']), 'past'), '頼られたり、お礼を言われたりしていました');
  assert.equal(I.othersPhrase(new Set(['k_asked', 'k_thanked', 'k_praised']), 'noun'), '頼られたり、お礼を言われたり、ほめられたりしていたこと');
  const ins = I.othersInsights(['s_try'], [ep3('k_praised'), ep3('k_asked')]);
  assert.equal(ins.lines[0].text, '『話を聞くこと』は、自分では選ばなかったけれど、人からは2回頼られたり、ほめられたりしていました。');
  assert.equal(ins.bandOthersLabel, '自分では選ばなかったけれど、人から頼られたり、ほめられたりしていたこと');
  const asked = I.othersInsights(['s_try'], [ep3('k_asked'), ep3('k_asked')]);
  assert.equal(asked.lines[0].text, '『話を聞くこと』は、自分では選ばなかったけれど、人からは2回頼りにされていました。');
  assert.equal(asked.bandOthersLabel, C.COPY.bandOthersOnly);
});

test('others: self-only strengths follow the data order', () => {
  const ins = I.othersInsights(['s_try', 's_cheer', 's_steady'], ex3.input.episodes);
  assert.deepEqual(ins.selfOnly.map((row) => row.id), ['s_cheer', 's_steady', 's_try']);
});

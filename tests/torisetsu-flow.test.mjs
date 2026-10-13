import assert from 'node:assert/strict';
import test from 'node:test';
import { applyAction, setDraftText, createTorisetsuState, torisetsuView, torisetsuViewKey, composeManual, normalizeData } from '../dist/torisetsu.js';
import { COPY } from '../dist/data/torisetsu-content.js';
import { makeCtx, spyStorage, runChapter, fillLayers } from './helpers/torisetsu-flow.mjs';
import * as A from './fixtures/torisetsu/v3-a-office.mjs';
import * as B from './fixtures/torisetsu/v3-b-student.mjs';
import * as Cx from './fixtures/torisetsu/v3-c-retired.mjs';
import * as D from './fixtures/torisetsu/v3-d-nopattern.mjs';

const esc = (value) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const html = (ts) => torisetsuView(ts, { esc, today: '2026-10-13', support: () => '<aside data-support></aside>', imageEnabled: true, canSend: false });
const act = (ts, ctx, action, data = {}) => applyAction(ts, action, data, ctx);
const setup = () => { const ctx = makeCtx(); const ts = createTorisetsuState(); return { ctx, ts }; };
const openHard = (ts, ctx) => {
  act(ts, ctx, 'torisetsu-begin'); act(ts, ctx, 'torisetsu-chapter-start', { chapter: 'needs' }); act(ts, ctx, 'torisetsu-next');
  act(ts, ctx, 'torisetsu-recall-start'); // happy 1
  act(ts, ctx, 'torisetsu-skip-item'); act(ts, ctx, 'torisetsu-skip-item'); // happy 1, 2 を飛ばす → しんどい側の案内
  act(ts, ctx, 'torisetsu-recall-start'); // hard 1
};

test('chapter 1 walks 4 layers for a hard episode and 3 for a happy one, one layer per screen', () => {
  const { ts, ctx } = setup();
  act(ts, ctx, 'torisetsu-begin'); act(ts, ctx, 'torisetsu-chapter-start', { chapter: 'needs' });
  assert.equal(ts.step, 'predict');
  act(ts, ctx, 'torisetsu-next'); assert.equal(ts.step, 'recall-intro'); assert.equal(ts.side, 'happy');
  act(ts, ctx, 'torisetsu-recall-start');
  assert.deepEqual([ts.step, ts.side, ts.layer], ['layer', 'happy', 0]);
  act(ts, ctx, 'torisetsu-layer-next'); act(ts, ctx, 'torisetsu-layer-next');
  assert.equal(ts.layer, 2);
  act(ts, ctx, 'torisetsu-layer-next');
  assert.equal(ts.layer, 2, 'the last layer has no "next"');
  act(ts, ctx, 'torisetsu-record'); // 全部空 = やめておくと同じ
  assert.equal(ts.data.needs.happy.length, 0); assert.deepEqual([ts.side, ts.index, ts.layer], ['happy', 1, 0]);
  act(ts, ctx, 'torisetsu-skip-item');
  assert.equal(ts.step, 'recall-intro'); assert.equal(ts.side, 'hard');
  act(ts, ctx, 'torisetsu-recall-start');
  for (let i = 0; i < 5; i += 1) act(ts, ctx, 'torisetsu-layer-next');
  assert.equal(ts.layer, 3);
  assert.equal(torisetsuViewKey(ts).includes(':3:'), true);
});

test('"record" on a layer that is not the last one does nothing', () => {
  const { ts, ctx } = setup();
  openHard(ts, ctx);
  act(ts, ctx, 'torisetsu-chip', { group: 'scene', chip: 'sc_work' });
  act(ts, ctx, 'torisetsu-record');
  assert.equal(ts.step, 'layer'); assert.equal(ts.layer, 0); assert.equal(ts.data.needs.hard.length, 0);
});

test('back keeps the answers: layer back, and layer 0 goes back to the previous episode at its last layer', () => {
  const { ts, ctx } = setup();
  openHard(ts, ctx);
  setDraftText(ts, '一つ目', 'memo', ctx);
  act(ts, ctx, 'torisetsu-layer-next');
  act(ts, ctx, 'torisetsu-chip', { group: 'surface', chip: 'sf_down' });
  act(ts, ctx, 'torisetsu-layer-next');
  act(ts, ctx, 'torisetsu-chip', { group: 'deep', chip: 'dp_sad' });
  act(ts, ctx, 'torisetsu-back');
  assert.equal(ts.layer, 1); assert.deepEqual(ts.draft.surface, ['sf_down']); assert.deepEqual(ts.draft.deep, ['dp_sad']);
  act(ts, ctx, 'torisetsu-back'); assert.equal(ts.layer, 0); assert.equal(ts.draft.memo, '一つ目');
  // 2 つ目に進んで、層 0 から戻る
  act(ts, ctx, 'torisetsu-layer-next'); act(ts, ctx, 'torisetsu-layer-next'); act(ts, ctx, 'torisetsu-layer-next');
  act(ts, ctx, 'torisetsu-chip', { group: 'needs', chip: 'nd_safe' });
  act(ts, ctx, 'torisetsu-record');
  assert.equal(ts.data.needs.hard.length, 1); assert.deepEqual([ts.index, ts.layer], [1, 0]);
  act(ts, ctx, 'torisetsu-back');
  assert.deepEqual([ts.index, ts.layer], [0, 3], 'the previous episode, at its last layer');
  assert.deepEqual(ts.draft.needs, ['nd_safe']); assert.equal(ts.draft.memo, '一つ目');
});

test('"この出来事はやめておく" discards the draft and moves on; "わからないので飛ばす" records what was answered so far', () => {
  const { ts, ctx } = setup();
  openHard(ts, ctx);
  setDraftText(ts, 'やめる', 'memo', ctx);
  act(ts, ctx, 'torisetsu-skip-item');
  assert.equal(ts.data.needs.hard.length, 0); assert.equal(ts.index, 1);
  act(ts, ctx, 'torisetsu-chip', { group: 'scene', chip: 'sc_alone' });
  act(ts, ctx, 'torisetsu-layer-next');
  act(ts, ctx, 'torisetsu-chip', { group: 'surface', chip: 'sf_drained' });
  act(ts, ctx, 'torisetsu-layer-skip'); // 表の気持ちは飛ばす → 選んでいても入らない
  assert.equal(ts.layer, 2); assert.deepEqual(ts.draft.surface, []);
  act(ts, ctx, 'torisetsu-layer-skip');
  assert.equal(ts.layer, 3);
  act(ts, ctx, 'torisetsu-layer-skip'); // 最後の層を飛ばしても、それまでの答えで記録
  assert.equal(ts.data.needs.hard.length, 1);
  assert.deepEqual(ts.data.needs.hard[0], { scene: 'sc_alone', memo: '', surface: '', deep: [], needs: [] });
  assert.equal(ts.index, 2);
});

test('every question can be skipped: a whole chapter of skips records nothing and the chapter shows the short screen', () => {
  const { ts, ctx } = setup();
  act(ts, ctx, 'torisetsu-begin'); act(ts, ctx, 'torisetsu-chapter-start', { chapter: 'needs' });
  act(ts, ctx, 'torisetsu-next'); // 予想は選ばなくても進める
  act(ts, ctx, 'torisetsu-recall-start');
  for (let i = 0; i < 2; i += 1) act(ts, ctx, 'torisetsu-skip-item');
  act(ts, ctx, 'torisetsu-recall-start');
  for (let i = 0; i < 3; i += 1) act(ts, ctx, 'torisetsu-skip-item');
  assert.equal(ts.step, 'short');
  assert.equal(ts.data.needs.happy.length + ts.data.needs.hard.length, 0);
  const view = html(ts);
  assert.ok(view.includes('合わせて3つ以上あると、くり返しが見つけやすくなります。小さなことでも大丈夫です。'));
  assert.ok(view.includes('もう1つ思い出す') && view.includes('あとにする（目次へ）'));
});

test('guidance is shown before recalling; each layer screen has a skip and the hard first screen has the drop option', () => {
  const { ts, ctx } = setup();
  act(ts, ctx, 'torisetsu-begin'); act(ts, ctx, 'torisetsu-chapter-start', { chapter: 'needs' }); act(ts, ctx, 'torisetsu-next');
  assert.ok(html(ts).includes('この1〜2週間の、小さなことで大丈夫です。'));
  act(ts, ctx, 'torisetsu-recall-start'); act(ts, ctx, 'torisetsu-skip-item'); act(ts, ctx, 'torisetsu-skip-item');
  const intro = html(ts);
  assert.ok(intro.includes('最近の小さな出来事で大丈夫です。「ちょっとモヤッとした」くらいでOK。'));
  assert.ok(intro.includes('昔のつらいことや、思い出すと苦しくなることは、選ばないでね。'));
  act(ts, ctx, 'torisetsu-recall-start');
  const first = html(ts);
  assert.ok(first.includes('この出来事はやめておく')); assert.ok(first.includes('例：会議で意見を流された')); assert.ok(first.includes('出来事</li>'));
  act(ts, ctx, 'torisetsu-chip', { group: 'scene', chip: 'sc_work' }); setDraftText(ts, '会議で意見を流された', 'memo', ctx);
  act(ts, ctx, 'torisetsu-layer-next');
  const second = html(ts);
  assert.ok(second.includes('そのとき、表に出た気持ちは？')); assert.ok(second.includes('わからないので飛ばす')); assert.ok(second.includes('class="ts-crumb"'));
  act(ts, ctx, 'torisetsu-chip', { group: 'surface', chip: 'sf_irritated' }); act(ts, ctx, 'torisetsu-layer-next');
  const third = html(ts);
  assert.ok(third.includes('『イライラした』の、もう少し奥には？')); assert.ok(third.includes('表の気持ちの下に、別の気持ちがかくれていることがあります。'));
  assert.ok(third.includes('会議で意見を流された ／ イライラした'));
  act(ts, ctx, 'torisetsu-layer-skip');
  assert.ok(html(ts).includes('本当は、どうなってほしかった？'));
  assert.ok(html(ts).includes('この出来事を記録する'));
});

test('a layer screen with no surface feeling asks about "そのときの気持ち" instead', () => {
  const { ts, ctx } = setup();
  openHard(ts, ctx);
  act(ts, ctx, 'torisetsu-layer-next'); act(ts, ctx, 'torisetsu-layer-next');
  assert.ok(html(ts).includes('そのときの気持ちの、もう少し奥には？'));
});

test('limits: surface 1, deep 2, needs 2 per episode; the third is refused with the message', () => {
  const { ts, ctx } = setup();
  openHard(ts, ctx);
  act(ts, ctx, 'torisetsu-layer-next');
  act(ts, ctx, 'torisetsu-chip', { group: 'surface', chip: 'sf_down' }); act(ts, ctx, 'torisetsu-chip', { group: 'surface', chip: 'sf_rushed' });
  assert.deepEqual(ts.draft.surface, ['sf_rushed']);
  act(ts, ctx, 'torisetsu-layer-next');
  for (const chip of ['dp_sad', 'dp_lonely', 'dp_empty']) act(ts, ctx, 'torisetsu-chip', { group: 'deep', chip });
  assert.deepEqual(ts.draft.deep, ['dp_sad', 'dp_lonely']); assert.equal(ts.limitMessage, '2つまでです。どれかを外すと選べます。');
  act(ts, ctx, 'torisetsu-chip', { group: 'deep', chip: 'dp_sad' });
  assert.deepEqual(ts.draft.deep, ['dp_lonely']);
  act(ts, ctx, 'torisetsu-chip', { group: 'deep', chip: 'not-a-chip' });
  assert.deepEqual(ts.draft.deep, ['dp_lonely']);
});

test('running example A through the real actions produces the fixture data and the fixed findings', () => {
  const { ts, ctx } = setup();
  runChapter(ts, ctx, 'needs', A.data, { stopAt: 'insight' });
  assert.equal(ts.step, 'insight');
  assert.deepEqual(ts.data.needs.happy, A.data.happy); assert.deepEqual(ts.data.needs.hard, A.data.hard); assert.deepEqual(ts.data.needs.prediction, A.data.prediction);
  const insightViews = [];
  for (const row of A.expected.rows) {
    let view = html(ts); let guard = 0;
    while (!view.includes(esc(row.heading)) && ts.step === 'insight' && guard++ < 12) {
      act(ts, ctx, 'torisetsu-insight-page', { direction: 'next' }); view = html(ts);
    }
    insightViews.push(view);
    assert.ok(view.includes(esc(row.heading)), row.heading); assert.ok(view.includes(esc(row.sentence)), row.sentence); assert.ok(view.includes(row.band));
  }
  const view = insightViews.join('');
  assert.ok(view.includes(esc(A.expected.sceneLine)));
  assert.ok(view.includes(esc(A.expected.footer + A.expected.footerAdd)));
  assert.match(html(ts), /data-action="torisetsu-compare"/);
  act(ts, ctx, 'torisetsu-compare');
  assert.equal(ts.step, 'gap');
  const gap = html(ts);
  assert.ok(gap.includes(esc(A.expected.gap))); assert.ok(gap.includes(esc(A.expected.actual))); assert.ok(gap.includes(esc(A.expected.gapThought)));
});

test('the lineup groups rows by layer, marks the layers happy episodes were not asked, and folds single appearances', () => {
  const { ts, ctx } = setup();
  runChapter(ts, ctx, 'needs', A.data, { stopAt: 'lineup' });
  assert.equal(ts.step, 'lineup');
  const view = html(ts);
  assert.ok(view.includes('並べてみよう'));
  for (const label of ['表の気持ち', '奥の気持ち', '本当の願い・満たされたもの']) assert.ok(view.includes(`scope="rowgroup" colspan="6">${label}</th>`), label);
  assert.ok(view.includes('aria-label="この出来事には聞いていません"'));
  assert.ok(view.includes('<th scope="colgroup" colspan="2" class="is-good">うれしかった</th>'));
  assert.ok(view.includes('<details class="ts-lineup-more"><summary>1つだけに出たこと（'));
  assert.ok(view.includes('出来事：うれしかった1 友だちのこと「久しぶりに友だちと長電話」'));
  assert.ok(view.includes('出来事はバラバラでも、奥に同じものがある？'));
  assert.ok(view.includes('共通点を探す'));
  assert.match(view, /<th scope="row">イライラ<\/th>/);
});

test('example D shows the "not clear yet" screen with add buttons; example E works with no happy answers', () => {
  const { ts, ctx } = setup();
  runChapter(ts, ctx, 'needs', D.data, { stopAt: 'insight' });
  const view = html(ts);
  assert.ok(view.includes(esc(D.expected.title))); assert.ok(view.includes(esc(D.expected.body))); assert.ok(view.includes(esc(D.expected.near)));
  assert.ok(view.includes(esc(D.expected.list)));
  assert.ok(view.includes('うれしかった出来事を足す') && view.includes('しんどかった出来事を足す') && view.includes('このまま進む'));
  act(ts, ctx, 'torisetsu-add-item', { side: 'happy', returnTo: 'insight' });
  assert.deepEqual([ts.step, ts.side, ts.phase, ts.returnTo], ['layer', 'happy', 'edit', 'insight']);
  const e = setup();
  runChapter(e.ts, e.ctx, 'needs', { prediction: [], happy: [null, null], hard: [{ scene: '', memo: '', surface: 'sf_rushed', deep: ['dp_expect'], needs: ['nd_safe'] }, { scene: '', memo: '', surface: 'sf_rushed', deep: ['dp_expect'], needs: ['nd_safe'] }, { scene: '', memo: '', surface: 'sf_foggy', deep: ['dp_sad'], needs: [] }] }, { stopAt: 'insight' });
  assert.equal(e.ts.step, 'insight');
  assert.ok(html(e.ts).includes('しんどかった3つの答えから見えたことです。決まりではありません。'));
});

test('editing from the list: change one episode, add one, delete one', () => {
  const { ts, ctx } = setup();
  runChapter(ts, ctx, 'needs', A.data, { stopAt: 'insight' });
  act(ts, ctx, 'torisetsu-days');
  const list = html(ts);
  assert.ok(list.includes('思い出した出来事')); assert.ok(list.includes('友だちのこと「久しぶりに友だちと長電話」／ほっとした')); assert.ok(list.includes('学校や仕事のこと「会議で意見を流された」／イライラした'));
  assert.ok(list.includes('＋ もう1つ足す'));
  act(ts, ctx, 'torisetsu-edit-item', { side: 'hard', index: '2' });
  assert.deepEqual([ts.step, ts.phase, ts.layer], ['layer', 'edit', 0]);
  assert.equal(ts.draft.memo, '休みの日、何もできなかった');
  act(ts, ctx, 'torisetsu-delete-item');
  assert.equal(ts.data.needs.hard.length, 2); assert.equal(ts.step, 'days');
  act(ts, ctx, 'torisetsu-add-item', { side: 'hard', returnTo: 'days' });
  fillLayers(ts, ctx, 'hard', { scene: 'sc_net', memo: 'ネットで炎上を見た', surface: 'sf_foggy', deep: ['dp_anxious'], needs: ['nd_safe'] });
  assert.equal(ts.data.needs.hard.length, 3); assert.equal(ts.step, 'days');
});

// ---------- 第 2 章 ----------
test('chapter 2 has no prediction, opens on the recall intro, and the five steps are named', () => {
  const { ts, ctx } = setup();
  act(ts, ctx, 'torisetsu-begin'); act(ts, ctx, 'torisetsu-chapter-start', { chapter: 'voice' });
  assert.equal(ts.step, 'recall-intro');
  const view = html(ts);
  assert.ok(view.includes('しんどかったり、自分にがっかりしたりした場面を、3つ思い出そう'));
  assert.ok(view.includes('昔のつらいことや、思い出すと苦しくなることは、選ばないでね。'));
  assert.ok(!view.includes('第1章の「しんどかった出来事」を使う'), 'only when chapter 1 has hard episodes');
  ['思い出す', '並べる', '見つける', '声に返す', 'ためす'].forEach((label) => assert.ok(view.includes(`>${label}</li>`), label));
  act(ts, ctx, 'torisetsu-back'); assert.equal(ts.view, 'contents');
});

test('"use chapter 1" copies only the scene and the memo of up to 3 hard episodes, as a copy', () => {
  const { ts, ctx } = setup();
  runChapter(ts, ctx, 'needs', A.data);
  act(ts, ctx, 'torisetsu-chapter-start', { chapter: 'voice' });
  assert.ok(html(ts).includes('第1章の「しんどかった出来事」を使う'));
  act(ts, ctx, 'torisetsu-copy-hard');
  assert.deepEqual([ts.step, ts.side, ts.index], ['episode', 'voice', 0]);
  assert.deepEqual(ts.draft, { scene: ['sc_work'], thoughts: [], memo: '会議で意見を流された' });
  act(ts, ctx, 'torisetsu-chip', { group: 'thoughts', chip: 'th_nogood' }); act(ts, ctx, 'torisetsu-record');
  assert.deepEqual(ts.draft, { scene: ['sc_family'], thoughts: [], memo: '家の用事を全部やっていた' });
  act(ts, ctx, 'torisetsu-skip-item');
  assert.deepEqual(ts.draft, { scene: ['sc_alone'], thoughts: [], memo: '休みの日、何もできなかった' });
  // コピーなので、第 1 章を直しても第 2 章は変わらない
  const copied = JSON.stringify(ts.data.voice.episodes);
  ts.data.needs.hard[0].memo = '変えた';
  assert.equal(JSON.stringify(ts.data.voice.episodes), copied);
  assert.equal(ts.data.voice.episodes[0].thoughts.length, 1, 'the voices are chosen again, not copied');
});

test('a scene needs at least one voice; the record button explains what is missing', () => {
  const { ts, ctx } = setup();
  act(ts, ctx, 'torisetsu-begin'); act(ts, ctx, 'torisetsu-chapter-start', { chapter: 'voice' }); act(ts, ctx, 'torisetsu-recall-start');
  const result = act(ts, ctx, 'torisetsu-record');
  assert.equal(ts.data.voice.episodes.length, 0); assert.equal(result.focus, '[data-ts-missing]');
  assert.equal(ts.missingMessage, '選んでいないところがあります：頭の中の声');
  assert.ok(html(ts).includes('aria-disabled="true"')); assert.ok(html(ts).includes('声は思い出せないので飛ばす'));
  act(ts, ctx, 'torisetsu-chip', { group: 'thoughts', chip: 'th_nobody' });
  act(ts, ctx, 'torisetsu-chip', { group: 'thoughts', chip: 'th_end' });
  act(ts, ctx, 'torisetsu-chip', { group: 'thoughts', chip: 'th_burden' });
  assert.deepEqual(ts.draft.thoughts, ['th_nobody', 'th_end']);
});

test('example B through the actions: protect → reply → surprise → try → done, with the focus switch and the free reply', () => {
  const { ts, ctx } = setup();
  runChapter(ts, ctx, 'voice', { ...B.data, reply: '', replyText: '' }, { stopAt: 'insight' });
  assert.equal(ts.step, 'insight');
  const insight = html(ts);
  assert.ok(insight.includes(esc(B.expected.rows[0].sentence))); assert.ok(insight.includes('・●●</span> 3つ中2つ'));
  assert.ok(!insight.includes('ts-heavy'));
  act(ts, ctx, 'torisetsu-compare');
  assert.equal(ts.step, 'protect');
  let view = html(ts);
  assert.ok(view.includes('『嫌われたかも』『迷惑をかけている』という声')); assert.ok(view.includes('その声は、何を守ろうとしていると思う？')); assert.ok(view.includes('きびしい声も、じつは自分を守ろうとしていることがあります。'));
  assert.ok(view.includes('ほかの声にする'));
  act(ts, ctx, 'torisetsu-focus-open');
  assert.ok(html(ts).includes('自分を責める声') && html(ts).includes('人と比べる声'));
  act(ts, ctx, 'torisetsu-focus-set', { chip: 'pt_blame' });
  assert.equal(ts.data.voice.focus, 'pt_blame'); assert.equal(ts.focusPicker, false);
  view = html(ts);
  assert.ok(view.includes('『自分はダメだ』という声'), 'ダメ appears only inside the chip and 『』');
  act(ts, ctx, 'torisetsu-chip', { group: 'intents', chip: 'in_fail' });
  act(ts, ctx, 'torisetsu-protect-next');
  assert.equal(ts.step, 'reply');
  view = html(ts);
  assert.ok(view.includes('大事な友だちが同じことを言っていたら、何て返す？')); assert.ok(view.includes('「自分はダメだ」と、友だちが言っていたら。'));
  assert.ok(view.includes('それだけ真剣だったんだね') && view.includes('よくやってるよ') && !view.includes('聞いてみないと、わからないよ'));
  act(ts, ctx, 'torisetsu-chip', { group: 'reply', chip: 'rp_blame2' });
  assert.equal(ts.data.voice.reply, 'rp_blame2');
  act(ts, ctx, 'torisetsu-text-open', { kind: 'reply' });
  setDraftText(ts, '気にしすぎだよ、大丈夫', 'reply', ctx);
  assert.equal(ts.data.voice.reply, '', 'writing your own replaces the chip'); assert.equal(ts.data.voice.replyText, '気にしすぎだよ、大丈夫');
  assert.match(html(ts), /placeholder="例：気にしすぎだよ、大丈夫"/);
  act(ts, ctx, 'torisetsu-reply-next'); assert.equal(ts.step, 'surprise');
  act(ts, ctx, 'torisetsu-back'); assert.equal(ts.step, 'reply'); act(ts, ctx, 'torisetsu-back'); assert.equal(ts.step, 'protect');
  act(ts, ctx, 'torisetsu-protect-next', { key: 'skip' });
  assert.deepEqual(ts.data.voice.intents, []);
  act(ts, ctx, 'torisetsu-reply-next');
  act(ts, ctx, 'torisetsu-surprise-next'); act(ts, ctx, 'torisetsu-finish');
  assert.equal(ts.step, 'done'); assert.equal(ts.data.voice.done, true);
  const manual = composeManual(ts.data, { today: '2026-10-13' });
  assert.ok(manual.sections.find((s) => s.id === 'voice').lines.some((l) => l.text === '「気にしすぎだよ、大丈夫」'));
});

test('done progress counts completed chapters without marking earlier chapters complete', () => {
  const { ts, ctx } = setup();
  runChapter(ts, ctx, 'voice', B.data, { stopAt: 'done' });
  const view = html(ts);
  assert.match(view, /ts-done-progress-count[^>]*>完了 1 \/ 3</);
  assert.match(view, /ts-done-chapter-marker is-done is-current/);
  assert.match(view, /ts-done-chapter-marker[^>]*><span>1<\/span>/);
  assert.doesNotMatch(view, /ts-done-chapter-marker is-done[^>]*><span>1<\/span>/);
});

test('a focus whose scenes are later removed falls back, and its stale reply is dropped', () => {
  const { ts, ctx } = setup();
  runChapter(ts, ctx, 'voice', B.data, { stopAt: 'insight' });
  act(ts, ctx, 'torisetsu-compare'); act(ts, ctx, 'torisetsu-focus-set', { chip: 'pt_blame' });
  act(ts, ctx, 'torisetsu-protect-next');
  act(ts, ctx, 'torisetsu-chip', { group: 'reply', chip: 'rp_any1' });
  assert.equal(ts.data.voice.reply, 'rp_any1');
  ts.data.voice.episodes = ts.data.voice.episodes.slice(1);
  const clean = normalizeData(ts.data);
  assert.equal(clean.voice.focus, '');
});

test('the heavy-note sentence and the support block appear on the finding screen only under the condition', () => {
  const { ts, ctx } = setup();
  const heavyData = { episodes: [{ scene: 'sc_work', memo: '', thoughts: ['th_noweak'] }, { scene: 'sc_alone', memo: '', thoughts: ['th_nogood'] }, null] };
  runChapter(ts, ctx, 'voice', heavyData, { stopAt: 'insight' });
  const view = html(ts);
  assert.ok(view.includes('しんどさが続いているときは、ひとりで抱えずに、話せる人や相談先を頼ってみてね。')); assert.ok(view.includes('data-support'));
  const light = setup();
  runChapter(light.ts, light.ctx, 'voice', B.data, { stopAt: 'insight' });
  assert.ok(!html(light.ts).includes('しんどさが続いているときは'));
});

// ---------- 第 3 章 ----------
test('example C through the actions, including the admire step and its skip', () => {
  const { ts, ctx } = setup();
  runChapter(ts, ctx, 'values', Cx.data, { stopAt: 'lineup' });
  assert.equal(ts.step, 'lineup');
  assert.deepEqual(ts.data.values.admire, { who: 'aw_near', qualities: [{ id: 'ql_respect', value: 'vl_respect' }, { id: 'ql_free', value: 'vl_free' }], memo: '近所の80代の先輩' });
  const view = html(ts);
  assert.ok(view.includes('いいなと思った人（身近な人「近所の80代の先輩」）')); assert.ok(view.includes('→ 一人ひとりを大切にすること'));
  act(ts, ctx, 'torisetsu-value-open', { side: 'admire', index: '1' }); assert.ok(html(ts).includes('aria-expanded="true"'));
  act(ts, ctx, 'torisetsu-value-set', { side: 'admire', index: '1', chip: 'vl_respect' });
  assert.equal(ts.data.values.admire.qualities[1].value, 'vl_respect');
  act(ts, ctx, 'torisetsu-find'); act(ts, ctx, 'torisetsu-compare');
  assert.equal(ts.step, 'gap');
  // いいなと思った人を飛ばす
  const skip = setup();
  runChapter(skip.ts, skip.ctx, 'values', { ...Cx.data, admire: null }, { stopAt: 'lineup' });
  assert.equal(skip.ts.data.values.admire, null); assert.equal(skip.ts.step, 'lineup');
  assert.ok(!html(skip.ts).includes('いいなと思った人（'));
});

test('the admire step needs a quality to record, is skippable, and back returns to the last pleasant episode', () => {
  const { ts, ctx } = setup();
  act(ts, ctx, 'torisetsu-begin'); act(ts, ctx, 'torisetsu-chapter-start', { chapter: 'values' }); act(ts, ctx, 'torisetsu-next');
  act(ts, ctx, 'torisetsu-recall-start'); act(ts, ctx, 'torisetsu-skip-item'); act(ts, ctx, 'torisetsu-skip-item');
  act(ts, ctx, 'torisetsu-recall-start'); act(ts, ctx, 'torisetsu-skip-item'); act(ts, ctx, 'torisetsu-skip-item');
  assert.equal(ts.step, 'admire');
  const view = html(ts);
  assert.ok(view.includes('最近「いいな」「あんなふうになれたら」と思った人はいる？')); assert.ok(view.includes('思いつかないので飛ばす')); assert.ok(view.includes('その人の、どこがいいと思った？'));
  act(ts, ctx, 'torisetsu-record');
  assert.equal(ts.data.values.admire, null); assert.equal(ts.step, 'admire'); assert.match(ts.missingMessage, /どこがいいか/);
  act(ts, ctx, 'torisetsu-back'); assert.deepEqual([ts.step, ts.side, ts.index], ['episode', 'pos', 1]);
});

test('prediction is only in chapters 1 and 3; the voice chapter has no gap screen', () => {
  const { ts, ctx } = setup();
  runChapter(ts, ctx, 'voice', B.data, { stopAt: 'insight' });
  act(ts, ctx, 'torisetsu-compare'); assert.equal(ts.step, 'protect');
  const c1 = setup(); runChapter(c1.ts, c1.ctx, 'needs', { ...A.data, prediction: [] }, { stopAt: 'insight' });
  act(c1.ts, c1.ctx, 'torisetsu-compare'); assert.equal(c1.ts.step, 'surprise', 'no prediction chosen: no comparison screen');
  assert.ok(html(c1.ts).includes('いちばん意外だったことは？'));
});

// ---------- 全体 ----------
test('all texts are escaped, in text and in attributes', () => {
  const { ts, ctx } = setup();
  const evil = '<img src=x onerror=alert(1)>"\'&';
  const fixedArtSrcs = new Set([
    './assets/torisetsu-gallery/arrival-gallery.png',
    './assets/torisetsu-gallery/deep-layers.png',
    './assets/torisetsu-gallery/discovery-sculpture.png',
    './assets/torisetsu-gallery/book-cover-architecture.png',
  ]);
  const assertSafeImages = (markup) => {
    const images = [...markup.matchAll(/<img\b[^>]*\bsrc="([^"]+)"[^>]*>/g)].map(([, src]) => src);
    assert.ok(images.every((src) => fixedArtSrcs.has(src)), 'unexpected image srcs: ' + images.join(','));
    assert.doesNotMatch(markup, /<img\s+src=x\s+onerror=/);
  };
  runChapter(ts, ctx, 'needs', { ...A.data, happy: A.data.happy.map((ep) => ({ ...ep, memo: evil })), hard: A.data.hard.map((ep) => ({ ...ep, memo: evil })) }, { stopAt: 'lineup' });
  const lineup = html(ts);
  assertSafeImages(lineup); assert.ok(lineup.includes('&lt;img src=x onerror=alert(1)&gt;'));
  act(ts, ctx, 'torisetsu-days');
  assertSafeImages(html(ts));
  act(ts, ctx, 'torisetsu-edit-item', { side: 'hard', index: '0' });
  const edit = html(ts);
  assertSafeImages(edit); assert.match(edit, /value="&lt;img src=x onerror=alert\(1\)&gt;&quot;/);
  act(ts, ctx, 'torisetsu-name-open'); setDraftText(ts, '"><b>x</b>', 'name', ctx);
  ts.data.name = '"><b>x</b>';
  act(ts, ctx, 'torisetsu-manual');
  const manual = html(ts);
  assertSafeImages(manual); assert.ok(!manual.includes('<b>x</b>'));
  const voice = setup();
  runChapter(voice.ts, voice.ctx, 'voice', { ...B.data, reply: '', replyText: '<script>alert(1)</script>' }, { stopAt: 'done' });
  const done = html(voice.ts);
  assert.ok(!done.includes('<script>alert')); assert.ok(done.includes('&lt;script&gt;'));
});

test('no view in any chapter says あなた, and ダメ appears only inside 『』 or the voice chip', () => {
  const { ts, ctx } = setup();
  const pages = [];
  const grab = () => pages.push(html(ts));
  runChapter(ts, ctx, 'needs', A.data, { stopAt: 'lineup' }); grab();
  act(ts, ctx, 'torisetsu-find'); grab(); act(ts, ctx, 'torisetsu-compare'); grab(); act(ts, ctx, 'torisetsu-gap-next'); grab(); act(ts, ctx, 'torisetsu-surprise-next'); grab(); act(ts, ctx, 'torisetsu-finish'); grab();
  runChapter(ts, ctx, 'voice', B.data, { stopAt: 'lineup' }); grab();
  act(ts, ctx, 'torisetsu-find'); grab(); act(ts, ctx, 'torisetsu-compare'); grab(); act(ts, ctx, 'torisetsu-protect-next'); grab(); act(ts, ctx, 'torisetsu-reply-next'); grab(); act(ts, ctx, 'torisetsu-surprise-next'); grab(); act(ts, ctx, 'torisetsu-finish'); grab();
  runChapter(ts, ctx, 'values', Cx.data, { stopAt: 'lineup' }); grab();
  act(ts, ctx, 'torisetsu-find'); grab(); act(ts, ctx, 'torisetsu-chapter-days', { chapter: 'values' }); grab();
  act(ts, ctx, 'torisetsu-manual'); grab(); act(ts, ctx, 'torisetsu-contents'); grab();
  for (const page of pages) {
    const text = page.replace(/<[^>]*>/g, ' ');
    assert.doesNotMatch(text, /あなた/);
    // ダメ は「声」のチップ（th_nogood）と『』の中だけ
    const stripped = text.replace(/『[^』]*』/g, '').replace(/自分はダメだ/g, '');
    assert.doesNotMatch(stripped, /ダメ/);
  }
  assert.ok(pages.length > 15);
});

test('the manual lists the 7 sections in a fixed order and shows empty ones with the right hint', () => {
  const { ts, ctx } = setup();
  runChapter(ts, ctx, 'needs', A.data, { surprise: A.data.surprise, experiment: A.data.experiment });
  act(ts, ctx, 'torisetsu-manual');
  const visibleSections = composeManual(ts.data, { today: '2026-10-13' }).sections.filter((section) => section.state !== 'hidden');
  const views = [];
  for (const section of visibleSections) { act(ts, ctx, 'torisetsu-manual-section', { id: section.id }); views.push(html(ts)); }
  const view = views.join('');
  const titles = ['満たされると元気になるもの', '揺れやすいところ', '周りの人へのお願い', '頭の中の声と、かけたい言葉', '大事にしていること', '来週ためしてみること', 'いちばん意外だったこと'];
  let at = -1;
  for (const title of titles) { const i = view.indexOf(`<span>${title}</span>`); assert.ok(i > at, title); at = i; }
  assert.ok(view.includes('まだ調べていません'));
  assert.ok(view.includes('満たされるもの、足りないもの'));
  assert.ok(view.includes('本製品は、ときどき休ませると長持ちします。'));
  assert.ok(view.includes('この端末に残す？'));
});

test('the contents screen shows each chapter with the finding teaser once it is ready', () => {
  const { ts, ctx } = setup();
  runChapter(ts, ctx, 'needs', A.data);
  act(ts, ctx, 'torisetsu-contents');
  const view = html(ts);
  assert.ok(view.includes('3章中1章できた')); assert.ok(view.includes(esc(A.expected.teaser)));
  assert.ok(view.includes('満たされるもの、足りないもの') && view.includes('頭の中の声') && view.includes('心が動くとき'));
  assert.ok(view.includes('出来事の奥にある気持ちをたどる') && view.includes('しんどいときの声と、かけたい言葉') && view.includes('イラッと・じーんの裏にある大事なこと'));
});

test('leaving: closing before saving asks first; the done screen offers saving; the start screen with a save offers delete', () => {
  const { ts, ctx } = setup();
  act(ts, ctx, 'torisetsu-begin');
  assert.deepEqual(act(ts, ctx, 'torisetsu-back'), { leave: true });
  runChapter(ts, ctx, 'needs', A.data);
  assert.ok(html(ts).includes('この端末に残す？'));
  act(ts, ctx, 'torisetsu-contents');
  const ask = act(ts, ctx, 'torisetsu-back');
  assert.equal(ts.leaveConfirm, true); assert.equal(ask.render, true);
  assert.ok(html(ts).includes('戻って残す'));
  act(ts, ctx, 'torisetsu-leave-keep');
  act(ts, ctx, 'torisetsu-save');
  assert.equal(ts.persisted, true);
  assert.deepEqual(act(ts, ctx, 'torisetsu-back'), { render: true, scrollTop: true });
  assert.deepEqual(act(ts, ctx, 'torisetsu-back'), { leave: true });
  const again = createTorisetsuState({ stored: { data: ts.data, persisted: true, savedAt: '2026-10-13' } });
  const start = html(again);
  assert.ok(start.includes('前に作ったトリセツがあります')); assert.ok(start.includes('2026年10月13日に保存')); assert.ok(start.includes('このトリセツを消す'));
  void COPY; void spyStorage;
});

// ---------- レビュー修正（ブロッカー・小さな直し） ----------
const gotoInsight = (chapterId, chapterData) => {
  const { ts, ctx } = setup();
  ts.data = normalizeData({ [chapterId]: chapterData });
  ts.view = 'step'; ts.chapterId = chapterId; ts.step = 'insight';
  return { ts, ctx };
};
const hardEp = (surface, deep, needs) => ({ scene: 'sc_work', memo: '', surface, deep, needs });
const NO_PATTERN_5 = [
  hardEp('sf_irritated', ['dp_empty'], ['nd_understood']), hardEp('sf_down', ['dp_full'], ['nd_speak']),
  hardEp('sf_rushed', ['dp_anxious'], ['nd_respect']), hardEp('sf_foggy', ['dp_lonely'], ['nd_recognized']), hardEp('sf_letdown', ['dp_sad'], ['nd_belong']),
];

test('no-pattern screen of chapter 1 still shows the heavy note, and keeps 出来事を直す・足す even at the maximum', () => {
  const { ts } = gotoInsight('needs', { prediction: [], happy: [], hard: NO_PATTERN_5 });
  const view = html(ts);
  assert.ok(view.includes(esc(COPY.insightNoneTitle)), 'no pattern');
  assert.ok(view.includes('しんどさが続いているときは') && view.includes('data-support'));
  assert.ok(view.includes('data-action="torisetsu-days"') && view.includes('出来事を直す・足す'));
  assert.ok(!view.includes('しんどかった出来事を足す'), 'the add button is gone at 5');
});

test('no-pattern screens of chapters 2 and 3 offer 場面を直す・足す / 出来事を直す・足す', () => {
  const v = gotoInsight('voice', { episodes: [{ scene: 'sc_work', memo: '', thoughts: ['th_nogood'] }, { scene: 'sc_alone', memo: '', thoughts: ['th_disliked'] }, { scene: 'sc_family', memo: '', thoughts: ['th_must'] }] });
  const voiceView = html(v.ts);
  assert.ok(voiceView.includes(esc(COPY.voiceNoneTitle)), 'no pattern in chapter 2');
  assert.ok(voiceView.includes('data-action="torisetsu-days"') && voiceView.includes('場面を直す・足す'));
  const n = gotoInsight('values', { prediction: [], neg: [{ situation: 'sv_promise', memo: '', value: 'va_fair' }], pos: [{ situation: 'sv_kind', memo: '', value: 'va_kind' }], admire: null });
  const valuesView = html(n.ts);
  assert.ok(valuesView.includes('data-action="torisetsu-days"') && valuesView.includes('出来事を直す・足す'));
});

test('a side with exactly one episode never reads 「1つとも」', () => {
  const { ts } = gotoInsight('needs', { prediction: [], happy: [{ scene: 'sc_friend', memo: '', feelings: [], needs: ['nd_understood'] }], hard: [hardEp('sf_down', ['dp_sad'], ['nd_understood']), hardEp('sf_down', ['dp_sad'], ['nd_understood']), hardEp('sf_rushed', ['dp_anxious'], ['nd_safe'])] });
  const view = html(ts);
  assert.ok(!view.includes('1つとも'));
  assert.match(view, /うれしかった <span class="ts-dots">●<\/span> 1つ</, 'row says 1つ');
  assert.ok(view.includes('うれしかった1つで『わかってもらえた』'));
});

test('chapter 2 manual: voices chosen but protect and reply skipped end with the soft lines', () => {
  const { ts, ctx } = setup();
  runChapter(ts, ctx, 'voice', { ...B.data, intents: [], reply: '', replyText: '' });
  const lines = composeManual(ts.data, { today: '2026-10-13' }).sections.find((s) => s.id === 'voice').lines.map((l) => l.text);
  assert.ok(lines.includes('きびしい声も、自分を守ろうとしていることがあります。'));
  assert.ok(lines.includes('そんなときに、自分にかけたい言葉') && lines.includes('「よくやってるよ」'));
  const withReply = composeManual({ ...ts.data, voice: { ...ts.data.voice, reply: 'rp_any2' } }, { today: '2026-10-13' }).sections.find((s) => s.id === 'voice').lines.map((l) => l.text);
  assert.ok(!withReply.includes('きびしい声も、自分を守ろうとしていることがあります。'));
});

test('chapter 2 teaser names the heart habit instead of quoting a single harsh voice', () => {
  const { ts, ctx } = setup();
  runChapter(ts, ctx, 'voice', { episodes: [{ scene: 'sc_work', memo: '', thoughts: ['th_nogood'] }, { scene: 'sc_alone', memo: '', thoughts: ['th_nogood'] }, null], intents: [], reply: '', replyText: '' });
  act(ts, ctx, 'torisetsu-contents');
  const view = html(ts);
  assert.ok(view.includes('『自分を責める』声に気づいた') || view.includes('声に気づいた') || view.includes('声がくり返していました'));
  assert.ok(!view.includes('『自分はダメだ』という声'));
});

test('chapter 2 intro mirrors chapter 1: not to blame yourself', () => {
  const { ts, ctx } = setup();
  act(ts, ctx, 'torisetsu-begin'); act(ts, ctx, 'torisetsu-chapter-start', { chapter: 'voice' });
  assert.ok(html(ts).includes('自分を責めるためではなく、声のくせに気づくために思い出します。'));
});

test('hard-side episode heading uses the purple side colour class', () => {
  const { ts, ctx } = setup();
  openHard(ts, ctx);
  assert.match(html(ts), /class="ts-chapter-name is-bad"/);
});

test('editing a recorded layer and pressing the keep button keeps the recorded answers', () => {
  const { ts, ctx } = setup();
  runChapter(ts, ctx, 'needs', A.data, { stopAt: 'insight' });
  act(ts, ctx, 'torisetsu-days');
  act(ts, ctx, 'torisetsu-edit-item', { side: 'hard', index: '0' });
  const before = JSON.stringify(ts.data.needs.hard[0]);
  act(ts, ctx, 'torisetsu-layer-next'); // 表の気持ち
  assert.ok(html(ts).includes('このまま進む') && !html(ts).includes('わからないので飛ばす'));
  act(ts, ctx, 'torisetsu-layer-skip'); act(ts, ctx, 'torisetsu-layer-skip'); act(ts, ctx, 'torisetsu-layer-skip');
  assert.equal(JSON.stringify(ts.data.needs.hard[0]), before);
});

test('manual section navigation uses real data-id actions and preserves data/compose output', () => {
  const { ts, ctx } = setup();
  runChapter(ts, ctx, 'needs', A.data);
  ts.data.voice = normalizeData({ voice: B.data }).voice;
  ts.data.values = normalizeData({ values: Cx.data }).values;
  act(ts, ctx, 'torisetsu-manual');
  const beforeData = JSON.stringify(ts.data);
  const beforeManual = JSON.stringify(composeManual(ts.data, { today: '2026-10-13' }));
  const visible = composeManual(ts.data, { today: '2026-10-13' }).sections.filter((section) => section.state !== 'hidden');
  assert.ok(visible.length > 1);
  const target = visible.at(-1).id;
  const result = act(ts, ctx, 'torisetsu-manual-section', { id: target });
  assert.equal(ts.manualSectionId, target);
  assert.equal(result.focus, `[data-manual-section="${target}"]`);
  const view = html(ts);
  assert.match(view, new RegExp(`data-action="torisetsu-manual-section"[^>]*data-id="${target}"`));
  assert.ok(view.includes(`data-manual-section="${target}"`));
  assert.equal(JSON.stringify(ts.data), beforeData);
  assert.equal(JSON.stringify(composeManual(ts.data, { today: '2026-10-13' })), beforeManual);
  act(ts, ctx, 'torisetsu-manual-section', { id: 'invalid-section-id' });
  assert.equal(ts.manualSectionId, visible[0].id, 'invalid section falls back to first visible section');
});

test('insight pager reaches multiple findings for every chapter, backs up, then advances to compare', () => {
  const voiceMulti = { ...B.data, episodes: [
    { scene: 'sc_work', memo: '', thoughts: ['th_nogood', 'th_others'] },
    { scene: 'sc_friend', memo: '', thoughts: ['th_nogood', 'th_others'] },
    { scene: 'sc_family', memo: '', thoughts: ['th_burden'] },
  ] };
  for (const [chapter, fixture] of [['needs', A.data], ['voice', voiceMulti], ['values', Cx.data]]) {
    const { ts, ctx } = setup();
    runChapter(ts, ctx, chapter, fixture, { stopAt: 'insight' });
    assert.equal(ts.step, 'insight', chapter);
    const first = html(ts);
    assert.match(first, /class="ts-insight-pager"/, `${chapter} has pager`);
    const firstPage = ts.insightPage;
    const firstKey = torisetsuViewKey(ts);
    act(ts, ctx, 'torisetsu-insight-page', { direction: 'next' });
    assert.equal(ts.step, 'insight', `${chapter} next page remains insight`);
    assert.ok(ts.insightPage > firstPage, `${chapter} advances page`);
    assert.notEqual(torisetsuViewKey(ts), firstKey, `${chapter} page transition changes view key`);
    act(ts, ctx, 'torisetsu-back');
    assert.equal(ts.step, 'insight', `${chapter} top back returns to prior page`);
    assert.equal(ts.insightPage, firstPage);
    let guard = 0;
    while (ts.step === 'insight' && guard++ < 12) act(ts, ctx, 'torisetsu-insight-page', { direction: 'next' });
    assert.notEqual(ts.step, 'insight', `${chapter} leaves insight after final page`);
  }
});

test('zero and one insight results stay on a single non-paged insight view', () => {
  const empty = gotoInsight('needs', { prediction: [], happy: [], hard: [] });
  assert.equal(empty.ts.insightPage, 0);
  assert.ok(!html(empty.ts).includes('ts-insight-pager'));
  const one = gotoInsight('needs', { prediction: [], happy: [], hard: [hardEp('sf_irritated', ['dp_anxious'], ['nd_understood'])] });
  assert.ok(!html(one.ts).includes('ts-insight-pager'));
  assert.equal(one.ts.insightPage, 0);
});

test('local progress reflects the active side and layer from state', () => {
  const { ts, ctx } = setup();
  openHard(ts, ctx);
  assert.match(html(ts), /data-ts-local-progress="1 \/ 3"/);
  assert.match(html(ts), /data-ts-phase="思い出す"/);
  act(ts, ctx, 'torisetsu-layer-next');
  assert.match(html(ts), /data-ts-local-progress="1 \/ 3"/);
  assert.match(html(ts), /class="ts-layer-count">2 \/ 4</);
  const add = setup();
  runChapter(add.ts, add.ctx, 'needs', A.data, { stopAt: 'insight' });
  act(add.ts, add.ctx, 'torisetsu-add-item', { side: 'hard', returnTo: 'insight' });
  assert.match(html(add.ts), /data-ts-local-progress="追加 4つ目"/);
  const edit = setup();
  runChapter(edit.ts, edit.ctx, 'needs', A.data, { stopAt: 'insight' });
  act(edit.ts, edit.ctx, 'torisetsu-days');
  act(edit.ts, edit.ctx, 'torisetsu-edit-item', { side: 'hard', index: '0' });
  assert.match(html(edit.ts), /data-ts-local-progress="[^"]+"/);
  const insight = setup();
  runChapter(insight.ts, insight.ctx, 'needs', A.data, { stopAt: 'insight' });
  assert.doesNotMatch(html(insight.ts), /data-ts-local-progress="[^"]+"/);
});

test('radio reselect is a no-op while multi-select reselect toggles', () => {
  const voice = setup();
  runChapter(voice.ts, voice.ctx, 'voice', B.data, { stopAt: 'insight' });
  act(voice.ts, voice.ctx, 'torisetsu-compare');
  act(voice.ts, voice.ctx, 'torisetsu-protect-next');
  const reply = B.data.reply;
  act(voice.ts, voice.ctx, 'torisetsu-chip', { group: 'reply', chip: reply });
  const selected = voice.ts.data.voice.reply;
  const feedbackNonce = voice.ts.feedbackNonce;
  const selectedKey = torisetsuViewKey(voice.ts);
  act(voice.ts, voice.ctx, 'torisetsu-chip', { group: 'reply', chip: reply });
  assert.equal(voice.ts.data.voice.reply, selected);
  assert.equal(voice.ts.feedbackNonce, feedbackNonce);
  assert.equal(torisetsuViewKey(voice.ts), selectedKey);
  const multi = setup(); openHard(multi.ts, multi.ctx);
  act(multi.ts, multi.ctx, 'torisetsu-layer-next'); act(multi.ts, multi.ctx, 'torisetsu-layer-next');
  act(multi.ts, multi.ctx, 'torisetsu-chip', { group: 'deep', chip: 'dp_uncared' });
  const nonce = multi.ts.feedbackNonce;
  act(multi.ts, multi.ctx, 'torisetsu-chip', { group: 'deep', chip: 'dp_uncared' });
  assert.ok(!multi.ts.draft.deep.includes('dp_uncared'));
  assert.ok(multi.ts.feedbackNonce > nonce);
});

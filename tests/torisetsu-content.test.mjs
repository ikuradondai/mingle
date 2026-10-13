import assert from 'node:assert/strict';
import test from 'node:test';
import * as C from '../dist/data/torisetsu-content.js';
import { torisetsuView, createTorisetsuState, applyAction, composeManual, normalizeData } from '../dist/torisetsu.js';
import * as I from '../dist/torisetsu-insight.js';
import { soloDecks } from '../dist/data/solo-decks.js';
import { BANNED, STIFF_WORDS } from './helpers/banned-words.mjs';
import { runChapter, makeCtx } from './helpers/torisetsu-flow.mjs';
import * as ex1 from './fixtures/torisetsu/example1-office-worker.mjs';
import * as ex2 from './fixtures/torisetsu/example2-retired.mjs';
import * as ex3 from './fixtures/torisetsu/example3-student.mjs';

const len = (text) => Array.from(text).length;
const esc = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[c]);

// この機能だけの禁止語（共通の BANNED に追加）
const EXTRA_BANNED = [/あなた/u, /タイプ/u, /性格/u, /診断/u, /傾向/u, /型/u, /な人です/u, /向いていない/u, /ダメ/u, /べき/u, /必ず/u, /絶対/u];

// 文言を全部集める
function allStrings() {
  const out = [];
  const add = (label, value) => { if (typeof value === 'string' && value) out.push([label, value]); };
  for (const chapter of C.CHAPTERS) {
    for (const key of ['label', 'subtitle', 'short', 'teaserNone']) add(`${chapter.id}.${key}`, chapter[key]);
    for (const key of ['question', 'hint', 'footer', 'title']) add(`${chapter.id}.predict.${key}`, chapter.predict[key]);
    add(`${chapter.id}.done.title`, chapter.done.title); add(`${chapter.id}.done.body`, chapter.done.body); add(`${chapter.id}.again`, chapter.again.text);
  }
  for (const group of C.DAY_GROUPS) add(`group.${group.id}`, group.label);
  for (const chip of [...C.DAY_CHIPS, ...C.COMBO_FEATURES]) for (const key of ['label', 'tag', 'power', 'lamp', 'tryMore', 'tryLess']) add(`${chip.id}.${key}`, chip[key]);
  for (const item of C.ENERGY_PREDICTIONS) add(`pred.${item.id}`, item.label);
  for (const item of C.VALUES) for (const key of ['label', 'request', 'tryMore']) add(`${item.id}.${key}`, item[key]);
  for (const side of ['neg', 'pos']) {
    for (const item of C.SITUATIONS[side]) add(item.id, item.label);
    for (const item of C.FEELINGS[side]) add(item.id, item.label);
  }
  for (const item of C.STRENGTHS) for (const key of ['label', 'tryMore', 'tryShow']) add(`${item.id}.${key}`, item[key]);
  for (const item of [...C.TASKS, ...C.KINDS, ...C.FROMS]) add(item.id, item.label);
  for (const [key, value] of Object.entries(C.INTRO)) { add(`intro.${key}.title`, value.title); value.lines.forEach((line, i) => add(`intro.${key}.${i}`, line)); add(`intro.${key}.button`, value.button); }
  for (const [key, value] of Object.entries(C.SIDE_COPY)) add(`side.${key}`, value.label);
  for (const [key, value] of Object.entries(C.DAY_MEMO)) add(`dayMemo.${key}`, value);
  for (const [key, value] of Object.entries(C.EPISODE_MEMO)) add(`epMemo.${key}`, value);
  for (const label of [...C.STEP_LABELS, ...C.STEP_LABELS_OTHERS]) add('step', label);
  for (const section of C.MANUAL_SECTIONS) add(`section.${section.id}`, section.title);
  for (const [key, value] of Object.entries(C.MANUAL_COPY)) add(`MANUAL.${key}`, typeof value === 'function' ? value('テスト') : value);
  const sample = { limitMessage: [2], memoCount: [3, 30], missingGroups: [[ '誰といた', '前の晩は' ]], dayHeading: ['good', 1, 3], episodeHeading: [1, 2], progressLabel: [1], gapThought: ['テスト'], compareLine: [3, 3], lineupOneDay: [2], doneNext: ['元気のもと'], doneCheck: ['テスト'], freeCount: [3] };
  for (const [key, value] of Object.entries(C.COPY)) add(`COPY.${key}`, typeof value === 'function' ? value(...(sample[key] || ['テスト'])) : value);
  add('deck.subtitle', C.COPY.deckSubtitle); add('deck.description', C.COPY.deckDescription);
  return out;
}

test('3 chapters with unique ids; every id space is unique', () => {
  assert.deepEqual(C.CHAPTERS.map((chapter) => chapter.id), ['energy', 'values', 'others']);
  const unique = (label, ids) => assert.equal(new Set(ids).size, ids.length, `${label}: duplicate id`);
  unique('chips', C.DAY_CHIPS.map((x) => x.id));
  unique('features', C.ENERGY_FEATURES.map((x) => x.id));
  unique('groups', C.DAY_GROUPS.map((x) => x.id));
  unique('values', C.VALUES.map((x) => x.id));
  unique('situations', [...C.SITUATIONS.neg, ...C.SITUATIONS.pos].map((x) => x.id));
  unique('feelings', [...C.FEELINGS.neg, ...C.FEELINGS.pos].map((x) => x.id));
  unique('strengths', C.STRENGTHS.map((x) => x.id));
  unique('tasks', C.TASKS.map((x) => x.id));
  unique('kinds+froms', [...C.KINDS, ...C.FROMS].map((x) => x.id));
  unique('predictions', C.ENERGY_PREDICTIONS.map((x) => x.id));
  unique('manual sections', C.MANUAL_SECTIONS.map((x) => x.id));
  assert.equal(C.MANUAL_SECTIONS.length, 7);
  // 日の入力グループの上限
  assert.deepEqual(C.DAY_GROUPS.map((g) => [g.id, g.max]), [['who', 2], ['where', 2], ['doing', 3], ['sleep', 1], ['body', 1]]);
  assert.deepEqual([C.CHAPTERS[0].init, C.CHAPTERS[0].min, C.CHAPTERS[0].max], [3, 2, 5]);
});

test('references line up (situations -> values, tasks -> strengths, predictions -> features, v1 migration)', () => {
  const valueIds = new Set(C.VALUES.map((x) => x.id));
  for (const item of [...C.SITUATIONS.neg, ...C.SITUATIONS.pos]) assert.ok(valueIds.has(item.value), item.id);
  const strengthIds = new Set(C.STRENGTHS.map((x) => x.id));
  for (const task of C.TASKS) assert.ok(strengthIds.has(task.strength), task.id);
  const featureIds = new Set(C.ENERGY_FEATURES.map((x) => x.id));
  for (const item of C.ENERGY_PREDICTIONS) assert.ok(featureIds.has(item.id), item.id);
  for (const feature of C.ENERGY_FEATURES) { assert.ok(feature.tag, feature.id); assert.ok(feature.lamp, `${feature.id}: lamp`); }
  for (const combo of C.COMBO_FEATURES) for (const member of combo.members) assert.ok(C.DAY_CHIPS.some((chip) => chip.id === member), member);
  for (const [a, b] of C.OPPOSITES) { assert.ok(featureIds.has(a)); assert.ok(featureIds.has(b)); }
  // chips not reported on: home / ふつう / 覚えていない
  for (const id of ['where_home', 'sleep_ok', 'sleep_unknown', 'body_ok']) assert.equal(C.DAY_CHIPS.find((chip) => chip.id === id).rep, false, id);
  assert.equal(C.VALUE_PREDICTIONS?.length ?? C.VALUES.length, 9);
});

test('length limits: chips 16, tag 14, power/lamp 20, try/request 34, questions 40, sentences 70', () => {
  for (const chip of [...C.DAY_CHIPS, ...C.COMBO_FEATURES]) {
    assert.ok(len(chip.label) <= 16, chip.id);
    assert.ok(len(chip.tag) <= 14, `${chip.id} tag`);
    assert.ok(len(chip.power) <= 20, `${chip.id} power`);
    assert.ok(len(chip.lamp) <= 20, `${chip.id} lamp`);
    assert.ok(len(chip.tryMore) <= 34 && len(chip.tryLess) <= 34, `${chip.id} try`);
  }
  for (const item of [...C.ENERGY_PREDICTIONS, ...C.VALUES, ...C.SITUATIONS.neg, ...C.SITUATIONS.pos, ...C.FEELINGS.neg, ...C.FEELINGS.pos, ...C.STRENGTHS, ...C.TASKS, ...C.KINDS, ...C.FROMS]) assert.ok(len(item.label) <= 16, item.id);
  for (const value of C.VALUES) { assert.ok(len(value.request) <= 34, value.id); assert.ok(len(value.tryMore) <= 34, value.id); }
  for (const item of C.STRENGTHS) { assert.ok(len(item.tryMore) <= 34 && len(item.tryShow) <= 34, item.id); }
  for (const chapter of C.CHAPTERS) { assert.ok(len(chapter.predict.question) <= 40); assert.ok(len(chapter.again.text) <= 34, chapter.id); }
  for (const group of C.DAY_GROUPS) assert.ok(len(group.label) <= 40);
  for (const intro of Object.values(C.INTRO)) assert.ok(len(intro.title) <= 40, intro.title);
  for (const [label, text] of allStrings()) for (const sentence of text.split('。').filter(Boolean)) assert.ok(len(sentence) <= 70, `${label}: ${sentence}`);
});

test('banned and stiff words never appear (shared list + this feature)', () => {
  for (const [label, text] of allStrings()) {
    for (const pattern of [...BANNED, ...EXTRA_BANNED]) assert.doesNotMatch(text, pattern, `${label}: ${text}`);
    for (const pattern of STIFF_WORDS) assert.doesNotMatch(text, pattern, `${label}: ${text}`);
  }
});

test('assembled insight sentences also avoid banned words and stay short', () => {
  const sentences = [];
  const ins = I.energyInsights(ex1.input.good, ex1.input.bad);
  sentences.push(...[...ins.ordered.good, ...ins.ordered.bad].map((x) => x.sentence), ins.footer, ins.footerAdd);
  const b = I.energyInsights(Array.from({ length: 5 }, (_, i) => ({ ...ex1.input.good[0], doing: ['do_help'], who: ['who_mates'] })), Array.from({ length: 5 }, () => ({ ...ex1.input.bad[0] })));
  sentences.push(...b.ordered.good.map((x) => x.sentence), ...b.ordered.bad.map((x) => x.sentence));
  sentences.push(...I.valuesInsights(ex2.input.neg, ex2.input.pos).ordered.map((x) => x.sentence));
  sentences.push(...I.othersInsights(ex3.input.self, ex3.input.episodes).lines.map((x) => x.text));
  // すべての特徴を 2 日以上あるものとして作った最長の文
  for (const feature of C.ENERGY_FEATURES) {
    for (const side of ['good', 'bad']) for (const stage of ['A', 'B']) sentences.push(I.renderEnergySentence({ id: feature.id, tag: feature.tag, side, stage, g: 3, b: 1, nG: 5, nB: 5 }));
  }
  for (const text of sentences) {
    for (const pattern of [...BANNED, ...EXTRA_BANNED, ...STIFF_WORDS]) assert.doesNotMatch(text, pattern, text);
    for (const sentence of text.split('。').filter(Boolean)) assert.ok(len(sentence) <= 70, `${len(sentence)}: ${sentence}`);
  }
  // 「ラベル」を貼らない: 気づきの文は『今回の答え』か回数を伴う
  assert.match(C.COPY.insightIntro, /今回の答えでは/);
});

test('the deck card matches the redesign and keeps the old 12 questions', () => {
  const deck = soloDecks.find((item) => item.id === 'self-values');
  assert.equal(deck.builder, 'torisetsu');
  assert.equal(deck.subtitle, C.COPY.deckSubtitle);
  assert.equal(deck.description, C.COPY.deckDescription);
  assert.ok(!deck.description.includes('12問'));
  assert.ok(len(deck.description) <= 100);
  assert.equal(deck.questions.length, 12);
});

test('chips fit students, workers, homemakers and retirees (neutral wording)', () => {
  const who = C.DAY_CHIPS.filter((chip) => chip.group === 'who').map((chip) => chip.label);
  const doing = C.DAY_CHIPS.filter((chip) => chip.group === 'doing').map((chip) => chip.label);
  assert.ok(who.includes('学校や仕事の人'));
  assert.ok(doing.includes('勉強や仕事') && doing.includes('家事や用事') && doing.includes('趣味・好きなこと'));
  assert.ok(C.DAY_CHIPS.find((chip) => chip.id === 'where_work').label === '学校や職場');
  for (const [label, text] of allStrings()) assert.doesNotMatch(text, /彼氏|彼女|旦那|奥さん|主婦|部下|上司|先輩|息子|娘/u, `${label}: ${text}`);
});

test('free text is escaped everywhere it is shown', () => {
  const evil = '<img src=x onerror=1>&"\'';
  const ts = createTorisetsuState();
  const ctx = makeCtx();
  const input = JSON.parse(JSON.stringify(ex1.input));
  input.good[0].memo = evil; input.bad[0].memo = evil;
  runChapter(ts, ctx, 'energy', input, { surprise: 'g:do_talk', experimentText: evil, surpriseText: '' });
  const views = [];
  const render = () => views.push(torisetsuView(ts, { esc, today: '2026-10-13', imageEnabled: true, canSend: false }));
  render();
  applyAction(ts, 'torisetsu-manual', {}, ctx); render();
  applyAction(ts, 'torisetsu-contents', {}, ctx); render();
  applyAction(ts, 'torisetsu-chapter-days', { chapter: 'energy' }, ctx); render();
  applyAction(ts, 'torisetsu-edit-item', { side: 'good', index: '0' }, ctx); render();
  applyAction(ts, 'torisetsu-back', {}, ctx);
  applyAction(ts, 'torisetsu-days-done', {}, ctx); render();
  applyAction(ts, 'torisetsu-back', {}, ctx); render(); // lineup
  const name = normalizeData({ name: evil });
  assert.ok(name.name.length <= 12);
  for (const html of views) {
    assert.doesNotMatch(html, /<img/i);
    assert.doesNotMatch(html, /onerror=1>/);
  }
  assert.ok(views.some((html) => html.includes('&lt;img')), 'the memo is shown, escaped');
  // 画像用の文字列も同じ元データから作る（HTML ではない）
  assert.ok(composeManual(ts.data, { today: '2026-10-13' }).sections.length === 7);
});

test('screens render for every step without throwing and keep tap targets as buttons', () => {
  const ctx = makeCtx();
  for (const [chapterId, input] of [['energy', ex1.input], ['values', ex2.input], ['others', ex3.input]]) {
    const ts = createTorisetsuState();
    runChapter(ts, ctx, chapterId, input, { stopAt: 'lineup' });
    for (const step of ['lineup']) assert.ok(torisetsuView(ts, { esc, today: '2026-10-13' }).includes('共通点を探す'), step);
    applyAction(ts, 'torisetsu-find', {}, ctx);
    const insight = torisetsuView(ts, { esc, today: '2026-10-13' });
    assert.ok(insight.includes('今回の答えでは'), chapterId);
    applyAction(ts, 'torisetsu-compare', {}, ctx);
    const html = torisetsuView(ts, { esc, today: '2026-10-13' });
    assert.ok(html.length > 500, `${chapterId} ${ts.step}`);
  }
});

test('who chips include 近所・地域の人 and it counts as being with someone', () => {
  const chip = C.DAY_CHIPS.find((item) => item.id === 'who_local');
  assert.equal(chip.label, '近所・地域の人');
  assert.equal(chip.group, 'who');
  assert.ok(C.COMBO_FEATURES.find((item) => item.id === 'people').members.includes('who_local'));
  assert.equal(normalizeData({ energy: { good: [{ who: ['who_local'], where: ['where_town'], doing: ['do_talk'], sleep: 'sleep_ok', body: 'body_ok' }] } }).energy.good[0].who[0], 'who_local');
});

test('insight screen (energy): compact rows, counts, hidden sentence, and body tags only in 「ほかに見えたこと」', () => {
  const ts = createTorisetsuState(); const ctx = makeCtx();
  runChapter(ts, ctx, 'energy', ex1.input, { stopAt: 'insight' });
  const html = torisetsuView(ts, { esc, today: '2026-10-13' });
  for (const text of ['よかった日3日と、悪かった日3日を比べました。', 'よかった日には『ゆっくり話した』、悪かった日には『前の晩が寝不足』がありました。', 'よかった日にあって、悪かった日にはなかったこと', '悪かった日にあって、よかった日にはなかったこと', '3日とも', '3日中2日', '決まりではありません。']) assert.ok(html.includes(text), text);
  assert.ok(html.includes(`<span class="visually-hidden">${esc(ex1.expected.good[0])}</span>`), 'full sentence kept for screen readers');
  assert.ok(!html.includes('3日ずつの答えから'), 'footer sentence is not repeated under the compare line');
  assert.ok(html.includes('ほかに見えたこと：『体が軽い』'), 'body tag goes to the extras');
  assert.ok(html.includes('『疲れていた・だるい』'));
  assert.ok(!html.includes('<span class="ts-find-tag" aria-hidden="true">『体が軽い』'), 'body tag is never a band row');
});

test('lineup (energy): one-day rows are folded; bad-day columns are marked', () => {
  const ts = createTorisetsuState(); const ctx = makeCtx();
  runChapter(ts, ctx, 'energy', ex1.input, { stopAt: 'lineup' });
  const html = torisetsuView(ts, { esc, today: '2026-10-13' });
  const detailsAt = html.indexOf('<details class="ts-lineup-more">');
  assert.ok(detailsAt > 0);
  assert.match(html, /<summary>1日だけ出たこと（\d+）<\/summary>/);
  const main = html.slice(0, detailsAt);
  const folded = html.slice(detailsAt);
  assert.ok(main.includes('ゆっくり話した') && main.includes('前の晩が寝不足'), 'findings and 2+ day rows stay visible');
  assert.ok(folded.includes('趣味や好きなこと') === false || folded.includes('<th scope="row">'), 'folded table has row headers');
  assert.ok(html.includes('is-bad is-bad-first'), 'first bad-day column is marked');
  assert.ok((html.match(/<th scope="col"/g) || []).length > 0 && (html.match(/scope="colgroup"/g) || []).length >= 2);
  const folded2 = folded.match(/<tbody>[\s\S]*?<\/tbody>/)[0];
  for (const tr of folded2.match(/<tr [\s\S]*?<\/tr>/g)) assert.equal((tr.match(/class="is-on/g) || []).length <= 1, true, 'folded rows appear on one day only');
});

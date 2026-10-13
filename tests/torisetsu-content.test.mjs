import assert from 'node:assert/strict';
import test from 'node:test';
import { CHAPTERS, SECTIONS, COPY } from '../dist/data/torisetsu-content.js';
import {
  composeSection, composeManual, sectionPlainText, normalizeAnswer, progress, sanitizeText, torisetsuView, createTorisetsuState, applyAction,
} from '../dist/torisetsu.js';
import { soloDecks } from '../dist/data/solo-decks.js';
import { BANNED, STIFF_WORDS } from './helpers/banned-words.mjs';

const len = (text) => Array.from(text).length;
const esc = (value) => String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[c]);

// 文言を全部集める（チップの形、固定文、関数で作る文）。
function allStrings() {
  const out = [];
  const add = (label, value) => { if (typeof value === 'string' && value) out.push([label, value]); };
  for (const chapter of CHAPTERS) { add(`${chapter.id}.label`, chapter.label); add(`${chapter.id}.subtitle`, chapter.subtitle); add(`${chapter.id}.done`, chapter.done); }
  for (const section of SECTIONS) {
    for (const key of ['title', 'question', 'hint', 'typeQuestion', 'nameLabel', 'namePlaceholder', 'textPlaceholder', 'tail', 'intro', 'outro']) add(`${section.id}.${key}`, section[key]);
    for (const item of section.chips) for (const key of ['label', 'line', 'cond', 'tari', 'toki']) add(`${section.id}.${item.id}.${key}`, item[key]);
    if (section.textLine) add(`${section.id}.textLine`, section.textLine('テスト'));
    if (section.textForms) for (const [k, v] of Object.entries(section.textForms('テスト'))) add(`${section.id}.textForms.${k}`, v);
    if (section.outroFromFirst) add(`${section.id}.outroFromFirst`, section.outroFromFirst('テスト'));
  }
  for (const [key, value] of Object.entries(COPY)) add(`COPY.${key}`, typeof value === 'function' ? value('基本編') : value);
  return out;
}

test('8 sections in 3 chapters (3/3/2) with unique ids', () => {
  assert.equal(SECTIONS.length, 8);
  assert.deepEqual(CHAPTERS.map((chapter) => chapter.sections.length), [3, 3, 2]);
  assert.equal(new Set(SECTIONS.map((section) => section.id)).size, 8);
  assert.deepEqual(CHAPTERS.flatMap((chapter) => chapter.sections), SECTIONS.map((section) => section.id));
  for (const section of SECTIONS) {
    assert.equal(CHAPTERS.find((chapter) => chapter.id === section.chapterId).sections.includes(section.id), true, section.id);
    assert.equal(new Set(section.chips.map((item) => item.id)).size, section.chips.length, `${section.id}: duplicate chip id`);
  }
});

test('chip counts, label/line/question lengths and placeholders follow the limits', () => {
  for (const section of SECTIONS) {
    assert.ok(section.chips.length >= 6 && section.chips.length <= 10, `${section.id}: chips ${section.chips.length}`);
    assert.ok(len(section.question) <= 40, `${section.id}: question`);
    assert.match(section.textPlaceholder, /^例：/u, `${section.id}: placeholder`);
    for (const item of section.chips) {
      assert.ok(len(item.label) <= 12, `${section.id}.${item.id}: label ${item.label}`);
      for (const key of ['line', 'cond', 'tari', 'toki']) if (item[key]) assert.ok(len(item[key]) <= 40, `${section.id}.${item.id}.${key}: ${item[key]}`);
    }
    if (section.mode === 'list' || section.mode === 'steps') for (const item of section.chips) assert.ok(item.line, `${section.id}.${item.id}: needs line`);
    if (section.mode === 'cond') for (const item of section.chips) assert.ok(item.cond && item.tari, `${section.id}.${item.id}: needs cond/tari`);
    if (section.mode === 'toki') for (const item of section.chips) assert.ok(item.toki, `${section.id}.${item.id}: needs toki`);
  }
});

test('no banned, diagnostic, stiff words or あなた anywhere in the builder copy', () => {
  for (const [label, text] of allStrings()) {
    for (const pattern of BANNED) assert.doesNotMatch(text, pattern, `${label}: ${text}`);
    for (const pattern of STIFF_WORDS) assert.doesNotMatch(text, pattern, `${label}: ${text}`);
    assert.doesNotMatch(text, /あなた/u, label);
  }
});

test('overly soft hiragana words from the kanji pass are not left in the copy', () => {
  const all = allStrings().map(([, text]) => text).join('\n');
  for (const word of ['ねむ', 'さいご', 'へる', 'おそい', 'ちらかる', 'あたたかい', '飲みもの', '落ちこ', 'つづける', 'ためす', 'たよる', 'ひとこと', '気くばり', 'しんちょう', '負けずぎらい', '書きこ', 'かたづけ', 'あびる']) {
    assert.ok(!all.includes(word), `still hiragana: ${word}`);
  }
});

function combos(section) {
  const ids = section.chips.map((item) => item.id);
  const list = [];
  for (const id of ids) list.push([id]);
  for (let i = 0; i < ids.length; i += 1) for (let j = 0; j < ids.length; j += 1) if (i !== j && section.max >= 2) list.push([ids[i], ids[j]]);
  if (section.max >= 3) list.push(ids.slice(0, 3));
  return list;
}

test('every composition combo is well formed (no undefined/null/braces, ends with 。, <=160 chars)', () => {
  const longText = 'あ'.repeat(30);
  for (const section of SECTIONS) {
    const cases = [];
    for (const chips of combos(section)) { cases.push({ chips, text: '' }); if (chips.length < section.max) cases.push({ chips, text: 'テスト' }); }
    cases.push({ chips: [], text: 'テスト' }, { chips: [], text: section.mode === 'name' ? 'あ'.repeat(12) : longText });
    if (section.mode === 'name') cases.push({ chips: [], text: '', name: 'のんびり号' }, { chips: ['mypace'], text: '', name: 'のんびり号' });
    for (const answer of cases) {
      const composed = composeSection(section.id, answer);
      assert.equal(composed.empty, false, `${section.id} ${JSON.stringify(answer)}`);
      const text = sectionPlainText(composed);
      assert.doesNotMatch(text, /undefined|null|NaN|[{}]/u, `${section.id}: ${text}`);
      if (section.mode !== 'name') {
        assert.ok(text.endsWith('。'), `${section.id}: ${text}`);
        assert.ok(len(text.replace(/\n/g, '')) <= 160, `${section.id}: ${len(text)} ${text}`);
      }
    }
  }
});

test('composition shape: fixed expected sentences', () => {
  const text = (id, answer) => sectionPlainText(composeSection(id, answer));
  assert.equal(text('warning', { chips: ['sleepy'] }), '眠くなったら、充電が切れかけています。早めに休ませてあげてください。');
  assert.equal(text('warning', { chips: ['sleepy', 'quiet'] }), '眠くなったり、口数が減ったりしたら、充電が切れかけています。早めに休ませてあげてください。');
  assert.equal(text('warning', { chips: [], text: 'ため息が多くなる' }), '「ため息が多くなる」が出たら、充電が切れかけています。早めに休ませてあげてください。');
  assert.equal(text('warning', { chips: ['sleepy'], text: 'ため息が多くなる' }), '眠くなったり、「ため息が多くなる」が出たりしたら、充電が切れかけています。早めに休ませてあげてください。');
  assert.equal(text('handle', { chips: ['tired', 'hungry'] }), '疲れて帰ってきたときや、お腹がすいているときは、少しそっとしておいてください。時間がたてば、元に戻ります。');
  assert.equal(text('handle', { chips: ['tired', 'hungry', 'cry'] }), '疲れて帰ってきたときや、お腹がすいているときや、泣きたい気分のときは、少しそっとしておいてください。時間がたてば、元に戻ります。');
  assert.equal(text('recovery', { chips: ['warm-drink', 'sleep-early', 'talk'] }), '次の順番で、試してください。\n1. 温かい飲み物を飲む\n2. 早めに寝る\n3. 誰かに話を聞いてもらう\nそれでも直らないときは、誰かに頼ってOKです。');
  assert.equal(text('upkeep', { chips: ['alone', 'meal'] }), '・一人の時間をつくる\n・ごはんをちゃんと食べる\n特に「一人の時間」は、忙しい日も削らないでください。');
  assert.equal(text('upkeep', { chips: [], text: '寝る前にストレッチ' }), '・「寝る前にストレッチ」\n「寝る前にストレッチ」は、忙しい日も削らないでください。');
  assert.equal(text('switch', { chips: ['eat', 'walk'] }), '・おいしい物を食べる\n・外を少し歩く\nどれか1つで、スイッチが入ります。');
  assert.equal(text('strengths', { chips: ['listen', 'absorbed'] }), '・人の話を、最後まで聞けます。\n・好きなことには、とことん夢中になれます。');
  assert.equal(text('name', { name: 'のんびり号', chips: ['mypace', 'listener'] }), '製品名：のんびり号\nタイプ：マイペース・聞き上手モデル');
  assert.equal(text('name', { chips: ['mypace'], text: '朝に強い' }), '製品名：わたし\nタイプ：マイペース・「朝に強い」モデル');
});

test('answers are validated: unknown ids dropped, limits enforced, control characters removed', () => {
  const section = SECTIONS.find((item) => item.id === 'warning');
  assert.equal(normalizeAnswer(section, { chips: ['nope'], text: '' }), null);
  assert.deepEqual(normalizeAnswer(section, { chips: ['sleepy', 'sleepy', 'quiet', 'heavy', 'phone'], text: '' }).chips, ['sleepy', 'quiet', 'heavy']);
  assert.equal(normalizeAnswer(section, { chips: [], text: 'あ'.repeat(50) }).text.length, 30);
  assert.equal(normalizeAnswer(section, { chips: ['sleepy', 'quiet', 'heavy'], text: 'x' }).chips.length, 2);
  assert.equal(sanitizeText('a\nb\tc\u0007d'), 'a b c d'.replace(/ /g, ' '));
  const name = SECTIONS.find((item) => item.id === 'name');
  assert.equal(normalizeAnswer(name, { name: 'あ'.repeat(20), chips: [] }).name.length, 12);
  assert.equal(normalizeAnswer(name, { chips: ['mypace', 'steady', 'listener'] }).chips.length, 2);
});

test('progress counts answered sections per chapter', () => {
  assert.deepEqual(progress({}), { done: 0, total: 8, byChapter: { basic: { done: 0, total: 3 }, trouble: { done: 0, total: 3 }, people: { done: 0, total: 2 } } });
  const p = progress({ name: { chips: ['mypace'], text: '' }, warning: { chips: ['sleepy'], text: '' }, request: { chips: [], text: 'x' } });
  assert.equal(p.done, 3);
  assert.equal(p.byChapter.people.done, 1);
});

test('manual composition: cover title, numbering and empty sections', () => {
  const empty = composeManual({}, { today: '2026-10-13' });
  assert.equal(empty.title, 'わたしの取扱説明書');
  assert.equal(empty.sections.length, 7);
  assert.ok(empty.sections.every((section) => section.empty));
  assert.deepEqual(empty.sections.map((section) => section.number), [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(empty.version, '第1版 2026年10月');
  const full = composeManual({ name: { name: 'のんびり号', chips: ['mypace'], text: '' }, strengths: { chips: ['listen'], text: '' } }, { today: '2026-10-13' });
  assert.equal(full.title, 'のんびり号 取扱説明書');
  assert.equal(full.typeLine, 'タイプ：マイペースモデル');
  assert.equal(full.sections[0].empty, false);
});

test('rendered screens never contain あなた or banned words and escape free text', () => {
  const helpers = { esc, today: '2026-10-13', support: () => '' };
  const ts = createTorisetsuState();
  const payload = '<img src=x onerror=alert(1)>';
  const views = [];
  views.push(torisetsuView(ts, helpers));
  applyAction(ts, 'torisetsu-begin');
  views.push(torisetsuView(ts, helpers));
  for (const chapter of CHAPTERS) {
    applyAction(ts, 'torisetsu-chapter', { chapter: chapter.id });
    for (const id of chapter.sections) {
      assert.equal(ts.sectionId, id);
      applyAction(ts, 'torisetsu-write');
      ts.draft.text = payload.slice(0, 12);
      ts.draft.chips = [SECTIONS.find((section) => section.id === id).chips[0].id];
      views.push(torisetsuView(ts, helpers));
      applyAction(ts, 'torisetsu-commit', {}, { storage: null, today: '2026-10-13' });
      views.push(torisetsuView(ts, helpers));
    }
  }
  assert.equal(ts.view, 'chapterDone');
  views.push(torisetsuView(ts, helpers));
  applyAction(ts, 'torisetsu-manual');
  views.push(torisetsuView(ts, helpers));
  for (const html of views) {
    assert.doesNotMatch(html, /あなた/u);
    assert.doesNotMatch(html, /<img /u);
    const visible = html.replace(/<[^>]*>/g, ' ');
    for (const pattern of BANNED) assert.doesNotMatch(visible, pattern);
  }
  assert.ok(views.some((html) => html.includes('&lt;img')));
});

test('self-values deck keeps its 12 cards and opens the builder', () => {
  const deck = soloDecks.find((item) => item.id === 'self-values');
  assert.equal(deck.builder, 'torisetsu');
  assert.deepEqual(deck.questions.map((card) => card.id), Array.from({ length: 12 }, (_, i) => `self-values-${String(i + 1).padStart(2, '0')}`));
  assert.ok(deck.description.includes('8つの欄'));
});

test('solo recommendation shelf starts with self-values and keeps the old order after it', async () => {
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('../dist/app.js', import.meta.url), 'utf8');
  assert.match(source, /const torisetsuDeck = all\.find\(\(deck\) => deck\.id === 'self-values'\)/);
  assert.match(source, /const recommendedWithSponsors = \[\.\.\.\(torisetsuDeck \? \[torisetsuDeck\] : \[\]\)/);
  assert.match(source, /recommendedRest = recommended\.filter\(\(deck\) => deck\.id !== 'self-values'\)/);
  // 既存のおすすめ順（基準 id）は変えない
  assert.match(source, /const recommendedIds = \['self-checkin', 'self-values', 'self-confidence', 'self-work', 'self-school', 'self-love-now', 'self-decision', 'self-strengths'\];/);
});

test('single-item and free-text-only forms read naturally', () => {
  const text = (id, answer) => sectionPlainText(composeSection(id, answer));
  assert.equal(text('switch', { chips: ['eat'] }), '・おいしい物を食べる\nこれで、スイッチが入ります。');
  assert.equal(text('switch', { chips: [], text: 'コーヒーを入れる' }), '・「コーヒーを入れる」\nこれで、スイッチが入ります。');
  assert.equal(text('recovery', { chips: ['warm-drink'] }), 'まずは、これを試してください。\n温かい飲み物を飲む\nそれでも直らないときは、誰かに頼ってOKです。');
  assert.equal(text('recovery', { chips: [], text: '散歩する' }), 'まずは、これを試してください。\n「散歩する」\nそれでも直らないときは、誰かに頼ってOKです。');
  assert.doesNotMatch(text('recovery', { chips: ['warm-drink'] }), /次の順番|1\./u);
  assert.equal(composeSection('recovery', { chips: ['warm-drink'] }).lines.some((line) => line.kind === 'step'), false);
  assert.equal(text('strengths', { chips: [], text: '道案内' }), '・「道案内」が得意です。');
  assert.equal(text('strengths', { chips: ['listen'], text: '道案内' }), '・人の話を、最後まで聞けます。\n・「道案内」も得意です。');
  assert.equal(text('upkeep', { chips: ['meal'] }), '・ごはんをちゃんと食べる\n「ごはんを食べる」は、忙しい日も削らないでください。');
});

test('save card appears only after a chapter is fully completed', () => {
  const helpers = { esc, today: '2026-10-13', support: () => '' };
  const ts = createTorisetsuState();
  applyAction(ts, 'torisetsu-manual');
  assert.doesNotMatch(torisetsuView(ts, helpers), /torisetsu-save"/u);
  assert.match(torisetsuView(ts, helpers), /章を1つ書き終えると/u);
  ts.answers.name = { chips: ['mypace'], text: '' };
  ts.answers.strengths = { chips: ['listen'], text: '' };
  assert.doesNotMatch(torisetsuView(ts, helpers), /data-action="torisetsu-save"/u);
  ts.answers.switch = { chips: ['eat'], text: '' };
  const html = torisetsuView(ts, helpers);
  assert.match(html, /data-action="torisetsu-save"/u);
  assert.doesNotMatch(html, /章を1つ書き終えると/u);
});

test('top bar back label is 戻る and the leave dialog is a labelled modal', () => {
  const helpers = { esc, today: '2026-10-13', support: () => '' };
  const ts = createTorisetsuState();
  assert.doesNotMatch(torisetsuView(ts, helpers), /もどる/u);
  assert.match(torisetsuView(ts, helpers), /aria-label="戻る"/u);
  ts.answers.name = { chips: ['mypace'], text: '' };
  ts.view = 'contents';
  assert.equal(applyAction(ts, 'torisetsu-back').render, true);
  assert.match(torisetsuView(ts, helpers), /data-ts-modal role="alertdialog" aria-modal="true"/u);
  assert.equal(applyAction(ts, 'torisetsu-leave-keep').focus, '[data-action="torisetsu-back"]');
});

test('leave dialog: keep option only when a chapter is complete; saved work never asks', () => {
  const helpers = { esc, today: '2026-10-13', support: () => '' };
  const ts = createTorisetsuState();
  ts.answers.name = { chips: ['mypace'], text: '' };
  ts.view = 'contents';
  applyAction(ts, 'torisetsu-back');
  let html = torisetsuView(ts, helpers);
  assert.match(html, /閉じると、ここまで書いたことは消えます。/u);
  assert.match(html, /data-ts-default data-action="torisetsu-leave-cancel"[^>]*>続ける/u);
  assert.doesNotMatch(html, /torisetsu-leave-keep|戻って残す/u);
  applyAction(ts, 'torisetsu-leave-cancel');
  assert.equal(ts.leaveConfirm, false);
  assert.equal(ts.view, 'contents');
  ts.answers.strengths = { chips: ['listen'], text: '' };
  ts.answers.switch = { chips: ['eat'], text: '' };
  applyAction(ts, 'torisetsu-back');
  html = torisetsuView(ts, helpers);
  assert.match(html, /data-ts-default data-action="torisetsu-leave-keep"[^>]*>戻って残す/u);
  assert.doesNotMatch(html, /torisetsu-leave-cancel/u);
  const saved = createTorisetsuState({ stored: { answers: { name: { chips: ['mypace'], text: '' } }, savedAt: '2026-10-13' } });
  assert.deepEqual(applyAction(saved, 'torisetsu-back'), { leave: true });
});

test('app.js guards the commit animation, image share fallback and leave dialog keys', async () => {
  const { readFileSync } = await import('node:fs');
  const app = readFileSync(new URL('../dist/app.js', import.meta.url), 'utf8');
  assert.match(app, /if \(torisetsuCommitting\) return;[^\n]*\n\s*const sectionAtClick = ts\.sectionId;/u);
  assert.match(app, /action === "torisetsu-commit" && \(ts\.view !== "item" \|\| ts\.sectionId !== sectionAtClick\)\) return;/u);
  assert.match(app, /event\.key === "Escape"[^\n]*data-ts-default/u);
  assert.match(app, /\.ts-topbar, \.ts-content"\)\.forEach\(\(element\) => \{ element\.inert = Boolean\(modal\)/u);
  assert.match(app, /element\.matches\("\.ts-topbar"\)/u);
  const image = readFileSync(new URL('../dist/torisetsu-image.js', import.meta.url), 'utf8');
  assert.match(image, /if \(error\?\.name === 'AbortError'\) throw error;/u);
});

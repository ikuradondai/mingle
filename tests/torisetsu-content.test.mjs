import assert from 'node:assert/strict';
import test from 'node:test';
import * as C from '../dist/data/torisetsu-content.js';
import { BANNED, STIFF_WORDS } from './helpers/banned-words.mjs';

// この機能だけの禁止語（専門語を画面に出さない／安全の範囲）
const EXTRA_BANNED = [/タイプ/u, /性格/u, /診断/u, /傾向/u, /型/u, /な人です/u, /向いていない/u, /ダメ/u, /べき/u, /必ず/u, /絶対/u];
const FEATURE_BANNED = [/自己/u, /欲求/u, /ニーズ/u, /感情/u, /思考/u, /価値観/u, /批判/u, /自傷/u, /死/u, /消えたい/u];

const LABELS = {
  SURFACE_HARD: C.SURFACE_HARD.map((x) => x.label), DEEP: C.DEEP.map((x) => x.label), SURFACE_HAPPY: C.SURFACE_HAPPY.map((x) => x.label),
  wish: C.NEEDS.map((x) => x.wish), met: C.NEEDS.map((x) => x.met), tag: C.NEEDS.map((x) => x.tag),
  THOUGHTS: C.THOUGHTS.map((x) => x.label), INTENTS: C.INTENTS.map((x) => x.label), REPLIES: C.REPLIES.map((x) => x.label),
  VALUES: C.VALUES.map((x) => x.label), neg: C.SITUATIONS.neg.map((x) => x.label), pos: C.SITUATIONS.pos.map((x) => x.label),
  QUALITIES: C.QUALITIES.map((x) => x.label), SCENES: C.SCENES.map((x) => x.label), PATTERNS: C.PATTERNS.map((x) => x.name),
};

// 画面に出る文字列を全部集める（関数は例の引数で呼ぶ）
function collect(value, out = [], path = '') {
  if (typeof value === 'string') out.push({ path, text: value });
  else if (typeof value === 'function') {
    for (const args of [[['あ', 'い']], [3, 5]]) { try { const r = value(...args); if (typeof r === 'string') { out.push({ path: `${path}()`, text: r }); break; } } catch { /* 次の引数 */ } }
  } else if (Array.isArray(value)) value.forEach((item, i) => collect(item, out, `${path}[${i}]`));
  else if (value && typeof value === 'object') for (const [k, v] of Object.entries(value)) collect(v, out, `${path}.${k}`);
  return out;
}
const ALL = Object.entries(C).flatMap(([name, value]) => collect(value, [], name));

test('three chapters, in order, each self-contained', () => {
  assert.deepEqual(C.CHAPTERS.map((chapter) => chapter.id), ['needs', 'voice', 'values']);
  assert.deepEqual(C.CHAPTERS.map((chapter) => chapter.label), ['満たされるもの、足りないもの', '頭の中の声', '心が動くとき']);
  assert.equal(C.CHAPTERS[0].predict.max, 1); assert.equal(C.CHAPTERS[2].predict.max, 1);
  assert.equal(C.CHAPTERS[1].predict, null, 'no prediction in the voice chapter');
  assert.deepEqual(C.CHAPTERS[0].inits, { happy: 2, hard: 3 }); assert.deepEqual(C.CHAPTERS[0].maxes, { happy: 3, hard: 5 });
  assert.deepEqual(C.CHAPTERS[1].inits, { voice: 3 }); assert.equal(C.CHAPTERS[1].maxes.voice, 5);
  assert.deepEqual(C.CHAPTERS[2].inits, { neg: 2, pos: 2 }); assert.deepEqual(C.CHAPTERS[2].maxes, { neg: 3, pos: 3 });
});

test('ids are unique within every table and references are consistent', () => {
  const tables = { SCENES: C.SCENES, SURFACE_HARD: C.SURFACE_HARD, DEEP: C.DEEP, SURFACE_HAPPY: C.SURFACE_HAPPY, NEEDS: C.NEEDS, PATTERNS: C.PATTERNS, THOUGHTS: C.THOUGHTS, REPLIES: C.REPLIES, INTENTS: C.INTENTS, VALUES: C.VALUES, QUALITIES: C.QUALITIES, ADMIRE_WHO: C.ADMIRE_WHO, neg: C.SITUATIONS.neg, pos: C.SITUATIONS.pos };
  const seen = new Set();
  for (const [name, table] of Object.entries(tables)) {
    const ids = table.map((item) => item.id);
    assert.equal(new Set(ids).size, ids.length, `${name} ids unique`);
    ids.forEach((id) => { assert.ok(!seen.has(id), `${id} is unique across tables`); seen.add(id); });
  }
  const values = new Set(C.VALUES.map((v) => v.id)); const patterns = new Set(C.PATTERNS.map((p) => p.id)); const needs = new Set(C.NEEDS.map((n) => n.id));
  for (const item of [...C.SITUATIONS.neg, ...C.SITUATIONS.pos, ...C.QUALITIES]) assert.ok(values.has(item.value), item.id);
  for (const t of C.THOUGHTS) assert.ok(patterns.has(t.pattern), t.id);
  for (const r of C.REPLIES) assert.ok(r.pattern === '' || patterns.has(r.pattern), r.id);
  for (const p of C.PATTERNS) assert.equal(C.REPLIES.filter((r) => r.pattern === p.id).length, 2, `${p.id} has two replies`);
  assert.equal(C.REPLIES.filter((r) => r.pattern === '').length, 2);
  for (const [n, v] of Object.entries(C.NEED_TO_VALUE)) { assert.ok(needs.has(n)); assert.ok(values.has(v)); }
  assert.equal(C.NEED_TO_VALUE.nd_recognized, undefined);
  for (const section of C.MANUAL_SECTIONS) assert.ok(section.chapterId === null || C.CHAPTERS.some((c) => c.id === section.chapterId));
  assert.deepEqual(C.MANUAL_SECTIONS.map((s) => s.title), ['満たされると元気になるもの', '揺れやすいところ', '周りの人へのお願い', '頭の中の声と、かけたい言葉', '大事にしていること', '来週ためしてみること', 'いちばん意外だったこと']);
});

test('table sizes follow the design', () => {
  assert.ok(C.SURFACE_HARD.length >= 8 && C.SURFACE_HARD.length <= 10);
  assert.ok(C.DEEP.length >= 10 && C.DEEP.length <= 12);
  assert.ok(C.NEEDS.length >= 10 && C.NEEDS.length <= 14);
  assert.ok(C.THOUGHTS.length >= 10 && C.THOUGHTS.length <= 12);
  assert.equal(C.INTENTS.length, 8);
  assert.equal(C.SITUATIONS.neg.length, 12); assert.equal(C.SITUATIONS.pos.length, 11);
  assert.equal(C.VALUES.length, 11); assert.equal(C.QUALITIES.length, 10); assert.equal(C.SURFACE_HAPPY.length, 8);
});

test('the chips match the sheet the product owner reviewed, word for word', () => {
  assert.deepEqual(LABELS.SURFACE_HARD, ['イライラした', '落ち込んだ', 'あせった', 'モヤモヤした', 'がっかりした', 'ぐったりした', '気まずかった', '固まって、何も言えなかった', '投げ出したくなった']);
  assert.deepEqual(LABELS.DEEP, ['不安・こわかった', 'さびしかった', '置いていかれた感じ', '悲しかった', 'くやしかった', '自分が小さく感じた', '期待に応えられない感じ', '責められている感じ', '大事にされていない感じ', '申し訳ない気持ち', 'いっぱいいっぱいだった', 'むなしかった']);
  assert.deepEqual(LABELS.SURFACE_HAPPY, ['うれしかった', 'ほっとした', '力が抜けて、安心した', '胸があたたかくなった', '誇らしかった', 'わくわくした', 'すっきりした', '自分を少し好きになれた']);
  assert.deepEqual(LABELS.wish, ['わかってほしかった', '本音を言いたかった', '大切に扱われたかった', '認めてほしかった', 'ひとりじゃないと思いたかった', '役に立ちたかった', 'ちゃんとできたと思いたかった', '自分で決めたかった', 'ひと息つきたかった', '安心したかった', '前に進みたかった', '大事な人に笑っていてほしかった']);
  assert.deepEqual(LABELS.met, ['わかってもらえた', '本音を言えた', '大切に扱われた', '認めてもらえた', 'ひとりじゃないと思えた', '役に立てた', 'ちゃんとできた', '自分で決められた', 'ひと息つけた', '安心できた', '前に進めた', '大事な人が笑っていた']);
  assert.deepEqual(LABELS.tag, ['わかってもらえること', '本音を言えること', '大切に扱われること', '認めてもらえること', 'ひとりじゃないと思えること', '役に立てること', 'ちゃんとできた手ごたえ', '自分で決められること', 'ひと息つける時間', '安心できること', '前に進めている感じ', '大事な人が元気でいること']);
  assert.deepEqual(LABELS.THOUGHTS, ['自分はダメだ', '自分のせいだ', 'どうせうまくいかない', '失敗したら終わりだ', '嫌われたかも', '迷惑をかけている', 'ちゃんとしなきゃ', '断ったら悪い', 'みんなはできているのに', '本当はできないのがバレる', '弱音ははけない', '誰もわかってくれない']);
  assert.deepEqual(LABELS.PATTERNS, ['自分を責める', '先を悪く読む', '人の気持ちを先に読む', '「〜しなきゃ」でしばる', '人と比べる', 'ひとりで抱える']);
  assert.deepEqual(LABELS.INTENTS, ['失敗しないように', '嫌われないように', '恥をかかないように', 'がっかりする前に、心の準備をさせる', '手を抜かないように、背中を押す', '大事な役目を果たせるように', '大事な人を困らせないように', 'これ以上がんばりすぎないように']);
  assert.deepEqual(LABELS.VALUES, ['正直さ・約束', '公平さ', 'やさしさ', '一人ひとりを大切にすること', '自分で選ぶこと', '分かり合うこと', '成長すること', 'こつこつ努力すること', '落ち着いた暮らし', '自分らしさ', '人の役に立つこと']);
  assert.deepEqual(LABELS.QUALITIES, ['思ったことを、はっきり言う', '誰にでもやさしい', 'いつも落ち着いている', '新しいことに挑戦している', '自分のペースで、好きに生きている', 'ずるをしない', '人の話をよく聞く', '人のために動ける', 'こつこつ続けている', '相手が誰でも、態度を変えない']);
  assert.deepEqual(LABELS.SCENES, ['家族やパートナーのこと', '友だちのこと', '学校や仕事のこと', '近所や地域のこと', 'ひとりのとき', '体や健康のこと', '家事やお金・用事のこと', 'ネットやSNSのこと', 'そのほか']);
  assert.deepEqual(LABELS.neg.slice(0, 3), ['約束を破られた', 'うそやごまかしがあった', 'ずるい・不公平なことを見た']);
});

test('length limits: labels 18, tags 14, fuel/request/try 34, questions 40', () => {
  for (const label of [...LABELS.SURFACE_HARD, ...LABELS.DEEP, ...LABELS.SURFACE_HAPPY, ...LABELS.wish, ...LABELS.met, ...LABELS.INTENTS, ...LABELS.VALUES]) assert.ok(Array.from(label).length <= 18, label);
  for (const item of [...C.SURFACE_HARD, ...C.DEEP, ...C.NEEDS]) assert.ok(Array.from(item.tag).length <= 14, item.tag);
  for (const need of C.NEEDS) for (const key of ['fuel', 'request', 'try']) assert.ok(Array.from(need[key]).length <= 34, `${need.id}.${key}`);
  for (const value of C.VALUES) assert.ok(Array.from(value.tryMore).length <= 40, value.id);
  for (const pattern of C.PATTERNS) assert.ok(Array.from(pattern.try).length <= 40, pattern.id);
  const questions = [
    ...C.CHAPTERS.flatMap((chapter) => (chapter.predict ? [chapter.predict.question, chapter.predict.title] : [])),
    ...Object.values(C.INTRO).map((intro) => intro.title),
    ...Object.values(C.LAYERS).flat().map((layer) => (typeof layer.title === 'function' ? layer.title('イライラした') : layer.title)),
    C.COPY.protectTitle, C.COPY.replyTitle, C.COPY.surpriseTitle, C.COPY.tryTitle, C.COPY.gapTitle,
  ];
  for (const q of questions) assert.ok(Array.from(q).length <= 40, q);
});

test('no two chips in one table start with the same four characters (close wording splits the count)', () => {
  const tables = { surface: LABELS.SURFACE_HARD, deep: LABELS.DEEP, wish: LABELS.wish, met: LABELS.met, tag: LABELS.tag, thoughts: LABELS.THOUGHTS, intents: LABELS.INTENTS, values: LABELS.VALUES, neg: LABELS.neg, pos: LABELS.pos, qualities: LABELS.QUALITIES, happy: LABELS.SURFACE_HAPPY };
  for (const [name, list] of Object.entries(tables)) {
    const heads = list.map((label) => Array.from(label).slice(0, 4).join(''));
    assert.equal(new Set(heads).size, heads.length, `${name}: ${heads.join(' / ')}`);
  }
  const dup = LABELS.DEEP.filter((label) => LABELS.SURFACE_HARD.includes(label));
  assert.deepEqual(dup, [], 'deep and surface share no label');
});

test('banned words appear nowhere in the content; ダメ only in the voice chip or inside 『』', () => {
  const forbidden = [...BANNED, ...EXTRA_BANNED.filter((re) => !re.test('ダメ')), ...FEATURE_BANNED, ...STIFF_WORDS];
  for (const { path, text } of ALL) {
    for (const re of forbidden) assert.doesNotMatch(text, re, `${path}: ${text}`);
    if (path.startsWith('THOUGHTS')) continue;
    assert.doesNotMatch(text.replace(/『[^』]*』/g, ''), /ダメ/u, `${path}: ${text}`);
  }
  assert.deepEqual(C.THOUGHTS.filter((t) => /ダメ/.test(t.label)).map((t) => t.id), ['th_nogood']);
});

test('guidance for recalling: recent, small, and not the painful past', () => {
  assert.match(C.INTRO.hard.lines.join(''), /最近の小さな出来事で大丈夫/);
  assert.match(C.INTRO.hard.lines.join(''), /昔のつらいことや、思い出すと苦しくなることは、選ばないでね/);
  assert.match(C.INTRO.voice.lines.join(''), /昔のつらいことや、思い出すと苦しくなることは、選ばないでね/);
  assert.match(C.INTRO.neg.lines.join(''), /選ばなくて大丈夫/);
  assert.equal(C.COPY.startGuide2, 'どの質問も、飛ばして大丈夫です。');
  assert.equal(C.COPY.dropEpisode, 'この出来事はやめておく');
  assert.equal(C.COPY.layerSkip, 'わからないので飛ばす');
  assert.equal(C.COPY.useNeedsHard, '第1章の「しんどかった出来事」を使う');
});

test('layers: hard has 4, happy has 3, one screen each', () => {
  assert.deepEqual(C.LAYERS.hard.map((l) => l.id), ['scene', 'surface', 'deep', 'needs']);
  assert.deepEqual(C.LAYERS.happy.map((l) => l.id), ['scene', 'feelings', 'needs']);
  assert.equal(C.LAYERS.hard[2].title('イライラした'), '『イライラした』の、もう少し奥には？');
  assert.equal(C.LAYERS.hard[2].title(''), 'そのときの気持ちの、もう少し奥には？');
  for (const side of ['hard', 'happy']) for (const layer of C.LAYERS[side]) assert.ok(C.layerGroups(side, layer.id).length === 1, `${side}.${layer.id}`);
  assert.deepEqual(C.layerGroups('happy', 'needs')[0].chips.map((c) => c.label), LABELS.met);
  assert.deepEqual(C.layerGroups('hard', 'needs')[0].chips.map((c) => c.label), LABELS.wish);
});

test('the quote in the original chapter-3 admire list and the memo placeholders stay as designed', () => {
  assert.deepEqual(C.ADMIRE_WHO.map((w) => w.label), ['身近な人', '学校や職場の人', '有名な人', '本や映画・物語の人']);
  assert.equal(C.MEMO_PLACEHOLDER.hard, '例：会議で意見を流された');
  assert.equal(C.MEMO_PLACEHOLDER.pos, '例：会で全員に話す番が回った');
});

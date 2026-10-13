// 「自分のトリセツ」v3 の気づきの集計（純粋関数）。
// - 入力はチップ id の配列だけ。自由文（ひとこと・意外・ためす・返す言葉の自由文）は一切数えない。
// - 数えるのは奥の層だけ（奥の気持ち・本当の願い・心のくせ・大事なこと）。場面は「バラバラだった」ことを示すためだけに使う。
// - DOM・storage・通信に触らない。比較はすべて整数（分数のまま）で行う。
// - 返すのは文の部品と数。文字列の組み立てはこのファイルの render* に集める。
import {
  CHAPTERS, SCENES, SURFACE_HARD, DEEP, NEEDS, THOUGHTS, PATTERNS, REPLIES, INTENTS, VALUES, ADMIRE_WHO, QUALITIES, NEED_TO_VALUE, COPY, MANUAL_COPY,
} from './data/torisetsu-content.js';

const byId = (list) => new Map(list.map((item) => [item.id, item]));
const indexOf = (list) => new Map(list.map((item, index) => [item.id, index]));
const SCENE_BY_ID = byId(SCENES); const SURFACE_BY_ID = byId(SURFACE_HARD); const SURFACE_INDEX = indexOf(SURFACE_HARD);
const DEEP_BY_ID = byId(DEEP); const DEEP_INDEX = indexOf(DEEP);
const NEED_BY_ID = byId(NEEDS); const NEED_INDEX = indexOf(NEEDS);
const THOUGHT_BY_ID = byId(THOUGHTS); const THOUGHT_INDEX = indexOf(THOUGHTS);
const PATTERN_BY_ID = byId(PATTERNS); const PATTERN_INDEX = indexOf(PATTERNS);
const VALUE_BY_ID = byId(VALUES); const VALUE_INDEX = indexOf(VALUES);
const QUALITY_BY_ID = byId(QUALITIES);
const INTENT_BY_ID = byId(INTENTS); const REPLY_BY_ID = byId(REPLIES);
const ADMIRE_WHO_BY_ID = byId(ADMIRE_WHO);

export const sceneById = (id) => SCENE_BY_ID.get(id) || null;
export const surfaceById = (id) => SURFACE_BY_ID.get(id) || null;
export const deepById = (id) => DEEP_BY_ID.get(id) || null;
export const needById = (id) => NEED_BY_ID.get(id) || null;
export const thoughtById = (id) => THOUGHT_BY_ID.get(id) || null;
export const patternById = (id) => PATTERN_BY_ID.get(id) || null;
export const valueById = (id) => VALUE_BY_ID.get(id) || null;
export const qualityById = (id) => QUALITY_BY_ID.get(id) || null;
export const intentById = (id) => INTENT_BY_ID.get(id) || null;
export const replyById = (id) => REPLY_BY_ID.get(id) || null;
export const admireWhoById = (id) => ADMIRE_WHO_BY_ID.get(id) || null;

const arr = (value) => (Array.isArray(value) ? value : []);
const asSet = (value) => new Set(arr(value));
// 「2つ以上、かつ半分以上」
export const repeat = (c, n) => c >= 2 && 2 * c >= n;
// 「3つとも」「3つ中2つ」「0つ」
export const countText = (k, n) => (k <= 0 ? '0つ' : n === 1 ? '1つ' : k >= n ? `${n}つとも` : `${n}つ中${k}つ`);
const dotsOf = (cells) => cells.map((on) => (on ? '●' : '・')).join('');
export { dotsOf };
const bump = (map, key) => map.set(key, (map.get(key) || 0) + 1);
const cnt = (map, key) => map.get(key) || 0;

// ---------- 第1章 満たされるもの、足りないもの ----------
export function needsCounts(happyInput, hardInput) {
  const happy = arr(happyInput).map((ep) => ({ needs: asSet(ep?.needs) }));
  const hard = arr(hardInput).map((ep) => ({ surface: SURFACE_BY_ID.has(ep?.surface) ? ep.surface : '', deep: asSet(ep?.deep), needs: asSet(ep?.needs) }));
  const dH = new Map(); const hH = new Map(); const hJ = new Map(); const E = new Map();
  hard.forEach((ep, index) => {
    ep.deep.forEach((id) => bump(dH, id));
    ep.needs.forEach((id) => bump(hH, id));
    if (ep.surface) { if (!E.has(ep.surface)) E.set(ep.surface, []); E.get(ep.surface).push(index); }
  });
  happy.forEach((ep) => ep.needs.forEach((id) => bump(hJ, id)));
  const T = (id) => cnt(hH, id) + cnt(hJ, id);
  return { happy, hard, nJ: happy.length, nH: hard.length, nA: happy.length + hard.length, dH, hH, hJ, E, T };
}

const cross = (c, nA, n) => cnt(c.hH, n) >= 1 && cnt(c.hJ, n) >= 1 && c.T(n) >= 3 && 2 * c.T(n) >= nA;
const linked = (hits, size) => size >= 2 && hits >= 2 && 3 * hits >= 2 * size;

// 文の組み立て（読み上げ用・テストで固定）
const allOr = (c, n, all, some) => (c >= n ? all : some);
export function renderNeedsSentence(item, nJ, nH) {
  if (item.kind === 'X') {
    const need = NEED_BY_ID.get(item.id);
    const front = nH === 1 ? `しんどかった1つで『${need.wish}』` : item.hH >= nH ? `しんどかった${nH}つとも『${need.wish}』` : `しんどかった${nH}つのうち${item.hH}つで『${need.wish}』`;
    const back = nJ === 1 ? `うれしかった1つで『${need.met}』` : item.hJ >= nJ ? `うれしかった${nJ}つとも『${need.met}』` : `うれしかった${nJ}つのうち${item.hJ}つで『${need.met}』`;
    return `${front}、${back}。足りないとしんどく、満たされるとうれしいものでした。`;
  }
  if (item.kind === 'LD') {
    const s = SURFACE_BY_ID.get(item.surface); const d = DEEP_BY_ID.get(item.deep);
    return allOr(item.c, item.k, `『${s.label}』出来事は${item.k}つとも、その奥に『${d.tag}』がありました。`, `『${s.label}』出来事${item.k}つのうち${item.c}つで、その奥に『${d.tag}』がありました。`);
  }
  if (item.kind === 'LN') {
    const s = SURFACE_BY_ID.get(item.surface); const n = NEED_BY_ID.get(item.id);
    return allOr(item.c, item.k, `『${s.label}』出来事は${item.k}つとも、本当の願いは『${n.wish}』でした。`, `『${s.label}』出来事${item.k}つのうち${item.c}つで、本当の願いは『${n.wish}』でした。`);
  }
  if (item.kind === 'D') {
    const d = DEEP_BY_ID.get(item.id);
    return allOr(item.c, nH, `しんどかった${nH}つとも、その奥に『${d.tag}』がありました。`, `しんどかった${nH}つのうち${item.c}つで、その奥に『${d.tag}』がありました。`);
  }
  if (item.kind === 'H') {
    const n = NEED_BY_ID.get(item.id);
    return allOr(item.c, nH, `しんどかった${nH}つとも、本当の願いは『${n.wish}』でした。`, `しんどかった${nH}つのうち${item.c}つで、本当の願いは『${n.wish}』でした。`);
  }
  const n = NEED_BY_ID.get(item.id);
  return allOr(item.c, nJ, `うれしかった${nJ}つとも、『${n.met}』がありました。`, `うれしかった${nJ}つのうち${item.c}つに、『${n.met}』がありました。`);
}

const BAND_OF = { X: 'cross', LD: 'link', LN: 'link', D: 'hard', H: 'hard', J: 'happy' };

function describeNeedsItem(item, c) {
  const { hard, happy, nJ, nH } = c;
  const hardCells = (test) => hard.map(test);
  const part = (label, cells, k, n) => ({ label, cells, count: countText(k, n) });
  if (item.kind === 'X') {
    const n = NEED_BY_ID.get(item.id);
    return { heading: `『${n.tag}』`, parts: [part(COPY.lineupHard, hard.map((ep) => ep.needs.has(item.id)), item.hH, nH), part(COPY.lineupHappy, happy.map((ep) => ep.needs.has(item.id)), item.hJ, nJ)], short: `『${n.tag}』`, key: `x:${item.id}`, surprise: `『${n.tag}』が、しんどい時にもうれしい時にもあったこと`, surpriseShort: `奥に『${n.tag}』`, tryKey: `try:${item.id}`, tryText: n.try };
  }
  if (item.kind === 'LD') {
    const s = SURFACE_BY_ID.get(item.surface); const d = DEEP_BY_ID.get(item.deep);
    const idx = c.E.get(item.surface);
    return { heading: `『${s.tag}』の奥に『${d.tag}』`, parts: [part(s.label, idx.map((i) => hard[i].deep.has(item.deep)), item.c, item.k)], short: `『${s.tag}』の奥に『${d.tag}』`, key: `l:${item.surface}:${item.deep}`, surprise: `『${s.tag}』の奥に『${d.tag}』があったこと`, surpriseShort: `『${s.tag}』の奥に『${d.tag}』`, tryKey: `try:l:${item.surface}:${item.deep}`, tryText: `『${s.tag}』に気づいたら、『奥に${d.tag}はある？』と自分に聞いてみる` };
  }
  if (item.kind === 'LN') {
    const s = SURFACE_BY_ID.get(item.surface); const n = NEED_BY_ID.get(item.id);
    const idx = c.E.get(item.surface);
    return { heading: `『${s.tag}』のとき『${n.wish}』`, parts: [part(s.label, idx.map((i) => hard[i].needs.has(item.id)), item.c, item.k)], short: `『${s.tag}』のとき『${n.wish}』`, key: `m:${item.surface}:${item.id}`, surprise: `『${s.tag}』のとき、本当は『${n.wish}』だったこと`, surpriseShort: `『${s.tag}』のとき『${n.wish}』`, tryKey: `try:${item.id}`, tryText: n.try };
  }
  if (item.kind === 'D') {
    const d = DEEP_BY_ID.get(item.id);
    return { heading: `『${d.tag}』`, parts: [part(COPY.lineupHard, hardCells((ep) => ep.deep.has(item.id)), item.c, nH)], short: `『${d.tag}』`, key: `d:${item.id}`, surprise: `しんどいときの奥に『${d.tag}』があったこと`, surpriseShort: `しんどいときの奥に『${d.tag}』`, tryKey: `try:d:${item.id}`, tryText: `しんどいとき、『奥に${d.tag}はある？』と自分に聞いてみる` };
  }
  if (item.kind === 'H') {
    const n = NEED_BY_ID.get(item.id);
    return { heading: `『${n.wish}』`, parts: [part(COPY.lineupHard, hardCells((ep) => ep.needs.has(item.id)), item.c, nH)], short: `『${n.tag}』`, key: `h:${item.id}`, surprise: `しんどいとき、『${n.wish}』が足りなかったこと`, surpriseShort: `本当は『${n.wish}』`, tryKey: `try:${item.id}`, tryText: n.try };
  }
  const n = NEED_BY_ID.get(item.id);
  return { heading: `『${n.met}』`, parts: [part(COPY.lineupHappy, happy.map((ep) => ep.needs.has(item.id)), item.c, nJ)], short: `『${n.tag}』`, key: `j:${item.id}`, surprise: `うれしいときに『${n.met}』があったこと`, surpriseShort: `うれしいときに『${n.met}』`, tryKey: `try:${item.id}`, tryText: n.try };
}

// 場面の種類（SCENES の順・そのほかは除く）。2 種類以上のときだけ「バラバラ」と言う。
function sceneLabels(happy, hard) {
  const seen = new Set([...arr(happy), ...arr(hard)].map((ep) => ep?.scene).filter(Boolean));
  return SCENES.filter((scene) => scene.id !== 'sc_other' && seen.has(scene.id)).map((scene) => scene.label);
}

export function needsInsights(happyInput, hardInput) {
  const c = needsCounts(happyInput, hardInput);
  const { nJ, nH, nA } = c;
  const result = {
    ready: nA >= 3, nJ, nH, nA, ordered: [], rows: [], extra: [], pre: { X: [], H: [], J: [] }, empty: true, near: null, nearNeed: null, listLine: null,
    sceneLine: '', footer: '', footerAdd: '', topNeed: null,
    T: (id) => ({ T: c.T(id), hH: cnt(c.hH, id), hJ: cnt(c.hJ, id) }),
  };
  const nHardText = nH > 0 && nJ > 0 ? `しんどかった${nH}つ・うれしかった${nJ}つ` : nH > 0 ? `しんどかった${nH}つ` : `うれしかった${nJ}つ`;
  result.footer = `${nHardText}の答えから見えたことです。${COPY.insightFootShort}`;
  result.footerAdd = nJ < 3 || nH < 5 ? COPY.insightAddMore : '';
  // いちばん多い願い（予想と比べるときの「実際は」）
  const tops = NEEDS.filter((n) => c.T(n.id) >= 2).sort((a, b) => c.T(b.id) - c.T(a.id) || cnt(c.hH, b.id) - cnt(c.hH, a.id) || NEED_INDEX.get(a.id) - NEED_INDEX.get(b.id));
  result.topNeed = tops[0] ? { id: tops[0].id, tag: tops[0].tag, T: c.T(tops[0].id) } : null;
  // 少しだけ重なっていたもの
  const nearNeeds = tops.map((n) => ({ kind: 'need', id: n.id, count: c.T(n.id), hH: cnt(c.hH, n.id), hJ: cnt(c.hJ, n.id) }));
  const nearDeeps = DEEP.filter((d) => cnt(c.dH, d.id) >= 2).map((d) => ({ kind: 'deep', id: d.id, count: cnt(c.dH, d.id) })).sort((a, b) => b.count - a.count || DEEP_INDEX.get(a.id) - DEEP_INDEX.get(b.id));
  const nearAll = [...nearNeeds, ...nearDeeps].sort((a, b) => b.count - a.count || (a.kind === b.kind ? 0 : a.kind === 'need' ? -1 : 1));
  if (nearNeeds[0]) result.nearNeed = nearNeeds[0];
  if (nearAll[0]) {
    const top = nearAll[0];
    result.near = top.kind === 'need'
      ? { ...top, text: `『${NEED_BY_ID.get(top.id).tag}』　しんどかった${top.hH}つ・うれしかった${top.hJ}つ` }
      : { ...top, text: `『${DEEP_BY_ID.get(top.id).tag}』　しんどかった${top.count}つ` };
  }
  // 出てきた奥の気持ち（なければ満たされたもの）
  const deepSeen = DEEP.filter((d) => cnt(c.dH, d.id) >= 1);
  if (nH > 0 && deepSeen.length) result.listLine = { label: COPY.deepListHard, tags: deepSeen.map((d) => d.tag) };
  else if (nH === 0) { const met = NEEDS.filter((n) => cnt(c.hJ, n.id) >= 1); if (met.length) result.listLine = { label: COPY.deepListHappy, tags: met.map((n) => n.met) }; }
  if (!result.ready) return result;

  // 候補
  const X = NEEDS.filter((n) => cross(c, nA, n.id)).sort((a, b) => c.T(b.id) - c.T(a.id) || cnt(c.hH, b.id) - cnt(c.hH, a.id) || NEED_INDEX.get(a.id) - NEED_INDEX.get(b.id))
    .map((n) => ({ kind: 'X', id: n.id, hH: cnt(c.hH, n.id), hJ: cnt(c.hJ, n.id), c: c.T(n.id) }));
  const LD = []; const LN = [];
  for (const [surface, idx] of c.E.entries()) {
    const k = idx.length;
    for (const d of DEEP) { const hits = idx.filter((i) => c.hard[i].deep.has(d.id)).length; if (linked(hits, k)) LD.push({ kind: 'LD', surface, deep: d.id, k, c: hits }); }
    for (const n of NEEDS) { const hits = idx.filter((i) => c.hard[i].needs.has(n.id)).length; if (linked(hits, k)) LN.push({ kind: 'LN', surface, id: n.id, k, c: hits }); }
  }
  const linkSort = (secondIndex) => (a, b) => b.k - a.k || b.c - a.c || SURFACE_INDEX.get(a.surface) - SURFACE_INDEX.get(b.surface) || secondIndex(a) - secondIndex(b);
  LD.sort(linkSort((item) => DEEP_INDEX.get(item.deep)));
  LN.sort(linkSort((item) => NEED_INDEX.get(item.id)));
  const D = DEEP.filter((d) => repeat(cnt(c.dH, d.id), nH)).sort((a, b) => cnt(c.dH, b.id) - cnt(c.dH, a.id) || DEEP_INDEX.get(a.id) - DEEP_INDEX.get(b.id)).map((d) => ({ kind: 'D', id: d.id, c: cnt(c.dH, d.id) }));
  const H = NEEDS.filter((n) => repeat(cnt(c.hH, n.id), nH)).sort((a, b) => cnt(c.hH, b.id) - cnt(c.hH, a.id) || NEED_INDEX.get(a.id) - NEED_INDEX.get(b.id)).map((n) => ({ kind: 'H', id: n.id, c: cnt(c.hH, n.id) }));
  const J = NEEDS.filter((n) => repeat(cnt(c.hJ, n.id), nJ)).sort((a, b) => cnt(c.hJ, b.id) - cnt(c.hJ, a.id) || NEED_INDEX.get(a.id) - NEED_INDEX.get(b.id)).map((n) => ({ kind: 'J', id: n.id, c: cnt(c.hJ, n.id) }));
  result.pre = { X: X.map((i) => i.id), H: H.map((i) => i.id), J: J.map((i) => i.id) };

  // 重なりの整理：同じ奥の気持ち・同じ願い・同じ表の気持ちは 1 回だけ
  const usedDeep = new Set(); const usedNeed = new Set(); const usedSurface = new Set();
  for (const item of [...X, ...LD, ...D, ...LN, ...H, ...J]) {
    if (item.kind === 'X' || item.kind === 'H' || item.kind === 'J') { if (usedNeed.has(item.id)) continue; usedNeed.add(item.id); }
    else if (item.kind === 'D') { if (usedDeep.has(item.id)) continue; usedDeep.add(item.id); }
    else if (item.kind === 'LD') { if (usedSurface.has(item.surface) || usedDeep.has(item.deep)) continue; usedSurface.add(item.surface); usedDeep.add(item.deep); }
    else { if (usedSurface.has(item.surface) || usedNeed.has(item.id)) continue; usedSurface.add(item.surface); usedNeed.add(item.id); }
    const info = describeNeedsItem(item, c);
    result.ordered.push({ ...item, band: BAND_OF[item.kind], sentence: renderNeedsSentence(item, nJ, nH), ...info });
  }
  result.rows = result.ordered.slice(0, 4);
  result.extra = result.ordered.slice(4);
  result.empty = result.ordered.length === 0;
  const scenes = sceneLabels(happyInput, hardInput);
  if (!result.empty && scenes.length >= 2) result.sceneLine = COPY.scenesSpread(scenes);
  return result;
}

// 予想と実際（予想は願いを 1 つ）
export function needsGap(prediction, insights) {
  const id = arr(prediction)[0];
  const need = NEED_BY_ID.get(id);
  if (!need) return { rows: [], actual: '', hasMiss: false };
  const { T, hH, hJ } = insights.T(id);
  const hit = [...insights.pre.X, ...insights.pre.H, ...insights.pre.J].includes(id);
  let verdict; let text;
  if (hit) { verdict = 'hit'; text = `→ 思っていたとおり。${T}つの出来事の奥にありました（しんどかった${hH}・うれしかった${hJ}）。`; }
  else if (T >= 1) { verdict = 'partial'; text = `→ 少し当たり。${T}つの出来事にありました（しんどかった${hH}・うれしかった${hJ}）。`; }
  else { verdict = 'unseen'; text = '→ 今回の出来事には出てきませんでした。'; }
  const top = insights.topNeed;
  let actual = '';
  if (top && top.id !== id) actual = `実際は：いちばん多かったのは『${top.tag}』でした（${insights.nA}つのうち${top.T}つ）。`;
  else if (!top) actual = '実際は：出来事ごとに、ほしかったものがちがいました。';
  return { rows: [{ id, label: need.tag, thought: COPY.gapThought(need.tag), verdict, text }], actual, hasMiss: verdict !== 'hit' };
}

// 「並べる」表。列は うれしかった → しんどかった の順。null はその層が無い側。
export function needsLineup(happyInput, hardInput) {
  const c = needsCounts(happyInput, hardInput);
  const group = (id, label, list, indexMap, cellOf) => {
    const rows = list.map((item) => {
      const cells = [...c.happy.map((ep) => cellOf(ep, item, 'happy')), ...c.hard.map((ep) => cellOf(ep, item, 'hard'))];
      return { id: item.id, label: item.tag || item.label, cells, total: cells.filter((v) => v === true).length };
    }).filter((row) => row.total >= 1);
    return { id, label, rows };
  };
  const groups = [
    group('surface', COPY.lineupLayerSurface, SURFACE_HARD, SURFACE_INDEX, (ep, item, side) => (side === 'happy' ? null : ep.surface === item.id)),
    group('deep', COPY.lineupLayerDeep, DEEP, DEEP_INDEX, (ep, item, side) => (side === 'happy' ? null : ep.deep.has(item.id))),
    group('needs', COPY.lineupLayerNeeds, NEEDS, NEED_INDEX, (ep, item) => ep.needs.has(item.id)),
  ].filter((g) => g.rows.length);
  const memo = (list, label) => arr(list).map((ep, i) => {
    const scene = SCENE_BY_ID.get(ep?.scene)?.short || ''; const text = ep?.memo ? `「${ep.memo}」` : '';
    return scene || text ? { label: `${label}${i + 1}`, scene, memo: ep?.memo || '' } : null;
  }).filter(Boolean);
  return { nJ: c.nJ, nH: c.nH, groups, memos: [...memo(happyInput, COPY.lineupHappy), ...memo(hardInput, COPY.lineupHard)] };
}

// ---------- 第2章 頭の中の声 ----------
export function voiceCounts(episodesInput) {
  const episodes = arr(episodesInput).map((ep) => ({ thoughts: [...asSet(ep?.thoughts)].filter((id) => THOUGHT_BY_ID.has(id)) })).filter((ep) => ep.thoughts.length);
  const cT = new Map(); const cP = new Map(); const sets = { t: new Map(), p: new Map() }; const total = new Map();
  episodes.forEach((ep, index) => {
    const patterns = new Set(ep.thoughts.map((id) => THOUGHT_BY_ID.get(id).pattern));
    ep.thoughts.forEach((id) => { bump(cT, id); if (!sets.t.has(id)) sets.t.set(id, []); sets.t.get(id).push(index); bump(total, THOUGHT_BY_ID.get(id).pattern); });
    patterns.forEach((p) => { bump(cP, p); if (!sets.p.has(p)) sets.p.set(p, []); sets.p.get(p).push(index); });
  });
  return { episodes, n: episodes.length, cT, cP, sets, total };
}

const sameList = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
const voicesOf = (pattern) => THOUGHTS.filter((t) => t.pattern === pattern);

export function renderVoiceSentence(item, n) {
  if (item.kind === 'RP') {
    const name = PATTERN_BY_ID.get(item.id).name; const voices = item.voices.map((v) => `『${v}』`).join('');
    return item.c >= n ? `声はちがっても、${n}つとも『${name}』声でした（${voices}）。` : `声はちがっても、${n}つのうち${item.c}つは『${name}』声でした（${voices}）。`;
  }
  const t = THOUGHT_BY_ID.get(item.id).label;
  return item.c >= n ? `${n}つとも、『${t}』という声がしていました。` : `${n}つのうち${item.c}つで、『${t}』という声がしていました。`;
}

export function voiceInsights(episodesInput) {
  const v = voiceCounts(episodesInput);
  const { n } = v;
  const heard = THOUGHTS.filter((t) => cnt(v.cT, t.id) >= 1);
  const result = {
    ready: n >= 2, n, items: [], ordered: [], extra: [], empty: true, candidates: heard.map((t) => ({ id: t.id, label: t.label })),
    footer: `${n}つの場面から見えたことです。${COPY.insightFootShort}`, footerAdd: n < 5 ? COPY.voiceAddMore : '',
    patternsHeard: PATTERNS.filter((p) => cnt(v.cP, p.id) >= 1).map((p) => p.id),
    countOf: (id) => cnt(v.cP, id),
  };
  if (!result.ready) return result;
  const RT = THOUGHTS.filter((t) => repeat(cnt(v.cT, t.id), n));
  const RPs = PATTERNS.filter((p) => repeat(cnt(v.cP, p.id), n));
  const rows = [];
  for (const p of RPs) {
    const rts = RT.filter((t) => t.pattern === p.id);
    const same = rts.filter((t) => sameList(v.sets.t.get(t.id), v.sets.p.get(p.id)));
    if (same.length) {
      // 声の言葉そのものがくり返している方が具体的
      rts.forEach((t) => rows.push({ kind: 'RT', id: t.id, c: cnt(v.cT, t.id), pattern: p.id }));
    } else {
      rows.push({ kind: 'RP', id: p.id, c: cnt(v.cP, p.id), voices: voicesOf(p.id).filter((t) => cnt(v.cT, t.id) >= 1).map((t) => t.label), pattern: p.id });
    }
  }
  rows.sort((a, b) => b.c - a.c || (a.kind === b.kind ? 0 : a.kind === 'RP' ? -1 : 1)
    || (a.kind === 'RP' ? PATTERN_INDEX.get(a.id) - PATTERN_INDEX.get(b.id) : THOUGHT_INDEX.get(a.id) - THOUGHT_INDEX.get(b.id)));
  const cells = (indexes) => v.episodes.map((_, i) => indexes.includes(i));
  result.ordered = rows.map((item) => {
    const isP = item.kind === 'RP';
    const name = isP ? PATTERN_BY_ID.get(item.id).name : '';
    const label = isP ? name : THOUGHT_BY_ID.get(item.id).label;
    const idx = isP ? v.sets.p.get(item.id) : v.sets.t.get(item.id);
    return {
      ...item, sentence: renderVoiceSentence(item, n), heading: isP ? `『${name}』声` : `『${label}』`,
      cells: cells(idx), count: countText(item.c, n), paren: isP ? `（${item.voices.map((x) => `『${x}』`).join('')}）` : '',
      key: isP ? `p:${item.id}` : `t:${item.id}`,
      surprise: isP ? `声はちがっても、同じ『${name}』声だったこと` : `『${label}』の声がくり返していたこと`,
      surpriseShort: isP ? `『${name}』声` : `『${label}』の声`,
    };
  });
  result.items = result.ordered.slice(0, 3);
  result.extra = result.ordered.slice(3);
  result.empty = result.ordered.length === 0;
  return result;
}

// 注目するくせ（声に返す画面）。初期値は、くり返したくせ→いちばん多く出たくせ。
export function defaultFocus(episodesInput) {
  const v = voiceCounts(episodesInput);
  if (!v.n) return '';
  const ins = voiceInsights(episodesInput);
  if (ins.items[0]) return ins.items[0].pattern;
  const present = PATTERNS.filter((p) => cnt(v.cP, p.id) >= 1);
  present.sort((a, b) => cnt(v.cP, b.id) - cnt(v.cP, a.id) || cnt(v.total, b.id) - cnt(v.total, a.id) || PATTERN_INDEX.get(a.id) - PATTERN_INDEX.get(b.id));
  return present[0]?.id || '';
}
export function effectiveFocus(voice) {
  const eps = arr(voice?.episodes);
  const v = voiceCounts(eps);
  if (voice?.focus && cnt(v.cP, voice.focus) >= 1) return voice.focus;
  return defaultFocus(eps);
}
export const focusVoices = (voice, focus = effectiveFocus(voice)) => {
  const v = voiceCounts(arr(voice?.episodes));
  return voicesOf(focus).filter((t) => cnt(v.cT, t.id) >= 1);
};
export const focusChoices = (voice) => {
  const v = voiceCounts(arr(voice?.episodes));
  return PATTERNS.filter((p) => cnt(v.cP, p.id) >= 1);
};
export const replyOptions = (focus) => [...REPLIES.filter((r) => r.pattern === focus && focus), ...REPLIES.filter((r) => r.pattern === '')];

export function voiceLineup(episodesInput) {
  const v = voiceCounts(episodesInput);
  const groups = PATTERNS.filter((p) => cnt(v.cP, p.id) >= 1).map((p) => ({
    id: p.id, name: `${p.name}声`, cells: v.episodes.map((_, i) => v.sets.p.get(p.id).includes(i)),
    rows: voicesOf(p.id).filter((t) => cnt(v.cT, t.id) >= 1).map((t) => ({ id: t.id, label: t.label, cells: v.episodes.map((_, i) => v.sets.t.get(t.id).includes(i)) })),
  }));
  const memos = arr(episodesInput).map((ep, i) => {
    const scene = SCENE_BY_ID.get(ep?.scene)?.short || '';
    return scene || ep?.memo ? { label: `${i + 1}`, scene, memo: ep?.memo || '' } : null;
  }).filter(Boolean);
  return { n: v.n, groups, memos };
}

// ---------- 第3章 心が動くとき ----------
export function valuesCounts(negInput, posInput, admireInput) {
  const counts = new Map(VALUES.map((value) => [value.id, { a: 0, p: 0, m: 0, c: 0 }]));
  for (const ep of arr(negInput)) { const row = counts.get(ep?.value); if (row) { row.a += 1; row.c += 1; } }
  for (const ep of arr(posInput)) { const row = counts.get(ep?.value); if (row) { row.p += 1; row.c += 1; } }
  const quals = arr(admireInput?.qualities);
  for (const id of new Set(quals.map((q) => q?.value))) { const row = counts.get(id); if (row) { row.m += 1; row.c += 1; } }
  return counts;
}
export const admireItems = (admire) => (arr(admire?.qualities).length ? 1 : 0);

const KIND_HEAD = { 'a,p,m': 'イラッとした出来事にも、うれしかった出来事にも、いいなと思った人にも', 'a,p': 'イラッとした出来事にも、うれしかった出来事にも', 'a,m': 'イラッとした出来事にも、いいなと思った人にも', 'p,m': 'うれしかった出来事にも、いいなと思った人にも' };
export function renderValuesSentence(item) {
  const kinds = [item.a > 0 ? 'a' : '', item.p > 0 ? 'p' : '', item.m > 0 ? 'm' : ''].filter(Boolean);
  if (kinds.length >= 2) return `${KIND_HEAD[kinds.join(',')]}、『${item.label}』が関わっていました（${item.T}つのうち${item.c}つ）。`;
  if (kinds[0] === 'a') return `イラッとした出来事のうち${item.a}つは、『${item.label}』が守られなかったときでした。`;
  return `うれしかった出来事のうち${item.p}つは、『${item.label}』があったときでした。`;
}

export function valuesInsights(negInput, posInput, admireInput) {
  const neg = arr(negInput); const pos = arr(posInput);
  const hasAdmire = admireItems(admireInput);
  const T = neg.length + pos.length + hasAdmire; const E = neg.length + pos.length;
  const counts = valuesCounts(neg, pos, admireInput);
  const result = {
    ready: T >= 3, T, E, hasAdmire: Boolean(hasAdmire), items: [], ordered: [], extra: [], candidates: [], empty: true, summary: '',
    footer: hasAdmire ? `${E}つの出来事と、いいなと思った人から見えたことです。${COPY.insightFootShort}` : `${E}つの出来事から見えたことです。${COPY.insightFootShort}`,
    countOf: (id) => counts.get(id)?.c || 0,
  };
  result.candidates = VALUES.filter((value) => counts.get(value.id).c >= 1).map((value) => ({ id: value.id, label: value.label }));
  if (!result.ready) return result;
  const span = (row) => Number(row.a > 0) + Number(row.p > 0) + Number(row.m > 0);
  const commons = VALUES.map((value) => ({ value, index: VALUE_INDEX.get(value.id), ...counts.get(value.id) })).filter((row) => row.c >= 2);
  commons.sort((x, y) => span(y) - span(x) || y.c - x.c || x.index - y.index);
  result.ordered = commons.map((row) => {
    const item = { id: row.value.id, label: row.value.label, c: row.c, a: row.a, p: row.p, m: row.m, T };
    return { ...item, sentence: renderValuesSentence(item) };
  });
  result.items = result.ordered.slice(0, 2); result.extra = result.ordered.slice(2);
  result.empty = result.ordered.length === 0;
  const top = result.items.map((item) => `『${item.label}』`);
  result.summary = top.length === 1 ? `${top[0]}を大事にしているのかもしれません。` : top.length === 2 ? `${top[0]}と${top[1]}を大事にしているのかもしれません。` : '';
  return result;
}

export function valuesGap(prediction, insights, neg, pos, admire) {
  const id = arr(prediction)[0];
  const value = VALUE_BY_ID.get(id);
  if (!value) return { rows: [], actual: '', hasMiss: false };
  const row = valuesCounts(neg, pos, admire).get(id);
  let verdict; let text;
  if (row.c >= 2) { verdict = 'hit'; text = `→ 思っていたとおり。心が動いた出来事のうち${row.c}つに関わっていました。`; }
  else if (row.c === 1) { verdict = 'partial'; text = '→ 少し当たり。1つの出来事に関わっていました。'; }
  else { verdict = 'unseen'; text = '→ 今回の出来事には出てきませんでした。'; }
  const top = insights.ordered[0];
  const actual = top && top.id !== id ? `実際は：心が動いた出来事の裏には『${top.label}』がありました。` : '';
  return { rows: [{ id, label: value.label, thought: COPY.gapThought(value.label), verdict, text }], actual, hasMiss: verdict !== 'hit' };
}

// ---------- 章の準備ができているか ----------
export function chapterReady(chapterId, data) {
  const d = data?.[chapterId];
  if (!d) return false;
  if (chapterId === 'needs') return d.happy.length + d.hard.length >= 3;
  if (chapterId === 'voice') return d.episodes.length >= 2;
  return d.neg.length + d.pos.length + admireItems(d.admire) >= 3;
}

export function insightsFor(chapterId, data) {
  const d = data[chapterId];
  if (chapterId === 'needs') return needsInsights(d.happy, d.hard);
  if (chapterId === 'voice') return voiceInsights(d.episodes);
  return valuesInsights(d.neg, d.pos, d.admire);
}

export function gapFor(chapterId, data, insights = insightsFor(chapterId, data)) {
  const d = data[chapterId];
  if (chapterId === 'needs') return needsGap(d.prediction, insights);
  if (chapterId === 'values') return valuesGap(d.prediction, insights, d.neg, d.pos, d.admire);
  return { rows: [], actual: '', hasMiss: false };
}

// ---------- 重さへの配慮（そっと添える一文を出すか） ----------
export function heavyNote(chapterId, data) {
  if (!chapterReady(chapterId, data)) return false;
  if (chapterId === 'needs') {
    const heavy = arr(data.needs.hard).filter((ep) => arr(ep.deep).some((id) => id === 'dp_empty' || id === 'dp_full')).length;
    return heavy >= 2;
  }
  if (chapterId === 'voice') {
    const eps = arr(data.voice.episodes);
    return eps.length >= 2 && eps.every((ep) => arr(ep.thoughts).some((id) => { const p = THOUGHT_BY_ID.get(id)?.pattern; return p === 'pt_alone' || p === 'pt_blame'; }));
  }
  return false;
}

// ---------- 章をまたぐ対応（トリセツ 5 の最後の 1 行） ----------
export function crossLink(data) {
  if (!chapterReady('needs', data) || !chapterReady('values', data)) return '';
  const needs = needsInsights(data.needs.happy, data.needs.hard);
  const values = valuesInsights(data.values.neg, data.values.pos, data.values.admire);
  if (values.empty) return '';
  const shown = new Set(values.items.map((item) => item.id));
  for (const item of needs.ordered.filter((i) => i.kind === 'X' || i.kind === 'H' || i.kind === 'J')) {
    const valueId = NEED_TO_VALUE[item.id];
    if (valueId && shown.has(valueId)) return `満たされるものの『${NEED_BY_ID.get(item.id).tag}』と、大事にしていることの『${VALUE_BY_ID.get(valueId).label}』は、つながっているようです。`;
  }
  return '';
}

// ---------- 目次の短い一行 ----------
export function teaser(chapterId, data) {
  if (!chapterReady(chapterId, data)) return '';
  const insights = insightsFor(chapterId, data);
  const prefix = COPY.teaserPrefix;
  if (chapterId === 'needs') {
    const top = insights.ordered[0];
    if (!top) return `${prefix}${CHAPTERS[0].teaserNone}`;
    const n = top.kind === 'LD' ? null : NEED_BY_ID.get(top.id);
    if (top.kind === 'X') return `${prefix}奥に『${n.tag}』`;
    if (top.kind === 'LD') return `${prefix}『${SURFACE_BY_ID.get(top.surface).tag}』の奥に『${DEEP_BY_ID.get(top.deep).tag}』`;
    if (top.kind === 'D') return `${prefix}しんどいときの奥に『${DEEP_BY_ID.get(top.id).tag}』`;
    if (top.kind === 'LN' || top.kind === 'H') return `${prefix}本当は『${n.wish}』`;
    return `${prefix}うれしいときに『${n.met}』`;
  }
  if (chapterId === 'voice') {
    const top = insights.ordered[0];
    if (!top) return `${prefix}${CHAPTERS[1].teaserNone}`;
    return top.kind === 'RP' ? `${prefix}『${PATTERN_BY_ID.get(top.id).name}』声がくり返していました` : `${prefix}『${PATTERN_BY_ID.get(top.pattern).name}』声に気づいた`;
  }
  if (insights.ordered[0]) return `${prefix}『${insights.ordered[0].label}』を大事にしているのかも`;
  return `${prefix}大事なことの候補が${insights.candidates.length}つ見つかりました`;
}

// ---------- 「意外だったこと」「来週ためすこと」の候補 ----------
export function surpriseOptions(chapterId, data) {
  if (!chapterReady(chapterId, data)) return [];
  const insights = insightsFor(chapterId, data);
  const options = [];
  if (chapterId === 'needs') {
    for (const item of insights.ordered.slice(0, 5)) options.push({ key: item.key, label: item.surprise, short: item.surpriseShort });
    if (insights.empty) options.push({ key: 'spread', label: COPY.surpriseSpreadNeeds, short: COPY.surpriseSpreadNeeds });
    if (arr(data.needs.prediction).length && gapFor('needs', data, insights).hasMiss) options.push({ key: 'gap', label: COPY.surpriseGap, short: COPY.surpriseGap });
  } else if (chapterId === 'voice') {
    for (const item of insights.ordered) options.push({ key: item.key, label: item.surprise, short: item.surpriseShort });
    for (const id of arr(data.voice.intents)) { const intent = INTENT_BY_ID.get(id); if (intent) options.push({ key: `i:${id}`, label: `その声が『${intent.label}』と守ろうとしていたこと`, short: `声が『${intent.label}』と守っていた` }); }
    if (insights.empty) options.push({ key: 'spread', label: COPY.surpriseSpreadVoice, short: COPY.surpriseSpreadVoice });
  } else {
    for (const item of insights.ordered) options.push({ key: `v:${item.id}`, label: `『${item.label}』が関わっていたこと`, short: `『${item.label}』が関わっていたこと` });
    for (const q of arr(data.values.admire?.qualities)) { const quality = QUALITY_BY_ID.get(q.id); if (quality) options.push({ key: `q:${q.id}`, label: `いいなと思った人の『${quality.label}』ところ`, short: `あこがれは『${quality.wish}』` }); }
    if (insights.empty) options.push({ key: 'spread', label: COPY.surpriseSpreadValues, short: COPY.surpriseSpreadValues });
    if (arr(data.values.prediction).length && gapFor('values', data, insights).hasMiss) options.push({ key: 'gap', label: COPY.surpriseGap, short: COPY.surpriseGap });
  }
  options.push({ key: 'none', label: COPY.surpriseNone, short: MANUAL_COPY.surpriseNone });
  return options;
}

export function tryOptions(chapterId, data) {
  if (!chapterReady(chapterId, data)) return [];
  const insights = insightsFor(chapterId, data);
  const list = [];
  if (chapterId === 'needs') {
    for (const item of insights.rows) list.push({ key: item.tryKey, text: item.tryText });
    if (insights.empty && insights.nearNeed) { const n = NEED_BY_ID.get(insights.nearNeed.id); list.push({ key: `try:${n.id}`, text: n.try }); }
  } else if (chapterId === 'voice') {
    const focus = effectiveFocus(data.voice);
    const pattern = PATTERN_BY_ID.get(focus);
    if (pattern) list.push({ key: `try:${focus}`, text: pattern.try });
    if (data.voice.reply || data.voice.replyText) list.push({ key: 'try:reply', text: 'その声がしたら、決めた言葉を自分にかけてみる' });
  } else {
    const source = insights.ordered.length ? insights.ordered : insights.candidates.slice(0, 2);
    for (const item of source) list.push({ key: `try:${item.id}`, text: VALUE_BY_ID.get(item.id).tryMore });
    for (const q of arr(data.values.admire?.qualities)) { const quality = QUALITY_BY_ID.get(q.id); if (quality) list.push({ key: `try:q:${q.id}`, text: `『${quality.wish}』を、小さく1回やってみる` }); }
  }
  const seen = new Set(); const options = [];
  for (const item of list) { if (seen.has(item.text) || seen.has(item.key)) continue; seen.add(item.text); seen.add(item.key); options.push(item); if (options.length >= 4) break; }
  const chapter = CHAPTERS.find((item) => item.id === chapterId);
  options.push({ key: chapter.again.key, text: chapter.again.text });
  return options;
}

// 保存された key が今の候補にあるか（無ければ「無かったこと」にする）
export function pruneChoices(data) {
  let changed = false;
  const voice = data.voice;
  if (voice) {
    const v = voiceCounts(voice.episodes);
    if (voice.focus && cnt(v.cP, voice.focus) < 1) { voice.focus = ''; changed = true; }
    const focus = effectiveFocus(voice);
    if (voice.reply && !replyOptions(focus).some((r) => r.id === voice.reply)) { voice.reply = ''; changed = true; }
  }
  for (const chapter of CHAPTERS) {
    const d = data[chapter.id];
    const surprise = surpriseOptions(chapter.id, data); const tries = tryOptions(chapter.id, data);
    if (d.surprise && !surprise.some((item) => item.key === d.surprise)) { d.surprise = ''; changed = true; }
    if (d.experiment && !tries.some((item) => item.key === d.experiment)) { d.experiment = ''; changed = true; }
  }
  return changed;
}

export function shortOfSurprise(chapterId, data) {
  const d = data[chapterId];
  if (d.surpriseText) return `「${d.surpriseText}」`;
  if (!d.surprise) return '';
  const option = surpriseOptions(chapterId, data).find((item) => item.key === d.surprise);
  return option ? option.short : '';
}

export function textOfTry(chapterId, data) {
  const d = data[chapterId];
  if (d.experimentText) return `「${d.experimentText}」`;
  if (!d.experiment) return '';
  return tryOptions(chapterId, data).find((item) => item.key === d.experiment)?.text || '';
}

// 「自分のトリセツ」の気づきの集計（純粋関数）。
// - 入力はチップ id の配列だけ。自由文（メモ・意外・ためすの自由文）は一切数えない。
// - DOM・storage・通信に触らない。比較はすべて整数（分数のまま）で行う。
// - 返すのは文の部品と数。文字列の組み立てはこのファイルの render* に集める。
import {
  CHAPTERS, ENERGY_FEATURES, DAY_CHIPS, COMBO_FEATURES, OPPOSITES, MIRROR, BODY_GROUP, INSIGHT_GROUP_ORDER, LINEUP_GROUP_ORDER, ENERGY_PREDICTIONS,
  VALUES, STRENGTHS, TASKS, COPY, DAY_MIN, DAY_MAX,
} from './data/torisetsu-content.js';

const FEATURE_BY_ID = new Map(ENERGY_FEATURES.map((feature) => [feature.id, feature]));
const FEATURE_INDEX = new Map(ENERGY_FEATURES.map((feature, index) => [feature.id, index]));
const CHIP_BY_ID = new Map(DAY_CHIPS.map((chip) => [chip.id, chip]));
const VALUE_BY_ID = new Map(VALUES.map((value) => [value.id, value]));
const VALUE_INDEX = new Map(VALUES.map((value, index) => [value.id, index]));
const STRENGTH_BY_ID = new Map(STRENGTHS.map((item) => [item.id, item]));
const STRENGTH_INDEX = new Map(STRENGTHS.map((item, index) => [item.id, index]));
const TASK_BY_ID = new Map(TASKS.map((task) => [task.id, task]));
const COMBO = Object.fromEntries(COMBO_FEATURES.map((feature) => [feature.id, feature]));

export const featureById = (id) => FEATURE_BY_ID.get(id) || null;
export const valueById = (id) => VALUE_BY_ID.get(id) || null;
export const strengthById = (id) => STRENGTH_BY_ID.get(id) || null;

const asArray = (value) => (Array.isArray(value) ? value : value ? [value] : []);

// ---------- 第1章 ----------
// 1日の特徴の集合（rep のチップ＋組み立て特徴）
export function dayFeatures(day) {
  const out = new Set();
  const who = asArray(day?.who); const where = asArray(day?.where);
  const ids = [...who, ...where, ...asArray(day?.doing), ...asArray(day?.sleep), ...asArray(day?.body)];
  for (const id of ids) { const chip = CHIP_BY_ID.get(id); if (chip && chip.rep) out.add(id); }
  if (where.some((id) => COMBO.out.members.includes(id))) out.add('out');
  if (where.length > 0 && where.every((id) => id === 'where_home')) out.add('home_only');
  if (who.some((id) => COMBO.people.members.includes(id))) out.add('people');
  return out;
}

// 片側の判定。own/other はその側／反対側の日数、nOwn/nOther はそれぞれの日数。
export function classifySide(own, other, nOwn, nOther) {
  if (nOwn < 1 || nOther < 1 || own < 2) return null;
  if (own * 3 >= 2 * nOwn && other === 0) return 'A';
  if ((own * nOther - other * nOwn) * 2 >= nOwn * nOther) return 'B';
  return null;
}

const sideWord = (side) => (side === 'good' ? '調子がよかった日' : '調子が悪かった日');
const otherWord = (side) => (side === 'good' ? '調子が悪かった日' : '調子がよかった日');

export function renderEnergySentence(item) {
  const own = item.side === 'good' ? item.g : item.b;
  const nOwn = item.side === 'good' ? item.nG : item.nB;
  if (item.stage === 'A') {
    const stem = item.side === 'good' ? '調子がよかった' : '調子が悪かった';
    const head = own === nOwn ? `${stem}${nOwn}日には、${nOwn}日とも『${item.tag}』がありました。` : `${stem}${nOwn}日のうち${own}日に『${item.tag}』がありました。`;
    return `${head}${otherWord(item.side)}には、1日もありませんでした。`;
  }
  const other = item.side === 'good' ? item.b : item.g;
  const nOther = item.side === 'good' ? item.nB : item.nG;
  return `『${item.tag}』は、${sideWord(item.side)}に多く出ていました（${item.side === 'good' ? 'よかった日' : '悪かった日'}${nOwn}日中${own}日、${item.side === 'good' ? '悪かった日' : 'よかった日'}${nOther}日中${other}日）。`;
}

// 「3日とも」「3日中2日」「0日」
export const countText = (k, n) => (k <= 0 ? '0日' : k >= n ? `${n}日とも` : `${n}日中${k}日`);

// 見つけたことの1行（表示用）。own = その特徴が多い側、other = 反対側。cells は日ごとの有無。
export function renderEnergyRow(item) {
  const goodCells = Array.isArray(item.goodCells) ? item.goodCells : [];
  const badCells = Array.isArray(item.badCells) ? item.badCells : [];
  const goodSide = { label: 'よかった日', cells: goodCells, count: countText(item.g, item.nG) };
  const badSide = { label: '悪かった日', cells: badCells, count: countText(item.b, item.nB) };
  return item.side === 'good' ? { tag: item.tag, own: goodSide, other: badSide } : { tag: item.tag, own: badSide, other: goodSide };
}

// 「よかった日3日と、悪かった日3日を比べました。」と、各側の先頭の一言
export function energySummaryLine(ins) {
  const topGood = ins.ordered.good[0]; const topBad = ins.ordered.bad[0];
  if (topGood && topBad) return `よかった日には『${topGood.tag}』、悪かった日には『${topBad.tag}』がありました。`;
  if (topGood) return `よかった日には『${topGood.tag}』がありました。`;
  if (topBad) return `悪かった日には『${topBad.tag}』がありました。`;
  return '';
}

export function energyFooter(nG, nB) {
  const base = nG === nB ? `${nG}日ずつの答えから見えたことです。決まりではありません。` : `よかった日${nG}日・悪かった日${nB}日の答えから見えたことです。決まりではありません。`;
  return { footer: base, footerShort: COPY.insightFootShort, footerAdd: nG < DAY_MAX || nB < DAY_MAX ? '日を足すと、もっとはっきりするかもしれません。' : '' };
}

const compareItems = (a, b) =>
  (a.stage === b.stage ? 0 : a.stage === 'A' ? -1 : 1)
  || b.diffNum - a.diffNum
  || b.days - a.days
  || INSIGHT_GROUP_ORDER[a.feature.group] - INSIGHT_GROUP_ORDER[b.feature.group]
  || FEATURE_INDEX.get(a.id) - FEATURE_INDEX.get(b.id);

export function energyCounts(good, bad) {
  const goodSets = good.map(dayFeatures); const badSets = bad.map(dayFeatures);
  const counts = new Map();
  for (const feature of ENERGY_FEATURES) {
    counts.set(feature.id, { g: goodSets.filter((set) => set.has(feature.id)).length, b: badSets.filter((set) => set.has(feature.id)).length });
  }
  return { counts, goodSets, badSets };
}

export function energyInsights(goodInput, badInput) {
  const good = Array.isArray(goodInput) ? goodInput : []; const bad = Array.isArray(badInput) ? badInput : [];
  const nG = good.length; const nB = bad.length;
  const result = {
    ready: nG >= DAY_MIN && nB >= DAY_MIN, nG, nB,
    good: [], bad: [], ordered: { good: [], bad: [] }, extra: { good: [], bad: [] }, candidates: { good: [], bad: [] },
    nearMiss: null, empty: true, sideNote: { good: '', bad: '' }, compareLine: COPY.compareLine(nG, nB), summary: '', ...energyFooter(nG, nB),
  };
  if (!result.ready) return result;
  const { counts, goodSets, badSets } = energyCounts(good, bad);
  const make = (feature, side, stage, g, b) => ({
    id: feature.id, tag: feature.tag, side, stage, g, b, nG, nB, feature,
    goodCells: goodSets.map((set) => set.has(feature.id)), badCells: badSets.map((set) => set.has(feature.id)),
    diffNum: side === 'good' ? g * nB - b * nG : b * nG - g * nB, days: side === 'good' ? g : b,
  });
  // 1. 候補（A と B）
  let candidates = [];
  for (const feature of ENERGY_FEATURES) {
    const { g, b } = counts.get(feature.id);
    const goodStage = classifySide(g, b, nG, nB); const badStage = classifySide(b, g, nB, nG);
    if (goodStage) candidates.push(make(feature, 'good', goodStage, g, b));
    else if (badStage) candidates.push(make(feature, 'bad', badStage, g, b));
  }
  const preGood = candidates.filter((item) => item.side === 'good').sort(compareItems);
  const preBad = candidates.filter((item) => item.side === 'bad').sort(compareItems);
  result.candidates = { good: preGood, bad: preBad };
  // 2. 中身が同じなら細かい方を残す
  candidates = candidates.filter((item) => {
    if (item.feature.kind !== 'combo') return true;
    return !candidates.some((other) => other.side === item.side && other.feature.kind === 'chip' && item.feature.members.includes(other.id) && other.g === item.g && other.b === item.b);
  });
  // 3. 打ち消しペアは強い方だけ
  for (const [x, y] of OPPOSITES) {
    const a = candidates.find((item) => item.id === x); const b = candidates.find((item) => item.id === y);
    if (!a || !b) continue;
    const winner = a.stage !== b.stage ? (a.stage === 'A' ? a : b)
      : a.diffNum !== b.diffNum ? (a.diffNum > b.diffNum ? a : b)
        : a.days !== b.days ? (a.days > b.days ? a : b)
          : (a.side === 'good' ? a : b);
    candidates = candidates.filter((item) => item === winner || (item !== a && item !== b));
  }
  // 4・5. 側ごとに並べ、上から3つを文に
  for (const side of ['good', 'bad']) {
    const all = candidates.filter((item) => item.side === side).sort(compareItems).map((item) => ({ ...item, sentence: renderEnergySentence(item), row: renderEnergyRow(item) }));
    // 体の調子は「調子」そのものに近いので、帯には出さず「ほかに見えたこと」の最後に回す
    const ordered = all.filter((item) => item.feature.group !== BODY_GROUP);
    const body = all.filter((item) => item.feature.group === BODY_GROUP);
    result.ordered[side] = ordered;
    result[side] = ordered.slice(0, 3);
    result.extra[side] = [...ordered.slice(3), ...body];
  }
  result.summary = energySummaryLine(result);
  result.empty = result.ordered.good.length === 0 && result.ordered.bad.length === 0;
  if (result.empty) result.nearMiss = findNearMiss(counts, nG, nB);
  else {
    if (!result.ordered.good.length) result.sideNote.good = '調子がよかった日だけにある共通点は、まだ見えません。';
    if (!result.ordered.bad.length) result.sideNote.bad = '調子が悪かった日だけにある共通点は、まだ見えません。';
  }
  return result;
}

function findNearMiss(counts, nG, nB) {
  const list = [];
  for (const feature of ENERGY_FEATURES) {
    if (feature.group === 'sleep' || feature.group === 'body') continue;
    const { g, b } = counts.get(feature.id);
    const goodNum = g * nB - b * nG; const badNum = b * nG - g * nB;
    if (g >= 1 && feature.power && goodNum * 3 >= nG * nB) list.push({ feature, side: 'good', g, b, diffNum: goodNum, days: g });
    else if (b >= 1 && feature.lamp && badNum * 3 >= nG * nB) list.push({ feature, side: 'bad', g, b, diffNum: badNum, days: b });
  }
  list.sort((a, b) => b.diffNum - a.diffNum || b.days - a.days || (a.side === b.side ? 0 : a.side === 'good' ? -1 : 1)
    || INSIGHT_GROUP_ORDER[a.feature.group] - INSIGHT_GROUP_ORDER[b.feature.group] || FEATURE_INDEX.get(a.feature.id) - FEATURE_INDEX.get(b.feature.id));
  const top = list[0];
  if (!top) return null;
  return {
    id: top.feature.id, tag: top.feature.tag, side: top.side, g: top.g, b: top.b,
    text: top.side === 'good' ? `『${top.feature.tag}』　よかった日 ${top.g}日／悪かった日 ${top.b}日` : `『${top.feature.tag}』　悪かった日 ${top.b}日／よかった日 ${top.g}日`,
  };
}

// 予想と実際
export function energyGap(prediction, insights, good, bad) {
  const ids = (Array.isArray(prediction) ? prediction : []).filter((id) => ENERGY_PREDICTIONS.some((item) => item.id === id));
  const { counts } = energyCounts(good || [], bad || []);
  const nG = insights.nG; const nB = insights.nB;
  // 予想の「反対」が、悪かった日の見つけたことに出ているか
  const mirrorItem = (id) => { const mirror = MIRROR[id]; return mirror ? insights.ordered.bad.find((item) => item.id === mirror) || null : null; };
  const rows = ids.map((id) => {
    const label = ENERGY_PREDICTIONS.find((item) => item.id === id).label;
    const { g, b } = counts.get(id) || { g: 0, b: 0 };
    let verdict; let text;
    if (insights.candidates.good.some((item) => item.id === id)) { verdict = 'hit'; text = `→ 思っていたとおり。調子がよかった${nG}日のうち${g}日にありました（悪かった日は${b}日）。`; }
    else if (mirrorItem(id)) { const m = mirrorItem(id); verdict = 'mirror'; text = `→ 当たっていそう。調子が悪かった日に『${m.tag}』が${m.b}日ありました（よかった日は${m.g}日）。`; }
    else if (g * 3 >= 2 * nG && b * 3 >= 2 * nB) { verdict = 'both'; text = `→ よかった日にも悪かった日にもありました（${g}日と${b}日）。調子を分けるものではなかったのかもしれません。`; }
    else if (g >= 1 && g * nB > b * nG) { verdict = 'partial'; text = `→ 少し当たり。調子がよかった日に${g}日ありました（悪かった日は${b}日）。`; }
    else if (insights.candidates.bad.some((item) => item.id === id)) { verdict = 'reverse'; text = `→ 今回は、調子が悪かった日の方に多く出ていました（よかった日${g}日、悪かった日${b}日）。`; }
    else { verdict = 'unseen'; text = '→ 今回の答えでは、調子のいい日との結びつきは見えませんでした。'; }
    return { id, label, thought: COPY.gapThought(label), verdict, text, g, b };
  });
  const topGood = insights.ordered.good[0]; const topBad = insights.ordered.bad[0];
  let actual = '';
  if (topGood) actual = ids.includes(topGood.id) ? '' : `実際は：調子がよかった日には『${topGood.tag}』がありました。`;
  else if (topBad) actual = `実際は：調子が悪かった日に『${topBad.tag}』がありました。`;
  else actual = 'まだ見えないだけかもしれません。日を足すと、比べやすくなります。';
  return { rows, actual, hasMiss: rows.some((row) => row.verdict !== 'hit') };
}

// 「並べる」表（1日でも出た特徴の行。表の並びは 何を→誰と→どこ→前の晩→体）
export function energyLineup(good, bad) {
  const { counts, goodSets, badSets } = energyCounts(good, bad);
  const rows = ENERGY_FEATURES.filter((feature) => { const c = counts.get(feature.id); return c.g + c.b > 0; })
    .sort((a, b) => LINEUP_GROUP_ORDER[a.group] - LINEUP_GROUP_ORDER[b.group] || FEATURE_INDEX.get(a.id) - FEATURE_INDEX.get(b.id))
    .map((feature) => ({ id: feature.id, tag: feature.tag, good: goodSets.map((set) => set.has(feature.id)), bad: badSets.map((set) => set.has(feature.id)) }));
  return rows;
}

// ---------- 第2章 ----------
export function valuesCounts(neg, pos) {
  const counts = new Map(VALUES.map((value) => [value.id, { c: 0, a: 0, p: 0 }]));
  for (const ep of neg || []) { const row = counts.get(ep.value); if (row) { row.c += 1; row.a += 1; } }
  for (const ep of pos || []) { const row = counts.get(ep.value); if (row) { row.c += 1; row.p += 1; } }
  return counts;
}

export function renderValuesSentence(item) {
  if (item.kind === 'both') return `イラッと・がっかりした出来事と、うれしかった出来事。反対の気持ちなのに、どちらにも『${item.label}』が関わっていました。（${item.T}つの出来事のうち${item.c}つ）`;
  if (item.kind === 'neg') return `イラッと・がっかりした出来事のうち${item.a}つは、『${item.label}』が守られなかったときでした。`;
  return `うれしかった出来事のうち${item.p}つは、『${item.label}』があったときでした。`;
}

export function valuesInsights(negInput, posInput) {
  const neg = Array.isArray(negInput) ? negInput : []; const pos = Array.isArray(posInput) ? posInput : [];
  const T = neg.length + pos.length;
  const counts = valuesCounts(neg, pos);
  const result = { ready: neg.length >= 1 && pos.length >= 1 && T >= 3, T, items: [], ordered: [], extra: [], candidates: [], empty: true, summary: '', footer: `${T}つの出来事から見えたことです。決まりではありません。` };
  if (!result.ready) return result;
  const commons = VALUES.map((value, index) => ({ value, index, ...counts.get(value.id) })).filter((row) => row.c >= 2);
  commons.sort((x, y) => (Number(y.a >= 1 && y.p >= 1) - Number(x.a >= 1 && x.p >= 1)) || y.c - x.c || x.index - y.index);
  const ordered = commons.map((row) => {
    const kind = row.a >= 1 && row.p >= 1 ? 'both' : row.a >= 1 ? 'neg' : 'pos';
    const item = { id: row.value.id, label: row.value.label, c: row.c, a: row.a, p: row.p, T, kind };
    return { ...item, sentence: renderValuesSentence(item) };
  });
  result.ordered = ordered; result.items = ordered.slice(0, 2); result.extra = ordered.slice(2);
  result.empty = ordered.length === 0;
  result.candidates = VALUES.filter((value) => counts.get(value.id).c >= 1).map((value) => ({ id: value.id, label: value.label }));
  const top = result.items.map((item) => `『${item.label}』`);
  result.summary = top.length === 1 ? `${top[0]}を大事にしているのかもしれません。` : top.length === 2 ? `${top[0]}と${top[1]}を大事にしているのかもしれません。` : '';
  return result;
}

export function valuesGap(prediction, insights, neg, pos) {
  const id = (Array.isArray(prediction) ? prediction : [])[0];
  const value = VALUE_BY_ID.get(id);
  if (!value) return { rows: [], actual: '', hasMiss: false };
  const row = valuesCounts(neg || [], pos || []).get(id);
  let verdict; let text;
  if (row.c >= 2) { verdict = 'hit'; text = `→ 思っていたとおり。心が動いた出来事のうち${row.c}つに関わっていました。`; }
  else if (row.c === 1) { verdict = 'partial'; text = '→ 少し当たり。1つの出来事に関わっていました。'; }
  else { verdict = 'unseen'; text = '→ 今回の出来事には出てきませんでした。'; }
  const top = insights.ordered[0];
  const actual = top && top.id !== id ? `実際は：心が動いた出来事の裏には『${top.label}』がありました。` : '';
  return { rows: [{ id, label: value.label, thought: COPY.gapThought(value.label), verdict, text }], actual, hasMiss: verdict !== 'hit' };
}

// ---------- 第3章 ----------
// 人からの出来事の種類（頼まれた／お礼を言われた／ほめられた）を、自然な言い方にする。
const KIND_PART = { k_asked: '頼られ', k_thanked: 'お礼を言われ', k_praised: 'ほめられ' };
const KIND_ORDER = ['k_asked', 'k_thanked', 'k_praised'];
export function othersPhrase(kindSet, tail = 'past') {
  const kinds = KIND_ORDER.filter((id) => kindSet && kindSet.has(id));
  const suffix = { past: 'ていました', present: 'ています', noun: 'ていたこと' };
  if (kinds.length <= 1) {
    const only = kinds[0];
    const stem = !only || only === 'k_asked' ? '頼りにされ' : KIND_PART[only];
    return `${stem}${suffix[tail]}`;
  }
  const tails = { past: 'していました', present: 'しています', noun: 'していたこと' };
  return `${kinds.map((id) => `${KIND_PART[id]}たり`).join('、')}${tails[tail]}`;
}

export function othersKinds(episodes) {
  const map = new Map(STRENGTHS.map((item) => [item.id, new Set()]));
  for (const ep of episodes || []) { const strength = TASK_BY_ID.get(ep.task)?.strength; if (strength && ep.kind) map.get(strength).add(ep.kind); }
  return map;
}

export function othersCounts(episodes) {
  const counts = new Map(STRENGTHS.map((item) => [item.id, 0]));
  for (const ep of episodes || []) { const strength = TASK_BY_ID.get(ep.task)?.strength; if (strength) counts.set(strength, counts.get(strength) + 1); }
  return counts;
}

export function othersInsights(selfInput, episodesInput) {
  const self = Array.isArray(selfInput) ? selfInput.filter((id) => STRENGTH_BY_ID.has(id)) : [];
  const episodes = Array.isArray(episodesInput) ? episodesInput : [];
  const E = episodes.length;
  const counts = othersCounts(episodes); const kinds = othersKinds(episodes);
  const result = { ready: self.length >= 1 && E >= 2, E, onlyOthers: [], both: [], selfOnly: [], bandOthersLabel: COPY.bandOthersOnly, allMatch: false, lines: [], footer: `${E}つの出来事から見えたことです。決まりではありません。` };
  if (!result.ready) return result;
  const rows = STRENGTHS.map((item, index) => ({ id: item.id, label: item.label, o: counts.get(item.id), S: self.includes(item.id), index, kinds: kinds.get(item.id), phrase: othersPhrase(kinds.get(item.id), 'past') }));
  const byCount = (x, y) => y.o - x.o || x.index - y.index;
  result.onlyOthers = rows.filter((row) => row.o >= 1 && !row.S).sort(byCount);
  result.both = rows.filter((row) => row.o >= 1 && row.S).sort(byCount);
  result.selfOnly = rows.filter((row) => row.o === 0 && row.S); // データ順（トリセツ・画像と同じ並び）
  result.allMatch = result.onlyOthers.length === 0 && result.selfOnly.length === 0 && result.both.length > 0;
  const onlyKinds = new Set(result.onlyOthers.flatMap((row) => [...row.kinds]));
  if ([...onlyKinds].some((id) => id !== 'k_asked')) result.bandOthersLabel = `自分では選ばなかったけれど、人から${othersPhrase(onlyKinds, 'noun')}`;
  result.onlyOthers.forEach((row, index) => result.lines.push({ kind: 'others', id: row.id, text: index === 0 ? `『${row.label}』は、自分では選ばなかったけれど、人からは${row.o}回${row.phrase}。` : `『${row.label}』も、人から${row.o}回${row.phrase}。` }));
  result.both.forEach((row) => result.lines.push({ kind: 'both', id: row.id, text: `『${row.label}』は、自分でも得意だと思っていて、人からも${row.o}回${row.phrase}。` }));
  if (result.selfOnly.length) result.lines.push({ kind: 'self', id: 'self', text: `${result.selfOnly.map((row) => `『${row.label}』`).join('')}は、今回の出来事には出てきませんでした。見せる場面があると、頼りにされるかもしれません。` });
  if (result.allMatch) result.lines.push({ kind: 'match', id: 'match', text: '選んだ得意が、そのまま人にも伝わっているようです。' });
  return result;
}

export function othersLineup(selfInput, episodes) {
  const self = Array.isArray(selfInput) ? selfInput : [];
  const counts = othersCounts(episodes);
  return STRENGTHS.filter((item) => self.includes(item.id) || counts.get(item.id) > 0).map((item) => ({ id: item.id, label: item.label, self: self.includes(item.id), count: counts.get(item.id) }));
}

// ---------- 章の準備ができているか／足りない側 ----------
export function chapterReady(chapterId, data) {
  const d = data?.[chapterId];
  if (!d) return false;
  if (chapterId === 'energy') return d.good.length >= DAY_MIN && d.bad.length >= DAY_MIN;
  if (chapterId === 'values') return d.neg.length >= 1 && d.pos.length >= 1 && d.neg.length + d.pos.length >= 3;
  return d.self.length >= 1 && d.episodes.length >= 2;
}

export function insightsFor(chapterId, data) {
  const d = data[chapterId];
  if (chapterId === 'energy') return energyInsights(d.good, d.bad);
  if (chapterId === 'values') return valuesInsights(d.neg, d.pos);
  return othersInsights(d.self, d.episodes);
}

export function gapFor(chapterId, data, insights = insightsFor(chapterId, data)) {
  const d = data[chapterId];
  if (chapterId === 'energy') return energyGap(d.prediction, insights, d.good, d.bad);
  if (chapterId === 'values') return valuesGap(d.prediction, insights, d.neg, d.pos);
  return { rows: [], actual: '', hasMiss: false };
}

// ---------- 目次の短い一行 ----------
export function teaser(chapterId, data) {
  if (!chapterReady(chapterId, data)) return '';
  const insights = insightsFor(chapterId, data);
  const prefix = COPY.teaserPrefix;
  if (chapterId === 'energy') {
    if (insights.ordered.good[0]) return `${prefix}調子がよかった日に『${insights.ordered.good[0].tag}』`;
    if (insights.ordered.bad[0]) return `${prefix}調子が悪かった日に『${insights.ordered.bad[0].tag}』`;
    return `${prefix}${CHAPTERS[0].teaserNone}`;
  }
  if (chapterId === 'values') {
    if (insights.ordered[0]) return `${prefix}『${insights.ordered[0].label}』を大事にしているのかも`;
    return `${prefix}大事なことの候補が${insights.candidates.length}つ見つかりました`;
  }
  const top = insights.onlyOthers[0] || insights.both[0];
  return top ? `${prefix}人からは『${top.label}』で${othersPhrase(top.kinds, 'present')}` : '';
}

// ---------- 「意外だったこと」「来週ためすこと」の候補 ----------
export function surpriseOptions(chapterId, data) {
  if (!chapterReady(chapterId, data)) return [];
  const insights = insightsFor(chapterId, data);
  const options = [];
  if (chapterId === 'energy') {
    for (const item of [...insights.good.map((x) => ({ ...x, k: 'g' })), ...insights.bad.map((x) => ({ ...x, k: 'b' }))].slice(0, 5)) {
      options.push({ key: `${item.k}:${item.id}`, label: `${item.k === 'g' ? 'よかった日' : '悪かった日'}の『${item.tag}』` });
    }
    if (data.energy.prediction.length && gapFor('energy', data, insights).hasMiss) options.push({ key: 'gap', label: COPY.surpriseGap });
  } else if (chapterId === 'values') {
    for (const item of insights.ordered) options.push({ key: `v:${item.id}`, label: `『${item.label}』が関わっていたこと` });
    if (insights.empty) options.push({ key: 'spread', label: COPY.surpriseSpread });
    if (data.values.prediction.length && gapFor('values', data, insights).hasMiss) options.push({ key: 'gap', label: COPY.surpriseGap });
  } else {
    for (const row of insights.onlyOthers.slice(0, 5)) options.push({ key: `o:${row.id}`, label: `人からの『${row.label}』` });
    if (insights.selfOnly.length) options.push({ key: 'self', label: COPY.surpriseSelf });
  }
  options.push({ key: 'none', label: COPY.surpriseNone });
  return options;
}

export function tryOptions(chapterId, data) {
  if (!chapterReady(chapterId, data)) return [];
  const insights = insightsFor(chapterId, data);
  const list = [];
  if (chapterId === 'energy') {
    const more = insights.good.filter((item) => item.feature.tryMore).map((item) => ({ key: `try:${item.id}:more`, text: item.feature.tryMore }));
    const less = insights.bad.filter((item) => item.feature.tryLess).map((item) => ({ key: `try:${item.id}:less`, text: item.feature.tryLess }));
    for (let i = 0; i < Math.max(more.length, less.length); i += 1) { if (more[i]) list.push(more[i]); if (less[i]) list.push(less[i]); }
  } else if (chapterId === 'values') {
    const source = insights.ordered.length ? insights.ordered : insights.candidates.slice(0, 2);
    for (const item of source) list.push({ key: `try:${item.id}`, text: VALUE_BY_ID.get(item.id).tryMore });
  } else {
    for (const row of insights.onlyOthers) list.push({ key: `try:${row.id}:more`, text: STRENGTH_BY_ID.get(row.id).tryMore });
    for (const row of insights.selfOnly) list.push({ key: `try:${row.id}:show`, text: STRENGTH_BY_ID.get(row.id).tryShow });
  }
  const seen = new Set(); const options = [];
  for (const item of list) { if (seen.has(item.text)) continue; seen.add(item.text); options.push(item); if (options.length >= 4) break; }
  const chapter = CHAPTERS.find((item) => item.id === chapterId);
  options.push({ key: chapter.again.key, text: chapter.again.text });
  return options;
}

// 保存された key が今の候補にあるか（無ければ「無かったこと」にする）
export function pruneChoices(data) {
  let changed = false;
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
  if (d.surprise === 'none') return '思ったとおりだった';
  return surpriseOptions(chapterId, data).find((item) => item.key === d.surprise)?.label || '';
}

export function textOfTry(chapterId, data) {
  const d = data[chapterId];
  if (d.experimentText) return `「${d.experimentText}」`;
  if (!d.experiment) return '';
  return tryOptions(chapterId, data).find((item) => item.key === d.experiment)?.text || '';
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { ochiCards, ochiCategories } from '../dist/data/ochi-cards.js';

// Spec 5.8 (docs/games/ochi-kara.md). The count gates are the production values.
const OCHI_MIN_TOTAL = 60;
const OCHI_MIN_PER_CATEGORY = 6;
const OCHI_MIN_LENGTH = 12;
const OCHI_MAX_LENGTH = 32;

// Banned by whole word (Intl.Segmenter), never by substring, so 必死 / 夫婦茶碗 / 酢豚 do not trip it.
// The segmenter splits some words into pieces (元カレ -> 元|カ|レ, 酔って -> 酔|って), so a banned word also matches
// a run of consecutive segments that starts and ends on segment boundaries.
const OCHI_BANNED_WORDS = new Set(['彼氏', '彼女', '夫', '妻', '旦那', '嫁', '元カレ', '元カノ', '僕', '俺', '酒', 'ビール', '酔', '酔う', '酔っ', '酔っぱらい', 'たばこ', 'タバコ', '死ぬ', '死んだ', '殺す', '病院', '救急', '事故', '借金', '警察']);
// Harmless words whose fragments the segmenter may split into a banned word. Every entry needs the reason.
const OCHI_ALLOWED_WORDS = [
  '必死', // 必+死 would otherwise expose 死
  '死角', // same
  '夫婦', // a couple as a word is not addressed by the 夫 / 妻 ban
  '工夫', // 工+夫
  '嫁入り道具', // not used by the shipped cards; kept to prove allowed words win over the 嫁 ban
  '酒饅頭' // food name; 酒 inside it is not drinking
];

const segmenter = new Intl.Segmenter('ja', { granularity: 'word' });
export function findBannedWords(text) {
  const allowedRanges = [];
  for (const word of OCHI_ALLOWED_WORDS) for (let at = text.indexOf(word); at !== -1; at = text.indexOf(word, at + 1)) allowedRanges.push([at, at + word.length]);
  const segments = [...segmenter.segment(text)];
  const hits = [];
  for (let from = 0; from < segments.length; from += 1) {
    let joined = '';
    for (let to = from; to < segments.length && joined.length < 8; to += 1) {
      joined += segments[to].segment;
      const start = segments[from].index; const end = start + joined.length;
      if (OCHI_BANNED_WORDS.has(joined) && !allowedRanges.some(([lo, hi]) => start >= lo && end <= hi)) hits.push(joined);
    }
  }
  return hits;
}

test('ids are unique ochi-NNN values and texts are unique', () => {
  const ids = ochiCards.map((card) => card.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.match(id, /^ochi-\d{3}$/);
  const texts = ochiCards.map((card) => card.text);
  assert.equal(new Set(texts).size, texts.length);
});

test('texts are 12-32 characters, single line, and carry no leading ellipsis or trailing period', () => {
  for (const { id, text } of ochiCards) {
    const length = Array.from(text).length;
    assert.ok(length >= OCHI_MIN_LENGTH && length <= OCHI_MAX_LENGTH, `${id} has ${length} characters`);
    assert.doesNotMatch(text, /[\u0000-\u001f\u007f]/u, `${id} has a control character`);
    assert.doesNotMatch(text, /^(…|\.\.\.)/u, `${id} starts with an ellipsis`);
    assert.doesNotMatch(text, /。$/u, `${id} ends with a period`);
    assert.equal(text, text.trim(), id);
  }
});

test('every card uses a defined category and each category meets the minimum', () => {
  const known = new Set(ochiCategories.map((category) => category.id));
  assert.equal(known.size, ochiCategories.length);
  const counts = new Map();
  for (const { id, category } of ochiCards) { assert.ok(known.has(category), `${id}: unknown category ${category}`); counts.set(category, (counts.get(category) || 0) + 1); }
  for (const category of known) assert.ok((counts.get(category) || 0) >= OCHI_MIN_PER_CATEGORY, `${category} has ${counts.get(category) || 0} cards`);
  assert.ok(ochiCards.length >= OCHI_MIN_TOTAL, `${ochiCards.length} cards`);
});

test('no card contains a banned word', () => {
  for (const { id, text } of ochiCards) assert.deepEqual(findBannedWords(text), [], `${id}: ${text}`);
});

test('the banned-word check catches whole words and spares harmless look-alikes', () => {
  for (const text of ['それ以来、彼氏とは連絡をとっていない', '結局、元カレの話ばかりしていた', '次の日、病院の前を通りかかった', 'だから私は、ビールを飲まない']) assert.ok(findBannedWords(text).length > 0, text);
  for (const text of ['気づいたら必死に走っていた', '結局、夫婦茶碗を二つ買っていた', 'おかげで、工夫がうまくなった', '次の日、酢豚を食べすぎていた']) assert.deepEqual(findBannedWords(text), [], text);
  assert.deepEqual(findBannedWords('酒饅頭を食べた'), [], 'allowed words win over a banned fragment');
});

test('first-person pronouns that imply a gender are not used', () => {
  for (const { id, text } of ochiCards) assert.doesNotMatch(text, /[僕俺]|あたし/u, id);
});

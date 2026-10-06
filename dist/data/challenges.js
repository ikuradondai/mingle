// 「やってみて」カードの集約ファイル。
// 共通お題は challenges/common.js、テーマ別お題は challenges/<担当>.js に置き、ここで正規化して公開する。
// 公開 API:
//   commonChallenges / themeChallenges / challenges（フラット配列。既存の import 先のために残す）
//   DECK_TOUCH_POLICY / touchLimitFor / challengePoolFor / remoteChallengesFor
import { commonChallengeCards } from './challenges/common.js';
import { romanceChallenges } from './challenges/romance.js';
import { adultChallenges } from './challenges/adult.js';
import { friendsChallenges } from './challenges/friends.js';
import { familyChallenges } from './challenges/family.js';
import { workMeetupChallenges } from './challenges/work-meetup.js';
import { roleplayChallenges } from './challenges/roleplay.js';

// デッキごとの接触レベルの上限（0 = 接触なし、1 = ハイタッチ・握手程度、2 = 恋人の軽い接触、3 = 成人向けのみ）。
// 表に無いデッキは 0 として扱う。ミックスでは選んだデッキの最小値を使う。
export const DECK_TOUCH_POLICY = Object.freeze({
  // A 恋人・夫婦
  couples: 2, 'new-couple': 2, 'moving-in': 2, 'engaged-couple': 2,
  // B 出会い・お見合い
  date: 0, 'acquaintance-date': 0, omiai: 0,
  // C 成人向け
  intimacy: 3, 'first-intimacy': 3, 'intimacy-refresh': 3, 'intimacy-distance': 3,
  // D 友人
  friends: 1, reunion: 1, 'same-oshi-fans': 1, roommates: 1, 'late-night-diner': 1, 'travel-companions': 1,
  // E 家族（大人）
  siblings: 1, 'parent-50plus': 1, 'family-reunion': 1, 'in-laws': 1,
  // F 子どもが入る
  'parent-under12': 1, 'grandparents-and-grandchildren': 1, classmates: 1,
  // G 仕事・スポーツ
  founders: 1, team: 1, 'new-colleagues': 1, 'sports-teammates': 1, 'business-meetup': 1,
  // H 初対面（夜・お酒・恋愛の場）
  'party-first-meeting': 0, 'bar-first-meeting': 0, 'group-mixer': 0, neighbors: 0,
  // I なりきり
  'promotion-rivals': 1, 'love-rivals': 1, 'arch-enemies': 1, 'hero-and-demon-king': 1, 'assassin-and-target': 1, 'detective-and-phantom-thief': 1,
  'ex-lovers': 0,
});

// R18 のお題を出してよいデッキ（C 成人向け 4 テーマ）。
export const ADULT_CHALLENGE_DECK_IDS = Object.freeze(['intimacy', 'first-intimacy', 'intimacy-refresh', 'intimacy-distance']);

const PLAYERS = ['any', 'pair', 'group'];
const PERFORMS = ['each', 'together'];
const PLACES = ['inPerson', 'remote', 'either'];

function normalizeChallenge(card, deckId = null) {
  const touch = Number.isInteger(card.touch) ? card.touch : card.touch === true ? 1 : 0;
  const normalized = {
    id: card.id,
    text: card.text,
    kind: 'challenge',
    r18: card.r18 === true,
    touch,
    players: PLAYERS.includes(card.players) ? card.players : 'any',
    perform: PERFORMS.includes(card.perform) ? card.perform : 'each',
    place: PLACES.includes(card.place) ? card.place : 'inPerson',
  };
  if (Number.isInteger(card.seconds)) normalized.seconds = card.seconds;
  if (deckId) normalized.deckIds = [deckId];
  if (card.retired === true) normalized.retired = true;
  return normalized;
}

export const commonChallenges = commonChallengeCards.map((card) => normalizeChallenge(card));

const themeSources = [romanceChallenges, adultChallenges, friendsChallenges, familyChallenges, workMeetupChallenges, roleplayChallenges];
export const themeChallenges = {};
for (const source of themeSources) {
  for (const [deckId, cards] of Object.entries(source || {})) {
    themeChallenges[deckId] = (Array.isArray(cards) ? cards : []).map((card) => normalizeChallenge(card, deckId));
  }
}

// 既存の利用箇所（session-storage.js の cardIndex、テスト）のため、フラット配列も残す。
export const challenges = [...commonChallenges, ...Object.values(themeChallenges).flat()];

function idsOf(deckIds) {
  return (Array.isArray(deckIds) ? deckIds : [deckIds]).filter((id) => typeof id === 'string');
}

// 選んだデッキの接触上限の最小値。表に無いデッキは 0。
export function touchLimitFor(deckIds) {
  const ids = idsOf(deckIds);
  if (!ids.length) return 0;
  return Math.min(...ids.map((id) => (Object.hasOwn(DECK_TOUCH_POLICY, id) ? DECK_TOUCH_POLICY[id] : 0)));
}

function placeAllowed(card, place) {
  if (place === 'remote') return card.place === 'remote' || card.place === 'either';
  return card.place === 'inPerson' || card.place === 'either';
}

function playersAllowed(card, participantCount) {
  if (card.players === 'pair') return participantCount === 2;
  if (card.players === 'group') return participantCount >= 3;
  return true;
}

// 出してよいお題の候補（共通 + 選んだデッキのテーマ別）。
//   deckIds: 選んだデッキ（単一は 1 つ、ミックスは 2〜3 つ）
//   participantCount: 参加人数
//   includeR18: 成人確認済みのとき true（R18 のお題は成人向け 4 デッキだけで、確認済みのときだけ出る）
//   place: 'inPerson'（既定。対面）／'remote'（LINE などの離れた場所）
export function challengePoolFor({ deckIds, participantCount, includeR18 = false, place = 'inPerson' } = {}) {
  const ids = idsOf(deckIds);
  const limit = touchLimitFor(ids);
  const adultDeckOnly = ids.length > 0 && ids.every((id) => ADULT_CHALLENGE_DECK_IDS.includes(id));
  const allowR18 = includeR18 === true && adultDeckOnly && place !== 'remote';
  const remote = place === 'remote';
  const usable = (card) => card.retired !== true
    && placeAllowed(card, place)
    && card.touch <= (remote ? 0 : limit)
    && (card.touch < 2 || participantCount === 2)
    && playersAllowed(card, participantCount)
    && (card.r18 !== true || allowR18);
  const common = commonChallenges.filter(usable);
  const themed = ids.flatMap((id) => (themeChallenges[id] || []).filter(usable));
  return [...common, ...themed];
}

// LINE など離れた場所に送れるお題（接触なし・R18 なし・place が remote か either）。LINE 側からはまだ呼ばない。
export function remoteChallengesFor(deckId, { participantCount = 2 } = {}) {
  return challengePoolFor({ deckIds: [deckId], participantCount, includeR18: false, place: 'remote' }).filter((card) => card.touch === 0 && card.r18 === false);
}

export const ROUND_SIZE = 6;
export const MAX_PARTICIPANTS = 8;
export const MAX_NAME_LENGTH = 40;

function createSessionId() {
  try { if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID(); } catch {}
  try { const fill = globalThis.crypto?.getRandomValues; if (typeof fill !== 'function') throw new Error('crypto unavailable'); const bytes = new Uint8Array(16); fill.call(globalThis.crypto, bytes); bytes[6] = (bytes[6] & 0x0f) | 0x40; bytes[8] = (bytes[8] & 0x3f) | 0x80; return [...bytes].map((value, index) => `${value.toString(16).padStart(2, '0')}${[3,5,7,9].includes(index) ? '-' : ''}`).join(''); } catch {}
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => { const value = Math.random() * 16 | 0; const next = char === 'x' ? value : (value & 0x3 | 0x8); return next.toString(16); });
}
import { challengePoolFor } from './data/challenges.js';
import { decks } from './data/decks.js';
import { soloDecks } from './data/solo-decks.js';
import { normalizeCreatorDesign, effectiveCreatorAdult } from './creator-metadata.js';
import { participantCountAllowed } from './participant-rule.js';

export function normalizeParticipants(participants) {
  if (!Array.isArray(participants) || participants.length < 2 || participants.length > MAX_PARTICIPANTS) throw new Error('参加者は2〜8人で入力してください');
  if (participants.some((name) => typeof name !== 'string')) throw new Error('参加者の名前は文字で入力してください');
  const names = participants.map((name) => name.trim());
  if (names.some((name) => !name)) throw new Error('参加者の名前を入力してください');
  if (names.some((name) => Array.from(name).length > MAX_NAME_LENGTH || /[\u0000-\u001f\u007f]/u.test(name))) throw new Error(`名前は${MAX_NAME_LENGTH}文字以内で入力してください`);
  return names;
}

function assertParticipantRule(rule, count) {
  const normalized = ['pair', 'group', 'solo'].includes(rule) ? rule : 'group';
  if (!participantCountAllowed(normalized, count)) throw new Error(normalized === 'pair' ? '2人専用テーマには2人で参加してください' : '参加人数がテーマに適合しません');
  return normalized;
}

export function createSession({ participants, deck, participantRule = 'group', adultConfirmed = false, includeR18 = false, includeChallenges = false, random = Math.random }) {
  const names = normalizeParticipants(participants);
  const normalizedRule = assertParticipantRule(participantRule, names.length);
  if (!deck || !Array.isArray(deck.questions) || deck.questions.length !== 40) throw new Error('デッキが不正です');
  if (deck.adultOnly && adultConfirmed !== true) throw new Error('成人向け確認が必要です');
  if (includeR18 && adultConfirmed !== true) throw new Error('R18の話題には成人確認が必要です');
  if (includeR18 && (!Array.isArray(deck.r18Questions) || deck.r18Questions.length < 6)) throw new Error('R18質問が不正です');
  const baseQuestions = includeR18 ? composeR18Questions(deck, random) : shuffle(deck.questions, random);
  const questions = includeChallenges ? composeChallenges(baseQuestions, random, includeR18 && !deck.adultOnly, deck.id, names.length, { adultConfirmed: adultConfirmed === true }) : baseQuestions;
  return { sessionId: createSessionId(), participants: names, participantRule: normalizedRule, deckId: deck.id, deckIds: [deck.id], mixed: false, questions, cursor: 0, unlockedUntil: ROUND_SIZE, roundStart: 0, roundCount: 0, roundNumber: 1, adultConfirmed, includeR18, includeChallenges, revealed: false, answerIndex: 0, likes: {}, revealedQuestionIds: [] };
}

// One-person fixed-order session for ひとりで. Group participant rules
// remain unchanged in createSession/createMixedSession.
export function createSoloSession({ deck, participant = '自分' } = {}) {
  if (!deck || deck.audience !== 'solo' || !Array.isArray(deck.questions) || deck.questions.length !== 12 || deck.questions.some((card) => card.r18 === true)) throw new Error('ソロテーマが不正です');
  const name = typeof participant === 'string' && participant.trim() ? participant.trim() : '自分';
  const questions = deck.questions.map((card) => ({ ...card, sourceDeckId: deck.id, r18: false }));
  return { sessionId: createSessionId(), mode: 'solo', participants: [name], deckId: deck.id, deckIds: [deck.id], questionOrder: 'fixed', mixed: false, customSet: false, ownerUserId: null, customQuestions: [], questions, cursor: 0, unlockedUntil: ROUND_SIZE, roundStart: 0, roundCount: 0, roundNumber: 1, adultConfirmed: false, includeR18: false, includeChallenges: false, revealed: false, answerIndex: 0, likes: {}, revealedQuestionIds: [] };
}

// Build a session from a saved account set. Static IDs use the shipped catalog; custom IDs use validated owner snapshots.
function normalizeCustomCards(customCards) {
  const values = Array.isArray(customCards) ? customCards : [];
  return new Map(values.map((card) => {
    const id = typeof card?.id === 'string' ? (card.id.startsWith('custom:') ? card.id : `custom:${card.id}`) : '';
    if (!/^custom:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) || typeof card?.text !== 'string' || typeof card?.r18 !== 'boolean' || !card.text.trim() || Array.from(card.text.trim()).length > 300 || /[\u0000-\u001f\u007f\u2028\u2029]/u.test(card.text)) throw new Error('マイセットの質問が不正です');
    return [id, { id, text: card.text.trim(), r18: card.r18, sourceDeckId: 'custom', custom: true }];
  }));
}

export function createSavedSession({ mode = 'group', participants, participant = '自分', cardIds, setId = null, setName = null, customCards = [], ownerUserId = null, adultConfirmed = false, questionOrder = 'shuffle', r18 = false, design = null, participantRule = mode === 'solo' ? 'solo' : 'group', random = Math.random }) {
  if (!['group', 'solo'].includes(mode)) throw new Error('マイセットのモードが不正です');
  if (mode === 'solo' && (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(ownerUserId || '') || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(setId || ''))) throw new Error('ソロマイセットの所有者が不正です');
  const names = mode === 'solo' ? [typeof participant === 'string' && participant.trim() ? participant.trim() : '自分'] : normalizeParticipants(participants);
  const normalizedRule = assertParticipantRule(mode === 'solo' ? 'solo' : participantRule, names.length);
  if (!Array.isArray(cardIds) || cardIds.length < ROUND_SIZE || cardIds.length > 40 || new Set(cardIds).size !== cardIds.length || cardIds.some((id) => typeof id !== 'string')) throw new Error('マイセットの質問が不正です');
  const catalog = new Map();
  [...decks, ...soloDecks].forEach((deck) => {
    deck.questions.forEach((card) => catalog.set(card.id, { ...card, sourceDeckId: deck.id, r18: card.r18 === true }));
    (deck.r18Questions || []).forEach((card) => catalog.set(card.id, { ...card, sourceDeckId: deck.id, r18: true }));
  });
  const customCatalog = normalizeCustomCards(customCards);
  if (!['shuffle', 'fixed'].includes(questionOrder)) throw new Error('マイセットの並び順が不正です');
  const sourceQuestions = cardIds.map((id) => catalog.get(id) || customCatalog.get(id) || (() => { throw new Error('マイセットの質問が不正です'); })());
  const questions = questionOrder === 'fixed' ? sourceQuestions : shuffle(sourceQuestions, random);
  const includeR18 = effectiveCreatorAdult(r18 === true, questions);
  if (includeR18 && adultConfirmed !== true) throw new Error('成人向け確認が必要です');
  const hasCustom = questions.some((card) => card.sourceDeckId === 'custom');
  if (hasCustom && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(ownerUserId || '')) throw new Error('マイセットの所有者が不正です');
  const owner = typeof ownerUserId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(ownerUserId) ? ownerUserId : null;
  return { sessionId: createSessionId(), mode, participants: names, participantRule: normalizedRule, deckId: 'my-set', deckIds: ['my-set'], setId: typeof setId === 'string' ? setId : null, setName: typeof setName === 'string' ? setName : null, questionOrder, r18: r18 === true, design: normalizeCreatorDesign(design), customSet: true, ownerUserId: owner, customQuestions: hasCustom ? questions.filter((card) => card.sourceDeckId === 'custom').map((card) => ({ id: card.id, text: card.text, r18: card.r18 === true })) : [], mixed: false, questions, cursor: 0, unlockedUntil: Math.min(ROUND_SIZE, questions.length), roundStart: 0, roundCount: 0, roundNumber: 1, adultConfirmed: adultConfirmed === true, includeR18, includeChallenges: false, revealed: false, answerIndex: 0, likes: {}, revealedQuestionIds: [] };
}

export function createSharedSession({ participants, cards, adultConfirmed = false, questionOrder = 'shuffle', r18 = false, design = null, participantRule = 'group', random = Math.random }) {
  const names = normalizeParticipants(participants);
  const normalizedRule = assertParticipantRule(participantRule, names.length);
  if (!Array.isArray(cards) || cards.length < ROUND_SIZE || cards.length > 40 || new Set(cards.map((card) => card?.id)).size !== cards.length) throw new Error('共有セットの質問が不正です');
  const questions = cards.map((card) => {
    if (!card || typeof card.id !== 'string' || typeof card.text !== 'string' || typeof card.r18 !== 'boolean' || card.kind === 'challenge' || !card.text.trim() || Array.from(card.text.trim()).length > 300 || /[\u0000-\u001f\u007f\u2028\u2029]/u.test(card.text)) throw new Error('共有セットの質問が不正です');
    const custom = card.id.startsWith('custom:');
    if (custom && !/^custom:[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(card.id)) throw new Error('共有セットの質問が不正です');
    return { id: card.id, text: card.text.trim(), r18: card.r18, sourceDeckId: custom ? 'custom' : 'shared', custom };
  });
  const includeR18 = effectiveCreatorAdult(r18 === true, questions);
  if (includeR18 && adultConfirmed !== true) throw new Error('成人向け確認が必要です');
  if (!['shuffle', 'fixed'].includes(questionOrder)) throw new Error('共有セットの並び順が不正です');
  return { sessionId: createSessionId(), participants: names, participantRule: normalizedRule, deckId: 'shared-set', deckIds: ['shared-set'], questionOrder, r18: r18 === true, design: normalizeCreatorDesign(design), mixed: false, customSet: false, sharedGuest: true, ownerUserId: null, customQuestions: [], questions: questionOrder === 'fixed' ? questions : shuffle(questions, random), cursor: 0, unlockedUntil: Math.min(ROUND_SIZE, questions.length), roundStart: 0, roundCount: 0, roundNumber: 1, adultConfirmed: adultConfirmed === true, includeR18, includeChallenges: false, revealed: false, answerIndex: 0, likes: {}, revealedQuestionIds: [] };
}

// 6 枚のお題を選ぶ。テーマ別を最大 4 枚（ミックスは各デッキに均等）、残りを共通お題で埋める。
// 候補の絞り込み（接触の上限・人数・場所・R18）は challengePoolFor が行う。
function pickChallenges(deckIds, participantCount, adultConfirmed, random) {
  const pool = challengePoolFor({ deckIds, participantCount, includeR18: adultConfirmed === true, place: 'inPerson' });
  const perDeck = Math.floor(4 / deckIds.length);
  const selected = [];
  for (const id of deckIds) selected.push(...shuffle(pool.filter((card) => card.deckIds?.includes(id)), random).slice(0, perDeck));
  const taken = new Set(selected.map((card) => card.id));
  const common = shuffle(pool.filter((card) => !card.deckIds && !taken.has(card.id)), random);
  selected.push(...common.slice(0, 6 - selected.length));
  if (selected.length < 6) {
    const used = new Set(selected.map((card) => card.id));
    selected.push(...shuffle(pool.filter((card) => !used.has(card.id)), random).slice(0, 6 - selected.length));
  }
  return shuffle(selected, random);
}

function composeChallenges(cards, random, preserveR18 = false, deckId, participantCount, { adultConfirmed = false } = {}) {
  const deckIds = Array.isArray(deckId) ? deckId : [deckId];
  const selected = pickChallenges(deckIds, participantCount, adultConfirmed, random);
  const composed = [...cards];
  for (let round = 0; round < 6; round += 1) {
    const start = round * ROUND_SIZE;
    const eligible = composed.slice(start, start + ROUND_SIZE).map((card, index) => ({ card, index })).filter(({ card }) => !preserveR18 || card.r18 !== true);
    const slot = eligible[Math.floor(random() * eligible.length)].index;
    composed[start + slot] = { ...selected[round], sourceDeckId: composed[start + slot].sourceDeckId };
  }
  return composed;
}

export function createMixedSession({ participants, decks, participantRule = 'group', includeChallenges = false, includeR18 = false, random = Math.random }) {
  const names = normalizeParticipants(participants);
  const normalizedRule = assertParticipantRule(participantRule, names.length);
  if (includeR18) throw new Error('ミックスではR18を選べません');
  if (!Array.isArray(decks) || (decks.length !== 2 && decks.length !== 3)) throw new Error('ミックスは2〜3テーマで選んでください');
  const ids = decks.map((deck) => deck?.id);
  if (new Set(ids).size !== ids.length || decks.some((deck) => !deck || deck.adultOnly || !Array.isArray(deck.questions) || deck.questions.length !== 40 || deck.questions.some((question) => question.r18 === true))) throw new Error('ミックスできないテーマです');
  const pools = decks.map((deck) => shuffle(deck.questions, random).map((question) => ({ ...question, sourceDeckId: deck.id })));
  const usedIds = new Set();
  const usedTextKeys = new Set();
  const textKey = (card) => String(card?.text || '').normalize('NFKC').replace(/\s+/gu, ' ').trim();
  const selectUnique = (quotas) => {
    const selected = [];
    const localIds = new Set(usedIds);
    const localTextKeys = new Set(usedTextKeys);
    for (let poolIndex = 0; poolIndex < pools.length; poolIndex += 1) {
      let picked = 0;
      for (let cardIndex = 0; cardIndex < pools[poolIndex].length && picked < quotas[poolIndex]; cardIndex += 1) {
        const card = pools[poolIndex][cardIndex];
        const key = textKey(card);
        if (localIds.has(card.id) || localTextKeys.has(key)) continue;
        localIds.add(card.id);
        localTextKeys.add(key);
        selected.push({ poolIndex, cardIndex, card });
        picked += 1;
      }
      if (picked < quotas[poolIndex]) throw new Error('ミックス質問が不正です');
    }
    for (const item of [...selected].sort((a, b) => a.poolIndex - b.poolIndex || b.cardIndex - a.cardIndex)) pools[item.poolIndex].splice(item.cardIndex, 1);
    for (const item of selected) {
      usedIds.add(item.card.id);
      usedTextKeys.add(textKey(item.card));
    }
    return selected.map((item) => item.card);
  };
  const questions = [];
  for (let round = 0; round < 6; round += 1) {
    const count = decks.length === 2 ? 3 : 2;
    const roundCards = selectUnique(pools.map(() => count));
    questions.push(...shuffle(roundCards, random));
  }
  const tail = [];
  const tailTaken = pools.map(() => 0);
  while (questions.length + tail.length < 40) {
    const available = pools.map((pool, index) => ({ pool, index })).filter(({ pool }) => pool.some((card) => !usedIds.has(card.id) && !usedTextKeys.has(textKey(card))));
    if (!available.length) break;
    const minimum = Math.min(...available.map(({ index }) => tailTaken[index]));
    const candidates = available.filter(({ index }) => tailTaken[index] === minimum);
    if (!candidates.length) throw new Error('ミックス質問が不正です');
    const selected = candidates[Math.floor(random() * candidates.length)];
    const cardIndex = selected.pool.findIndex((card) => !usedIds.has(card.id) && !usedTextKeys.has(textKey(card)));
    const [card] = selected.pool.splice(cardIndex, 1);
    tail.push(card);
    usedIds.add(card.id);
    usedTextKeys.add(textKey(card));
    tailTaken[selected.index] += 1;
  }
  questions.push(...shuffle(tail, random));
  if (questions.length !== 40 || new Set(questions.map((question) => question.id)).size !== 40) throw new Error('ミックス質問が不正です');
  const finalQuestions = includeChallenges ? composeChallenges(questions, random, false, ids, names.length, { adultConfirmed: false }) : questions;
  return { sessionId: createSessionId(), participants: names, participantRule: normalizedRule, deckId: 'mix', deckIds: ids, mixed: true, questions: finalQuestions, cursor: 0, unlockedUntil: ROUND_SIZE, roundStart: 0, roundCount: 0, roundNumber: 1, adultConfirmed: false, includeR18: false, includeChallenges, revealed: false, answerIndex: 0, likes: {}, revealedQuestionIds: [] };
}

function composeR18Questions(deck, random) {
  const regular = shuffle(deck.questions, random);
  const r18 = shuffle(deck.r18Questions, random).slice(0, 6);
  const composed = [];
  for (let round = 0; round < 6; round += 1) {
    const cards = regular.slice(round * 5, round * 5 + 5);
    const insertAt = 3 + Math.floor(random() * 3);
    cards.splice(insertAt, 0, r18[round]);
    composed.push(...cards);
  }
  composed.push(...regular.slice(30, 34));
  return composed;
}

export function currentCard(session) {
  return session.questions[session.cursor] ?? null;
}

export function currentSpeaker(session) {
  return session.participants[currentParticipantIndex(session)];
}

export function currentParticipantIndex(session) {
  if (!session.participants.length) return 0;
  return (session.cursor + (session.answerIndex ?? 0)) % session.participants.length;
}

// 「全員で1回」のお題のいいねは <cardId>:0 に固定する（個人の得点にはしない）。
function likeParticipantIndex(session, card) {
  return isTogetherCard(card) ? 0 : currentParticipantIndex(session);
}

export function currentAnswerLikes(session) {
  const card = currentCard(session);
  if (!card || !session.revealed) return 0;
  return session.likes?.[`${card.id}:${likeParticipantIndex(session, card)}`] ?? 0;
}

// Aggregate stored answer likes by participant for a question range. Question
// ids and participant indexes are resolved from the session, so stray storage
// keys cannot leak into the result.
export function sessionLikeTotals(session, start = 0, end = session?.cursor ?? 0) {
  const participants = Array.isArray(session?.participants) ? session.participants : [];
  const questions = Array.isArray(session?.questions) ? session.questions : [];
  const likes = session?.likes && typeof session.likes === 'object' ? session.likes : {};
  const from = Math.max(0, Math.min(questions.length, Number.isFinite(start) ? Math.floor(start) : 0));
  const to = Math.max(from, Math.min(questions.length, Number.isFinite(end) ? Math.floor(end) : from));
  const totals = participants.map(() => 0);
  for (const question of questions.slice(from, to)) {
    if (!question || typeof question.id !== 'string' || isTogetherCard(question)) continue;
    participants.forEach((_, participantIndex) => {
      const value = likes[`${question.id}:${participantIndex}`];
      if (Number.isSafeInteger(value) && value >= 0) totals[participantIndex] += value;
    });
  }
  return totals;
}

export function summarizeLikes(session, start = 0, end = session?.cursor ?? 0) {
  const participants = Array.isArray(session?.participants) ? session.participants : [];
  return sessionLikeTotals(session, start, end).map((likes, index) => ({ index, name: participants[index] ?? '', likes }));
}

export function revealCard(session) {
  if (session.revealed || isFinished(session) || isRoundComplete(session) || !currentCard(session)) return session;
  const card = currentCard(session);
  const eligible = card && card.kind !== 'challenge' && (session.mode === 'solo' || (card.sourceDeckId !== 'custom' && card.custom !== true));
  const revealedQuestionIds = eligible && !session.revealedQuestionIds?.includes(card.id) ? [...(session.revealedQuestionIds || []), card.id] : [...(session.revealedQuestionIds || [])];
  return { ...session, revealed: true, revealedQuestionIds };
}

export function likeCurrentAnswer(session) {
  if (!session.revealed || isFinished(session) || !currentCard(session)) return session;
  const card = currentCard(session);
  const key = `${card.id}:${likeParticipantIndex(session, card)}`;
  return { ...session, likes: { ...session.likes, [key]: (session.likes?.[key] ?? 0) + 1 } };
}

export function isTogetherCard(card) {
  return card?.kind === 'challenge' && card.perform === 'together';
}

function moveToNextAnswer(session) {
  if (!session.revealed || isFinished(session) || !currentCard(session)) return session;
  if (!isTogetherCard(currentCard(session)) && session.answerIndex < session.participants.length - 1) {
    return { ...session, answerIndex: session.answerIndex + 1 };
  }
  const cursor = session.cursor + 1;
  return { ...session, cursor, revealed: false, answerIndex: 0, roundCount: cursor % ROUND_SIZE, roundNumber: Math.floor(cursor / ROUND_SIZE) + 1 };
}

export function nextAnswer(session) {
  return moveToNextAnswer(session);
}

export function passAnswer(session) {
  return moveToNextAnswer(session);
}

export function previousAnswer(session) {
  if (!session.revealed || session.answerIndex <= 0 || isFinished(session) || isTogetherCard(currentCard(session))) return session;
  return { ...session, answerIndex: session.answerIndex - 1 };
}

export function advance(session) {
  if (session.cursor >= session.questions.length || session.cursor >= session.unlockedUntil) return session;
  const cursor = session.cursor + 1;
  const next = { ...session, cursor, revealed: false, answerIndex: 0, roundCount: cursor % ROUND_SIZE, roundNumber: Math.floor(cursor / ROUND_SIZE) + 1 };
  return next;
}

export function back(session) {
  if (session.cursor <= 0) return session;
  const cursor = session.cursor - 1;
  const roundNumber = Math.floor(cursor / ROUND_SIZE) + 1;
  return { ...session, cursor, revealed: false, answerIndex: 0, roundNumber, roundCount: cursor % ROUND_SIZE };
}

export function continueRound(session) {
  if (!isRoundComplete(session) || isFinished(session)) return session;
  const unlockedUntil = Math.min(session.unlockedUntil + ROUND_SIZE, session.questions.length);
  return { ...session, unlockedUntil, roundStart: session.cursor, roundCount: session.cursor % ROUND_SIZE, roundNumber: Math.floor(session.cursor / ROUND_SIZE) + 1 };
}

export function completedRoundFavoriteCards(session) {
  if (!session || (!isRoundComplete(session) && !isFinished(session))) return [];
  const history = new Set(Array.isArray(session.revealedQuestionIds) ? session.revealedQuestionIds : []);
  return session.questions.slice(session.roundStart, session.cursor).filter((card) => card && history.has(card.id) && card.sourceDeckId !== 'custom' && card.kind !== 'challenge' && card.custom !== true && (!card.r18 || session.adultConfirmed === true));
}

export function isRoundComplete(session) {
  return session.cursor > 0 && session.cursor >= session.unlockedUntil && !isFinished(session);
}

export function isFinished(session) {
  return session.cursor >= session.questions.length;
}

export function remaining(session) {
  return session.questions.length - session.cursor;
}

export function shuffle(items, random = Math.random) {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

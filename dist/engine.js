export const ROUND_SIZE = 6;
export const MAX_PARTICIPANTS = 8;
export const MAX_NAME_LENGTH = 24;

function createSessionId() {
  try { if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID(); } catch {}
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
import { challenges } from './data/challenges.js';

export function normalizeParticipants(participants) {
  if (!Array.isArray(participants) || participants.length < 2 || participants.length > MAX_PARTICIPANTS) throw new Error('参加者は2〜8人で入力してください');
  if (participants.some((name) => typeof name !== 'string')) throw new Error('参加者の名前は文字で入力してください');
  const names = participants.map((name) => name.trim());
  if (names.some((name) => !name)) throw new Error('参加者の名前を入力してください');
  if (names.some((name) => name.length > MAX_NAME_LENGTH)) throw new Error(`名前は${MAX_NAME_LENGTH}文字以内で入力してください`);
  return names;
}

export function createSession({ participants, deck, adultConfirmed = false, includeR18 = false, includeChallenges = false, random = Math.random }) {
  const names = normalizeParticipants(participants);
  if (!deck || !Array.isArray(deck.questions) || deck.questions.length !== 40) throw new Error('デッキが不正です');
  if (deck.adultOnly && adultConfirmed !== true) throw new Error('成人向け確認が必要です');
  if (includeR18 && adultConfirmed !== true) throw new Error('R18の話題には成人確認が必要です');
  if (includeR18 && (!Array.isArray(deck.r18Questions) || deck.r18Questions.length < 6)) throw new Error('R18質問が不正です');
  const baseQuestions = includeR18 ? composeR18Questions(deck, random) : shuffle(deck.questions, random);
  const questions = includeChallenges ? composeChallenges(baseQuestions, random, includeR18 && !deck.adultOnly, deck.id, names.length) : baseQuestions;
  return { sessionId: createSessionId(), participants: names, deckId: deck.id, deckIds: [deck.id], mixed: false, questions, cursor: 0, unlockedUntil: ROUND_SIZE, roundStart: 0, roundCount: 0, roundNumber: 1, adultConfirmed, includeR18, includeChallenges, revealed: false, answerIndex: 0, likes: {} };
}

function composeChallenges(cards, random, preserveR18 = false, deckId, participantCount) {
  const eligibleDeckIds = Array.isArray(deckId) ? deckId : [deckId];
  const pool = challenges.filter((card) => !card.touch || (participantCount === 2 && eligibleDeckIds.every((id) => card.eligibleDeckIds?.includes(id))));
  const selected = shuffle(pool, random).slice(0, 6);
  const composed = [...cards];
  for (let round = 0; round < 6; round += 1) {
    const start = round * ROUND_SIZE;
    const eligible = composed.slice(start, start + ROUND_SIZE).map((card, index) => ({ card, index })).filter(({ card }) => !preserveR18 || card.r18 !== true);
    const slot = eligible[Math.floor(random() * eligible.length)].index;
    composed[start + slot] = { ...selected[round], sourceDeckId: composed[start + slot].sourceDeckId };
  }
  return composed;
}

export function createMixedSession({ participants, decks, includeChallenges = false, includeR18 = false, random = Math.random }) {
  const names = normalizeParticipants(participants);
  if (includeR18) throw new Error('ミックスではR18を選べません');
  if (!Array.isArray(decks) || (decks.length !== 2 && decks.length !== 3)) throw new Error('ミックスは2〜3テーマで選んでください');
  const ids = decks.map((deck) => deck?.id);
  if (new Set(ids).size !== ids.length || decks.some((deck) => !deck || deck.adultOnly || !Array.isArray(deck.questions) || deck.questions.length !== 40 || deck.questions.some((question) => question.r18 === true))) throw new Error('ミックスできないテーマです');
  const pools = decks.map((deck) => shuffle(deck.questions, random).map((question) => ({ ...question, sourceDeckId: deck.id })));
  const questions = [];
  for (let round = 0; round < 6; round += 1) {
    const roundCards = [];
    const count = decks.length === 2 ? 3 : 2;
    pools.forEach((pool) => roundCards.push(...pool.splice(0, count)));
    questions.push(...shuffle(roundCards, random));
  }
  const tail = [];
  const tailTaken = pools.map(() => 0);
  while (questions.length + tail.length < 40) {
    const available = pools.map((pool, index) => ({ pool, index })).filter(({ pool }) => pool.length);
    if (!available.length) break;
    const minimum = Math.min(...available.map(({ index }) => tailTaken[index]));
    const candidates = available.filter(({ index }) => tailTaken[index] === minimum);
    const selected = candidates[Math.floor(random() * candidates.length)];
    tail.push(selected.pool.shift());
    tailTaken[selected.index] += 1;
  }
  questions.push(...shuffle(tail, random));
  if (questions.length !== 40 || new Set(questions.map((question) => question.id)).size !== 40) throw new Error('ミックス質問が不正です');
  const finalQuestions = includeChallenges ? composeChallenges(questions, random, false, ids, names.length) : questions;
  return { sessionId: createSessionId(), participants: names, deckId: 'mix', deckIds: ids, mixed: true, questions: finalQuestions, cursor: 0, unlockedUntil: ROUND_SIZE, roundStart: 0, roundCount: 0, roundNumber: 1, adultConfirmed: false, includeR18: false, includeChallenges, revealed: false, answerIndex: 0, likes: {} };
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

export function currentAnswerLikes(session) {
  const card = currentCard(session);
  if (!card || !session.revealed) return 0;
  return session.likes?.[`${card.id}:${currentParticipantIndex(session)}`] ?? 0;
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
    if (!question || typeof question.id !== 'string') continue;
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
  return { ...session, revealed: true };
}

export function likeCurrentAnswer(session) {
  if (!session.revealed || isFinished(session) || !currentCard(session)) return session;
  const card = currentCard(session);
  const key = `${card.id}:${currentParticipantIndex(session)}`;
  return { ...session, likes: { ...session.likes, [key]: (session.likes?.[key] ?? 0) + 1 } };
}

function moveToNextAnswer(session) {
  if (!session.revealed || isFinished(session) || !currentCard(session)) return session;
  if (session.answerIndex < session.participants.length - 1) {
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
  if (!session.revealed || session.answerIndex <= 0 || isFinished(session)) return session;
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

import { challenges } from './data/challenges.js';
import { decks } from './data/decks.js';

export const SESSION_STORAGE_KEY = 'mingle.cards.session.v1';
export const SESSION_STORAGE_VERSION = 1;
export const SESSION_STORAGE_TTL = 24 * 60 * 60 * 1000;

function getStorage(storage) {
  if (storage) return storage;
  try { return globalThis.localStorage; } catch { return null; }
}
function getNow(now) { return typeof now === 'function' ? now() : Number.isFinite(now) ? now : Date.now(); }
function discard(storage) { try { storage?.removeItem(SESSION_STORAGE_KEY); } catch {} }
function cardIndex() {
  const map = new Map();
  decks.forEach((deck) => deck.questions.forEach((card) => map.set(card.id, { ...card, sourceDeckId: deck.id })));
  decks.forEach((deck) => (deck.r18Questions || []).forEach((card) => { if (!map.has(card.id)) map.set(card.id, { ...card, sourceDeckId: deck.id, r18: true }); }));
  challenges.forEach((card) => map.set(card.id, { ...card, kind: 'challenge' }));
  return map;
}
function validNames(names) { return Array.isArray(names) && names.length >= 2 && names.length <= 8 && names.every((name) => typeof name === 'string' && name.trim() && name.length <= 24); }

export function saveSession(session, options = {}) {
  const storage = getStorage(options.storage);
  if (!storage || !session || session.cursor >= session.questions?.length) { if (session?.cursor >= session?.questions?.length) discard(storage); return false; }
  try {
    const now = getNow(options.now);
    const record = {
      version: SESSION_STORAGE_VERSION, savedAt: now, expiresAt: now + SESSION_STORAGE_TTL,
      sessionId: session.sessionId, participants: [...session.participants], deckId: session.deckId,
      deckIds: [...(session.deckIds || [session.deckId])], mixed: session.mixed === true,
      adultConfirmed: session.adultConfirmed === true, includeR18: session.includeR18 === true,
      includeChallenges: session.includeChallenges === true, questionIds: session.questions.map((card) => card.id),
      questionSources: session.questions.map((card) => card.sourceDeckId || null), cursor: session.cursor,
      unlockedUntil: session.unlockedUntil, roundStart: session.roundStart, roundCount: session.roundCount,
      roundNumber: session.roundNumber, revealed: session.revealed === true, answerIndex: session.answerIndex,
      likes: { ...(session.likes || {}) },
    };
    storage.setItem(SESSION_STORAGE_KEY, JSON.stringify(record));
    return true;
  } catch { return false; }
}

function hydrate(record, now) {
  if (!record || record.version !== SESSION_STORAGE_VERSION || !Number.isFinite(record.expiresAt) || record.expiresAt <= now) throw new Error('expired');
  if (typeof record.sessionId !== 'string' || !/^[A-Za-z0-9-]{8,100}$/.test(record.sessionId) || !validNames(record.participants)) throw new Error('session');
  if (![record.mixed, record.adultConfirmed, record.includeR18, record.includeChallenges, record.revealed].every((value) => typeof value === 'boolean')) throw new Error('flags');
  const deckIds = Array.isArray(record.deckIds) ? record.deckIds : [record.deckId];
  if (deckIds.some((id) => typeof id !== 'string' || !/^[A-Za-z0-9-]+$/.test(id))) throw new Error('decks');
  if ((record.mixed !== true && (deckIds.length !== 1 || record.deckId !== deckIds[0])) || (record.mixed === true && (deckIds.length < 2 || deckIds.length > 3 || record.deckId !== 'mix'))) throw new Error('decks');
  if (new Set(deckIds).size !== deckIds.length) throw new Error('decks');
  const sourceDecks = deckIds.map((id) => decks.find((deck) => deck.id === id));
  if (sourceDecks.some((deck) => !deck || !Array.isArray(deck.questions) || deck.questions.length !== 40)) throw new Error('source');
  if (record.mixed && sourceDecks.some((deck) => deck.adultOnly)) throw new Error('mixed-adult');
  if (record.mixed && sourceDecks.some((deck) => deck.questions.some((card) => card.r18))) throw new Error('mixed-r18');
  if (!record.mixed && ((record.includeR18 && record.adultConfirmed !== true) || (sourceDecks[0].adultOnly && record.adultConfirmed !== true))) throw new Error('consent');
  if (record.mixed && (record.includeR18 || record.adultConfirmed)) throw new Error('mixed-options');
  if (!Array.isArray(record.questionIds) || record.questionIds.length !== 40 || record.questionIds.some((id) => typeof id !== 'string') || new Set(record.questionIds).size !== 40) throw new Error('questions');
  const index = cardIndex();
  const sources = Array.isArray(record.questionSources) ? record.questionSources : [];
  const questions = record.questionIds.map((id, i) => {
    const card = index.get(id); if (!card) throw new Error('question');
    if (card.kind === 'challenge' && !record.includeChallenges) throw new Error('challenge');
    if (!record.mixed && card.kind !== 'challenge') {
      const deck = sourceDecks[0];
      const regular = deck.questions.some((item) => item.id === id);
      const optionalR18 = record.includeR18 && deck.r18Questions?.some((item) => item.id === id);
      if (!regular && !optionalR18) throw new Error('question-source');
    }
    if (record.mixed) {
      const source = sources[i];
      const sourceDeck = source && sourceDecks.find((deck) => deck.id === source);
      if (!source || !sourceDeck || (card.kind !== 'challenge' && !sourceDeck.questions.some((item) => item.id === id))) throw new Error('question-source');
    }
    if (card.touch && (!record.includeChallenges || record.participants.length !== 2 || !deckIds.every((id) => card.eligibleDeckIds?.includes(id)))) throw new Error('touch');
    if (card.r18 && record.adultConfirmed !== true) throw new Error('r18');
    return { ...card, ...(sources[i] ? { sourceDeckId: sources[i] } : {}) };
  });
  if (!Number.isInteger(record.cursor) || record.cursor < 0 || record.cursor > 40 || !Number.isInteger(record.unlockedUntil) || ![6, 12, 18, 24, 30, 36, 40].includes(record.unlockedUntil) || record.cursor > record.unlockedUntil || (record.cursor === 40 && record.unlockedUntil !== 40)) throw new Error('progress');
  const expectedRoundStart = record.unlockedUntil === 40 ? 36 : Math.max(0, record.unlockedUntil - 6);
  if (!Number.isInteger(record.roundStart) || record.roundStart !== expectedRoundStart || !Number.isInteger(record.roundCount) || record.roundCount !== record.cursor % 6 || !Number.isInteger(record.roundNumber) || record.roundNumber !== Math.floor(record.cursor / 6) + 1) throw new Error('round');
  if (record.revealed && record.cursor === record.unlockedUntil) throw new Error('progress');
  if (!Number.isInteger(record.answerIndex) || record.answerIndex < 0 || record.answerIndex >= record.participants.length || (!record.revealed && record.answerIndex !== 0)) throw new Error('answer');
  const likes = record.likes && typeof record.likes === 'object' && !Array.isArray(record.likes) ? record.likes : {};
  for (const [key, value] of Object.entries(likes)) {
    const match = key.match(/^([A-Za-z0-9._:-]+):(\d+)$/);
    if (!match || !record.questionIds.includes(match[1]) || Number(match[2]) >= record.participants.length || !Number.isSafeInteger(value) || value < 0) throw new Error('likes');
  }
  if (record.cursor >= 40) return null;
  return { sessionId: record.sessionId, participants: [...record.participants], deckId: record.deckId, deckIds, mixed: record.mixed === true, questions, cursor: record.cursor, unlockedUntil: record.unlockedUntil, roundStart: Number.isInteger(record.roundStart) ? record.roundStart : Math.max(0, record.unlockedUntil - 6), roundCount: Number.isInteger(record.roundCount) ? record.roundCount : record.cursor % 6, roundNumber: Number.isInteger(record.roundNumber) ? record.roundNumber : Math.floor(record.cursor / 6) + 1, adultConfirmed: record.adultConfirmed === true, includeR18: record.includeR18 === true, includeChallenges: record.includeChallenges === true, revealed: record.revealed === true, answerIndex: record.answerIndex, likes: { ...likes } };
}

export function loadSession(options = {}) {
  const storage = getStorage(options.storage); if (!storage) return null;
  try {
    const raw = storage.getItem(SESSION_STORAGE_KEY); if (!raw) return null;
    const value = hydrate(JSON.parse(raw), getNow(options.now));
    if (!value) { discard(storage); return null; }
    return value;
  } catch { discard(storage); return null; }
}

export function clearSession(options = {}) { const storage = getStorage(options.storage); discard(storage); }

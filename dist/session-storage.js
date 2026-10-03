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
function validCustomQuestion(card) { return card && typeof card.id === 'string' && /^custom:[0-9a-f-]{16,80}$/i.test(card.id) && typeof card.text === 'string' && card.text.trim().length > 0 && Array.from(card.text.trim()).length <= 300 && !/[\u0000-\u001f\u007f\u2028\u2029]/u.test(card.text) && typeof card.r18 === 'boolean'; }

export function saveSession(session, options = {}) {
  const storage = getStorage(options.storage);
  if (!storage || !session || session.cursor >= session.questions?.length) { if (session?.cursor >= session?.questions?.length) discard(storage); return false; }
  try {
    const now = getNow(options.now);
    const record = {
      version: SESSION_STORAGE_VERSION, savedAt: now, expiresAt: now + SESSION_STORAGE_TTL,
      sessionId: session.sessionId, participants: [...session.participants], deckId: session.deckId,
      deckIds: [...(session.deckIds || [session.deckId])], mixed: session.mixed === true,
      customSet: session.customSet === true,
      ownerUserId: session.customSet === true && typeof session.ownerUserId === 'string' ? session.ownerUserId : null,
      customQuestions: session.customSet === true && Array.isArray(session.customQuestions) ? session.customQuestions.filter(validCustomQuestion).map((card) => ({ id: card.id, text: card.text, r18: card.r18 })) : [],
      adultConfirmed: session.adultConfirmed === true, includeR18: session.includeR18 === true,
      includeChallenges: session.includeChallenges === true, questionIds: session.questions.map((card) => card.id),
      questionSources: session.questions.map((card) => card.sourceDeckId || null), cursor: session.cursor,
      unlockedUntil: session.unlockedUntil, roundStart: session.roundStart, roundCount: session.roundCount,
      roundNumber: session.roundNumber, revealed: session.revealed === true, answerIndex: session.answerIndex,
      likes: { ...(session.likes || {}) },
      feedbackSubmitted: Array.isArray(session.feedbackSubmitted) ? [...new Set(session.feedbackSubmitted.filter((cursor) => Number.isInteger(cursor) && cursor >= 6 && cursor <= session.questions.length))] : [],
    };
    storage.setItem(SESSION_STORAGE_KEY, JSON.stringify(record));
    return true;
  } catch { return false; }
}

function hydrate(record, now) {
  if (!record || record.version !== SESSION_STORAGE_VERSION || !Number.isFinite(record.expiresAt) || record.expiresAt <= now) throw new Error('expired');
  if (typeof record.sessionId !== 'string' || !/^[A-Za-z0-9-]{8,100}$/.test(record.sessionId) || !validNames(record.participants)) throw new Error('session');
  if ([record.mixed, record.adultConfirmed, record.includeR18, record.includeChallenges, record.revealed].some((value) => typeof value !== 'boolean')) throw new Error('flags');
  const customSet = record.customSet === true;
  let hasCustom = Array.isArray(record.customQuestions) && record.customQuestions.length > 0;
  const deckIds = Array.isArray(record.deckIds) ? record.deckIds : [record.deckId];
  if (deckIds.some((id) => typeof id !== 'string' || !/^[A-Za-z0-9-]+$/.test(id))) throw new Error('decks');
  if (!customSet && ((record.mixed !== true && (deckIds.length !== 1 || record.deckId !== deckIds[0])) || (record.mixed === true && (deckIds.length < 2 || deckIds.length > 3 || record.deckId !== 'mix'))) ) throw new Error('decks');
  if (customSet && (record.deckId !== 'my-set' || record.mixed !== false || deckIds.length !== 1 || deckIds[0] !== 'my-set')) throw new Error('decks');
  if (new Set(deckIds).size !== deckIds.length) throw new Error('decks');
  const sourceDecks = deckIds.map((id) => decks.find((deck) => deck.id === id));
  if (!customSet && sourceDecks.some((deck) => !deck || !Array.isArray(deck.questions) || deck.questions.length !== 40)) throw new Error('source');
  if (!customSet && record.mixed && sourceDecks.some((deck) => deck.adultOnly)) throw new Error('mixed-adult');
  if (!customSet && record.mixed && sourceDecks.some((deck) => deck.questions.some((card) => card.r18))) throw new Error('mixed-r18');
  if (!record.mixed && !customSet && ((record.includeR18 && record.adultConfirmed !== true) || (sourceDecks[0].adultOnly && record.adultConfirmed !== true))) throw new Error('consent');
  if (record.mixed && (record.includeR18 || record.adultConfirmed)) throw new Error('mixed-options');
  if (!Array.isArray(record.questionIds) || record.questionIds.length < (customSet ? 6 : 40) || record.questionIds.length > 40 || record.questionIds.some((id) => typeof id !== 'string') || new Set(record.questionIds).size !== record.questionIds.length) throw new Error('questions');
  const customQuestionIds = record.questionIds.filter((id) => id.startsWith('custom:'));
  hasCustom = hasCustom || customQuestionIds.length > 0;
  if (hasCustom && (!customSet || typeof record.ownerUserId !== 'string' || !/^[0-9a-f-]{8,100}$/i.test(record.ownerUserId))) throw new Error('owner');
  if (hasCustom && (!Array.isArray(record.customQuestions) || record.customQuestions.length > 40 || record.customQuestions.some((card) => !validCustomQuestion(card)) || new Set(record.customQuestions.map((item) => item.id)).size !== record.customQuestions.length || record.customQuestions.some((card) => !record.questionIds.includes(card.id)) || new Set(record.customQuestions.map((item) => item.id)).size !== new Set(customQuestionIds).size)) throw new Error('custom');
  if (!hasCustom && record.customQuestions?.length) throw new Error('custom');
  const index = cardIndex();
  const customIndex = new Map((record.customQuestions || []).map((card) => [card.id, { ...card, sourceDeckId: 'custom', custom: true }]));
  const sources = Array.isArray(record.questionSources) ? record.questionSources : [];
  const questions = record.questionIds.map((id, i) => {
    const card = index.get(id) || customIndex.get(id); if (!card) throw new Error('question');
    if (card.kind === 'challenge' && !record.includeChallenges) throw new Error('challenge');
    if (customSet && (card.kind === 'challenge' || !sources[i] || (card.custom ? sources[i] !== 'custom' : !decks.some((deck) => deck.id === sources[i] && (deck.questions.some((item) => item.id === id) || deck.r18Questions?.some((item) => item.id === id)))))) throw new Error('question-source');
    if (!customSet && !record.mixed && card.kind !== 'challenge') {
      const deck = sourceDecks[0];
      const regular = deck.questions.some((item) => item.id === id);
      const optionalR18 = record.includeR18 && deck.r18Questions?.some((item) => item.id === id);
      if (!regular && !optionalR18) throw new Error('question-source');
    }
    if (record.mixed && !customSet) {
      const source = sources[i];
      const sourceDeck = source && sourceDecks.find((deck) => deck.id === source);
      if (!source || !sourceDeck || (card.kind !== 'challenge' && !sourceDeck.questions.some((item) => item.id === id))) throw new Error('question-source');
    }
    if (card.touch && (!record.includeChallenges || record.participants.length !== 2 || !deckIds.every((id) => card.eligibleDeckIds?.includes(id)))) throw new Error('touch');
    if (card.r18 && record.adultConfirmed !== true) throw new Error('r18');
    return { ...card, ...(sources[i] ? { sourceDeckId: sources[i] } : {}) };
  });
  const finalLength = record.questionIds.length;
  const validUnlock = (value) => value === finalLength || (value >= 6 && value < finalLength && value % 6 === 0);
  if (!Number.isInteger(record.cursor) || record.cursor < 0 || record.cursor > finalLength || !Number.isInteger(record.unlockedUntil) || !validUnlock(record.unlockedUntil) || record.cursor > record.unlockedUntil || (record.cursor === finalLength && record.unlockedUntil !== finalLength)) throw new Error('progress');
  const expectedRoundStart = record.unlockedUntil === finalLength ? Math.max(0, finalLength - (finalLength % 6 || 6)) : Math.max(0, record.unlockedUntil - 6);
  if (!Number.isInteger(record.roundStart) || record.roundStart !== expectedRoundStart || !Number.isInteger(record.roundCount) || record.roundCount !== record.cursor % 6 || !Number.isInteger(record.roundNumber) || record.roundNumber !== Math.floor(record.cursor / 6) + 1) throw new Error('round');
  if (record.revealed && record.cursor === record.unlockedUntil) throw new Error('progress');
  if (!Number.isInteger(record.answerIndex) || record.answerIndex < 0 || record.answerIndex >= record.participants.length || (!record.revealed && record.answerIndex !== 0)) throw new Error('answer');
  const likes = record.likes && typeof record.likes === 'object' && !Array.isArray(record.likes) ? record.likes : {};
  for (const [key, value] of Object.entries(likes)) {
    const match = key.match(/^([A-Za-z0-9._:-]+):(\d+)$/);
    if (!match || !record.questionIds.includes(match[1]) || Number(match[2]) >= record.participants.length || !Number.isSafeInteger(value) || value < 0) throw new Error('likes');
  }
  const feedbackSubmitted = Array.isArray(record.feedbackSubmitted) ? [...new Set(record.feedbackSubmitted.filter((cursor) => Number.isInteger(cursor) && cursor >= 6 && cursor <= finalLength && cursor <= record.cursor))] : [];
  if (record.cursor >= finalLength) return null;
  return { sessionId: record.sessionId, participants: [...record.participants], deckId: record.deckId, deckIds, customSet, ownerUserId: hasCustom ? record.ownerUserId : null, customQuestions: hasCustom ? record.customQuestions.map((card) => ({ ...card })) : [], mixed: record.mixed === true, questions, cursor: record.cursor, unlockedUntil: record.unlockedUntil, roundStart: Number.isInteger(record.roundStart) ? record.roundStart : Math.max(0, record.unlockedUntil - 6), roundCount: Number.isInteger(record.roundCount) ? record.roundCount : record.cursor % 6, roundNumber: Number.isInteger(record.roundNumber) ? record.roundNumber : Math.floor(record.cursor / 6) + 1, adultConfirmed: record.adultConfirmed === true, includeR18: record.includeR18 === true, includeChallenges: record.includeChallenges === true, revealed: record.revealed === true, answerIndex: record.answerIndex, likes: { ...likes }, feedbackSubmitted };
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

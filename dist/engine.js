export const ROUND_SIZE = 6;
export const MAX_PARTICIPANTS = 8;
export const MAX_NAME_LENGTH = 24;

export function normalizeParticipants(participants) {
  if (!Array.isArray(participants) || participants.length < 2 || participants.length > MAX_PARTICIPANTS) throw new Error('参加者は2〜8人で入力してください');
  if (participants.some((name) => typeof name !== 'string')) throw new Error('参加者の名前は文字で入力してください');
  const names = participants.map((name) => name.trim());
  if (names.some((name) => !name)) throw new Error('参加者の名前を入力してください');
  if (names.some((name) => name.length > MAX_NAME_LENGTH)) throw new Error(`名前は${MAX_NAME_LENGTH}文字以内で入力してください`);
  return names;
}

export function createSession({ participants, deck, adultConfirmed = false, random = Math.random }) {
  const names = normalizeParticipants(participants);
  if (!deck || !Array.isArray(deck.questions) || deck.questions.length !== 40) throw new Error('デッキが不正です');
  if (deck.adultOnly && adultConfirmed !== true) throw new Error('成人向け確認が必要です');
  const questions = shuffle(deck.questions, random);
  return { participants: names, deckId: deck.id, questions, cursor: 0, unlockedUntil: ROUND_SIZE, roundStart: 0, roundCount: 0, roundNumber: 1, adultConfirmed, revealed: false, answerIndex: 0, likes: {} };
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

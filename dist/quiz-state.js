const DEFAULT_SET_SIZE = 6;

function shuffled(items, random = Math.random) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

function validQuestions(questions) {
  return Array.isArray(questions)
    ? questions.filter((question) => question && typeof question.id === "string" && question.id && typeof question.question === "string" && question.question && typeof question.answer === "string" && typeof question.explanation === "string")
    : [];
}

export function createQuizGame({ questions, levelId = "beginner", questionCount = DEFAULT_SET_SIZE, usedQuestionIds = [], random = Math.random } = {}) {
  const pool = validQuestions(questions);
  if (!pool.length) throw new Error("QUIZ_QUESTIONS_REQUIRED");
  const count = Number.isInteger(questionCount) && questionCount > 0 ? questionCount : DEFAULT_SET_SIZE;
  const used = new Set(Array.isArray(usedQuestionIds) ? usedQuestionIds.filter((id) => typeof id === "string" && id) : []);
  let available = pool.filter((question) => !used.has(question.id));
  const cycleUsed = available.length ? used : new Set();
  if (!available.length) available = pool;
  const selected = shuffled(available, random).slice(0, Math.min(count, available.length));
  return {
    phase: "question",
    levelId,
    cursor: 0,
    questions: selected,
    usedQuestionIds: [...cycleUsed, ...selected.map((question) => question.id)],
  };
}

export function quizAction(state, action) {
  if (!state || !["question", "answer", "complete"].includes(state.phase)) throw new Error("QUIZ_PHASE");
  if (state.phase === "question" && action === "reveal") return { ...state, phase: "answer" };
  if (state.phase === "answer" && action === "next") {
    const cursor = state.cursor + 1;
    return cursor >= state.questions.length ? { ...state, phase: "complete", cursor } : { ...state, phase: "question", cursor };
  }
  throw new Error("QUIZ_ACTION");
}

export function currentQuizQuestion(state) {
  return state?.questions?.[state.cursor] || null;
}

export const QUIZ_SET_SIZE = DEFAULT_SET_SIZE;

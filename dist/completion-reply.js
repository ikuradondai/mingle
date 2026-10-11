const ROMANCE_IDS = new Set(["date", "acquaintance-date", "omiai", "new-couple", "couples", "moving-in", "engaged-couple", "intimacy", "first-intimacy", "intimacy-refresh", "intimacy-distance"]);
const BUSINESS_IDS = new Set(["founders", "team", "new-colleagues", "business-meetup"]);

export function completionReplyContext(session, { solo = false } = {}) {
  if (solo || session?.mode === "solo" || session?.count === 1 || session?.participants?.length === 1) return "solo";
  if (session?.business === true || session?.businessSession === true || session?.mode === "business") return "business";
  if (session?.sponsorSet === true && Array.isArray(session?.sponsor?.categories) && session.sponsor.categories.includes("work")) return "business";
  const ids = Array.isArray(session?.deckIds) ? session.deckIds : session?.deckId ? [session.deckId] : [];
  if (ids.some((id) => BUSINESS_IDS.has(String(id)))) return "business";
  if (ids.length > 0 && ids.every((id) => ROMANCE_IDS.has(String(id))) && session?.participants?.length === 2) return "romance";
  if (session?.participants?.length === 2 || session?.count === 2) return "pair";
  return "group";
}

export function completionReplyKey(session) {
  const org = session?.organizationId || session?.orgId || "";
  const id = session?.sessionId || session?.session_id || session?.id || session?.deckId || "session";
  const round = session?.roundKey || `${session?.roundStart ?? 0}:${session?.cursor ?? 0}`;
  return org ? `${org}:${id}:${round}` : `${id}:${round}`;
}

export function completionReplyCopy(context) {
  if (context === "solo") return {
    title: "自分に、声で届けよう。",
    prompt: "今日の答えから、自分に覚えておいてほしいことをひとつ。小さな声でもいいので、自分に向けて声に出してみよう。",
    action: "声に出した",
    doneLabel: "声に出しました",
    completeTitle: "そのひとことが、今日のしめくくり。",
    complete: "自分に返す言葉を、ちゃんと届けました。",
    image: "/assets/completion-reply-solo.webp",
  };
  if (context === "pair" || context === "romance") return {
    title: "この時間に、ひとこと返そう。",
    prompt: "相手の答えで、聞けてよかった話をひとつ。「○○の話をしてくれて、ありがとう」と、交代して声に出して伝えよう。",
    action: "伝え合った",
    doneLabel: "伝え合いました",
    completeTitle: "そのひとことが、今日のしめくくり。",
    complete: "聞けてよかった話を、言葉にして渡しました。",
    image: "/assets/completion-reply-pair.webp",
  };
  if (context === "business") return {
    title: "この時間に、ひとこと返そう。",
    prompt: "今日、参考になった誰かの視点をひとつ。その人に、参考になったことを声に出して伝えよう。最後にみんなで拍手。",
    action: "伝え合った",
    doneLabel: "伝え合いました",
    completeTitle: "そのひとことが、今日のしめくくり。",
    complete: "参考になった視点を、言葉にして渡しました。",
    image: "/assets/completion-reply-group.webp",
  };
  return {
    title: "この時間に、ひとこと返そう。",
    prompt: "今日の会話で、聞けてよかった話をひとつ。一人ずつ声に出して伝え、言葉を渡して受け取ろう。",
    action: "伝え合った",
    doneLabel: "伝え合いました",
    completeTitle: "そのひとことが、今日のしめくくり。",
    complete: "聞けてよかった話を、言葉にして渡しました。",
    image: "/assets/completion-reply-group.webp",
  };
}

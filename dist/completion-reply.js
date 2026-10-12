const FRIEND_IDS = new Set(["friends", "reunion"]);
const CANDIDATE_IDS = new Set(["date", "acquaintance-date", "omiai"]);
const PARTNER_IDS = new Set(["new-couple", "moving-in", "engaged-couple", "intimacy", "first-intimacy", "intimacy-refresh", "intimacy-distance"]);
const MARRIED_IDS = new Set(["couples"]);
const FAMILY_IDS = new Set(["parent-50plus", "parent-under12", "family-reunion", "siblings", "grandparents-and-grandchildren", "in-laws"]);
const FIRST_MEETING_IDS = new Set(["party-first-meeting", "bar-first-meeting", "group-mixer", "neighbors"]);
const BUSINESS_IDS = new Set(["founders", "team", "new-colleagues", "business-meetup"]);

export function completionReplyContext(session, { solo = false } = {}) {
  if (solo || session?.mode === "solo" || session?.count === 1 || session?.participants?.length === 1) return "solo";
  if (session?.business === true || session?.businessSession === true || session?.mode === "business") return "business";
  if (session?.sponsorSet === true && Array.isArray(session?.sponsor?.categories) && session.sponsor.categories.includes("work")) return "business";
  const ids = Array.isArray(session?.deckIds) ? session.deckIds : session?.deckId ? [session.deckId] : [];
  const matches = (catalog) => ids.length > 0 && ids.every((id) => catalog.has(String(id)));
  if (matches(BUSINESS_IDS)) return "business";
  if (matches(FRIEND_IDS)) return "friend";
  if (matches(CANDIDATE_IDS)) return "candidate";
  if (matches(PARTNER_IDS)) return "partner";
  if (matches(MARRIED_IDS)) return "married";
  if (matches(FAMILY_IDS)) return "family";
  if (matches(FIRST_MEETING_IDS)) return "first";
  if (session?.participants?.length === 2 || session?.count === 2) return "pair";
  return "group";
}

export function completionReplyKey(session) {
  const org = session?.organizationId || session?.orgId || "";
  const id = session?.sessionId || session?.session_id || session?.id || session?.deckId || "session";
  const round = session?.roundKey || `${session?.roundStart ?? 0}:${session?.cursor ?? 0}`;
  return org ? `${org}:${id}:${round}` : `${id}:${round}`;
}

export function completionReplyCopy(context, { participantCount = 3 } = {}) {
  const image = participantCount === 2 ? "/assets/completion-reply-pair.webp" : "/assets/completion-reply-group.webp";
  if (context === "solo") return {
    title: "自分に、声で届けよう。",
    prompt: "今日の答えから、自分に覚えておいてほしいことをひとつ。小さな声でもいいので、自分に向けて声に出してみよう。",
    action: "声に出した",
    doneLabel: "声に出しました",
    completeTitle: "そのひとことが、今日のしめくくり。",
    complete: "自分に伝えたい言葉を、ちゃんと届けました。",
    image: "/assets/completion-reply-solo.webp",
  };
  if (context === "friend") return {
    title: "この時間に、ひとこと伝えよう。",
    prompt: "今日の話で、聞けてよかったことをひとつ。「○○の話、聞けてよかった」と、一人ずつ声に出して伝えよう。",
    action: "伝え合った",
    doneLabel: "伝え合いました",
    completeTitle: "そのひとことが、今日のしめくくり。",
    complete: "聞けてよかった気持ちを、言葉にして伝えました。",
    image,
  };
  if (context === "candidate") return {
    title: "この時間に、ひとこと伝えよう。",
    prompt: "今日知れた、相手の素敵なところをひとつ。「○○なところ、いいなと思った」と、声に出して伝え合おう。",
    action: "伝え合った", doneLabel: "伝え合いました", completeTitle: "そのひとことが、今日のしめくくり。",
    complete: "知れてよかった気持ちを、言葉にして伝えました。", image,
  };
  if (context === "partner") return {
    title: "この時間に、ひとこと伝えよう。",
    prompt: "今日の話で、あらためて素敵だなと思ったところをひとつ。「○○なところが好き」と、声に出して伝え合おう。",
    action: "伝え合った", doneLabel: "伝え合いました", completeTitle: "そのひとことが、今日のしめくくり。",
    complete: "相手の素敵なところを、言葉にして伝えました。", image,
  };
  if (context === "married") return {
    title: "この時間に、ひとこと伝えよう。",
    prompt: "今日の話を聞いて、あらためて伝えたくなった感謝をひとつ。「○○してくれて、ありがとう」と、声に出して伝え合おう。",
    action: "伝え合った", doneLabel: "伝え合いました", completeTitle: "そのひとことが、今日のしめくくり。",
    complete: "あらためて感謝を、言葉にして伝えました。", image,
  };
  if (context === "family") return {
    title: "この時間に、ひとこと伝えよう。",
    prompt: "今日、家族に伝えておきたい気持ちをひとつ。「○○と聞けてうれしかった」「○○、ありがとう」と、声に出して伝えよう。",
    action: "伝えた", doneLabel: "伝えました", completeTitle: "そのひとことが、今日のしめくくり。",
    complete: "家族に伝えたい気持ちを、声に出して届けました。", image,
  };
  if (context === "first") return {
    title: "この時間に、ひとこと伝えよう。",
    prompt: "今日の話で、知れてよかったことをひとつ。「○○のお話、聞けてよかったです」と、一人ずつ声に出して伝えよう。",
    action: "伝え合った", doneLabel: "伝え合いました", completeTitle: "そのひとことが、今日のしめくくり。",
    complete: "知れてよかった気持ちを、言葉にして伝えました。", image,
  };
  if (context === "business") return {
    title: "この時間に、ひとこと伝えよう。",
    prompt: "今日、参考になった視点をひとつ。「○○という考えが参考になりました」と、その人に声に出して伝えよう。",
    action: "伝え合った", doneLabel: "伝え合いました", completeTitle: "そのひとことが、今日のしめくくり。",
    complete: "参考になった視点を、言葉にして伝えました。", image,
  };
  if (context === "pair" || context === "romance") return {
    title: "この時間に、ひとこと伝えよう。",
    prompt: "相手の答えで、聞けてよかった話をひとつ。「○○の話をしてくれて、ありがとう」と、交代して声に出して伝えよう。",
    action: "伝え合った", doneLabel: "伝え合いました", completeTitle: "そのひとことが、今日のしめくくり。",
    complete: "聞けてよかった話を、言葉にして伝えました。", image,
  };
  return {
    title: "この時間に、ひとこと伝えよう。",
    prompt: "今日の会話で、聞けてよかった話をひとつ。一人ずつ声に出して伝え、言葉を渡して受け取ろう。",
    action: "伝え合った",
    doneLabel: "伝え合いました",
    completeTitle: "そのひとことが、今日のしめくくり。",
    complete: "聞けてよかった話を、言葉にして伝えました。",
    image,
  };
}

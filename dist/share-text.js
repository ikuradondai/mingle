export const SHARE_URL = "https://mingle.cards/";
export const SHARE_HASHTAGS = "#ミングる #Minglecards #あたらしい会話のはじめかた";

export function buildShareText(title) {
  const safeTitle = typeof title === "string" && title.trim() ? title.trim() : "会話テーマ";
  return `ミングルで、「${safeTitle}」の会話やってみた！\n${SHARE_HASHTAGS}\n${SHARE_URL}`;
}

export function buildXShareUrl(text) {
  const body = text.endsWith(SHARE_URL) ? text.slice(0, -SHARE_URL.length).trimEnd() : text;
  return `https://twitter.com/intent/tweet?text=${encodeURIComponent(body)}&url=${encodeURIComponent(SHARE_URL)}`;
}

export function buildFacebookShareUrl() {
  return `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(SHARE_URL)}`;
}

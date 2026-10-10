import { roundCompletionInfo } from './round-completion.js';

const GROUP_FEELINGS = Object.freeze({
  newPerspective: { label: "新しい一面", title: "知らなかった一面に、出会えた。", prompt: "どんな一面が印象に残った？", image: "/assets/completion-feel-perspective-v4.png" },
  laughed: { label: "笑えた", title: "笑えた、この時間。", prompt: "どの瞬間がいちばんおかしかった？", image: "/assets/completion-feel-laughed-v4-smile.png" },
  opened: { label: "考えがひらいた", title: "ひとつ、見方が増えた。", prompt: "どんな言葉がきっかけだった？", image: "/assets/completion-solo-organized-v4.png" },
  neutral: { label: "まだ言葉にならない", title: "今は、問いを持ち帰ろう。", prompt: "", image: "/assets/completion-feel-neutral-v4.png" }
});
const SOLO_FEELINGS = Object.freeze({
  felt: { label: "気持ちが見えた", title: "少し、自分の気持ちが見えた。", prompt: "どんな気持ちに気づいた？", image: "/assets/completion-solo-feeling-v4.png" },
  organized: { label: "少し整理できた", title: "少しずつ、整理できた。", prompt: "どんなことが、少しはっきりした？", image: "/assets/completion-solo-organized-v4.png" },
  question: { label: "問いが残った", title: "問いを、次の時間へ。", prompt: "今、どんな問いが残っている？", image: "/assets/completion-solo-reflection-v3.png" },
  neutral: { label: "まだ言葉にならない", title: "今は、問いを持ち帰ろう。", prompt: "", image: "/assets/completion-feel-neutral-v4.png" }
});
export function completionFeelingChoices(solo = false) { return Object.entries(solo ? SOLO_FEELINGS : GROUP_FEELINGS).map(([id, value]) => ({ id, ...value })); }
export function completionFeelingFor(solo, id) {
  if (typeof id !== 'string') return null;
  return completionFeelingChoices(solo).find((choice) => choice.id === id) || null;
}
export function completionFeelingKey(session) { return roundCompletionInfo(session).key; }

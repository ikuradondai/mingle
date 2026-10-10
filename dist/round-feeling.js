import { roundCompletionInfo } from './round-completion.js';

const GROUP_FEELINGS = Object.freeze({
  newPerspective: { label: "新しい一面", title: "相手を知ろうとする姿勢が、すてきです。", titleParts: ["相手を知ろうとする", "姿勢が、すてきです。"], message: "いつもと違う一面に目を向けた、その好奇心に拍手。", image: "/assets/completion-feel-perspective-v4.png" },
  laughed: { label: "笑えた", title: "楽しむ時間をつくれたね。", message: "笑えたひとときを大切にできたことが、すてきです。", image: "/assets/completion-feel-laughed-v4-smile.png" },
  opened: { label: "考えがひらいた", title: "新しい見方を迎えたあなたに、拍手。", message: "考えをひらき、違う見方にも目を向けた姿勢がすてきです。", image: "/assets/completion-solo-organized-v4.png" },
  neutral: { label: "まだ言葉にならない", title: "ここまで向き合ったあなたに、拍手。", message: "すぐに言葉にできなくても、考える時間をつくれたことがすてきです。", image: "/assets/completion-feel-neutral-v4.png" }
});
const SOLO_FEELINGS = Object.freeze({
  felt: { label: "気づきがあった", title: "小さな気づきを見つけられたね。", message: "自分の内側に目を向けた、その丁寧さがすてきです。", image: "/assets/completion-solo-feeling-v4.png" },
  organized: { label: "少し整理できた", title: "自分のために、いい時間をつくれたね。", message: "立ち止まって考えをほどいた、そのひと手間に拍手。", image: "/assets/completion-solo-organized-v4.png" },
  question: { label: "もう少し考えたい", title: "じっくり向き合う姿勢が、すてきです。", titleParts: ["じっくり向き合う姿勢が、", "すてきです。"], message: "答えを急がず、もう一歩考えようとする気持ちに拍手。", image: "/assets/completion-solo-path-v5.png" },
  neutral: { label: "まだ言葉にならない", title: "自分と向き合った時間に、拍手。", message: "言葉になる前の気持ちも、大切にできたね。", image: "/assets/completion-feel-neutral-v4.png" }
});
export function completionFeelingChoices(solo = false) { return Object.entries(solo ? SOLO_FEELINGS : GROUP_FEELINGS).map(([id, value]) => ({ id, ...value })); }
export function completionFeelingFor(solo, id) {
  if (typeof id !== 'string') return null;
  return completionFeelingChoices(solo).find((choice) => choice.id === id) || null;
}
export function completionFeelingKey(session) { return roundCompletionInfo(session).key; }

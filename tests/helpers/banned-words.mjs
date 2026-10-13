// ソロ・トリセツ共通の禁止語。問いの形の禁止と、診断めいた語の禁止。
export const BANNED_QUESTION_STYLE = [
  /なぜ/u, /どうして/u, /べき/u, /戻れる/u, /戻りたい/u, /本当によかった/u, /SNSを見/u,
  /相手の本音/u, /相手はどう思/u, /自分の悪い/u, /何がいけなかった/u, /最悪/u, /うらやまし/u, /あなた/u,
];
export const BANNED_DIAGNOSIS = [
  /うつ/u, /病気/u, /症状/u, /診断/u, /障害/u, /トラウマ/u, /PTSD/u, /依存/u, /メンヘラ/u, /HSP/u,
  /愛着スタイル/u, /自己肯定感が低い/u, /ネガティブ思考/u, /認知の歪み/u, /共依存/u, /毒親/u,
  /モラハラ/u, /ストレス度/u, /レベル判定/u,
];
export const BANNED = [...BANNED_QUESTION_STYLE, ...BANNED_DIAGNOSIS];
// 硬い語（やさしい日本語にそろえるため使わない）
export const STIFF_WORDS = [/信頼/u, /解消/u, /対処/u, /回復/u, /睡眠/u];

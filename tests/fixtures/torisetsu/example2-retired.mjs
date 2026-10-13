// 設計書 4-6 例2: 退職後の人（第2章）。予想: 人への優しさ。
export const input = {
  prediction: ['v_care'],
  neg: [
    { situation: 'n_promise', value: 'v_honest', feeling: 'f_disappointed', memo: '孫との約束が流れた' },
    { situation: 'n_ignored', value: 'v_respect', feeling: 'f_uneasy', memo: '' },
  ],
  pos: [
    { situation: 'p_honest', value: 'v_honest', feeling: 'f_happy', memo: '' },
    { situation: 'p_understood', value: 'v_bond', feeling: 'f_moved', memo: '' },
  ],
};
export const expected = {
  sentences: ['イラッと・がっかりした出来事と、うれしかった出来事。反対の気持ちなのに、どちらにも『約束や正直さ』が関わっていました。（4つの出来事のうち2つ）'],
  summary: '『約束や正直さ』を大事にしているのかもしれません。',
  footer: '4つの出来事から見えたことです。決まりではありません。',
  gap: ['→ 今回の出来事には出てきませんでした。'],
  actual: '実際は：心が動いた出来事の裏には『約束や正直さ』がありました。',
  tries: ['小さな約束を1つ決めて、守ってみる', '心が動いたことを、来週もう1つメモしてみる'],
  teaser: '見つけたこと：『約束や正直さ』を大事にしているのかも',
};

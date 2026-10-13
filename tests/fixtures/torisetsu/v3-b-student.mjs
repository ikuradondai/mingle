// 設計書 3-9 例B: 高校生・第2章（頭の中の声）。
export const chapter = 'voice';
export const data = {
  episodes: [
    { scene: 'sc_work', memo: 'グループ発表で失敗した', thoughts: ['th_nogood', 'th_others'] },
    { scene: 'sc_friend', memo: 'LINEの返事が来ない', thoughts: ['th_disliked'] },
    { scene: 'sc_family', memo: '親に頼みごとを言いそびれた', thoughts: ['th_burden'] },
  ],
  focus: '',
  intents: ['in_disliked', 'in_others'],
  reply: 'rp_read2',
  replyText: '',
  surprise: 'p:pt_read',
  experiment: 'try:pt_read',
};
export const expected = {
  focus: 'pt_read',
  rows: [
    {
      heading: '『人の気持ちを先に読む』声',
      counts: '・●● 3つ中2つ（『嫌われたかも』『迷惑をかけている』）',
      sentence: '声はちがっても、3つのうち2つは『人の気持ちを先に読む』声でした（『嫌われたかも』『迷惑をかけている』）。',
    },
  ],
  footer: '3つの場面から見えたことです。決まりではありません。',
  footerAdd: '場面を足すと、もっとはっきりするかもしれません。',
  teaser: '見つけたこと：『人の気持ちを先に読む』声がくり返していました',
  surprise: ['声はちがっても、同じ『人の気持ちを先に読む』声だったこと', 'その声が『嫌われないように』と守ろうとしていたこと', 'その声が『大事な人を困らせないように』と守ろうとしていたこと', '特になし（思ったとおり）'],
  tries: ['気になったら、思いこまずに1回だけ聞いてみる', 'その声がしたら、決めた言葉を自分にかけてみる', '頭の中の声に気づいたら、メモしてみる'],
  heavy: false,
  manual: {
    voice: [
      'しんどいとき、『人の気持ちを先に読む』声がしやすいようです（3つのうち2つ）。',
      '・『嫌われたかも』',
      '・『迷惑をかけている』',
      'その声は、『嫌われないように』『大事な人を困らせないように』と、守ろうとしているのかもしれません。',
      'そんなときに、自分にかけたい言葉',
      '・「頼ってもらえたら、うれしいよ」',
    ],
    try: ['・気になったら、思いこまずに1回だけ聞いてみる', '合わなければ、やめてOKです。'],
    surprise: ['・頭の中の声：『人の気持ちを先に読む』声'],
  },
};

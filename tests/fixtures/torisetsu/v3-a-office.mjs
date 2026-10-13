// 設計書 3-9 例A: 会社員・第1章（満たされるもの、足りないもの）。予想: 自分で決められること。
export const chapter = 'needs';
export const data = {
  prediction: ['nd_choose'],
  happy: [
    { scene: 'sc_friend', memo: '久しぶりに友だちと長電話', feelings: ['hf_relief'], needs: ['nd_understood', 'nd_belong'] },
    { scene: 'sc_work', memo: '企画が通った', feelings: ['hf_proud'], needs: ['nd_recognized', 'nd_choose'] },
  ],
  hard: [
    { scene: 'sc_work', memo: '会議で意見を流された', surface: 'sf_irritated', deep: ['dp_uncared', 'dp_anxious'], needs: ['nd_understood'] },
    { scene: 'sc_family', memo: '家の用事を全部やっていた', surface: 'sf_irritated', deep: ['dp_anxious', 'dp_full'], needs: ['nd_understood', 'nd_rest'] },
    { scene: 'sc_alone', memo: '休みの日、何もできなかった', surface: 'sf_down', deep: ['dp_small'], needs: ['nd_competent'] },
  ],
  surprise: 'x:nd_understood',
  experiment: 'try:l:sf_irritated:dp_anxious',
};
export const expected = {
  sceneLine: '出来事は、家族やパートナーのこと、友だちのこと、学校や仕事のこと、ひとりのときと、バラバラでした。でも、奥にはくり返し出てくるものがありました。',
  rows: [
    {
      band: 'しんどい時もうれしい時も',
      heading: '『わかってもらえること』',
      counts: 'しんどかった ●●・ 3つ中2つ｜うれしかった ●・ 2つ中1つ',
      sentence: 'しんどかった3つのうち2つで『わかってほしかった』、うれしかった2つのうち1つで『わかってもらえた』。足りないとしんどく、満たされるとうれしいものでした。',
    },
    {
      band: '表の気持ちの奥',
      heading: '『イライラ』の奥に『不安』',
      counts: 'イライラした ●● 2つとも',
      sentence: '『イライラした』出来事は2つとも、その奥に『不安』がありました。',
    },
  ],
  extra: [],
  footer: 'しんどかった3つ・うれしかった2つの答えから見えたことです。決まりではありません。',
  footerAdd: '出来事を足すと、もっとはっきりするかもしれません。',
  gapThought: '思っていた：自分で決められること',
  gap: '→ 少し当たり。1つの出来事にありました（しんどかった0・うれしかった1）。',
  actual: '実際は：いちばん多かったのは『わかってもらえること』でした（5つのうち3つ）。',
  surprise: ['『わかってもらえること』が、しんどい時にもうれしい時にもあったこと', '『イライラ』の奥に『不安』があったこと', '予想と違ったこと', '特になし（思ったとおり）'],
  tries: ['話す前に「聞いてほしいだけ」と伝えてみる', '『イライラ』に気づいたら、『奥に不安はある？』と自分に聞いてみる', 'うれしかったこと・しんどかったことを、また思い出してみる'],
  teaser: '見つけたこと：奥に『わかってもらえること』',
  manual: {
    fuel: ['・気持ちや事情を、わかってもらえること（足りないとしんどく、満たされるとうれしい）'],
    shaky: ['表に出ている気持ちの奥に、別の気持ちがあるようです。', '・『イライラ』の奥に『不安』', '表の気持ちの奥にあるものに、気づいてもらえると助かります。'],
    request: ['・アドバイスより先に、まず話を聞いてもらえると助かります。', 'いつも、ありがとう。'],
    try: ['・『イライラ』に気づいたら、『奥に不安はある？』と自分に聞いてみる', '合わなければ、やめてOKです。'],
    surprise: ['・満たされるもの：奥に『わかってもらえること』'],
  },
};

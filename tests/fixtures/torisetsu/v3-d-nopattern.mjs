// 設計書 3-9 例D（境界）: くり返しなし・第1章。
export const chapter = 'needs';
export const data = {
  prediction: [],
  happy: [
    { scene: 'sc_friend', memo: '', feelings: ['hf_glad'], needs: ['nd_belong'] },
    { scene: 'sc_alone', memo: '', feelings: ['hf_relax'], needs: ['nd_rest'] },
  ],
  hard: [
    { scene: 'sc_work', memo: '', surface: 'sf_rushed', deep: ['dp_expect'], needs: ['nd_competent'] },
    { scene: 'sc_family', memo: '', surface: 'sf_letdown', deep: ['dp_sad'], needs: ['nd_understood'] },
    { scene: 'sc_net', memo: '', surface: 'sf_foggy', deep: ['dp_behind'], needs: ['nd_belong'] },
  ],
};
export const expected = {
  title: '今回の答えでは、くり返し出てくるものは、まだはっきりしません。',
  body: '出来事ごとに、奥にある気持ちや願いがちがっていました。',
  near: '『ひとりじゃないと思えること』　しんどかった1つ・うれしかった1つ',
  list: '出てきた奥の気持ち：『置いていかれた感じ』『悲しさ』『期待に応えられない感じ』',
  teaser: '見つけたこと：まだはっきりしたくり返しはありません',
  surprise: ['出来事ごとに、奥のものがちがったこと', '特になし（思ったとおり）'],
  manual: {
    fuel: ['まだはっきりしませんが、候補です。', '・誰かとつながっていると感じられること'],
    shakyState: 'none',
    requestState: 'hidden',
  },
};

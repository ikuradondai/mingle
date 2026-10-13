// 設計書 3-9 例E（境界）: しんどい側だけ・第1章（うれしい側は 2 つとも「やめておく」）。
export const chapter = 'needs';
export const data = {
  prediction: [],
  happy: [],
  hard: [
    { scene: '', memo: '', surface: 'sf_rushed', deep: ['dp_expect', 'dp_anxious'], needs: ['nd_safe'] },
    { scene: '', memo: '', surface: 'sf_foggy', deep: ['dp_anxious'], needs: ['nd_choose'] },
    { scene: '', memo: '', surface: 'sf_rushed', deep: ['dp_expect'], needs: ['nd_safe', 'nd_rest'] },
  ],
};
export const expected = {
  rows: [
    { kind: 'LD', sentence: '『あせった』出来事は2つとも、その奥に『期待に応えられない感じ』がありました。' },
    { kind: 'D', sentence: 'しんどかった3つのうち2つで、その奥に『不安』がありました。' },
    { kind: 'H', sentence: 'しんどかった3つのうち2つで、本当の願いは『安心したかった』でした。' },
  ],
  footer: 'しんどかった3つの答えから見えたことです。決まりではありません。',
  footerAdd: '出来事を足すと、もっとはっきりするかもしれません。',
  sceneLine: '',
};

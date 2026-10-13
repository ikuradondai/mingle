// 設計書 4-6 例4（境界）: 共通点なし（第1章、2日 対 2日）。
const day = (who, where, doing, sleep, body, memo = '') => ({ who, where, doing, sleep, body, memo });
export const input = {
  prediction: [],
  good: [
    day(['who_alone'], ['where_home'], ['do_hobby'], 'sleep_ok', 'body_ok'),
    day(['who_friend'], ['where_town'], ['do_eat'], 'sleep_short', 'body_ok'),
  ],
  bad: [
    day(['who_friend'], ['where_town'], ['do_work'], 'sleep_ok', 'body_tired'),
    day(['who_alone'], ['where_home'], ['do_hobby'], 'sleep_good', 'body_ok'),
  ],
};
export const expected = {
  empty: true,
  nearMiss: '『おいしい物を食べた』　よかった日 1日／悪かった日 0日',
  footer: '2日ずつの答えから見えたことです。決まりではありません。',
  teaser: '見つけたこと：まだはっきりした共通点はありません',
};

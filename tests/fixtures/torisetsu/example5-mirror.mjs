// 予想と実際：予想「よく眠ること」が外れ、反対の「寝不足」が悪かった日に出ていた例（第1章）。
const day = (who, where, doing, sleep, body, memo = '') => ({ who, where, doing, sleep, body, memo });
export const input = {
  prediction: ['sleep_good'],
  good: [
    day(['who_friend'], ['where_town'], ['do_hobby'], 'sleep_ok', 'body_ok'),
    day(['who_family'], ['where_home'], ['do_rest'], 'sleep_ok', 'body_ok'),
    day(['who_mates'], ['where_work'], ['do_eat'], 'sleep_unknown', 'body_ok'),
  ],
  bad: [
    day(['who_alone'], ['where_home'], ['do_work'], 'sleep_short', 'body_ok'),
    day(['who_mates'], ['where_work'], ['do_chores'], 'sleep_short', 'body_ok'),
    day(['who_family'], ['where_town'], ['do_move'], 'sleep_ok', 'body_ok'),
  ],
};
export const expected = {
  verdict: 'mirror',
  gap: '→ 当たっていそう。調子が悪かった日に『前の晩が寝不足』が2日ありました（よかった日は0日）。',
};

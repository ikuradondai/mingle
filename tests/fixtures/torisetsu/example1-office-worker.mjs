// 設計書 4-6 例1: 会社員（第1章）。予想: おいしい物を食べること、よく眠ること。
const day = (who, where, doing, sleep, body, memo = '') => ({ who, where, doing, sleep, body, memo });
export const input = {
  prediction: ['do_eat', 'sleep_good'],
  good: [
    day(['who_friend'], ['where_town'], ['do_talk', 'do_eat'], 'sleep_ok', 'body_good', '土曜、友だちとランチ'),
    day(['who_mates'], ['where_work'], ['do_work', 'do_talk'], 'sleep_good', 'body_ok'),
    day(['who_family'], ['where_nature'], ['do_move', 'do_talk'], 'sleep_ok', 'body_good'),
  ],
  bad: [
    day(['who_alone'], ['where_home'], ['do_screen', 'do_rest'], 'sleep_short', 'body_tired'),
    day(['who_mates'], ['where_work'], ['do_work', 'do_rush'], 'sleep_short', 'body_tired'),
    day(['who_alone'], ['where_home'], ['do_chores', 'do_screen'], 'sleep_ok', 'body_ok'),
  ],
};
export const expected = {
  good: [
    '調子がよかった3日には、3日とも『ゆっくり話した』がありました。調子が悪かった日には、1日もありませんでした。',
  ],
  bad: [
    '調子が悪かった3日のうち2日に『前の晩が寝不足』がありました。調子がよかった日には、1日もありませんでした。',
    '調子が悪かった3日のうち2日に『スマホや動画を長く見た』がありました。調子がよかった日には、1日もありませんでした。',
    '調子が悪かった3日のうち2日に『一日家にいた』がありました。調子がよかった日には、1日もありませんでした。',
  ],
  extraGood: ['体が軽い'],
  extraBad: ['ひとりだった', '疲れていた・だるい'],
  footer: '3日ずつの答えから見えたことです。決まりではありません。',
  footerAdd: '日を足すと、もっとはっきりするかもしれません。',
  gap: [
    '→ 少し当たり。調子がよかった日に1日ありました（悪かった日は0日）。',
    '→ 当たっていそう。調子が悪かった日に『前の晩が寝不足』が2日ありました（よかった日は0日）。',
  ],
  actual: '実際は：調子がよかった日には『ゆっくり話した』がありました。',
  surprise: ['よかった日の『ゆっくり話した』', '悪かった日の『前の晩が寝不足』', '悪かった日の『スマホや動画を長く見た』', '悪かった日の『一日家にいた』', '予想と違ったこと', '特になし（思ったとおり）'],
  tries: [
    '誰かとゆっくり話す時間を、来週1回つくってみる',
    'いつもより30分早く寝る日を、1日つくってみる',
    '寝る前のスマホを、1日だけ早めに置いてみる',
    '家にいる日も、10分だけ外に出てみる',
    '調子のいい日・悪い日を、また3日ずつ思い出してみる',
  ],
  teaser: '見つけたこと：調子がよかった日に『ゆっくり話した』',
};

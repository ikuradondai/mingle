// 「自分のトリセツ」v2（気づき型）の中身。データだけ。ここから通信しない。
// 文は「部品」を組み立てて作る。日本語の活用はコードでしない（使う場面ごとの完成した形を持つ）。
// 自由文は「」で囲んでそのまま入れる。集計には使わない。「あなた」は使わない。主語は書かない。

export const TEXT_MAX = 30;
export const NAME_MAX = 12;
export const DAY_MIN = 2;
export const DAY_INIT = 3;
export const DAY_MAX = 5;

export const CHAPTERS = [
  {
    id: 'energy', label: '元気のもと', subtitle: '調子のいい日・悪い日を比べる', short: '元気のもと',
    sides: ['good', 'bad'], unit: 'day', init: 3, min: 2, max: 5,
    predict: { question: '自分は、何があると調子のいい日になると思う？', hint: '2つまで選べます', max: 2, footer: 'あとで、実際の答えと比べます。当たらなくて大丈夫です。', title: 'まず予想してみよう' },
    done: { title: '元気のもとができました', body: '調子のいい日と悪い日の違いが、トリセツに書き込まれました。' },
    again: { key: 'again', text: '調子のいい日・悪い日を、また3日ずつ思い出してみる' },
    teaserNone: 'まだはっきりした共通点はありません',
  },
  {
    id: 'values', label: '心が動くとき', subtitle: 'イラッと・うれしいの裏にあるもの', short: '心が動くとき',
    sides: ['neg', 'pos'], unit: 'episode', init: 2, min: 1, max: 3,
    predict: { question: '自分がいちばん大事にしていることは、何だと思う？', hint: '1つ選んでね', max: 1, footer: 'あとで、実際の答えと比べます。', title: 'まず予想してみよう' },
    done: { title: '心が動くときができました', body: '心が動く理由の「大事なこと」が、トリセツに書き込まれました。' },
    again: { key: 'again', text: '心が動いたことを、来週もう1つメモしてみる' },
  },
  {
    id: 'others', label: '人から見たわたし', subtitle: '頼まれること と 自分で思う得意', short: '人から見たわたし',
    sides: ['others'], unit: 'episode', init: 3, min: 2, max: 5,
    predict: { question: '自分で得意だと思うことは？', hint: '3つまで選べます', max: 3, footer: '', title: '' },
    done: { title: '人から見たわたしができました', body: '人から頼りにされている特長が、トリセツに書き込まれました。' },
    again: { key: 'again', text: '来週、人にお礼を言われたことをメモしてみる' },
  },
];
export const CHAPTER_IDS = CHAPTERS.map((chapter) => chapter.id);

// ---------- 第1章 元気のもと ----------
export const DAY_GROUPS = [
  { id: 'who', label: '誰といた？', max: 2 },
  { id: 'where', label: 'どこにいた？', max: 2 },
  { id: 'doing', label: '何をしていた？', max: 3 },
  { id: 'sleep', label: '前の晩は？', max: 1 },
  { id: 'body', label: '体の調子は？', max: 1 },
];

// [id, group, label, tag, power, lamp, tryMore, tryLess]。tag が空のものは「見つけたこと」に出さない（rep なし）。
const E = (id, group, label, tag, power = '', lamp = '', tryMore = '', tryLess = '') => ({ id, group, label, tag, power, lamp, tryMore, tryLess, rep: Boolean(tag), kind: 'chip' });

export const DAY_CHIPS = [
  E('who_alone', 'who', 'ひとり', 'ひとりだった', 'ひとりの時間をつくる', 'ずっとひとりだった日', 'ひとりの時間を、来週30分つくってみる', '誰かに1回、短い連絡をしてみる'),
  E('who_family', 'who', '家族・パートナー', '家族やパートナーといた', '家族やパートナーと過ごす', '家族やパートナーとずっと一緒の日', '家族やパートナーと過ごす時間を、来週1回つくってみる'),
  E('who_friend', 'who', '友だち', '友だちといた', '友だちと会う', '友だちと会った日', '友だちに、来週1回連絡してみる'),
  E('who_mates', 'who', '学校や仕事の人', '学校や仕事の人といた', '学校や仕事の人と過ごす', '学校や仕事の人とずっと一緒の日', '学校や仕事の人と、来週1回ゆっくり話してみる'),
  E('who_local', 'who', '近所・地域の人', '近所や地域の人といた', '近所や地域の人と過ごす', '近所や地域の人と過ごした日', '近所の人に、来週1回あいさつしてみる'),
  E('who_new', 'who', '初めて会った人', '初めて会う人がいた', '初めての人と会う', '初めての人と会った日', '初めての人と話せる場に、来週1回行ってみる'),
  E('who_pet', 'who', '動物・ペット', '動物と過ごした', '動物と過ごす', '動物と過ごした日', '動物と過ごす時間を、来週1回つくってみる'),
  E('where_home', 'where', '家', ''),
  E('where_work', 'where', '学校や職場', '学校や職場に行った', '学校や職場に行く', '学校や職場に行った日'),
  E('where_town', 'where', '街・お店', '街やお店に出かけた', '街やお店に出かける', '街やお店に出かけた日', '街やお店に、来週1回出かけてみる'),
  E('where_nature', 'where', '公園・自然の中', '公園や自然の中にいた', '公園や自然の中に行く', '公園や自然の中に行った日', '公園や自然の中に、来週1回行ってみる'),
  E('where_away', 'where', 'いつもと違う場所', 'いつもと違う場所に行った', 'いつもと違う場所に行く', 'いつもと違う場所に行った日', 'いつもと違う道や場所に、来週1回行ってみる'),
  E('do_work', 'doing', '勉強や仕事', '勉強や仕事をした', '勉強や仕事に打ち込む', '勉強や仕事が中心の日', '', '勉強や仕事の合間に、5分休んでみる'),
  E('do_chores', 'doing', '家事や用事', '家事や用事をした', '家事や用事を片付ける', '家事や用事が続いた日', '', '家事や用事を1つ、次の日に回してみる'),
  E('do_hobby', 'doing', '趣味・好きなこと', '趣味や好きなことをした', '趣味や好きなことをする', '趣味や好きなことをした日', '趣味や好きなことを、来週30分やってみる'),
  E('do_move', 'doing', '体を動かした', '体を動かした', '体を動かす', '体を動かした日', '体を動かす時間を、来週10分つくってみる'),
  E('do_rest', 'doing', 'のんびり休んだ', 'のんびり休んだ', 'のんびり休む', 'のんびり休んだ日', '何もしない時間を、来週30分つくってみる'),
  E('do_talk', 'doing', 'ゆっくり話した', 'ゆっくり話した', '誰かとゆっくり話す', 'ゆっくり話した日', '誰かとゆっくり話す時間を、来週1回つくってみる'),
  E('do_eat', 'doing', 'おいしい物を食べた', 'おいしい物を食べた', 'おいしい物を食べる', 'おいしい物を食べた日', '食べたい物を、来週1回ちゃんと食べてみる'),
  E('do_new', 'doing', '初めてのことをした', '初めてのことをした', '初めてのことをしてみる', '初めてのことをした日', '小さな初めてのことを、来週1つやってみる'),
  E('do_help', 'doing', '人の役に立った', '人の役に立った', '人の役に立つことをする', '人の役に立とうとした日', '誰かのために、小さなことを来週1つしてみる'),
  E('do_screen', 'doing', 'スマホや動画を長く見た', 'スマホや動画を長く見た', '', 'スマホや動画を長く見た日', '', '寝る前のスマホを、1日だけ早めに置いてみる'),
  E('do_rush', 'doing', '予定に追われた', '予定に追われた', '', '予定に追われた日', '', '予定のない時間を、1日30分つくってみる'),
  E('sleep_good', 'sleep', 'よく眠れた', '前の晩よく眠れた', '前の晩によく眠る', '前の晩によく眠れた日', 'いつもより30分早く寝る日を、1日つくってみる'),
  E('sleep_ok', 'sleep', 'ふつう', ''),
  E('sleep_short', 'sleep', '寝不足', '前の晩が寝不足', '', '前の晩が寝不足の日', '', 'いつもより30分早く寝る日を、1日つくってみる'),
  E('sleep_unknown', 'sleep', '覚えていない', ''),
  E('body_good', 'body', '体が軽い', '体が軽い', '', '体が軽い日'),
  E('body_ok', 'body', 'ふつう', ''),
  E('body_tired', 'body', '疲れていた・だるい', '疲れていた・だるい', '', '体が疲れている日', '', '疲れている日は、やることを1つ減らしてみる'),
];

const C = (id, group, tag, power, lamp, tryMore, tryLess, members) => ({ id, group, label: tag, tag, power, lamp, tryMore, tryLess, rep: true, kind: 'combo', members });
export const COMBO_FEATURES = [
  C('out', 'where', '外に出た', '外に出る', '外に出ていた日', '外に出る時間を、来週10分つくってみる', '', ['where_work', 'where_town', 'where_nature', 'where_away']),
  C('home_only', 'where', '一日家にいた', '家でゆっくり過ごす', '一日家にいた日', '家でゆっくり過ごす日を、来週1日つくってみる', '家にいる日も、10分だけ外に出てみる', []),
  C('people', 'who', '誰かと一緒だった', '誰かと一緒に過ごす', 'ずっと人と一緒だった日', '誰かと過ごす時間を、来週1回つくってみる', 'ひとりで過ごす時間を、30分つくってみる', ['who_family', 'who_friend', 'who_mates', 'who_local', 'who_new']),
];
// 打ち消し合うペア
export const OPPOSITES = [['out', 'home_only'], ['people', 'who_alone']];
// 予想の「反対」（予想が外れたとき、反対側が悪かった日に出ていないか見る）。本当に反対のものだけ。
export const MIRROR = { sleep_good: 'sleep_short', out: 'home_only', people: 'who_alone', who_alone: 'people' };
// 体の調子（体が軽い・疲れていた）は「調子」と同じことなので、帯には出さず「ほかに見えたこと」にまわす。
export const BODY_GROUP = 'body';

// 特徴（見つけたことの対象）のデータ順。誰と → どこ → 何を → 前の晩 → 体。組み立て特徴はそのグループの末尾。
export const ENERGY_FEATURES = [
  ...DAY_CHIPS.filter((chip) => chip.group === 'who' && chip.rep),
  COMBO_FEATURES[2],
  ...DAY_CHIPS.filter((chip) => chip.group === 'where' && chip.rep),
  COMBO_FEATURES[0], COMBO_FEATURES[1],
  ...DAY_CHIPS.filter((chip) => chip.group === 'doing'),
  ...DAY_CHIPS.filter((chip) => chip.group === 'sleep' && chip.rep),
  ...DAY_CHIPS.filter((chip) => chip.group === 'body' && chip.rep),
];
// 見つけたことの並べ替え用のグループ順（同点のとき）
export const INSIGHT_GROUP_ORDER = { sleep: 0, doing: 1, where: 2, who: 3, body: 4 };
// 「並べる」表の行の順
export const LINEUP_GROUP_ORDER = { doing: 0, who: 1, where: 2, sleep: 3, body: 4 };

export const ENERGY_PREDICTIONS = [
  { id: 'sleep_good', label: 'よく眠ること' }, { id: 'out', label: '外に出ること' },
  { id: 'people', label: '誰かと一緒にいること' }, { id: 'who_alone', label: 'ひとりの時間' },
  { id: 'do_move', label: '体を動かすこと' }, { id: 'do_hobby', label: '趣味・好きなこと' },
  { id: 'do_eat', label: 'おいしい物を食べること' }, { id: 'do_rest', label: 'のんびり休むこと' },
  { id: 'do_talk', label: 'ゆっくり話すこと' }, { id: 'do_new', label: '初めてのこと' },
  { id: 'do_help', label: '人の役に立つこと' }, { id: 'where_nature', label: '自然の中にいること' },
];

export const DAY_MEMO = { good: '例：土曜、友だちとランチ', bad: '例：月曜、朝から雨だった' };

// ---------- 第2章 心が動くとき ----------
const V = (id, label, request, tryMore) => ({ id, label, request, tryMore });
export const VALUES = [
  V('v_honest', '約束や正直さ', 'できない約束は、早めに言ってもらえると助かります。', '小さな約束を1つ決めて、守ってみる'),
  V('v_fair', '公平さ', '決めごとは、みんなに同じように説明してもらえると安心します。', 'みんなで決めるときに、全員の考えを聞いてみる'),
  V('v_respect', '気持ちを大切にされること', '気持ちを話したときは、まず受け止めてもらえるとうれしいです。', '自分の気持ちを、1回だけ言葉にして伝えてみる'),
  V('v_free', '自分で決めること', 'やり方は、できるだけ任せてもらえると力が出ます。', '1日の中に、自分で決める時間を30分つくってみる'),
  V('v_bond', '人と分かり合うこと', '話を最後まで聞いてもらえると、うれしいです。', '気になっている人に、自分から1回連絡してみる'),
  V('v_seen', 'がんばりを認められること', 'できたことに気づいてもらえると、がんばれます。', '自分のがんばりを、寝る前に1つ書き出してみる'),
  V('v_care', '人への優しさ', '困っている人がいたら、一緒に気にかけてもらえるとうれしいです。', '身近な人に、小さな親切を1つしてみる'),
  V('v_grow', 'できることが増えること', '新しいことに挑戦するときは、見守ってもらえると心強いです。', 'できるようになりたいことを、5分だけ練習してみる'),
  V('v_calm', '落ち着いて過ごせること', '予定や用事は、早めに教えてもらえると助かります。', '予定のない時間を、1日30分つくってみる'),
];
export const VALUE_PREDICTIONS = VALUES.map((value) => ({ id: value.id, label: value.label }));

const S = (id, label, value) => ({ id, label, value });
export const SITUATIONS = {
  neg: [
    S('n_promise', '約束を破られた', 'v_honest'), S('n_lie', 'うそやごまかしがあった', 'v_honest'),
    S('n_unfair', 'ずるい・不公平なことを見た', 'v_fair'), S('n_ignored', '話を聞いてもらえなかった', 'v_respect'),
    S('n_forced', 'やり方を押しつけられた', 'v_free'), S('n_unseen', 'がんばりに気づいてもらえなかった', 'v_seen'),
    S('n_mean', '誰かが雑に扱われていた', 'v_care'), S('n_rude', '失礼なことを言われた', 'v_respect'),
    S('n_rushed', '急かされた・予定を乱された', 'v_calm'), S('n_stuck', '思うように進まなかった', 'v_grow'),
    S('n_left', '仲間に入れてもらえなかった', 'v_bond'),
  ],
  pos: [
    S('p_thanks', 'お礼を言われた', 'v_seen'), S('p_understood', '気持ちを分かってもらえた', 'v_bond'),
    S('p_kind', '人の優しさを見た', 'v_care'), S('p_fair', 'ちゃんと公平に決まった', 'v_fair'),
    S('p_honest', '正直に話してもらえた', 'v_honest'), S('p_did', 'できなかったことができた', 'v_grow'),
    S('p_choose', '自分で決めて動けた', 'v_free'), S('p_together', 'みんなで何かをやりとげた', 'v_bond'),
    S('p_quiet', 'のんびり落ち着いて過ごせた', 'v_calm'), S('p_praised', 'がんばりをほめられた', 'v_seen'),
  ],
};
export const FEELINGS = {
  neg: [
    { id: 'f_irritated', label: 'イライラ' }, { id: 'f_disappointed', label: 'がっかり' }, { id: 'f_sad', label: '悲しい' },
    { id: 'f_frustrated', label: 'くやしい' }, { id: 'f_uneasy', label: 'モヤモヤ' }, { id: 'f_hurried', label: 'あせり' },
  ],
  pos: [
    { id: 'f_happy', label: 'うれしい' }, { id: 'f_relieved', label: 'ほっとした' }, { id: 'f_moved', label: 'じーんとした' },
    { id: 'f_excited', label: 'わくわく' }, { id: 'f_proud', label: '誇らしい' },
  ],
};
export const EPISODE_MEMO = { neg: '例：待ち合わせに来なかった', pos: '例：先生がほめてくれた', others: '例：友だちの進路の相談にのった' };

// ---------- 第3章 人から見たわたし ----------
const T = (id, label, tryMore, tryShow) => ({ id, label, tryMore, tryShow });
export const STRENGTHS = [
  T('s_listen', '話を聞くこと', '人の話を、最後までじっくり聞いてみる', '誰かの話を聞く時間を、来週1回つくってみる'),
  T('s_explain', '分かりやすく伝えること', '知っていることを、誰かに1つ教えてみる', '知っていることを、誰かに1つ教えてみる'),
  T('s_solve', '調べて解決すること', '困っている人の調べものを、1回手伝ってみる', '困っている人の調べものを、1回手伝ってみる'),
  T('s_make', '手を動かして作ること', '作った物を、誰かに1つ渡してみる', '何かを作る時間を、来週30分つくってみる'),
  T('s_organize', '段取りを決めること', '次の予定の段取りを、自分から決めてみる', '次の予定の段取りを、自分から決めてみる'),
  T('s_cheer', '場を明るくすること', '集まりで、自分から1回話しかけてみる', '集まりで、自分から1回話しかけてみる'),
  T('s_notice', '人の変化に気づくこと', '気になった人に、ひと言声をかけてみる', '気になった人に、ひと言声をかけてみる'),
  T('s_steady', '最後まで続けること', '続けていることを、来週も1回やってみる', '小さく続けることを、1つ決めてみる'),
  T('s_calm', '落ち着いて動くこと', '慌てている人のそばで、手伝いを申し出てみる', '慌てている人のそばで、手伝いを申し出てみる'),
  T('s_try', '新しいことに挑戦すること', '小さな新しいことを、来週1つやってみる', '小さな新しいことを、来週1つやってみる'),
];
export const TASKS = [
  { id: 't_listen', label: '話や相談を聞いた', strength: 's_listen' }, { id: 't_teach', label: 'やり方を教えた', strength: 's_explain' },
  { id: 't_write', label: '文章や連絡をまとめた', strength: 's_explain' }, { id: 't_fix', label: '調べた・直した', strength: 's_solve' },
  { id: 't_cook', label: '料理やおやつを作った', strength: 's_make' }, { id: 't_make', label: '物を作った・飾った', strength: 's_make' },
  { id: 't_plan', label: '予定や段取りを決めた', strength: 's_organize' }, { id: 't_tidy', label: '片付けや整理をした', strength: 's_organize' },
  { id: 't_mood', label: '場を盛り上げた', strength: 's_cheer' }, { id: 't_care', label: '元気がない人に声をかけた', strength: 's_notice' },
  { id: 't_finish', label: '最後までやりとげた', strength: 's_steady' }, { id: 't_steady', label: '困った場面で落ち着いて動いた', strength: 's_calm' },
  { id: 't_first', label: '最初にやってみせた', strength: 's_try' },
];
export const KINDS = [{ id: 'k_asked', label: '頼まれた' }, { id: 'k_thanked', label: 'お礼を言われた' }, { id: 'k_praised', label: 'ほめられた' }];
export const FROMS = [
  { id: 'w_family', label: '家族・パートナー' }, { id: 'w_friend', label: '友だち' }, { id: 'w_mates', label: '学校や仕事の人' },
  { id: 'w_local', label: '近所・地域の人' }, { id: 'w_other', label: 'その他' },
];

// 入力画面のグループ（1日／1出来事）。side で中身が変わるものは chips を関数にする。
export function episodeGroups(chapterId, side) {
  if (chapterId === 'energy') return DAY_GROUPS.map((group) => ({ ...group, required: true, chips: DAY_CHIPS.filter((chip) => chip.group === group.id).map(({ id, label }) => ({ id, label })) }));
  if (chapterId === 'values') {
    return [
      { id: 'situation', label: 'どんな出来事だった？', max: 1, required: true, chips: (SITUATIONS[side] || []).map(({ id, label }) => ({ id, label })) },
      { id: 'feeling', label: 'そのときの気持ちに、いちばん近いのは？', max: 1, required: true, chips: FEELINGS[side] || [] },
    ];
  }
  return [
    { id: 'kind', label: 'どれに近い？', max: 1, required: true, chips: KINDS },
    { id: 'task', label: 'どんなこと？', max: 1, required: true, chips: TASKS.map(({ id, label }) => ({ id, label })) },
    { id: 'who', label: '誰から？', max: 1, required: false, optionalNote: 'なくてOK', chips: FROMS },
  ];
}

// ---------- 画面に出す固定文 ----------
export const STEP_LABELS = ['予想', '思い出す', '並べる', '見つける', 'ためす'];
export const STEP_LABELS_OTHERS = ['自分で思う', '思い出す', '並べる', '見つける', 'ためす'];

export const SIDE_COPY = {
  good: { label: '調子がよかった日', short: 'よかった日', unitName: '日', noun: '日', color: 'good' },
  bad: { label: '調子が悪かった日', short: '悪かった日', unitName: '日', noun: '日', color: 'bad' },
  neg: { label: 'イラッと・がっかり', short: 'イラッと・がっかり', unitName: '出来事', noun: 'つ', color: 'bad' },
  pos: { label: 'うれしい・じーんと', short: 'うれしい・じーんと', unitName: '出来事', noun: 'つ', color: 'good' },
  others: { label: '人から頼まれた・お礼を言われたこと', short: '人から', unitName: '出来事', noun: 'つ', color: 'good' },
};

export const INTRO = {
  good: { title: '調子がよかった日を3日、思い出そう', lines: ['この1〜2週間で「いい感じだったな」という日です。', 'すごくいい日でなくても大丈夫。だいたいで選んでね。'], button: '1日目を思い出す' },
  bad: { title: '次は、調子が悪かった日を3日、思い出そう', lines: ['「なんだかうまくいかなかったな」という日です。', '自分を責めるためではなく、比べるために思い出します。'], button: '1日目を思い出す' },
  neg: { title: '最近、イラッとしたり、がっかりしたりした出来事を2つ思い出そう', lines: ['大きなことでなくて大丈夫。「ちょっとモヤッとした」くらいでOKです。', '思い出すのがつらいことは、選ばなくて大丈夫です。'], button: '1つ目を思い出す' },
  pos: { title: '次は、うれしかったり、じーんとしたりした出来事を2つ思い出そう', lines: ['小さなことで大丈夫です。'], button: '1つ目を思い出す' },
  others: { title: '最近、人から頼まれたこと・お礼を言われたこと・ほめられたことを3つ思い出そう', lines: ['家族や友だち、学校や仕事、近所の人など、誰からでもOKです。', '小さなことで大丈夫です。'], button: '1つ目を思い出す' },
};

export const COPY = {
  appTitle: 'わたしのトリセツ',
  deckSubtitle: '思い出して並べると、自分が見えてくる',
  deckDescription: '最近の調子のいい日・悪い日や、心が動いた出来事を思い出して並べ、自分の共通点を見つけます。見つけたことから、自分の取扱説明書を作ります。',
  cardMeta: '3つの章',
  startTitle: 'わたしのトリセツを作ろう',
  startLead: '最近あったことを思い出して並べると、自分では気づいていなかった「自分の動かし方」が見えてきます。見つけたことから、自分の取扱説明書を作ります。',
  privacyTitle: 'ここに書いたことは、どこにも送られません。',
  privacyBody: 'この画面を閉じると消えます。章を1つ書き終えると、この端末に残すかどうか選べます。',
  startGuide: '目安：1つの章が3〜5分。どの章からでも始められます。',
  begin: '作り始める',
  noticeMigrated: 'トリセツの作り方が新しくなりました。前のトリセツから「製品名」と「元気になるスイッチ」を引き継ぎました。ほかの欄は、新しい作り方で書き直してね。',
  noticeDiscarded: 'トリセツの作り方が新しくなりました。前のトリセツの答えは新しい作り方では使えないため、この端末から消しました。',
  savedTitle: '前に作ったトリセツがあります',
  viewManual: 'トリセツを見る',
  continueEdit: '続きを書く・見直す',
  deviceOnly: 'この端末の中だけに保存しています。他の人と使う端末では残さないでね。',
  deleteManual: 'このトリセツを消す',
  contentsTitle: 'わたしのトリセツ',
  progressLabel: (n) => `3章中${n}章できた`,
  allDone: '3章すべてできた！',
  chapterStart: 'はじめる',
  chapterContinue: '続ける',
  chapterReview: '見直す',
  chapterDoneMark: 'できた',
  teaserPrefix: '見つけたこと：',
  predictNext: '次へ',
  predictFromV1: '前のトリセツで選んでいたものを入れています。変えてもOK。',
  limitMessage: (n) => `${n}つまでです。どれかを外すと選べます。`,
  memoLabel: 'ひとことメモ（なくてOK）',
  memoCount: (n, max) => `${n}/${max}字`,
  recordDay: 'この日を記録する',
  recordEpisode: 'この出来事を記録する',
  recordOther: 'これを記録する',
  skipItem: '思い出せないので飛ばす',
  missingGroups: (names) => `選んでいないところがあります：${names.join('、')}`,
  dayHeading: (side, n, total) => (total ? `${n}日目（${total}日中）` : `${n}日目`),
  episodeHeading: (n, total) => (total ? `${n}つ目（${total}つ中）` : `${n}つ目`),
  deleteItem: 'これを消す',
  deleteDay: 'この日を消す',
  shortTitleEnergy: '比べるには、2日以上あると安心です。少し前の日でも大丈夫です。',
  shortTitleValues: 'イラッとした出来事とうれしかった出来事を、どちらも1つ以上、合わせて3つ以上思い出すと見つけやすくなります。',
  shortTitleOthers: '見つけるには、出来事が2つ以上あると安心です。小さなことでも大丈夫です。',
  addMoreDay: 'もう1日思い出す',
  addMoreEpisode: 'もう1つ思い出す',
  later: 'あとにする（目次へ）',
  lineupTitle: '並べてみよう',
  lineupLeadEnergy: '思い出した日を、横に並べました。',
  lineupLeadValues: '出来事の裏にありそうな「大事なこと」を、横に書きました。',
  lineupLeadOthers: '自分で思うことと、人から頼まれたことを並べました。',
  lineupNoteValues: '「→」の先は、ちがうと思ったら押して変えられます。',
  lineupAsk: '自分でも、何か気づくことはある？',
  findCommon: '共通点を探す',
  lineupYes: 'あり', lineupNo: 'なし',
  lineupGood: 'よかった日', lineupBad: '悪かった日', lineupSelf: '自分で思う', lineupOthers: '人から',
  lineupMemo: 'メモ',
  changeValue: '大事なことを選び直す',
  nameEmpty: '名前をつけると、ここに出ます。',
  insightTitle: '見つけたこと',
  insightIntro: '今回の答えでは──',
  insightNoneTitle: '今回の答えでは、はっきりした共通点はまだ見えません。',
  insightNoneBody: 'よかった日と悪かった日に、同じくらいいろいろなことがありました。もう少し日を足すと、見えてくるかもしれません。',
  insightNoneValuesTitle: '今回は、出来事ごとに違う「大事なこと」が出てきました。',
  insightNoneValuesBody: 'どれも、大事にしていることの候補です。出来事を足すと、重なりが見えてくるかもしれません。',
  nearMissTitle: '少しだけ多かったもの：',
  bandGood: '調子がよかった日に多かったこと',
  bandBad: '調子が悪かった日に多かったこと',
  bandGoodA: 'よかった日にあって、悪かった日にはなかったこと',
  bandBadA: '悪かった日にあって、よかった日にはなかったこと',
  lineupOneDay: (n) => `1日だけ出たこと（${n}）`,
  compareLine: (nG, nB) => `よかった日${nG}日と、悪かった日${nB}日を比べました。`,
  extraEnergy: 'ほかに見えたこと：',
  insightFootShort: '決まりではありません。',
  bandNeg: 'イラッと・がっかりの裏にあること',
  bandPos: 'うれしさの裏にあること',
  bandOthersOnly: '自分では選ばなかったけれど、人から頼りにされていたこと',
  bandBoth: '自分でも思っていて、人からも',
  bandSelfOnly: '今回の出来事には出てこなかった得意',
  compareGap: '予想と比べる',
  nextButton: '次へ',
  fixDays: '日を直す・足す',
  fixEpisodes: '出来事を直す・足す',
  addGood: '調子がよかった日を足す',
  addBad: '調子が悪かった日を足す',
  addNeg: 'イラッとした出来事を足す',
  addPos: 'うれしかった出来事を足す',
  goOn: 'このまま進む',
  gapTitle: '予想と比べてみよう',
  gapThought: (label) => `思っていた：${label}`,
  daysTitleEnergy: '思い出した日',
  daysTitleValues: '思い出した出来事',
  daysTitleOthers: '思い出した出来事',
  fixOne: '直す',
  addOneDay: '＋ もう1日足す',
  addOneEpisode: '＋ もう1つ足す',
  backToInsight: '見つけたことに戻る',
  surpriseTitle: 'いちばん意外だったことは？',
  surpriseHint: '1つ選んでね',
  surpriseNone: '特になし（思ったとおり）',
  surpriseGap: '予想と違ったこと',
  surpriseSpread: '出来事ごとに違ったこと',
  surpriseSelf: '自分だけの得意があったこと',
  surprisePlaceholder: '例：話すだけで変わるなんて',
  tryTitle: '来週ためしてみること',
  tryHint: '見つけたことから、1つだけ選んでみよう',
  tryFooter: 'ためしてみて、合わなければやめてOKです。',
  tryPlaceholder: '例：月曜の朝は散歩する',
  tryWrite: 'トリセツに書く',
  tryWriteNone: '今は決めずにトリセツに書く',
  freeWrite: '自分で書く',
  freeCount: (n) => `${n}/30字`,
  toContents: '目次に戻る',
  doneCheck: (title) => `${title}`,
  doneNext: (label) => `次は「${label}」へ`,
  doneManualLead: 'この章で書き込まれた部分',
  saveCardTitle: 'この端末に残す？',
  saveCardBody1: '残さなければ、この画面を閉じたときに消えます。',
  saveCardBody2: '残すと、次に開いたときも見られます（この端末の中だけ）。',
  saveLocked: '章を1つ書き終えると、この端末に残せます。',
  saveYes: 'この端末に残す',
  saveNo: '残さない',
  savedDone: 'この端末に残しました。この端末の中だけに保存しています。他の人と使う端末では残さないでね。',
  saving: 'この端末に保存中',
  saveFailed: 'この端末には保存できませんでした。スクリーンショットか「画像を保存」で残してね。',
  manualAuthor: '今回の答えから作りました',
  nameButton: '製品名をつける',
  nameLabel: '製品名（あだ名でもOK）',
  namePlaceholder: '例：のんびり号',
  nameDone: '決める',
  noName: 'わたしの取扱説明書',
  todoBox: 'まだ調べていません',
  todoButton: '調べる',
  noneBox: '今回はまだ見えませんでした。日を足すと、ここに書き込まれます。',
  noneButton: '足す',
  editSection: '直す',
  shareNote: 'スクリーンショットで残しておくと、いつでも見返せます。',
  makeImage: '画像を保存',
  sendImage: '送る',
  sendHint: '写真に保存するときは「送る」から「画像を保存」を選んでね。',
  imageMaking: '画像を作っています…',
  imageFailed: '画像を作れませんでした。スクリーンショットで残してね。',
  warranty: '本製品は、ときどき休ませると長持ちします。',
  deletedToast: 'トリセツを消しました。',
  undo: '元に戻す',
  leaveTitle: 'まだ残していません。閉じると、書いた内容は消えます。',
  leaveTitleLoss: '閉じると、ここまで書いたことは消えます。',
  leaveContinue: '続ける',
  leaveClose: '閉じる',
  leaveKeep: '戻って残す',
  imageRest: '続きは、また今度。',
  back: '戻る',
};

// トリセツの欄（番号と順番は固定）
export const MANUAL_SECTIONS = [
  { id: 'power', chapterId: 'energy', title: '電源の入れ方', icon: 'power' },
  { id: 'warning', chapterId: 'energy', title: '警告ランプ', icon: 'lamp' },
  { id: 'values', chapterId: 'values', title: '大事にしていること', icon: 'star' },
  { id: 'request', chapterId: 'values', title: '周りの人へのお願い', icon: 'bubble' },
  { id: 'strengths', chapterId: 'others', title: '本製品の特長', icon: 'hand' },
  { id: 'try', chapterId: null, title: '来週ためしてみること', icon: 'wrench' },
  { id: 'surprise', chapterId: null, title: 'いちばん意外だったこと', icon: 'drop' },
];

// 組み立ての固定文
export const MANUAL_COPY = {
  powerOutro: '今回の答えでは、調子がよかった日にこれがありました。',
  powerNoPower: (tag) => `今回の答えでは、調子がよかった日は『${tag}』でした。`,
  noneLine: '今回はまだ見えませんでした。',
  warningIntro: 'こんな日は、調子が下がりやすいようです。',
  warningOutro: 'そんな日は、早めに休ませてあげてください。',
  valuesCandidates: '大事にしていることの候補です。',
  valuesBoth: 'これが守られないと心が波立ち、守られるとうれしくなるようです。',
  valuesNeg: 'これが守られないと、心が波立ちやすいようです。',
  valuesPos: 'これがあると、うれしくなるようです。',
  requestOutro: 'いつも、ありがとう。',
  strengthsAndSelf: (label) => `${label}（自分でも人からも）`,
  strengthsOthers: (label, phrase = '頼りにされています') => `${label}（人から${phrase}）`,
  strengthsWaiting: 'まだ出番を待っている特長',
  tryOutro: '合わなければ、やめてOKです。',
  surpriseNone: '思ったとおりだった',
};

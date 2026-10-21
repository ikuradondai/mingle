// 「自分のトリセツ」v3（内面をたどる型）の中身。データだけ。ここから通信しない。
// 文は「部品」を組み立てて作る。日本語の活用はコードでしない（使う場面ごとの完成した形を持つ）。
// 自由文は「」で囲んでそのまま入れる。集計には使わない。「あなた」は使わない。主語は書かない。

export const TEXT_MAX = 30;
export const NAME_MAX = 12;

export const CHAPTERS = [
  {
    id: 'needs', label: '満たされるもの、足りないもの', subtitle: '出来事の奥にある気持ちをたどる', short: '満たされるもの',
    sides: ['happy', 'hard'], inits: { happy: 2, hard: 3 }, maxes: { happy: 3, hard: 5 }, min: 3,
    predict: { question: '自分にとって、いちばん大事なのはどれだと思う？', hint: '1つ選んでね', max: 1, footer: 'あとで、実際の答えと比べます。当たらなくて大丈夫です。', title: 'まず予想してみよう' },
    done: { title: '満たされるもの、足りないものができました', body: '奥でくり返していたものが、トリセツに書き込まれました。' },
    again: { key: 'again', text: 'うれしかったこと・しんどかったことを、また思い出してみる' },
    teaserNone: 'まだはっきりしたくり返しはありません',
  },
  {
    id: 'voice', label: '頭の中の声', subtitle: 'しんどいときの声と、かけたい言葉', short: '頭の中の声',
    sides: ['voice'], inits: { voice: 3 }, maxes: { voice: 5 }, min: 2,
    predict: null,
    done: { title: '頭の中の声ができました', body: '頭の中の声と、かけたい言葉が、トリセツに書き込まれました。' },
    again: { key: 'again', text: '頭の中の声に気づいたら、メモしてみる' },
    teaserNone: '場面ごとにちがう声がしていました',
  },
  {
    id: 'values', label: '心が動くとき', subtitle: 'イラッと・じーんの裏にある大事なこと', short: '心が動くとき',
    sides: ['neg', 'pos'], inits: { neg: 2, pos: 2 }, maxes: { neg: 3, pos: 3 }, min: 3,
    predict: { question: '自分がいちばん大事にしていることは、何だと思う？', hint: '1つ選んでね', max: 1, footer: 'あとで、実際の答えと比べます。', title: 'まず予想してみよう' },
    done: { title: '心が動くときができました', body: '大事にしていることが、トリセツに書き込まれました。' },
    again: { key: 'again', text: '心が動いたことを、来週もう1つメモしてみる' },
  },
];
export const CHAPTER_IDS = CHAPTERS.map((chapter) => chapter.id);

// ---------- 共通: 場面（1つ。集計しない） ----------
export const SCENES = [
  { id: 'sc_family', label: '家族やパートナーのこと', short: '家族やパートナーのこと' },
  { id: 'sc_friend', label: '友だちのこと', short: '友だちのこと' },
  { id: 'sc_work', label: '学校や仕事のこと', short: '学校や仕事のこと' },
  { id: 'sc_local', label: '近所や地域のこと', short: '近所や地域のこと' },
  { id: 'sc_alone', label: 'ひとりのとき', short: 'ひとりのとき' },
  { id: 'sc_health', label: '体や健康のこと', short: '体や健康のこと' },
  { id: 'sc_chores', label: '家事やお金・用事のこと', short: '家事やお金・用事のこと' },
  { id: 'sc_net', label: 'ネットやSNSのこと', short: 'ネットやSNSのこと' },
  { id: 'sc_other', label: 'そのほか', short: 'そのほかのこと' },
];

// ---------- 第1章 満たされるもの、足りないもの ----------
// 表の気持ち・しんどい側（1つ。集計は「表と奥」のつながりにだけ使う）
const sf = (id, label, tag) => ({ id, label, tag });
export const SURFACE_HARD = [
  sf('sf_irritated', 'イライラした', 'イライラ'),
  sf('sf_down', '落ち込んだ', '落ち込み'),
  sf('sf_rushed', 'あせった', 'あせり'),
  sf('sf_foggy', 'モヤモヤした', 'モヤモヤ'),
  sf('sf_letdown', 'がっかりした', 'がっかり'),
  sf('sf_drained', 'ぐったりした', 'ぐったり'),
  sf('sf_awkward', '気まずかった', '気まずさ'),
  sf('sf_frozen', '固まって、何も言えなかった', '固まってしまう感じ'),
  sf('sf_quit', '投げ出したくなった', '投げ出したい気持ち'),
];

// 奥の気持ち・しんどい側（2つまで。集計する）
const dp = (id, label, tag) => ({ id, label, tag });
export const DEEP = [
  dp('dp_anxious', '不安・こわかった', '不安'),
  dp('dp_lonely', 'さびしかった', 'さびしさ'),
  dp('dp_behind', '置いていかれた感じ', '置いていかれた感じ'),
  dp('dp_sad', '悲しかった', '悲しさ'),
  dp('dp_bitter', 'くやしかった', 'くやしさ'),
  dp('dp_small', '自分が小さく感じた', '自分が小さく感じる気持ち'),
  dp('dp_expect', '期待に応えられない感じ', '期待に応えられない感じ'),
  dp('dp_blamed', '責められている感じ', '責められている感じ'),
  dp('dp_uncared', '大事にされていない感じ', '大事にされていない感じ'),
  dp('dp_guilty', '申し訳ない気持ち', '申し訳なさ'),
  dp('dp_full', 'いっぱいいっぱいだった', 'いっぱいいっぱいな気持ち'),
  dp('dp_empty', 'むなしかった', 'むなしさ'),
];

// 気持ち・うれしい側（2つまで。集計しない）
export const SURFACE_HAPPY = [
  { id: 'hf_glad', label: 'うれしかった' },
  { id: 'hf_relief', label: 'ほっとした' },
  { id: 'hf_relax', label: '力が抜けて、安心した' },
  { id: 'hf_warm', label: '胸があたたかくなった' },
  { id: 'hf_proud', label: '誇らしかった' },
  { id: 'hf_excited', label: 'わくわくした' },
  { id: 'hf_clear', label: 'すっきりした' },
  { id: 'hf_likeself', label: '自分を少し好きになれた' },
];

// 本当の願い（各側2つまで。両側を同じ id で集計する）
const nd = (id, wish, met, tag, fuel, request, tryText) => ({ id, wish, met, tag, label: tag, fuel, request, try: tryText });
export const NEEDS = [
  nd('nd_understood', 'わかってほしかった', 'わかってもらえた', 'わかってもらえること', '気持ちや事情を、わかってもらえること', 'アドバイスより先に、まず話を聞いてもらえると助かります。', '話す前に「聞いてほしいだけ」と伝えてみる'),
  nd('nd_speak', '本音を言いたかった', '本音を言えた', '本音を言えること', '思っていることを、そのまま言えること', '言いかけたときは、最後まで待ってもらえると話せます。', '小さな本音を1つ、言葉にしてみる'),
  nd('nd_respect', '大切に扱われたかった', '大切に扱われた', '大切に扱われること', '一人の人として、大切に扱われること', '急いでいるときも、ひと言そえてもらえるとうれしいです。', '自分にも、ていねいな言葉をかけてみる'),
  nd('nd_recognized', '認めてほしかった', '認めてもらえた', '認めてもらえること', 'がんばりや、できたことを認めてもらえること', 'できたことに気づいたら、ひと言もらえるとがんばれます。', '寝る前に、今日できたことを1つ書いてみる'),
  nd('nd_belong', 'ひとりじゃないと思いたかった', 'ひとりじゃないと思えた', 'ひとりじゃないと思えること', '誰かとつながっていると感じられること', 'ときどき声をかけてもらえると、ほっとします。', '気になる人に、短い連絡を1回してみる'),
  nd('nd_useful', '役に立ちたかった', '役に立てた', '役に立てること', '誰かの役に立てていると感じられること', '手伝えることがあれば、声をかけてもらえるとうれしいです。', '誰かのために、小さなことを1つしてみる'),
  nd('nd_competent', 'ちゃんとできたと思いたかった', 'ちゃんとできた', 'ちゃんとできた手ごたえ', '自分の力で、ちゃんとやれたと思えること', '任せたことは、最後まで見守ってもらえると力が出ます。', '15分で終わることを、1つやりきってみる'),
  nd('nd_choose', '自分で決めたかった', '自分で決められた', '自分で決められること', 'やり方やペースを、自分で決められること', 'やり方は、できるだけ任せてもらえると力が出ます。', '1日の中で、自分で決める時間を30分つくる'),
  nd('nd_rest', 'ひと息つきたかった', 'ひと息つけた', 'ひと息つける時間', '何もしなくていい時間があること', '疲れて見えるときは、そっとしておいてもらえると助かります。', '予定のない時間を、30分だけつくってみる'),
  nd('nd_safe', '安心したかった', '安心できた', '安心できること', '先が見えて、安心していられること', '予定や変更は、早めに教えてもらえると助かります。', '心配なことを1つ、紙に書き出してみる'),
  nd('nd_grow', '前に進みたかった', '前に進めた', '前に進めている感じ', '少しずつでも、前に進めていると感じられること', '新しいことをするときは、見守ってもらえると心強いです。', 'できるようになりたいことを、5分だけやってみる'),
  nd('nd_cared', '大事な人に笑っていてほしかった', '大事な人が笑っていた', '大事な人が元気でいること', '大事な人が、元気で笑っていること', '困ったときは、ひとりで抱えずに話してもらえると安心します。', '大事な人に「元気？」と1回聞いてみる'),
];
export const NEED_PREDICTIONS = NEEDS.map((need) => ({ id: need.id, label: need.tag }));

// 第1章の層（1層1画面）。side ごとの並び。group は draft のキー、max は選べる数。
export const LAYERS = {
  hard: [
    { id: 'scene', depth: '出来事', title: '何があった？', groups: ['scene'] },
    { id: 'surface', depth: '表の気持ち', title: 'そのとき、表に出た気持ちは？', hint: 'いちばん近いものを1つ', groups: ['surface'] },
    { id: 'deep', depth: '奥の気持ち', title: (picked) => (picked ? `『${picked}』の、もう少し奥には？` : 'そのときの気持ちの、もう少し奥には？'), lead: '表の気持ちの下に、別の気持ちがかくれていることがあります。', groups: ['deep'] },
    { id: 'needs', depth: '本当は', title: '本当は、どうなってほしかった？', groups: ['needs'] },
  ],
  happy: [
    { id: 'scene', depth: '出来事', title: '何があった？', groups: ['scene'] },
    { id: 'feelings', depth: '気持ち', title: 'そのときの気持ちは？', groups: ['feelings'] },
    { id: 'needs', depth: '満たされたもの', title: 'そのとき、何が満たされていた？', groups: ['needs'] },
  ],
};

// ---------- 第2章 頭の中の声 ----------
const PT = (id, name, tryText) => ({ id, name, try: tryText });
export const PATTERNS = [
  PT('pt_blame', '自分を責める', 'うまくいかなかったとき、自分のせいじゃない理由も1つ書いてみる'),
  PT('pt_worry', '先を悪く読む', '心配が浮かんだら、いちばんありそうなことも考えてみる'),
  PT('pt_read', '人の気持ちを先に読む', '気になったら、思いこまずに1回だけ聞いてみる'),
  PT('pt_must', '「〜しなきゃ」でしばる', '「しなきゃ」を1つ、「できたらいいな」に言いかえてみる'),
  PT('pt_compare', '人と比べる', '人と比べたら、前の自分とも比べてみる'),
  PT('pt_alone', 'ひとりで抱える', 'しんどいことを1つ、誰かに短く話してみる'),
];
const TH = (id, label, pattern) => ({ id, label, pattern });
export const THOUGHTS = [
  TH('th_nogood', '自分はダメだ', 'pt_blame'),
  TH('th_myfault', '自分のせいだ', 'pt_blame'),
  TH('th_hopeless', 'どうせうまくいかない', 'pt_worry'),
  TH('th_end', '失敗したら終わりだ', 'pt_worry'),
  TH('th_disliked', '嫌われたかも', 'pt_read'),
  TH('th_burden', '迷惑をかけている', 'pt_read'),
  TH('th_must', 'ちゃんとしなきゃ', 'pt_must'),
  TH('th_cantsay', '断ったら悪い', 'pt_must'),
  TH('th_others', 'みんなはできているのに', 'pt_compare'),
  TH('th_fake', '本当はできないのがバレる', 'pt_compare'),
  TH('th_noweak', '弱音ははけない', 'pt_alone'),
  TH('th_nobody', '誰もわかってくれない', 'pt_alone'),
];
const RP = (id, pattern, label) => ({ id, pattern, label });
export const REPLIES = [
  RP('rp_blame1', 'pt_blame', 'それだけ真剣だったんだね'),
  RP('rp_blame2', 'pt_blame', '全部が自分のせいじゃないよ'),
  RP('rp_worry1', 'pt_worry', 'やってみないと、わからないよ'),
  RP('rp_worry2', 'pt_worry', 'うまくいかなくても、終わりじゃないよ'),
  RP('rp_read1', 'pt_read', '聞いてみないと、わからないよ'),
  RP('rp_read2', 'pt_read', '頼ってもらえたら、うれしいよ'),
  RP('rp_must1', 'pt_must', '今日はここまでで十分だよ'),
  RP('rp_must2', 'pt_must', '断っても、大事な人は離れないよ'),
  RP('rp_compare1', 'pt_compare', '人は人。自分のペースでいいよ'),
  RP('rp_compare2', 'pt_compare', 'できていることも、ちゃんとあるよ'),
  RP('rp_alone1', 'pt_alone', 'しんどいって、言っていいんだよ'),
  RP('rp_alone2', 'pt_alone', '話してくれて、うれしいよ'),
  RP('rp_any1', '', 'よくやってるよ'),
  RP('rp_any2', '', '少し休もうよ'),
];
const IN = (id, label) => ({ id, label });
export const INTENTS = [
  IN('in_fail', '失敗しないように'),
  IN('in_disliked', '嫌われないように'),
  IN('in_shame', '恥をかかないように'),
  IN('in_ready', 'がっかりする前に、心の準備をさせる'),
  IN('in_push', '手を抜かないように、背中を押す'),
  IN('in_duty', '大事な役目を果たせるように'),
  IN('in_others', '大事な人を困らせないように'),
  IN('in_stop', 'これ以上がんばりすぎないように'),
];

// ---------- 第3章 心が動くとき ----------
const V = (id, label, tryMore) => ({ id, label, tryMore });
export const VALUES = [
  V('vl_honest', '正直さ・約束', '小さな約束を1つ決めて、守ってみる'),
  V('vl_fair', '公平さ', 'みんなで決めるときに、全員の考えを聞いてみる'),
  V('vl_kind', 'やさしさ', '身近な人に、小さな親切を1つしてみる'),
  V('vl_respect', '一人ひとりを大切にすること', '話す番が少ない人に、1回声をかけてみる'),
  V('vl_free', '自分で選ぶこと', '1日の中に、自分で選ぶ時間を30分つくってみる'),
  V('vl_bond', '分かり合うこと', '気になっている人と、ゆっくり話してみる'),
  V('vl_grow', '成長すること', 'できるようになりたいことを、5分だけ練習してみる'),
  V('vl_effort', 'こつこつ努力すること', '続けたいことを、来週も1回やってみる'),
  V('vl_calm', '落ち着いた暮らし', '予定のない時間を、1日30分つくってみる'),
  V('vl_true', '自分らしさ', '合わせすぎた場面で、1回だけ本音を言ってみる'),
  V('vl_contrib', '人の役に立つこと', '誰かのために、小さなことを1つしてみる'),
];
export const VALUE_PREDICTIONS = VALUES.map((value) => ({ id: value.id, label: value.label }));

const S = (id, label, value) => ({ id, label, value });
export const SITUATIONS = {
  neg: [
    S('sn_promise', '約束を破られた', 'vl_honest'), S('sn_lie', 'うそやごまかしがあった', 'vl_honest'),
    S('sn_unfair', 'ずるい・不公平なことを見た', 'vl_fair'), S('sn_mean', '誰かが雑に扱われていた', 'vl_respect'),
    S('sn_cold', '困っている人が放っておかれていた', 'vl_kind'), S('sn_forced', 'やり方を押しつけられた', 'vl_free'),
    S('sn_nottalk', '話が通じなかった', 'vl_bond'), S('sn_lazy', '手を抜いている人を見た', 'vl_effort'),
    S('sn_stuck', '思うように成長できなかった', 'vl_grow'), S('sn_rushed', 'せかされて、落ち着けなかった', 'vl_calm'),
    S('sn_fitin', '自分を出せず、合わせすぎた', 'vl_true'), S('sn_useless', '役に立てなかった', 'vl_contrib'),
  ],
  pos: [
    S('sp_honest', '正直に話してもらえた', 'vl_honest'), S('sp_fair', 'ちゃんと公平に決まった', 'vl_fair'),
    S('sp_kind', '人のやさしさを見た', 'vl_kind'), S('sp_respect', '一人ひとりが大事にされていた', 'vl_respect'),
    S('sp_choose', '自分で決めて動けた', 'vl_free'), S('sp_understood', '気持ちが通じた', 'vl_bond'),
    S('sp_effort', '努力が実った', 'vl_effort'), S('sp_did', 'できなかったことができた', 'vl_grow'),
    S('sp_quiet', '落ち着いて、ていねいに過ごせた', 'vl_calm'), S('sp_self', '自分らしくいられた', 'vl_true'),
    S('sp_helped', '人の役に立てた', 'vl_contrib'),
  ],
};
export const ADMIRE_WHO = [
  { id: 'aw_near', label: '身近な人' }, { id: 'aw_mates', label: '学校や職場の人' },
  { id: 'aw_famous', label: '有名な人' }, { id: 'aw_story', label: '本や映画・物語の人' },
];
const Q = (id, label, value, wish) => ({ id, label, value, wish });
export const QUALITIES = [
  Q('ql_speak', '思ったことを、はっきり言う', 'vl_true', '思ったことを、はっきり言える'),
  Q('ql_kind', '誰にでもやさしい', 'vl_kind', '誰にでもやさしくできる'),
  Q('ql_calm', 'いつも落ち着いている', 'vl_calm', 'どんなときも落ち着いていられる'),
  Q('ql_try', '新しいことに挑戦している', 'vl_grow', '新しいことに挑戦できる'),
  Q('ql_free', '自分のペースで、好きに生きている', 'vl_free', '自分のペースで、好きに生きる'),
  Q('ql_fair', 'ずるをしない', 'vl_fair', 'ずるをしないでいられる'),
  Q('ql_listen', '人の話をよく聞く', 'vl_bond', '人の話を、よく聞ける'),
  Q('ql_help', '人のために動ける', 'vl_contrib', '人のために動ける'),
  Q('ql_steady', 'こつこつ続けている', 'vl_effort', 'こつこつ続けられる'),
  Q('ql_respect', '相手が誰でも、態度を変えない', 'vl_respect', '相手が誰でも、態度を変えない'),
];

// 章をまたぐ対応（トリセツ 5 の最後の 1 行だけに使う）
export const NEED_TO_VALUE = {
  nd_choose: 'vl_free', nd_useful: 'vl_contrib', nd_understood: 'vl_bond', nd_respect: 'vl_respect', nd_speak: 'vl_true',
  nd_grow: 'vl_grow', nd_competent: 'vl_effort', nd_rest: 'vl_calm', nd_safe: 'vl_calm', nd_cared: 'vl_kind', nd_belong: 'vl_bond',
};

// 入力画面の例（placeholder）
export const MEMO_PLACEHOLDER = {
  happy: '例：久しぶりに友だちと長電話', hard: '例：会議で意見を流された', voice: '例：グループ発表で失敗した',
  neg: '例：店で年配の人が後回しにされた', pos: '例：会で全員に話す番が回った', admire: '例：近所の80代の先輩',
};

// 画面ごとの入力グループ。chips は {id,label}。required は記録の条件。
export function layerGroups(side, layerId) {
  if (layerId === 'scene') return [{ id: 'scene', label: 'どんなこと？', hint: '（1つ）', max: 1, required: false, chips: SCENES.map(({ id, label }) => ({ id, label })) }];
  if (side === 'hard') {
    if (layerId === 'surface') return [{ id: 'surface', label: SIDE_HEAD.surface, hint: '', max: 1, required: false, chips: SURFACE_HARD.map(({ id, label }) => ({ id, label })) }];
    if (layerId === 'deep') return [{ id: 'deep', label: SIDE_HEAD.deep, hint: '', max: 2, required: false, chips: DEEP.map(({ id, label }) => ({ id, label })) }];
    if (layerId === 'needs') return [{ id: 'needs', label: SIDE_HEAD.needsHard, hint: '', max: 2, required: false, chips: NEEDS.map((need) => ({ id: need.id, label: need.wish })) }];
  }
  if (side === 'happy') {
    if (layerId === 'feelings') return [{ id: 'feelings', label: SIDE_HEAD.feelings, hint: '', max: 2, required: false, chips: SURFACE_HAPPY }];
    if (layerId === 'needs') return [{ id: 'needs', label: SIDE_HEAD.needsHappy, hint: '', max: 2, required: false, chips: NEEDS.map((need) => ({ id: need.id, label: need.met })) }];
  }
  return [];
}
const SIDE_HEAD = {
  surface: 'いちばん近いものを1つ', deep: '2つまで', needsHard: '2つまで', feelings: '2つまで', needsHappy: '2つまで',
};

// 第2・3章（と いいなと思った人）の入力グループ
export function episodeGroups(chapterId, side) {
  if (chapterId === 'voice') {
    return [
      { id: 'scene', label: 'どんなこと？', hint: '（1つ・なくてOK）', max: 1, required: false, chips: SCENES.map(({ id, label }) => ({ id, label })) },
      { id: 'thoughts', name: '頭の中の声', label: 'そのとき、頭の中でどんな声がした？', hint: '（2つまで）', max: 2, required: true, chips: THOUGHTS.map(({ id, label }) => ({ id, label })) },
    ];
  }
  if (chapterId === 'values' && side === 'admire') {
    return [
      { id: 'who', label: 'どんな人？', hint: '（1つ・なくてOK）', max: 1, required: false, chips: ADMIRE_WHO },
      { id: 'qualities', name: 'どこがいいか', label: 'その人の、どこがいいと思った？', hint: '（2つまで）', max: 2, required: true, chips: QUALITIES.map(({ id, label }) => ({ id, label })) },
    ];
  }
  if (chapterId === 'values') {
    return [{ id: 'situation', name: '心が動いたこと', label: '何に心が動いた？', hint: '（1つ）', max: 1, required: true, chips: (SITUATIONS[side] || []).map(({ id, label }) => ({ id, label })) }];
  }
  return [];
}

// ---------- 画面に出す固定文 ----------
export const STEP_LABELS = ['予想', '思い出す', '並べる', '見つける', 'ためす'];
export const STEP_LABELS_VOICE = ['思い出す', '並べる', '見つける', '声に返す', 'ためす'];

export const SIDE_COPY = {
  happy: { label: 'うれしかった出来事', short: 'うれしかった', color: 'good' },
  hard: { label: 'しんどかった出来事', short: 'しんどかった', color: 'bad' },
  voice: { label: 'しんどかった場面', short: '場面', color: 'bad' },
  neg: { label: 'イラッと・モヤッと', short: 'イラッと', color: 'bad' },
  pos: { label: 'じーんと・いいなと思った', short: 'じーんと', color: 'good' },
  admire: { label: 'いいなと思った人', short: 'いいなと思った人', color: 'good' },
};

export const INTRO = {
  happy: { title: 'うれしかった・ほっとした出来事を、2つ思い出そう', lines: ['この1〜2週間の、小さなことで大丈夫です。', '「ちょっとよかったな」くらいでOKです。'], button: '1つ目を思い出す' },
  hard: { title: '次は、しんどかった出来事を、3つ思い出そう', lines: ['最近の小さな出来事で大丈夫です。「ちょっとモヤッとした」くらいでOK。', '昔のつらいことや、思い出すと苦しくなることは、選ばないでね。', '自分を責めるためではなく、奥にあるものを見つけるために思い出します。'], button: '1つ目を思い出す' },
  voice: { title: 'しんどかったり、自分にがっかりしたりした場面を、3つ思い出そう', lines: ['最近の小さなことで大丈夫です。「ちょっと落ちこんだ」くらいでOK。', '昔のつらいことや、思い出すと苦しくなることは、選ばないでね。', '自分を責めるためではなく、声のくせに気づくために思い出します。'], button: '1つ目を思い出す' },
  neg: { title: '最近、イラッとしたり、モヤッとしたりした出来事を2つ思い出そう', lines: ['大きなことでなくて大丈夫です。人のことでも、自分のことでもOK。', '思い出すのがつらいことは、選ばなくて大丈夫です。'], button: '1つ目を思い出す' },
  pos: { title: '次は、じーんとしたり、いいなと思ったりした出来事を2つ思い出そう', lines: ['小さなことで大丈夫です。'], button: '1つ目を思い出す' },
};

export const COPY = {
  appTitle: 'わたしのトリセツ',
  deckSubtitle: '出来事の奥に、くり返すものがある',
  deckDescription: '最近の出来事を思い出して、その奥にある気持ちや願い、頭の中の声をたどります。くり返し出てくるものから、自分の取扱説明書を作ります。',
  cardMeta: '3つの章',
  startTitle: 'わたしのトリセツを作ろう',
  startLead: '出来事はバラバラでも、その奥には、同じ気持ちや願いがくり返し出てくることがあります。最近の小さな出来事を思い出して、自分の奥にあるものを見つけます。',
  privacyTitle: 'ここに書いたことは、どこにも送られません。',
  privacyBody: 'この画面を閉じると消えます。章を1つ書き終えると、この端末に残すかどうか選べます。',
  startGuide: '目安：1つの章が4〜6分。どの章からでも始められます。',
  startGuide2: 'どの質問も、飛ばして大丈夫です。',
  begin: '作り始める',
  noticeMigrated: 'トリセツの作り方が新しくなりました。前のトリセツから『製品名』だけ引き継ぎました。ほかは、新しい作り方で書いてね。',
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
  limitMessage: (n) => `${n}つまでです。どれかを外すと選べます。`,
  memoLabel: 'ひとことメモ（なくてOK）',
  memoLabelEpisode: 'ひとことで（なくてOK）',
  memoCount: (n, max) => `${n}/${max}字`,
  layerNext: '次へ',
  layerSkip: 'わからないので飛ばす',
  layerKeep: 'このまま進む',
  recordEpisode: 'この出来事を記録する',
  recordVoice: 'この場面を記録する',
  recordAdmire: 'これを記録する',
  dropEpisode: 'この出来事はやめておく',
  skipVoice: '声は思い出せないので飛ばす',
  skipValues: '思い出せないので飛ばす',
  skipAdmire: '思いつかないので飛ばす',
  missingGroups: (names) => `選んでいないところがあります：${names.join('、')}`,
  episodeHeading: (n, total) => (total ? `${n}つ目（${total}つ中）` : `${n}つ目`),
  depthLabel: '深さ',
  deleteEpisode: 'この出来事を消す',
  deleteVoice: 'この場面を消す',
  deleteAdmire: 'この記録を消す',
  useNeedsHard: '第1章の「しんどかった出来事」を使う',
  shortTitleNeeds: '合わせて3つ以上あると、くり返しが見つけやすくなります。小さなことでも大丈夫です。',
  shortTitleVoice: '見つけるには、場面が2つ以上あると安心です。小さなことでも大丈夫です。',
  shortTitleValues: '出来事といいなと思った人が、合わせて3つ以上あると見つけやすくなります。',
  addMoreEpisode: 'もう1つ思い出す',
  later: 'あとにする（目次へ）',
  lineupTitle: '並べてみよう',
  lineupLeadNeeds: '出来事を横に、その奥にあったものを縦に並べました。',
  lineupLeadVoice: '頭の中の声を、場面ごとに並べました。',
  lineupLeadValues: '出来事の裏にありそうな「大事なこと」を、横に書きました。',
  lineupAskNeeds: '出来事はバラバラでも、奥に同じものがある？',
  lineupAskVoice: '声はちがっても、同じ種類の声がある？',
  lineupAskValues: '自分でも、何か気づくことはある？',
  lineupNoteValues: '「→」の先は、ちがうと思ったら押して変えられます。',
  lineupLayerSurface: '表の気持ち',
  lineupLayerDeep: '奥の気持ち',
  lineupLayerNeeds: '本当の願い・満たされたもの',
  lineupNa: 'この出来事には聞いていません',
  lineupOneEpisode: (n) => `1つだけに出たこと（${n}）`,
  findCommon: '共通点を探す',
  lineupYes: 'あり', lineupNo: 'なし',
  lineupHappy: 'うれしかった', lineupHard: 'しんどかった', lineupScenes: '場面',
  lineupMemo: '出来事',
  lineupAdmire: 'いいなと思った人',
  lineupOwn: '自分の言葉',
  lineupOwnOnly: 'ほかに書いた言葉',
  changeValue: '大事なことを選び直す',
  nameEmpty: '名前をつけると、ここに出ます。',
  insightTitle: '見つけたこと',
  insightIntro: '今回の答えでは──',
  scenesSpread: (labels) => `出来事は、${labels.join('、')}と、バラバラでした。でも、奥にはくり返し出てくるものがありました。`,
  bandCross: 'しんどい時もうれしい時も',
  bandLink: '表の気持ちの奥',
  bandHard: 'しんどいときの奥',
  bandHappy: 'うれしかったとき',
  bandVoice: 'くり返していた声',
  bandValues: '心が動く裏にあること',
  insightNoneTitle: '今回の答えでは、くり返し出てくるものは、まだはっきりしません。',
  insightNoneBody: '出来事ごとに、奥にある気持ちや願いがちがっていました。',
  nearTitle: '少しだけ重なっていたもの：',
  deepListHard: '出てきた奥の気持ち：',
  deepListHappy: '出てきた満たされたもの：',
  extraHead: 'ほかに見えたこと：',
  extraValues: 'ほかに：',
  insightFootShort: '決まりではありません。',
  insightAddMore: '出来事を足すと、もっとはっきりするかもしれません。',
  voiceNoneTitle: '今回は、場面ごとにちがう声がしていました。',
  voiceNoneBody: 'どの声も、しんどいときに出てきやすい声の候補です。場面を足すと、重なりが見えてくるかもしれません。',
  voiceAddMore: '場面を足すと、もっとはっきりするかもしれません。',
  valuesNoneTitle: '今回は、出来事ごとにちがう『大事なこと』が出てきました。',
  valuesNoneBody: 'どれも、大事にしていることの候補です。出来事を足すと、重なりが見えてくるかもしれません。',
  heavyNote: 'しんどさが続いているときは、ひとりで抱えずに、話せる人や相談先を頼ってみてね。',
  compareGap: '予想と比べる',
  nextButton: '次へ',
  fixEpisodes: '出来事を直す・足す',
  fixScenes: '場面を直す・足す',
  addHappy: 'うれしかった出来事を足す',
  addHard: 'しんどかった出来事を足す',
  addScene: '場面を足す',
  addNeg: 'イラッとした出来事を足す',
  addPos: 'じーんとした出来事を足す',
  goOn: 'このまま進む',
  gapTitle: '予想と比べてみよう',
  gapThought: (label) => `思っていた：${label}`,
  protectTitle: 'その声は、何を守ろうとしていると思う？',
  protectLead: 'きびしい声も、じつは自分を守ろうとしていることがあります。',
  protectVoiceHead: (labels) => `${labels.map((label) => `『${label}』`).join('')}という声`,
  otherVoice: 'ほかの声にする',
  otherVoiceTitle: 'どの声について考える？',
  protectNext: '次へ',
  replyTitle: '大事な友だちが同じことを言っていたら、何て返す？',
  replyLead: (labels) => `${labels.map((label) => `「${label}」`).join('')}と、友だちが言っていたら。`,
  replyHint: '1つ選んでね',
  replyClosing: 'その言葉を、自分にもかけてみよう。',
  replyPlaceholder: '例：気にしすぎだよ、大丈夫',
  replyNext: '次へ',
  daysTitleNeeds: '思い出した出来事',
  daysTitleVoice: '思い出した場面',
  daysTitleValues: '思い出した出来事',
  fixOne: '直す',
  addOneEpisode: '＋ もう1つ足す',
  addOneAdmire: '＋ いいなと思った人を足す',
  backToInsight: '見つけたことに戻る',
  surpriseTitle: 'いちばん意外だったことは？',
  surpriseHint: '1つ選んでね',
  surpriseNone: '特になし（思ったとおり）',
  surpriseGap: '予想と違ったこと',
  surpriseSpreadNeeds: '出来事ごとに、奥のものがちがったこと',
  surpriseSpreadVoice: '場面ごとに、ちがう声がしていたこと',
  surpriseSpreadValues: '出来事ごとに違ったこと',
  surprisePlaceholder: '例：話すだけで変わるなんて',
  tryTitle: '来週ためしてみること',
  tryHint: '見つけたことから、1つだけ選んでみよう',
  tryFooter: 'ためしてみて、合わなければやめてOKです。',
  tryPlaceholder: '例：月曜の朝は散歩する',
  tryWrite: 'トリセツに書く',
  tryWriteNone: '今は決めずにトリセツに書く',
  freeWrite: '自分で書く',
  freeCount: (n) => `${n}/30字`,
  ownHint: 'ぴったりのものがなければ、自分の言葉で書いてね。',
  ownPlaceholder: '自分の言葉で',
  ownBlockTitle: '自分の言葉で書いたもの',
  ownThinTitle: '今回は、選んだものだけでは、くり返しを数えられませんでした。',
  ownThinBody: '自分の言葉は数えずに、そのまま並べます。',
  ownBlockNote: '言葉がちがっても、近いものがないか見てみてね。',
  ownKeepNote: '自分の言葉は、数えずに、そのまま残します。',
  gapOwnResult: '→ 自分の言葉の予想は、数えずにそのまま残します。見つけたことと見くらべてみてね。',
  pickValue: '大事なことを選ぶ',
  toContents: '目次に戻る',
  doneNext: (label) => `次は「${label}」へ`,
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
  noneBox: '今回はまだ見えませんでした。出来事を足すと、ここに書き込まれます。',
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
  { id: 'fuel', chapterId: 'needs', title: '満たされると元気になるもの', icon: 'power' },
  { id: 'shaky', chapterId: 'needs', title: '揺れやすいところ', icon: 'lamp' },
  { id: 'request', chapterId: 'needs', title: '周りの人へのお願い', icon: 'bubble' },
  { id: 'voice', chapterId: 'voice', title: '頭の中の声と、かけたい言葉', icon: 'voice' },
  { id: 'values', chapterId: 'values', title: '大事にしていること', icon: 'star' },
  { id: 'try', chapterId: null, title: '来週ためしてみること', icon: 'wrench' },
  { id: 'surprise', chapterId: null, title: 'いちばん意外だったこと', icon: 'drop' },
];

// 組み立ての固定文
export const MANUAL_COPY = {
  suffixCross: '（足りないとしんどく、満たされるとうれしい）',
  suffixHard: '（しんどかったときに足りなかった）',
  suffixHappy: '（うれしかったときに満たされていた）',
  fuelCandidates: 'まだはっきりしませんが、候補です。',
  shakyIntro: '表に出ている気持ちの奥に、別の気持ちがあるようです。',
  shakyOutro: '表の気持ちの奥にあるものに、気づいてもらえると助かります。',
  requestOutro: 'いつも、ありがとう。',
  voiceNone: 'しんどいときに、こんな声がしていました。',
  voiceReplyHead: 'そんなときに、自分にかけたい言葉',
  voiceSoft: 'きびしい声も、自分を守ろうとしていることがあります。',
  valuesCandidates: '大事にしていることの候補です。',
  valuesBoth: 'これが守られないと心が波立ち、守られるとうれしくなるようです。',
  valuesNeg: 'これが守られないと、心が波立ちやすいようです。',
  valuesPos: 'これがあると、うれしくなるようです。',
  admireHead: '本当は、こうありたい',
  tryOutro: '合わなければ、やめてOKです。',
  ownHead: '自分の言葉で書いたこと',
  ownIntents: (text) => `その声は、「${text}」という気持ちを守ろうとしているのかもしれません。`,
  ownFuelSuffix: '（自分の言葉）',
  ownVoiceSuffix: '（自分の言葉）',
  ownNeg: 'イラッとしたこと',
  ownPos: 'じーんとしたこと',
  surpriseNone: '思ったとおりだった',
};

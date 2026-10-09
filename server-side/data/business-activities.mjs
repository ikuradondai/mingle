const cards = (activityId, questions, options = undefined) => questions.map((question, index) => ({
  id: `${activityId}-${String(index + 1).padStart(2, '0')}`,
  question,
  ...(options ? { options: options[index] } : {}),
}));

export const businessActivities = [
  {
    id: '1on1-mutual', title: '1on1スターター', description: 'お互いの仕事の進め方や関心を知るための入口の質問。', kind: 'conversation', minParticipants: 2, maxParticipants: 2,
    cards: cards('1on1-mutual', ['最近、仕事で小さくうれしかったことは？', '今の仕事で、もっと知りたいテーマは？', '集中しやすい時間帯や環境は？', '相談するとき、最初に共有してほしい情報は？', '最近試してみて、続けたい仕事の工夫は？', '次に一緒にできたら楽しそうなことは？']),
  },
  {
    id: '1on1-consult', title: '1on1相談スターター', description: '相談したいことを無理なく言葉にするための質問。', kind: 'conversation', minParticipants: 2, maxParticipants: 2,
    cards: cards('1on1-consult', ['今、整理したい仕事のテーマは？', '話を聞いてもらうとき、質問と相づちのどちらが助かる？', '最近、判断に迷った場面は？', '今週ひとつ試せそうな小さな一歩は？', '誰かに任せると進みそうなことは？', '次に話すまでに確認しておきたいことは？']),
  },
  {
    id: '1on1-reflect', title: '1on1ふりかえり', description: '最近の仕事を振り返り、次の行動を考える質問。', kind: 'conversation', minParticipants: 2, maxParticipants: 2,
    cards: cards('1on1-reflect', ['最近うまくいった進め方は？', '想定と違ったけれど学びになったことは？', 'もっと早く相談できたらよかったことは？', '誰かの助けで進んだことは？', '次回も残したい習慣は？', '次の期間で試すなら何を変える？']),
  },
  {
    id: 'meeting-checkin', title: '会議前3分トーク', description: '会議の前に短く話して、場をほぐす質問。', kind: 'conversation', minParticipants: 2, maxParticipants: 8,
    cards: cards('meeting-checkin', ['今日の会議で一番確認したいことは？', 'このテーマで最近気になった小さな変化は？', '今の気分を天気にたとえると？', '今日ひとつ持ち帰れたらうれしいことは？', '話が広がりそうな論点は？', '最初に共有しておくと進めやすい前提は？', '会議のあとにできる小さな行動は？', '今日の議論で聞いてみたい視点は？', 'ここまでの準備で助かったことは？', 'この時間を有意義にするために意識したいことは？', '終わるころに決まっているとよいことは？', 'この会議を一言で始めるなら？']),
  },
  {
    id: 'onboarding-day1', title: '新人オンボーディング 初日', description: '初日に安心して場へ入るための質問。', kind: 'conversation', minParticipants: 2, maxParticipants: 8,
    cards: cards('onboarding-day1', ['今日、まず知りたいことは？', '呼ばれたい名前や表記は？', '仕事で楽しみにしていることは？', '困ったときに聞きやすい方法は？', 'これまでの経験で活かせそうなことは？', '今日の終わりに分かっていたいことは？', '休憩や切り替えで大切にしたいことは？', '最初の一週間で試してみたいことは？']),
  },
  {
    id: 'onboarding-week1', title: '新人オンボーディング 1週目', description: '最初の一週間を振り返り、次の質問先を見つけるカード。', kind: 'conversation', minParticipants: 2, maxParticipants: 8,
    cards: cards('onboarding-week1', ['一週間で分かってきたことは？', 'まだ全体像を知りたい仕事は？', '仕事を進めるうえで役立った情報源は？', '質問しやすかった場面は？', 'もう一度説明を聞きたいことは？', 'チームの仕事で面白いと思った点は？', '来週ひとつ試したいことは？', '今後つながっておきたい人やチームは？']),
  },
  {
    id: 'onboarding-month1', title: '新人オンボーディング 1か月', description: '一か月の経験を整理し、これからの動きを考えるカード。', kind: 'conversation', minParticipants: 2, maxParticipants: 8,
    cards: cards('onboarding-month1', ['一か月で自分なりに慣れたことは？', '仕事の全体像で見えやすくなった部分は？', 'これから深めたい役割やテーマは？', '最初の印象から変わったことは？', 'チームに貢献できたと感じる小さなことは？', 'もっと知りたい社内の仕組みは？', '次の一か月の目標を小さく言うと？', '周囲に伝えておきたい働き方の希望は？']),
  },
  {
    id: 'colleague-prediction', title: '同僚予想クイズ', description: '相手の答えを予想してから、本人の選択を聞く二択。', kind: 'prediction', minParticipants: 2, maxParticipants: 2,
    cards: cards('colleague-prediction', ['仕事を始めるなら、朝に片づける？ 午後に集中する？', '新しいツールを試すなら、まず触る？ 先に調べる？', '会議の準備は、前日にする？ 直前にする？', 'チームで考えるなら、対面で話す？ チャットで整理する？', 'メモを取るなら、紙に書く？ デジタルに残す？', 'アイデアを考えるなら、一人？ 誰かと話しながら？', '初めての仕事では、先に手順を見る？ まず小さく試す？', '昼休みは、しっかり休む？ 用事を済ませる？', '仕事の区切りには、片づける？ 次の予定を確認する？', '学ぶなら、短時間を毎日？ まとまった時間に？', '相談するなら、まず要点を送る？ まず時間を取る？', 'チームの成功を祝うなら、短く共有？ みんなで時間を作る？'], [
      ['朝に片づける', '午後に集中する'], ['まず触る', '先に調べる'], ['前日にする', '直前にする'], ['対面で話す', 'チャットで整理する'], ['紙に書く', 'デジタルに残す'], ['一人', '誰かと話しながら'], ['先に手順を見る', 'まず小さく試す'], ['しっかり休む', '用事を済ませる'], ['片づける', '次の予定を確認する'], ['短時間を毎日', 'まとまった時間に'], ['まず要点を送る', 'まず時間を取る'], ['短く共有', 'みんなで時間を作る'],
    ]),
  },
];

export default businessActivities;

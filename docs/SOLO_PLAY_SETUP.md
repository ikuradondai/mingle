# 自分とミングる backend contract

「自分とミングる」は公式17テーマ（5分類：恋愛4・仕事2・学校・部活3・友だち・人間関係2・自分6）の一人用振り返りです。既存の順序つき公式デッキは各12問、`audience:'solo'`、`questionOrder:'fixed'`、非R18です。広く振り返る「自分を知る40問」は40問をシャッフルして出題します。マイセットは6〜40問で、所有者・セットID・順序を保存します。

## 公式テーマの運用方針（v2）

- 公式ソロテーマは17個で、`dist/data/solo-decks.js` の `soloDecks` が正です。分類は `soloCategories` の5つ（love / work / school / friends / self）で、friends の表示名は「友だち・人間関係のこと」です（id は変えません）。既存テーマのIDと順序は維持し、新しい40問テーマだけ `questionOrder:'shuffle'` を使います。
- **ID を残す方針**：テーマ ID と既存カード ID（`<deckId>-01`〜`-12`）は削除しません。保存済みメモ、マイセット、公開セット、会場、組織ポリシー、途中のセッションが ID で参照するためです。40問テーマは同じテーマIDの下で`-01`〜`-40`を使います。中身（タイトル・説明・問い）は同じ ID の中で置き換えます。テーマをやめるときは物理削除せず `hidden: true` を付け、カタログ参照には残します。目的が全く別になるときは新しい ID を作り、旧 ID は凍結します。
- **相談先の一文（サポートライン）**：テーマの `care` で出し分けます。`care: 'distress'`（self-breakup-decided / self-breakup-lingering / self-work / self-school / self-confidence / self-people-tired / self-future）は開始前の画面に、`care: 'love'`（self-love-now）は関係の安全に関する一文を出します。すべてのソロの終了画面にも共通の一文を出します。文言は固定で、場所も決まっています。
- **自動検知はしません。入力した文章の解析もしません。** メモは明示的に保存したものだけを扱い、analytics に送らない約束を守るためです。`care` は、テーマごとに決めた固定の印です。
- 開始画面の説明に「答えたくない問いは、飛ばしてかまいません。」と書きます。書かなくても次へ進めます。
- 診断めいた語（うつ、病気、症状、診断、トラウマ、依存 など）、「なぜ／どうして／べき」型の問い、相手の気持ちの推測を促す問いは使いません。`tests/solo-content.test.mjs` が機械的に検査します（問いは40字以内で「？」終わり）。固定順テーマの説明文は「12問」、シャッフルテーマの説明文は「40問」を含めます。

## 利用機能とAPI

`PUT /api/account/solo-notes` は利用者が明示的に保存した質問メモまたはラウンドまとめを1スロットずつ保存します。質問スロットは `question:<questionId>`、まとめは `summary:<roundNumber>` をキーにし、再保存は本文と更新日時だけを更新します。質問本文・テーマ名・R18属性などのsnapshotは不変です。

`GET /api/account/solo-notes?limit=20&cursor=...` は新しい順に履歴を返し、`PATCH /api/account/solo-notes/:id` は本文を編集、`DELETE` は本人の行を削除します。匿名利用者は拒否されます。R18行は年齢確認がない場合、本文・質問・タイトルを返さず削除だけ許可します。

入力にタイトルや質問本文を渡すことは rejected です。サーバーが公式カタログまたは所有者限定のset/custom-card snapshotから解決します。メモはanalytics、feedback、SNS共有、AI生成、venue、group payloadへコピーしません。

## SQL適用順序

既存のaccounts/custom_cards/shared_sets/set_drafts関連migrationを先に適用し、その後に次の順序で適用します。

1. `supabase/migrations/202610100001_solo_notes.sql`
2. `supabase/migrations/202610100002_set_metadata.sql`

1本目は所有者RLS、匿名JWT拒否、slot upsert、immutable snapshot、R18 snapshot、退会cascadeを作成します。2本目はset/draftの `audience` と `question_order`、draft completion RPC、solo-only共有拒否を追加します。ブラウザへservice role keyを送らないでください。本番にはまだ適用していません。

## Disposable PGlite検証

サイトディレクトリから実行します。RLS検証用の依存関係が未導入の fresh checkout では先に `npm ci --prefix tests/rls` を実行します。

```powershell
node tests/rls/solo-notes-verify.mjs
node tests/rls/solo-metadata-verify.mjs
node --test tests/solo-notes.test.mjs
npm run check
```

実行済み結果は `artifacts/solo-db-qa.log` に保存しています。notes検証は2回のmigration、2回の同一slot upsert、snapshot不変、owner隔離、authenticated匿名JWT/anon拒否、cascadeを確認します。metadata検証は6枚solo/fixed作成、既存set編集、失敗rollback、authenticated RPC拒否、service role実行、solo-only共有拒否、both/fixed共有snapshot順を確認します。


## 自分のトリセツ（ビルダー）

ソロテーマ `self-values`（自分のトリセツ）は、一覧の「はじめる」で 12 問セッションではなく専用ビルダー（`dist/torisetsu.js`、データは `dist/data/torisetsu-content.js`）を開きます。`solo-decks.js` の `builder: 'torisetsu'` がその印です。

- **カード id を残す理由**: `self-values-01..12` と deck id は、マイセット・マーケット・保存メモ・共有セット・再開中セッションが参照するため削除しません（12 問の文言も変更しない）。
- **中身は端末の外に出さない**: ビルダーのモジュールは `fetch` / XHR / `sendBeacon` / WebSocket / EventSource を使わず、`analytics.js`・`account*.js`・`session-storage.js` を読み込みません（`tests/torisetsu-privacy.test.mjs` で静的・実行時に検査）。送るのは既存の `theme_start`（`self-values`）と `page_view`（`torisetsu`）だけで、`server-side/config.mjs` の `PAGE_IDS` に `torisetsu` を追加しています。
- **内面をたどる流れ（v3）**: 3 つの章（満たされるもの、足りないもの／頭の中の声／心が動くとき）は、どの順でも、1 章だけでも完結します。第 1 章と第 3 章は「予想 → 思い出す → 並べる → 見つける → ためす」、第 2 章は予想なしの「思い出す → 並べる → 見つける → 声に返す → ためす」です。結論は直接聞かず、最近の小さな出来事を 1 つずつ、1 層 1 画面で「何があった？ → 表の気持ち → 奥の気持ち → 本当の願い」（うれしい側は「出来事 → 気持ち → 満たされたもの」）と下りてもらいます。すべての質問に「わからないので飛ばす」があり、出来事ごとに「この出来事はやめておく」で捨てられます。思い出す前には毎回「最近の小さな出来事で大丈夫。昔のつらいことは選ばないでね」と案内します。第 2 章には、第 1 章のしんどかった出来事の「場面」と「ひとこと」だけを写して使うボタンがあります（コピーで、声は改めて選びます）。トリセツは 7 欄（満たされると元気になるもの／揺れやすいところ／周りの人へのお願い／頭の中の声と、かけたい言葉／大事にしていること／来週ためしてみること／いちばん意外だったこと）で、その結果から組み立てます。
- **集計は端末内・奥の層だけ・自由文は数えない**: 集計は純粋関数の `dist/torisetsu-insight.js` に集めています（DOM・storage・通信に触れません）。数えるのは奥の層（奥の気持ち・本当の願い・心のくせ・大事なこと）だけで、「何があった？」の場面は「出来事はバラバラでした」と示すためだけに使い、ひとこと・「意外だったこと」「来週ためすこと」・返す言葉の自由文は一切数えず、書いた本人の言葉としてそのまま表示するだけです。1 つの出来事の中で同じものを 2 回選んでも 1 回と数えます。しきい値は整数（分数のまま）で固定し（くり返し＝2 つ以上かつ半分以上、しんどい時もうれしい時も＝両側にあり合わせて 3 つ以上かつ全体の半分以上、表と奥のつながり＝同じ表の気持ちの 2/3 以上）、同じ気持ち・願い・表の気持ちは 1 回だけ出します。文は「今回の答えでは」「決まりではありません」と回数つきで控えめに書き、診断語・ラベル・「あなた」は使いません（この機能の禁止語は `tests/torisetsu-content.test.mjs` が固定）。固定の例 A〜E は `tests/fixtures/torisetsu/v3-*.mjs` にあり、`tests/torisetsu-insight.test.mjs` が文字列で固定しています。しんどさが続いていそうな答え（むなしさ／いっぱいいっぱいが 2 出来事以上、または全場面が「ひとりで抱える」「自分を責める」声）のときだけ、見つける画面に相談先を頼る一文と支援の案内を添えます（端末内で判定し、保存も送信もしません）。
- **保存**: 既定はメモリのみ。利用者が章を 1 つ終えたあとに「この端末に残す」を選んだときだけ localStorage の `mingle.torisetsu.v3`（`{ version: 3, savedAt, data }`）に、チップ id と自由文だけを書きます（集計結果・組み立て後の文は保存しない。上限の答えでも 10KB 未満）。アカウントとは結びつけません。消すと v3・v2（`mingle.torisetsu.v2`）・旧 v1（`mingle.torisetsu.v1`）の 3 つのキーを即座に削除し、5 秒間の「元に戻す」はメモリだけで復元します（端末には書きません）。
- **v2・v1 からの移行**: v3 が無く v2（無ければ v1）が残っている端末では、開いたときに「製品名」だけを引き継いで v3 に書き、書けたら v2・v1 のキーを削除して 1 回だけ案内文を出します（書けなかったときは古いキーを残して次回また試します）。製品名が無ければ古いキーを消して、その旨を 1 回だけ案内します。v2 の答え（調子のいい日・悪い日、心が動く出来事、人から見たわたし）は新しい作り方では使えないため引き継ぎません。v3 があるときは古いキーを読みません。
- **画像を保存／送る**: `dist/torisetsu-image.js` が canvas でその場で PNG を作ります。「画像を保存」は共有シートを使わず必ず `<a download>` で端末に保存します（iOS Safari ではファイルへ）。「送る」は `navigator.canShare({ files })` が真で、かつタッチ主体の端末（`pointer: coarse`）のときだけ出て、共有シートを開きます（iPhone で写真に保存する経路）。サーバーには送りません。
- **Service Worker を足すとき**: トリセツの画面・データはキャッシュ対象に含めても中身（利用者の入力）は含まれませんが、入力内容を通信やログに載せる変更は入れないでください。

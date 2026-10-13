# 自分とミングる backend contract

「自分とミングる」は公式16テーマ（5分類：恋愛4・仕事2・学校・部活3・友だち・人間関係2・自分5）の一人用振り返りです。公式デッキは各12問、`audience:'solo'`、`questionOrder:'fixed'`、非R18です。マイセットは6〜40問で、所有者・セットID・順序を保存します。

## 公式テーマの運用方針（v2）

- 公式ソロテーマは16個で、`dist/data/solo-decks.js` の `soloDecks` が正です。分類は `soloCategories` の5つ（love / work / school / friends / self）で、friends の表示名は「友だち・人間関係のこと」です（id は変えません）。
- **ID を残す方針**：テーマ ID とカード ID（`<deckId>-01`〜`-12`）は削除しません。保存済みメモ、マイセット、公開セット、会場、組織ポリシー、途中のセッションが ID で参照するためです。中身（タイトル・説明・問い）は同じ ID の中で置き換えます。テーマをやめるときは物理削除せず `hidden: true` を付け、カタログ参照には残します。目的が全く別になるときは新しい ID を作り、旧 ID は凍結します。
- **相談先の一文（サポートライン）**：テーマの `care` で出し分けます。`care: 'distress'`（self-breakup-decided / self-breakup-lingering / self-work / self-school / self-confidence / self-people-tired / self-future）は開始前の画面に、`care: 'love'`（self-love-now）は関係の安全に関する一文を出します。すべてのソロの終了画面にも共通の一文を出します。文言は固定で、場所も決まっています。
- **自動検知はしません。入力した文章の解析もしません。** メモは明示的に保存したものだけを扱い、analytics に送らない約束を守るためです。`care` は、テーマごとに決めた固定の印です。
- 開始画面の説明に「答えたくない問いは、飛ばしてかまいません。」と書きます。書かなくても次へ進めます。
- 診断めいた語（うつ、病気、症状、診断、トラウマ、依存 など）、「なぜ／どうして／べき」型の問い、相手の気持ちの推測を促す問いは使いません。`tests/solo-content.test.mjs` が機械的に検査します（問いは40字以内で「？」終わり、説明文は「12問」を含み100字以内）。

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
- **気づき型の流れ（v2）**: 3 つの章（元気のもと／心が動くとき／人から見たわたし）を「予想 → 思い出す → 並べる → 見つける → ためす」で進めます。結論は直接聞かず、最近の具体的な日や出来事（誰といた・どこにいた・何をしていた・前の晩・体の調子 など）をチップで答えてもらい、端末内で並べて共通点を見つけます。トリセツの各欄はその結果から組み立てます。元気の増減マップは第 1 章に含めています。
- **集計は端末内・自由文は数えない**: 集計は純粋関数の `dist/torisetsu-insight.js` に集めています（DOM・storage・通信に触れません）。入力はチップ id だけで、ひとことメモ・「意外だったこと」「来週ためすこと」の自由文は一切数えず、書いた本人の言葉としてそのまま表示するだけです。しきい値は整数（分数のまま）で固定し、文は「今回の答えでは」「決まりではありません」と回数つきで控えめに書きます。固定の例は `tests/fixtures/torisetsu/` にあり、`tests/torisetsu-insight.test.mjs` が文字列で固定しています。
- **保存**: 既定はメモリのみ。利用者が章を 1 つ終えたあとに「この端末に残す」を選んだときだけ localStorage の `mingle.torisetsu.v2`（`{ version: 2, savedAt, data }`）に、チップ id と自由文だけを書きます（集計結果・組み立て後の文は保存しない）。アカウントとは結びつけません。消すと v2 と旧 v1（`mingle.torisetsu.v1`）の両方のキーを即座に削除し、5 秒間の「元に戻す」はメモリだけで復元します（端末には書きません）。
- **v1 からの移行**: v2 が無く v1 が残っている端末では、開いたときに v1 の「製品名」と「元気になるスイッチ」（第 1 章の予想に変換）だけを引き継いで v2 に書き、書けたら v1 キーを削除します（書けなかったときは v1 を残して次回また試します）。ほかの欄は引き継がず、1 回だけ案内文を出します。
- **画像を保存／送る**: `dist/torisetsu-image.js` が canvas でその場で PNG を作ります。「画像を保存」は共有シートを使わず必ず `<a download>` で端末に保存します（iOS Safari ではファイルへ）。「送る」は `navigator.canShare({ files })` が真で、かつタッチ主体の端末（`pointer: coarse`）のときだけ出て、共有シートを開きます（iPhone で写真に保存する経路）。サーバーには送りません。
- **Service Worker を足すとき**: トリセツの画面・データはキャッシュ対象に含めても中身（利用者の入力）は含まれませんが、入力内容を通信やログに載せる変更は入れないでください。

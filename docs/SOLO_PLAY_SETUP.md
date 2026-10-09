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

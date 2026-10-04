# Set Studio の設定

## 概要

Set Studio の編集途中データは `my_set_drafts` に、完成したセットは既存の `my_sets` に保存します。下書きは所有者だけが読め、0〜40件を保持できます。完成処理だけが6〜40件を要求し、保存済み静的カードまたは同じ利用者の自作カードと、下書き内の新しい質問を混在できます。

## 適用

1. `supabase/migrations/202610060001_set_drafts.sql` を対象の Supabase プロジェクトの SQL Editor で実行します。既存の `my_sets`、`custom_cards`、`auth.users` を前提にした追加 migration です。
2. RLS が有効になり、`auth.uid()` と `user_id` が一致する行だけが下書きの読み書き対象になります。`source_set_id` も同じ所有者のセットに限定されます。
3. migration 適用後、`GET /api/account/me` の `draftsAvailable` が `true` になります。未適用時は新機能だけが `false` になり、既存のアカウント・お気に入り・セット機能は継続します。

## API

- `POST /api/account/set-drafts`: `{name, items, sourceSetId?}`。名前は1〜80文字、項目は0〜40件です。
- `PATCH /api/account/set-drafts/:id`: 名前または項目を更新します。
- `DELETE /api/account/set-drafts/:id`: 下書きを削除します。
- `POST /api/account/set-drafts/:id/complete`: 6〜40件で完成させます。完成処理はデータベースのトランザクションで行われ、失敗時は下書きと既存セットを保持します。
- `POST /api/account/ai/questions`: `{theme,tone,count}`（`count` は6または12）から、保存前に確認・編集できる質問案を返します。`OPENAI_API_KEY` がサーバーにない場合は利用できません。生成結果は自動で下書き保存しません。

項目は `{kind:"saved",cardId}` または `{kind:"custom",text,r18,origin:"user"|"ai"}` です。質問本文は1〜300文字で、改行・制御文字を含められません。AI生成機能はサーバー側の設定がある場合だけ別途有効化します。APIキーをブラウザへ渡したり、下書きを分析・広告用途へ送ったりしません。

本番データベースへの適用状況は環境ごとに確認してください。このリポジトリから自動適用は行いません。

完成処理のRPCは、所有者をサーバーで確認したうえで管理用サーバーキーから呼び出します。管理用キーが未設定の場合、下書きの保存・編集は使えても完成処理は利用できません。管理用キーやOpenAIキーはブラウザへ渡しません。

AI生成には永続ストアによる利用制限が必要です。`AI_MINUTE_LIMIT`（既定3）と `AI_DAILY_LIMIT`（既定30）をサーバー環境で調整できます。Redisまたはローカル開発用ストアが利用できない本番環境では、AI生成を停止します。

# グループ同時プレイ

グループ同時プレイは、登録済み代表者が作成したルームを、参加者がQR/URLで開いて同じカード進行を見る機能です。参加者のアカウント登録は不要です。既存の1台プレイ、共有リンク、店舗QRのゲスト制限は変更しません。

## 現在の実装

- 代表者はテーマ選択画面の「みんなのスマホで遊ぶ」から標準テーマ、または自分が所有する完成済みマイセット（6〜40枚）のルームを作成します。テーマミックス、店舗テーマ、共有リンク由来セットは初期版の対象外です。
- 代表者だけが開始、カードをめくる、回答者送り、パス、6枚ごとの続行、終了を操作します。参加者の並びは代表者、参加順で固定し、質問ごとに最初の回答者をずらします。
- 参加者は招待URLと呼び名で参加し、現在カードの表面、回答者、進行、待機状態を1秒間隔で取得します。参加secretはヘッダーで送り、URLやログに含めません。
- 「ひとりだけ違うお題」は同じルーム境界で提供します。代表者がログインしてルームを作成し、参加者は招待URL/QRと呼び名だけで参加します。各ラウンドのお題と配役はサーバーで参加者ごとに投影し、本人以外の秘密お題を返しません。確認、ヒント、投票、結果をサーバーのphase遷移で管理し、1人1票・自分への投票禁止・同票を検証します。
- ルームは2〜8人、6〜40枚、作成から24時間有効です。開始後の新規参加は受け付けません。
- 進行は`revision`のcompare-and-setで競合を拒否します。再読み込み・一時切断後は最新stateを再取得します。
- カード全体はサーバー側スナップショットに保持し、参加者の回答本文・録音・進行履歴は保存しません。カード裏状態では問題本文を返しません。
- 成人向けセットは代表者と全参加者の同意が必要です。`group_rooms`と`group_members`は直接のanon/authenticated読み書きを禁止し、APIがホストJWTまたはhash化された参加secretを検証します。host/member作成と参加人数上限はservice-only RPCで原子的に処理します。

## APIとmigration

- `POST /api/group/rooms`: 認証済み代表者が標準テーマまたは所有mysetのルームを作成
- `POST /api/group/rooms/:roomId/preview`: 招待tokenを検証し、参加前のテーマ名・枚数・成人向け状態・人数だけを返す
- `GET /api/group/rooms/:roomId`: 代表者または参加secretでstate取得
- `POST /api/group/rooms/:roomId/join`: 招待tokenと呼び名で参加
- `POST /api/group/rooms/:roomId/action`: 代表者の開始・めくる・回答者送り・パス・続行・終了（revision必須）
- migration: `supabase/migrations/202610080001_group_rooms.sql`
- 少数派ゲームの追加migration: `supabase/migrations/202610150001_minority_topic.sql`

本番Supabaseへmigrationを適用する前に、既存の認証migration後の使い捨てDBでRLSと期限/競合テストを実行してください。APIはアクセス時に期限を拒否し、5分間隔のservice-only cleanupを試行します。高トラフィックではSupabase側のscheduled jobなどで同じcleanupを補完してください。

追加migrationは `202610080001_group_rooms.sql` と成人向け境界のmigration群の後に、使い捨てDBで適用してから本番へ適用します。`minority_games`、`minority_rounds`、`minority_votes` は `service_role` 専用で、クライアントからの直接読み書きやRPC実行は許可しません。公開APIはルームの有効期限を毎回検査し、期限切れ後のアクセスを拒否します。これはアクセス期限であり、期限到来と同時の物理削除を意味しません。物理削除は既存ルームのservice-only cleanup（または同じ条件のscheduled job）が担当し、削除時は外部キーのcascadeで少数派ゲーム状態・投票を削除します。

初期版は短周期state取得です。Supabase Realtime Broadcastは将来、同じroom state APIとrevision境界を保ったまま置き換えられます。Broadcastを採用する場合もprivate channelの認可を必須にし、クライアントだけでカード進行を決めないでください。


## 検証記録（2026-10-05）

`tests/rls/group-rooms.sql` は、Docker Desktop の PostgreSQL 16 使い捨てコンテナで migration と smoke SQL をそれぞれ2回実行しました。anon/authenticated の両テーブル読み書きと両RPC呼び出し拒否、service_role による作成、8人上限、同じ参加認証情報の再参加、開始後の新規参加拒否、R18同意、期限切れ拒否、代表者削除時のcascadeを確認し、各回 `ROLLBACK` まで到達しています。結果ログは `artifacts/group-play-postgres.txt`、再実行用SQLは `tests/rls/group-rooms.sql` です。本番Supabaseへは適用していません。

再実行時は、PostgreSQL 16 の初期化完了を確認した使い捨てコンテナへ `supabase/migrations/202610080001_group_rooms.sql` と `tests/rls/group-rooms.sql` をコピーし、`psql -v ON_ERROR_STOP=1 -f` で各2回実行します。Docker実行ファイルは `C:\Program Files\Docker\Docker\resources\bin\docker.exe` です。

初期版の対象外は、テーマミックス、「やってみて」チャレンジ、店舗QR由来テーマ、共有セット由来テーマです。これらは通常プレイや店舗QRの既存フローを変更せず、将来の拡張対象として扱います。

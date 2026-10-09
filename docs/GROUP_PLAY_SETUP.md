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
- 質問ウルフの追加migration: `supabase/migrations/202610160001_question_wolf.sql`
- 新ゲーム共通のgame_type CHECK: `supabase/migrations/202610170001_group_game_types.sql`
- オチから話しての追加migration: `supabase/migrations/202610170002_ochi_kara.sql`（`202610170001`の後に適用。詳細は `docs/OCHI_KARA_GAME.md`）
- ワンカットの追加migration: `supabase/migrations/202610170003_one_cut.sql`（`202610170001`の後に適用。詳細は `docs/ONE_CUT_GAME.md`）
- ミッション・ミングルの追加migration: `supabase/migrations/202610170004_mission_mingle.sql`（`202610170001`の後に適用。詳細は `docs/MISSION_MINGLE.md`）
- 参加者のactionはゲーム種別ごとに許可します。カードルームは代表者だけが操作し、少数派・質問ウルフ・オチから話して・ワンカット・ミッション・ミングルは参加secret（`x-group-member-token`）で参加者の確認・投票などを受け付けます（revisionを要求するactionはゲームごとの表 `GAME_TYPES` と各 `server-side/<game>.mjs` で定義）。

本番Supabaseへmigrationを適用する前に、既存の認証migration後の使い捨てDBでRLSと期限/競合テストを実行してください。APIはアクセス時に期限を拒否し、5分間隔のservice-only cleanupを試行します（このcleanupは、期限切れのルームに加えて、終了から5分を過ぎた新ゲームの結果表示用データ`ochi_results`・`one_cut_results`・`mission_results`も削除します）。高トラフィックではSupabase側のscheduled jobなどで同じcleanupを補完してください。

追加migrationは `202610080001_group_rooms.sql` と成人向け境界のmigration群の後に、使い捨てDBで適用してから本番へ適用します。`minority_games`、`minority_rounds`、`minority_votes` は `service_role` 専用で、クライアントからの直接読み書きやRPC実行は許可しません。公開APIはルームの有効期限を毎回検査し、期限切れ後のアクセスを拒否します。これはアクセス期限であり、期限到来と同時の物理削除を意味しません。物理削除は既存ルームのservice-only cleanup（または同じ条件のscheduled job）が担当し、削除時は外部キーのcascadeで少数派ゲーム状態・投票を削除します。

初期版は短周期state取得です。Supabase Realtime Broadcastは将来、同じroom state APIとrevision境界を保ったまま置き換えられます。Broadcastを採用する場合もprivate channelの認可を必須にし、クライアントだけでカード進行を決めないでください。


## 検証記録（2026-10-05）

`tests/rls/group-rooms.sql` は、Docker Desktop の PostgreSQL 16 使い捨てコンテナで migration と smoke SQL をそれぞれ2回実行しました。anon/authenticated の両テーブル読み書きと両RPC呼び出し拒否、service_role による作成、8人上限、同じ参加認証情報の再参加、開始後の新規参加拒否、R18同意、期限切れ拒否、代表者削除時のcascadeを確認し、各回 `ROLLBACK` まで到達しています。結果ログは `artifacts/group-play-postgres.txt`、再実行用SQLは `tests/rls/group-rooms.sql` です。本番Supabaseへは適用していません。

再実行時は、PostgreSQL 16 の初期化完了を確認した使い捨てコンテナへ `supabase/migrations/202610080001_group_rooms.sql` と `tests/rls/group-rooms.sql` をコピーし、`psql -v ON_ERROR_STOP=1 -f` で各2回実行します。Docker実行ファイルは `C:\Program Files\Docker\Docker\resources\bin\docker.exe` です。

初期版の対象外は、テーマミックス、「やってみて」チャレンジ、店舗QR由来テーマ、共有セット由来テーマです。これらは通常プレイや店舗QRの既存フローを変更せず、将来の拡張対象として扱います。


## 本番反映の順序

新ゲーム3本（オチから話して・ワンカット・ミッション・ミングル）は、次の順で反映します。

1. `supabase/migrations/202610170001_group_game_types.sql` を本番Supabaseに適用する
2. 続けて `202610170002_ochi_kara.sql`、`202610170003_one_cut.sql`、`202610170004_mission_mingle.sql` を適用する（0002〜0004は互いに独立で、0001の後なら順不同）
3. そのあとで、このコミットをデプロイする

**migration 202610170001 → 0002 / 0003 / 0004 を本番Supabaseに適用してから、このコミットをデプロイします。pushするとVercelが自動でデプロイするため、適用前にpushしないでください。** 適用前にデプロイすると、新ゲームのルーム作成がRPC未定義・CHECK違反で失敗します。migrationは本番へ自動適用しません。各ゲームの詳細は `docs/OCHI_KARA_GAME.md`、`docs/ONE_CUT_GAME.md`、`docs/MISSION_MINGLE.md` にあります（3つとも名称は仮称です）。

## 回線を共有する場合の状態取得（429対策）

店舗のWi-Fiなど、同じグローバルIPから複数のスマホが同時に取得すると、`GET /api/group/rooms/:id` のIP単位の上限（`group-state-ip`、1分あたり6000回。1人あたりは`group-state-member`で180回/分）に近づきます。1卓8人（代表者を含む）が全員画面を表示したままのときの、1卓あたりの最大取得回数は次のとおりです。

| ゲーム | 取得間隔（最短） | 1人あたり | 1卓（8人）の最大 | 同じIPで同時に遊べる卓数の目安（6000/分） |
| --- | --- | --- | --- | --- |
| オチから話して | 1秒 | 60回/分 | 約480回/分 | 約12卓 |
| ワンカット | brief/take中は750ms、それ以外は1秒（カット直後に1回だけ即時再取得） | 約80回/分 | 約650回/分（再取得を含む） | 約9卓 |
| ミッション・ミングル | ロビー・答え合わせは1秒、指令フェーズ中は30秒、終了前60秒は5秒、まとめ以降は停止 | 60回/分 | 約480回/分（ロビー・答え合わせ時） | 約12卓 |

- 非表示のタブは取得しません。操作の直後の再取得や、画面に戻ったときの即時取得の分は上の最大値にほぼ含まれます。
- 3ゲームとも、取得が失敗した（429を含む）あいだは間隔を2秒、4秒、8秒、15秒と延ばし（最大15秒）、成功したら通常の間隔に戻します。
- 1つの店舗で複数卓を同時に回すときは、上の卓数を超えないよう目安にしてください。超えると429で表示の更新が遅れます（上限は`api/group.js`）。上限を上げる場合は、`group-state-ip`の値と運用コストを合わせて見直してください。

## ロールバック手順

新ゲームを取り下げるときの手順です。順序を守ってください（先にアプリを戻さないと、残ったクライアントが消えたRPCを呼んで失敗します）。

1. **アプリを戻す**: このコミットより前のデプロイへVercelでロールバックする（またはrevertをデプロイする）。
2. **新ゲームのルームを削除する**: 外部キーのcascadeで、各ゲームの表（`ochi_*`、`one_cut_*`、`mission_*`。終了後5分だけ結果を残す`*_results`表を含む）の行も消えます。
3. **各ゲームのRPCと表を削除する**（下のSQL）。
4. **`group_rooms.game_type`のCHECKを元の3種に張り直す**（下のSQL）。手順2でその3種以外の行が残っていると失敗するため、必ず手順2を先に実行します。

```sql
-- rollback-group-games: begin
begin;
-- 2) 新ゲームのルームを削除（cascadeで各ゲームの表も消える）
delete from public.group_rooms where game_type in ('ochi_kara','one_cut','mission_mingle');

-- 3) RPCと表の削除（migration 0002 / 0003 / 0004 の定義と同じシグネチャ）
-- オチから話して
drop function if exists public.ochi_hands_ok(jsonb, jsonb, jsonb, uuid, boolean);
drop function if exists public.ochi_actor_ok(uuid, uuid, uuid);
drop function if exists public.ochi_open_turn(uuid);
drop function if exists public.ochi_create_room(uuid, text, text, text, timestamptz, jsonb, integer);
drop function if exists public.ochi_start(uuid, uuid, bigint, jsonb, jsonb);
drop function if exists public.ochi_confirm(uuid, integer, uuid);
drop function if exists public.ochi_force_ready(uuid, integer, uuid);
drop function if exists public.ochi_swap(uuid, integer, uuid, jsonb);
drop function if exists public.ochi_begin_tell(uuid, integer, uuid);
drop function if exists public.ochi_finish_tell(uuid, integer, uuid, text);
drop function if exists public.ochi_lock_truth(uuid, integer, uuid, text);
drop function if exists public.ochi_skip(uuid, integer, uuid);
drop function if exists public.ochi_cast_vote(uuid, integer, uuid, text);
drop function if exists public.ochi_close_vote(uuid, integer, uuid);
drop function if exists public.ochi_reveal(uuid, integer, uuid, text);
drop function if exists public.ochi_next_turn(uuid, integer, uuid, jsonb);
drop function if exists public.ochi_finish(uuid, uuid);
drop table if exists public.ochi_results, public.ochi_votes, public.ochi_turns, public.ochi_games;
-- ワンカット
drop function if exists public.one_cut_member_order(uuid);
drop function if exists public.one_cut_actor_ok(uuid, uuid, uuid);
drop function if exists public.one_cut_finalize(uuid);
drop function if exists public.one_cut_award_winners(uuid, integer);
drop function if exists public.one_cut_insert_take(uuid, jsonb);
drop function if exists public.one_cut_score_take(uuid, uuid);
drop function if exists public.one_cut_create_room(uuid, text, text, text, timestamptz, jsonb, integer, text, text);
drop function if exists public.one_cut_start_take(uuid, uuid, integer, integer, uuid, jsonb, integer, jsonb, text, bigint);
drop function if exists public.one_cut_to_break(uuid, integer, uuid);
drop function if exists public.one_cut_ready(uuid, integer, uuid, timestamptz);
drop function if exists public.one_cut_expire(uuid, integer);
drop function if exists public.one_cut_cast_vote(uuid, integer, uuid, integer);
drop function if exists public.one_cut_close_vote(uuid, integer, uuid);
drop function if exists public.one_cut_skip(uuid, integer, uuid, jsonb);
drop function if exists public.one_cut_like(uuid, integer, uuid, uuid);
drop function if exists public.one_cut_close_break(uuid, integer, uuid, jsonb);
drop function if exists public.one_cut_finish(uuid, uuid, integer);
drop function if exists public.one_cut_state(uuid, uuid);
drop table if exists public.one_cut_results, public.one_cut_likes, public.one_cut_votes, public.one_cut_takes, public.one_cut_games;
-- ミッション・ミングル
drop function if exists public.mission_settings_ok(jsonb);
drop function if exists public.mission_preset_difficulties(text);
drop function if exists public.mission_item_ok(uuid, jsonb, text);
drop function if exists public.mission_summary_ok(uuid, jsonb);
drop function if exists public.mission_create_room(uuid, text, text, text, timestamptz, jsonb);
drop function if exists public.mission_configure(uuid, uuid, jsonb, bigint);
drop function if exists public.mission_start(uuid, uuid, jsonb, jsonb, bigint);
drop function if exists public.mission_set_status(uuid, uuid, uuid, text);
drop function if exists public.mission_swap(uuid, uuid, uuid, jsonb);
drop function if exists public.mission_expire(uuid);
drop function if exists public.mission_end_now(uuid, uuid, bigint);
drop function if exists public.mission_extend(uuid, uuid, integer, bigint);
drop function if exists public.mission_reveal_start(uuid, uuid, bigint);
drop function if exists public.mission_reveal_next(uuid, uuid, bigint, jsonb);
drop function if exists public.mission_finish(uuid, uuid, bigint);
drop table if exists public.mission_results, public.mission_swaps, public.mission_assignments, public.mission_games;

-- 4) CHECKを元の3種に戻す
alter table public.group_rooms drop constraint if exists group_rooms_game_type;
alter table public.group_rooms add constraint group_rooms_game_type
  check (game_type in ('cards','minority_topic','question_wolf')) not valid;
alter table public.group_rooms validate constraint group_rooms_game_type;
commit;
-- rollback-group-games: end
```

このSQLは `tests/rls/group-games-rollback.test.mjs`（PGlite）が、この文書から取り出して実行し、新ゲームのmigrationを適用した状態から元に戻ること（新ゲーム用の関数・表が残らず、3種のCHECKに戻り、既存3種のルームは残る）を確認しています。migration自体は`if not exists`/`or replace`で再適用できるため、ロールバック後に再度反映することもできます。

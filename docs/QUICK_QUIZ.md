# みんなで早押しクイズ

`quiz_buzz` は、既存のQRルームとvenue tableを使う2〜8人向けの自動判定クイズです。作成者も参加者として入室し、hostが回答を判定する方式は採用しません。

## ルール

- 既存difficulty（初級・中級・上級・特級）から6問をサーバー側で選び、問題順と4択の順序をshuffleする。
- 参加者は問題ごとに一度だけclaimできる。claimはDB transaction内で最初に確定した、サーバーで受け付けが確定した早押しを採用する。
- claim後の回答期限は10秒、問題全体の期限は45秒。
- 正解は+1点。誤答は0点で、その問題の回答権を失う。全員が失権するか期限に達するとrevealする。
- reveal後5秒で次問へ進み、6問終了で結果を表示する。同点は同点のまま表示する。
- クライアント時計によるミリ秒単位の公平性は保証せず、「サーバーで先に受け付けが確定したclaim」を基準にする。

回答中は正解IDと解説をクライアントへ返さない。正解データはprivateな`quiz_buzz_rounds`に保持し、reveal後だけprojectionに含める。standalone `/quiz.html` は既存のクライアントquizであり、対戦の秘密データ源には使わない。

## 適用

1. `server-side/quick-quiz-questions.mjs` とUIの `quiz_buzz` 対応を同一revisionで確認する。
2. `supabase/migrations/202610180001_quiz_buzz.sql` を既存migration順に適用する。`group_rooms.game_type`、private game/round/attempt tables、service-role限定RPC、RLSを追加する。
3. 適用後に、QR作成・2人join・start・claim race・誤答lock・期限・6問完了・venue tokenをローカルfixtureで確認する。
4. DBへのmigration適用を確認してからコードを公開する。未適用なら公開を保留する。既存gameのroom作成やactionをこの機能の未適用状態で壊してはならない。

本作業環境にはSupabase URL/service key、Postgres接続、psql認証がないため、本番DDLは実行していない。migrationはPGliteで適用し、RLS・RPC・期限・claimのDBテストをローカル実行済みである。PGliteは単一接続であり、本番同時接続性能やネットワーク公平性の証明ではない。

## 関連テスト

- `tests/quick-quiz-questions.test.mjs`
- `tests/quick-quiz-ui.test.mjs`
- `tests/quiz-buzz-backend.test.mjs`
- `tests/quiz-buzz-db.test.mjs`

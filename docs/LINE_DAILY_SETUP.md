# LINE「1日1問」運用設定

Mingleの永続グループで、同じ安全な組み込み質問を参加者それぞれのLINEアカウントへ個別DMします。LINEグループ投稿ではありません。24時間の`group_rooms`、pair/solo/R18/custom setはv1配信対象外です。

## 本番前に必要な設定

1. Supabaseへ`supabase/migrations/202610120001_daily_line.sql`だけを適用します。修正内容はこの001へ統合済みです。適用前は配信設定を保存・有効化しません。
2. LINE Official AccountとMessaging API channelを作り、channel secret/access tokenをserver-only環境変数へ登録します。
3. `POST /api/line/webhook`をLINE webhook URLへ登録し、LINE Developers ConsoleでWebhookの利用を有効化し、再送（redelivery）をONにします。署名検証のため、Vercelでは`NODEJS_HELPERS=0`を設定して再デプロイし、raw IncomingMessage bytesが取れる状態にします。
4. Supabase Authのredirect allowlistに`https://<公開ホスト>/daily.html`を登録します。
5. 外部schedulerから5分ごとに`POST /api/daily/cron`を呼びます。ヘッダーは`x-mingle-cron-secret`、値は`MINGLE_DAILY_CRON_SECRET`です。cron登録はこのリポジトリでは行いません。
6. migration後、運用者が`update public.line_delivery_settings set enabled=true where id=true;`をテスト確認後に実行し、環境変数`LINE_DELIVERY_ENABLED=true`も設定します。どちらかがfalse、またはLINE設定不足なら配信は停止し、グループ管理は利用できます。cron secretは長いランダム値を生成して`MINGLE_DAILY_CRON_SECRET`へ登録します。

## 連携と配信

公式アカウントのfollowまたは「連携」から公式link tokenを発行し、利用者がMingleへログインして明示確認した後、LINE account-link画面へ進みます。webhookのaccountLink nonceとLINE user IDが一致して初めて連携を有効化します。連携解除・停止・unfollowでは未送信配信を停止します。返信失敗など結果が不確実なlink要求は同じイベントを無限再試行せず、利用者が新たに「連携」を送ってやり直します。

質問はグループごと・JST等のIANA timezoneごとの日付で一度だけ確定します。新規作成・再開時に過去日のcatch-up送信はしません。当日質問の送信試行は、グループのlocal dateが現在の日付であり、最初の試行から24時間未満の場合だけ同じUUID retry keyで再試行します。期限後、または翌日以降は新しいkeyで再送しません。outbox leaseで同時実行を防ぎます。

## 主なURL

- `GET /daily.html`: 認証済みグループ、当日の質問、履歴、チェックイン
- `POST /api/daily/...`: グループ作成・招待・参加・設定・LINE受信設定
- `POST /api/line/webhook`: LINE署名付きwebhook
- `POST /api/daily/cron`: 外部scheduler用の保護されたdispatch

チャネルsecret/access token、service role key、cron secret、保存したLINE user IDは公開APIへ返しません。短命のlink token/setup token/nonceは、本人確認を伴う連携フローでのみブラウザへ渡します。回答本文やLINEの自由回答は保存しません。

## 既知の運用範囲

実LINE配信と本番Vercelデプロイは未検証です。外部schedulerも未登録です。ローカルDB検証は`npm run check:daily-db`、ブラウザmock検証は`PLAYWRIGHT_MODULE=<path-to-playwright/index.mjs> npm run check:daily-browser`で実行します。まずテスト環境で署名、account-link、配信停止、再送、DB enabledの両条件を確認してから本番を有効化してください。

PowerShellでのQA例（ターミナル1）：`$env:PORT='5182'; node server.mjs`。別のターミナル2で`$env:PLAYWRIGHT_MODULE='C:/temp/mingle-qa/node_modules/playwright/index.mjs'; npm run check:daily-browser`を実行します。本番送信は行わず、QAサーバーを5182で起動して検証します。

公式資料: [LINE Messaging API account linking](https://developers.line.biz/en/docs/messaging-api/linking-accounts/)、[LINE webhook signature](https://developers.line.biz/en/docs/messaging-api/receiving-messages/)、[Vercel Node.js runtime](https://vercel.com/docs/functions/runtimes/node-js)、[Vercel advanced Node configuration](https://vercel.com/docs/functions/runtimes/node-js/advanced-node-configuration)。

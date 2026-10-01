# Mingle.Cards 会話カード試作

## 起動

```powershell
cd C:\dev\carding\site
npm start
```

ブラウザで `http://127.0.0.1:5180` を開きます。サーバーは `dist` だけを配信し、パストラバーサルを拒否します。`PORT` 環境変数で別ポートを指定できます。

## 設計

- `dist/data/decks.js`: 8デッキ×40問のデータ。dateは通常40問に、R18追加候補をintimacyの元IDで参照。
- `dist/engine.js`: 通常40枚、または通常34枚＋R18 6枚の構成を重複なしで生成し、6枚区切り、戻る、参加者ローテーションを管理。
- `dist/access-policy.js`: 続行可否の非同期境界。現在は常に許可し、将来はサーバーで検証済みの課金権限に差し替える。
- `dist/app.js`: 参加者、テーマ、R18追加同意、カード進行のUI。入力や回答内容は保存しない。
- WebMCPは`document.modelContext.registerTool`が利用できるブラウザでのみ登録し、ページ離脱時にAbortControllerで解除します。未対応ブラウザでは通常のUIがそのまま動きます。

## 現在の制限

購入・決済、店舗コード、ログイン、回答の保存、アカウントは未実装です。R18のテーマや追加質問は全員18歳以上かつ話題への明示同意が必要です。続行権限を有料化する場合、ブラウザのフラグだけで許可せず、サーバー側で購入状態を検証してください。

参加者名と進行状態は端末内の実行中メモリだけに保持し、ページ更新でリセットされます。参加者は2〜8名です。WebMCPの実ブラウザ動作は未検証で、通常UIとengineのNodeテストを検証対象にしています。

## 検証

```powershell
npm run check
```

## 管理画面と利用統計

`/admin` は `ADMIN_PASSWORD` でログインする管理画面です。パスワードと `ADMIN_SESSION_SECRET` はサーバー環境変数だけで設定し、ブラウザや静的ファイルには埋め込みません。管理セッションは短期の署名済みHttpOnly cookieで、統計APIは認証済みセッションだけが利用できます。

統計は個人情報を保存せず、許可済みの画面ID・テーマID・JST日付だけを共有Redisへ保存します。PVは画面遷移につき1回、テーマ開始数は正常にセッションを作成できた回数です。再描画、テーマのradio選び直し、同じeventの通信retryは増分しません。管理画面の操作と無効イベントは集計対象外です。表示期間は今日、過去7日、過去30日、累計で、累計は計測開始時点からの値です。

本番の永続化には `UPSTASH_REDIS_REST_URL` と `UPSTASH_REDIS_REST_TOKEN` を設定します。Vercel KV接続で提供される `KV_REST_API_URL` / `KV_REST_API_TOKEN` も互換fallbackとして利用できます。`ADMIN_PASSWORD` と `ADMIN_SESSION_SECRET` は必須で、代替値やfallbackはありません。永続storeまたは認証秘密がない本番環境は503で停止します。

開発環境は `ANALYTICS_NAMESPACE=development` など、productionと異なるnamespaceを必ず使ってください。明示的に `ANALYTICS_LOCAL_STORE=1` を設定した場合だけ `.data/analytics.json` をローカル保存先にします。テストは一時ディレクトリを使い、実Redisや開発集計へ書き込みません。`.env.local` はGit管理外です。

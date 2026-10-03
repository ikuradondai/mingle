# Mingle.Cards 任意アカウント設定

ゲストプレイはSupabaseなしで動作します。アカウント機能を有効にする場合は、Mingle専用のSupabaseプロジェクトを用意します。VercelではMarketplaceのSupabaseリソースをMingleプロジェクトへ接続できます。現在接続しているリソース名は `supabase-bisque-field` です。Vercel Marketplaceの接続は環境変数を同期しますが、管理対象のSecret値はローカルCLIから読めない場合があります。空のローカルpull結果だけで未設定とは判断せず、デプロイ後の `GET /api/account/config` を、キーの値を表示しない方法で確認してください。

公式資料：

- [Supabase Vercel Marketplace](https://supabase.com/docs/guides/integrations/vercel-marketplace)
- [Vercel Marketplace integration](https://vercel.com/docs/integrations/install-an-integration/product-integration)
- [Vercel環境変数](https://vercel.com/docs/environment-variables)

## 設定手順

1. Vercel Marketplaceで専用SupabaseリソースをMingleプロジェクトへ接続します。ProductionとPreviewのscopeを確認します。サーバーで利用する設定は概ね次の名前です。管理用Secret（service_role等）はサーバー専用で、ブラウザへ渡しません。publishable keyはクライアント公開用です。

   ```env
   SUPABASE_URL=https://YOUR_PROJECT.supabase.co
   SUPABASE_PUBLISHABLE_KEY=sb_publishable_YOUR_PUBLIC_KEY
   SUPABASE_SERVICE_ROLE_KEY=
   SUPABASE_GOOGLE_ENABLED=false
   ```

   `SUPABASE_SERVICE_ROLE_KEY` は安全なサーバー環境だけに設定します。削除処理を使わない場合は空のままにできます。VercelのSecret値やAPIキーをリポジトリへ保存しないでください。

2. PreviewまたはProductionへデプロイ後、`GET /api/account/config` が `enabled:true`、正しいSupabase URL、公開キーの存在、`googleEnabled:false` を返すことを確認します。公開キーの値やSecretはログに出しません。短命なPreview URLはドキュメントへ固定記録せず、実際のデプロイURLをSupabase URL Configurationへ登録します。

3. Supabase SQLエディタまたはCLIで `supabase/migrations/202610020001_accounts.sql` と `supabase/migrations/202610030001_custom_cards.sql` を順に適用します。お気に入りとマイセットは `auth.uid() = user_id` のRLSで所有者だけが読み書きできます。カードIDの存在・利用可否はサーバーで検証し、セット名と6〜40枚・重複なしの制約はサーバーとDBで検証します。自作カードは本人だけが読み書きでき、本文はtrim後1〜300 Unicode code points、改行・制御文字なし、R18指定必須です。自作カードを含むセットも6〜40枚・重複なしで、別ユーザーのカードは参照できません。

4. Supabase Authentication → URL Configurationで、Site URLを本番の `https://mingle.cards/` に設定します。Redirect URLsには開発の `http://127.0.0.1:5180/` と、実際に使用するPreviewデプロイURL（例：`https://<preview-deployment>.vercel.app/`）を個別に登録します。Preview URLは実際に使用するものだけを追加します。Supabaseのredirect URL仕様は[公式資料](https://supabase.com/docs/guides/auth/redirect-urls)を確認してください。

5. OTPを利用する前にCustom SMTPを設定します。Supabase組み込み送信はテスト用途・プロジェクトチーム宛てを中心とした制限付きです。現在の送信元候補はResendの `no-reply@auth.mingle.cards`、送信者名 `Mingle.Cards`、SMTPホスト `smtp.resend.com`、ポート465です。SMTPユーザーは `resend`、パスワードには送信用に制限した専用Resend APIキーを設定します。APIキーはリポジトリやチャットへ保存しません。`auth.mingle.cards` のDKIM/SPF/MX設定が完了し、Resend側で検証済みになるまで本番OTPを有効化しないでください。Resend以外のCustom SMTPやSend Email Auth Hookも利用できます。

6. Authentication → ProvidersでEmailプロバイダーを有効にします。メール設定（Emails → Magic link or OTP template）を確認し、クライアントはSupabaseが発行するOTPを使います。OTPの桁数はSupabaseの設定に従います。リンク形式ではなくコードを表示する場合は、SMTP設定後にメールテンプレートを次のようにします。

   ```html
   <p>Mingle.Cardsのサインインコードは <strong>{{ .Token }}</strong> です。</p>
   <p>コードには有効期限があります。心当たりがなければこのメールを無視してください。</p>
   ```

7. Googleを使う場合は、GoogleコンソールのAuthorized redirect URIに `https://YOUR_PROJECT.supabase.co/auth/v1/callback`（カスタムAuthドメインならそのドメイン）を登録します。Google providerとcallbackの設定が完了するまで `SUPABASE_GOOGLE_ENABLED=false` のままにします。現在Google providerは未完了として扱います。

8. リポジトリで `npm ci`、続けて `npm run build:account-sdk` を実行し、固定バージョン `@supabase/supabase-js@2.117.2` のブラウザ用 `dist/vendor/supabase.js` を再生成します。未設定時は `GET /api/account/config` が `enabled:false` を返し、ゲストプレイを継続します。

表示名と退会：表示名はSupabase Authの`user_metadata.display_name`に保存します。`PATCH /api/account/profile` は`{ "displayName": "..." }`だけを受け付け、trim後40 Unicode code points以内（空文字で解除）です。`GET /api/account/me` の`account.deletionAvailable`が`true`のときだけ退会を有効にします。退会APIは`DELETE /api/account`に`{ "confirmation": "DELETE" }`を要求し、サーバーのservice roleで本人のAuth userを削除してから、外部キーのcascadeでfavorites、my_sets、自作カードを削除します。service roleがない環境では503となり、成功扱いにしません。UIで利用できない場合は `inquiry@erudaite.ai` へご連絡ください。対応に必要な範囲で本人確認を行います。

## 検証

RLSの実行検証は外部プロジェクトを使わず、`tests/rls` で `npm ci` → `npm run test:rls` を実行します。PGlite上で所有者分離、別ユーザーの読取・更新・削除・所有権移転拒否、匿名拒否、制約、auth.users削除時のカスケードを検証します。通常の `npm run check` にはこのSQL-WASM検証を含めていません。

保存するデータはユーザーID、質問ID、自作カードの本文・R18指定・作成更新日時、セット名、作成・更新日時です。静的カードの本文や回答、参加者名はアカウントAPIへ送信しません。自作カード本文は匿名集計・フィードバックへ送信しません。ゲーム中の回答者別いいねは従来どおり端末内の進行データです。

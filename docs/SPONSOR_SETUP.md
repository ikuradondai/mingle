# Sponsor sets

`supabase/migrations/202610110002_sponsors.sql` defines the operator-managed sponsor set store. `202610110003_sponsor_assets.sql` adds the nullable design/image metadata and the `sponsor-assets` Storage bucket. These migrations are repository-only until reviewed and applied through the existing Supabase production procedure; this change does not apply them to any database.

The public read route is `GET /api/sponsors` and `GET /api/sponsors?id=<uuid>`. It exposes only rows with `status=published`; the detail response includes the immutable card snapshot. Operator CRUD is under `GET|POST|PATCH /api/admin/sponsors` and requires the existing admin session and same-origin check. The service role is the only database role granted table access.

運営の作成画面は `/admin-sponsor-cards.html` です。作成時は6〜40枚を指定し、`draft`で保存できます。管理画面から`published`へ切り替えると公開一覧に出て、`draft`へ戻すと公開停止になります。公開表示は提供元名を明示しますが、未確認の公式バッジは付けません。

The API enforces 6–40 cards, stable UUID card IDs, bounded text, the existing category and audience allowlist, and HTTPS site URLs without credentials. `draft` and `published` are the only statuses; publishing or stopping a set is an admin PATCH. No billing, placement period, verification badge, or public sponsor-user role is defined here.

画像は管理画面から`POST /api/admin/sponsors?asset=1`でアップロードします。PNG/JPEG/WebPの実体を検証し、1画像3MiB・縦横4096pxまで、`sponsor-assets/{uuid}.{ext}`へ保存します。セットには既存のデザインpresetと、任意のサムネイル・カード表・カード裏pathを保存します。画像の削除APIは設けず、セットから外す場合はmetadataだけを更新します。CSV/XLSXの質問取込は画面側で5MiB・1000行・64列以内、質問本文300文字以内として6〜40件へ正規化し、既存のカード保存APIへ渡します。XLSX readerは`read-excel-file`（MIT）を`vendor/sponsor-import-excel-entry.js`から`npm run build:sponsor-import`で再生成します。依存とライセンスは`package-lock.json`に固定し、配布bundleの著作権本文は`dist/vendor/sponsor-import-excel.LICENSE.txt`に収録しています。

## Applying the migration

The local repository has no linked Supabase CLI project. The Vercel project has encrypted `POSTGRES_URL`/Supabase connection variables, but their values must not be pulled into source control or logs. After SQL review, run both migrations against a disposable PostgreSQL/Supabase database first, then open `supabase/migrations/202610110002_sponsors.sql` and `supabase/migrations/202610110003_sponsor_assets.sql` in the authenticated Supabase SQL Editor and execute them once after review; verify the table/RLS and Storage bucket constraints before enabling the admin page. The equivalent operator CLI procedure is `psql -v ON_ERROR_STOP=1 -f supabase/migrations/202610110002_sponsors.sql` followed by the assets migration; do not run it from an application request or without a rollback plan. The PGlite smoke script is `tests/rls/sponsor-verify.mjs` and does not contact production.

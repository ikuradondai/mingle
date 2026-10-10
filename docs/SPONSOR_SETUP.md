# Sponsor sets

`supabase/migrations/202610110002_sponsors.sql` defines the operator-managed sponsor set store. It is repository-only until the migration is reviewed and applied through the existing Supabase production procedure; this change does not apply it to any database.

The public read route is `GET /api/sponsors` and `GET /api/sponsors?id=<uuid>`. It exposes only rows with `status=published`; the detail response includes the immutable card snapshot. Operator CRUD is under `GET|POST|PATCH /api/admin/sponsors` and requires the existing admin session and same-origin check. The service role is the only database role granted table access.

運営の作成画面は `/admin-sponsor-cards.html` です。作成時は6〜40枚を指定し、`draft`で保存できます。管理画面から`published`へ切り替えると公開一覧に出て、`draft`へ戻すと公開停止になります。公開表示は提供元名を明示しますが、未確認の公式バッジは付けません。

The API enforces 6–40 cards, stable UUID card IDs, bounded text, the existing category and audience allowlist, and HTTPS site URLs without credentials. `draft` and `published` are the only statuses; publishing or stopping a set is an admin PATCH. No billing, placement period, verification badge, or public sponsor-user role is defined here.

## Applying the migration

The local repository has no linked Supabase CLI project. The Vercel project has encrypted `POSTGRES_URL`/Supabase connection variables, but their values must not be pulled into source control or logs. After SQL review, run the migration against a disposable PostgreSQL/Supabase database first, then open `supabase/migrations/202610110002_sponsors.sql` in the authenticated Supabase SQL Editor and execute it once after review; verify the table/RLS constraints before enabling the admin page. The equivalent operator CLI procedure is `psql -v ON_ERROR_STOP=1 -f supabase/migrations/202610110002_sponsors.sql`; do not run it from an application request or without a rollback plan. The PGlite smoke script is `tests/rls/sponsor-verify.mjs` and does not contact production.

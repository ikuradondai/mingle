# Marketplace backend (free community listings)

The marketplace is an optional backend feature. It publishes immutable versions of completed 6–40 card `my_sets`; an import creates an independent private `my_sets` copy and custom-card copies. Updating a listing creates a new version. Withdrawing a listing blocks new imports but does not change existing copies.

Apply `supabase/migrations/202610110001_marketplace.sql` after the existing account, custom-card, shared-set, draft, metadata, and adult-gate migrations. The migration is intended to be idempotent. It has not been applied to production by this change.

## API

- `GET /api/marketplace?limit=20&offset=0&search=&category=&audience=`: guest-safe active catalog. Adult entries are excluded unless an authenticated request includes `showR18=true` and the server verifies age confirmation in both API and database RPC.
- `GET /api/marketplace/:listingId`: metadata and at most three preview cards without card IDs; adult detail is unavailable unless the same server-side gate succeeds.
- `POST /api/marketplace/publish`: authenticated owner; body includes `setId`, `name`, `description`, fixed category, `publisherName` or `匿名`, `audience`, `questionOrder`, and `showR18` for adult sets.
- `POST /api/marketplace/import`: authenticated user; body `{ listingId, showR18 }`. The RPC is idempotent per listing and user.
- `PUT /api/marketplace/like`: authenticated user; body `{ listingId, liked, showR18 }`. One vote per user.
- `POST /api/marketplace/withdraw`: authenticated owner; body `{ listingId }`.
- `GET /api/marketplace/owner`: authenticated owner listings, including withdrawn entries.

The service uses the verified bearer user only to authorize the operation and uses the configured service role for sensitive RPC execution. If the service role or migration is unavailable, the feature returns `FEATURE_UNAVAILABLE` rather than bypassing database checks. Source owner IDs, private card IDs, favorites, and full card snapshots are never included in public catalog responses. The marketplace migration is still repository-only and was not applied to production by this change.

## UI導線

`/marketplace.html` はゲストでも公開テーマを閲覧できます。ログイン後は「ライブラリへ追加」「いいね」「自分の公開テーマ」を利用でき、Set Studioの完成済みマイセットには「公開する」リンクが表示されます。公開は確認画面を経由し、取り込み・いいね・停止は二重送信を抑止します。`/?library=1` は既存のログイン済みライブラリ入口です。

R18は既存の年齢確認に加えて、アカウント単位の「R18を表示する」が明示的にオンのときだけ一覧、詳細プレビュー、公開操作へ進めます。入力中の質問本文や認証トークンは公開画面のURLやsessionStorageへ保存しません。

## Verification

`node tests/rls/marketplace-verify.mjs` applies the migration twice in disposable PGlite and checks immutable versions, full snapshot copies, delete and re-import idempotency, distinct import counts, R18 age/display gates, owner isolation, withdrawal, and grants. `node tests/qa-marketplace.mjs` runs the publish, import, like/unlike, withdraw, R18, auth-generation and library deep-link browser flow against a local server on port 5182. This browser QA uses the locally available Playwright runtime at `C:/temp/mingle-qa/node_modules/playwright/index.mjs`; no repository dependency is added. The OTP flow was also verified with a local mocked Supabase SDK. The current repository suite passes 216 tests.

Supabase Auth Redirect URLs must allow `https://mingle.cards/marketplace.html` in production and `http://127.0.0.1:5182/marketplace.html` for local QA because the standalone screen uses its current origin for Google and email OTP returns. The existing Auth configuration was not inspected or changed by this work.

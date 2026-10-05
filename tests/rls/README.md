# 共有RLSの実DB検証

`share-verify.mjs` はPGlite上でaccounts、custom_cards、shared_sets migrationを順に実行し、匿名SELECT拒否、別owner不可視、owner読取、Auth削除cascadeをassertします。リポジトリ本体にはPGlite依存を追加していないため、既存の一時runtimeへファイルをコピーして実行します。

```powershell
Copy-Item tests/rls/share-verify.mjs ../artifacts/accounts/sql-runtime/share-verify.mjs
node ../artifacts/accounts/sql-runtime/share-verify.mjs
Remove-Item ../artifacts/accounts/sql-runtime/share-verify.mjs
```

この検証は外部Supabase projectへ接続せず、migration適用も行いません。

プロフィール画像のStorage RLSは、実Storage schemaの最小stub上で次のように検証できます。

```powershell
Copy-Item tests/rls/avatar-verify.mjs ../artifacts/accounts/sql-runtime/avatar-verify.mjs
$env:MINGLE_SITE_ROOT=(Get-Location).Path
node ../artifacts/accounts/sql-runtime/avatar-verify.mjs
Remove-Item ../artifacts/accounts/sql-runtime/avatar-verify.mjs
```

Set-draft migration/RPC verification (PGlite):

```powershell
Copy-Item tests/rls/set-draft-verify.mjs ../artifacts/accounts/sql-runtime/set-draft-verify.mjs
Push-Location ../artifacts/accounts/sql-runtime
$env:MINGLE_SITE_ROOT=(Resolve-Path ../../../site).Path
node set-draft-verify.mjs
Pop-Location
Remove-Item ../artifacts/accounts/sql-runtime/set-draft-verify.mjs
```

The temporary runtime already contains the pinned `@electric-sql/pglite` dependency; the repository itself does not add a PGlite dependency.

R18 age-confirmation gate verification (PGlite). It applies `202610020001_accounts.sql`, `202610070001_venues.sql`, `202610080001_group_rooms.sql` and then `202610090001_adult_gate.sql` in that order, with legacy R18 venue/room rows inserted before the gate migration:

```powershell
Copy-Item tests/rls/age-confirmation-verify.mjs ../artifacts/accounts/sql-runtime/age-confirmation-verify.mjs
Push-Location ../artifacts/accounts/sql-runtime
$env:MINGLE_SITE_ROOT=(Resolve-Path ../../../site).Path
node age-confirmation-verify.mjs
Pop-Location
Remove-Item ../artifacts/accounts/sql-runtime/age-confirmation-verify.mjs
```

`tests/rls` has its own `node_modules` with PGlite, so `node age-confirmation-verify.mjs` also works when run from `tests/rls` (no env var needed). It checks: `account_profiles` is owner-select only and direct writes are refused, `set_adult_confirmation` keeps the first timestamp and deletes the row on revoke (no history, and no row for a never-confirmed user), `anon` cannot execute the RPCs, `group_create_room` / `group_join_member` enforce account confirmation, host attestation and the participant age tap, the old RPC signatures are dropped, `venues_adult_guard` stamps and protects the attestation, unattested R18 venues are switched off and unattested R18 rooms (with their members) are deleted by the migration, and the profile row cascades with the auth user.

Apply the migration to a real project BEFORE deploying the application code; the new server code sends `p_adult_attested` / `p_age_confirmed`, which the old functions do not accept.

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

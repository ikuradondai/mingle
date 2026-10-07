# Shared and venue content hardening

This change is intentionally split into phases. Do not run these migrations against production from the application worker.

## Prerequisites

Set `SHARED_TOKEN_ENCRYPTION_KEY` in the server runtime to a randomly generated value of at least 32 characters. Keep the value in the deployment secret store; it must never be committed, logged, or replaced during an ordinary deploy. The key is separate from `SUPABASE_SERVICE_ROLE_KEY`, so service-role rotation does not invalidate existing share URLs.

## Apply order

1. Apply `202610130001_shared_venue_hardening.sql` and `202610130003_group_room_cap.sql` using a migration connection. Phase A adds the nullable ciphertext column, guards, server RPCs, and the group-room cap. Existing rows are not rewritten, deleted, or made more public. The old authenticated write paths remain available during this phase so the application can be deployed safely.
2. Deploy the server code with `SHARED_TOKEN_ENCRYPTION_KEY` present. Sharing and venue-set writes use service-role RPCs; without the dedicated key, new share issuance fails closed with `FEATURE_UNAVAILABLE`. There is no unsafe fallback to the old RPC.
3. Run the backfill in dry-run mode: `node scripts/shared-token-backfill.mjs`. Review only the count and errors; token values are never printed.
4. During a controlled maintenance window, run `node scripts/shared-token-backfill.mjs --apply`. For each row, the script encrypts and verifies the token, then performs one atomic PATCH that writes `token_ciphertext` and `token: null`; it reads the row back and verifies the stored ciphertext before continuing. The operation is idempotent and can recover rows where both columns are present. Run `--rollback` only as an explicit recovery operation when plaintext restoration is authorized; it scans ciphertext rows regardless of whether cleanup has already completed and verifies the decrypted token/hash before restoring plaintext.
5. After application health checks, apply `202610130002_shared_venue_lockdown.sql`. This revokes authenticated/anon/public direct DML and all legacy RPC execute privileges. Keep the phase-A RPC execute grants only for `service_role`.

Never apply Phase B before the server deployment and Phase-A migration are confirmed. Never rotate `SHARED_TOKEN_ENCRYPTION_KEY` without a planned ciphertext re-encryption migration; a failed decrypt returns a safe error and does not emit a URL containing `null`.

## Verification

Run the repository's PGlite RLS checks from `tests/rls` after installing its pinned dependencies. The API share/venue tests cover canonical snapshot reconstruction, false adult declarations, theme-level R18, service-RPC routing, consent gates, and legacy compatibility. Database verification must additionally exercise authenticated/anon direct DML, legacy RPC denial after Phase B, service RPC writes, malformed cards, duplicate IDs, 41 cards, overlong text, payloads above 64 KiB, owner and venue caps, and concurrent inserts. Existing oversized or adult-theme-only rows must be observed unchanged immediately after Phase A.

The system derives R18 for standard cards and saved custom-card metadata. Public share and venue reads conservatively OR the stored flag with the current canonical R18 metadata for known standard IDs, so a legacy false flag cannot bypass the gate; the snapshot text is not rewritten. It cannot claim to semantically classify arbitrary user-written text. The client-supplied `adult_only`/`r18` values are not authoritative.

Phase A and Phase B explicitly remove `TRUNCATE`, `REFERENCES`, and `TRIGGER` from public, anon, and authenticated on snapshot tables. Phase A retains only the legacy row-write verbs needed during cutover; Phase B revokes those as well. This prevents administrative table privileges from bypassing RLS or the RPC boundary.

The checked-in PGlite verification uses a targeted fixture with the migration's relevant columns, roles, guards, and metadata hook. It proves the listed shape, permission, and cap assertions and checks Phase-A legacy-call compatibility, but PGlite's single-writer runtime does not prove concurrent PostgreSQL scheduling. The owner advisory locks and venue-row locks therefore still require a normal PostgreSQL concurrency smoke test before production rollout.

The group-room migration caps each owner at 20 active, unexpired rooms. It uses an owner advisory transaction lock and a BEFORE INSERT trigger, so both the RPC and service-role REST inserts share the same atomic cap while expired and ended rooms do not count.

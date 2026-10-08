# Security hardening notes

## Rate limits and retention

The unauthenticated analytics endpoints use a fixed one-minute window. Tracking is limited to 60 requests per client key and feedback to 10 requests per client key. Client keys are HMAC-derived and the Redis key is SHA-256 bounded; raw IP addresses are never stored. The Vercel forwarded address is trusted only in the Vercel runtime. Other runtimes use the socket address.

Feedback deduplication expires after 48 hours. On each Redis write, the feedback sorted set is pruned to entries from the preceding 90 days and capped at 10,000 entries; the sorted-set key expires 90 days after its most recent write. Therefore, during an inactive period, an individual entry is not guaranteed to disappear at exactly 90 days without a scheduled maintenance prune. The API response still caps returned feedback at 100 entries.
Existing deployments should run the reviewed dry-run migration helper before applying TTLs to legacy `feedbackDedup` keys and removing stale members from the feedback sorted set; the application path only guarantees cleanup for writes after this version.
The helper reports only namespace and counts. Use `--max-batches=N` for bounded work and resume a truncated scan with its reported `--cursor=...`; it atomically applies TTL only when the key still has no TTL, and applies sorted-set expiry, stale removal, and the 10,000-member cap together when `--apply` is explicitly used.
The local JSON store applies the same 48-hour dedup, write-time 90-day feedback prune, 10,000-entry cap, and one-minute rate-key expiry during normal development runs; it does not mutate while the process is stopped.

Venue public metadata GETs are limited to 60 per QR token per minute plus a 6,000-request client-IP aggregate; starts are limited to 20 per QR token per minute and events to 120 per QR token per minute. Venue creation is limited to 10 per authenticated owner per minute. Group-room creation is limited to 10 per authenticated owner per minute. Group-room state polling allows 180 requests per member token per minute and 6,000 requests per client IP per minute, preserving normal one-second polling for several participants behind one NAT. An active-room-per-owner database cap still needs an atomic RPC/owner lock and is deferred to the group-room SQL phase. Venue usage statistics currently paginate until completion; a silent row cap would make totals inaccurate. Product billing or payment enforcement is not implemented in this repository.
Group join, preview, and action endpoints also have room/IP aggregate limits to reduce unauthenticated database work before invite/member authorization. Venue set creation, table issuance, and QR rotation use the authenticated owner limiter; existing owner and age authorization remains enforced by the service.

## Admin sessions

Admin sessions remain signed, expiring tokens. In Redis deployments, logout atomically records a hash of the token with its remaining lifetime and subsequent verification rejects it. Development and tests use an in-process fallback. Production requires `ADMIN_PASSWORD` and an `ADMIN_SESSION_SECRET` of at least 32 characters; a missing password or a short session secret fails closed. The production cookie is `__Host-mingle_admin` with Secure, HttpOnly, Path=/, and SameSite=Strict. The legacy cookie is not accepted for authentication in production and is cleared during logout.

Before deploying, verify the presence of `ADMIN_PASSWORD`, `ADMIN_SESSION_SECRET`, and the configured Redis URL/token by key name only. Keep the session secret at 32 characters or longer to avoid an administrative lockout.

## Response headers and CSP rollout

Vercel applies security headers through a first route with `continue: true`, before the filesystem route, following Vercel's documented route continuation behavior: https://vercel.com/docs/rewrites/rewrites#routes. The CSP is `Content-Security-Policy-Report-Only` while the current inline markup and browser dependencies are inventoried. `connect-src` includes the app origin and Supabase REST/Auth/Storage/Realtime origins; server-to-server OpenAI and LINE calls do not belong in browser CSP. Existing dynamic `style="..."` attributes and inline scripts are why `style-src 'unsafe-inline'` and report-only `script-src 'self'` remain until nonce/hash migration. No report endpoint is configured yet, so deployment review should collect browser console violations or add a dedicated bounded report endpoint before enforcement.

The client-IP choice follows Vercel's documented proxy headers: https://vercel.com/docs/headers/request-headers. Only the Vercel runtime uses the forwarded chain; local runtimes use the socket address. The forwarded value is HMAC-derived before it becomes a rate key.

Supabase dashboard state, billing configuration, and production runtime values are outside this repository and must be checked separately without exposing secret values.

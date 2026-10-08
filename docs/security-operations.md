# Security operations

This runbook records the rotation order and the provider checks required before a production change. It does not contain credentials or provider state. The current Supabase dashboard values are unverified because this workspace has no Supabase management connector.

## Key rotation order

1. Inventory the key and its consumers. Keep the new value out of source control, logs, screenshots, and chat. Relevant server-only keys include `ADMIN_PASSWORD`, `ADMIN_SESSION_SECRET`, `SHARED_TOKEN_ENCRYPTION_KEY`, `MINGLE_DAILY_CRON_SECRET`, `LINE_CHANNEL_SECRET`, `LINE_CHANNEL_ACCESS_TOKEN`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, and provider Redis/OpenAI credentials.
2. Generate a new value using the provider or a cryptographically secure local tool. For `SHARED_TOKEN_ENCRYPTION_KEY`, confirm the implementation's required encoding and length before provisioning.
3. Update the secret in the owning provider: Vercel project environment variables for runtime keys, LINE Developers for LINE credentials, and Supabase project settings or secrets for Supabase-owned credentials. Update every required environment target. The provider determines whether overlap is possible: credentials such as LINE channel secrets may invalidate immediately when replaced, while application secrets may require a dual-read or overlap window. Do not assume the old value can remain valid.
4. Deploy and run the smallest safe health checks. Confirm the application starts, protected admin/session flows work, token decrypt/read paths work where applicable, and scheduled/webhook authentication accepts the new value. Do not test against production Redis from this local workspace.
5. Revoke or remove the old value only after the deployment is healthy and no old workers remain. Record the rotation date and affected key name without recording the value.

Before a production release, verify the required key names are present and confirm `ADMIN_SESSION_SECRET` is at least 32 characters. The production admin API intentionally fails closed when the password is missing or the session secret is too short, so either condition is a release blocker and can lock operators out.

The linked Vercel project can be checked read-only with `vercel env ls --format json`; this returns environment-variable names without secret values. Provision `SHARED_TOKEN_ENCRYPTION_KEY` through the Vercel dashboard or `vercel env add SHARED_TOKEN_ENCRYPTION_KEY production --sensitive` using an approved secret-input method. Never pass a real value in a committed file or shell history. The CLI can confirm presence but cannot safely report the stored secret length; validate the required length through the deployment release check or provider UI without printing the value.

For `ADMIN_PASSWORD`, existing operators must use the new password after deployment. Existing admin sessions are governed by `ADMIN_SESSION_SECRET`; rotating it invalidates sessions signed with the previous secret. Rotating `SHARED_TOKEN_ENCRYPTION_KEY` requires an explicit migration or dual-read plan if existing encrypted tokens must remain readable.

## Supabase dashboard review

Review these settings in the Supabase dashboard before production launch and record only the setting status, never credentials:

- Authentication → Providers: confirm anonymous sign-ins are enabled only if the application requires them; otherwise disable them. Supabase recommends CAPTCHA or Turnstile when anonymous sign-ins are enabled. See the [anonymous sign-ins guide](https://supabase.com/docs/guides/auth/auth-anonymous).
- Authentication → Email: confirm OTP expiry is within the chosen operational window and review email rate limits. Supabase's passwordless guide documents a 1-hour default for Email OTP and Magic Links; values above 86,400 seconds are strongly discouraged. Keep expiry and rate values documented separately from secrets. See [passwordless email sign-in](https://supabase.com/docs/guides/auth/auth-email-passwordless) and [rate limits](https://supabase.com/docs/guides/auth/rate-limits).
- Authentication → Security/CAPTCHA: confirm CAPTCHA is enabled only together with client integration: `signInWithOtp`, `signUp`, and anonymous sign-in calls must pass the appropriate `captchaToken` where required. Confirm the provider and site key match the deployed origin. Enabling the dashboard setting without updating the client can break sign-in. Supabase supports hCaptcha and Cloudflare Turnstile; see [CAPTCHA protection](https://supabase.com/docs/guides/auth/auth-captcha) and [anonymous sign-ins](https://supabase.com/docs/guides/auth/auth-anonymous).
- Authentication → URL Configuration: replace redirect wildcards with the smallest explicit allowlist of production callback URLs. Remove localhost, preview, and broad wildcard entries from production. See [redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls).
- Recheck after deployment from the provider dashboard because this workspace cannot read or verify the current remote state. Any setting that cannot be confirmed remains an open deployment check.

The dashboard values and whether the production project currently satisfies these checks are unverified here. Having production access does not mean this local task can apply or validate those external changes without a management connector.

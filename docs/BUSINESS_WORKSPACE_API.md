# Business workspace API contract

CSV import does not create Auth accounts or send invitations. Employees sign in through the existing email verification flow; a first-time Auth account may be created by that flow. The business surface does not send LINE messages, store CSV source text, play participant names, answers, or recordings. Existing personal account APIs are unchanged.

All endpoints require a verified `Authorization: Bearer` session. The server resolves membership from the database; a client supplied organization header is not authorization.

- `POST /api/business/organizations` `{slug,name}` creates an organization. The verified caller becomes the owner. Owners may create at most three organizations.
- `GET /api/business/organizations` lists the caller's active memberships.
- `POST /api/business/organizations/:orgId/members/import` accepts `text/csv` with the exact header `email,display_name,department`, or JSON `{rows:[...]}`. The limit is 500 rows and 256 KiB. Duplicate rows fail; existing members are skipped. No Auth account is created.
- Membership access requires the current verified Auth email to continue matching `email_normalized`. If a user changes their Auth email, the old membership remains retained but inaccessible; an admin removes the old row and imports the new address.
- `PATCH /api/business/organizations/:orgId/members/:memberId` accepts `{status}` (`active`, `suspended`) or owner-only `{role}` (`admin`, `member`). Owners cannot be suspended/demoted. A suspended unclaimed row remains pending until a verified matching login claims it.
- `DELETE /api/business/organizations/:orgId/members/:memberId` removes only the organization membership; it never deletes the Auth account or personal data. Admins can remove members; owners can remove admins and members.
- `DELETE /api/business/organizations/:orgId` is owner-only and cascades the organization membership and policy rows. Deleting an Auth user cascades their organization membership; it does not recreate a pending member.
- `PUT /api/business/organizations/:orgId/policy` accepts `allowedThemeIds` and all five boolean `featureFlags`: `group_play`, `solo_play`, `theme_mix`, `audio`, `theme_tags`. The server rejects unknown flags and R18 themes. At least one of group/solo must remain enabled.
- `GET /api/business/organizations/:orgId/workspace` returns only policy-allowed static, non-R18 theme metadata and effective features.
- `POST /api/business/organizations/:orgId/sessions` accepts `{mode,themeIds,participantCount}`. Membership and policy are rechecked; mode, count, mix, and theme allowlist are enforced server-side. The response contains a non-R18 question snapshot and policy features. No participant names or answers are accepted.

The five feature flags are `group_play` (2–8 participants), `solo_play` (one participant), `theme_mix` (up to three allowed themes), `audio`, and `theme_tags`. The defaults are group/solo/audio/tags enabled and theme mix disabled. Roles are owner, admin, and member: owners can manage admins and members and delete the organization, admins can manage members and policy but cannot change admins, and members can only start an allowed session.

Business API reads are limited to 3,000 requests/minute per client IP and 120/minute per verified user. Mutations are limited to 120/minute per client IP and 60/minute per verified user. User keys are derived only after Supabase verifies the bearer token.

Workspace metadata returns allowed themes for every member. It returns the full non-R18 catalog and member-management rows only to owners/admins; employee responses do not contain other members' email addresses.
Theme metadata includes `participantRule` (`solo`, `pair`, or `group`) and each session theme includes the same rule; clients must use the server response rather than importing the full catalog.

The shared CSV parser is exported from `dist/business-csv.js`: it requires UTF-8 (BOM accepted), the exact three-column header, strict quote rules, non-empty data, and rejects malformed or oversized input before member import.

The SQL migration makes direct table access unavailable to anon/authenticated roles and exposes only service-role RPCs. RPCs recheck actor membership and role internally. If the migration or service key is unavailable, business endpoints return `503 BUSINESS_MIGRATION_UNAVAILABLE`; personal endpoints remain unaffected.

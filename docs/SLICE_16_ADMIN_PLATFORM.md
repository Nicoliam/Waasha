# SLICE 16 — Admin Platform

Production administrative control plane for Waasha. Admin operates the
platform through explicit, audited domain services — never arbitrary
database CRUD, never direct state-machine bypasses.

## 1. Authorization model

- Isolated namespace: `/api/v1/admin/*` (never under
  `/api/v1/providers/*` or `/api/v1/customers/*`).
- `requireAdmin` (`backend/src/modules/admin/admin-auth.ts`): session-derived
  and **DB-verified** — resolves `user_roles → roles` on every request and
  requires `ADMIN`. The JWT `roles` claim is NOT authority (a token issued
  before a grant/revocation would be stale). Tested: stale-token escalation
  (ADMIN claim, CUSTOMER in DB) → 403.
- Matrix: unauthenticated → 401; customer/provider/T2/T3/non-admin → 403;
  suspended/deleted/deactivated accounts denied at session check; admin → allowed.
- No client-supplied id (body/query/param) is ever used as authority;
  `actorUserId` in audit rows is always the session user (forged actor
  fields rejected by strict schemas).

## 2. Dashboard (`GET /admin/dashboard`)

Bounded count/aggregate queries only: users (total + by status),
providers (total/active/verified/pending/verified-students), businesses
(teams/businesses/units), bookings (total + by status + completed),
finance (paid volume + count, commission collected, outstanding cash
liability, ZAR), marketplace (active services + category count),
operations (media pending moderation, inventory tracked, notifications).
No PII lists, no invented numbers.

## 3. User management

Search (email/uuid contains + status, paginated ≤50/page), detail (roles,
customer/provider presence, recent audit), status transitions limited to
`ACTIVE | SUSPENDED | DEACTIVATED` (no `DELETED` — history preserved) via
`USER_DEACTIVATED` / `USER_REACTIVATED` audit events. Responses can never
contain `passwordHash`, tokens, or secrets (destructured out + tests assert
absence).

## 4. Provider management

Search (name, tier T1/T2/T3/STUDENT, verification, student pending/verified,
operational status), detail (tier, verification, Student, services,
coverage, locations without precision, team/business links, verification
history from audit). Status limited to `ACTIVE | PAUSED | SUSPENDED`;
tier is never mutated here (no ranking side-effects — the API emits no
rank/boost/score fields at all).

## 5. Verification workflows

- Provider: `APPROVE → VERIFIED`, `REJECT → REJECTED`, `REVOKE → SUSPENDED`,
  optional notes stored in the audit `afterJson`.
- Student: `APPROVE → (isStudent true, VERIFIED)`,
  `REJECT → (false, REJECTED)`, `REVOKE → (false, UNVERIFIED)`.
  Admin-controlled only: providers can only reach `PENDING` via the
  pre-existing finance request endpoint; self-approval via admin routes is
  403-tested. Verified Student status carries no marketplace ranking
  effect (unchanged architecture).

## 6. Business oversight

Read-only `GET /admin/teams`, `/admin/businesses`, `/admin/businesses/:id`
(units + staff + owner lineage), `/admin/business-units/:id`. No create/
update surface (Slice 15 APIs remain the write path — POST/PATCH asserted
404). Plus invitation oversight (see §12).

## 7. Booking oversight (read-only)

Search by status/provider/unit/payment-status/date range; detail includes
items + linked payment for reconciliation. Location is area-level only
(city/province/country — no coordinates, no street). Customer minimized to
id + display name. **No state-transition endpoints exist** (accept/complete/
status PATCH asserted 404). Payment vs completion stay separate.

## 8. Finance oversight (read-only)

Payment list/detail (secret-like metadata keys redacted), finance overview
(payments by status, commission collected, cash-liability outstanding/
gross/settled, ledger by type, recent settlements). No payment-status
mutation, no refund, no credential exposure. Commission reconfiguration
provably never touches historical payment rows (snapshots immutable).

## 9. Configuration (`GET /admin/settings`, `PATCH /admin/settings/:key`)

Allowlisted keys only (unknown keys → 404, e.g. `paystack_secret_key`):
- Commission `commission_{student,t1,t2,t3}_percent` + legacy
  `default_platform_commission`: 0–100.
- Cash caps `cash_cap_{student,t1,t2,t3}`: integer 0–100000 ZAR.
- Marketplace: default/max discovery + max coverage restricted to
  10/15/20 (absolute max 20 enforced); allowed lists must be non-empty
  subsets of [10,15,20].
- `max_service_images` / `max_custom_request_images`: IMMUTABLE (422).
- Every change: validated → upsert → `ADMIN_SETTING_UPDATED` audit with
  before/after values. Optimistic concurrency via `expectedUpdatedAt`
  (mismatch → 409). Sensitive-flagged values render `[REDACTED]`.
- Historical commissions/caps unaffected: finance reads config at
  transaction time; snapshots live on each row (unchanged architecture).

## 10. Audit viewer (`GET /admin/audit-logs`)

Filter by actor/action/entity/date, paginated. Append-only: no PUT/PATCH/
DELETE routes exist (asserted 404). Entity-type filter is regex-allowlisted
(injection neutralized). Secret-like keys in before/after JSON redacted.

## 11. Notification / media oversight

- Notifications (Slice 7 reuse, read-only): list with 160-char message
  previews + volume by type; detail for full content. No new vendor, no
  second system.
- Media (Slice 11 reuse): list by moderation/status/purpose (metadata only
  — no bytes, no signed URLs minted here); moderation actions
  APPROVE/REJECT/HIDE/NEEDS_REVIEW map to moderation states and are audited.
  No delete path (historical references preserved).

## 12. Slice 15 identity-binding risk — mitigation decision

**Risk (carried from Slice 15):** email-only team/business invitations carry
no identity binding — whoever presents the bearer token can accept, scoped
to one team/business.

**Slice 16 mitigation (no scope creep):** `GET /admin/invitations`
(scope + status filters, token hashes never serialized) gives platform-wide
visibility into pending bearer invites, and
`POST /admin/invitations/:scope/:id/revoke` is an explicit audited kill-switch
for suspicious invites (pending-only; accepted/revoked/expired → 422,
preserving single-use semantics).

**Deferred (requires product decision, not built here):** binding email-only
invites to a verified identity at acceptance (e.g. require the acceptor's
verified email to match `invitedEmail`). Changing acceptance semantics could
lock out legitimate invitees and belongs to a scoped auth-slice change.

## 13. Web admin (`/admin/*`, adminGuard + AdminApiService)

Dashboard, users, providers (+verification), businesses (+invitations),
bookings, finance, settings (with concurrency-conflict surfacing), audit,
ops (notifications + media). Operational styling (not marketplace-like),
search/filter/pagination everywhere, `window.confirm` on destructive/
privileged actions, offline mutations blocked (never queued). `adminGuard`
is a UX gate only — the server re-enforces `requireAdmin`.

## 14. Mobile

No admin console (explicit non-goal). No `/admin` routes, no admin client,
no admin guard in `apps/mobile`. Backend denies all non-admin roles, so a
forged deep link cannot escalate. Verified by frontend contract tests.

## 15. Database

**No migration.** Existing models suffice: `AdminSetting` (unique
`settingKey`, `updatedAt` doubles as the optimistic-concurrency version —
no schema change needed), `AuditLog` (actor + before/after carries the
configuration history; no nullable `updated_by_user_id` FK + backfill
required), `User.status` / `ProviderProfile.status` / verification enums
already cover admin transitions, invitation tables already carry status
machines. Deactivation never deletes rows, so financial/booking history is
preserved by construction.

## 16. Tests

- `backend/tests/admin-platform.test.ts`: 88 tests (authz 12, dashboard 3,
  users 10, providers 7, verification 10, business 10, bookings 7,
  finance 5, config 13, audit 5, notifications/media 6).
- `backend/tests/admin-platform-frontend.test.ts`: 10 contract tests (real
  web client URLs, guard, web routes, mobile absence, offline blocking,
  no-secret rendering).
- Total added: **98 tests**.

## 17. Non-goals (not built)

Training-centre ecosystem, offline sync, production infrastructure,
payroll/HR/accounting, driver functionality, marketplace ranking controls,
external notification vendors, mobile admin app, generic CRUD, UI redesign.

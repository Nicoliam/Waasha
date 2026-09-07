# SLICE 17 — Training-Centre Ecosystem

Production foundation for Waasha's training-centre partnership ecosystem.
Training centres, academies, colleges and relevant institutions can register
as partners, refer prospective students, retain attribution through provider
onboarding, support Student verification, and accrue a *configured*
allocation from the platform commission on *eligible completed services
only*. Attribution and financial history are retained permanently.

What this slice does NOT do: guaranteed customers, income, employment,
bookings or earnings (UI carries explicit disclaimers); actual payout rails
(accruals are ledger records — accrual is NOT payment); marketplace ranking
effects (none exist by design); driver functionality; full offline sync.

## 1. Domain model (`backend/prisma/schema.prisma`, migration `20260909000000_add_training_centre_ecosystem`)

- `TrainingPartner` (`training_partners`): legal/display name, description,
  `institutionType` (`COLLEGE | ACADEMY | TRAINING_CENTRE | UNIVERSITY | NGO | OTHER`),
  contact info, website, location (city-level operational use), `categoriesServed`
  (subset of the 5 launch codes only), logo reference, `status`
  (`PENDING | ACTIVE | SUSPENDED | DEACTIVATED`), `verificationStatus`
  (`UNVERIFIED | PENDING | VERIFIED | REJECTED`). Internal `partnershipNotes`
  never leave the server (sanitized out).
- `TrainingPartnerMember` (`training_centre_users`): `{partnerId, userId}`
  unique; roles `OWNER | MANAGER | STAFF`; status `ACTIVE | SUSPENDED | REMOVED`.
  Session-derived membership is the SOLE partner authority.
- `TrainingReferral` (`training_referrals`): single-use invitation codes.
  Only the SHA-256 `codeHash` is persisted plus a non-secret 6-char
  `codePrefix` lookup aid; the raw `WAA-…` code is returned once, never
  stored, logged, audited or notified. Statuses `PENDING | CLAIMED | EXPIRED | REVOKED`,
  TTL configurable via `training_referral_ttl_days` (default 30d, 1–365).
- `TrainingAttribution` (`training_centre_providers`): `{partnerId, providerId}`
  unique; `source` (`REFERRAL_CODE | ADMIN_ATTRIBUTION | EVIDENCE_LINKED`);
  `status` `ACTIVE | ENDED`. History retained — rows are ENDED, never deleted
  (including on partner deactivation). One ACTIVE row per provider enforced
  transactionally.
- `TrainingEvidence` (`training_evidence`): programme, qualification
  reference, institution confirmation, completion date, `mediaAssetId`
  reference behind the Slice 11 media abstraction (never raw bytes);
  `SUBMITTED | UNDER_REVIEW | APPROVED | REJECTED` with reviewer + note.
- `PartnerShareRule` (`partner_share_rules`): `scope` (`GLOBAL | PARTNER | PROGRAMME`),
  percent 0–100 validated, `effectiveFrom/To`, `isActive`. Precedence at
  accrual time: PARTNER → PROGRAMME → GLOBAL → `partner_share_default_percent`
  admin setting (default 0 — no invented splits).
- `PartnerAccrual` (`training_centre_earnings`): one row per eligible booking
  (`bookingId` unique + `idempotencyKey`), snapshotting gross, platform
  commission rate/amount, applied partner percent/amount, currency, rule id.
  `status` `ACCRUED | REVERSED`; `paidAt` stays null (payout rails deferred).

## 2. Partner authorization

- All `/api/v1/partners/*` operations resolve membership from the session
  user id (`resolveMembership`); the partner id is NEVER taken from the
  client (`requirePartnerAccess` 404s cross-partner without revealing
  existence). Sensitive operations (referrals, profile, evidence) require
  `OWNER | MANAGER`.
- Partner users cannot: reach `/api/v1/admin/*` (403), configure finance
  rules, change Student verification outcomes, see other partners,
  unrelated providers, or customer PII (sanitized list/dashboard shapes;
  evidence listing exposes booleans, never content/keys).
- Applying grants the `TRAINING_CENTRE` platform role only — never ADMIN
  (tested: upsert targets the TC role id).

## 3. Referral → attribution → onboarding flow

`POST /partners/me/referrals` (OWNER/MANAGER, ACTIVE partner only) →
raw code shown once → prospective student `POST /partners/referrals/redeem`
(any authenticated user; uniform 404 anti-oracle; expiry marking; blocks
already-attributed users and inactive partners) → provider onboarding
(existing system, unchanged) → `POST /partners/me/attribution/link`
(transactional, binds the *claimed referral's* partner — self-assignment
impossible). Reassignment is admin-only, explicit, audited
(`ATTRIBUTION_REASSIGNED`), ending the old row first.

## 4. Student verification relationship

`isStudent` + `studentVerificationStatus === VERIFIED` remain the existing
finance/admin workflow's authority. Partners may *support* verification
(`STUDENT_VERIFICATION_SUPPORTED` audit + advisory notifications) — this
never mutates provider status or commission (tested: `providerProfile.update`
never called). Admin approval emits outcome notifications to provider and
partner members via `notifyStudentVerificationOutcome` (hooked in
`finance.routes.ts`). Verified Student carries no ranking advantage.

## 5. Finance integration

- Student 16% / T1/T2/T3 25% defaults stay in existing finance config;
  partner code reads them via payment snapshots or
  `getCommissionRateForProvider` — no literals (source-scanned in tests).
- `recordPartnerAccrualForBooking` fires post-commit from the booking
  completion service (best-effort, idempotent, never breaks completion).
  Accrues ONLY for `COMPLETED` bookings with ACTIVE attribution + ACTIVE
  partner + positive configured share + positive computed amount.
  Cancelled/declined/refunded/failed/payment-only states never accrue.
- Rule changes never rewrite history (accruals carry snapshots); reversals
  are state changes (`REVERSED` + reason + audit), never edits.

## 6. Admin oversight (`/api/v1/admin/partners/*`, `requireAdmin`)

Search (q/status, ≤50/page), detail (members/attributions/rules/accruals/
evidence), lifecycle transitions (`PENDING→ACTIVE|DEACTIVATED`,
`ACTIVE→SUSPENDED|DEACTIVATED`, `SUSPENDED→ACTIVE|DEACTIVATED`; illegal
transitions 422), verification approve/reject/reset, direct attribution,
end/reassign attribution, evidence review, share-rule CRUD, accrual
list (totals + disclaimer) + reversal. Every mutation audited
(`PARTNER_APPROVED`, `PARTNER_STATUS_CHANGED`, `PARTNER_RULE_CREATED/UPDATED`,
`PARTNER_ACCRUAL_CREATED/REVERSED`, …).

## 7. Notifications (Slice 7 reuse, all best-effort post-commit)

`PARTNER_APPLICATION_RECEIVED` (admins), `PARTNER_APPROVED / PARTNER_STATUS_CHANGED`
(members), `REFERRAL_CLAIMED`, `PARTNER_ATTRIBUTION_CREATED`,
`STUDENT_VERIFICATION_SUPPORTED`, outcome events, `PARTNER_EARNING_ACCRUED`.
Idempotent `eventKey`s; notification infra failure never breaks domain
writes; raw referral codes never enter notifications/audit (tested).

## 8. Audit

`PARTNER_APPLIED/PROFILE_UPDATED/APPROVED/STATUS_CHANGED/VERIFICATION_CHANGED`,
`REFERRAL_CREATED/CLAIMED/REVOKED`, `ATTRIBUTION_LINKED/CREATED_ADMIN/ENDED/REASSIGNED`,
`TRAINING_EVIDENCE_SUBMITTED/REVIEWED`, `STUDENT_VERIFICATION_SUPPORTED`,
`PARTNER_RULE_CREATED/UPDATED`, `PARTNER_ACCRUAL_CREATED/REVERSED`.
Secrets redacted; audit outage fails closed (503 `AUDIT_UNAVAILABLE`).
Partners cannot read or mutate audit logs.

## 9. Web (`/partner/*`, `/admin/partners`)

Dashboard (metrics + disclaimer), referrals (create/revoke/redeem/link,
code-shown-once warning), providers (attributed list + evidence submit +
verification support), earnings (accrual ledger + not-a-payout wording),
profile (apply + edit; status fields schema-rejected), admin partners
(search/inspect/lifecycle/verify/attribute/evidence/rules/accruals).
Mutations blocked offline with explicit nothing-changed errors; reads stay
server-authoritative. Loading/error/empty states everywhere.

## 10. Mobile (parity, web-first)

Same endpoints, same authorization, same rules — `PartnerApiService`
(mobile) method-for-method matches web (parity-tested); five partner pages
mirror web components; same `/partner/*` routes; same offline blocking;
no mobile-only logic. Admin oversight stays web-only by design.

## 11. Concurrency & idempotency

Attribution linking/admin attribution/reassignment run in transactions
(unique `{partnerId, providerId}` + ACTIVE checks inside); referral
redemption is single-use (`CLAIMED` flips atomically; double-claim → 422);
accruals are duplicate-safe (`bookingId` unique + `idempotencyKey`, existing
row returned on conflict); notification `eventKey`s dedupe.

## 12. Deferred / non-goals

Payout rails (accrual ≠ payment), payroll/accounting/tax, external payout
providers, guaranteed-income claims, ranking boosts, driver flows,
full offline sync (mutations blocked offline, Slice 18), external
notification vendors, second provider/finance systems.

## 13. Tests

`backend/tests/training-centre-ecosystem.test.ts` (75 backend tests) +
`backend/tests/training-centre-frontend.test.ts` (16 frontend contract
tests): lifecycle, auth boundaries, referrals/attribution, evidence/Student,
share/accrual finance, admin oversight, resilience, security (IDOR,
escalation, PII/secret leakage, forged ids, mass assignment), marketplace
neutrality, web/mobile parity, offline blocking.

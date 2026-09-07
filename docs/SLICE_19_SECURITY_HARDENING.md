# SLICE 19 — Security & Data-Integrity Hardening

Narrowly scoped to the two hardening items from the pre-Slice-18 audit.
No new product features. No architecture redesign. No migration required.

## 1. Item 1 — Canonical Student-verification authorization

**Authoritative rule:** session identifies the user (`authMiddleware`) →
database `user_roles → roles` determines current admin authority
(`requireAdmin`). JWT `roles` claims are never sufficient authority, and
client-supplied user ids are never trusted as authority.

- Canonical implementation: `admin.service.setStudentVerification`
  (`backend/src/modules/admin/admin.service.ts`) — the SINGLE authoritative
  Student-verification write, audit path, and outcome-notification site.
- Canonical route: `POST /api/v1/admin/providers/:id/student-verification`
  (`APPROVE | REJECT | REVOKE`), already behind `requireAdmin`. Now fires
  the existing `notifyStudentVerificationOutcome` hook exactly once
  post-commit (best-effort; never breaks the write). `REVOKE` maps to the
  `REJECTED` outcome channel (verification removed).
- Legacy route: `POST /api/v1/finance/admin/verify-student/:providerId`.
  Previously trusted the JWT-role pattern (`requireRole('ADMIN')`) with its
  own independent update/audit/notify logic. Now uses `requireAdmin` and
  delegates to `setStudentVerification`. Accepts `APPROVE | REJECT | REVOKE`
  (superset for parity; old `APPROVE | REJECT` callers unaffected) and
  returns the same `{ isStudent, studentVerificationStatus }` shape.
- `middleware/authorize.ts → requireRole` is retired: zero callers, stubbed
  fail-closed (always 403) so the JWT-role trust pattern cannot be revived
  accidentally. Admin checks must use `requireAdmin`.
- Preserved: admin-only verification, no self-selection (`PUT
  /finance/student-request` → `PENDING` only), configurable 16% Student /
  25% T1/T2/T3 commission, cash caps, historical snapshots, no ranking
  preference, audit logging, API compatibility.

## 2. Item 2 — Referral conditional writes / concurrency

All referral state changes are atomic conditional writes (Prisma/MySQL
`updateMany` with a status predicate); no preliminary read is trusted.

- `redeemReferral`: `PENDING → CLAIMED` conditional on
  `{ id, status: 'PENDING', expiresAt: { gte: now } }`. Exactly one
  concurrent winner; losers re-read and receive safe `422
  REFERRAL_INVALID_STATE` (uniform — no code-guessing oracle). Expiry uses
  conditional `PENDING → EXPIRED` then `422 REFERRAL_EXPIRED`.
- `revokeReferral`: `PENDING → REVOKED` conditional on
  `{ id, partnerId, status: 'PENDING' }`. Losing a redeem/expiry race
  yields `404` (not own/not found) or safe `422`, never a double change.
- `linkAttribution` / `adminAttributeProvider`: provider attribution rows
  are row-locked (`SELECT … FOR UPDATE`, best-effort) inside the
  transaction; the single-ACTIVE check runs under the lock; pair-unique
  (`P2002`) violations map to deterministic `422 ATTRIBUTION_EXISTS`; a
  post-create ACTIVE-count guard rolls back with `409
  ATTRIBUTION_CONFLICT` if the invariant is ever violated. Duplicate ACTIVE
  rows are never created.
- `adminEndAttribution`: conditional `ACTIVE → ENDED` (`updateMany`);
  concurrent ends resolve deterministically (exactly one succeeds, other
  gets `422 ATTRIBUTION_INVALID_STATE`); reassignment creates the new
  ACTIVE row in the same transaction under the same guards.
- Preserved: SHA-256 hashed storage, raw code shown once, uniform
  invalid/expired/revoked responses, expiry, single-use, provider binding,
  no self-assignment (link binds only to the claimed referral's partner;
  redeem schema is strict), admin-only reassignment, auditability.

## 3. Schema / migration

No schema change. Existing constraints (`codeHash` unique,
`{partnerId, providerId}` unique, status indexes) plus the new
service-layer conditional writes and transactional guards provide the
guarantees. No live migration required.

## 4. Tests

`backend/tests/slice-19-hardening.test.ts` (25 tests): stale-JWT rejection
on both verification paths, customer/provider/T2/T3 denial, canonical +
legacy success with audit, exactly-once notification on both paths, no
self-assignment, commission config untouched, single/concurrent/second
redemption, conditional-write predicates, revoke/expiry races, duplicate
ACTIVE prevention (pre-check + `P2002`), no self-assign, admin
reassignment, double-end rejection, audit correctness. Existing
`training-centre-ecosystem` test 70 updated to assert the centralized hook
wiring; referral UpdateMany mocks added where the implementation changed.

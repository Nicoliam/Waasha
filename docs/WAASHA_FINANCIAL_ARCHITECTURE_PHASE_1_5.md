# Waasha Financial Architecture — Phase 1.5 Update

**Date:** 2026-09-05
**Status:** Approved business rules — implementation pending Phase 2 booking engine
**Source:** Explicit stakeholder instruction (cash caps, tiered commission, Student verification)
**Applies to:** `backend/prisma/schema.prisma`, `backend/prisma/seed.ts`, `backend/src/modules/finance/*`, `docs/WAASHA_PRODUCTION_BLUEPRINT_MASTER.md`

---

## 1. Provider Cash Acceptance — Deterministic T3 Rule (Hardened)

- `ProviderProfile.acceptCash: Boolean @default(true)` — T1/T2/STUDENT.
- `Business.acceptCash` / `BusinessUnit.acceptCash: Boolean @default(true)` — T3.
- **Deterministic T3 rule (server-authoritative, in `cash-ledger.service.ts`):**
  - If `tier.code === 'T3' && businessUnitId` provided → `BusinessUnit.acceptCash` controls (with tenant check `Business.ownerProviderId === ProviderProfile.userId`; `403 FORBIDDEN` if not owned).
  - Else if `tier.code === 'T3'` (no unit) → `Business.acceptCash` (first business owned by `provider.userId`) controls.
  - Else (`T1/T2/STUDENT` or `T3` fallback) → `ProviderProfile.acceptCash`.
  - No ambiguous “either” — one value decides; `422 CASH_NOT_ACCEPTED` if the controlling value is `false`.
- If `acceptCash = false` (controlling value):
  - `POST /api/v1/finance/cash-bookings` → `422 CASH_NOT_ACCEPTED` (no booking/payment/ledger created)
  - Marketplace still shows provider; `Cash` not offered at checkout.
  - Other methods (`waasha_payment`, `eft`) remain available — cash cap does **not** disable account.
- If `true`:
  - Cash may be selected for eligible bookings.
  - Cash transactions create `CashLedgerEntry` `type=ACCRUAL` (immutable, `idempotencyKey` unique if provided) and increment `ProviderCashAccount.outstandingCommission` via atomic `FOR UPDATE`.

Frontend must hide `Cash` when controlling `acceptCash` is false, but backend is authoritative (never trust client). `PUT /api/v1/finance/cash-acceptance` toggles `ProviderProfile.acceptCash` (T1/T2) and is audited; T3 unit/business toggles via future admin/business endpoints.

---

## 2. Tiered Commission (Configurable, Not Hard-Coded)

Admin settings (via `admin_settings`):

| Key | Default | Applies To |
|---|---|---|
| `commission_student_percent` | 16 | Verified Student |
| `commission_t1_percent` | 25 | T1 Individual |
| `commission_t2_percent` | 25 | T2 Teams |
| `commission_t3_percent` | 25 | T3 Business |
| `default_platform_commission` | 25 | Legacy fallback |

Resolution in `backend/src/modules/finance/commission.service.ts`:

```
if (provider.isStudent && studentVerificationStatus === 'VERIFIED') return studentRate (16)
else if (tier.code === 'STUDENT') return studentRate
else if (T1) return t1Rate (25)
else if (T2) return t2Rate (25)
else if (T3) return t3Rate (25)
```

`Payment.commissionRate` and `commissionAmount` are snapshotted immutably at booking creation (`Payment.commissionRate`, `commissionAmount`, `CashLedgerEntry.commissionRate/Amount`). Changing `admin_settings` does not retroactively mutate historical rows.

---

## 3. Cash Commission Liability Caps

Maximum **outstanding** Waasha commission owed from cash transactions (not total sales):

| Provider Level | Cap (ZAR) | Admin Key |
|---|---|---|
| Student (verified) | 500 | `cash_cap_student` |
| T1 Individual | 1000 | `cash_cap_t1` |
| T2 Teams | 1000 | `cash_cap_t2` |
| T3 Business | 5000 | `cash_cap_t3` |

Example (Student):
- Service R200 cash at 16% → R32 commission owed.
- If `outstanding = 480` and new commission `40` (R250 gross) → `520 > 500` → `422 CASH_CAP_EXCEEDED`, no booking created.
- If `outstanding = 480` and new commission `20` (R125 gross) → `500 == cap` → allowed.

 caps are `admin_settings` (`cash_cap_*`) and `DEFAULT_CAPS` fallback.

---

## 4. Cap Enforcement — Transactional & Concurrency-Safe (Hardened)

`backend/src/modules/finance/cash-ledger.service.ts:createCashBooking` uses `prisma.$transaction(..., { isolationLevel: 'Serializable' })` with **explicit row-level locking** (`SELECT ... FOR UPDATE`) and **atomic conditional UPDATE**:

1. `findUnique` `ProviderProfile` → deterministic `acceptCash` check (see §1 T3 rule)
2. `getCommissionRateForProvider` → `commissionAmount`
3. `getCashCapForProvider` → `cap`
4. Inside `SERIALIZABLE` `$transaction`:
   - `findUnique` or `create` `ProviderCashAccount` (handles race on first cash booking via `P2002` unique violation → `SELECT ... FOR UPDATE` + re-fetch)
   - `SELECT * FROM provider_cash_accounts WHERE provider_id = ? FOR UPDATE` — locks row, blocks concurrent tx
   - Re-read `outstanding` after lock
   - `wouldBeOutstanding = outstanding + commissionAmount`
   - If `wouldBeOutstanding > cap` → throw `CashCapExceededError` (`422 CASH_CAP_EXCEEDED`) — no `Booking`/`Payment`/`Ledger` created, transaction rolls back
   - Else **atomic conditional** `UPDATE provider_cash_accounts SET outstanding = outstanding + commissionAmount ... WHERE provider_id = ? AND outstanding = ? AND outstanding+commission <= cap` — `updatedRows === 0` → concurrent conflict → re-read and throw `CASH_CAP_EXCEEDED` with `reason: Concurrent update conflict`
   - Else `create` `Booking` (`status: PENDING`, `paymentStatus: PAID`, `businessUnitId` if T3, `type: STANDARD` — ledger `ACCRUAL` is **separate** from service `COMPLETED` lifecycle), `Payment` (`gateway: manual_cash`, snapshotted `commissionRate/Amount`), `CashLedgerEntry` (`type: ACCRUAL`, `idempotencyKey` if provided, `metadata.businessUnitId`), `auditLog`.

Concurrency test (`cash-caps.test.ts` “two concurrent bookings where only one fits cap”) uses `Promise.all` with `FOR UPDATE` + `$executeRaw` mock to verify `one 201, one 422` and `outstandingCommission` never exceeds `cap`. MySQL `SERIALIZABLE` + `FOR UPDATE` guarantees `outstandingCommission > cap` is impossible even under race.

---

## 5. Settlement Ledger

Models:

- `ProviderCashAccount` (`provider_cash_accounts`): one per provider, tracks `outstandingCommission`, `totalCashGross`, `totalCashCommission`, `totalSettled`.
- `CashLedgerEntry` (`cash_ledger_entries`): immutable per transaction, `type` enum `ACCRUAL | SETTLEMENT | REVERSAL | ADJUSTMENT`, `grossAmount`, `commissionRate`, `commissionAmount`, `paymentMethod`, `currency`, `metadata` JSON.
- `Payment` now snapshots `commissionRate`/`commissionAmount`.
- `Booking` links to `CashLedgerEntry` via `bookingId` unique.

Settlement (idempotent, auditable):
- `POST /api/v1/finance/settlements` (`amount` positive, `idempotencyKey?`) → inside `SERIALIZABLE` `$transaction`:
  - If `idempotencyKey` provided and `CashLedgerEntry` with that key already exists (outside `tx` and inside `tx`), return existing (no double-settle) — `idempotent: true`.
  - `SELECT ... FOR UPDATE` on `provider_cash_accounts` → lock
  - Verify `amount <= outstanding` else `422 SETTLEMENT_EXCEEDS_OUTSTANDING` (no partial)
  - `update` `outstandingCommission = outstanding - amount`, `totalSettled += amount`
  - `create` `CashLedgerEntry` `type: SETTLEMENT` with `commissionAmount: -amount`, `idempotencyKey` unique, `metadata.settlementAmount`
  - `auditLog` `CASH_SETTLEMENT`
  - `CashLedgerEntry` `idempotencyKey` has `UNIQUE` constraint (`cash_ledger_entries.idempotency_key`) — duplicate replay returns existing, does not double-credit.
- Settlement increases available cash capacity: `cap - outstanding` after settlement.
- Historical `ACCRUAL`s remain immutable; `SETTLEMENT` is a new `CashLedgerEntry` with negative `commissionAmount`, never `update` of prior rows. Duplicate `idempotencyKey` on `ACCRUAL` (`POST /finance/cash-bookings` with same `idempotencyKey`) also returns existing `201` idempotent.

Other visibility:
- `Payment` holds `amount`, `gateway`, `method`, `status`, plus snapshotted `commissionRate/Amount`.
- `CashLedgerEntry` holds `grossAmount`, `commissionRate/Amount`, `type`, `idempotencyKey`, `currency`, `metadata` (businessUnitId, description, settlementAmount).
- `ProviderCashAccount` aggregates `outstandingCommission`, `totalCashGross`, `totalCashCommission`, `totalSettled`.

Historical records are immutable — never `update` a `CashLedgerEntry` or `Payment` commission snapshot; create new `SETTLEMENT`/`REVERSAL`/`ADJUSTMENT`.

---

## 6. Cash-Only Protection

- Cap exceeded → `422 CASH_CAP_EXCEEDED` with `cap`, `outstanding`, `wouldBeOutstanding` — clear business-rule response.
- Do **not** disable provider account or set `status=SUSPENDED` when cap reached. Only `CASH` is restricted; `waasha_payment` and `eft` remain.
- Provider may still receive bookings via other enabled methods.
- Frontend shows `Cash not available — outstanding commission R480 / R500 cap. Settle to re-enable cash.`

---

## 7. Student Provider

- `ProviderTier` new code `STUDENT` (sortOrder 0) — `seed.ts` upserts.
- `ProviderProfile.isStudent: Boolean @default(false)` + `studentVerificationStatus: VerificationStatus @default(UNVERIFIED)`.
- Student `commission 16%` and `cap 500` only apply when `isStudent=true && studentVerificationStatus=VERIFIED`.
- Eligibility requires verification:
  - Provider `PUT /api/v1/finance/student-request` → sets `studentVerificationStatus: PENDING` (not `VERIFIED`).
  - Canonical admin verification is `POST /api/v1/admin/providers/:id/student-verification` (`action: APPROVE|REJECT|REVOKE`) via `admin.service.setStudentVerification` — the SINGLE authoritative implementation (DB-backed `requireAdmin`: session identifies the user, `user_roles → roles` decides authority; JWT role claims are never sufficient).
  - Legacy compatibility path `POST /api/v1/finance/admin/verify-student/:providerId` (Slice 19: `requireAdmin`, delegates to the same canonical service; accepts `APPROVE|REJECT|REVOKE`) → sets `isStudent` + `studentVerificationStatus`. No independent authorization or verification logic remains.
  - Both paths fire the centralized training-centre outcome hook (`notifyStudentVerificationOutcome`) exactly once post-commit (best-effort; never breaks the write).
  - Self-selecting `STUDENT` via `POST /api/v1/auth/register/provider` with `tierCode: STUDENT` is **not** allowed — `registerProvider` only allows `T1/T2/T3`; `STUDENT` tier is not selectable at registration, only via admin verification. Do not allow `isStudent` to be set via client `register` payload (allowlisted fields only).
- Student status **must not** affect marketplace ranking or discovery priority (same equality rule as T1/T2/T3 and training-centre).
- **Future enhancement (not Phase 1.5):** `ProviderProfile` currently lacks `studentInstitution`, `studentIdNumber`, `studentEvidenceUrl`, `studentExpiry` — document as future fields for full student verification with institution/evidence metadata and expiry. Phase 1.5 uses `isStudent` + `studentVerificationStatus` with `auditLog` only.

---

## 8. API Surface (Phase 1.5 — Hardened)

- `GET /api/v1/finance/commission-rates` — public, returns `{rates, caps}` from `admin_settings` (16/25/25/25, 500/1000/1000/5000).
- `POST /api/v1/finance/cash-bookings` — `authMiddleware` + `customerProfile` required, body `{providerId, grossAmount, currency?, serviceId?, businessUnitId?, description?, idempotencyKey?}` → `201` with `booking (status: PENDING, paymentStatus: PAID)/payment/ledger/cap` or `422 CASH_NOT_ACCEPTED/CASH_CAP_EXCEEDED` (with `wouldBeOutstanding`, `BUSINESS_UNIT_NOT_FOUND`, `FORBIDDEN`). `Booking` `PENDING` is **not** service `COMPLETED` — ledger `ACCRUAL` is financial, engine will later transition `PENDING->CONFIRMED->IN_PROGRESS->COMPLETED`.
- `GET /api/v1/finance/cash-account` — provider own `ProviderCashAccount` + `cap` + `commissionRate`.
- `GET /api/v1/finance/cash-ledger` — provider paginated `CashLedgerEntry` (immutable, includes `idempotencyKey`).
- `POST /api/v1/finance/settlements` — provider `body {amount, idempotencyKey?}` → reduces `outstanding`, `idempotent` on duplicate key.
- `PUT /api/v1/finance/cash-acceptance` — provider `body {acceptCash: boolean}` (audited, T1/T2; T3 unit vs business per §1).
- `PUT /api/v1/finance/student-request` — provider requests `PENDING` (not `VERIFIED`), audited.
- `POST /api/v1/finance/admin/verify-student/:providerId` — legacy compatibility path, DB-verified `ADMIN` only (`requireAdmin`), `body {action: APPROVE|REJECT|REVOKE}` → delegates to canonical `admin.service.setStudentVerification` → `VERIFIED/REJECTED/UNVERIFIED`, audited, exactly-once outcome notification, no ranking boost.

---

## 9. Testing

`backend/tests/cash-caps.test.ts` (12 tests) covers all rules above, including race-condition transactional semantics via `prisma.$transaction` mock, `CASH_CAP_EXCEEDED` with `wouldBeOutstanding`, `CASH_NOT_ACCEPTED`, `16%` vs `25%`, settlement, and `isStudent` verification flow.

---

## 10. Migration

`prisma/migrations/20260905134644_add_cash_liability_caps/migration.sql` adds:

- `provider_profiles.accept_cash`, `is_student`, `student_verification_status`
- `businesses.accept_cash`, `business_units.accept_cash`
- `provider_cash_accounts`
- `cash_ledger_entries`
- `payments.commission_rate`, `commission_amount`
- `bookings` relation to `cash_ledger_entries`

All `admin_settings` for rates/caps are seeded via `prisma/seed.ts`.

---

**Do not start Phase 2 booking engine, driver network, or other unrelated features. This ledger is the financial source of truth for cash.**

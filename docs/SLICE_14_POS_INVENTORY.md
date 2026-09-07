# Slice 14 — POS & Inventory Architecture

**Status:** implemented (14/20 roadmap)
**Scope:** provider-side operational tooling only. Not T2/T3 business
management, not admin, not training-centre, not offline sync, not
accounting, not drivers.

## 1. Domain separation

A **POS sale is NOT a booking**:

- `pos_sales` / `pos_sale_lines` are standalone tables. No `bookingId`
  FK, no `Payment` rows, no `CashLedgerEntry` / `ProviderCashAccount`
  writes (asserted by tests: `payment.create` and `cashLedgerEntry.create`
  throw if ever called from this module).
- POS sales never transition booking status and never mark bookings
  completed. Booking completion (Slice 13) is untouched.
- POS payment rows record **provider-reported receipts** (walk-in till),
  not gateway charges. No gateway interaction happens here, so nothing is
  faked: `waasha_payment` lines are stored as recorded receipts and gateway
  reconciliation is deferred (see §7).

## 2. Inventory

- `inventory_items`: provider-owned (`providerId` server-derived),
  optional `businessUnitId` (T3/staff scope), SKU unique-per-provider,
  name/description/unit, `costPrice`/`sellingPrice`, `quantityOnHand`,
  `lowStockThreshold`, `isActive`, optional reference-only `imageUrl`
  (uploads stay behind the Slice 11 media abstraction — no new upload
  system, no vendor SDK).
- `quantityOnHand` is **server-authoritative**: accepted once as the
  opening balance on create; afterwards only `receive` / `adjust` / sale /
  return movements change it inside transactions. `PATCH` rejects
  `quantityOnHand`, `isActive` and ownership fields (strict DTO).
- Fractional quantities are rejected, never floored.

## 3. Stock movements (`inventory_movements`)

Every mutation writes a row: item, signed `quantityDelta`, resulting
`resultingQuantity`, `movementType` (`RECEIVED | ADJUST_INCREASE |
ADJUST_DECREASE | SALE | RETURN | REVERSAL`), actor, `referenceType` /
`referenceId` (`POS_SALE | MANUAL | REVERSAL`), reason, timestamp,
tenant scope. Negative balances are blocked (`NEGATIVE_STOCK`) unless an
explicit authoritative rule ever opts in (no such rule exists today).

## 4. POS sale + inventory integration

- Prices, totals and deductions are computed **server-side** from the
  current catalogue. Client `unitPrice` / `lineTotal` / `subtotal` /
  `totalAmount` / commission fields are stripped at the route boundary.
- Product lines require: ownership in scope, `isActive`, and sufficient
  stock with demand **aggregated across repeated lines**.
- Service lines require: ownership in scope and `status === ACTIVE`.
- Lines snapshot `nameSnapshot` + `unitPrice`; catalogue edits never
  rewrite history (tested).
- Reversal (`POST /sales/:id/reverse`) flips `COMPLETED → REVERSED` once
  and restores stock via `RETURN` movements; lines keep snapshots.

## 5. Concurrency model

Serializable transactions + `SELECT ... FOR UPDATE` on every touched
inventory row (locked in sorted id order) + exact-balance writes.
Two concurrent sales cannot oversell (tested with parallel requests
against serialized transactions simulating row locks).

## 6. Idempotency model

`pos_sales.idempotencyKey` is UNIQUE. Three layers: pre-transaction
lookup (retry returns original with `idempotent: true`), in-transaction
re-check (concurrent duplicate guard), and `P2002` recovery. Accepted via
`Idempotency-Key` / `X-Idempotency-Key` header or body key (min 8 chars).
Retries never duplicate lines or deductions (tested).

## 7. Payment separation & commission (explicit extension point)

The blueprint defines **no POS commission treatment**, so this slice
stores an **informational quote only**: `commissionRate` /
`commissionAmount` computed through the existing configurable
`commission.service` (student-verified 16% vs tier rates resolve via
`admin_settings`, never hard-coded), with `commissionEligible = false`
always. **No settlement, no ledger accrual.** Settling POS commission is
deferred to the finance/admin slice.

Cash rules enforced today (existing architecture, no new percentages):

- `acceptCash` (provider, or T3 unit/business context) — else
  `CASH_NOT_ACCEPTED`.
- Cash-liability cap advisory check via `cash-caps.service` — a cash sale
  whose quote would breach the cap is rejected (`CASH_CAP_EXCEEDED`)
  **without mutating ledger state**.
- Payment-state rules: non-EFT sales must be `PAID`; EFT may be `PENDING`.

## 8. Authorization

`pos-scope.ts` reuses the existing tenant model (no new roles):
T1 own scope; T2 via existing `Team`/`TeamMember` (ACTIVE) to the team
owner's scope; T3 owned units (`Business.ownerProviderId`) + ACTIVE
`BusinessStaff` units. Ownership derived from the session; client
`providerId`/`businessUnitId` only select already-owned scope (forged
units → 403, foreign rows → safe 404).

## 9. API (`/api/v1/pos`, auth required, bounded pagination ≤ 50)

Inventory: `GET /inventory` (filters: `isActive`, `lowStock`, `search`,
`businessUnitId`), `POST /inventory`, `GET/PATCH /inventory/:id`,
`POST /inventory/:id/activate|deactivate|receive|adjust`,
`GET /inventory/:id/movements`.
Sales: `POST /sales`, `GET /sales` (filters: `paymentMethod`,
`paymentStatus`, `status`), `GET /sales/:id`,
`POST /sales/:id/reverse`. Sanitized `{ success, data, meta }` errors;
no stack/SQL leakage.

## 10. Audit & notifications

Audit (existing `audit_logs` only): `INVENTORY_ITEM_CREATED/UPDATED/
ACTIVATED/DEACTIVATED`, `STOCK_RECEIVED/ADJUSTED`, `POS_SALE_CREATED/
REVERSED`, all with the session actor.
Notifications (existing Slice 7 IN_APP only): `LOW_STOCK` intent to the
owning provider on crossing into the low-stock band; suppressed while
already low (no spam); failures never break writes.

## 11. Clients

Web (`/provider/pos`, `/provider/pos/sales/:id`, `/provider/inventory`,
`/provider/inventory/:id`) and mobile (same paths, `.page` components)
share the API and pure util logic; no mobile-only business rules.
Displayed totals are estimates; server confirms. **Offline: mutations are
blocked with an explicit "nothing was changed" message** — nothing is
queued or faked (full sync is Slice 18).

## 12. Deferred items / dependencies

1. POS commission settlement (finance/admin slice): decide accrual of
   `commissionEligible` quotes into `CashLedgerEntry` + cap accounting.
2. `waasha_payment` POS receipts vs gateway reconciliation.
3. Full offline sync (Slice 18).
4. Inventory images via Slice 11 upload flow (reference field ready).
5. T2/T3 management UI beyond scope reuse; payroll; accounting/tax;
   admin; training-centre; drivers — all out of scope, untouched.

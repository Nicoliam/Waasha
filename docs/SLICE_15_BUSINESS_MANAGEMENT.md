# Slice 15 — T2/T3 Business Management Architecture

**Status:** implemented (15/20 roadmap)
**Scope:** provider-facing team/business management only. Not admin,
not training-centre, not offline sync, not payroll/salary/commission
settlement, not accounting, not drivers, not ranking.

## 1. Tier model (unchanged)

T1 Individual / T2 Teams / T3 Business remain capability tiers, never
marketplace ranking signals (unit entries interleave by distance only).
Student stays a verified provider status (`studentVerificationStatus`),
never a self-selected tier; registration still allows T1/T2/T3 only.
Finance constants untouched: Student 16%, T1/T2/T3 25%, cash caps
R500/R1 000/R1 000/R5 000 — all configurable via existing finance
architecture, none referenced here.

## 2. T2 team management (`Team`/`TeamMember` only, no second role system)

- One team per T2 provider: `POST /me/team` (409 if exists),
  `GET/PATCH /me/team`. Roles are `OWNER | MANAGER | PROVIDER`
  (blueprint §4); `OWNER` is reserved for the owner row.
- Members: `GET/POST /me/team/members`, `PATCH/DELETE
  /me/team/members/:id`. Adds verify the target provider exists and is
  ACTIVE; self-add rejected. Removal **deactivates** (`INACTIVE`) —
  rows are never deleted, so `assignedProviderId` history and audits
  stay intact. Reactivation restores a previously deactivated row.
- Mutations require the owner or an ACTIVE OWNER/MANAGER membership;
  reads require ownership or ACTIVE membership. T1/T3 get 403
  `TIER_REQUIRED` on team endpoints.
- Team catalogue is shared at owner level (existing
  `provider-services` unit scoping); per-member service operation is
  expressed through booking assignment (§5).

## 3. T3 business management (existing models only)

- Businesses: `GET/POST /me/business`, `GET/PATCH /me/business/:id`,
  status `ACTIVE/INACTIVE` (deactivate, never delete).
  `verificationStatus` / `acceptCash` / ownership ids are rejected on
  write (422 mass-assignment guard) — finance architecture owns them.
- Units: `GET/POST /me/business/:id/units`, `GET/PATCH
  /me/business/units/:unitId`, `POST .../activate|deactivate`.
  `coverageRadiusKm` validated against marketplace config (10/15/20,
  max 20). Units deactivate, never delete.
- Locations: `POST /me/business/units/:unitId/location` appends a new
  `BusinessLocation` (single primary kept). `booking_locations` rows
  are snapshots and are **never** touched here.
- Categories: `PUT /me/business/units/:unitId/categories` replaces
  `BusinessUnitCategory` links (1–5, must exist in `service_categories`;
  providers cannot create categories). The five launch categories are
  unchanged.
- Staff: `GET/POST /me/business/:id/staff`, `PATCH/DELETE
  /me/business/staff/:id` (role MANAGER/STAFF, unit must belong to the
  business, deactivate-never-delete). Management requires the owner or
  an ACTIVE OWNER/MANAGER staff row.
- Services: `POST .../units/:unitId/services/:serviceId/attach` and
  `DELETE ...` set/clear `Service.businessUnitId` (existing field).
  Price snapshots in `booking_items` are never recalculated.

## 4. Invitations (`team_invitations`, `business_staff_invitations`)

- `crypto.randomBytes(32)` tokens; only the SHA-256 hash persists; the
  raw token is returned once and never logged or re-exposed (list
  endpoints serialize without it — tested).
- Scoped to exactly one team or business(+unit); 7-day expiry;
  single-use (`PENDING → ACCEPTED/REVOKED/EXPIRED` inside a
  transaction; concurrent/double acceptance fails closed); revocable
  while pending.
- Provider-scoped invites bind to that provider id — cross-business
  acceptance returns 403. Email-only invites carry no identity binding
  and are accepted by the authenticated provider that presents the
  token (still scoped to the one team/business).
- Hooks use the existing Slice 7 IN_APP abstraction only
  (`TEAM_INVITATION`, `STAFF_INVITATION`); no vendors.

## 5. Booking assignment (`assignedProviderId`, existing field)

- `POST /me/bookings/:id/assign { assignedProviderId }` and `POST
  .../unassign`. T2 owner (or ACTIVE MANAGER member) for provider-owned
  bookings; T3 owner (or ACTIVE OWNER/MANAGER staff) for unit bookings.
  Assignment itself requires T2/T3 tier (T1 → 403).
- Assignee must be an ACTIVE team member / business staff operator
  (or self); terminal states (`COMPLETED/CANCELLED/DECLINED/...`)
  reject with 422. Status, payment state and completion are **never**
  modified here (asserted by tests).
- Assignees gain operational visibility through the pre-existing
  `assignedProviderId` read scope. Location privacy unchanged
  (PENDING stays redacted). Staff visibility (`staffUnitIds`) is
  read-only: accept/decline/complete additionally require
  `isBookingManageable` (owner, assignee, or owned unit) — unassigned
  staff get 403 on transitions (tested).

## 6. Marketplace `BusinessLocation` integration

`GET /api/v1/marketplace/providers` additionally indexes ACTIVE
`BusinessLocation` rows of ACTIVE units of ACTIVE businesses with an
ACTIVE owner provider, under the **same BOTH rule**
(`distance ≤ customer radius` AND `distance ≤ unit coverageRadiusKm`,
absolute max 20 km) and the same allowed customer radii (10/15/20).
Unit entries (`kind: 'business_unit'`, with `businessId`,
`businessUnitId`, `unitName`) merge with provider entries
(`kind: 'provider'`) sorted purely by distance — no tier boost
(tested: nearer unit sorts before farther T1). Category filtering
resolves via `BusinessUnitCategory` links or unit services. With no
unit data the response is unchanged from previous slices.

## 7. POS/inventory scope (Slice 14 reused, not duplicated)

Existing `pos-scope.ts` already resolves owned + staff + team-owner
scope; this slice adds endpoint-level proof (owner sees unit items,
outsider gets safe 404, staff/team-member scope resolution tested).
No Slice 14 financial rule changed.

## 8. Authorization summary

Session-derived everywhere; `providerId/businessId/businessUnitId/
teamId/staffId` from the client are selectors, never authority.
T1: own resources (no team/business/assign). T2: own team only.
T3: own businesses/units only. Staff: ACTIVE rows, operational
visibility only. Cross-tenant → safe 404 (`*_NOT_FOUND`) where
existence must not leak, else 403. IDOR/privilege-escalation covered
by ~30 dedicated tests.

## 9. Audit & notifications (existing mechanisms only)

Audit (`audit_logs`): `TEAM_CREATED/UPDATED`, `TEAM_MEMBER_ADDED/
UPDATED/REMOVED`, `TEAM_INVITATION_CREATED/REVOKED/ACCEPTED`,
`BUSINESS_CREATED/UPDATED/DEACTIVATED`, `BUSINESS_UNIT_CREATED/
UPDATED/ACTIVATED/DEACTIVATED/LOCATION_UPDATED/CATEGORIES_UPDATED`,
`SERVICE_ASSIGNED/UNASSIGNED`, `STAFF_ADDED/UPDATED/ASSIGNED/
REMOVED`, `STAFF_INVITATION_CREATED/REVOKED/ACCEPTED`,
`BOOKING_ASSIGNED/UNASSIGNED` — all with session actor.
Notifications (Slice 7 IN_APP, new canonical types defaulting to the
transactional category): `TEAM_INVITATION/MEMBER_ADDED/MEMBER_REMOVED`,
`STAFF_INVITATION/ADDED/REMOVED/ASSIGNED`, `BOOKING_ASSIGNED`,
`BUSINESS_UNIT_UPDATED`. Failures never break writes.

## 10. Clients

Web (`/provider/team`, `/provider/team/members`, `/provider/business`,
`/provider/business/units`, `/provider/business/units/:id`,
`/provider/business/staff`, `/provider/business/categories`) and
mobile (same paths, `.page` components) share `BusinessApiService`
and pure `business.utils`; no mobile-only rules. Tier is displayed
and T2/T3 sections are gated in UI, but the server re-enforces every
rule. **Offline: all mutations blocked with an explicit "nothing was
changed" message** — nothing queued or faked (sync is Slice 18).

## 11. Concurrency

Membership/staff writes, invitation acceptance, category replacement
and assignment run in transactions; unique constraints
(`[teamId,providerId]`, `tokenHash`) plus in-transaction re-reads
guard doubles and double-accepts (tested).

## 12. Deferred items / dependencies

1. Migration needs a live DB apply (`prisma migrate dev`) — SQL
   validated against MySQL 9.6 scratch schema; app DB was unreachable
   in this environment (auth-plugin mismatch on stored credentials).
2. T3 `acceptCash` toggles (finance-owned), payroll/salary/staff
   commission, accounting/tax integrations.
3. Team availability/scheduling views, team performance/payouts
   (blueprint §6 extras beyond assignment).
4. Business analytics/consolidated dashboard metrics (Admin slice may
   overlap).
5. Full offline sync (Slice 18). Push/email/SMS invitation delivery
   (vendor adapters behind the existing abstraction).
6. Admin Platform (Slice 16) — do not start here.

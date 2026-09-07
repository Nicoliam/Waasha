# SLICE 18 — Offline-First Synchronization & Sync Engine

Production sync foundation (Blueprint Document 16). Supported operations
tolerate temporary connectivity loss; server authority, authorization,
idempotency, ordering, conflict safety and financial integrity are preserved.
Queueing is NEVER success — the UI distinguishes waiting from confirmed.

## 1. Architecture: shared core + thin platform adapters

All sync logic lives once in `shared/sync/` (framework-agnostic TypeScript,
zero Angular/Ionic/Node imports) and is shared verbatim by web and mobile:

- `sync-types.ts` — op model, states, retry policy, executor contract.
- `sync-store.ts` — durable queue over an injected key-value adapter, per-user
  namespaces, secret-payload rejection, 7-day terminal retention, 200-op cap.
- `connectivity.ts` — multi-signal monitor (OS events + `GET /health` probe +
  observed failures): ONLINE / LIMITED / OFFLINE / SYNCING / SYNC_ERROR.
- `sync-classify.ts` — error classification + bounded exp backoff with jitter.
- `sync-engine.ts` — single-flight FIFO scheduler, dependency gates,
  auth pause/resume, dead-letter states, restart recovery.
- `op-registry.ts` — the syncable/online-only contract (below).
- `sync-executor.ts` — op → existing-endpoint request mapping + error normalization.

Platform adapters (`apps/web|mobile/src/app/core/sync/sync.service.ts`,
identical except comments) provide: localStorage persistence, HttpClient
transport, installation id, auth-state binding/resume, UI observables,
`enqueueAs` (session-derived scope), `requireOnline` (explicit nothing-changed
errors for online-only mutations), and the media blob registry.

No second token strategy: the engine only observes auth state (401 → pause,
re-login → resume). No generic `/api/v1/sync` endpoint was added — the queue
replays existing domain endpoints one by one (blueprint §26 explicitly allows
domain-specific sync; avoids a broad new tenant-mixing surface).

## 2. Queue lifecycle

ENQUEUE (validated: known type, safe payload, known deps, session scope)
→ PENDING → SYNCING → SYNCED | RETRYING (backoff) → FAILED (dead-letter) |
CONFLICT (server wins) | BLOCKED_ON_AUTH (paused) | CANCELLED (user).
Manual Retry resets attempts; Discard cancels. Restart replays SYNCING rows
as PENDING with the SAME idempotency key (server dedupes).

## 3. Syncable operations (auto-queue)

| Op | Endpoint | Idempotency | Notes |
|---|---|---|---|
| `pos.sale.create` | POST /api/v1/pos/sales | body + header (existing) | Sale REQUEST; stock revalidated transactionally; shortage → CONFLICT, never negative stock |
| `finance.cash-booking.create` | POST /api/v1/finance/cash-bookings | body (existing) | Booking REQUEST pending confirmation; taken slot → 409 CONFLICT, never silent rebooking |
| `notifications.mark-read` / `read-all` | PATCH/POST existing | flag writes | Optimistic + will-sync note; server-wins on refresh |
| `media.upload-task` | existing media flow | session + finalize | Metadata-only queue; bytes from session registry; success only on finalize; missing blob → explicit FAILED |

## 4. Intentionally online-only (blocked with explicit reasons)

payments.*, standard booking create (no server key — duplicates), booking
accept/decline/cancel/complete/assign, finance settlements + all other finance
mutations, admin.*, partners.*, verification.*, inventory receive/adjust
(no key — double-apply), sale reversals, services/profile/availability/business
writes (durable LOCAL DRAFTS instead; publish explicitly online), reviews.
`SyncService.requireOnline(opKey)` throws the registry reason + "Nothing was
changed." Sensitive booking/payment/completion flows keep their existing
nothing-changed offline blocks.

## 5. Retry/backoff

Transient (network/timeout/5xx/executor-throw) → exp backoff base 1s ×2, cap
30s, ±25% jitter, max 5 attempts → FAILED `RETRIES_EXHAUSTED` (kept, no silent
drop, no infinite loop). 401 → pause + BLOCKED_ON_AUTH (never blind-retry).
403 → FAILED FORBIDDEN. 409/conflict codes (incl. INSUFFICIENT_STOCK,
CASH_CAP_EXCEEDED) → CONFLICT with human wording. Other 4xx → FAILED permanent.

## 6. Idempotency

Key = `installationId:opUuid`, minted at enqueue, stable across retries,
restarts and manual retries. Server dedupes via existing keys (POS sale key,
cash-booking key, notification flags, media session+finalize). Duplicate
replay returns the existing record → SYNCED.

## 7. Conflicts: server wins, user reviews

No last-write-wins for booking/finance data. 409/slot/stock → CONFLICT state
with safe wording ("nothing was booked/applied"); user picks a new time or
quantity and retries. Drafts (profile/service text) are local-only and never
auto-merge server truth.

## 8. Ordering

FIFO + `dependsOn` gates (unknown deps rejected at enqueue); dependents of
failed/conflicted/cancelled ops fail explicitly `DEPENDENCY_UNMET` (no silent
stall). No fake IDs become server identifiers (serverId recorded post-verdict).

## 9. Auth expiry

401 → op BLOCKED_ON_AUTH + whole queue pauses. Re-login → `notifyAuthRestored`
resumes automatically. Logout pauses; per-user durable queues survive.
Suspension/mid-queue permission loss surfaces as 403 → FAILED, never bypassed.

## 10. Local persistence & privacy

Per-user localStorage namespaces; installation UUID (non-sensitive) only.
Payloads scanned for credential-like keys at enqueue AND persist (throw
`QUEUE_UNSAFE_PAYLOAD`). No prices-as-authority, no roles/tenants-as-authority
(the server derives all authority from the session). Cached reads keep existing
TTL/freshness behavior; authoritative data always re-read from server.

## 11. Web/mobile

Same core, same endpoints, same rules, same wording. Differences: WebView vs
browser localStorage note, component/page shells. Status pill in both app
headers: Online / Offline·N waiting / Syncing… / Limited / Needs attention (N),
with per-op Retry/Discard and manual Sync now. Testable without devices
(backend jest imports the shared core directly).

## 12. Backend changes

NONE. No migration (state explicitly: not required — queue is client-side,
server contracts already idempotent). No new endpoints. POS sale, cash
booking, notification and media flows verified contract-compatible.

## 13. Tests

`backend/tests/sync-engine.test.ts` (36: validation, offline/reconnect,
durability, retry/backoff/bounds, classification, auth pause/resume,
ordering/deps, dead-letter, connectivity) +
`backend/tests/sync-contracts.test.ts` (22: matrix, request contracts,
parity, wording, no-secret/no-framework scans). 58 new tests.

## 14. Limitations

Media blobs are session-memory (restart → explicit reselect guidance);
standard bookings stay online-only until a server idempotency key exists;
probes are cooldown-guarded (15s); queue cap 200; terminal retention 7 days
(FAILED/CONFLICT kept until user acts).

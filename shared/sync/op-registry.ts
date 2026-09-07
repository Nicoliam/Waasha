/**
 * Slice 18 — syncable-operation registry + online-only matrix.
 *
 * A type is queueable ONLY if listed in SYNCABLE_OPS with an explicit
 * idempotent server contract. Everything else is online-only: enqueue()
 * rejects it with SYNC_ONLINE_ONLY and the UI must say so explicitly
 * (never imply success). Server authority, validation and authorization
 * are unchanged — the queue only retries the same request the user made.
 */

export interface SyncableOpDef {
  /** Registry key used in SyncOp.type. */
  type: string;
  /** Human label for pending-list UI. */
  label: string;
  /** Where the engine must place the idempotency key per attempt. */
  idempotency: 'body' | 'header' | 'both';
  /** Survives app restart (durable) vs memory-only. */
  durable: boolean;
  notes: string;
}

/**
 * Queueable operations. Each maps 1:1 to an existing idempotent endpoint:
 * - pos.sale.create → POST /api/v1/pos/sales (idempotencyKey body/header; stock validated transactionally)
 * - finance.cash-booking.create → POST /api/v1/finance/cash-bookings (idempotencyKey; slot validated, 409 on conflict)
 * - notifications.mark-read / read-all → idempotent flag writes, server-wins on refresh
 * - media.upload-task → metadata-only task; bytes flow through the existing media upload on reconnect
 */
export const SYNCABLE_OPS: Record<string, SyncableOpDef> = {
  'pos.sale.create': {
    type: 'pos.sale.create',
    label: 'POS sale',
    idempotency: 'both',
    durable: true,
    notes: 'Queued as a sale REQUEST. Server validates stock/prices transactionally; short stock becomes a conflict, never negative stock.',
  },
  'finance.cash-booking.create': {
    type: 'finance.cash-booking.create',
    label: 'Cash booking request',
    idempotency: 'body',
    durable: true,
    notes: 'Queued as a booking REQUEST pending confirmation. Server validates availability; a taken slot becomes a conflict, never a silent rebooking.',
  },
  'notifications.mark-read': {
    type: 'notifications.mark-read',
    label: 'Mark notification read',
    idempotency: 'both',
    durable: true,
    notes: 'Idempotent flag write. Read state reconciles server-wins on refresh.',
  },
  'notifications.read-all': {
    type: 'notifications.read-all',
    label: 'Mark all notifications read',
    idempotency: 'both',
    durable: true,
    notes: 'Idempotent flag write. Read state reconciles server-wins on refresh.',
  },
  'media.upload-task': {
    type: 'media.upload-task',
    label: 'Media upload',
    idempotency: 'both',
    durable: true,
    notes: 'Metadata-only queue record. File bytes upload through the existing media flow on reconnect; success is never claimed before server confirmation.',
  },
};

export function isSyncableOp(type: string): boolean {
  return Object.prototype.hasOwnProperty.call(SYNCABLE_OPS, type);
}

/** Operations that must NEVER be queued. UI must block with an explicit message. */
export const ONLINE_ONLY_OPS: ReadonlyArray<{ match: string; reason: string }> = [
  { match: 'payments.*', reason: 'Payment initiation/confirmation is server-authoritative. Unknown-state risk: never claim success offline.' },
  { match: 'bookings.create-standard', reason: 'Standard booking creation has no server idempotency key; retry could duplicate bookings. Prepare the request, confirm online.' },
  { match: 'bookings.accept', reason: 'Acceptance changes availability for others — requires live server validation.' },
  { match: 'bookings.decline', reason: 'Requires live server state.' },
  { match: 'bookings.cancel', reason: 'Cancellation windows/fees are server-computed on live state.' },
  { match: 'bookings.complete', reason: 'Completion is server-authoritative and must never be faked from a queue.' },
  { match: 'bookings.assign', reason: 'Staff assignment is concurrency-sensitive; conflicts must be decided live.' },
  { match: 'finance.settle*', reason: 'Cash settlement moves money — server-authoritative only.' },
  { match: 'finance.*', reason: 'Finance mutations (beyond explicitly syncable cash-booking requests) are server-authoritative.' },
  { match: 'admin.*', reason: 'Admin actions (verification, suspension, finance config, refunds) require live validation.' },
  { match: 'partners.*', reason: 'Partner/attribution/finance-rule changes require live validation.' },
  { match: 'verification.*', reason: 'Verification outcomes are authoritative and admin-controlled.' },
  { match: 'pos.inventory.*', reason: 'Manual inventory receive/adjust has no idempotency key; retry could double-apply movements.' },
  { match: 'pos.sales.reverse', reason: 'Reversals alter settled records — live validation required.' },
  { match: 'services.*', reason: 'Catalogue writes use local drafts; publish explicitly while online.' },
  { match: 'profile.*', reason: 'Profile writes use local drafts; save explicitly while online.' },
  { match: 'availability.*', reason: 'Schedule writes use local drafts; publish explicitly while online.' },
  { match: 'business.*', reason: 'Team/business/staff writes are tenant-sensitive; change explicitly while online.' },
  { match: 'reviews.*', reason: 'Reviews attach to booking outcomes; submit explicitly while online.' },
];

function matchGlob(pattern: string, value: string): boolean {
  const rx = new RegExp(`^${pattern.split('*').map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`);
  return rx.test(value);
}

/** Human reason why an operation key is online-only (undefined when queueable/unknown). */
export function onlineOnlyReason(key: string): string | undefined {
  if (isSyncableOp(key)) return undefined;
  const hit = ONLINE_ONLY_OPS.find((o) => matchGlob(o.match, key));
  return hit?.reason;
}

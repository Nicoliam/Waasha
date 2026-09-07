/**
 * Slice 18 — op → HTTP request mapping (shared, framework-agnostic).
 *
 * Each syncable op maps to exactly one existing domain endpoint with the
 * op's stable idempotency key attached. No new endpoints, no new semantics:
 * the server validates and authorizes exactly as if the request were made
 * online. The executor transport (HttpClient/fetch) is injected by the
 * platform wrapper.
 */
import type { SyncOp } from './sync-types';

export interface SyncHttpRequest {
  method: 'POST' | 'PATCH' | 'PUT';
  url: string;
  body: Record<string, unknown>;
  headers: Record<string, string>;
}

export function buildSyncRequest(op: SyncOp): SyncHttpRequest {
  const key = op.idempotencyKey;
  switch (op.type) {
    case 'pos.sale.create':
      return {
        method: 'POST',
        url: '/api/v1/pos/sales',
        body: { ...(op.payload as Record<string, unknown>), idempotencyKey: key },
        headers: { 'Idempotency-Key': key },
      };
    case 'finance.cash-booking.create':
      return {
        method: 'POST',
        url: '/api/v1/finance/cash-bookings',
        body: { ...(op.payload as Record<string, unknown>), idempotencyKey: key },
        headers: {},
      };
    case 'notifications.mark-read': {
      const raw = op.payload as Record<string, unknown>;
      const id = String(raw['notificationId'] ?? '');
      return { method: 'PATCH', url: `/api/v1/notifications/${encodeURIComponent(id)}/read`, body: {}, headers: {} };
    }
    case 'notifications.read-all':
      return { method: 'POST', url: '/api/v1/notifications/read-all', body: {}, headers: {} };
    case 'media.upload-task':
      // Media bytes flow through the existing media-upload flow on reconnect;
      // the queue record only tracks intent + metadata. The platform wrapper
      // resolves this op type with the media task runner instead of plain HTTP.
      return { method: 'POST', url: '/api/v1/media/__upload-task__', body: { ...(op.payload as Record<string, unknown>) }, headers: {} };
    default:
      throw Object.assign(new Error(`No sync contract for operation "${op.type}"`), { code: 'SYNC_UNKNOWN_OP' });
  }
}

/** Normalize a transport failure into the executor result shape. */
export function toExecError(err: unknown): { status?: number; code?: string; message?: string; network?: boolean; timeout?: boolean } {
  if (err !== null && typeof err === 'object') {
    const e = err as Record<string, unknown>;
    const rawNested = e['error'];
    const nested = rawNested !== null && typeof rawNested === 'object' ? (rawNested as Record<string, unknown>) : {};
    const status = typeof e['status'] === 'number'
      ? (e['status'] as number)
      : typeof nested['status'] === 'number'
        ? (nested['status'] as number)
        : undefined;
    const code = typeof nested['code'] === 'string'
      ? (nested['code'] as string)
      : typeof e['code'] === 'string'
        ? (e['code'] as string)
        : undefined;
    const message = typeof nested['message'] === 'string'
      ? (nested['message'] as string)
      : typeof e['message'] === 'string'
        ? (e['message'] as string)
        : undefined;
    if (status !== undefined || code !== undefined) return { status, code, message };
    const msg = String(message ?? 'request failed');
    if (/timeout|timed out|ETIMEDOUT|abort/i.test(msg)) return { timeout: true, message: msg.slice(0, 200) };
    return { network: true, message: msg.slice(0, 200) };
  }
  return { network: true, message: 'request failed' };
}

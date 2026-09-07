/**
 * Slice 18 — durable queue store over an injected key-value adapter.
 *
 * The engine never touches localStorage/IndexedDB directly: platforms inject
 * a `SyncStorage` (localStorage on web + Capacitor WebView, in-memory in
 * tests). Tenant isolation: one key namespace per session user id; the store
 * refuses to load another user's queue. No secrets are persisted — payloads
 * are scanned at write time and rejected when they look like credentials.
 */
import type { SyncOp } from './sync-types';

export interface SyncStorage {
  getItem(key: string): string | null | Promise<string | null>;
  setItem(key: string, value: string): void | Promise<void>;
  removeItem(key: string): void | Promise<void>;
}

export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

const KEY_PREFIX = 'waasha.sync.v1.';
const queueKey = (userId: string) => `${KEY_PREFIX}queue.${userId}`;
const metaKey = (userId: string) => `${KEY_PREFIX}meta.${userId}`;

/** Prune terminal SYNCED/CANCELLED rows older than this (FAILED/CONFLICT kept for review). */
export const TERMINAL_RETENTION_MS = 7 * 24 * 3600 * 1000;
/** Hard cap: refuse new work with QUEUE_FULL rather than unbounded growth. */
export const MAX_QUEUE_OPS = 200;

/** Keys that must never appear in a queued payload (defense in depth). */
const SECRET_KEY = /(password|passwd|secret|token|card|cardnumber|cvv|cvc|pin|private[_-]?key|api[_-]?key|webhook[_-]?secret|authorization)/i;

export function assertQueuePayloadSafe(payload: unknown, path = 'payload'): void {
  if (Array.isArray(payload)) {
    payload.forEach((v, i) => assertQueuePayloadSafe(v, `${path}[${i}]`));
    return;
  }
  if (payload !== null && typeof payload === 'object') {
    for (const [k, v] of Object.entries(payload as Record<string, unknown>)) {
      if (SECRET_KEY.test(k)) {
        throw Object.assign(new Error(`Refused to queue sensitive field "${path}.${k}"`), {
          code: 'QUEUE_UNSAFE_PAYLOAD',
        });
      }
      assertQueuePayloadSafe(v, `${path}.${k}`);
    }
  }
}

export interface StoreMeta {
  installationId: string;
  updatedAt: string;
}

export function loadQueue(storage: SyncStorage, userId: string): Promise<SyncOp[]> {
  return Promise.resolve(storage.getItem(queueKey(userId))).then((raw) => {
    if (!raw) return [];
    try {
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return (parsed as SyncOp[]).filter((o) => o && typeof o.id === 'string' && typeof o.type === 'string');
    } catch {
      return [];
    }
  });
}

export function saveQueue(storage: SyncStorage, userId: string, ops: SyncOp[]): Promise<void> {
  for (const op of ops) assertQueuePayloadSafe(op.payload);
  return Promise.resolve(storage.setItem(queueKey(userId), JSON.stringify(ops))).then(() => undefined);
}

export function loadMeta(storage: SyncStorage, userId: string): Promise<StoreMeta | null> {
  return Promise.resolve(storage.getItem(metaKey(userId))).then((raw) => {
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as StoreMeta;
      if (!parsed || typeof parsed.installationId !== 'string') return null;
      return parsed;
    } catch {
      return null;
    }
  });
}

export function saveMeta(storage: SyncStorage, userId: string, meta: StoreMeta): Promise<void> {
  return Promise.resolve(storage.setItem(metaKey(userId), JSON.stringify(meta))).then(() => undefined);
}

/** Drop retained terminal rows; keeps FAILED/CONFLICT/BLOCKED for user review. */
export function pruneQueue(ops: SyncOp[], nowMs: number): SyncOp[] {
  return ops.filter((op) => {
    if ((op.state === 'SYNCED' || op.state === 'CANCELLED') && op.updatedAt) {
      return nowMs - new Date(op.updatedAt).getTime() < TERMINAL_RETENTION_MS;
    }
    return true;
  });
}

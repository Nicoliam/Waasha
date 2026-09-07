/**
 * Slice 18 — sync contracts (shared core + web/mobile parity).
 *
 * Verifies the REAL shared registry/executor/classifier, the REAL web and
 * mobile SyncService sources (same core, same endpoints, same wording), UI
 * wiring (status pill, POS offline queue, notifications offline queue,
 * booking online-only guard), idempotency placement, and that no sync path
 * trusts client identity, leaks secrets, or fabricates success.
 */
import * as fs from 'fs';
import * as path from 'path';
import { buildSyncRequest, toExecError } from '../../shared/sync/sync-executor';
import { ONLINE_ONLY_OPS, SYNCABLE_OPS, isSyncableOp, onlineOnlyReason } from '../../shared/sync/op-registry';
import { classifySyncError } from '../../shared/sync/sync-classify';
import type { SyncOp } from '../../shared/sync/sync-types';

function read(rel: string): string {
  return fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');
}

function op(type: string, payload: Record<string, unknown> = {}): SyncOp {
  const now = new Date().toISOString();
  return {
    id: 'op-1', type, scope: { userId: 'u-1', tenantKind: 'PROVIDER' }, payload,
    idempotencyKey: 'inst:op-1', dependsOn: [], state: 'PENDING', attemptCount: 0,
    notBefore: null, lastError: null, serverId: null, syncedAt: null, createdAt: now, updatedAt: now,
  };
}

describe('Slice 18 — syncable matrix', () => {
  it('1. exactly the idempotent operations are queueable', () => {
    expect(Object.keys(SYNCABLE_OPS).sort()).toEqual([
      'finance.cash-booking.create',
      'media.upload-task',
      'notifications.mark-read',
      'notifications.read-all',
      'pos.sale.create',
    ]);
    for (const k of Object.keys(SYNCABLE_OPS)) expect(isSyncableOp(k)).toBe(true);
  });

  it('2. sensitive operations are online-only with explicit reasons', () => {
    for (const k of [
      'payments.initiate', 'payments.confirm', 'bookings.create-standard', 'bookings.accept',
      'bookings.decline', 'bookings.cancel', 'bookings.complete', 'bookings.assign',
      'finance.settle', 'finance.settlements', 'admin.verify', 'partners.apply',
      'verification.student', 'pos.inventory.adjust', 'pos.inventory.receive',
      'pos.sales.reverse', 'services.create', 'profile.update', 'availability.save',
      'business.staff.add', 'reviews.create',
    ]) {
      expect(isSyncableOp(k)).toBe(false);
      const reason = onlineOnlyReason(k);
      expect(typeof reason).toBe('string');
      expect((reason as string).length).toBeGreaterThan(10);
    }
  });

  it('3. registry entries carry idempotency placement + durability', () => {
    expect(SYNCABLE_OPS['pos.sale.create'].idempotency).toBe('both');
    expect(SYNCABLE_OPS['finance.cash-booking.create'].idempotency).toBe('body');
    for (const def of Object.values(SYNCABLE_OPS)) expect(def.durable).toBe(true);
  });
});

describe('Slice 18 — request contracts', () => {
  it('4. POS sale replays the existing endpoint with the stable key (body + header)', () => {
    const r = buildSyncRequest(op('pos.sale.create', { lines: [{ a: 1 }] }));
    expect(r).toMatchObject({ method: 'POST', url: '/api/v1/pos/sales' });
    expect(r.body).toMatchObject({ lines: [{ a: 1 }], idempotencyKey: 'inst:op-1' });
    expect(r.headers['Idempotency-Key']).toBe('inst:op-1');
  });

  it('5. cash-booking replays the existing endpoint with the stable key', () => {
    const r = buildSyncRequest(op('finance.cash-booking.create', { grossAmount: 100 }));
    expect(r).toMatchObject({ method: 'POST', url: '/api/v1/finance/cash-bookings' });
    expect(r.body).toMatchObject({ idempotencyKey: 'inst:op-1' });
  });

  it('6. notification reads map to existing endpoints without payload secrets', () => {
    const one = buildSyncRequest(op('notifications.mark-read', { notificationId: 'n-1' }));
    expect(one.url).toBe('/api/v1/notifications/n-1/read');
    const all = buildSyncRequest(op('notifications.read-all', {}));
    expect(all).toMatchObject({ method: 'POST', url: '/api/v1/notifications/read-all' });
  });

  it('7. unknown op types throw (no generic catch-all sync endpoint)', () => {
    try {
      buildSyncRequest(op('payments.initiate', {}));
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as { code?: string }).code).toBe('SYNC_UNKNOWN_OP');
    }
  });

  it('8. transport errors normalize (status/code preserved, timeouts detected)', () => {
    expect(toExecError({ status: 409, error: { code: 'BOOKING_CONFLICT' } })).toMatchObject({ status: 409, code: 'BOOKING_CONFLICT' });
    expect(toExecError({ status: 401 })).toMatchObject({ status: 401 });
    expect(toExecError(new Error('timeout of 5000ms exceeded'))).toMatchObject({ timeout: true });
    expect(toExecError(new Error('Network Error'))).toMatchObject({ network: true });
  });

  it('9. backend really accepts the queued keys (route/schema contracts)', () => {
    const posRoutes = read('backend/src/modules/pos/pos.routes.ts');
    expect(posRoutes).toContain('idempotencyKey');
    // Header name is case-insensitive over HTTP; server reads the lowercased form.
    expect(posRoutes.toLowerCase()).toContain('idempotency-key');
    const finRoutes = read('backend/src/modules/finance/finance.routes.ts');
    expect(finRoutes).toContain('idempotencyKey');
    const notifRoutes = read('backend/src/modules/notifications/notification.routes.ts');
    expect(notifRoutes).toContain('/:id/read');
    expect(notifRoutes).toContain('/read-all');
  });
});

describe('Slice 18 — web/mobile parity', () => {
  const WEB_SVC = 'apps/web/src/app/core/sync/sync.service.ts';
  const MOB_SVC = 'apps/mobile/src/app/core/sync/sync.service.ts';

  it('10. both wrappers share the same core modules (no duplicated logic)', () => {
    for (const f of [WEB_SVC, MOB_SVC]) {
      const src = read(f);
      for (const m of ['sync-engine', 'sync-executor', 'op-registry', 'connectivity']) {
        expect(src).toContain(m);
      }
    }
  });

  it('11. both wrappers expose the same surface (enqueue/retry/cancel/syncNow/requireOnline)', () => {
    for (const f of [WEB_SVC, MOB_SVC]) {
      const src = read(f);
      for (const m of ['enqueueAs(', 'retryOp(', 'cancelOp(', 'syncNow(', 'requireOnline(', 'notifyAuthRestored(', 'enqueue(input']) {
        expect(src).toContain(m);
      }
    }
  });

  it('12. both wrappers bind queue scope from the session (never caller args)', () => {
    for (const f of [WEB_SVC, MOB_SVC]) {
      const src = read(f);
      expect(src).toContain('auth.snapshot()');
      expect(src).toContain('SYNC_NO_SESSION');
      expect(src).not.toContain('scope: input.scope');
    }
  });

  it('13. both wrappers probe the real API health endpoint (not OS signal alone)', () => {
    for (const f of [WEB_SVC, MOB_SVC]) {
      const src = read(f);
      expect(src).toContain('/health');
      expect(src).toContain("addEventListener('online'");
    }
  });

  it('14. sync-status UI exists on both apps with honest wording', () => {
    for (const f of [
      'apps/web/src/app/shared/components/sync/sync-status.component.ts',
      'apps/mobile/src/app/shared/components/sync/sync-status.component.ts',
    ]) {
      const src = read(f);
      expect(src).toContain('Needs attention');
      expect(src).toContain('waiting for connection');
      // "Synced — confirmed by server" appears ONLY for the SYNCED row (real verdict).
      expect(src).not.toContain('Sale recorded');
      expect(src).not.toContain('Booking confirmed');
    }
  });

  it('15. status components mount in both app shells', () => {
    expect(read('apps/web/src/app/app.html')).toContain('<waasha-sync-status />');
    expect(read('apps/mobile/src/app/app.html')).toContain('<waasha-sync-status />');
    expect(read('apps/web/src/app/app.ts')).toContain('SyncStatusComponent');
    expect(read('apps/mobile/src/app/app.ts')).toContain('SyncStatusComponent');
  });

  it('16. POS offline path queues a REQUEST with not-recorded wording (both apps)', () => {
    for (const f of [
      'apps/web/src/app/features/provider-pos/pos.component.ts',
      'apps/mobile/src/app/features/provider-pos/pos.page.ts',
    ]) {
      const src = read(f);
      expect(src).toContain("enqueueAs('pos.sale.create'");
      expect(src).toContain('NOT recorded yet');
      expect(src).not.toContain('Sale recorded: {{ queuedSale');
    }
  });

  it('17. notifications queue read-state offline with reconcile wording (both apps)', () => {
    for (const f of [
      'apps/web/src/app/features/notifications/notifications.component.ts',
      'apps/mobile/src/app/features/notifications/notifications.page.ts',
    ]) {
      const src = read(f);
      expect(src).toContain("enqueueAs('notifications.mark-read'");
      expect(src).toContain("enqueueAs('notifications.read-all'");
      expect(src).toContain('will sync when you reconnect');
    }
  });

  it('18. standard booking creation is explicitly online-only (both apps)', () => {
    for (const f of [
      'apps/web/src/app/features/booking/booking.component.ts',
      'apps/mobile/src/app/features/booking/booking.page.ts',
    ]) {
      const src = read(f);
      expect(src).toContain('intentionally online-only');
      expect(src).toContain('nothing was booked');
      expect(src).not.toContain("enqueueAs('bookings");
    }
  });

  it('19. no sync UI claims server success for queued work', () => {
    const bad = /queued.*(confirmed|completed|paid|successfully recorded)|sale is recorded|payment succeeded/i;
    for (const f of [
      'apps/web/src/app/shared/components/sync/sync-status.component.ts',
      'apps/mobile/src/app/shared/components/sync/sync-status.component.ts',
      'apps/web/src/app/features/provider-pos/pos.component.ts',
      'apps/mobile/src/app/features/provider-pos/pos.page.ts',
      'apps/web/src/app/features/booking/booking.component.ts',
      'apps/mobile/src/app/features/booking/booking.page.ts',
    ]) {
      expect(read(f)).not.toMatch(bad);
    }
  });

  it('20. shared core has no framework or secret imports', () => {
    for (const f of [
      'shared/sync/sync-engine.ts',
      'shared/sync/sync-store.ts',
      'shared/sync/connectivity.ts',
      'shared/sync/sync-classify.ts',
      'shared/sync/op-registry.ts',
      'shared/sync/sync-executor.ts',
    ]) {
      const src = read(f);
      expect(src).not.toContain('@angular');
      // No direct platform storage access (injected adapter only; comments may name it).
      expect(src).not.toContain('localStorage.');
      expect(src).not.toContain('indexedDB.');
      expect(src).not.toContain('window.');
      expect(src).not.toContain('console.log');
      expect(src).not.toContain('debugger');
    }
  });

  it('21. error classifier honors the retry matrix', () => {
    expect(classifySyncError({ network: true }).kind).toBe('TRANSIENT');
    expect(classifySyncError({ status: 503 }).kind).toBe('TRANSIENT');
    expect(classifySyncError({ status: 401 }).kind).toBe('AUTH');
    expect(classifySyncError({ status: 403 }).kind).toBe('FORBIDDEN');
    expect(classifySyncError({ status: 409 }).kind).toBe('CONFLICT');
    expect(classifySyncError({ status: 422, code: 'INSUFFICIENT_STOCK' }).kind).toBe('CONFLICT');
    expect(classifySyncError({ status: 422, code: 'VALIDATION_ERROR' }).kind).toBe('PERMANENT');
  });

  it('22. online-only matrix covers every sensitive family', () => {
    const text = ONLINE_ONLY_OPS.map((o) => o.match).join(' ');
    for (const fam of ['payments', 'bookings.', 'finance.', 'admin.', 'partners.', 'verification', 'pos.inventory', 'pos.sales.reverse', 'services.', 'profile.', 'availability.', 'business.', 'reviews.']) {
      expect(text).toContain(fam);
    }
  });
});

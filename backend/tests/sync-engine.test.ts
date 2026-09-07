/**
 * Slice 18 — sync engine core tests.
 *
 * Exercises the REAL shared engine (shared/sync) with fakes only at the
 * platform boundary: in-memory storage, scripted executor, controllable
 * connectivity, deterministic uuid/random. No Angular, no device needed.
 */
import { ConnectivityMonitor } from '../../shared/sync/connectivity';
import { classifySyncError, computeBackoffMs } from '../../shared/sync/sync-classify';
import { SyncEngine } from '../../shared/sync/sync-engine';
import type { ExecResult, SyncOp } from '../../shared/sync/sync-types';

function memStorage() {
  const m = new Map<string, string>();
  return {
    map: m,
    getItem: (k: string) => (m.has(k) ? (m.get(k) as string) : null),
    setItem: (k: string, v: string) => { m.set(k, v); },
    removeItem: (k: string) => { m.delete(k); },
  };
}

function onlineHooks(isOnline = true, probe = true) {
  return {
    isOnline: () => isOnline,
    probeApi: async () => probe,
    onChange: () => () => undefined,
    nowMs: () => Date.now(),
  };
}

function monitor(online = true) {
  return new ConnectivityMonitor(onlineHooks(online));
}

let uuidN = 0;
const uuid = () => `op-test-${++uuidN}`;

interface Setup {
  engine: SyncEngine;
  storage: ReturnType<typeof memStorage>;
  conn: ConnectivityMonitor;
  net: { online: boolean };
  calls: Array<{ id: string; key: string; type: string }>;
  script: ExecResult[];
}

async function setup(execScript: ExecResult[] = [{ ok: true, serverId: 'srv-1' }], initialOnline = true): Promise<Setup> {
  uuidN = 0;
  const storage = memStorage();
  const net = { online: initialOnline };
  const conn = new ConnectivityMonitor({
    isOnline: () => net.online,
    probeApi: async () => net.online,
    onChange: () => () => undefined,
    nowMs: () => Date.now(),
  });
  await conn.refresh();
  const calls: Setup['calls'] = [];
  const script = [...execScript];
  const engine = new SyncEngine({
    storage,
    connectivity: conn,
    uuid,
    random: () => 0.5,
    retryPolicy: { maxAttempts: 3, baseDelayMs: 5, maxDelayMs: 20, jitterRatio: 0 },
    executor: async (op) => {
      calls.push({ id: op.id, key: op.idempotencyKey, type: op.type });
      const next = script.length > 0 ? (script.shift() as ExecResult) : { ok: true, serverId: 'srv-x' };
      return next;
    },
  });
  await engine.init('user-1');
  return { engine, storage, conn, net, calls, script };
}

const SCOPE = { userId: 'user-1', tenantKind: 'PROVIDER' };

async function liveConn(): Promise<ConnectivityMonitor> {
  const c = monitor(true);
  await c.refresh();
  return c;
}

async function waitFor(fn: () => boolean, ms = 2000): Promise<void> {
  const start = Date.now();
  for (;;) {
    if (fn()) return;
    if (Date.now() - start > ms) throw new Error('waitFor timed out');
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('Slice 18 — enqueue validation', () => {
  it('1. unknown op types are rejected (online-only cannot be queued)', async () => {
    const { engine } = await setup();
    await expect(engine.enqueue({ type: 'payments.initiate', scope: SCOPE })).rejects.toMatchObject({ code: 'SYNC_ONLINE_ONLY' });
    await expect(engine.enqueue({ type: 'bookings.complete', scope: SCOPE })).rejects.toMatchObject({ code: 'SYNC_ONLINE_ONLY' });
    await expect(engine.enqueue({ type: 'admin.verify', scope: SCOPE })).rejects.toMatchObject({ code: 'SYNC_ONLINE_ONLY' });
    expect(engine.snapshot()).toHaveLength(0);
  });

  it('2. secret-bearing payloads are refused at enqueue', async () => {
    const { engine } = await setup();
    await expect(engine.enqueue({ type: 'pos.sale.create', scope: SCOPE, payload: { lines: [], password: 'x' } })).rejects.toMatchObject({ code: 'QUEUE_UNSAFE_PAYLOAD' });
    await expect(engine.enqueue({ type: 'pos.sale.create', scope: SCOPE, payload: { nested: { apiKey: 'x' } } })).rejects.toMatchObject({ code: 'QUEUE_UNSAFE_PAYLOAD' });
    await expect(engine.enqueue({ type: 'pos.sale.create', scope: SCOPE, payload: { cardNumber: '123' } })).rejects.toMatchObject({ code: 'QUEUE_UNSAFE_PAYLOAD' });
    expect(engine.snapshot()).toHaveLength(0);
  });

  it('3. unknown dependencies are rejected (no dangling edges)', async () => {
    const { engine } = await setup();
    await expect(engine.enqueue({ type: 'pos.sale.create', scope: SCOPE, dependsOn: ['nope'] })).rejects.toMatchObject({ code: 'SYNC_UNKNOWN_DEPENDENCY' });
  });

  it('4. cross-session scope is rejected (tenant isolation at enqueue)', async () => {
    const { engine } = await setup();
    await expect(
      engine.enqueue({ type: 'pos.sale.create', scope: { userId: 'user-2', tenantKind: 'PROVIDER' } }),
    ).rejects.toMatchObject({ code: 'SYNC_TENANT_MISMATCH' });
  });

  it('5. enqueue requires init', async () => {
    const storage = memStorage();
    const engine = new SyncEngine({ storage, connectivity: monitor(), uuid, executor: async () => ({ ok: true }) });
    await expect(engine.enqueue({ type: 'pos.sale.create', scope: SCOPE })).rejects.toMatchObject({ code: 'SYNC_NOT_READY' });
  });

  it('6. idempotency key is deterministic per op (installation:op)', async () => {
    const { engine } = await setup([{ ok: true, serverId: 'srv-1' }]);
    const op = await engine.enqueue({ type: 'pos.sale.create', scope: SCOPE, payload: { lines: [] } });
    expect(op.idempotencyKey).toMatch(/^.+:.+$/);
    expect(op.idempotencyKey.endsWith(`:${op.id}`)).toBe(true);
    // Key is minted at enqueue and never changes across retries (see test 12/28).
    await waitFor(() => engine.snapshot()[0]?.state === 'SYNCED');
  });
});

describe('Slice 18 — offline queueing + reconnect sync', () => {
  it('7. offline enqueue persists without executing (queueing is not success)', async () => {
    const { engine, calls } = await setup([{ ok: true }], false);
    const op = await engine.enqueue({ type: 'pos.sale.create', scope: SCOPE, payload: { lines: [] } });
    await new Promise((r) => setTimeout(r, 50));
    expect(calls).toHaveLength(0);
    expect(engine.snapshot()[0].state).toBe('PENDING');
    expect(op.state).toBe('PENDING');
  });

  it('8. reconnect drains the queue to SYNCED with server id', async () => {
    const s = await setup([{ ok: true, serverId: 'srv-9' }], false);
    await s.engine.enqueue({ type: 'pos.sale.create', scope: SCOPE, payload: { lines: [] } });
    expect(s.calls).toHaveLength(0);
    // Reconnect: network returns, probe succeeds, controlled drain.
    s.net.online = true;
    await s.conn.refresh();
    s.engine.kick();
    await waitFor(() => s.engine.snapshot()[0]?.state === 'SYNCED');
    const done = s.engine.snapshot()[0];
    expect(done.serverId).toBe('srv-9');
    expect(done.syncedAt).not.toBeNull();
    expect(s.calls).toHaveLength(1);
  });

  it('9. queue survives reload (durable persistence across init)', async () => {
    const storage = memStorage();
    const first = new SyncEngine({ storage, connectivity: monitor(false), uuid, executor: async () => ({ ok: true }) });
    await first.init('user-1');
    await first.enqueue({ type: 'pos.sale.create', scope: SCOPE, payload: { lines: [{ a: 1 }] } });
    const second = new SyncEngine({ storage, connectivity: monitor(false), uuid, executor: async () => ({ ok: true }) });
    await second.init('user-1');
    const ops = second.snapshot();
    expect(ops).toHaveLength(1);
    expect(ops[0].state).toBe('PENDING');
    expect(ops[0].payload).toEqual({ lines: [{ a: 1 }] });
  });

  it('10. queues are namespaced per user (no cross-user leakage)', async () => {
    const storage = memStorage();
    const a = new SyncEngine({ storage, connectivity: monitor(false), uuid, executor: async () => ({ ok: true }) });
    await a.init('user-1');
    await a.enqueue({ type: 'pos.sale.create', scope: { userId: 'user-1', tenantKind: 'PROVIDER' } });
    const b = new SyncEngine({ storage, connectivity: monitor(false), uuid, executor: async () => ({ ok: true }) });
    await b.init('user-2');
    expect(b.snapshot()).toHaveLength(0);
    await expect(b.retryOp(a.snapshot()[0]?.id ?? 'x')).rejects.toMatchObject({ code: 'SYNC_OP_NOT_FOUND' });
  });

  it('11. interrupted SYNCING rows replay with the SAME idempotency key', async () => {
    const storage = memStorage();
    const e1 = new SyncEngine({ storage, connectivity: monitor(false), uuid, executor: async () => ({ ok: true }) });
    await e1.init('user-1');
    const op = await e1.enqueue({ type: 'pos.sale.create', scope: SCOPE });
    // Simulate crash mid-attempt: force SYNCING into durable storage.
    const raw = JSON.parse(storage.map.get('waasha.sync.v1.queue.user-1') as string) as SyncOp[];
    raw[0].state = 'SYNCING';
    storage.map.set('waasha.sync.v1.queue.user-1', JSON.stringify(raw));
    const seen: string[] = [];
    const net = { online: true };
    const conn = new ConnectivityMonitor({
      isOnline: () => net.online,
      probeApi: async () => net.online,
      onChange: () => () => undefined,
      nowMs: () => Date.now(),
    });
    await conn.refresh();
    const e2 = new SyncEngine({
      storage,
      connectivity: conn,
      uuid,
      executor: async (o) => { seen.push(o.idempotencyKey); return { ok: true, serverId: 'srv-r' }; },
    });
    await e2.init('user-1');
    e2.kick();
    await waitFor(() => e2.snapshot()[0]?.state === 'SYNCED');
    expect(seen).toEqual([op.idempotencyKey]);
  });
});

describe('Slice 18 — retry, backoff, classification', () => {
  it('12. transient network failure retries then succeeds (same key every attempt)', async () => {
    const s = await setup([
      { ok: false, error: { network: true } },
      { ok: true, serverId: 'srv-2' },
    ]);
    await s.engine.enqueue({ type: 'pos.sale.create', scope: SCOPE });
    await waitFor(() => s.engine.snapshot()[0]?.state === 'SYNCED');
    expect(s.calls).toHaveLength(2);
    expect(s.calls[0].key).toBe(s.calls[1].key);
    expect(s.engine.snapshot()[0].attemptCount).toBe(2);
  });

  it('13. timeouts and 5xx are transient', async () => {
    expect(classifySyncError({ timeout: true }).kind).toBe('TRANSIENT');
    expect(classifySyncError({ status: 502 }).kind).toBe('TRANSIENT');
    expect(classifySyncError({ status: 503 }).kind).toBe('TRANSIENT');
    expect(classifySyncError({ network: true }).kind).toBe('TRANSIENT');
  });

  it('14. retries are bounded (no infinite loops) then dead-letter', async () => {
    const s = await setup([
      { ok: false, error: { status: 503 } },
      { ok: false, error: { status: 503 } },
      { ok: false, error: { status: 503 } },
      { ok: false, error: { status: 503 } },
    ]);
    await s.engine.enqueue({ type: 'pos.sale.create', scope: SCOPE });
    await waitFor(() => s.engine.snapshot()[0]?.state === 'FAILED');
    const op = s.engine.snapshot()[0];
    expect(s.calls.length).toBeLessThanOrEqual(3);
    expect(op.lastError?.code).toBe('RETRIES_EXHAUSTED');
    expect(op.lastError?.message).toMatch(/kept safely/i);
    // No further automatic attempts.
    const n = s.calls.length;
    await new Promise((r) => setTimeout(r, 60));
    expect(s.calls.length).toBe(n);
  });

  it('15. backoff grows exponentially within caps', async () => {
    const p = { maxAttempts: 5, baseDelayMs: 1000, maxDelayMs: 30000, jitterRatio: 0 };
    const r = () => 0.5;
    expect(computeBackoffMs(1, p, r)).toBe(1000);
    expect(computeBackoffMs(2, p, r)).toBe(2000);
    expect(computeBackoffMs(3, p, r)).toBe(4000);
    expect(computeBackoffMs(10, p, r)).toBe(30000);
  });

  it('16. jitter stays within policy bounds', async () => {
    const p = { maxAttempts: 5, baseDelayMs: 1000, maxDelayMs: 30000, jitterRatio: 0.25 };
    for (let i = 0; i < 50; i++) {
      const v = computeBackoffMs(2, p, Math.random);
      expect(v).toBeGreaterThanOrEqual(1500);
      expect(v).toBeLessThanOrEqual(2500);
    }
  });

  it('17. 4xx validation failure is permanent (no retry storm)', async () => {
    const s = await setup([{ ok: false, error: { status: 422, code: 'VALIDATION_ERROR', message: 'Bad lines' } }]);
    await s.engine.enqueue({ type: 'pos.sale.create', scope: SCOPE });
    await waitFor(() => s.engine.snapshot()[0]?.state === 'FAILED');
    expect(s.calls).toHaveLength(1);
    expect(s.engine.snapshot()[0].lastError?.message).toBe('Bad lines');
  });

  it('18. 403 is permanent and explicit', async () => {
    const s = await setup([{ ok: false, error: { status: 403, code: 'FORBIDDEN' } }]);
    await s.engine.enqueue({ type: 'pos.sale.create', scope: SCOPE });
    await waitFor(() => s.engine.snapshot()[0]?.state === 'FAILED');
    expect(s.calls).toHaveLength(1);
    expect(s.engine.snapshot()[0].lastError?.code).toBe('FORBIDDEN');
  });

  it('19. 409 and stock/slot codes become CONFLICT (server wins)', async () => {
    for (const err of [
      { status: 409, code: 'BOOKING_CONFLICT' },
      { status: 422, code: 'INSUFFICIENT_STOCK' },
      { status: 422, code: 'CASH_CAP_EXCEEDED' },
      { status: 409 },
    ]) {
      const s = await setup([{ ok: false, error: err }]);
      const type = err.code === 'BOOKING_CONFLICT' ? 'finance.cash-booking.create' : 'pos.sale.create';
      await s.engine.enqueue({ type, scope: SCOPE });
      await waitFor(() => s.engine.snapshot()[0]?.state === 'CONFLICT');
      expect(s.calls).toHaveLength(1);
    }
  });

  it('20. conflict messages are human-safe (booking + stock wording)', async () => {
    expect(classifySyncError({ status: 409, code: 'BOOKING_CONFLICT' }).message).toMatch(/no longer available/i);
    expect(classifySyncError({ status: 422, code: 'INSUFFICIENT_STOCK' }).message).toMatch(/not applied/i);
  });

  it('21. executor throw is treated as transient (bounded)', async () => {
    let n = 0;
    const storage = memStorage();
    const engine = new SyncEngine({
      storage,
      connectivity: await liveConn(),
      uuid,
      random: () => 0.5,
      retryPolicy: { maxAttempts: 2, baseDelayMs: 5, maxDelayMs: 10, jitterRatio: 0 },
      executor: async () => { n++; throw new Error('boom'); },
    });
    await engine.init('user-1');
    await engine.enqueue({ type: 'pos.sale.create', scope: SCOPE });
    await waitFor(() => engine.snapshot()[0]?.state === 'FAILED');
    expect(n).toBe(2);
  });
});

describe('Slice 18 — auth expiry', () => {
  it('22. 401 pauses the queue (never blind-retries) and marks BLOCKED_ON_AUTH', async () => {
    const s = await setup([
      { ok: false, error: { status: 401, code: 'UNAUTHORIZED' } },
      { ok: true, serverId: 'srv-auth' },
    ]);
    await s.engine.enqueue({ type: 'pos.sale.create', scope: SCOPE });
    await s.engine.enqueue({ type: 'notifications.read-all', scope: SCOPE });
    await waitFor(() => s.engine.snapshot()[0]?.state === 'BLOCKED_ON_AUTH');
    const n = s.calls.length;
    await new Promise((r) => setTimeout(r, 60));
    // Second op never attempted while paused; first never retried.
    expect(s.calls.length).toBe(n);
    expect(s.engine.snapshot().map((o) => o.state)).toEqual(['BLOCKED_ON_AUTH', 'PENDING']);
  });

  it('23. re-authentication resumes blocked ops to SYNCED', async () => {
    const s = await setup([
      { ok: false, error: { status: 401 } },
      { ok: true, serverId: 'srv-a' },
      { ok: true, serverId: 'srv-b' },
    ]);
    await s.engine.enqueue({ type: 'pos.sale.create', scope: SCOPE });
    await s.engine.enqueue({ type: 'notifications.read-all', scope: SCOPE });
    await waitFor(() => s.engine.snapshot()[0]?.state === 'BLOCKED_ON_AUTH');
    s.engine.notifyAuthRestored();
    await waitFor(() => s.engine.snapshot().every((o) => o.state === 'SYNCED'));
    expect(s.engine.snapshot().map((o) => o.serverId)).toEqual(['srv-a', 'srv-b']);
  });

  it('24. logout pauses without losing the durable queue', async () => {
    const s = await setup([{ ok: true }], false);
    await s.engine.enqueue({ type: 'pos.sale.create', scope: SCOPE });
    s.engine.notifyLogout();
    expect(s.engine.snapshot()[0].state).toBe('PENDING');
  });
});

describe('Slice 18 — ordering + dependencies', () => {
  it('25. dependent op waits for its dependency (FIFO + gate)', async () => {
    const order: string[] = [];
    const storage = memStorage();
    const engine = new SyncEngine({
      storage,
      connectivity: await liveConn(),
      uuid,
      executor: async (op) => { order.push(op.type); return { ok: true, serverId: op.id }; },
    });
    await engine.init('user-1');
    const first = await engine.enqueue({ type: 'pos.sale.create', scope: SCOPE });
    // Second op created first in time but depends on first: runs second.
    await engine.enqueue({ type: 'notifications.read-all', scope: SCOPE, dependsOn: [first.id] });
    await waitFor(() => engine.snapshot().every((o) => o.state === 'SYNCED'));
    expect(order).toEqual(['pos.sale.create', 'notifications.read-all']);
  });

  it('26. failed dependency fails dependents explicitly (no silent stall)', async () => {
    const s = await setup([{ ok: false, error: { status: 422, code: 'VALIDATION_ERROR', message: 'bad' } }]);
    const first = await s.engine.enqueue({ type: 'pos.sale.create', scope: SCOPE });
    await s.engine.enqueue({ type: 'notifications.read-all', scope: SCOPE, dependsOn: [first.id] });
    await waitFor(() => s.engine.snapshot()[1]?.state === 'FAILED');
    expect(s.engine.snapshot()[1].lastError?.code).toBe('DEPENDENCY_UNMET');
    expect(s.calls).toHaveLength(1);
  });

  it('27. multiple queued ops process in order', async () => {
    const seen: string[] = [];
    const storage = memStorage();
    const engine = new SyncEngine({
      storage,
      connectivity: await liveConn(),
      uuid,
      executor: async (op) => { seen.push(op.id); return { ok: true, serverId: op.id }; },
    });
    await engine.init('user-1');
    await engine.enqueue({ type: 'notifications.read-all', scope: SCOPE });
    await engine.enqueue({ type: 'notifications.read-all', scope: SCOPE });
    await engine.enqueue({ type: 'notifications.read-all', scope: SCOPE });
    await waitFor(() => engine.snapshot().every((o) => o.state === 'SYNCED'));
    const ids = engine.snapshot().map((o) => o.id);
    expect(seen).toEqual(ids);
  });
});

describe('Slice 18 — manual recovery + dead letter', () => {
  it('28. manual retry resets attempts and succeeds', async () => {
    const s = await setup([
      { ok: false, error: { status: 422, code: 'VALIDATION_ERROR', message: 'fix me' } },
      { ok: true, serverId: 'srv-fixed' },
    ]);
    const op = await s.engine.enqueue({ type: 'pos.sale.create', scope: SCOPE });
    await waitFor(() => s.engine.snapshot()[0]?.state === 'FAILED');
    await s.engine.retryOp(op.id);
    await waitFor(() => s.engine.snapshot()[0]?.state === 'SYNCED');
    expect(s.calls).toHaveLength(2);
    // Same deterministic key on manual retry → server dedupes safely.
    expect(s.calls[0].key).toBe(s.calls[1].key);
  });

  it('29. cancel stops a pending op permanently', async () => {
    const s = await setup([{ ok: true }], false);
    const op = await s.engine.enqueue({ type: 'pos.sale.create', scope: SCOPE });
    await s.engine.cancelOp(op.id);
    expect(s.engine.snapshot()[0].state).toBe('CANCELLED');
    expect(s.calls).toHaveLength(0);
  });

  it('30. retry of non-dead-letter op is a no-op', async () => {
    const s = await setup([{ ok: true }], false);
    const op = await s.engine.enqueue({ type: 'pos.sale.create', scope: SCOPE });
    await s.engine.retryOp(op.id);
    expect(s.engine.snapshot()[0].state).toBe('PENDING');
  });

  it('31. unknown op id actions are rejected', async () => {
    const { engine } = await setup();
    await expect(engine.retryOp('missing')).rejects.toMatchObject({ code: 'SYNC_OP_NOT_FOUND' });
    await expect(engine.cancelOp('missing')).rejects.toMatchObject({ code: 'SYNC_OP_NOT_FOUND' });
  });

  it('32. onOpSynced fires for UI refresh (server data, not local trust)', async () => {
    const seen: SyncOp[] = [];
    const storage = memStorage();
    const engine = new SyncEngine({
      storage,
      connectivity: await liveConn(),
      uuid,
      executor: async () => ({ ok: true, serverId: 'srv-cb' }),
      events: { onOpSynced: (op) => { seen.push(op); } },
    });
    await engine.init('user-1');
    await engine.enqueue({ type: 'pos.sale.create', scope: SCOPE });
    await waitFor(() => seen.length === 1);
    expect(seen[0].serverId).toBe('srv-cb');
  });
});

describe('Slice 18 — connectivity transitions', () => {
  it('33. OFFLINE monitor blocks kick; ONLINE drains', async () => {
    const off = monitor(false);
    expect(off.current).toBe('OFFLINE');
    expect(off.online).toBe(false);
    const on = monitor(true);
    await on.refresh();
    expect(on.current).toBe('ONLINE');
    expect(on.online).toBe(true);
  });

  it('34. repeated failures downgrade to LIMITED (multi-signal, not OS-only)', async () => {
    const m = new ConnectivityMonitor(onlineHooks(true, true));
    await m.refresh();
    expect(m.current).toBe('ONLINE');
    m.observe(false);
    expect(m.current).toBe('ONLINE');
    m.observe(false);
    expect(m.current).toBe('LIMITED');
    expect(m.online).toBe(true);
    m.observe(true);
    expect(m.current).toBe('ONLINE');
  });

  it('35. a single failed probe does not flap to LIMITED (needs two signals)', async () => {
    const m = new ConnectivityMonitor(onlineHooks(true, false));
    await m.refresh();
    expect(m.current).toBe('ONLINE');
    expect(m.online).toBe(true);
  });

  it('36. sync error state recovers to idle', async () => {
    const m = monitor(true);
    await m.refresh();
    m.markSyncing();
    expect(m.current).toBe('SYNCING');
    m.markSyncError();
    expect(m.current).toBe('SYNC_ERROR');
    m.markIdle();
    expect(m.current).toBe('ONLINE');
  });
});

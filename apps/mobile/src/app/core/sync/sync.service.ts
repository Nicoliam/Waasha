import { Injectable, OnDestroy, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { BehaviorSubject, Observable, firstValueFrom } from 'rxjs';
import { ConnectivityMonitor } from '@waasha/sync/connectivity';
import { buildSyncRequest, toExecError } from '@waasha/sync/sync-executor';
import { onlineOnlyReason } from '@waasha/sync/op-registry';
import { SyncEngine } from '@waasha/sync/sync-engine';
import type {
  ConnectivityState,
  EnqueueInput,
  SyncOp,
} from '@waasha/sync/sync-types';
import { AuthService } from '../services/auth.service';
import { MediaService } from '../services/media.service';
import type { MediaUploadPurpose } from '../services/media-upload';

/**
 * Slice 18 — offline-first sync (mobile — same shared core, same endpoints, same rules as web).
 * Thin platform adapter over the shared sync core (shared/sync): the queue,
 * retry, ordering, idempotency and conflict rules live in the shared engine
 * and are identical on mobile. This wrapper provides WebView localStorage
 * persistence, HttpClient transport, auth-state resume, and UI observables.
 *
 * Server authority is unchanged: queued ops replay existing endpoints with
 * stable idempotency keys. Online-only operations are rejected at enqueue
 * with an explicit reason (never silently queued, never faked as success).
 */
@Injectable({ providedIn: 'root' })
export class SyncService implements OnDestroy {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly media = inject(MediaService);

  private readonly store = {
    getItem: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
    setItem: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch {} },
    removeItem: (k: string) => { try { localStorage.removeItem(k); } catch {} },
  };

  private readonly connectivity = new ConnectivityMonitor(
    {
      isOnline: () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false),
      probeApi: async () => {
        try {
          const res = await firstValueFrom(this.http.get('/health', { observe: 'response' }));
          return res.status >= 200 && res.status < 500;
        } catch {
          return false;
        }
      },
      onChange: (cb) => {
        const on = () => cb();
        const off = () => cb();
        window.addEventListener('online', on);
        window.addEventListener('offline', off);
        return () => {
          window.removeEventListener('online', on);
          window.removeEventListener('offline', off);
        };
      },
      nowMs: () => Date.now(),
    },
    { onState: (s) => this.connectivity$.next(s) },
  );

  private readonly engine = new SyncEngine({
    storage: this.store,
    connectivity: this.connectivity,
    executor: async (op) => {
      if (op.type === 'media.upload-task') return this.runMediaTask(op);
      const req = buildSyncRequest(op);
      try {
        const res = await firstValueFrom(
          this.http.request<any>(req.method, req.url, { body: req.body, headers: req.headers }),
        );
        const data = (res as { data?: unknown })?.data;
        const record = data !== null && typeof data === 'object' ? (data as Record<string, unknown>) : null;
        const serverId = record ? String(record['id'] ?? record['uuid'] ?? '') : null;
        return { ok: true as const, serverId: serverId || null };
      } catch (err) {
        return { ok: false as const, error: toExecError(err) };
      }
    },
    events: {
      onQueueChanged: (ops) => this.queue$.next(ops),
    },
  });

  private readonly connectivity$ = new BehaviorSubject<ConnectivityState>('OFFLINE');
  private readonly queue$ = new BehaviorSubject<SyncOp[]>([]);
  private readonly ready$ = new BehaviorSubject<boolean>(false);
  private authSub = this.auth.user.subscribe((u) => {
    if (u) {
      void this.bindUser(String((u as { id?: string }).id ?? (u as { uuid?: string }).uuid ?? ''));
    } else {
      this.engine.notifyLogout();
    }
  });

  constructor() {
    this.connectivity.start();
    const snap = this.auth.snapshot();
    const id = snap ? String((snap as { id?: string }).id ?? (snap as { uuid?: string }).uuid ?? '') : '';
    if (id) void this.bindUser(id);
    else this.ready$.next(true);
  }

  ngOnDestroy(): void {
    try { this.authSub.unsubscribe(); } catch {}
    this.connectivity.stop();
  }

  get connectivityState(): Observable<ConnectivityState> { return this.connectivity$.asObservable(); }
  get queue(): Observable<SyncOp[]> { return this.queue$.asObservable(); }
  get ready(): Observable<boolean> { return this.ready$.asObservable(); }
  get onlineNow(): boolean { return this.connectivity.online; }

  pendingCount(): number { return this.engine.pendingCount(); }
  attentionCount(): number { return this.engine.attentionCount(); }
  snapshot(): SyncOp[] { return this.engine.snapshot(); }

  /** Queue a syncable op. Online-only types throw SYNC_ONLINE_ONLY with a reason. */
  async enqueue(input: EnqueueInput): Promise<SyncOp> {
    await this.ensureBound();
    return this.engine.enqueue(input);
  }

  /**
   * Session-scoped enqueue: builds the queue scope from the authenticated
   * session (never from caller arguments). Tenant fields are routing hints
   * only — the server derives all authority from the session.
   */
  async enqueueAs(type: string, payload: Record<string, unknown> = {}, dependsOn: string[] = []): Promise<SyncOp> {
    const snap = this.auth.snapshot();
    const userId = snap ? String((snap as { id?: string }).id ?? (snap as { uuid?: string }).uuid ?? '') : '';
    if (!userId) throw Object.assign(new Error('Sign in to save changes.'), { code: 'SYNC_NO_SESSION' });
    const roles = (Array.isArray((snap as { roles?: unknown }).roles) ? (snap as { roles: string[] }).roles : []) as string[];
    const tenantKind = roles.includes('PROVIDER')
      ? 'PROVIDER'
      : roles.includes('TRAINING_CENTRE')
        ? 'PARTNER'
        : roles.includes('ADMIN')
          ? 'ADMIN'
          : 'CUSTOMER';
    await this.ensureBound();
    return this.engine.enqueue({ type, scope: { userId, tenantKind }, payload, dependsOn });
  }

  async retryOp(id: string): Promise<void> { await this.engine.retryOp(id); }
  async cancelOp(id: string): Promise<void> { await this.engine.cancelOp(id); }

  /** Manual "Sync now" — single-flight, cooldown-guarded by the monitor. */
  async syncNow(): Promise<void> {
    await this.connectivity.refresh();
    this.engine.kick();
    await this.engine.awaitIdle();
  }

  /**
   * Guard for intentionally online-only mutations. Resolves when online,
   * otherwise throws an explicit nothing-changed error (never queues).
   */
  async requireOnline(opKey: string): Promise<void> {
    await this.connectivity.refresh();
    if (this.connectivity.online) return;
    const reason = onlineOnlyReason(opKey);
    throw Object.assign(
      new Error(
        reason
          ? `You are offline. ${reason} Nothing was changed.`
          : 'You are offline. This change needs a connection — nothing was changed.',
      ),
      { code: 'SYNC_OFFLINE_BLOCKED' },
    );
  }

  /** Called after successful re-authentication to resume blocked ops. */
  notifyAuthRestored(): void { this.engine.notifyAuthRestored(); }

  private boundUser = '';
  private async bindUser(userId: string): Promise<void> {
    if (!userId || this.boundUser === userId) {
      if (userId) this.ready$.next(true);
      return;
    }
    this.boundUser = userId;
    try {
      await this.engine.init(userId);
      this.engine.notifyAuthRestored();
    } finally {
      this.ready$.next(true);
    }
  }

  private async ensureBound(): Promise<void> {
    const snap = this.auth.snapshot();
    const id = snap ? String((snap as { id?: string }).id ?? (snap as { uuid?: string }).uuid ?? '') : '';
    if (!id) throw Object.assign(new Error('Sign in to save changes.'), { code: 'SYNC_NO_SESSION' });
    await this.bindUser(id);
  }

  /**
   * Media upload tasks: the queue record holds metadata only (purpose,
   * target, filename — never bytes, never secrets). File bytes live in a
   * session blob registry; if the app restarted and bytes are gone, the op
   * fails explicitly with guidance instead of hanging. Uploads reuse the
   * existing media flow and succeed only on backend finalization.
   */
  private readonly mediaBlobs = new Map<string, File>();

  registerMediaBlob(opId: string, file: File): void {
    this.mediaBlobs.set(opId, file);
  }

  private async runMediaTask(op: SyncOp): Promise<{ ok: true; serverId?: string | null } | { ok: false; error: { code?: string; message?: string; status?: number } }> {
    const file = this.mediaBlobs.get(op.id);
    if (!file) {
      return { ok: false as const, error: { code: 'MEDIA_BLOB_MISSING', message: 'File data is no longer available on this device. Please reselect the file while online — nothing was uploaded.' } };
    }
    const p = op.payload as Record<string, unknown>;
    try {
      const outcome = await firstValueFrom(
        this.media.uploadFile(file, String(p['purpose'] ?? 'SERVICE') as MediaUploadPurpose, (p['targetId'] as string | null) ?? null),
      );
      this.mediaBlobs.delete(op.id);
      return { ok: true as const, serverId: outcome?.mediaId ?? null };
    } catch (err) {
      const e = toExecError(err);
      const code = typeof (err as { code?: unknown })?.code === 'string' ? String((err as { code: unknown }).code) : e.code;
      return { ok: false as const, error: { ...e, code } };
    }
  }
}

/**
 * Slice 18 — connectivity monitor (multi-signal, no hammering).
 *
 * Blueprint §3-4, §44: ONLINE / LIMITED / OFFLINE / SYNCING / SYNC_ERROR.
 * Never relies on the OS indicator alone: combines browser online/offline
 * events, an unauthenticated API probe (`GET /health`), and observed
 * request-failure patterns. Probes are cooldown-guarded; sync runs
 * single-flight. All platform hooks are injected for testability.
 */
import type { ConnectivityState } from './sync-types';

export interface ConnectivityHooks {
  /** Current OS/network indicator (navigator.onLine). */
  isOnline: () => boolean;
  /** Unaauthenticated API probe — resolve true when the API answers. */
  probeApi: () => Promise<boolean>;
  /** Subscribe to OS online/offline transitions; return unsubscribe. */
  onChange: (cb: () => void) => () => void;
  nowMs: () => number;
}

export interface ConnectivityEvents {
  onState?: (state: ConnectivityState) => void;
}

const PROBE_COOLDOWN_MS = 15000;
/** Consecutive observed failures that downgrade ONLINE → LIMITED. */
const LIMITED_AFTER_FAILURES = 2;

export class ConnectivityMonitor {
  private state: ConnectivityState = 'OFFLINE';
  private consecutiveFailures = 0;
  private lastProbeMs = 0;
  private probing = false;
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly hooks: ConnectivityHooks,
    private readonly events: ConnectivityEvents = {},
  ) {}

  get current(): ConnectivityState {
    return this.state;
  }

  get online(): boolean {
    return this.state === 'ONLINE' || this.state === 'LIMITED' || this.state === 'SYNCING';
  }

  start(): void {
    this.stop();
    this.unsubscribe = this.hooks.onChange(() => void this.refresh());
    void this.refresh();
  }

  stop(): void {
    if (this.unsubscribe) {
      try {
        this.unsubscribe();
      } catch {
        // Listener teardown is best-effort.
      }
      this.unsubscribe = null;
    }
  }

  /** Re-evaluate from OS signal + throttled API probe. */
  async refresh(): Promise<ConnectivityState> {
    if (!this.hooks.isOnline()) {
      this.set('OFFLINE');
      return this.state;
    }
    const now = this.hooks.nowMs();
    if (now - this.lastProbeMs < PROBE_COOLDOWN_MS) {
      this.set(this.consecutiveFailures >= LIMITED_AFTER_FAILURES ? 'LIMITED' : 'ONLINE');
      return this.state;
    }
    if (this.probing) return this.state;
    this.probing = true;
    try {
      this.lastProbeMs = now;
      const ok = await this.hooks.probeApi();
      if (ok) {
        this.consecutiveFailures = 0;
        this.set('ONLINE');
      } else {
        this.consecutiveFailures += 1;
        this.set(this.consecutiveFailures >= LIMITED_AFTER_FAILURES ? 'LIMITED' : 'ONLINE');
      }
    } catch {
      this.consecutiveFailures += 1;
      this.set(this.consecutiveFailures >= LIMITED_AFTER_FAILURES ? 'LIMITED' : 'ONLINE');
    } finally {
      this.probing = false;
    }
    return this.state;
  }

  /** Record an observed request outcome (drives LIMITED detection between probes). */
  observe(success: boolean): void {
    if (success) {
      if (this.consecutiveFailures > 0) {
        this.consecutiveFailures = 0;
        if (this.state === 'LIMITED' || this.state === 'SYNC_ERROR') this.set('ONLINE');
      }
      return;
    }
    this.consecutiveFailures += 1;
    if (this.hooks.isOnline() && this.consecutiveFailures >= LIMITED_AFTER_FAILURES) {
      if (this.state === 'ONLINE') this.set('LIMITED');
    } else if (!this.hooks.isOnline()) {
      this.set('OFFLINE');
    }
  }

  markSyncing(): void {
    if (this.state === 'ONLINE' || this.state === 'LIMITED') this.set('SYNCING');
  }

  markSyncError(): void {
    this.set('SYNC_ERROR');
  }

  markIdle(): void {
    if (this.state === 'SYNCING' || this.state === 'SYNC_ERROR') {
      this.set(this.hooks.isOnline() ? 'ONLINE' : 'OFFLINE');
    }
  }

  private set(next: ConnectivityState): void {
    if (next === this.state) return;
    this.state = next;
    try {
      this.events.onState?.(next);
    } catch {
      // Event subscribers must never break connectivity tracking.
    }
  }
}

import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Subscription } from 'rxjs';
import { SyncService } from '../../../core/sync/sync.service';
import type { ConnectivityState, SyncOp } from '@waasha/sync/sync-types';

/**
 * Slice 18 — sync status indicator (mobile — same wording and rules as web).
 * Shows connectivity (Online / Limited / Offline / Syncing / Attention) and
 * the durable queue with per-op states. Wording never implies a server
 * transaction occurred: queued work is "waiting", never "done".
 */
@Component({
  selector: 'waasha-sync-status',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="wa-sync" role="status" [attr.aria-label]="ariaLabel">
      <button type="button" class="wa-sync__pill" [attr.data-state]="pillState" (click)="toggle()" [attr.aria-expanded]="open">
        <span class="wa-sync__dot" aria-hidden="true"></span>{{ pillText }}
        <span *ngIf="attention > 0" class="wa-sync__badge">{{ attention }}</span>
      </button>
      <div *ngIf="open" class="wa-sync__panel">
        <p class="wa-sync__hint">{{ hint }}</p>
        <p *ngIf="ops.length === 0" class="wa-sync__empty">Nothing waiting to sync.</p>
        <ul *ngIf="ops.length > 0" class="wa-sync__list">
          <li *ngFor="let o of ops; trackBy: trackOp" class="wa-sync__row">
            <div>
              <p class="wa-sync__label">{{ label(o) }}</p>
              <p class="wa-sync__state" [attr.data-opstate]="o.state">{{ stateText(o) }}</p>
              <p *ngIf="o.lastError" class="wa-sync__err">{{ o.lastError.message }}</p>
            </div>
            <div class="wa-sync__actions">
              <button *ngIf="canRetry(o)" type="button" class="wa-btn wa-btn--sm" (click)="retry(o.id)">Retry</button>
              <button *ngIf="canCancel(o)" type="button" class="wa-btn wa-btn--sm" (click)="cancel(o.id)">Discard</button>
            </div>
          </li>
        </ul>
        <button type="button" class="wa-btn wa-btn--sm" [disabled]="syncing" (click)="syncNow()">{{ syncing ? 'Syncing…' : 'Sync now' }}</button>
      </div>
    </div>
  `,
  styles: [`
    .wa-sync { position:relative; }
    .wa-sync__pill { display:inline-flex; align-items:center; gap:6px; font-size:12px; font-weight:700; padding:6px 10px; border-radius:999px; border:1px solid var(--waasha-border); background:white; color:var(--waasha-navy); cursor:pointer; }
    .wa-sync__dot { width:8px; height:8px; border-radius:999px; background:#16A34A; }
    .wa-sync__pill[data-state="offline"] .wa-sync__dot { background:#DC2626; }
    .wa-sync__pill[data-state="limited"] .wa-sync__dot, .wa-sync__pill[data-state="syncing"] .wa-sync__dot { background:#D97706; }
    .wa-sync__pill[data-state="attention"] .wa-sync__dot { background:#DC2626; }
    .wa-sync__badge { min-width:18px; height:18px; padding:0 5px; border-radius:999px; background:#DC2626; color:white; font-size:11px; font-weight:800; display:inline-flex; align-items:center; justify-content:center; }
    .wa-sync__panel { position:absolute; right:0; top:calc(100% + 8px); width:320px; max-height:60vh; overflow:auto; background:white; border:1px solid var(--waasha-border); border-radius:12px; box-shadow:0 8px 24px rgba(11,31,51,0.12); padding:12px 14px; z-index:50; }
    .wa-sync__hint { margin:0 0 8px; font-size:12px; color:var(--waasha-muted); }
    .wa-sync__empty { margin:0; font-size:12px; color:var(--waasha-muted); }
    .wa-sync__list { list-style:none; margin:0 0 10px; padding:0; display:flex; flex-direction:column; gap:8px; }
    .wa-sync__row { display:flex; justify-content:space-between; gap:8px; padding:8px 0; border-top:1px solid var(--waasha-border); }
    .wa-sync__row:first-child { border-top:none; }
    .wa-sync__label { margin:0; font-size:12px; font-weight:700; color:var(--waasha-navy); }
    .wa-sync__state { margin:2px 0 0; font-size:11px; color:var(--waasha-muted); }
    .wa-sync__err { margin:2px 0 0; font-size:11px; color:#991B1B; }
    .wa-sync__actions { display:flex; gap:6px; align-items:flex-start; }
    .wa-btn--sm { padding:6px 10px; font-size:11px; border-radius:8px; }
    @media (prefers-reduced-motion: reduce) { * { animation:none !important; transition:none !important; } }
  `]
})
export class SyncStatusComponent implements OnInit, OnDestroy {
  private readonly sync = inject(SyncService);
  private subs: Subscription[] = [];

  connectivity: ConnectivityState = 'OFFLINE';
  ops: SyncOp[] = [];
  open = false;
  syncing = false;

  get pending(): number { return this.ops.filter((o) => o.state === 'PENDING' || o.state === 'RETRYING' || o.state === 'SYNCING').length; }
  get attention(): number { return this.ops.filter((o) => o.state === 'FAILED' || o.state === 'CONFLICT' || o.state === 'BLOCKED_ON_AUTH').length; }

  get pillState(): string {
    if (this.attention > 0) return 'attention';
    if (this.connectivity === 'OFFLINE') return 'offline';
    if (this.connectivity === 'SYNCING') return 'syncing';
    if (this.connectivity === 'LIMITED' || this.connectivity === 'SYNC_ERROR') return 'limited';
    return 'online';
  }

  get pillText(): string {
    if (this.attention > 0) return 'Needs attention';
    if (this.connectivity === 'OFFLINE') return this.pending > 0 ? `Offline · ${this.pending} waiting` : 'Offline';
    if (this.connectivity === 'SYNCING') return 'Syncing…';
    if (this.connectivity === 'LIMITED' || this.connectivity === 'SYNC_ERROR') return 'Limited connection';
    return this.pending > 0 ? `Online · ${this.pending} queued` : 'Online';
  }

  get hint(): string {
    if (this.connectivity === 'OFFLINE') return 'You are offline. Changes are saved on this device and will sync when you reconnect — nothing is confirmed yet.';
    if (this.attention > 0) return 'Some changes need your review. The server is always authoritative — nothing was applied automatically.';
    return 'Queued changes sync in order. Only a server reply confirms an action.';
  }

  get ariaLabel(): string { return `Sync status: ${this.pillText}`; }

  ngOnInit(): void {
    this.subs.push(this.sync.connectivityState.subscribe((s) => { this.connectivity = s; }));
    this.subs.push(this.sync.queue.subscribe((ops) => { this.ops = ops; }));
    this.ops = this.sync.snapshot();
  }

  ngOnDestroy(): void { this.subs.forEach((s) => { try { s.unsubscribe(); } catch {} }); }

  toggle(): void { this.open = !this.open; }
  trackOp(_i: number, o: SyncOp): string { return o.id; }

  label(o: SyncOp): string {
    const names: Record<string, string> = {
      'pos.sale.create': 'POS sale',
      'finance.cash-booking.create': 'Cash booking request',
      'notifications.mark-read': 'Mark notification read',
      'notifications.read-all': 'Mark all read',
      'media.upload-task': 'Media upload',
    };
    return names[o.type] ?? o.type;
  }

  stateText(o: SyncOp): string {
    switch (o.state) {
      case 'PENDING': return 'Saved locally — waiting for connection.';
      case 'SYNCING': return 'Syncing…';
      case 'RETRYING': return `Waiting to retry (attempt ${o.attemptCount}).`;
      case 'SYNCED': return 'Synced — confirmed by server.';
      case 'FAILED': return 'Could not sync — needs your attention.';
      case 'BLOCKED_ON_AUTH': return 'Paused — please sign in again to continue.';
      case 'CONFLICT': return 'Server state changed — please review.';
      case 'CANCELLED': return 'Discarded.';
      default: return 'Waiting.';
    }
  }

  canRetry(o: SyncOp): boolean { return o.state === 'FAILED' || o.state === 'CONFLICT' || o.state === 'BLOCKED_ON_AUTH'; }
  canCancel(o: SyncOp): boolean { return o.state !== 'SYNCED' && o.state !== 'CANCELLED'; }

  retry(id: string): void { void this.sync.retryOp(id); }
  cancel(id: string): void { void this.sync.cancelOp(id); }

  syncNow(): void {
    this.syncing = true;
    void this.sync.syncNow().finally(() => { this.syncing = false; });
  }
}

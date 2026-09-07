import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { NotificationService } from '../../core/services/notification.service';
import { SyncService } from '../../core/sync/sync.service';
import {
  NotificationItem,
  isUnread,
  routeFor,
  typeLabel,
  categoryOf,
  applyMarkRead,
  applyMarkAllRead,
} from './notification.utils';

@Component({
  selector: 'waasha-mobile-notifications',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <div class="wa-notifs">
      <header class="wa-notifs__head">
        <div>
          <h1 class="wa-title">Notifications</h1>
          <p class="wa-sub">Booking and payment updates. Server data — actions apply only after the server confirms.</p>
        </div>
        <button *ngIf="hasUnread" type="button" class="wa-btn wa-btn-ghost wa-btn--sm" [disabled]="markingAll" (click)="markAllRead()">
          {{ markingAll ? 'Marking…' : 'Mark all read' }}
        </button>
      </header>
      <p *ngIf="pendingSyncNote" class="wa-card wa-loading" role="status">{{ pendingSyncNote }}</p>

      <section *ngIf="loading" class="wa-card wa-loading" role="status">Loading notifications…</section>

      <div *ngIf="loadError && !loading" class="wa-card wa-error" role="alert">
        <p class="wa-error__title">{{ unauthorized ? 'Access denied' : "Couldn't load notifications" }}</p>
        <p class="wa-error__msg">{{ loadError }}</p>
        <div class="wa-error__actions">
          <button *ngIf="!unauthorized" type="button" class="wa-btn wa-btn-primary wa-btn--navy wa-btn--sm" (click)="load()">Retry</button>
          <a *ngIf="unauthorized" routerLink="/auth/login" class="wa-btn wa-btn-ghost wa-btn--sm">Log in</a>
        </div>
      </div>

      <div *ngIf="!loading && !loadError">
        <div *ngIf="items.length === 0" class="wa-card wa-empty" role="status">
          <p class="wa-empty__title">You're all caught up</p>
          <p class="wa-empty__sub">Booking and payment updates will appear here.</p>
        </div>

        <ul *ngIf="items.length > 0" class="wa-list">
          <li *ngFor="let n of items; trackBy: trackNotif" class="wa-card wa-notif" [class.unread]="isUnreadRow(n)">
            <div class="wa-notif__top">
              <span class="wa-chip" [attr.data-cat]="category(n.type)">{{ label(n.type) }}</span>
              <span class="wa-notif__time">{{ n.createdAt | date:'medium' }}</span>
            </div>
            <p class="wa-notif__title">{{ n.title }}</p>
            <p class="wa-notif__msg">{{ n.message }}</p>
            <div class="wa-notif__actions">
              <a *ngIf="route(n)" [routerLink]="route(n)" class="wa-btn wa-btn-primary wa-btn--navy wa-btn--sm">View booking</a>
              <button *ngIf="isUnreadRow(n)" type="button" class="wa-btn wa-btn-ghost wa-btn--sm" [disabled]="markingId === n.id" (click)="markRead(n)">
                {{ markingId === n.id ? 'Marking…' : 'Mark read' }}
              </button>
              <span *ngIf="!isUnreadRow(n)" class="wa-read">Read</span>
            </div>
            <p *ngIf="rowError === n.id" class="wa-rowerror" role="alert">Couldn't update — you're offline or the request failed. Nothing was changed.</p>
          </li>
        </ul>

        <div *ngIf="totalPages > 1" class="wa-pager" role="navigation" aria-label="Notification pages">
          <button type="button" class="wa-btn wa-btn-ghost wa-btn--sm" [disabled]="page <= 1 || loading" (click)="prevPage()">← Newer</button>
          <span class="wa-pager__info">Page {{ page }} of {{ totalPages }}</span>
          <button type="button" class="wa-btn wa-btn-ghost wa-btn--sm" [disabled]="page >= totalPages || loading" (click)="nextPage()">Older →</button>
        </div>
      </div>

      <section class="wa-card wa-prefs" aria-label="Notification preferences">
        <h2 class="wa-sec">Preferences</h2>
        <p class="wa-hint">Booking and payment updates always stay on. Marketing can be switched off.</p>
        <div *ngIf="prefsLoading" class="wa-loading" role="status">Loading preferences…</div>
        <ul *ngIf="!prefsLoading" class="wa-prefs__list">
          <li *ngFor="let p of preferences; trackBy: trackPref" class="wa-pref">
            <div>
              <p class="wa-pref__name">{{ prefLabel(p.notificationType) }} <span class="wa-pref__chan">{{ p.channel }}</span></p>
              <p class="wa-pref__lock" *ngIf="p.locked">Always on — required for bookings and payments.</p>
            </div>
            <label class="wa-switch" *ngIf="!p.locked">
              <input type="checkbox" [checked]="p.isEnabled" [disabled]="savingPref === prefKey(p)" (change)="togglePref(p, $any($event.target).checked)" [attr.aria-label]="prefLabel(p.notificationType)" />
              <span>{{ p.isEnabled ? 'On' : 'Off' }}</span>
            </label>
            <span class="wa-pref__on" *ngIf="p.locked">On</span>
          </li>
        </ul>
        <p *ngIf="prefError" class="wa-rowerror" role="alert">{{ prefError }}</p>
      </section>
    </div>
  `,
  styles: [`
    .wa-notifs { display:flex; flex-direction:column; gap:16px; max-width:860px; margin:0 auto; }
    .wa-notifs__head { display:flex; justify-content:space-between; align-items:flex-start; gap:12px; }
    .wa-title { margin:0; font-size:22px; font-weight:800; color:var(--waasha-navy); }
    .wa-sub { margin:6px 0 0; font-size:13px; color:var(--waasha-muted); line-height:1.5; max-width:62ch; }
    .wa-card { background:white; border:1px solid var(--waasha-border); border-radius:var(--waasha-radius); padding:16px 18px; box-shadow:0 1px 2px rgba(11,31,51,0.04); }
    .wa-loading { font-size:13px; color:var(--waasha-muted); }
    .wa-error { background:#FEF2F2; border-color:#FECACA; }
    .wa-error__title { margin:0; font-weight:800; color:#991B1B; font-size:13px; }
    .wa-error__msg { margin:4px 0 0; font-size:12px; color:#991B1B; }
    .wa-error__actions { display:flex; gap:8px; margin-top:10px; }
    .wa-empty { text-align:center; padding:28px 18px; }
    .wa-empty__title { margin:0; font-weight:800; color:var(--waasha-navy); font-size:14px; }
    .wa-empty__sub { margin:6px 0 0; font-size:12px; color:var(--waasha-muted); }
    .wa-list { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:12px; }
    .wa-notif.unread { border-left:3px solid var(--waasha-teal); }
    .wa-notif__top { display:flex; justify-content:space-between; align-items:center; gap:8px; }
    .wa-chip { font-size:10px; font-weight:800; letter-spacing:0.05em; text-transform:uppercase; padding:3px 9px; border-radius:999px; background:#F1F5F9; color:var(--waasha-navy); }
    .wa-chip[data-cat="payment"] { background:#DBEAFE; color:#1E40AF; }
    .wa-notif__time { font-size:11px; color:var(--waasha-muted); }
    .wa-notif__title { margin:8px 0 0; font-size:14px; font-weight:800; color:var(--waasha-navy); }
    .wa-notif__msg { margin:4px 0 0; font-size:13px; color:var(--waasha-text); line-height:1.5; }
    .wa-notif__actions { margin-top:10px; display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
    .wa-read { font-size:11px; color:var(--waasha-muted); }
    .wa-rowerror { margin:8px 0 0; font-size:12px; color:#991B1B; }
    .wa-pager { display:flex; align-items:center; justify-content:center; gap:12px; }
    .wa-pager__info { font-size:12px; color:var(--waasha-muted); }
    .wa-sec { margin:0; font-size:15px; font-weight:800; color:var(--waasha-navy); }
    .wa-hint { margin:4px 0 0; font-size:11px; color:var(--waasha-muted); }
    .wa-prefs__list { list-style:none; margin:12px 0 0; padding:0; display:flex; flex-direction:column; gap:10px; }
    .wa-pref { display:flex; justify-content:space-between; align-items:center; gap:10px; padding:10px 0; border-top:1px solid var(--waasha-border); }
    .wa-pref:first-child { border-top:none; }
    .wa-pref__name { margin:0; font-size:13px; font-weight:700; color:var(--waasha-navy); }
    .wa-pref__chan { font-size:10px; font-weight:700; color:var(--waasha-muted); text-transform:uppercase; letter-spacing:0.05em; }
    .wa-pref__lock { margin:2px 0 0; font-size:11px; color:var(--waasha-muted); }
    .wa-pref__on { font-size:12px; font-weight:800; color:var(--waasha-teal); }
    .wa-switch { display:flex; align-items:center; gap:8px; font-size:12px; font-weight:700; color:var(--waasha-navy); cursor:pointer; }
    .wa-btn--navy { background:var(--waasha-navy); color:white; border:1px solid var(--waasha-navy); }
    .wa-btn-ghost { background:#F6F8FA; color:var(--waasha-navy); border:1px solid var(--waasha-border); padding:9px 14px; border-radius:12px; font-weight:700; text-decoration:none; display:inline-flex; justify-content:center; align-items:center; }
    .wa-btn--sm { padding:7px 12px; font-size:12px; border-radius:10px; text-decoration:none; }
    .wa-btn:disabled { opacity:0.55; cursor:default; }
    @media (prefers-reduced-motion: reduce) { * { animation:none !important; transition:none !important; } }
  `]
})
export class NotificationsPage implements OnInit {
  private readonly notifications = inject(NotificationService);
  private readonly sync = inject(SyncService);
  /** Slice 18 — queued read-state note (reconciles server-wins on reconnect). */
  pendingSyncNote: string | null = null;

  items: NotificationItem[] = [];
  loading = true;
  loadError: string | null = null;
  unauthorized = false;
  page = 1;
  perPage = 15;
  total = 0;
  markingId: string | null = null;
  markingAll = false;
  rowError: string | null = null;

  preferences: any[] = [];
  prefsLoading = true;
  prefError: string | null = null;
  savingPref: string | null = null;

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.total / this.perPage));
  }

  get hasUnread(): boolean {
    return this.items.some((n) => isUnread(n));
  }

  ngOnInit(): void {
    this.load();
    this.loadPrefs();
  }

  load(): void {
    this.loading = true;
    this.loadError = null;
    this.unauthorized = false;
    this.notifications.list(this.page, this.perPage).subscribe({
      next: (res) => {
        this.loading = false;
        this.items = res.data ?? [];
        this.total = res.meta?.total ?? this.items.length;
      },
      error: (err) => {
        this.loading = false;
        const status = err?.status;
        if (status === 401 || status === 403) {
          this.unauthorized = true;
          this.loadError = 'Please log in to see your notifications.';
        } else {
          const msg = err?.error?.error?.message ?? '';
          this.loadError = msg && !String(msg).includes('SQL') ? msg : 'Failed to load notifications. Please try again.';
        }
      },
    });
  }

  prevPage(): void {
    if (this.page > 1) {
      this.page -= 1;
      this.load();
    }
  }

  nextPage(): void {
    if (this.page < this.totalPages) {
      this.page += 1;
      this.load();
    }
  }

  markRead(n: NotificationItem): void {
    if (this.markingId) return;
    this.markingId = n.id;
    this.rowError = null;
    // Slice 18 — offline: queue the idempotent flag write and reflect it
    // locally with an explicit will-sync note. Server state wins on refresh.
    if (!this.sync.onlineNow) {
      this.sync
        .enqueueAs('notifications.mark-read', { notificationId: n.id })
        .then(() => {
          this.markingId = null;
          this.items = applyMarkRead(this.items, n.id);
          this.pendingSyncNote = 'Saved — read state will sync when you reconnect.';
        })
        .catch(() => {
          this.markingId = null;
          this.rowError = n.id;
        });
      return;
    }
    // Optimistic state is applied ONLY on server confirmation below.
    this.notifications.markRead(n.id).subscribe({
      next: () => {
        this.markingId = null;
        this.items = applyMarkRead(this.items, n.id);
      },
      error: () => {
        this.markingId = null;
        this.rowError = n.id;
      },
    });
  }

  markAllRead(): void {
    if (this.markingAll) return;
    this.markingAll = true;
    if (!this.sync.onlineNow) {
      this.sync
        .enqueueAs('notifications.read-all', {})
        .then(() => {
          this.markingAll = false;
          this.items = applyMarkAllRead(this.items);
          this.pendingSyncNote = 'Saved — read state will sync when you reconnect.';
        })
        .catch(() => {
          this.markingAll = false;
          this.loadError = 'Failed to save read state. Please try again when online.';
        });
      return;
    }
    this.notifications.markAllRead().subscribe({
      next: () => {
        this.markingAll = false;
        this.items = applyMarkAllRead(this.items);
      },
      error: () => {
        this.markingAll = false;
        this.loadError = 'Failed to mark notifications read. Please try again when online.';
      },
    });
  }

  loadPrefs(): void {
    this.prefsLoading = true;
    this.prefError = null;
    this.notifications.getPreferences().subscribe({
      next: (res) => {
        this.prefsLoading = false;
        this.preferences = res.data?.preferences ?? [];
      },
      error: () => {
        this.prefsLoading = false;
        this.prefError = 'Preferences unavailable right now.';
      },
    });
  }

  togglePref(p: any, enabled: boolean): void {
    const key = this.prefKey(p);
    this.savingPref = key;
    this.prefError = null;
    this.notifications.setPreference(p.channel, p.notificationType, enabled).subscribe({
      next: (res) => {
        this.savingPref = null;
        const saved = res.data?.preference;
        this.preferences = this.preferences.map((x) => (this.prefKey(x) === key ? { ...x, isEnabled: saved?.isEnabled ?? enabled } : x));
      },
      error: (err) => {
        this.savingPref = null;
        const code = err?.error?.error?.code ?? '';
        this.prefError =
          code === 'PREFERENCE_LOCKED'
            ? 'Booking and payment notifications always stay on.'
            : 'Failed to save preference. Please try again when online.';
        // Re-sync authoritative state on failure.
        this.loadPrefs();
      },
    });
  }

  prefKey(p: any): string {
    return `${p.channel}:${p.notificationType}`;
  }

  prefLabel(t: string): string {
    if (t === 'BOOKING_UPDATES') return 'Booking updates';
    if (t === 'PAYMENT_UPDATES') return 'Payment updates';
    return 'Marketing';
  }

  isUnreadRow(n: NotificationItem): boolean {
    return isUnread(n);
  }

  route(n: NotificationItem): string[] | null {
    return routeFor(n);
  }

  label(t: string): string {
    return typeLabel(t);
  }

  category(t: string): string {
    return categoryOf(t);
  }

  trackNotif(_: number, n: NotificationItem): string {
    return n.id;
  }

  trackPref(_: number, p: any): string {
    return this.prefKey(p);
  }
}

import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ProviderBookingsService, ProviderInboxFilter } from '../../core/services/provider-bookings.service';
import { filterByGroup, statusLabel, paymentLabel, InboxGroup } from './provider-bookings.utils';

const FILTERS: Array<{ value: ProviderInboxFilter; label: string }> = [
  { value: 'incoming', label: 'Incoming' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'rejected', label: 'Declined' },
  { value: 'completed', label: 'Completed' },
  { value: 'all', label: 'All' },
];

@Component({
  selector: 'waasha-mobile-provider-inbox',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <div class="wa-pinbox">
      <header class="wa-pinbox__head">
        <div>
          <h1 class="wa-title">Booking inbox</h1>
          <p class="wa-sub">Review incoming requests, then accept or decline. Booking status stays separate from payment and completion.</p>
        </div>
        <a routerLink="/me" class="wa-btn wa-btn-ghost wa-btn--sm">My account</a>
      </header>

      <nav class="wa-filters" role="tablist" aria-label="Booking filters">
        <button
          *ngFor="let f of filters"
          type="button"
          role="tab"
          class="wa-filter"
          [class.active]="activeFilter === f.value"
          [attr.aria-selected]="activeFilter === f.value"
          (click)="setFilter(f.value)"
        >
          {{ f.label }}
        </button>
      </nav>

      <section *ngIf="loading" class="wa-card wa-loading" role="status">Loading bookings…</section>

      <div *ngIf="loadError && !loading" class="wa-card wa-error" role="alert">
        <p class="wa-error__title">{{ unauthorized ? 'Access denied' : "Couldn't load bookings" }}</p>
        <p class="wa-error__msg">{{ loadError }}</p>
        <div class="wa-error__actions">
          <button type="button" class="wa-btn wa-btn-primary wa-btn--navy wa-btn--sm" (click)="load()">Retry</button>
          <a *ngIf="unauthorized" routerLink="/auth/login" class="wa-btn wa-btn-ghost wa-btn--sm">Log in</a>
        </div>
      </div>

      <div *ngIf="!loading && !loadError">
        <div *ngIf="visible.length === 0" class="wa-card wa-empty" role="status">
          <p class="wa-empty__title">No bookings here</p>
          <p class="wa-empty__sub">{{ emptyHint }}</p>
        </div>

        <ul *ngIf="visible.length > 0" class="wa-list">
          <li *ngFor="let b of visible; trackBy: trackBooking" class="wa-card wa-booking">
            <div class="wa-booking__top">
              <span class="wa-ref wa-mono">{{ b.reference }}</span>
              <span class="wa-status" [attr.data-status]="(b.status || '').toUpperCase()">{{ statusText(b.status) }}</span>
            </div>
            <p class="wa-booking__service">{{ b.serviceName || 'Service' }} <span class="wa-muted">• {{ b.customer?.displayName || 'Customer' }}</span></p>
            <dl class="wa-booking__meta">
              <div><dt>Date</dt><dd>{{ b.scheduledStart | date:'mediumDate' }}</dd></div>
              <div><dt>Time</dt><dd>{{ b.scheduledStart | date:'shortTime' }}<span *ngIf="b.durationMinutes"> • {{ b.durationMinutes }} min</span></dd></div>
              <div><dt>Payment</dt><dd>{{ paymentText(b.paymentMethod, b.paymentStatus) }}</dd></div>
              <div><dt>Requested</dt><dd>{{ b.createdAt | date:'medium' }}</dd></div>
            </dl>
            <div class="wa-booking__actions">
              <a [routerLink]="['/provider/bookings', b.id]" class="wa-btn wa-btn-primary wa-btn--navy wa-btn--sm">Review booking</a>
            </div>
          </li>
        </ul>

        <p class="wa-hint" *ngIf="total > visible.length">Showing {{ visible.length }} of {{ total }} — refine the filter to see more.</p>
      </div>
    </div>
  `,
  styles: [`
    .wa-pinbox { display:flex; flex-direction:column; gap:16px; max-width:860px; margin:0 auto; }
    .wa-pinbox__head { display:flex; justify-content:space-between; align-items:flex-start; gap:12px; }
    .wa-title { margin:0; font-size:22px; font-weight:800; color:var(--waasha-navy); }
    .wa-sub { margin:6px 0 0; font-size:13px; color:var(--waasha-muted); line-height:1.5; max-width:60ch; }
    .wa-filters { display:flex; gap:8px; flex-wrap:wrap; }
    .wa-filter { padding:8px 14px; border-radius:999px; border:1px solid var(--waasha-border); background:white; font-size:12px; font-weight:700; color:var(--waasha-navy); cursor:pointer; }
    .wa-filter.active { background:var(--waasha-navy); color:white; border-color:var(--waasha-navy); }
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
    .wa-booking__top { display:flex; justify-content:space-between; align-items:center; gap:8px; }
    .wa-ref { font-size:11px; color:var(--waasha-muted); }
    .wa-mono { font-family:monospace; word-break:break-all; }
    .wa-status { font-size:11px; font-weight:800; letter-spacing:0.04em; text-transform:uppercase; padding:4px 10px; border-radius:999px; background:#F1F5F9; color:var(--waasha-navy); }
    .wa-status[data-status="PENDING"] { background:#FEF3C7; color:#92400E; }
    .wa-status[data-status="ACCEPTED"], .wa-status[data-status="CONFIRMED"] { background:#DCFCE7; color:#166534; }
    .wa-status[data-status="DECLINED"], .wa-status[data-status="CANCELLED"] { background:#FEE2E2; color:#991B1B; }
    .wa-status[data-status="COMPLETED"] { background:#E0E7FF; color:#3730A3; }
    .wa-booking__service { margin:8px 0 0; font-size:14px; font-weight:700; color:var(--waasha-navy); }
    .wa-muted { font-weight:400; color:var(--waasha-muted); }
    .wa-booking__meta { margin:10px 0 0; display:grid; grid-template-columns:repeat(auto-fit,minmax(140px,1fr)); gap:8px; }
    .wa-booking__meta div { display:flex; flex-direction:column; gap:2px; }
    .wa-booking__meta dt { font-size:10px; font-weight:700; letter-spacing:0.06em; text-transform:uppercase; color:var(--waasha-muted); }
    .wa-booking__meta dd { margin:0; font-size:13px; font-weight:600; color:var(--waasha-navy); }
    .wa-booking__actions { margin-top:12px; display:flex; gap:8px; }
    .wa-btn--navy { background:var(--waasha-navy); color:white; border:1px solid var(--waasha-navy); }
    .wa-btn-ghost { background:#F6F8FA; color:var(--waasha-navy); border:1px solid var(--waasha-border); padding:9px 14px; border-radius:12px; font-weight:700; text-decoration:none; display:inline-flex; justify-content:center; align-items:center; }
    .wa-btn--sm { padding:7px 12px; font-size:12px; border-radius:10px; text-decoration:none; }
    .wa-hint { margin:0; font-size:11px; color:var(--waasha-muted); text-align:center; }
    @media (prefers-reduced-motion: reduce) { * { animation:none !important; transition:none !important; } }
  `]
})
export class ProviderInboxPage implements OnInit {
  private readonly bookings = inject(ProviderBookingsService);

  filters = FILTERS;
  activeFilter: ProviderInboxFilter = 'incoming';
  bookings_all: any[] = [];
  loading = true;
  loadError: string | null = null;
  unauthorized = false;
  total = 0;

  get visible(): any[] {
    return filterByGroup(this.bookings_all, this.activeFilter as InboxGroup);
  }

  get emptyHint(): string {
    if (this.activeFilter === 'incoming') return 'No pending requests. New customer bookings will appear here.';
    if (this.activeFilter === 'accepted') return 'No accepted bookings yet.';
    if (this.activeFilter === 'rejected') return 'No declined or cancelled bookings.';
    if (this.activeFilter === 'completed') return 'No completed bookings yet.';
    return 'No bookings found for your provider account.';
  }

  ngOnInit(): void {
    this.load();
  }

  setFilter(f: ProviderInboxFilter): void {
    this.activeFilter = f;
    // Server-side filter keeps payloads small; client re-groups defensively.
    this.load();
  }

  load(): void {
    this.loading = true;
    this.loadError = null;
    this.unauthorized = false;
    this.bookings.listInbox(this.activeFilter, 1, 20).subscribe({
      next: (res) => {
        this.loading = false;
        this.bookings_all = res.data ?? [];
        this.total = res.meta?.total ?? this.bookings_all.length;
      },
      error: (err) => {
        this.loading = false;
        const status = err?.status;
        const msg = err?.error?.error?.message ?? err?.message ?? '';
        if (status === 401 || status === 403) {
          this.unauthorized = true;
          this.loadError = 'Please log in with your provider account to manage bookings.';
        } else if (status === 404) {
          this.loadError = 'Provider profile not found for this account.';
        } else {
          this.loadError = msg && !String(msg).includes('SQL') ? msg : 'Failed to load bookings. Please try again.';
        }
      },
    });
  }

  statusText(s: string): string {
    return statusLabel(s);
  }

  paymentText(method: string | null, status: string): string {
    return paymentLabel(method, status);
  }

  trackBooking(_: number, b: { id: string }): string {
    return b.id;
  }
}

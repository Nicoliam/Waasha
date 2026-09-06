import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { CustomerBookingsService } from '../../core/services/customer-bookings.service';
import {
  CustomerInboxFilter,
  filterByGroup,
  providerDisplayName,
  statusLabel,
  bookingVsPaymentText,
} from './customer-bookings.utils';

const FILTERS: Array<{ value: CustomerInboxFilter; label: string }> = [
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'active', label: 'Active' },
  { value: 'completed', label: 'Completed' },
  { value: 'declined', label: 'Declined' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'all', label: 'All' },
];

@Component({
  selector: 'waasha-my-bookings',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <div class="wa-mine">
      <header class="wa-mine__head">
        <div>
          <h1 class="wa-title">My bookings</h1>
          <p class="wa-sub">Track your appointments. Booking status and payment status are shown separately — paying never means the service is done.</p>
        </div>
        <a routerLink="/marketplace" class="wa-btn wa-btn-ghost wa-btn--sm">Book a service</a>
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
          <a routerLink="/marketplace" class="wa-btn wa-btn-primary wa-btn--navy wa-btn--sm wa-empty__cta">Browse services</a>
        </div>

        <ul *ngIf="visible.length > 0" class="wa-list">
          <li *ngFor="let b of visible; trackBy: trackBooking" class="wa-card wa-booking">
            <div class="wa-booking__top">
              <span class="wa-ref wa-mono">{{ b.reference }}</span>
              <span class="wa-status" [attr.data-status]="(b.status || '').toUpperCase()">{{ statusText(b.status) }}</span>
            </div>
            <p class="wa-booking__service">{{ b.serviceName || 'Service' }}</p>
            <p class="wa-booking__provider">{{ providerName(b) }}</p>
            <dl class="wa-booking__meta">
              <div><dt>Date</dt><dd>{{ b.scheduledStart | date:'mediumDate' }}</dd></div>
              <div><dt>Time</dt><dd>{{ b.scheduledStart | date:'shortTime' }} — {{ b.scheduledEnd | date:'shortTime' }}</dd></div>
              <div><dt>Price</dt><dd>R{{ b.totalAmount }} {{ b.currency }}</dd></div>
              <div><dt>Status</dt><dd>{{ statusPaymentText(b) }}</dd></div>
              <div *ngIf="b.locationSummary"><dt>Area</dt><dd>{{ b.locationSummary }}</dd></div>
            </dl>
            <div class="wa-booking__actions">
              <a [routerLink]="['/bookings', b.id]" class="wa-btn wa-btn-primary wa-btn--navy wa-btn--sm">View details</a>
            </div>
          </li>
        </ul>

        <div *ngIf="totalPages > 1" class="wa-pager" role="navigation" aria-label="Booking pages">
          <button type="button" class="wa-btn wa-btn-ghost wa-btn--sm" [disabled]="page <= 1 || loading" (click)="prevPage()">← Newer</button>
          <span class="wa-pager__info">Page {{ page }} of {{ totalPages }}</span>
          <button type="button" class="wa-btn wa-btn-ghost wa-btn--sm" [disabled]="page >= totalPages || loading" (click)="nextPage()">Older →</button>
        </div>
        <p class="wa-hint" *ngIf="source === 'server'">Server data — just refreshed.</p>
      </div>
    </div>
  `,
  styles: [`
    .wa-mine { display:flex; flex-direction:column; gap:16px; max-width:860px; margin:0 auto; }
    .wa-mine__head { display:flex; justify-content:space-between; align-items:flex-start; gap:12px; }
    .wa-title { margin:0; font-size:22px; font-weight:800; color:var(--waasha-navy); }
    .wa-sub { margin:6px 0 0; font-size:13px; color:var(--waasha-muted); line-height:1.5; max-width:62ch; }
    .wa-filters { display:flex; gap:8px; flex-wrap:wrap; }
    .wa-filter { padding:8px 14px; border-radius:999px; border:1px solid var(--waasha-border); background:white; font-size:12px; font-weight:700; color:var(--waasha-navy); cursor:pointer; }
    .wa-filter.active { background:var(--waasha-navy); color:white; border-color:var(--waasha-navy); }
    .wa-card { background:white; border:1px solid var(--waasha-border); border-radius:var(--waasha-radius); padding:16px 18px; box-shadow:0 1px 2px rgba(11,31,51,0.04); }
    .wa-loading { font-size:13px; color:var(--waasha-muted); }
    .wa-error { background:#FEF2F2; border-color:#FECACA; }
    .wa-error__title { margin:0; font-weight:800; color:#991B1B; font-size:13px; }
    .wa-error__msg { margin:4px 0 0; font-size:12px; color:#991B1B; }
    .wa-error__actions { display:flex; gap:8px; margin-top:10px; }
    .wa-empty { text-align:center; padding:28px 18px; display:flex; flex-direction:column; gap:8px; align-items:center; }
    .wa-empty__title { margin:0; font-weight:800; color:var(--waasha-navy); font-size:14px; }
    .wa-empty__sub { margin:0; font-size:12px; color:var(--waasha-muted); }
    .wa-empty__cta { margin-top:6px; }
    .wa-list { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:12px; }
    .wa-booking__top { display:flex; justify-content:space-between; align-items:center; gap:8px; }
    .wa-ref { font-size:11px; color:var(--waasha-muted); }
    .wa-mono { font-family:monospace; word-break:break-all; }
    .wa-status { font-size:11px; font-weight:800; letter-spacing:0.04em; text-transform:uppercase; padding:4px 10px; border-radius:999px; background:#F1F5F9; color:var(--waasha-navy); }
    .wa-status[data-status="PENDING"] { background:#FEF3C7; color:#92400E; }
    .wa-status[data-status="ACCEPTED"], .wa-status[data-status="CONFIRMED"] { background:#DCFCE7; color:#166534; }
    .wa-status[data-status="IN_PROGRESS"] { background:#DBEAFE; color:#1E40AF; }
    .wa-status[data-status="COMPLETED"] { background:#E0E7FF; color:#3730A3; }
    .wa-status[data-status="DECLINED"], .wa-status[data-status="CANCELLED"] { background:#FEE2E2; color:#991B1B; }
    .wa-booking__service { margin:8px 0 0; font-size:14px; font-weight:700; color:var(--waasha-navy); }
    .wa-booking__provider { margin:2px 0 0; font-size:12px; color:var(--waasha-muted); }
    .wa-booking__meta { margin:10px 0 0; display:grid; grid-template-columns:repeat(auto-fit,minmax(140px,1fr)); gap:8px; }
    .wa-booking__meta div { display:flex; flex-direction:column; gap:2px; }
    .wa-booking__meta dt { font-size:10px; font-weight:700; letter-spacing:0.06em; text-transform:uppercase; color:var(--waasha-muted); }
    .wa-booking__meta dd { margin:0; font-size:13px; font-weight:600; color:var(--waasha-navy); }
    .wa-booking__actions { margin-top:12px; display:flex; gap:8px; }
    .wa-pager { display:flex; align-items:center; justify-content:center; gap:12px; }
    .wa-pager__info { font-size:12px; color:var(--waasha-muted); }
    .wa-btn--navy { background:var(--waasha-navy); color:white; border:1px solid var(--waasha-navy); }
    .wa-btn-ghost { background:#F6F8FA; color:var(--waasha-navy); border:1px solid var(--waasha-border); padding:9px 14px; border-radius:12px; font-weight:700; text-decoration:none; display:inline-flex; justify-content:center; align-items:center; }
    .wa-btn--sm { padding:7px 12px; font-size:12px; border-radius:10px; text-decoration:none; }
    .wa-btn:disabled { opacity:0.55; cursor:default; }
    .wa-hint { margin:0; font-size:11px; color:var(--waasha-muted); text-align:center; }
    @media (prefers-reduced-motion: reduce) { * { animation:none !important; transition:none !important; } }
  `]
})
export class MyBookingsComponent implements OnInit {
  private readonly bookings = inject(CustomerBookingsService);

  filters = FILTERS;
  activeFilter: CustomerInboxFilter = 'upcoming';
  items: any[] = [];
  loading = true;
  loadError: string | null = null;
  unauthorized = false;
  page = 1;
  perPage = 10;
  total = 0;
  source: 'server' | null = null;

  get visible(): any[] {
    return filterByGroup(this.items, this.activeFilter);
  }

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.total / this.perPage));
  }

  get emptyHint(): string {
    if (this.activeFilter === 'upcoming') return 'No upcoming bookings. New requests you make will appear here.';
    if (this.activeFilter === 'all') return 'You have no bookings yet.';
    return `No ${this.activeFilter} bookings.`;
  }

  ngOnInit(): void {
    this.load();
  }

  setFilter(f: CustomerInboxFilter): void {
    this.activeFilter = f;
    this.page = 1;
    this.load();
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

  load(): void {
    this.loading = true;
    this.loadError = null;
    this.unauthorized = false;
    this.bookings.listBookings(this.activeFilter, this.page, this.perPage).subscribe({
      next: (res) => {
        this.loading = false;
        this.items = res.data ?? [];
        this.total = res.meta?.total ?? this.items.length;
        this.source = res.source;
      },
      error: (err) => {
        this.loading = false;
        const status = err?.status;
        const msg = err?.error?.error?.message ?? err?.message ?? '';
        if (status === 401 || status === 403) {
          this.unauthorized = true;
          this.loadError = 'Please log in to see your bookings.';
        } else {
          this.loadError = msg && !String(msg).includes('SQL') ? msg : 'Failed to load bookings. Please try again.';
        }
      },
    });
  }

  statusText(s: string): string {
    return statusLabel(s);
  }

  statusPaymentText(b: { status: string; paymentMethod: string | null; paymentStatus: string }): string {
    return bookingVsPaymentText(b.status, b.paymentMethod, b.paymentStatus);
  }

  providerName(b: { providerName: string | null; businessName: string | null }): string {
    return providerDisplayName(b);
  }

  trackBooking(_: number, b: { id: string }): string {
    return b.id;
  }
}

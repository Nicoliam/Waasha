import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { CustomerBookingsService } from '../../core/services/customer-bookings.service';
import {
  providerDisplayName,
  statusLabel,
  paymentMethodLabel,
  bookingVsPaymentText,
  cashChangeText,
  locationSummaryText,
} from './customer-bookings.utils';

@Component({
  selector: 'waasha-my-booking-detail',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <div class="wa-mdetail">
      <a routerLink="/bookings" class="wa-back">← Back to my bookings</a>

      <section *ngIf="loading" class="wa-card wa-loading" role="status">Loading booking…</section>

      <div *ngIf="loadError && !loading" class="wa-card wa-error" role="alert">
        <p class="wa-error__title">{{ notFound ? 'Booking not found' : unauthorized ? 'Access denied' : "Couldn't load booking" }}</p>
        <p class="wa-error__msg">{{ loadError }}</p>
        <div class="wa-error__actions">
          <button *ngIf="!notFound && !unauthorized" type="button" class="wa-btn wa-btn-primary wa-btn--navy wa-btn--sm" (click)="load()">Retry</button>
          <a *ngIf="unauthorized" routerLink="/auth/login" class="wa-btn wa-btn-ghost wa-btn--sm">Log in</a>
          <a routerLink="/bookings" class="wa-btn wa-btn-ghost wa-btn--sm">My bookings</a>
        </div>
      </div>

      <ng-container *ngIf="!loading && booking">
        <section class="wa-card wa-head" aria-label="Booking summary">
          <div class="wa-head__top">
            <span class="wa-ref wa-mono">{{ booking.reference }}</span>
            <span class="wa-status" [attr.data-status]="(booking.status || '').toUpperCase()">{{ statusText(booking.status) }}</span>
          </div>
          <h1 class="wa-title">{{ booking.serviceName || booking.items?.[0]?.serviceNameSnapshot || 'Booking' }}</h1>
          <p class="wa-sub">With <strong>{{ providerName }}</strong></p>
          <dl class="wa-grid">
            <div><dt>Scheduled start</dt><dd>{{ booking.scheduledStart | date:'medium' }}</dd></div>
            <div><dt>Scheduled end</dt><dd>{{ booking.scheduledEnd | date:'medium' }}</dd></div>
            <div><dt>Duration</dt><dd>{{ bookingDuration }} min</dd></div>
            <div><dt>Price snapshot</dt><dd>R{{ booking.totalAmount }} {{ booking.currency }}</dd></div>
            <div><dt>Provider timezone</dt><dd>{{ booking.timezone }}</dd></div>
            <div><dt>Service location</dt><dd>{{ booking.serviceLocationType === 'CUSTOMER' ? 'Your location (home visit)' : 'Provider location' }}</dd></div>
          </dl>
        </section>

        <section class="wa-card" aria-label="Service snapshot">
          <h2 class="wa-sec">Service snapshot</h2>
          <p class="wa-hint wa-sec__note">Historical record — later provider price or service changes never alter this booking.</p>
          <div *ngFor="let item of booking.items || []" class="wa-item">
            <p class="wa-item__name">{{ item.serviceNameSnapshot }}</p>
            <p class="wa-item__desc" *ngIf="item.serviceDescriptionSnapshot">{{ item.serviceDescriptionSnapshot }}</p>
            <p class="wa-item__meta">R{{ item.unitPrice }} • {{ item.durationMinutes }} min • qty {{ item.quantity }}</p>
          </div>
        </section>

        <section class="wa-card" aria-label="Payment state">
          <h2 class="wa-sec">Payment</h2>
          <p class="wa-statusline">{{ statusPaymentText }}</p>
          <dl class="wa-grid" *ngIf="booking.payment; else noPayment">
            <div><dt>Method</dt><dd>{{ paymentMethodText(booking.payment.method) }}</dd></div>
            <div><dt>Status</dt><dd>{{ booking.payment.status }}</dd></div>
            <div><dt>Amount</dt><dd>R{{ booking.payment.amount }} {{ booking.payment.currency }}</dd></div>
            <div *ngIf="booking.payment.providerReference"><dt>Reference</dt><dd class="wa-mono">{{ booking.payment.providerReference }}</dd></div>
          </dl>
          <ng-template #noPayment><p class="wa-hint">No payment recorded yet for this booking.</p></ng-template>
          <p class="wa-hint">Payment and service completion are separate — a PAID payment never means the service is done.</p>
          <p class="wa-cash" *ngIf="cashText" role="note">{{ cashText }}</p>
        </section>

        <section class="wa-card" aria-label="Booking location">
          <h2 class="wa-sec">Location</h2>
          <div *ngIf="!booking.locationAuthorized" class="wa-locked" role="status">
            <p class="wa-locked__title">Exact address pending</p>
            <p class="wa-locked__msg">{{ areaText }}</p>
          </div>
          <dl class="wa-grid" *ngIf="booking.locationAuthorized && booking.location">
            <div><dt>Address</dt><dd>{{ booking.location.addressLine1 || '—' }}</dd></div>
            <div><dt>City</dt><dd>{{ booking.location.city || '—' }}</dd></div>
            <div><dt>Province</dt><dd>{{ booking.location.province || '—' }}</dd></div>
            <div><dt>Postal code</dt><dd>{{ booking.location.postalCode || '—' }}</dd></div>
          </dl>
          <p class="wa-hint">Snapshot from booking time — later address edits never rewrite history.</p>
        </section>

        <section class="wa-card wa-meta" aria-label="Record">
          <dl class="wa-grid">
            <div><dt>Booking reference</dt><dd class="wa-mono">{{ booking.reference }}</dd></div>
            <div><dt>Requested</dt><dd>{{ booking.createdAt | date:'medium' }}</dd></div>
            <div><dt>Last update</dt><dd>{{ booking.updatedAt | date:'medium' }}</dd></div>
          </dl>
        </section>
      </ng-container>
    </div>
  `,
  styles: [`
    .wa-mdetail { display:flex; flex-direction:column; gap:16px; max-width:860px; margin:0 auto; }
    .wa-back { display:inline-flex; gap:6px; font-size:13px; font-weight:700; color:var(--waasha-navy); text-decoration:none; }
    .wa-card { background:white; border:1px solid var(--waasha-border); border-radius:var(--waasha-radius); padding:20px; box-shadow:0 1px 2px rgba(11,31,51,0.04); }
    .wa-loading { font-size:13px; color:var(--waasha-muted); }
    .wa-head__top { display:flex; justify-content:space-between; align-items:center; gap:8px; }
    .wa-ref { font-size:11px; color:var(--waasha-muted); }
    .wa-mono { font-family:monospace; word-break:break-all; }
    .wa-status { font-size:11px; font-weight:800; letter-spacing:0.04em; text-transform:uppercase; padding:4px 10px; border-radius:999px; background:#F1F5F9; color:var(--waasha-navy); }
    .wa-status[data-status="PENDING"] { background:#FEF3C7; color:#92400E; }
    .wa-status[data-status="ACCEPTED"], .wa-status[data-status="CONFIRMED"] { background:#DCFCE7; color:#166534; }
    .wa-status[data-status="IN_PROGRESS"] { background:#DBEAFE; color:#1E40AF; }
    .wa-status[data-status="COMPLETED"] { background:#E0E7FF; color:#3730A3; }
    .wa-status[data-status="DECLINED"], .wa-status[data-status="CANCELLED"] { background:#FEE2E2; color:#991B1B; }
    .wa-title { margin:8px 0 0; font-size:20px; font-weight:800; color:var(--waasha-navy); }
    .wa-sub { margin:6px 0 0; font-size:13px; color:var(--waasha-muted); line-height:1.5; }
    .wa-sec { margin:0; font-size:15px; font-weight:800; color:var(--waasha-navy); }
    .wa-sec__note { margin:4px 0 10px; }
    .wa-grid { margin:12px 0 0; display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:10px; }
    .wa-grid div { display:flex; flex-direction:column; gap:2px; }
    .wa-grid dt { font-size:10px; font-weight:700; letter-spacing:0.06em; text-transform:uppercase; color:var(--waasha-muted); }
    .wa-grid dd { margin:0; font-size:13px; font-weight:600; color:var(--waasha-navy); }
    .wa-hint { margin:10px 0 0; font-size:11px; color:var(--waasha-muted); }
    .wa-error { background:#FEF2F2; border-color:#FECACA; }
    .wa-error__title { margin:0; font-weight:800; color:#991B1B; font-size:13px; }
    .wa-error__msg { margin:4px 0 0; font-size:12px; color:#991B1B; }
    .wa-error__actions { display:flex; gap:8px; margin-top:10px; flex-wrap:wrap; }
    .wa-item { padding:10px 0; border-top:1px solid var(--waasha-border); }
    .wa-item:first-of-type { border-top:none; padding-top:6px; }
    .wa-item__name { margin:0; font-weight:700; font-size:13px; color:var(--waasha-navy); }
    .wa-item__desc { margin:4px 0 0; font-size:12px; color:var(--waasha-muted); }
    .wa-item__meta { margin:4px 0 0; font-size:12px; color:var(--waasha-navy); }
    .wa-statusline { margin:10px 0 0; font-size:13px; font-weight:700; color:var(--waasha-navy); }
    .wa-cash { margin:10px 0 0; font-size:12px; color:#92400E; background:#FFFBEB; border:1px solid #FDE68A; padding:10px 12px; border-radius:12px; }
    .wa-locked { background:#F8FAFC; border:1px dashed var(--waasha-border); border-radius:12px; padding:14px; margin-top:10px; }
    .wa-locked__title { margin:0; font-weight:800; font-size:13px; color:var(--waasha-navy); }
    .wa-locked__msg { margin:4px 0 0; font-size:12px; color:var(--waasha-muted); }
    .wa-btn { padding:11px 18px; border-radius:12px; font-weight:700; font-size:13px; cursor:pointer; text-decoration:none; display:inline-flex; justify-content:center; align-items:center; }
    .wa-btn--navy { background:var(--waasha-navy); color:white; border:1px solid var(--waasha-navy); }
    .wa-btn-ghost { background:#F6F8FA; color:var(--waasha-navy); border:1px solid var(--waasha-border); }
    .wa-btn--sm { padding:7px 12px; font-size:12px; border-radius:10px; }
    @media (prefers-reduced-motion: reduce) { * { animation:none !important; transition:none !important; } }
  `]
})
export class MyBookingDetailComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly bookings = inject(CustomerBookingsService);

  bookingId = '';
  booking: any = null;
  loading = true;
  loadError: string | null = null;
  unauthorized = false;
  notFound = false;

  get providerName(): string {
    if (!this.booking) return 'Provider';
    return providerDisplayName({ providerName: this.booking.providerName ?? null, businessName: this.booking.businessName ?? null });
  }

  get bookingDuration(): number | null {
    if (this.booking?.durationMinutes != null) return this.booking.durationMinutes;
    const items = this.booking?.items ?? [];
    if (!items.length) return null;
    return items.reduce((acc: number, i: any) => acc + (i.durationMinutes ?? 0) * (i.quantity ?? 1), 0);
  }

  get statusPaymentText(): string {
    if (!this.booking) return '';
    return bookingVsPaymentText(this.booking.status, this.booking.paymentMethod ?? this.booking.payment?.method ?? null, this.booking.paymentStatus);
  }

  get cashText(): string | null {
    const cash = this.booking?.cash;
    if (!cash) return null;
    return cashChangeText(!!cash.changeRequested, cash.changeAmount ?? null);
  }

  get areaText(): string {
    if (!this.booking) return '';
    return locationSummaryText(this.booking.locationSummary ?? this.booking.location?.city ?? null, false);
  }

  ngOnInit(): void {
    this.bookingId = this.route.snapshot.paramMap.get('id') ?? '';
    this.load();
  }

  load(): void {
    this.loading = true;
    this.loadError = null;
    this.unauthorized = false;
    this.notFound = false;
    this.bookings.getDetail(this.bookingId).subscribe({
      next: (res) => {
        this.loading = false;
        this.booking = res.data;
      },
      error: (err) => {
        this.loading = false;
        const status = err?.status;
        const msg = err?.error?.error?.message ?? err?.message ?? '';
        if (status === 401 || status === 403) {
          this.unauthorized = true;
          this.loadError = 'Please log in to view your booking.';
        } else if (status === 404) {
          this.notFound = true;
          this.loadError = 'This booking does not exist or does not belong to your account.';
        } else {
          this.loadError = msg && !String(msg).includes('SQL') ? msg : 'Failed to load booking. Please try again.';
        }
      },
    });
  }

  statusText(s: string): string {
    return statusLabel(s);
  }

  paymentMethodText(m: string | null): string {
    return paymentMethodLabel(m);
  }
}

import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ProviderBookingsService } from '../../core/services/provider-bookings.service';
import { statusLabel, paymentLabel, cashChangeText, navigationUrls } from './provider-bookings.utils';

@Component({
  selector: 'waasha-provider-booking-detail',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <div class="wa-pdetail">
      <a routerLink="/provider/bookings" class="wa-back">← Back to inbox</a>

      <section *ngIf="loading" class="wa-card wa-loading" role="status">Loading booking…</section>

      <div *ngIf="loadError && !loading" class="wa-card wa-error" role="alert">
        <p class="wa-error__title">{{ notFound ? 'Booking not found' : unauthorized ? 'Access denied' : "Couldn't load booking" }}</p>
        <p class="wa-error__msg">{{ loadError }}</p>
        <div class="wa-error__actions">
          <button *ngIf="!notFound && !unauthorized" type="button" class="wa-btn wa-btn-primary wa-btn--navy wa-btn--sm" (click)="load()">Retry</button>
          <a *ngIf="unauthorized" routerLink="/auth/login" class="wa-btn wa-btn-ghost wa-btn--sm">Log in</a>
          <a routerLink="/provider/bookings" class="wa-btn wa-btn-ghost wa-btn--sm">Back to inbox</a>
        </div>
      </div>

      <ng-container *ngIf="!loading && booking">
        <section class="wa-card wa-head" aria-label="Booking summary">
          <div class="wa-head__top">
            <span class="wa-ref wa-mono">{{ booking.reference }}</span>
            <span class="wa-status" [attr.data-status]="(booking.status || '').toUpperCase()">{{ statusText(booking.status) }}</span>
          </div>
          <h1 class="wa-title">{{ booking.serviceName || booking.items?.[0]?.serviceNameSnapshot || 'Booking' }}</h1>
          <p class="wa-sub">Customer: <strong>{{ booking.customer?.displayName || booking.customer?.firstName || 'Customer' }}</strong></p>
          <dl class="wa-grid">
            <div><dt>Scheduled start</dt><dd>{{ booking.scheduledStart | date:'medium' }}</dd></div>
            <div><dt>Scheduled end</dt><dd>{{ booking.scheduledEnd | date:'medium' }}</dd></div>
            <div><dt>Duration</dt><dd>{{ bookingDuration }} min</dd></div>
            <div><dt>Price snapshot</dt><dd>R{{ booking.totalAmount }} {{ booking.currency }}</dd></div>
            <div><dt>Service location</dt><dd>{{ booking.serviceLocationType === 'CUSTOMER' ? 'Customer location' : 'Provider location' }}</dd></div>
            <div><dt>Payment</dt><dd>{{ paymentText(booking.paymentMethod ?? booking.payment?.method ?? null, booking.paymentStatus) }}</dd></div>
          </dl>
          <p class="wa-hint">Payment state is informational — accepting never marks payment PAID and never completes the service.</p>
        </section>

        <section class="wa-card" aria-label="Service snapshot">
          <h2 class="wa-sec">Service snapshot</h2>
          <div *ngFor="let item of booking.items || []" class="wa-item">
            <p class="wa-item__name">{{ item.serviceNameSnapshot }}</p>
            <p class="wa-item__desc" *ngIf="item.serviceDescriptionSnapshot">{{ item.serviceDescriptionSnapshot }}</p>
            <p class="wa-item__meta">R{{ item.unitPrice }} • {{ item.durationMinutes }} min • qty {{ item.quantity }}</p>
          </div>
        </section>

        <section class="wa-card" aria-label="Payment state">
          <h2 class="wa-sec">Payment</h2>
          <dl class="wa-grid" *ngIf="booking.payment; else noPayment">
            <div><dt>Method</dt><dd>{{ booking.payment.method }}</dd></div>
            <div><dt>Status</dt><dd>{{ booking.payment.status }}</dd></div>
            <div><dt>Amount</dt><dd>R{{ booking.payment.amount }} {{ booking.payment.currency }}</dd></div>
            <div *ngIf="booking.payment.providerReference"><dt>Reference</dt><dd class="wa-mono">{{ booking.payment.providerReference }}</dd></div>
          </dl>
          <ng-template #noPayment><p class="wa-hint">No payment recorded yet for this booking.</p></ng-template>
          <p class="wa-cash" *ngIf="cashText" role="note">{{ cashText }}</p>
        </section>

        <section class="wa-card" aria-label="Client location">
          <h2 class="wa-sec">Client location</h2>
          <div *ngIf="!booking.locationAuthorized" class="wa-locked" role="status">
            <p class="wa-locked__title">Location protected</p>
            <p class="wa-locked__msg">Precise client location is only available once the booking is accepted. City context: {{ booking.location?.city || '—' }}, {{ booking.location?.province || '' }}.</p>
          </div>
          <dl class="wa-grid" *ngIf="booking.locationAuthorized && booking.location">
            <div><dt>Address</dt><dd>{{ booking.location.addressLine1 || '—' }}</dd></div>
            <div><dt>City</dt><dd>{{ booking.location.city || '—' }}</dd></div>
            <div><dt>Province</dt><dd>{{ booking.location.province || '—' }}</dd></div>
            <div><dt>Postal code</dt><dd>{{ booking.location.postalCode || '—' }}</dd></div>
          </dl>
          <div *ngIf="booking.navigationAvailable && navLoading" class="wa-loading" role="status">Loading navigation…</div>
          <div *ngIf="booking.navigationAvailable && navError" class="wa-error wa-error--inline" role="alert"><p class="wa-error__msg">{{ navError }}</p></div>
          <div *ngIf="booking.navigationAvailable && navigation" class="wa-nav" aria-label="Navigate to client">
            <p class="wa-nav__label">{{ navigation.label }}</p>
            <div class="wa-nav__actions">
              <a class="wa-btn wa-btn-primary wa-btn--navy" [href]="navigation.googleMapsUrl" target="_blank" rel="noopener" aria-label="Navigate to client">Navigate to Client</a>
              <a class="wa-btn wa-btn-ghost wa-btn--sm" [href]="navigation.appleMapsUrl" target="_blank" rel="noopener">Apple Maps</a>
            </div>
          </div>
        </section>

        <section *ngIf="isPending" class="wa-card wa-actions" aria-label="Review booking">
          <h2 class="wa-sec">Review booking</h2>
          <p class="wa-sub">Accepting re-checks availability and blocks double bookings. Declining preserves the booking record.</p>
          <div *ngIf="actionError" class="wa-error wa-error--inline" role="alert">
            <p class="wa-error__title">{{ actionErrorTitle }}</p>
            <p class="wa-error__msg">{{ actionErrorMsg }}</p>
          </div>
          <div class="wa-actions__row">
            <button type="button" class="wa-btn wa-btn-primary wa-btn--navy" [disabled]="acting" (click)="accept()" aria-label="Accept booking">
              {{ acting === 'accept' ? 'Accepting…' : 'Accept booking' }}
            </button>
            <button type="button" class="wa-btn wa-btn-danger" [disabled]="acting" (click)="reject()" aria-label="Decline booking">
              {{ acting === 'reject' ? 'Declining…' : 'Decline' }}
            </button>
          </div>
        </section>

        <section *ngIf="!isPending && transition" class="wa-card wa-success" role="status">
          <p class="wa-success__msg">Booking {{ transition.status === 'ACCEPTED' ? 'accepted' : 'declined' }} successfully.</p>
        </section>
      </ng-container>
    </div>
  `,
  styles: [`
    .wa-pdetail { display:flex; flex-direction:column; gap:16px; max-width:860px; margin:0 auto; }
    .wa-back { display:inline-flex; gap:6px; font-size:13px; font-weight:700; color:var(--waasha-navy); text-decoration:none; }
    .wa-card { background:white; border:1px solid var(--waasha-border); border-radius:var(--waasha-radius); padding:20px; box-shadow:0 1px 2px rgba(11,31,51,0.04); }
    .wa-loading { font-size:13px; color:var(--waasha-muted); }
    .wa-head__top { display:flex; justify-content:space-between; align-items:center; gap:8px; }
    .wa-ref { font-size:11px; color:var(--waasha-muted); }
    .wa-mono { font-family:monospace; word-break:break-all; }
    .wa-status { font-size:11px; font-weight:800; letter-spacing:0.04em; text-transform:uppercase; padding:4px 10px; border-radius:999px; background:#F1F5F9; color:var(--waasha-navy); }
    .wa-status[data-status="PENDING"] { background:#FEF3C7; color:#92400E; }
    .wa-status[data-status="ACCEPTED"], .wa-status[data-status="CONFIRMED"] { background:#DCFCE7; color:#166534; }
    .wa-status[data-status="DECLINED"], .wa-status[data-status="CANCELLED"] { background:#FEE2E2; color:#991B1B; }
    .wa-status[data-status="COMPLETED"] { background:#E0E7FF; color:#3730A3; }
    .wa-title { margin:8px 0 0; font-size:20px; font-weight:800; color:var(--waasha-navy); }
    .wa-sub { margin:6px 0 0; font-size:13px; color:var(--waasha-muted); line-height:1.5; }
    .wa-sec { margin:0 0 10px; font-size:15px; font-weight:800; color:var(--waasha-navy); }
    .wa-grid { margin:12px 0 0; display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); gap:10px; }
    .wa-grid div { display:flex; flex-direction:column; gap:2px; }
    .wa-grid dt { font-size:10px; font-weight:700; letter-spacing:0.06em; text-transform:uppercase; color:var(--waasha-muted); }
    .wa-grid dd { margin:0; font-size:13px; font-weight:600; color:var(--waasha-navy); }
    .wa-hint { margin:10px 0 0; font-size:11px; color:var(--waasha-muted); }
    .wa-error { background:#FEF2F2; border-color:#FECACA; }
    .wa-error--inline { padding:12px; border-radius:12px; border:1px solid #FECACA; margin-bottom:10px; }
    .wa-error__title { margin:0; font-weight:800; color:#991B1B; font-size:13px; }
    .wa-error__msg { margin:4px 0 0; font-size:12px; color:#991B1B; }
    .wa-error__actions { display:flex; gap:8px; margin-top:10px; flex-wrap:wrap; }
    .wa-item { padding:10px 0; border-top:1px solid var(--waasha-border); }
    .wa-item:first-of-type { border-top:none; padding-top:0; }
    .wa-item__name { margin:0; font-weight:700; font-size:13px; color:var(--waasha-navy); }
    .wa-item__desc { margin:4px 0 0; font-size:12px; color:var(--waasha-muted); }
    .wa-item__meta { margin:4px 0 0; font-size:12px; color:var(--waasha-navy); }
    .wa-cash { margin:10px 0 0; font-size:12px; color:#92400E; background:#FFFBEB; border:1px solid #FDE68A; padding:10px 12px; border-radius:12px; }
    .wa-locked { background:#F8FAFC; border:1px dashed var(--waasha-border); border-radius:12px; padding:14px; }
    .wa-locked__title { margin:0; font-weight:800; font-size:13px; color:var(--waasha-navy); }
    .wa-locked__msg { margin:4px 0 0; font-size:12px; color:var(--waasha-muted); }
    .wa-nav { margin-top:12px; display:flex; flex-direction:column; gap:10px; }
    .wa-nav__label { margin:0; font-size:13px; font-weight:600; color:var(--waasha-navy); }
    .wa-nav__actions { display:flex; gap:8px; flex-wrap:wrap; }
    .wa-actions__row { display:flex; gap:10px; flex-wrap:wrap; margin-top:12px; }
    .wa-btn { padding:11px 18px; border-radius:12px; font-weight:700; font-size:13px; cursor:pointer; text-decoration:none; display:inline-flex; justify-content:center; align-items:center; }
    .wa-btn:disabled { opacity:0.6; cursor:wait; }
    .wa-btn--navy { background:var(--waasha-navy); color:white; border:1px solid var(--waasha-navy); }
    .wa-btn-ghost { background:#F6F8FA; color:var(--waasha-navy); border:1px solid var(--waasha-border); }
    .wa-btn-danger { background:white; color:#991B1B; border:1px solid #FECACA; }
    .wa-btn--sm { padding:7px 12px; font-size:12px; border-radius:10px; }
    .wa-success { border-color:#A7F3D0; background:#ECFDF5; }
    .wa-success__msg { margin:0; font-size:13px; font-weight:700; color:#065F46; }
    @media (prefers-reduced-motion: reduce) { * { animation:none !important; transition:none !important; } }
  `]
})
export class ProviderBookingDetailComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly bookings = inject(ProviderBookingsService);

  bookingId = '';
  booking: any = null;
  loading = true;
  loadError: string | null = null;
  unauthorized = false;
  notFound = false;

  acting: 'accept' | 'reject' | null = null;
  actionError = false;
  actionErrorTitle = '';
  actionErrorMsg = '';
  transition: any = null;

  navigation: any = null;
  navLoading = false;
  navError: string | null = null;

  get isPending(): boolean {
    return !!this.booking && (this.booking.status ?? '').toUpperCase() === 'PENDING' && !this.transition;
  }

  get bookingDuration(): number | null {
    if (this.booking?.durationMinutes != null) return this.booking.durationMinutes;
    const items = this.booking?.items ?? [];
    if (!items.length) return null;
    return items.reduce((acc: number, i: any) => acc + (i.durationMinutes ?? 0) * (i.quantity ?? 1), 0);
  }

  get cashText(): string | null {
    const cash = this.booking?.cash;
    if (!cash) return null;
    return cashChangeText(!!cash.changeRequested, cash.changeAmount ?? null);
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
        if (this.booking?.navigationAvailable) this.loadNavigation();
      },
      error: (err) => {
        this.loading = false;
        const status = err?.status;
        const msg = err?.error?.error?.message ?? err?.message ?? '';
        if (status === 401 || status === 403) {
          this.unauthorized = true;
          this.loadError = 'Please log in with your provider account to view this booking.';
        } else if (status === 404) {
          this.notFound = true;
          this.loadError = 'This booking does not exist or does not belong to your provider account.';
        } else {
          this.loadError = msg && !String(msg).includes('SQL') ? msg : 'Failed to load booking. Please try again.';
        }
      },
    });
  }

  accept(): void {
    this.runAction('accept');
  }

  reject(): void {
    this.runAction('reject');
  }

  private runAction(kind: 'accept' | 'reject'): void {
    if (this.acting || !this.booking) return;
    this.acting = kind;
    this.actionError = false;
    const call = kind === 'accept' ? this.bookings.accept(this.bookingId) : this.bookings.reject(this.bookingId);
    call.subscribe({
      next: (res) => {
        this.acting = null;
        this.transition = res.data;
        this.booking = { ...this.booking, status: res.data.status };
        if (res.data.status === 'ACCEPTED') this.loadNavigation();
        window.scrollTo({ top: 0, behavior: 'smooth' });
      },
      error: (err) => {
        this.acting = null;
        const status = err?.status;
        const code = err?.error?.error?.code ?? '';
        const msg = err?.error?.error?.message ?? err?.message ?? 'Failed to update booking';
        this.actionError = true;
        if (status === 409 || code === 'BOOKING_CONFLICT') {
          this.actionErrorTitle = 'Booking conflict';
          this.actionErrorMsg = 'Another booking now overlaps this slot. The request can no longer be accepted.';
        } else if (status === 422 || code === 'BOOKING_INVALID_STATE') {
          this.actionErrorTitle = 'No longer actionable';
          this.actionErrorMsg = 'This booking changed state and can no longer be updated this way. Refreshing…';
          this.load();
        } else if (status === 404) {
          this.actionErrorTitle = 'Not found';
          this.actionErrorMsg = 'This booking does not belong to your provider account.';
        } else if (status === 401 || status === 403) {
          this.actionErrorTitle = 'Access denied';
          this.actionErrorMsg = 'Please log in with your provider account.';
          this.router.navigate(['/auth/login']);
        } else {
          this.actionErrorTitle = "Couldn't update booking";
          this.actionErrorMsg = String(msg).includes('SQL') ? 'Please try again.' : msg;
        }
      },
    });
  }

  private loadNavigation(): void {
    this.navLoading = true;
    this.navError = null;
    this.navigation = null;
    this.bookings.getNavigation(this.bookingId).subscribe({
      next: (res) => {
        this.navLoading = false;
        const nav = res.data;
        // Client-side deep links mirror the server destination defensively.
        if (nav?.latitude != null && nav?.longitude != null && !nav.googleMapsUrl) {
          const links = navigationUrls(Number(nav.latitude), Number(nav.longitude));
          nav.googleMapsUrl = links.googleMapsUrl;
          nav.appleMapsUrl = links.appleMapsUrl;
        }
        this.navigation = nav;
      },
      error: (err) => {
        this.navLoading = false;
        const code = err?.error?.error?.code ?? '';
        if (code === 'LOCATION_NOT_AUTHORIZED') {
          this.navError = 'Client location is not available for this booking yet.';
        } else if (err?.status !== 404) {
          this.navError = 'Navigation is unavailable right now.';
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
}

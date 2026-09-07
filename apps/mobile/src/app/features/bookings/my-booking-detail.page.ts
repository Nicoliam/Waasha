import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { CustomerBookingsService } from '../../core/services/customer-bookings.service';
import { BookingService } from '../../core/services/booking.service';
import {
  providerDisplayName,
  statusLabel,
  paymentMethodLabel,
  bookingVsPaymentText,
  cashChangeText,
  locationSummaryText,
  canCancelBooking,
  canRescheduleBooking,
  canReviewBooking,
  REVIEW_RATINGS,
  isValidRating,
  interpretActionError,
  isOnline,
} from './customer-bookings.utils';

@Component({
  selector: 'waasha-mobile-my-booking-detail',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
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

        <div *ngIf="actionNotice" class="wa-card wa-notice" role="status">
          <p class="wa-notice__msg">{{ actionNotice }}</p>
        </div>

        <section *ngIf="showCancelHint || showRescheduleHint" class="wa-card" aria-label="Manage booking">
          <h2 class="wa-sec">Manage booking</h2>
          <p class="wa-hint">Changes are confirmed by the server — nothing is final until you see a success message.</p>
          <div class="wa-actions">
            <button *ngIf="showCancelHint" type="button" class="wa-btn wa-btn-danger wa-btn--sm" [disabled]="cancelLoading || rescheduleLoading" (click)="startCancel()">Cancel booking</button>
            <button *ngIf="showRescheduleHint" type="button" class="wa-btn wa-btn-ghost wa-btn--sm" [disabled]="cancelLoading || rescheduleLoading" (click)="startReschedule()">Reschedule</button>
          </div>

          <div *ngIf="actionError" class="wa-alert wa-alert--error" role="alert">
            <p>{{ actionError }}</p>
            <button *ngIf="actionRetry" type="button" class="wa-btn wa-btn-ghost wa-btn--sm" (click)="retryAction()">Retry</button>
          </div>

          <div *ngIf="showCancelConfirm" class="wa-confirm" role="dialog" aria-label="Confirm cancellation">
            <p class="wa-confirm__title">Cancel this booking?</p>
            <p class="wa-confirm__msg">This cannot be undone. Your payment record stays unchanged — cancellation never processes a refund automatically.</p>
            <label class="wa-field">
              <span>Reason (optional, max 500 characters)</span>
              <input type="text" [(ngModel)]="cancelReason" maxlength="500" placeholder="e.g. Plans changed" [disabled]="cancelLoading" />
            </label>
            <div class="wa-actions">
              <button type="button" class="wa-btn wa-btn-danger wa-btn--sm" [disabled]="cancelLoading" (click)="confirmCancel()">
                {{ cancelLoading ? 'Cancelling…' : 'Yes, cancel booking' }}
              </button>
              <button type="button" class="wa-btn wa-btn-ghost wa-btn--sm" [disabled]="cancelLoading" (click)="showCancelConfirm = false">Keep booking</button>
            </div>
          </div>

          <div *ngIf="showReschedulePanel" class="wa-resched" aria-label="Reschedule booking">
            <p class="wa-confirm__title">Choose a new time</p>
            <p class="wa-confirm__msg">Real availability from your provider — never sample slots. Times shown in {{ booking.timezone }}.</p>
            <label class="wa-field">
              <span>Date</span>
              <input type="date" [(ngModel)]="rescheduleDate" (change)="loadSlots()" [disabled]="rescheduleLoading || slotsLoading" />
            </label>
            <p *ngIf="slotsLoading" class="wa-hint" role="status">Loading available times…</p>
            <p *ngIf="slotsError && !slotsLoading" class="wa-alert wa-alert--error" role="alert">{{ slotsError }}</p>
            <div *ngIf="!slotsLoading && slots.length > 0" class="wa-slots" role="listbox" aria-label="Available times">
              <button
                *ngFor="let slot of slots"
                type="button"
                role="option"
                [attr.aria-selected]="selectedSlot === slot.start"
                class="wa-slot"
                [class.wa-slot--sel]="selectedSlot === slot.start"
                [disabled]="rescheduleLoading"
                (click)="selectedSlot = slot.start">
                {{ slot.displayStart }} – {{ slot.displayEnd }}
              </button>
            </div>
            <p *ngIf="!slotsLoading && !slotsError && slotsLoaded && slots.length === 0" class="wa-hint" role="status">No available times on this date. Try another date.</p>
            <div class="wa-actions">
              <button type="button" class="wa-btn wa-btn--navy wa-btn--sm" [disabled]="rescheduleLoading || !selectedSlot" (click)="confirmReschedule()">
                {{ rescheduleLoading ? 'Rescheduling…' : 'Confirm new time' }}
              </button>
              <button type="button" class="wa-btn wa-btn-ghost wa-btn--sm" [disabled]="rescheduleLoading" (click)="showReschedulePanel = false">Close</button>
            </div>
          </div>
        </section>

        <section *ngIf="showReviewSection" class="wa-card" aria-label="Review service">
          <h2 class="wa-sec">Review service</h2>
          <p class="wa-hint">Completed services can be reviewed once. Your review is shown as plain text and shared with your provider.</p>

          <p *ngIf="reviewLoading" class="wa-hint" role="status">Checking review status…</p>

          <div *ngIf="!reviewLoading && existingReview" class="wa-review" role="status">
            <p class="wa-review__title">Your review</p>
            <p class="wa-stars" [attr.aria-label]="'Rated ' + existingReview.rating + ' out of 5'">{{ starText(existingReview.rating) }}</p>
            <p class="wa-review__comment" *ngIf="existingReview.comment">{{ existingReview.comment }}</p>
          </div>

          <div *ngIf="!reviewLoading && !existingReview">
            <div *ngIf="reviewError" class="wa-alert wa-alert--error" role="alert">
              <p>{{ reviewError }}</p>
              <button *ngIf="reviewRetry" type="button" class="wa-btn wa-btn-ghost wa-btn--sm" (click)="retryReview()">Retry</button>
            </div>
            <p *ngIf="reviewNotice" class="wa-notice__msg" role="status">{{ reviewNotice }}</p>
            <div class="wa-stars__row" role="radiogroup" aria-label="Star rating">
              <button
                *ngFor="let r of ratings"
                type="button"
                role="radio"
                [attr.aria-checked]="selectedRating === r"
                class="wa-star"
                [class.wa-star--sel]="selectedRating != null && r <= selectedRating"
                [disabled]="reviewSubmitting"
                (click)="selectedRating = r"
                [attr.aria-label]="r + ' star'">
                {{ r }}★
              </button>
            </div>
            <label class="wa-field">
              <span>Comment (optional, max 1000 characters)</span>
              <textarea [(ngModel)]="reviewComment" maxlength="1000" rows="3" placeholder="How was your experience?" [disabled]="reviewSubmitting"></textarea>
            </label>
            <div class="wa-actions">
              <button type="button" class="wa-btn wa-btn--navy wa-btn--sm" [disabled]="reviewSubmitting || selectedRating == null" (click)="submitReview()">
                {{ reviewSubmitting ? 'Submitting…' : 'Submit review' }}
              </button>
            </div>
          </div>
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
    .wa-actions { display:flex; gap:8px; margin-top:12px; flex-wrap:wrap; }
    .wa-alert { margin:10px 0 0; font-size:12px; padding:10px 12px; border-radius:12px; }
    .wa-alert--error { background:#FEF2F2; border:1px solid #FECACA; color:#991B1B; }
    .wa-alert p { margin:0 0 8px; }
    .wa-notice { background:#ECFDF5; border-color:#A7F3D0; }
    .wa-notice__msg { margin:0; font-size:13px; font-weight:700; color:#065F46; }
    .wa-confirm, .wa-resched { margin-top:12px; padding:14px; border:1px solid var(--waasha-border); border-radius:12px; background:#F8FAFC; }
    .wa-confirm__title { margin:0; font-weight:800; font-size:13px; color:var(--waasha-navy); }
    .wa-confirm__msg { margin:4px 0 0; font-size:12px; color:var(--waasha-muted); }
    .wa-field { display:flex; flex-direction:column; gap:4px; margin-top:10px; font-size:12px; font-weight:700; color:var(--waasha-navy); }
    .wa-field input { padding:10px 12px; border:1px solid var(--waasha-border); border-radius:10px; font-size:13px; font-weight:400; }
    .wa-field textarea { padding:10px 12px; border:1px solid var(--waasha-border); border-radius:10px; font-size:13px; font-weight:400; font-family:inherit; resize:vertical; }
    .wa-review { margin-top:10px; padding:12px; border:1px solid var(--waasha-border); border-radius:12px; background:#F8FAFC; }
    .wa-review__title { margin:0; font-weight:800; font-size:13px; color:var(--waasha-navy); }
    .wa-review__comment { margin:6px 0 0; font-size:13px; color:var(--waasha-navy); white-space:pre-wrap; }
    .wa-stars { margin:6px 0 0; font-size:16px; color:var(--waasha-navy); letter-spacing:2px; }
    .wa-stars__row { display:flex; gap:8px; margin-top:10px; flex-wrap:wrap; }
    .wa-star { min-height:44px; min-width:52px; padding:8px 10px; border-radius:12px; border:1px solid var(--waasha-border); background:white; font-size:14px; font-weight:800; color:var(--waasha-navy); cursor:pointer; }
    .wa-star--sel { background:var(--waasha-navy); color:white; border-color:var(--waasha-navy); }
    .wa-notice__msg { margin:10px 0 0; font-size:13px; font-weight:700; color:#065F46; }
    .wa-slots { display:flex; flex-wrap:wrap; gap:8px; margin-top:10px; }
    .wa-slot { padding:10px 14px; border-radius:12px; border:1px solid var(--waasha-border); background:white; font-size:13px; font-weight:700; color:var(--waasha-navy); cursor:pointer; min-height:44px; }
    .wa-slot--sel { background:var(--waasha-navy); color:white; border-color:var(--waasha-navy); }
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
    .wa-btn-danger { background:#DC2626; color:white; border:1px solid #DC2626; }
    .wa-btn--sm { padding:7px 12px; font-size:12px; border-radius:10px; min-height:44px; }
    .wa-btn:disabled { opacity:0.55; cursor:not-allowed; }
    @media (prefers-reduced-motion: reduce) { * { animation:none !important; transition:none !important; } }
  `]
})
export class MyBookingDetailPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly bookings = inject(CustomerBookingsService);
  private readonly bookingApi = inject(BookingService);

  bookingId = '';
  booking: any = null;
  loading = true;
  loadError: string | null = null;
  unauthorized = false;
  notFound = false;

  // Slice 12 — action state. Success is only shown after a server reply.
  actionNotice: string | null = null;
  actionError: string | null = null;
  actionRetry: (() => void) | null = null;
  showCancelConfirm = false;
  cancelReason = '';
  cancelLoading = false;
  showReschedulePanel = false;
  rescheduleDate = '';
  slots: Array<{ start: string; end: string; displayStart: string; displayEnd: string }> = [];
  slotsLoading = false;
  slotsLoaded = false;
  slotsError: string | null = null;
  selectedSlot: string | null = null;
  rescheduleLoading = false;

  // Slice 13 — review state. Success is only shown after a server reply.
  ratings = REVIEW_RATINGS;
  selectedRating: number | null = null;
  reviewComment = '';
  reviewSubmitting = false;
  reviewLoading = false;
  reviewChecked = false;
  reviewError: string | null = null;
  reviewRetry: (() => void) | null = null;
  reviewNotice: string | null = null;
  existingReview: any = null;

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

  /** Display hint only — the server decides eligibility. */
  get showCancelHint(): boolean {
    return !!this.booking && canCancelBooking(this.booking.status ?? '');
  }

  get showRescheduleHint(): boolean {
    return !!this.booking && canRescheduleBooking(this.booking.status ?? '');
  }

  /** Display hint only — the server decides review eligibility. */
  get showReviewSection(): boolean {
    return !!this.booking && canReviewBooking(this.booking.status ?? '');
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
        this.maybeLoadReview();
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

  private guardOnline(): boolean {
    if (!isOnline()) {
      this.actionError = interpretActionError({ status: 0 }).message;
      this.actionRetry = null;
      return false;
    }
    return true;
  }

  startCancel(): void {
    this.actionNotice = null;
    this.actionError = null;
    this.actionRetry = null;
    this.showReschedulePanel = false;
    if (!this.guardOnline()) return;
    this.showCancelConfirm = true;
  }

  confirmCancel(): void {
    if (this.cancelLoading) return;
    if (!this.guardOnline()) return;
    this.cancelLoading = true;
    this.actionError = null;
    this.actionRetry = null;
    this.bookings.cancelBooking(this.bookingId, this.cancelReason).subscribe({
      next: () => {
        this.cancelLoading = false;
        this.showCancelConfirm = false;
        this.cancelReason = '';
        this.actionNotice = 'Booking cancelled. Your payment record is unchanged.';
        this.load();
      },
      error: (err) => {
        this.cancelLoading = false;
        const parsed = interpretActionError(err);
        this.actionError = parsed.message;
        this.actionRetry = parsed.kind === 'server' || parsed.kind === 'offline' ? () => this.confirmCancel() : null;
      },
    });
  }

  startReschedule(): void {
    this.actionNotice = null;
    this.actionError = null;
    this.actionRetry = null;
    this.showCancelConfirm = false;
    if (!this.guardOnline()) return;
    if (!this.rescheduleDate && this.booking?.scheduledStart) {
      this.rescheduleDate = this.toLocalDate(this.booking.scheduledStart, this.booking.timezone);
    }
    this.showReschedulePanel = true;
    this.loadSlots();
  }

  loadSlots(): void {
    this.slotsError = null;
    this.selectedSlot = null;
    if (!this.guardOnline()) return;
    const providerId = this.booking?.providerId;
    const serviceId = this.booking?.serviceId ?? this.booking?.items?.[0]?.serviceId;
    if (!providerId || !serviceId || !this.rescheduleDate) {
      this.slots = [];
      this.slotsLoaded = true;
      return;
    }
    this.slotsLoading = true;
    this.bookingApi.getAvailability(providerId, serviceId, this.rescheduleDate).subscribe({
      next: (res) => {
        this.slotsLoading = false;
        this.slotsLoaded = true;
        this.slots = res?.data?.slots ?? [];
      },
      error: (err) => {
        this.slotsLoading = false;
        this.slotsLoaded = true;
        this.slotsError = interpretActionError(err).message;
      },
    });
  }

  confirmReschedule(): void {
    if (this.rescheduleLoading || !this.selectedSlot) return;
    if (!this.guardOnline()) return;
    this.rescheduleLoading = true;
    this.actionError = null;
    this.actionRetry = null;
    this.bookings.rescheduleBooking(this.bookingId, this.selectedSlot).subscribe({
      next: () => {
        this.rescheduleLoading = false;
        this.showReschedulePanel = false;
        this.selectedSlot = null;
        this.actionNotice = 'Booking rescheduled. Your booking keeps its history and payment record.';
        this.load();
      },
      error: (err) => {
        this.rescheduleLoading = false;
        const parsed = interpretActionError(err);
        this.actionError = parsed.message;
        if (parsed.kind === 'conflict') this.loadSlots();
        this.actionRetry = parsed.kind === 'server' || parsed.kind === 'offline' ? () => this.confirmReschedule() : null;
      },
    });
  }

  retryAction(): void {
    const fn = this.actionRetry;
    this.actionRetry = null;
    fn?.();
  }

  starText(rating: number): string {
    const r = Math.max(0, Math.min(5, Math.floor(Number(rating) || 0)));
    return '★'.repeat(r) + '☆'.repeat(5 - r);
  }

  /** Server-authoritative eligibility: never derived from local state. */
  maybeLoadReview(): void {
    if (!this.showReviewSection || this.reviewChecked) return;
    this.reviewChecked = true;
    if (!isOnline()) return;
    this.reviewLoading = true;
    this.bookings.getReview(this.bookingId).subscribe({
      next: (res) => {
        this.reviewLoading = false;
        if (res?.data?.hasReview && res.data.review) this.existingReview = res.data.review;
      },
      error: () => {
        // Eligibility is a hint only — the review form stays available and
        // the server enforces eligibility on submit.
        this.reviewLoading = false;
      },
    });
  }

  submitReview(): void {
    if (this.reviewSubmitting || this.existingReview) return;
    if (!isOnline()) {
      this.reviewError = interpretActionError({ status: 0 }).message;
      this.reviewRetry = null;
      return;
    }
    if (!isValidRating(this.selectedRating)) {
      this.reviewError = 'Please choose a star rating from 1 to 5.';
      this.reviewRetry = null;
      return;
    }
    this.reviewSubmitting = true;
    this.reviewError = null;
    this.reviewRetry = null;
    this.reviewNotice = null;
    this.bookings.submitReview(this.bookingId, this.selectedRating as number, this.reviewComment).subscribe({
      next: (res) => {
        this.reviewSubmitting = false;
        this.existingReview = res.data;
        this.reviewNotice = null;
        this.selectedRating = null;
        this.reviewComment = '';
      },
      error: (err) => {
        this.reviewSubmitting = false;
        const parsed = interpretActionError(err);
        this.reviewError = parsed.message;
        this.reviewRetry = parsed.kind === 'server' || parsed.kind === 'offline' ? () => this.submitReview() : null;
        if (parsed.kind === 'conflict') this.maybeRefreshReview();
      },
    });
  }

  retryReview(): void {
    const fn = this.reviewRetry;
    this.reviewRetry = null;
    this.reviewError = null;
    fn?.();
  }

  private maybeRefreshReview(): void {
    this.reviewChecked = false;
    this.existingReview = null;
    this.maybeLoadReview();
  }

  private toLocalDate(iso: string, timeZone: string): string {
    try {
      return new Intl.DateTimeFormat('en-CA', { timeZone: timeZone ?? 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
    } catch {
      return String(iso).slice(0, 10);
    }
  }
}

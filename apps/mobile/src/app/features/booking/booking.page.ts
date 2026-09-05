import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Router } from '@angular/router';
import { MarketplaceService } from '../../core/services/marketplace.service';
import { BookingService } from '../../core/services/booking.service';
import { CustomerLocationService } from '../../core/services/customer-location.service';
import { ServiceDto } from '../../core/services/marketplace.service';

@Component({
  selector: 'waasha-mobile-booking',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <div class="wa-booking">
      <a [routerLink]="['/marketplace/provider', providerId, 'service', serviceId]" class="wa-back">← Back to service</a>

      <section class="wa-card" *ngIf="loadingService" role="status">Loading service…</section>
      <div *ngIf="serviceError && !loadingService" class="wa-card wa-error" role="alert">
        <p class="wa-error__title">Couldn't load service</p>
        <p class="wa-error__msg">{{ serviceError }}</p>
        <a routerLink="/discovery" class="wa-btn wa-btn-ghost">Marketplace</a>
      </div>

      <ng-container *ngIf="!loadingService && service && !successBooking">
        <section class="wa-card wa-step" aria-label="Choose date and time">
          <h1 class="wa-title">Choose Date & Time</h1>
          <p class="wa-sub">For <strong>{{ service.name }}</strong> • R{{ service.price }} • {{ service.durationMinutes }} min</p>
          <p class="wa-provider-line" *ngIf="providerName">{{ providerName }}</p>
          <div class="wa-field">
            <label class="wa-label">Date</label>
            <input type="date" class="wa-input" [(ngModel)]="selectedDate" (change)="onDateChange()" [min]="minDate" [max]="maxDate" />
            <p class="wa-hint">Availability is server-authoritative.</p>
          </div>
          <div *ngIf="availabilityLoading" class="wa-loading" role="status">Loading availability…</div>
          <div *ngIf="availabilityError && !availabilityLoading" class="wa-error wa-error--inline" role="alert">
            <p class="wa-error__msg">{{ availabilityError }}</p>
            <button type="button" class="wa-btn wa-btn-primary wa-btn--sm" (click)="loadAvailability()">Retry</button>
          </div>
          <div *ngIf="!availabilityLoading && !availabilityError && selectedDate">
            <div *ngIf="slots.length === 0" class="wa-empty" role="status">
              <p class="wa-empty__title">No availability</p>
              <p class="wa-empty__sub">No slots for this date. Try another date.</p>
            </div>
            <div *ngIf="slots.length > 0" class="wa-slots" role="group" aria-label="Available time slots">
              <button *ngFor="let sl of slots; trackBy: trackSlot" type="button" class="wa-slot" [class.active]="selectedSlot?.start === sl.start" (click)="selectSlot(sl)">{{ sl.displayStart }}</button>
            </div>
            <p class="wa-slots-note" *ngIf="slots.length > 0">Duration {{ service.durationMinutes }} min • Africa/Johannesburg</p>
          </div>
        </section>

        <section class="wa-card wa-step" *ngIf="selectedSlot" aria-label="Confirm location">
          <h2 class="wa-step__title">Confirm service location</h2>
          <p class="wa-step__sub">Location will be snapshotted for this booking.</p>
          <div class="wa-field" *ngIf="service.serviceMode === 'BOTH'">
            <label class="wa-label">Service location</label>
            <div class="wa-radio-group">
              <label class="wa-radio"><input type="radio" name="locType" value="PROVIDER" [(ngModel)]="serviceLocationType" /> At provider</label>
              <label class="wa-radio"><input type="radio" name="locType" value="CUSTOMER" [(ngModel)]="serviceLocationType" /> Customer location</label>
            </div>
          </div>
          <div class="wa-location-fields">
            <div class="wa-field"><label class="wa-label">Address line 1</label><input class="wa-input" [(ngModel)]="locForm.addressLine1" placeholder="12 Main Rd" /></div>
            <div class="wa-grid2">
              <div class="wa-field"><label class="wa-label">City</label><input class="wa-input" [(ngModel)]="locForm.city" placeholder="Johannesburg" /></div>
              <div class="wa-field"><label class="wa-label">Province</label><input class="wa-input" [(ngModel)]="locForm.province" placeholder="Gauteng" /></div>
            </div>
            <div class="wa-grid2">
              <div class="wa-field"><label class="wa-label">Postal code</label><input class="wa-input" [(ngModel)]="locForm.postalCode" placeholder="2196" /></div>
              <div class="wa-field"><label class="wa-label">Country</label><input class="wa-input" [(ngModel)]="locForm.country" placeholder="ZA" /></div>
            </div>
            <div class="wa-grid2">
              <div class="wa-field"><label class="wa-label">Latitude *</label><input class="wa-input" type="number" step="0.000001" [(ngModel)]="locForm.latitude" /></div>
              <div class="wa-field"><label class="wa-label">Longitude *</label><input class="wa-input" type="number" step="0.000001" [(ngModel)]="locForm.longitude" /></div>
            </div>
            <button type="button" class="wa-btn wa-btn-ghost wa-btn--sm" (click)="useCurrentLocation()">Use my current location</button>
          </div>
        </section>

        <section class="wa-card wa-step wa-summary" *ngIf="selectedSlot" aria-label="Booking confirmation">
          <h2 class="wa-step__title">Review booking details</h2>
          <dl class="wa-summary__list">
            <div class="wa-summary__row"><dt>Provider</dt><dd>{{ providerName || providerId }}</dd></div>
            <div class="wa-summary__row"><dt>Service</dt><dd>{{ service.name }}</dd></div>
            <div class="wa-summary__row"><dt>Price</dt><dd>R{{ service.price }} {{ service.currency }}</dd></div>
            <div class="wa-summary__row"><dt>Duration</dt><dd>{{ service.durationMinutes }} min</dd></div>
            <div class="wa-summary__row"><dt>Date</dt><dd>{{ selectedDate }}</dd></div>
            <div class="wa-summary__row"><dt>Time</dt><dd>{{ selectedSlot.displayStart }} — {{ selectedSlot.displayEnd }}</dd></div>
            <div class="wa-summary__row"><dt>Service location</dt><dd>{{ serviceLocationType === 'CUSTOMER' ? 'Customer location' : 'Provider location' }}</dd></div>
            <div class="wa-summary__row wa-summary__row--muted"><dt>Payment</dt><dd>Pending — not processed</dd></div>
          </dl>
          <p class="wa-summary__note">Status will be <strong>PENDING</strong> — not COMPLETED until service delivered.</p>
          <div *ngIf="createError" class="wa-error wa-error--inline" role="alert">
            <p class="wa-error__title">{{ createErrorTitle }}</p>
            <p class="wa-error__msg">{{ createErrorMsg }}</p>
          </div>
          <div *ngIf="createConflict" class="wa-error wa-error--inline" role="alert">
            <p class="wa-error__msg">Booking conflict — slot just taken. Choose another time.</p>
          </div>
          <div *ngIf="unauthorizedError" class="wa-error wa-error--inline" role="alert">
            <p class="wa-error__msg">Please log in. <a routerLink="/auth/login">Log in</a></p>
          </div>
          <button type="button" class="wa-btn wa-btn-primary wa-btn--block" [disabled]="creating || !canCreate" (click)="confirmBooking()">{{ creating ? 'Creating…' : 'Confirm booking' }}</button>
          <p class="wa-hint" style="text-align:center">Secure, server-authoritative booking.</p>
        </section>
      </ng-container>

      <section *ngIf="successBooking" class="wa-card wa-success" role="status">
        <h2 class="wa-success__title">Booking created</h2>
        <p class="wa-success__sub">Status: <strong>{{ successBooking.status }}</strong> — pending provider acceptance.</p>
        <dl class="wa-summary__list">
          <div class="wa-summary__row"><dt>Booking ID</dt><dd class="wa-mono">{{ successBooking.id }}</dd></div>
          <div class="wa-summary__row"><dt>Service</dt><dd>{{ successBooking.items?.[0]?.serviceNameSnapshot || service?.name }}</dd></div>
          <div class="wa-summary__row"><dt>Price snapshot</dt><dd>R{{ successBooking.items?.[0]?.unitPrice ?? service?.price }} {{ successBooking.currency }}</dd></div>
          <div class="wa-summary__row"><dt>Duration</dt><dd>{{ successBooking.items?.[0]?.durationMinutes ?? service?.durationMinutes }} min</dd></div>
          <div class="wa-summary__row"><dt>Scheduled</dt><dd>{{ successBooking.scheduledStart | date:'medium' }}</dd></div>
        </dl>
        <div class="wa-success__actions">
          <a routerLink="/discovery" class="wa-btn wa-btn-ghost">Back to marketplace</a>
          <a [routerLink]="['/marketplace/provider', providerId]" class="wa-btn wa-btn-primary">View provider</a>
        </div>
      </section>
    </div>
  `,
  styles: [`
    .wa-booking { display:flex; flex-direction:column; gap:14px; padding:12px 16px 24px; max-width:560px; margin:0 auto; }
    .wa-back { font-size:13px; font-weight:700; color:#0B1F33; text-decoration:none; }
    .wa-card { background:white; border:1px solid #E2E8F0; border-radius:16px; padding:16px; box-shadow:0 1px 2px rgba(16,24,40,0.04); }
    .wa-title { margin:0; font-size:18px; font-weight:800; color:#0B1F33; }
    .wa-sub { margin:6px 0 0; font-size:12px; color:#667085; line-height:1.5; }
    .wa-provider-line { margin:4px 0 0; font-size:12px; color:#667085; }
    .wa-step { display:flex; flex-direction:column; gap:12px; }
    .wa-step__title { margin:0; font-size:15px; font-weight:800; color:#0B1F33; }
    .wa-step__sub { margin:0; font-size:11px; color:#667085; line-height:1.5; }
    .wa-field { display:flex; flex-direction:column; gap:6px; }
    .wa-label { font-size:10px; font-weight:700; letter-spacing:0.06em; text-transform:uppercase; color:#667085; }
    .wa-input { padding:10px 12px; border-radius:12px; border:1px solid #E2E8F0; font-size:13px; background:white; }
    .wa-hint { margin:0; font-size:10px; color:#667085; }
    .wa-loading { font-size:12px; color:#667085; }
    .wa-error { background:#FEF2F2; border-color:#FECACA; }
    .wa-error--inline { padding:12px; border-radius:12px; border:1px solid #FECACA; }
    .wa-error__title { margin:0; font-weight:800; color:#991B1B; font-size:12px; }
    .wa-error__msg { margin:4px 0 0; font-size:12px; color:#991B1B; }
    .wa-empty { text-align:center; padding:16px; background:#F6F8FA; border:1px dashed #E2E8F0; border-radius:12px; }
    .wa-empty__title { margin:0; font-weight:800; color:#0B1F33; font-size:12px; }
    .wa-empty__sub { margin:6px 0 0; font-size:11px; color:#667085; }
    .wa-slots { display:grid; grid-template-columns:repeat(auto-fill,minmax(78px,1fr)); gap:8px; margin-top:8px; }
    .wa-slot { padding:10px 6px; border-radius:12px; border:1px solid #E2E8F0; background:white; font-weight:700; font-size:12px; color:#0B1F33; }
    .wa-slot.active { background:#0B1F33; color:white; border-color:#0B1F33; }
    .wa-slots-note { margin:8px 0 0; font-size:10px; color:#667085; }
    .wa-radio-group { display:flex; flex-direction:column; gap:6px; }
    .wa-radio { font-size:12px; color:#334155; display:flex; gap:8px; align-items:center; }
    .wa-location-fields { display:flex; flex-direction:column; gap:10px; }
    .wa-grid2 { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
    .wa-summary__list { margin:0; display:flex; flex-direction:column; gap:8px; }
    .wa-summary__row { display:flex; justify-content:space-between; gap:12px; font-size:12px; }
    .wa-summary__row dt { font-weight:700; color:#667085; font-size:11px; }
    .wa-summary__row dd { margin:0; font-weight:600; color:#0B1F33; text-align:right; }
    .wa-summary__row--muted dd { color:#667085; }
    .wa-summary__note { margin:8px 0 0; font-size:10px; color:#667085; text-align:center; }
    .wa-btn { display:inline-flex; align-items:center; justify-content:center; padding:10px 14px; border-radius:12px; border:0; font-weight:700; font-size:12px; cursor:pointer; text-decoration:none; }
    .wa-btn-primary { background:#0B1F33; color:white; width:100%; }
    .wa-btn-ghost { background:#F6F8FA; color:#0B1F33; border:1px solid #E2E8F0; width:100%; }
    .wa-btn--sm { padding:7px 12px; font-size:11px; border-radius:10px; width:auto; }
    .wa-btn--block { width:100%; padding:12px; border-radius:12px; }
    .wa-success { border-color:#A7F3D0; background:#ECFDF5; text-align:center; }
    .wa-success__title { margin:0; font-size:16px; font-weight:800; color:#065F46; }
    .wa-success__sub { margin:6px 0 12px; font-size:12px; color:#065F46; }
    .wa-mono { font-family:monospace; font-size:11px; word-break:break-all; }
    .wa-success__actions { display:flex; gap:8px; justify-content:center; margin-top:14px; flex-wrap:wrap; }
  `]
})
export class MobileBookingPage implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly marketplace = inject(MarketplaceService);
  private readonly bookingService = inject(BookingService);
  private readonly locationService = inject(CustomerLocationService);

  providerId = '';
  serviceId = '';
  service: ServiceDto | null = null;
  providerName: string | null = null;
  loadingService = true;
  serviceError: string | null = null;

  selectedDate = '';
  minDate = '';
  maxDate = '';
  slots: Array<{ start: string; end: string; displayStart: string; displayEnd: string }> = [];
  availabilityLoading = false;
  availabilityError: string | null = null;
  selectedSlot: { start: string; end: string; displayStart: string; displayEnd: string } | null = null;

  serviceLocationType: 'PROVIDER' | 'CUSTOMER' = 'PROVIDER';
  locForm: { addressLine1: string | null; city: string | null; province: string | null; postalCode: string | null; country: string | null; latitude: number | null; longitude: number | null } = {
    addressLine1: '', city: '', province: '', postalCode: '', country: 'ZA', latitude: null, longitude: null,
  };

  creating = false;
  createError = false;
  createErrorTitle = '';
  createErrorMsg = '';
  createConflict = false;
  unauthorizedError = false;
  successBooking: any = null;

  get canCreate(): boolean {
    if (!this.selectedSlot) return false;
    if (this.locForm.latitude == null || this.locForm.longitude == null) return false;
    return Number.isFinite(Number(this.locForm.latitude)) && Number.isFinite(Number(this.locForm.longitude));
  }

  ngOnInit(): void {
    this.providerId = this.route.snapshot.paramMap.get('providerId') ?? '';
    this.serviceId = this.route.snapshot.paramMap.get('serviceId') ?? '';
    const now = new Date();
    this.minDate = now.toISOString().slice(0, 10);
    const max = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);
    this.maxDate = max.toISOString().slice(0, 10);
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    this.selectedDate = tomorrow.toISOString().slice(0, 10);
    const snap = this.locationService.snapshot;
    this.locForm.latitude = snap.latitude;
    this.locForm.longitude = snap.longitude;
    this.loadService();
  }

  onDateChange(): void { this.selectedSlot = null; this.loadAvailability(); }
  loadAvailability(): void {
    if (!this.selectedDate) return;
    this.availabilityLoading = true; this.availabilityError = null; this.slots = [];
    this.bookingService.getAvailability(this.providerId, this.serviceId, this.selectedDate).subscribe({
      next: (res) => { this.availabilityLoading = false; this.slots = res.data.slots ?? []; },
      error: (err) => {
        this.availabilityLoading = false;
        const status = err?.status; const msg = err?.error?.error?.message ?? err?.message ?? '';
        if (msg.toLowerCase().includes('not found') || status === 404) this.availabilityError = 'Provider or service not found.';
        else if (status === 422) this.availabilityError = msg || 'Invalid date.';
        else this.availabilityError = 'Failed to load availability.';
      },
    });
  }
  selectSlot(slot: any): void { this.selectedSlot = slot; this.createError = false; this.createConflict = false; this.unauthorizedError = false; }
  trackSlot(_: number, s: { start: string }): string { return s.start; }
  useCurrentLocation(): void {
    this.locationService.tryUseBrowserGeolocation().then((loc) => { this.locForm.latitude = loc.latitude; this.locForm.longitude = loc.longitude; }).catch(() => {});
  }
  confirmBooking(): void {
    if (!this.selectedSlot || !this.canCreate) return;
    this.creating = true; this.createError = false; this.createConflict = false; this.unauthorizedError = false;
    const payload: any = {
      providerId: this.providerId,
      serviceId: this.serviceId,
      scheduledStart: this.selectedSlot.start,
      customerLocation: {
        addressLine1: this.locForm.addressLine1 || null,
        city: this.locForm.city || null,
        province: this.locForm.province || null,
        postalCode: this.locForm.postalCode || null,
        country: this.locForm.country || 'ZA',
        latitude: Number(this.locForm.latitude),
        longitude: Number(this.locForm.longitude),
      },
    };
    if (this.service?.serviceMode === 'BOTH') payload.serviceLocationType = this.serviceLocationType;
    this.bookingService.createBooking(payload).subscribe({
      next: (res) => { this.creating = false; this.successBooking = res.data; window.scrollTo({ top: 0, behavior: 'smooth' }); },
      error: (err) => {
        this.creating = false;
        const status = err?.status; const code = err?.error?.error?.code ?? ''; const msg = err?.error?.error?.message ?? err?.message ?? 'Failed';
        if (status === 401) { this.unauthorizedError = true; this.createError = true; this.createErrorTitle = 'Authentication required'; this.createErrorMsg = 'Please log in.'; }
        else if (status === 409 || code === 'BOOKING_CONFLICT' || code === 'SLOT_UNAVAILABLE') { this.createConflict = true; this.createError = true; this.createErrorTitle = 'Time unavailable'; this.createErrorMsg = msg; this.loadAvailability(); }
        else if (status === 422) { this.createError = true; this.createErrorTitle = 'Invalid details'; this.createErrorMsg = msg; }
        else if (status === 403) { this.createError = true; this.createErrorTitle = 'Not allowed'; this.createErrorMsg = msg; }
        else { this.createError = true; this.createErrorTitle = "Couldn't create booking"; this.createErrorMsg = msg; }
      },
    });
  }
  private loadService(): void {
    this.loadingService = true; this.serviceError = null;
    this.marketplace.fetchServiceDetail(this.providerId, this.serviceId).subscribe({
      next: (res) => {
        this.loadingService = false; this.service = res.data;
        if (this.service.serviceMode === 'CUSTOMER_LOCATION') this.serviceLocationType = 'CUSTOMER'; else this.serviceLocationType = 'PROVIDER';
        this.marketplace.fetchProviderProfile(this.providerId).subscribe({ next: (r: any) => this.providerName = r.data.displayName, error: () => {} });
        this.loadAvailability();
      },
      error: (err) => { this.loadingService = false; const status = err?.status; const msg = err?.error?.error?.message ?? err?.message ?? ''; if (status === 404) this.serviceError = 'Service not found.'; else this.serviceError = msg || 'Failed to load service.'; },
    });
  }
}

import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MarketplaceService } from '../../core/services/marketplace.service';
import { BookingService } from '../../core/services/booking.service';
import { CustomerLocationService } from '../../core/services/customer-location.service';
import { ServiceDto, ProviderProfileDto } from '../../core/models/discovery-radius.model';

@Component({
  selector: 'waasha-booking',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <div class="wa-booking">
      <a [routerLink]="['/marketplace/provider', providerId, 'service', serviceId]" class="wa-back">← Back to service</a>

      <section class="wa-card" *ngIf="loadingService" role="status">Loading service…</section>

      <div *ngIf="serviceError && !loadingService" class="wa-card wa-error" role="alert">
        <p class="wa-error__title">Couldn't load service</p>
        <p class="wa-error__msg">{{ serviceError }}</p>
        <a [routerLink]="['/marketplace']" class="wa-btn wa-btn-ghost">Marketplace</a>
      </div>

      <ng-container *ngIf="!loadingService && service && !successBooking">
        <!-- Step 1: date & slots -->
        <section class="wa-card wa-step" aria-label="Choose date and time">
          <h1 class="wa-title">Choose Date & Time</h1>
          <p class="wa-sub">For <strong>{{ service.name }}</strong> • R{{ service.price }} • {{ service.durationMinutes }} min • {{ serviceModeLabel }}</p>
          <p class="wa-provider-line" *ngIf="providerName">{{ providerName }} <span *ngIf="providerCity">• {{ providerCity }}</span></p>

          <div class="wa-field">
            <label for="wa-date" class="wa-label">Date</label>
            <input id="wa-date" type="date" class="wa-input" [(ngModel)]="selectedDate" (change)="onDateChange()" [min]="minDate" [max]="maxDate" aria-label="Select booking date" />
            <p class="wa-hint">Availability is server-authoritative and respects provider calendar.</p>
          </div>

          <div *ngIf="availabilityLoading" class="wa-loading" role="status">Loading availability…</div>

          <div *ngIf="availabilityError && !availabilityLoading" class="wa-error wa-error--inline" role="alert">
            <p class="wa-error__msg">{{ availabilityError }}</p>
            <button type="button" class="wa-btn wa-btn-primary wa-btn--navy wa-btn--sm" (click)="loadAvailability()">Retry</button>
          </div>

          <div *ngIf="!availabilityLoading && !availabilityError && selectedDate">
            <div *ngIf="slots.length === 0" class="wa-empty" role="status">
              <p class="wa-empty__title">No availability</p>
              <p class="wa-empty__sub">No slots available for this date. Try another date.</p>
            </div>

            <div *ngIf="slots.length > 0" class="wa-slots" role="group" aria-label="Available time slots">
              <button
                *ngFor="let sl of slots; trackBy: trackSlot"
                type="button"
                class="wa-slot"
                [class.active]="selectedSlot?.start === sl.start"
                (click)="selectSlot(sl)"
                [attr.aria-pressed]="selectedSlot?.start === sl.start"
                [attr.aria-label]="'Select ' + sl.displayStart + ' to ' + sl.displayEnd"
              >
                {{ sl.displayStart }}
              </button>
            </div>
            <p class="wa-slots-note" *ngIf="slots.length > 0">Duration {{ service.durationMinutes }} min • Timezone Africa/Johannesburg</p>
          </div>
        </section>

        <!-- Location confirmation -->
        <section class="wa-card wa-step" *ngIf="selectedSlot" aria-label="Confirm location">
          <h2 class="wa-step__title">Confirm service location</h2>
          <p class="wa-step__sub">Booking location will be snapshotted — later changes to saved location won't affect this booking.</p>

          <div class="wa-field" *ngIf="service.serviceMode === 'BOTH'">
            <label class="wa-label">Service location</label>
            <div class="wa-radio-group" role="radiogroup" aria-label="Service location type">
              <label class="wa-radio"><input type="radio" name="locType" value="PROVIDER" [(ngModel)]="serviceLocationType" /> At provider</label>
              <label class="wa-radio"><input type="radio" name="locType" value="CUSTOMER" [(ngModel)]="serviceLocationType" /> Customer location (home visit)</label>
            </div>
          </div>
          <p class="wa-hint" *ngIf="service.serviceMode !== 'BOTH'">Service mode: {{ serviceModeLabel }}</p>

          <div class="wa-location-fields">
            <div class="wa-field">
              <label for="wa-addr1" class="wa-label">Address line 1</label>
              <input id="wa-addr1" class="wa-input" [(ngModel)]="customerLocation.addressLine1" placeholder="e.g. 12 Main Rd" />
            </div>
            <div class="wa-grid2">
              <div class="wa-field"><label class="wa-label">City</label><input class="wa-input" [(ngModel)]="customerLocation.city" placeholder="Johannesburg" /></div>
              <div class="wa-field"><label class="wa-label">Province</label><input class="wa-input" [(ngModel)]="customerLocation.province" placeholder="Gauteng" /></div>
            </div>
            <div class="wa-grid2">
              <div class="wa-field"><label class="wa-label">Postal code</label><input class="wa-input" [(ngModel)]="customerLocation.postalCode" placeholder="2196" /></div>
              <div class="wa-field"><label class="wa-label">Country</label><input class="wa-input" [(ngModel)]="customerLocation.country" placeholder="ZA" /></div>
            </div>
            <div class="wa-grid2">
              <div class="wa-field"><label class="wa-label">Latitude *</label><input class="wa-input" type="number" step="0.000001" [(ngModel)]="customerLocation.latitude" /></div>
              <div class="wa-field"><label class="wa-label">Longitude *</label><input class="wa-input" type="number" step="0.000001" [(ngModel)]="customerLocation.longitude" /></div>
            </div>
            <p class="wa-hint">Confirm before booking — location accuracy is server-validated. Precise coords are not exposed publicly beyond participants.</p>
            <button type="button" class="wa-btn wa-btn-ghost wa-btn--sm" (click)="useCurrentLocation()" aria-label="Use current location">Use my current location</button>
          </div>
        </section>

        <!-- Confirmation summary -->
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
            <div class="wa-summary__row"><dt>Location snapshot</dt><dd>{{ locationSnapshotLabel }}</dd></div>
            <div class="wa-summary__row wa-summary__row--muted"><dt>Payment</dt><dd>Pending — payment not processed in this slice</dd></div>
          </dl>
          <p class="wa-summary__note">Booking status will be <strong>PENDING</strong> — not COMPLETED until service is delivered.</p>

          <div *ngIf="createError" class="wa-error wa-error--inline" role="alert">
            <p class="wa-error__title">{{ createErrorTitle }}</p>
            <p class="wa-error__msg">{{ createErrorMsg }}</p>
          </div>
          <div *ngIf="createConflict" class="wa-error wa-error--inline wa-error--conflict" role="alert">
            <p class="wa-error__msg">Booking conflict — that slot was just taken. Please choose another time.</p>
          </div>
          <div *ngIf="unauthorizedError" class="wa-error wa-error--inline" role="alert">
            <p class="wa-error__msg">Please log in to create a booking. <a routerLink="/auth/login">Log in</a></p>
          </div>

          <button
            type="button"
            class="wa-btn wa-btn-primary wa-btn--navy wa-btn--block"
            [disabled]="creating || !canCreate"
            (click)="confirmBooking()"
            aria-label="Confirm booking"
          >
            {{ creating ? 'Creating…' : 'Confirm booking' }}
          </button>
          <p class="wa-creating__hint" *ngIf="creating" role="status">Creating booking…</p>
          <p class="wa-hint">Secure, server-authoritative booking. No payment processed yet.</p>
        </section>
      </ng-container>

      <!-- Success -->
      <section *ngIf="successBooking" class="wa-card wa-success" role="status" aria-label="Booking created">
        <h2 class="wa-success__title">Booking created</h2>
        <p class="wa-success__sub">Your booking is confirmed pending provider acceptance. Status: <strong>{{ successBooking.status }}</strong></p>
        <dl class="wa-summary__list">
          <div class="wa-summary__row"><dt>Booking ID</dt><dd class="wa-mono">{{ successBooking.id }}</dd></div>
          <div class="wa-summary__row"><dt>Provider</dt><dd>{{ providerName || successBooking.providerId }}</dd></div>
          <div class="wa-summary__row"><dt>Service</dt><dd>{{ successBooking.items?.[0]?.serviceNameSnapshot || service?.name }}</dd></div>
          <div class="wa-summary__row"><dt>Price snapshot</dt><dd>R{{ successBooking.items?.[0]?.unitPrice ?? service?.price }} {{ successBooking.currency }}</dd></div>
          <div class="wa-summary__row"><dt>Duration snapshot</dt><dd>{{ successBooking.items?.[0]?.durationMinutes ?? service?.durationMinutes }} min</dd></div>
          <div class="wa-summary__row"><dt>Scheduled</dt><dd>{{ successBooking.scheduledStart | date:'medium' }}</dd></div>
          <div class="wa-summary__row"><dt>Location</dt><dd>{{ successLocationLabel }}</dd></div>
        </dl>
        <div class="wa-success__actions">
          <a routerLink="/marketplace" class="wa-btn wa-btn-ghost">Back to marketplace</a>
          <a [routerLink]="['/marketplace/provider', providerId]" class="wa-btn wa-btn-primary wa-btn--navy">View provider</a>
        </div>
      </section>
    </div>
  `,
  styles: [`
    .wa-booking { display:flex; flex-direction:column; gap:16px; max-width:860px; margin:0 auto; }
    .wa-back { display:inline-flex; gap:6px; font-size:13px; font-weight:700; color:var(--waasha-navy); text-decoration:none; }
    .wa-card { background:white; border:1px solid var(--waasha-border); border-radius:var(--waasha-radius); padding:20px; box-shadow:0 1px 2px rgba(11,31,51,0.04); }
    .wa-title { margin:0; font-size:20px; font-weight:800; color:var(--waasha-navy); }
    .wa-sub { margin:6px 0 0; font-size:13px; color:var(--waasha-muted); line-height:1.5; }
    .wa-provider-line { margin:4px 0 0; font-size:12px; color:var(--waasha-muted); }
    .wa-step { display:flex; flex-direction:column; gap:14px; }
    .wa-step__title { margin:0; font-size:16px; font-weight:800; color:var(--waasha-navy); }
    .wa-step__sub { margin:0; font-size:12px; color:var(--waasha-muted); line-height:1.5; }
    .wa-field { display:flex; flex-direction:column; gap:6px; }
    .wa-label { font-size:11px; font-weight:700; letter-spacing:0.06em; text-transform:uppercase; color:var(--waasha-muted); }
    .wa-input { padding:10px 12px; border-radius:12px; border:1px solid var(--waasha-border); font-size:13px; background:white; }
    .wa-hint { margin:0; font-size:11px; color:var(--waasha-muted); }
    .wa-loading { font-size:13px; color:var(--waasha-muted); }
    .wa-error { background:#FEF2F2; border-color:#FECACA; }
    .wa-error--inline { padding:12px; border-radius:12px; border:1px solid #FECACA; }
    .wa-error__title { margin:0; font-weight:800; color:#991B1B; font-size:13px; }
    .wa-error__msg { margin:4px 0 0; font-size:12px; color:#991B1B; }
    .wa-empty { text-align:center; padding:18px; background:var(--waasha-bg); border:1px dashed var(--waasha-border); border-radius:12px; }
    .wa-empty__title { margin:0; font-weight:800; color:var(--waasha-navy); font-size:13px; }
    .wa-empty__sub { margin:6px 0 0; font-size:12px; color:var(--waasha-muted); }
    .wa-slots { display:grid; grid-template-columns:repeat(auto-fill,minmax(92px,1fr)); gap:8px; margin-top:8px; }
    .wa-slot { padding:10px; border-radius:12px; border:1px solid var(--waasha-border); background:white; font-weight:700; font-size:13px; color:var(--waasha-navy); cursor:pointer; }
    .wa-slot:hover { border-color:var(--waasha-teal); }
    .wa-slot.active { background:var(--waasha-navy); color:white; border-color:var(--waasha-navy); }
    .wa-slots-note { margin:8px 0 0; font-size:11px; color:var(--waasha-muted); }
    .wa-radio-group { display:flex; flex-direction:column; gap:6px; }
    .wa-radio { font-size:13px; color:var(--waasha-text); display:flex; gap:8px; align-items:center; }
    .wa-location-fields { display:flex; flex-direction:column; gap:10px; }
    .wa-grid2 { display:grid; grid-template-columns:1fr 1fr; gap:10px; }
    @media (max-width:640px){ .wa-grid2{ grid-template-columns:1fr; } }
    .wa-summary__list { margin:0; display:flex; flex-direction:column; gap:8px; }
    .wa-summary__row { display:flex; justify-content:space-between; gap:12px; font-size:13px; }
    .wa-summary__row dt { font-weight:700; color:var(--waasha-muted); font-size:12px; }
    .wa-summary__row dd { margin:0; font-weight:600; color:var(--waasha-navy); text-align:right; }
    .wa-summary__row--muted dd { color:var(--waasha-muted); }
    .wa-summary__note { margin:8px 0 0; font-size:11px; color:var(--waasha-muted); text-align:center; }
    .wa-btn--navy { background:var(--waasha-navy); color:white; border:1px solid var(--waasha-navy); }
    .wa-btn--block { width:100%; padding:12px; border-radius:12px; font-weight:700; }
    .wa-btn-ghost { background:#F6F8FA; color:var(--waasha-navy); border:1px solid var(--waasha-border); padding:9px 14px; border-radius:12px; font-weight:700; text-decoration:none; display:inline-flex; justify-content:center; align-items:center; }
    .wa-btn--sm { padding:7px 12px; font-size:12px; border-radius:10px; }
    .wa-creating__hint { margin:6px 0 0; text-align:center; font-size:12px; color:var(--waasha-muted); }
    .wa-success { border-color:#A7F3D0; background:#ECFDF5; text-align:center; }
    .wa-success__title { margin:0; font-size:18px; font-weight:800; color:#065F46; }
    .wa-success__sub { margin:6px 0 12px; font-size:13px; color:#065F46; }
    .wa-mono { font-family:monospace; font-size:12px; word-break:break-all; }
    .wa-success__actions { display:flex; gap:8px; justify-content:center; margin-top:14px; flex-wrap:wrap; }
    @media (prefers-reduced-motion: reduce) { * { animation:none !important; transition:none !important; } }
  `]
})
export class BookingComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly marketplace = inject(MarketplaceService);
  private readonly bookingService = inject(BookingService);
  private readonly locationService = inject(CustomerLocationService);

  providerId = '';
  serviceId = '';
  service: ServiceDto | null = null;
  providerName: string | null = null;
  providerCity: string | null = null;
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
  customerLocation: { addressLine1: string | null; city: string | null; province: string | null; postalCode: string | null; country: string | null; latitude: number | null; longitude: number | null } = {
    addressLine1: '',
    city: '',
    province: '',
    postalCode: '',
    country: 'ZA',
    latitude: null,
    longitude: null,
  };

  creating = false;
  createError = false;
  createErrorTitle = '';
  createErrorMsg = '';
  createConflict = false;
  unauthorizedError = false;
  successBooking: any = null;

  get serviceModeLabel(): string {
    if (!this.service) return '';
    if (this.service.serviceMode === 'PROVIDER_LOCATION') return 'At provider';
    if (this.service.serviceMode === 'CUSTOMER_LOCATION') return 'Home visit';
    return 'Provider or home';
  }

  get locationSnapshotLabel(): string {
    const loc = this.customerLocation;
    const parts = [loc.addressLine1, loc.city, loc.province].filter(Boolean);
    return parts.length ? parts.join(', ') : `${loc.latitude ?? ''}, ${loc.longitude ?? ''}`;
  }

  get successLocationLabel(): string {
    const loc = this.successBooking?.location;
    if (!loc) return '—';
    const parts = [loc.addressLine1, loc.city, loc.province].filter(Boolean);
    return parts.length ? parts.join(', ') : `${loc.latitude}, ${loc.longitude}`;
  }

  get canCreate(): boolean {
    if (!this.selectedSlot) return false;
    if (this.customerLocation.latitude == null || this.customerLocation.longitude == null) return false;
    const lat = Number(this.customerLocation.latitude);
    const lng = Number(this.customerLocation.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
    return true;
  }

  ngOnInit(): void {
    this.providerId = this.route.snapshot.paramMap.get('providerId') ?? '';
    this.serviceId = this.route.snapshot.paramMap.get('serviceId') ?? '';
    const now = new Date();
    this.minDate = now.toISOString().slice(0, 10);
    const max = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);
    this.maxDate = max.toISOString().slice(0, 10);
    // default date = tomorrow
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    this.selectedDate = tomorrow.toISOString().slice(0, 10);

    // preload location from storage
    const snap = this.locationService.snapshot;
    this.customerLocation.latitude = snap.latitude;
    this.customerLocation.longitude = snap.longitude;

    this.loadService();
  }

  onDateChange(): void {
    this.selectedSlot = null;
    this.loadAvailability();
  }

  loadAvailability(): void {
    if (!this.selectedDate) return;
    this.availabilityLoading = true;
    this.availabilityError = null;
    this.slots = [];
    this.createConflict = false;
    this.bookingService.getAvailability(this.providerId, this.serviceId, this.selectedDate).subscribe({
      next: (res) => {
        this.availabilityLoading = false;
        this.slots = res.data.slots ?? [];
      },
      error: (err) => {
        this.availabilityLoading = false;
        const status = err?.status;
        const msg = err?.error?.error?.message ?? err?.message ?? '';
        if (msg.toLowerCase().includes('not found') || status === 404) {
          this.availabilityError = 'Provider or service not found.';
        } else if (status === 422) {
          this.availabilityError = msg || 'Invalid date. Please choose another date.';
        } else {
          this.availabilityError = 'Failed to load availability. Please try again.';
        }
      },
    });
  }

  selectSlot(slot: { start: string; end: string; displayStart: string; displayEnd: string }): void {
    this.selectedSlot = slot;
    this.createError = false;
    this.createConflict = false;
    this.unauthorizedError = false;
  }

  trackSlot(_: number, s: { start: string }): string { return s.start; }

  useCurrentLocation(): void {
    this.locationService.tryUseBrowserGeolocation().then((loc) => {
      this.customerLocation.latitude = loc.latitude;
      this.customerLocation.longitude = loc.longitude;
    }).catch(() => {});
  }

  confirmBooking(): void {
    if (!this.selectedSlot || !this.canCreate) return;
    this.creating = true;
    this.createError = false;
    this.createConflict = false;
    this.unauthorizedError = false;

    const payload: any = {
      providerId: this.providerId,
      serviceId: this.serviceId,
      scheduledStart: this.selectedSlot.start,
      customerLocation: {
        addressLine1: this.customerLocation.addressLine1 || null,
        city: this.customerLocation.city || null,
        province: this.customerLocation.province || null,
        postalCode: this.customerLocation.postalCode || null,
        country: this.customerLocation.country || 'ZA',
        latitude: Number(this.customerLocation.latitude),
        longitude: Number(this.customerLocation.longitude),
      },
    };
    if (this.service?.serviceMode === 'BOTH') {
      payload.serviceLocationType = this.serviceLocationType;
    }

    this.bookingService.createBooking(payload).subscribe({
      next: (res) => {
        this.creating = false;
        this.successBooking = res.data;
        window.scrollTo({ top: 0, behavior: 'smooth' });
      },
      error: (err) => {
        this.creating = false;
        const status = err?.status;
        const code = err?.error?.error?.code ?? '';
        const msg = err?.error?.error?.message ?? err?.message ?? 'Failed to create booking';
        if (status === 401) {
          this.unauthorizedError = true;
          this.createError = true;
          this.createErrorTitle = 'Authentication required';
          this.createErrorMsg = 'Please log in to create a booking.';
        } else if (status === 409 || code === 'BOOKING_CONFLICT' || code === 'SLOT_UNAVAILABLE') {
          this.createConflict = true;
          this.createError = true;
          this.createErrorTitle = 'Time unavailable';
          this.createErrorMsg = msg;
          this.loadAvailability();
        } else if (status === 422) {
          this.createError = true;
          this.createErrorTitle = 'Invalid booking details';
          this.createErrorMsg = msg;
        } else if (status === 403) {
          this.createError = true;
          this.createErrorTitle = 'Not allowed';
          this.createErrorMsg = msg;
        } else if (msg.includes('SQL') || msg.includes('prisma')) {
          this.createError = true;
          this.createErrorTitle = 'Something went wrong';
          this.createErrorMsg = 'Please try again.';
        } else {
          this.createError = true;
          this.createErrorTitle = 'Couldn\'t create booking';
          this.createErrorMsg = msg;
        }
      },
    });
  }

  private loadService(): void {
    this.loadingService = true;
    this.serviceError = null;
    this.marketplace.fetchServiceDetail(this.providerId, this.serviceId).subscribe({
      next: (res) => {
        this.loadingService = false;
        this.service = res.data;
        if (this.service.serviceMode === 'CUSTOMER_LOCATION') this.serviceLocationType = 'CUSTOMER';
        else this.serviceLocationType = 'PROVIDER';
        // fetch provider name
        this.marketplace.fetchProviderProfile(this.providerId).subscribe({
          next: (r: any) => {
            this.providerName = r.data.displayName;
            this.providerCity = r.data.location?.city ?? null;
          },
          error: () => {},
        });
        this.loadAvailability();
      },
      error: (err) => {
        this.loadingService = false;
        const status = err?.status;
        const msg = err?.error?.error?.message ?? err?.message ?? '';
        if (status === 404) this.serviceError = 'Service not found.';
        else this.serviceError = msg || 'Failed to load service.';
      },
    });
  }


}

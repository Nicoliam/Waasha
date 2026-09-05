import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { MarketplaceService } from '../../core/services/marketplace.service';
import { CustomerLocationService } from '../../core/services/customer-location.service';
import { DiscoveryService } from '../../core/services/discovery.service';
import { ProviderProfileDto, ServiceCategory, ServiceDto } from '../../core/models/discovery-radius.model';
import { ServiceCardComponent } from '../../shared/components/discovery/service-card.component';
@Component({
  selector: 'waasha-provider-profile',
  standalone: true,
  imports: [CommonModule, RouterLink, ServiceCardComponent],
  template: `
    <div class="wa-profile">
      <a routerLink="/marketplace" class="wa-back" aria-label="Back to marketplace">
        <span aria-hidden="true">←</span> Back to marketplace
      </a>

      <!-- loading -->
      <div *ngIf="loading" class="wa-card wa-loading" role="status" aria-label="Loading provider">
        <div class="wa-skeleton wa-skeleton--title"></div>
        <div class="wa-skeleton wa-skeleton--line"></div>
        <div class="wa-skeleton wa-skeleton--grid"></div>
      </div>

      <!-- error -->
      <div *ngIf="error && !loading" class="wa-card wa-error" role="alert">
        <p class="wa-error__title">Couldn't load provider</p>
        <p class="wa-error__msg">{{ error }}</p>
        <div class="wa-error__actions">
          <button type="button" class="wa-btn wa-btn-primary wa-btn--navy" (click)="retry()">Retry</button>
          <a routerLink="/marketplace" class="wa-btn wa-btn-ghost">Back to marketplace</a>
        </div>
      </div>

      <!-- profile -->
      <ng-container *ngIf="!loading && !error && provider">
        <section class="wa-card wa-profile__header">
          <div class="wa-profile__identity">
            <div class="wa-avatar wa-avatar--lg" aria-hidden="true">
              <img
                *ngIf="provider.profileImageUrl; else fallback"
                [src]="provider.profileImageUrl"
                [alt]="provider.displayName"
                class="wa-avatar__img"
              />
              <ng-template #fallback>
                <span class="wa-avatar__fallback wa-avatar__fallback--lg">{{ provider.displayName.charAt(0) | uppercase }}</span>
              </ng-template>
            </div>
            <div>
              <div class="wa-profile__tags">
                <span
                  class="wa-pill"
                  [ngClass]="{
                    'wa-pill--navy': provider.tierCode === 'T3',
                    'wa-pill--teal': provider.tierCode === 'T2',
                    'wa-pill--muted': provider.tierCode === 'T1' || !provider.tierCode
                  }"
                >
                  {{ tierLabel }}
                </span>
                <span *ngIf="provider.verificationStatus === 'VERIFIED'" class="wa-pill wa-pill--verified">
                  <span aria-hidden="true">◆</span> Verified Pro
                </span>
                <span *ngIf="provider.distanceKm != null" class="wa-distance">
                  {{ provider.distanceKm | number:'1.1-1' }} km away
                </span>
              </div>
              <h1 class="wa-profile__name">{{ provider.displayName }}</h1>
              <p class="wa-profile__loc" *ngIf="provider.location as loc">
                {{ loc.city }}<span *ngIf="loc.city && loc.province">, </span>{{ loc.province }}
                <span *ngIf="provider.distanceKm != null"> • {{ provider.distanceKm | number:'1.1-1' }} km away</span>
                <span> • Coverage {{ provider.coverageRadiusKm }} km</span>
              </p>
              <p class="wa-profile__bio" *ngIf="provider.bio">{{ provider.bio }}</p>
              <p class="wa-profile__bio" *ngIf="!provider.bio && provider.experienceSummary">{{ provider.experienceSummary }}</p>
            </div>
          </div>

          <div class="wa-profile__stats">
            <div class="wa-stat" *ngIf="provider.rating != null">
              <span class="wa-stat__value"><span aria-hidden="true">★</span> {{ provider.rating | number:'1.1-1' }}</span>
              <span class="wa-stat__label">{{ provider.reviewCount }} review{{ provider.reviewCount === 1 ? '' : 's' }}</span>
            </div>
            <div class="wa-stat">
              <span class="wa-stat__value">{{ services.length }}</span>
              <span class="wa-stat__label">service{{ services.length === 1 ? '' : 's' }}</span>
            </div>
            <div class="wa-stat">
              <span class="wa-stat__value">{{ provider.isAvailable ? 'Available' : 'Check availability' }}</span>
              <span class="wa-stat__label">status</span>
            </div>
          </div>

          <div class="wa-profile__reviews" *ngIf="provider.reviewsSample?.length">
            <h3 class="wa-profile__reviews-title">Recent reviews</h3>
            <div class="wa-review" *ngFor="let r of provider.reviewsSample">
              <span class="wa-review__rating"><span aria-hidden="true">★</span> {{ r.rating }}</span>
              <span class="wa-review__comment">{{ r.comment || '—' }}</span>
            </div>
          </div>
        </section>

        <section class="wa-profile__services" id="services" aria-label="Services">
          <div class="wa-section-head">
            <h2 class="wa-section-title">Services</h2>
            <span class="wa-section-sub">Starting prices include Secure Checkout. Max 3 images per service.</span>
          </div>

          <!-- category filter for services -->
          <div class="wa-service-filter" role="group" aria-label="Filter services by category" *ngIf="serviceCategories.length > 0">
            <button type="button" class="wa-pill wa-filter-pill" [class.active]="!selectedServiceCategoryId" (click)="setServiceCategory(null)" aria-pressed="{{ !selectedServiceCategoryId }}">All services</button>
            <button
              *ngFor="let c of serviceCategories; trackBy: trackCat"
              type="button"
              class="wa-pill wa-filter-pill"
              [class.active]="selectedServiceCategoryId === c.id || selectedServiceCategoryId === c.code"
              (click)="setServiceCategory(c.id)"
              [attr.aria-pressed]="selectedServiceCategoryId === c.id || selectedServiceCategoryId === c.code"
              [attr.aria-label]="'Filter services by ' + c.name"
            >
              {{ c.name }}
            </button>
          </div>

          <!-- services loading -->
          <div *ngIf="servicesLoading" class="wa-skeleton-grid" role="status" aria-label="Loading services">
            <div class="wa-skeleton wa-skeleton--svc" *ngFor="let i of [1,2]"></div>
          </div>

          <!-- services error -->
          <div *ngIf="servicesError && !servicesLoading" class="wa-card wa-error wa-error--inline" role="alert">
            <p class="wa-error__title">Couldn't load services</p>
            <p class="wa-error__msg">{{ servicesError }}</p>
            <button type="button" class="wa-btn wa-btn-primary wa-btn--navy wa-btn--sm" (click)="loadServices()">Retry</button>
          </div>

          <!-- empty after filter -->
          <div *ngIf="!servicesLoading && !servicesError && services.length === 0" class="wa-card wa-empty-services" role="status">
            <p class="wa-empty__title">{{ selectedServiceCategoryId ? 'No services in this category' : 'No active services yet' }}</p>
            <p class="wa-empty__sub">{{ selectedServiceCategoryId ? 'Try another category or clear the filter.' : "This provider hasn't published services. Check back soon." }}</p>
            <button *ngIf="selectedServiceCategoryId" type="button" class="wa-btn wa-btn-ghost wa-btn--sm" style="margin-top:10px" (click)="setServiceCategory(null)">Clear filter</button>
          </div>

          <div *ngIf="!servicesLoading && !servicesError && services.length > 0" class="wa-service-grid">
            <a
              *ngFor="let svc of services; trackBy: trackService"
              class="wa-service-link"
              [routerLink]="['/marketplace/provider', provider.id, 'service', svc.id]"
              [attr.aria-label]="'View service ' + svc.name"
            >
              <waasha-service-card [service]="svc" [providerId]="provider.id" />
            </a>
          </div>

          <div class="wa-profile__cta">
            <p class="wa-cta-note">Payments: Waasha Payment, Cash (Cash change requested), EFT — server-authoritative.</p>
          </div>
        </section>
      </ng-container>
    </div>
  `,
  styles: [`
    .wa-profile { display: flex; flex-direction: column; gap: 16px; max-width: 960px; margin: 0 auto; }
    .wa-back { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 700; color: var(--waasha-navy); text-decoration: none; }
    .wa-back:hover { text-decoration: underline; }
    .wa-card { background: white; border: 1px solid var(--waasha-border); border-radius: var(--waasha-radius); padding: 20px; box-shadow: 0 1px 2px rgba(11,31,51,0.04); }
    .wa-loading { display: flex; flex-direction: column; gap: 12px; }
    .wa-skeleton { height: 18px; border-radius: 8px; background: linear-gradient(90deg, #F1F5F9 25%, #E2E8F0 37%, #F1F5F9 63%); background-size: 400% 100%; animation: shimmer 1.4s ease infinite; }
    .wa-skeleton--title { height: 28px; width: 40%; }
    .wa-skeleton--line { height: 14px; width: 70%; }
    .wa-skeleton--grid { height: 160px; }
    @keyframes shimmer { 0% { background-position: 100% 0; } 100% { background-position: 0 0; } }
    .wa-error { background: #FEF2F2; border-color: #FECACA; }
    .wa-error__title { margin: 0; font-weight: 800; color: #991B1B; font-size: 14px; }
    .wa-error__msg { margin: 6px 0 12px; font-size: 13px; color: #991B1B; }
    .wa-profile__header { display: flex; flex-direction: column; gap: 16px; }
    .wa-profile__identity { display: flex; gap: 16px; align-items: flex-start; }
    @media (max-width: 600px) { .wa-profile__identity { flex-direction: column; } }
    .wa-avatar { width: 64px; height: 64px; border-radius: 16px; overflow: hidden; background: var(--waasha-bg); border: 1px solid var(--waasha-border); display: grid; place-items: center; flex-shrink: 0; }
    .wa-avatar--lg { width: 72px; height: 72px; }
    .wa-avatar__img { width: 100%; height: 100%; object-fit: cover; }
    .wa-avatar__fallback { font-weight: 800; color: var(--waasha-navy); font-size: 20px; }
    .wa-avatar__fallback--lg { font-size: 22px; }
    .wa-profile__tags { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; margin-bottom: 6px; }
    .wa-pill { display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px; border-radius: 999px; font-size: 11px; font-weight: 700; }
    .wa-pill--navy { background: var(--waasha-navy); color: white; }
    .wa-pill--teal { background: #E6F7F5; color: var(--waasha-navy); border: 1px solid #B9E8E2; }
    .wa-pill--muted { background: #F1F5F9; color: var(--waasha-navy); border: 1px solid var(--waasha-border); }
    .wa-pill--verified { background: rgba(25,182,165,0.12); color: #0E7A6E; border: 1px solid rgba(25,182,165,0.25); }
    .wa-distance { display: inline-flex; align-items: center; gap: 4px; padding: 3px 10px; border-radius: 999px; background: #E6F7F5; color: #0E7A6E; font-size: 11px; font-weight: 700; }
    .wa-profile__name { margin: 0; font-size: 24px; font-weight: 800; color: var(--waasha-navy); letter-spacing: -0.02em; }
    .wa-profile__loc { margin: 4px 0 0; font-size: 13px; color: var(--waasha-muted); }
    .wa-profile__bio { margin: 8px 0 0; font-size: 14px; color: var(--waasha-text); line-height: 1.6; }
    .wa-profile__stats { display: flex; gap: 16px; border-top: 1px solid var(--waasha-border); padding-top: 14px; }
    .wa-stat { display: flex; flex-direction: column; gap: 2px; }
    .wa-stat__value { font-size: 14px; font-weight: 800; color: var(--waasha-navy); }
    .wa-stat__label { font-size: 11px; color: var(--waasha-muted); font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; }
    .wa-profile__reviews { border-top: 1px solid var(--waasha-border); padding-top: 12px; display: flex; flex-direction: column; gap: 8px; }
    .wa-profile__reviews-title { margin: 0; font-size: 12px; font-weight: 800; color: var(--waasha-navy); letter-spacing: 0.04em; text-transform: uppercase; }
    .wa-review { display: flex; gap: 8px; font-size: 12px; color: var(--waasha-muted); }
    .wa-review__rating { font-weight: 700; color: var(--waasha-navy); flex-shrink: 0; }
    .wa-review__comment { line-height: 1.4; }
    .wa-section-head { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 12px; }
    .wa-section-title { font-size: 16px; font-weight: 800; color: var(--waasha-navy); margin: 0; }
    .wa-section-sub { font-size: 11px; color: var(--waasha-muted); }
    .wa-empty-services { text-align: center; }
    .wa-empty__title { font-size: 14px; font-weight: 800; color: var(--waasha-navy); margin: 0; }
    .wa-empty__sub { font-size: 12px; color: var(--waasha-muted); margin: 6px 0 0; }
    .wa-service-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px; }
    @media (max-width: 720px) { .wa-service-grid { grid-template-columns: 1fr; } }
    .wa-profile__cta { margin-top: 16px; text-align: center; display: flex; flex-direction: column; gap: 8px; align-items: center; }
    .wa-cta-note { font-size: 11px; color: var(--waasha-muted); margin: 0; }
    .wa-cta-btn { padding: 12px 20px; border-radius: 12px; min-width: 260px; }
    .wa-btn--navy { background: var(--waasha-navy); }
    .wa-error__actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
    .wa-btn-ghost { background: #F6F8FA; color: var(--waasha-navy); border: 1px solid var(--waasha-border); text-decoration: none; display: inline-flex; align-items: center; justify-content: center; padding: 9px 14px; border-radius: 12px; font-weight: 700; font-size: 13px; }
    .wa-btn--sm { padding: 8px 12px; font-size: 12px; border-radius: 10px; }
    .wa-service-filter { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 12px; }
    .wa-filter-pill { background: white; border: 1px solid var(--waasha-border); color: var(--waasha-muted); cursor: pointer; }
    .wa-filter-pill.active { background: var(--waasha-navy); color: white; border-color: var(--waasha-navy); }
    .wa-skeleton-grid { display: grid; grid-template-columns: repeat(2,1fr); gap: 14px; }
    @media (max-width: 720px) { .wa-skeleton-grid { grid-template-columns: 1fr; } }
    .wa-skeleton--svc { height: 180px; border-radius: var(--waasha-radius); background: linear-gradient(90deg,#F1F5F9 25%,#E2E8F0 37%,#F1F5F9 63%); background-size: 400% 100%; animation: shimmer 1.4s ease infinite; border: 1px solid var(--waasha-border); }
    .wa-error--inline { padding: 14px; text-align: center; }
    .wa-service-link { text-decoration: none; color: inherit; display: block; }
    .wa-service-link:focus-visible { outline: 2px solid var(--waasha-teal); outline-offset: 2px; border-radius: var(--waasha-radius); }
  `]
})
export class ProviderProfileComponent implements OnInit {
  private readonly marketplace = inject(MarketplaceService);
  private readonly locationService = inject(CustomerLocationService);
  private readonly discovery = inject(DiscoveryService);
  private readonly route = inject(ActivatedRoute);

  provider: ProviderProfileDto | null = null;
  loading = true;
  error: string | null = null;
  private providerId = '';

  // Slice 1 services API
  services: ServiceDto[] = [];
  servicesLoading = false;
  servicesError: string | null = null;
  selectedServiceCategoryId: string | null = null;
  serviceCategories: ServiceCategory[] = [];

  get tierLabel(): string {
    if (!this.provider) return '';
    if (this.provider.tierCode === 'T3' || this.provider.tier?.code === 'T3') return 'T3 Business';
    if (this.provider.tierCode === 'T2' || this.provider.tier?.code === 'T2') return 'T2 Team';
    return 'T1 Solo Pro';
  }

  ngOnInit(): void {
    // Support both legacy /providers/:id and /marketplace/provider/:providerId
    this.providerId = this.route.snapshot.paramMap.get('providerId') ?? this.route.snapshot.paramMap.get('id') ?? '';
    // keep sync if route changes
    this.route.paramMap.subscribe((pm) => {
      const next = pm.get('providerId') ?? pm.get('id') ?? '';
      if (next && next !== this.providerId) {
        this.providerId = next;
        this.load();
      }
    });
    this.load();
    this.discovery.fetchCategories().subscribe({
      next: (res) => this.serviceCategories = res.data,
      error: () => {},
    });
  }

  retry(): void { this.load(); }

  trackService(_: number, s: { id: string }): string { return s.id; }
  trackCat(_: number, c: ServiceCategory): string { return c.id; }

  setServiceCategory(catId: string | null): void {
    this.selectedServiceCategoryId = catId;
    this.loadServices();
  }

  loadServices(): void {
    if (!this.providerId) return;
    this.servicesLoading = true;
    this.servicesError = null;
    this.marketplace.fetchProviderServices(this.providerId, {
      categoryId: this.selectedServiceCategoryId ?? undefined,
      page: 1,
      perPage: 50,
    }).subscribe({
      next: (res) => {
        this.servicesLoading = false;
        // ACTIVE only enforced backend, but double-guard + slice to 3 images
        this.services = (res.data ?? []).filter((s) => s.status === 'ACTIVE').map((s) => ({ ...s, images: (s.images ?? []).slice(0, 3) }));
      },
      error: (err) => {
        this.servicesLoading = false;
        const raw = err?.error?.error?.message ?? err?.message ?? 'Failed to load services';
        this.servicesError = raw.includes('SQL') || raw.includes('prisma') ? 'Something went wrong. Please try again.' : raw;
      },
    });
  }

  private load(): void {
    if (!this.providerId) {
      this.loading = false;
      this.error = 'Invalid provider identifier';
      return;
    }
    this.loading = true;
    this.error = null;
    const qLat = this.route.snapshot.queryParamMap.get('lat');
    const qLng = this.route.snapshot.queryParamMap.get('lng');
    let loc: { latitude: number; longitude: number } | undefined;
    if (qLat && qLng) {
      const lat = Number(qLat);
      const lng = Number(qLng);
      if (Number.isFinite(lat) && Number.isFinite(lng)) loc = { latitude: lat, longitude: lng };
    } else {
      loc = this.locationService.snapshot;
    }
    this.marketplace.fetchProviderProfile(this.providerId, loc).subscribe({
      next: (res) => {
        this.loading = false;
        this.provider = res.data;
        this.loadServices();
      },
      error: (err) => {
        this.loading = false;
        const raw = err?.error?.error?.message ?? err?.message ?? 'Failed to load provider';
        const status = err?.status;
        if (status === 404 || raw.toLowerCase().includes('not found')) {
          this.error = 'Provider not found. It may be inactive or the link is incorrect.';
        } else if (raw.includes('SQL') || raw.includes('prisma')) {
          this.error = 'Something went wrong. Please try again.';
        } else {
          this.error = raw;
        }
      },
    });
  }
}

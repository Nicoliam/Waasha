import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { CategoryFilterComponent } from '../../shared/components/discovery/category-filter.component';
import { ProviderCardComponent } from '../../shared/components/discovery/provider-card.component';
import { RadiusExpansionComponent } from '../../shared/components/discovery/radius-expansion.component';
import { DiscoveryService } from '../../core/services/discovery.service';
import { MarketplaceRadiusConfigService } from '../../core/config/marketplace-radius.config';
import { CustomerLocationService } from '../../core/services/customer-location.service';
import { CustomerDiscoveryRadiusKm, ServiceCategory, ProviderCardDto } from '../../core/models/discovery-radius.model';

@Component({
  selector: 'waasha-discovery',
  standalone: true,
  imports: [CommonModule, FormsModule, CategoryFilterComponent, ProviderCardComponent, RadiusExpansionComponent],
  template: `
    <div class="wa-discovery">
      <!-- Header / branding + location context -->
      <section class="wa-discovery__hero">
        <div class="wa-discovery__hero-main">
          <p class="wa-kicker">Local Verified Services</p>
          <h1 class="wa-discovery__title">What service are you looking for?</h1>
          <p class="wa-discovery__subtitle">Discover trusted pros within your radius — fair for every provider, no tier bias.</p>
        </div>

        <div class="wa-discovery__context">
          <div class="wa-context-card" role="region" aria-label="Discovery context">
            <div class="wa-context-row">
              <span class="wa-context-label">
                <span aria-hidden="true">◎</span> Near You
              </span>
              <span class="wa-pill wa-pill--teal">
                Within {{ discovery.currentRadius }} km
              </span>
            </div>
            <div class="wa-context-row wa-context-row--sub">
              <span class="wa-context-loc">
                <span aria-hidden="true">📍</span> {{ locationLabel }}
              </span>
              <button type="button" class="wa-link" (click)="useMyLocation()" [disabled]="locating">
                {{ locating ? 'Locating…' : 'Use my location' }}
              </button>
            </div>
            <div class="wa-context-manual" role="group" aria-label="Manual location">
              <label class="wa-manual-label" for="wa-lat">Manual location</label>
              <div class="wa-manual-row">
                <input id="wa-lat" type="number" step="0.0001" class="wa-manual-input" [(ngModel)]="manualLat" placeholder="Latitude" aria-label="Latitude" />
                <input id="wa-lng" type="number" step="0.0001" class="wa-manual-input" [(ngModel)]="manualLng" placeholder="Longitude" aria-label="Longitude" />
                <button type="button" class="wa-btn wa-btn-primary wa-btn--sm wa-btn--navy" (click)="applyManualLocation()" aria-label="Apply manual location">Apply</button>
              </div>
              <p class="wa-manual-note">Confirm location — discovery uses your selected point. No precise address exposed.</p>
              <p *ngIf="manualError" class="wa-manual-error" role="alert">{{ manualError }}</p>
              <p *ngIf="manualSuccess" class="wa-manual-success" role="status">{{ manualSuccess }}</p>
            </div>
            <div class="wa-context-radius">
              <span class="wa-context-radius-label">Discovery radius</span>
              <div class="wa-radius-pills" role="group" aria-label="Select discovery radius">
                <button
                  *ngFor="let r of allowedRadii"
                  type="button"
                  class="wa-radius-pill"
                  [class.active]="discovery.currentRadius === r"
                  (click)="setRadius(r)"
                  [attr.aria-pressed]="discovery.currentRadius === r"
                  [attr.aria-label]="'Set radius to ' + r + ' kilometers'"
                >
                  {{ r }} km
                </button>
              </div>
              <p class="wa-context-note">Max {{ maxRadius }} km • Provider coverage also applies</p>
            </div>
          </div>
        </div>
      </section>

      <!-- Categories -->
      <section class="wa-discovery__cats" aria-label="Categories">
        <div class="wa-section-head">
          <h2 class="wa-section-title">Explore 5 Core Categories</h2>
          <span class="wa-section-sub">Direct 10 km Pros</span>
        </div>
        <waasha-category-filter
          [categories]="categories"
          [selectedCategoryId]="selectedCategoryId"
          (select)="onCategorySelect($event)"
        />
        <p *ngIf="categoriesError" class="wa-error" role="alert">
          Couldn't load categories. <button type="button" class="wa-link" (click)="loadCategories()">Retry</button>
        </p>
      </section>

      <!-- Providers -->
      <section class="wa-discovery__providers" aria-label="Providers near you">
        <div class="wa-section-head">
          <div>
            <h2 class="wa-section-title">{{ selectedCategoryName || '10 km Discovery' }}</h2>
            <p class="wa-section-sub">Ranked by distance — fair for every pro. Backend validates eligibility.</p>
          </div>
          <span class="wa-count" *ngIf="!loading && !error">{{ total }} provider{{ total === 1 ? '' : 's' }}</span>
        </div>

        <!-- loading -->
        <div *ngIf="loading" class="wa-skeleton-grid" aria-label="Loading providers" role="status">
          <div class="wa-skeleton" *ngFor="let i of [1,2,3,4]"></div>
        </div>

        <!-- error -->
        <div *ngIf="error && !loading" class="wa-error" role="alert">
          <p class="wa-error__title">Couldn't load providers</p>
          <p class="wa-error__msg">{{ error }}</p>
          <button type="button" class="wa-btn wa-btn-primary wa-btn--navy" (click)="retry()">Retry</button>
        </div>

        <!-- empty + radius expansion -->
        <waasha-radius-expansion
          *ngIf="!loading && !error && providers.length === 0"
          [currentRadiusKm]="discovery.currentRadius"
          [canExpandTo]="nextRadius"
          [maxRadiusKm]="maxRadius"
          [total]="providers.length"
          (expand)="onExpand($event)"
        />

        <!-- provider grid -->
        <div *ngIf="!loading && !error && providers.length > 0" class="wa-provider-grid">
          <waasha-provider-card
            *ngFor="let p of providers; trackBy: trackProvider"
            [provider]="p"
            [customerLoc]="customerLoc"
          />
        </div>

        <!-- pagination -->
        <div *ngIf="!loading && !error && total > perPage" class="wa-pagination">
          <button type="button" class="wa-btn wa-btn-ghost" (click)="prevPage()" [disabled]="page === 1">Previous</button>
          <span class="wa-pagination__label">Page {{ page }} of {{ totalPages }}</span>
          <button type="button" class="wa-btn wa-btn-ghost" (click)="nextPage()" [disabled]="page >= totalPages">Next</button>
        </div>

        <p class="wa-footnote">Customer location is not precisely exposed. Distances shown are customer-friendly rounded values.</p>
      </section>
    </div>
  `,
  styles: [`
    .wa-discovery { display: flex; flex-direction: column; gap: 20px; }
    .wa-discovery__hero { display: grid; grid-template-columns: 1.1fr 0.9fr; gap: 16px; align-items: start; }
    @media (max-width: 860px) { .wa-discovery__hero { grid-template-columns: 1fr; } }
    .wa-discovery__title { font-size: 28px; font-weight: 800; color: var(--waasha-navy); letter-spacing: -0.02em; margin: 6px 0 8px; line-height: 1.15; }
    .wa-discovery__subtitle { font-size: 14px; color: var(--waasha-muted); margin: 0; line-height: 1.5; }
    .wa-context-card { background: white; border: 1px solid var(--waasha-border); border-radius: var(--waasha-radius); padding: 14px 16px; box-shadow: 0 1px 2px rgba(11,31,51,0.04); display: flex; flex-direction: column; gap: 10px; }
    .wa-context-row { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
    .wa-context-row--sub { font-size: 12px; color: var(--waasha-muted); }
    .wa-context-label { font-size: 13px; font-weight: 700; color: var(--waasha-navy); display: inline-flex; align-items: center; gap: 6px; }
    .wa-pill--teal { background: #E6F7F5; color: #0E7A6E; border: 1px solid #B9E8E2; padding: 3px 10px; border-radius: 999px; font-size: 11px; font-weight: 700; }
    .wa-context-loc { display: inline-flex; align-items: center; gap: 6px; }
    .wa-link { background: none; border: 0; color: var(--waasha-teal); font-weight: 700; font-size: 12px; cursor: pointer; padding: 0; }
    .wa-link:hover { text-decoration: underline; }
    .wa-context-radius { border-top: 1px solid var(--waasha-border); padding-top: 10px; display: flex; flex-direction: column; gap: 8px; }
    .wa-context-radius-label { font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--waasha-muted); }
    .wa-radius-pills { display: flex; gap: 6px; }
    .wa-radius-pill { padding: 6px 14px; border-radius: 999px; border: 1px solid var(--waasha-border); background: white; font-size: 12px; font-weight: 700; color: var(--waasha-muted); cursor: pointer; }
    .wa-radius-pill.active { background: var(--waasha-navy); color: white; border-color: var(--waasha-navy); }
    .wa-context-note { margin: 0; font-size: 11px; color: var(--waasha-muted); }
    .wa-context-manual { border-top: 1px solid var(--waasha-border); padding-top: 10px; display: flex; flex-direction: column; gap: 6px; }
    .wa-manual-label { font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--waasha-muted); }
    .wa-manual-row { display: flex; gap: 6px; align-items: center; }
    .wa-manual-input { flex: 1; padding: 7px 8px; border-radius: 10px; border: 1px solid var(--waasha-border); font-size: 12px; background: white; }
    .wa-manual-note { margin: 0; font-size: 10px; color: var(--waasha-muted); }
    .wa-manual-error { margin: 0; font-size: 11px; color: #991B1B; background: #FEF2F2; border: 1px solid #FECACA; padding: 6px 8px; border-radius: 8px; }
    .wa-manual-success { margin: 0; font-size: 11px; color: #065F46; background: #ECFDF5; border: 1px solid #A7F3D0; padding: 6px 8px; border-radius: 8px; }
    .wa-btn--sm { padding: 7px 12px; font-size: 12px; border-radius: 10px; }
    .wa-section-head { display: flex; justify-content: space-between; align-items: flex-end; gap: 12px; margin-bottom: 10px; }
    .wa-section-title { font-size: 14px; font-weight: 800; color: var(--waasha-navy); letter-spacing: -0.01em; margin: 0; text-transform: uppercase; }
    .wa-section-sub { font-size: 12px; color: var(--waasha-muted); }
    .wa-count { font-size: 12px; color: var(--waasha-muted); font-weight: 600; }
    .wa-skeleton-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px; }
    @media (max-width: 720px) { .wa-skeleton-grid { grid-template-columns: 1fr; } }
    .wa-skeleton { height: 180px; border-radius: var(--waasha-radius); background: linear-gradient(90deg, #F1F5F9 25%, #E2E8F0 37%, #F1F5F9 63%); background-size: 400% 100%; animation: shimmer 1.4s ease infinite; border: 1px solid var(--waasha-border); }
    @keyframes shimmer { 0% { background-position: 100% 0; } 100% { background-position: 0 0; } }
    .wa-error { background: #FEF2F2; border: 1px solid #FECACA; border-radius: 12px; padding: 14px; }
    .wa-error__title { margin: 0; font-weight: 800; color: #991B1B; font-size: 13px; }
    .wa-error__msg { margin: 6px 0 10px; font-size: 13px; color: #991B1B; }
    .wa-provider-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 14px; }
    @media (max-width: 860px) { .wa-provider-grid { grid-template-columns: 1fr; } }
    .wa-pagination { display: flex; justify-content: center; align-items: center; gap: 12px; margin-top: 12px; }
    .wa-pagination__label { font-size: 12px; color: var(--waasha-muted); font-weight: 600; }
    .wa-footnote { text-align: center; font-size: 11px; color: var(--waasha-muted); margin: 8px 0 0; }
    .wa-btn--navy { background: var(--waasha-navy); }
  `]
})
export class DiscoveryComponent implements OnInit {
  readonly discovery = inject(DiscoveryService);
  private readonly radiusConfig = inject(MarketplaceRadiusConfigService);
  private readonly locationService = inject(CustomerLocationService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  categories: ServiceCategory[] = [];
  categoriesError: string | null = null;

  providers: ProviderCardDto[] = [];
  total = 0;
  page = 1;
  perPage = 20;
  loading = false;
  error: string | null = null;

  selectedCategoryId: string | null = null;
  allowedRadii: readonly CustomerDiscoveryRadiusKm[] = [10, 15, 20];
  maxRadius: CustomerDiscoveryRadiusKm = 20;
  nextRadius: CustomerDiscoveryRadiusKm | null = null;
  locating = false;
  manualLat: number | null = null;
  manualLng: number | null = null;
  manualError: string | null = null;
  manualSuccess: string | null = null;

  get customerLoc(): { latitude: number; longitude: number } {
    return this.locationService.snapshot;
  }

  get locationLabel(): string {
    return this.locationService.label();
  }

  get selectedCategoryName(): string | null {
    if (!this.selectedCategoryId) return null;
    const c = this.categories.find((x) => x.id === this.selectedCategoryId || x.code === this.selectedCategoryId);
    return c?.name ?? null;
  }

  get totalPages(): number {
    return Math.max(1, Math.ceil(this.total / this.perPage));
  }

  ngOnInit(): void {
    this.radiusConfig.fetchConfig().subscribe((cfg) => {
      this.allowedRadii = cfg.allowedCustomerRadiiKm;
      this.maxRadius = cfg.maxCustomerRadiusKm;
      this.updateNextRadius();
    });
    this.discovery.initFromConfig();
    this.discovery.radius$.subscribe(() => {
      this.updateNextRadius();
      this.fetchProviders();
    });

    this.loadCategories();

    this.route.queryParamMap.subscribe((params) => {
      const cat = params.get('category');
      const nextCat = cat || null;
      if (nextCat !== this.selectedCategoryId) {
        this.selectedCategoryId = nextCat;
        this.page = 1;
        this.fetchProviders();
      } else if (this.providers.length === 0 && !this.loading) {
        // Initial load when category unchanged (first emission)
        this.fetchProviders();
      }
    });

    this.updateNextRadius();
  }

  loadCategories(): void {
    this.categoriesError = null;
    this.discovery.fetchCategories().subscribe({
      next: (res) => {
        this.categories = res.data;
      },
      error: () => {
        this.categoriesError = 'Failed to load categories';
      },
    });
  }

  onCategorySelect(catId: string | null): void {
    this.selectedCategoryId = catId;
    this.page = 1;
    this.router.navigate([], {
      queryParams: { category: catId || null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
    // fetchProviders triggered by queryParamMap subscription, but also ensure immediate
    this.fetchProviders();
  }

  setRadius(r: CustomerDiscoveryRadiusKm): void {
    this.discovery.setRadius(r);
  }

  onExpand(next: CustomerDiscoveryRadiusKm): void {
    this.discovery.setRadius(next);
  }

  retry(): void {
    this.fetchProviders();
  }

  prevPage(): void {
    if (this.page > 1) {
      this.page--;
      this.fetchProviders();
    }
  }

  nextPage(): void {
    if (this.page < this.totalPages) {
      this.page++;
      this.fetchProviders();
    }
  }

  useMyLocation(): void {
    this.locating = true;
    this.locationService
      .tryUseBrowserGeolocation()
      .then(() => {
        this.locating = false;
        this.manualSuccess = 'Location updated';
        this.manualError = null;
        this.fetchProviders();
        setTimeout(() => (this.manualSuccess = null), 2500);
      })
      .catch(() => {
        this.locating = false;
        this.error = 'Location permission denied. Using default location. You can also set location manually.';
        this.fetchProviders();
      });
  }

  applyManualLocation(): void {
    this.manualError = null;
    this.manualSuccess = null;
    if (this.manualLat == null || this.manualLng == null) {
      this.manualError = 'Enter both latitude and longitude.';
      return;
    }
    const lat = Number(this.manualLat);
    const lng = Number(this.manualLng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      this.manualError = 'Invalid coordinates. Latitude ±90, longitude ±180.';
      return;
    }
    this.locationService.setLocation({ latitude: lat, longitude: lng });
    this.manualSuccess = 'Manual location applied';
    this.fetchProviders();
    setTimeout(() => (this.manualSuccess = null), 2500);
  }

  trackProvider(_: number, p: ProviderCardDto): string {
    return p.id;
  }

  private fetchProviders(): void {
    this.loading = true;
    this.error = null;
    const loc = this.locationService.snapshot;
    this.discovery
      .fetchProviders({
        latitude: loc.latitude,
        longitude: loc.longitude,
        radiusKm: this.discovery.currentRadius,
        categoryId: this.selectedCategoryId ?? undefined,
        page: this.page,
        perPage: this.perPage,
      })
      .subscribe({
        next: (res) => {
          this.loading = false;
          this.providers = res.data;
          this.total = res.meta.total;
          this.updateNextRadius();
        },
        error: (err) => {
          this.loading = false;
          const msg = err?.error?.error?.message ?? err?.message ?? 'Failed to load providers. Please try again.';
          // Never expose raw backend internals
          if (msg.includes('SQL') || msg.includes('prisma') || msg.includes('stack')) {
            this.error = 'Something went wrong. Please try again.';
          } else {
            this.error = msg;
          }
        },
      });
  }

  private updateNextRadius(): void {
    this.nextRadius = this.radiusConfig.nextCustomerRadius(this.discovery.currentRadius);
  }
}

import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { DiscoveryService, ProviderCardDto } from '../../core/services/discovery.service';
import { MarketplaceRadiusConfigService } from '../../core/config/marketplace-radius.config';
import { CustomerLocationService } from '../../core/services/customer-location.service';
import { CustomerDiscoveryRadiusKm, ServiceCategory } from '../../core/models/discovery-radius.model';
import { RadiusExpansionComponent } from '../../shared/components/radius-expansion/radius-expansion.component';
import { MobileCategoryFilterComponent } from '../../shared/components/discovery/category-filter.component';
import { MobileProviderCardComponent } from '../../shared/components/discovery/provider-card.component';

@Component({
  selector: 'waasha-discovery-page',
  standalone: true,
  imports: [CommonModule, FormsModule, RadiusExpansionComponent, MobileCategoryFilterComponent, MobileProviderCardComponent],
  template: `
    <header class="wa-header">
      <div class="wa-header__inner">
        <div class="wa-header__loc">
          <button type="button" class="wa-loc-btn" (click)="useMyLocation()" [attr.aria-label]="'Location: ' + locationLabel">
            <span aria-hidden="true">📍</span>
            <span class="wa-loc__text">
              <strong>{{ locationLabel }}</strong>
              <small>{{ discovery.currentRadius }} km radius active</small>
            </span>
          </button>
          <button type="button" class="wa-loc-action" (click)="useMyLocation()" [disabled]="locating">
            {{ locating ? 'Locating…' : 'Use my location' }}
          </button>
        </div>
        <div class="wa-header__radius">
          <span class="wa-header__radius-label">Radius</span>
          <div class="wa-radius-pills">
            <button
              *ngFor="let r of allowedRadii"
              type="button"
              class="wa-pill"
              [class.active]="discovery.currentRadius === r"
              (click)="setRadius(r)"
              [attr.aria-pressed]="discovery.currentRadius === r"
            >
              {{ r }} km
            </button>
          </div>
        </div>
        <div class="wa-manual" role="group" aria-label="Manual location">
          <label class="wa-manual-label">Manual location</label>
          <div class="wa-manual-row">
            <input type="number" step="0.0001" [(ngModel)]="manualLat" placeholder="Lat" aria-label="Latitude" class="wa-manual-input" />
            <input type="number" step="0.0001" [(ngModel)]="manualLng" placeholder="Lng" aria-label="Longitude" class="wa-manual-input" />
            <button type="button" class="wa-btn wa-btn-primary wa-btn--sm" (click)="applyManualLocation()">Apply</button>
          </div>
          <p *ngIf="manualError" class="wa-manual-error" role="alert">{{ manualError }}</p>
          <p *ngIf="manualSuccess" class="wa-manual-success" role="status">{{ manualSuccess }}</p>
          <p class="wa-manual-note">No precise address exposed.</p>
        </div>
      </div>
    </header>

    <main class="wa-main">
      <!-- Hero -->
      <section class="wa-hero">
        <p class="wa-kicker">Local Verified Services</p>
        <h1 class="wa-title">What service are you looking for?</h1>
        <p class="wa-subtitle">Discover trusted pros within your radius — no tier bias. Backend validates eligibility.</p>
      </section>

      <!-- Categories -->
      <section aria-label="Categories">
        <div class="wa-section-head">
          <h2 class="wa-section-title">Explore 5 Core Categories</h2>
          <span class="wa-section-sub">Direct 10 km Pros</span>
        </div>
        <waasha-mobile-category-filter
          [categories]="categories"
          [selectedCategoryId]="selectedCategoryId"
          (select)="onCategorySelect($event)"
        />
        <p *ngIf="categoriesError" class="wa-error" role="alert">
          Couldn't load categories. <button type="button" class="wa-link" (click)="loadCategories()">Retry</button>
        </p>
      </section>

      <!-- Providers -->
      <section aria-label="Providers near you">
        <div class="wa-section-head">
          <h2 class="wa-section-title">{{ selectedCategoryName || '10 km Discovery' }}</h2>
          <span class="wa-count" *ngIf="!loading && !error">{{ total }} provider{{ total === 1 ? '' : 's' }}</span>
        </div>

        <div *ngIf="loading" class="wa-skeletons" role="status" aria-label="Loading providers">
          <div class="wa-skeleton" *ngFor="let i of [1,2,3]"></div>
        </div>

        <div *ngIf="error && !loading" class="wa-error" role="alert">
          <p class="wa-error__title">Couldn't load providers</p>
          <p class="wa-error__msg">{{ error }}</p>
          <button type="button" class="wa-btn wa-btn-primary" (click)="retry()">Retry</button>
        </div>

        <waasha-radius-expansion
          *ngIf="!loading && !error && providers.length === 0"
          [currentRadiusKm]="discovery.currentRadius"
          [canExpandTo]="nextRadius"
          [maxRadiusKm]="maxRadius"
          [total]="providers.length"
          (expand)="onExpand($event)"
        />

        <div *ngIf="!loading && !error && providers.length > 0" class="wa-provider-list">
          <waasha-mobile-provider-card
            *ngFor="let p of providers; trackBy: trackProvider"
            [provider]="p"
            [customerLoc]="customerLoc"
          />
        </div>

        <div *ngIf="!loading && !error && total > perPage" class="wa-pagination">
          <button type="button" class="wa-btn wa-btn-ghost" (click)="prevPage()" [disabled]="page === 1">Previous</button>
          <span class="wa-page">Page {{ page }} of {{ totalPages }}</span>
          <button type="button" class="wa-btn wa-btn-ghost" (click)="nextPage()" [disabled]="page >= totalPages">Next</button>
        </div>

        <p class="wa-footnote">Customer location not precisely exposed. Provider coverage also applies.</p>
      </section>
    </main>
  `,
  styles: [`
    .wa-header { position: sticky; top: 0; z-index: 10; background: white; border-bottom: 1px solid #E2E8F0; }
    .wa-header__inner { max-width: 560px; margin: 0 auto; padding: 10px 16px; display: flex; flex-direction: column; gap: 8px; }
    .wa-header__loc { display: flex; justify-content: space-between; align-items: center; gap: 12px; }
    .wa-loc-btn { display: inline-flex; align-items: center; gap: 8px; background: #F6F8FA; border: 1px solid #E2E8F0; border-radius: 999px; padding: 6px 10px; cursor: pointer; text-align: left; }
    .wa-loc__text { display: flex; flex-direction: column; line-height: 1.1; }
    .wa-loc__text strong { font-size: 12px; color: #0B1F33; }
    .wa-loc__text small { font-size: 10px; color: #19B6A5; font-weight: 700; }
    .wa-loc-action { background: none; border: 0; color: #19B6A5; font-weight: 700; font-size: 11px; cursor: pointer; }
    .wa-header__radius { display: flex; align-items: center; gap: 8px; }
    .wa-header__radius-label { font-size: 10px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: #667085; }
    .wa-radius-pills { display: flex; gap: 6px; }
    .wa-pill { padding: 5px 10px; border-radius: 999px; border: 1px solid #E2E8F0; background: white; font-size: 11px; font-weight: 700; color: #667085; cursor: pointer; }
    .wa-manual { display: flex; flex-direction: column; gap: 6px; padding-top: 8px; border-top: 1px solid #E2E8F0; }
    .wa-manual-label { font-size: 10px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: #667085; }
    .wa-manual-row { display: flex; gap: 6px; align-items: center; }
    .wa-manual-input { flex: 1; padding: 6px 8px; border-radius: 10px; border: 1px solid #E2E8F0; font-size: 11px; background: white; }
    .wa-manual-note { margin: 0; font-size: 10px; color: #667085; }
    .wa-manual-error { margin: 0; font-size: 11px; color: #991B1B; background: #FEF2F2; border: 1px solid #FECACA; padding: 6px 8px; border-radius: 8px; }
    .wa-manual-success { margin: 0; font-size: 11px; color: #065F46; background: #ECFDF5; border: 1px solid #A7F3D0; padding: 6px 8px; border-radius: 8px; }
    .wa-btn--sm { padding: 6px 10px; font-size: 11px; border-radius: 10px; }
    .wa-pill.active { background: #0B1F33; color: white; border-color: #0B1F33; }
    .wa-main { max-width: 560px; margin: 0 auto; padding: 16px 16px 24px; display: flex; flex-direction: column; gap: 16px; }
    .wa-hero { display: flex; flex-direction: column; gap: 4px; }
    .wa-kicker { margin: 0; font-size: 11px; font-weight: 800; letter-spacing: 0.08em; color: #19B6A5; text-transform: uppercase; }
    .wa-title { margin: 0; font-size: 22px; font-weight: 800; color: #0B1F33; letter-spacing: -0.02em; line-height: 1.2; }
    .wa-subtitle { margin: 0; font-size: 13px; color: #667085; line-height: 1.5; }
    .wa-section-head { display: flex; justify-content: space-between; align-items: flex-end; gap: 12px; margin-bottom: 8px; }
    .wa-section-title { margin: 0; font-size: 13px; font-weight: 800; color: #0B1F33; text-transform: uppercase; letter-spacing: -0.01em; }
    .wa-section-sub { font-size: 11px; color: #667085; }
    .wa-count { font-size: 11px; color: #667085; font-weight: 600; }
    .wa-skeletons { display: flex; flex-direction: column; gap: 10px; }
    .wa-skeleton { height: 140px; border-radius: 16px; background: linear-gradient(90deg, #F1F5F9 25%, #E2E8F0 37%, #F1F5F9 63%); background-size: 400% 100%; animation: shimmer 1.4s ease infinite; border: 1px solid #E2E8F0; }
    @keyframes shimmer { 0% { background-position: 100% 0; } 100% { background-position: 0 0; } }
    .wa-error { background: #FEF2F2; border: 1px solid #FECACA; border-radius: 12px; padding: 12px; }
    .wa-error__title { margin: 0; font-weight: 800; color: #991B1B; font-size: 13px; }
    .wa-error__msg { margin: 6px 0 10px; font-size: 13px; color: #991B1B; }
    .wa-link { background: none; border: 0; color: #19B6A5; font-weight: 700; cursor: pointer; }
    .wa-btn { display: inline-flex; align-items: center; justify-content: center; padding: 9px 14px; border-radius: 12px; border: 0; font-weight: 700; font-size: 13px; cursor: pointer; }
    .wa-btn-primary { background: #0B1F33; color: white; }
    .wa-btn-ghost { background: #F6F8FA; color: #0B1F33; border: 1px solid #E2E8F0; }
    .wa-btn:disabled { opacity: 0.5; }
    .wa-provider-list { display: flex; flex-direction: column; gap: 10px; }
    .wa-pagination { display: flex; justify-content: center; align-items: center; gap: 10px; margin-top: 12px; }
    .wa-page { font-size: 11px; color: #667085; font-weight: 600; }
    .wa-footnote { text-align: center; font-size: 11px; color: #667085; margin: 8px 0 0; }
  `]
})
export class DiscoveryPage implements OnInit {
  readonly discovery = inject(DiscoveryService);
  private readonly config = inject(MarketplaceRadiusConfigService);
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
    this.config.fetchConfig().subscribe((cfg) => {
      this.allowedRadii = cfg.allowedCustomerRadiiKm;
      this.maxRadius = cfg.maxCustomerRadiusKm;
      this.nextRadius = this.config.nextCustomerRadius(this.discovery.currentRadius);
    });
    this.discovery.initFromConfig();
    this.discovery.radius$.subscribe(() => {
      this.nextRadius = this.config.nextCustomerRadius(this.discovery.currentRadius);
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
        this.fetchProviders();
      }
    });
    this.nextRadius = this.config.nextCustomerRadius(this.discovery.currentRadius);
  }

  loadCategories(): void {
    this.categoriesError = null;
    this.discovery.fetchCategories().subscribe({
      next: (res) => (this.categories = res.data),
      error: () => (this.categoriesError = 'Failed to load categories'),
    });
  }

  onCategorySelect(catId: string | null): void {
    this.selectedCategoryId = catId;
    this.page = 1;
    this.router.navigate([], { queryParams: { category: catId || null }, queryParamsHandling: 'merge', replaceUrl: true });
    this.fetchProviders();
  }

  setRadius(r: CustomerDiscoveryRadiusKm): void {
    this.discovery.setRadius(r);
  }

  onExpand(next: CustomerDiscoveryRadiusKm): void {
    this.discovery.setRadius(next);
  }

  retry(): void { this.fetchProviders(); }
  prevPage(): void { if (this.page > 1) { this.page--; this.fetchProviders(); } }
  nextPage(): void { if (this.page < this.totalPages) { this.page++; this.fetchProviders(); } }

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
          this.nextRadius = this.config.nextCustomerRadius(this.discovery.currentRadius);
        },
        error: (err) => {
          this.loading = false;
          const msg = err?.error?.error?.message ?? err?.message ?? 'Failed to load providers. Please try again.';
          if (msg.includes('SQL') || msg.includes('prisma')) {
            this.error = 'Something went wrong. Please try again.';
          } else {
            this.error = msg;
          }
        },
      });
  }

  useMyLocation(): void {
    this.locating = true;
    this.locationService.tryUseBrowserGeolocation().then(() => {
      this.locating = false; this.manualSuccess = 'Location updated'; this.manualError = null; this.fetchProviders(); setTimeout(() => this.manualSuccess = null, 2500);
    }).catch(() => {
      this.locating = false;
      this.error = 'Location permission denied. Using default location.';
      this.fetchProviders();
    });
  }

  applyManualLocation(): void {
    this.manualError = null; this.manualSuccess = null;
    if (this.manualLat == null || this.manualLng == null) { this.manualError = 'Enter both latitude and longitude.'; return; }
    const lat = Number(this.manualLat); const lng = Number(this.manualLng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) { this.manualError = 'Invalid coordinates. Latitude ±90, longitude ±180.'; return; }
    this.locationService.setLocation({ latitude: lat, longitude: lng }); this.manualSuccess = 'Manual location applied'; this.fetchProviders(); setTimeout(() => this.manualSuccess = null, 2500);
  }

  trackProvider(_: number, p: ProviderCardDto): string { return p.id; }
}

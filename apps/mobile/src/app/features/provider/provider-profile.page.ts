import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { MarketplaceService, ProviderProfileDto } from '../../core/services/marketplace.service';
import { CustomerLocationService } from '../../core/services/customer-location.service';
import { DiscoveryService } from '../../core/services/discovery.service';
import { ServiceCategory } from '../../core/models/discovery-radius.model';
import { MobileServiceCardComponent, MobileServiceDto } from '../../shared/components/discovery/service-card.component';

@Component({
  selector: 'waasha-mobile-provider-profile',
  standalone: true,
  imports: [CommonModule, RouterLink, MobileServiceCardComponent],
  template: `
    <div class="wa-profile">
      <a routerLink="/marketplace" class="wa-back">← Back to marketplace</a>

      <div *ngIf="loading" class="wa-card wa-loading" role="status">Loading provider…</div>

      <div *ngIf="error && !loading" class="wa-card wa-error" role="alert">
        <p class="wa-error__title">Couldn't load provider</p>
        <p class="wa-error__msg">{{ error }}</p>
        <div class="wa-error__actions">
          <button type="button" class="wa-btn wa-btn-primary" (click)="retry()">Retry</button>
          <a routerLink="/marketplace" class="wa-btn wa-btn-ghost">Back to marketplace</a>
        </div>
      </div>

      <ng-container *ngIf="!loading && !error && provider">
        <section class="wa-card">
          <div class="wa-id">
            <div class="wa-avatar">
              <img *ngIf="provider.profileImageUrl; else fb" [src]="provider.profileImageUrl" [alt]="provider.displayName" class="wa-avatar__img" />
              <ng-template #fb><span class="wa-avatar__fb">{{ provider.displayName.charAt(0) | uppercase }}</span></ng-template>
            </div>
            <div>
              <div class="wa-tags">
                <span class="wa-pill wa-pill--navy">{{ tierLabel }}</span>
                <span *ngIf="provider.verificationStatus === 'VERIFIED'" class="wa-pill wa-pill--verified">◆ Verified Pro</span>
                <span *ngIf="provider.distanceKm != null" class="wa-distance">{{ provider.distanceKm | number:'1.1-1' }} km away</span>
              </div>
              <h1 class="wa-name">{{ provider.displayName }}</h1>
              <p class="wa-loc" *ngIf="provider.location as loc">
                {{ loc.city }}<span *ngIf="loc.city && loc.province">, </span>{{ loc.province }} • Coverage {{ provider.coverageRadiusKm }} km
              </p>
              <p class="wa-bio" *ngIf="provider.bio">{{ provider.bio }}</p>
            </div>
          </div>

          <div class="wa-stats">
            <div class="wa-stat">
              <span class="wa-stat__v"><span aria-hidden="true">★</span> {{ provider.rating != null ? (provider.rating | number:'1.1-1') : '—' }}</span>
              <span class="wa-stat__l">{{ provider.reviewCount }} reviews</span>
            </div>
            <div class="wa-stat">
              <span class="wa-stat__v">{{ services.length }}</span>
              <span class="wa-stat__l">services</span>
            </div>
            <div class="wa-stat">
              <span class="wa-stat__v">{{ provider.isAvailable ? 'Available' : 'Check availability' }}</span>
              <span class="wa-stat__l">status</span>
            </div>
          </div>

          <div class="wa-reviews" *ngIf="provider.reviewsSample?.length">
            <h3 class="wa-reviews__title">Recent reviews</h3>
            <div class="wa-review" *ngFor="let r of provider.reviewsSample">
              <span class="wa-review__rating">★ {{ r.rating }}</span>
              <span class="wa-review__comment">{{ r.comment || '—' }}</span>
            </div>
          </div>
        </section>

        <section aria-label="Services">
          <h2 class="wa-section-title">Services</h2>
          <p class="wa-section-sub">Max 3 images per service. Secure Checkout.</p>

          <div class="wa-service-filter" *ngIf="serviceCategories.length > 0" role="group" aria-label="Filter services by category">
            <button type="button" class="wa-pill" [class.active]="!selectedCategoryId" (click)="setCategory(null)">All</button>
            <button *ngFor="let c of serviceCategories" type="button" class="wa-pill" [class.active]="selectedCategoryId === c.id || selectedCategoryId === c.code" (click)="setCategory(c.id)">{{ c.name }}</button>
          </div>

          <div *ngIf="servicesLoading" class="wa-skeletons" role="status" aria-label="Loading services">
            <div class="wa-skeleton" *ngFor="let i of [1,2]"></div>
          </div>

          <div *ngIf="servicesError && !servicesLoading" class="wa-card wa-error wa-error--inline" role="alert">
            <p class="wa-error__title">Couldn't load services</p>
            <p class="wa-error__msg">{{ servicesError }}</p>
            <button type="button" class="wa-btn wa-btn-primary" (click)="loadServices()">Retry</button>
          </div>

          <div *ngIf="!servicesLoading && !servicesError && services.length === 0" class="wa-card wa-empty">
            <p class="wa-empty__title">{{ selectedCategoryId ? 'No services in this category' : 'No active services yet' }}</p>
            <p class="wa-empty__sub">{{ selectedCategoryId ? 'Try another category.' : "This provider hasn't published services." }}</p>
            <button *ngIf="selectedCategoryId" type="button" class="wa-btn wa-btn-ghost" style="margin-top:10px; width:100%" (click)="setCategory(null)">Clear filter</button>
          </div>

          <div *ngIf="!servicesLoading && !servicesError && services.length > 0" class="wa-services">
            <a *ngFor="let svc of services" [routerLink]="['/marketplace/provider', provider.id, 'service', svc.id]" class="wa-service-link" [attr.aria-label]="'View service ' + svc.name">
              <waasha-mobile-service-card [service]="svc" [providerId]="provider.id" />
            </a>
          </div>
        </section>
      </ng-container>
    </div>
  `,
  styles: [`
    .wa-profile { display: flex; flex-direction: column; gap: 14px; padding: 12px 16px 24px; max-width: 560px; margin: 0 auto; }
    .wa-back { font-size: 13px; font-weight: 700; color: #0B1F33; text-decoration: none; }
    .wa-card { background: white; border: 1px solid #E2E8F0; border-radius: 16px; padding: 16px; box-shadow: 0 1px 2px rgba(16,24,40,0.04); }
    .wa-loading { text-align: center; font-size: 13px; color: #667085; }
    .wa-error { background: #FEF2F2; border-color: #FECACA; }
    .wa-error__title { margin: 0; font-weight: 800; color: #991B1B; font-size: 13px; }
    .wa-error__msg { margin: 6px 0 10px; font-size: 13px; color: #991B1B; }
    .wa-btn { display: inline-flex; align-items: center; justify-content: center; padding: 10px 14px; border-radius: 12px; border: 0; font-weight: 700; font-size: 13px; cursor: pointer; }
    .wa-btn-primary { background: #0B1F33; color: white; width: 100%; }
    .wa-id { display: flex; gap: 12px; }
    .wa-avatar { width: 56px; height: 56px; border-radius: 12px; background: #F6F8FA; border: 1px solid #E2E8F0; display: grid; place-items: center; overflow: hidden; flex-shrink: 0; }
    .wa-avatar__img { width: 100%; height: 100%; object-fit: cover; }
    .wa-avatar__fb { font-weight: 800; color: #0B1F33; }
    .wa-tags { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 6px; }
    .wa-pill { padding: 3px 8px; border-radius: 999px; font-size: 10px; font-weight: 700; }
    .wa-pill--navy { background: #0B1F33; color: white; }
    .wa-pill--verified { background: rgba(25,182,165,0.12); color: #0E7A6E; border: 1px solid rgba(25,182,165,0.25); }
    .wa-distance { background: #E6F7F5; color: #0E7A6E; padding: 3px 8px; border-radius: 999px; font-size: 10px; font-weight: 700; }
    .wa-name { margin: 0; font-size: 18px; font-weight: 800; color: #0B1F33; letter-spacing: -0.02em; }
    .wa-loc { margin: 4px 0 0; font-size: 12px; color: #667085; }
    .wa-bio { margin: 8px 0 0; font-size: 13px; color: #17212B; line-height: 1.6; }
    .wa-stats { display: flex; gap: 14px; border-top: 1px solid #E2E8F0; padding-top: 12px; margin-top: 12px; }
    .wa-stat { display: flex; flex-direction: column; gap: 2px; }
    .wa-stat__v { font-size: 13px; font-weight: 800; color: #0B1F33; }
    .wa-stat__l { font-size: 10px; color: #667085; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; }
    .wa-reviews { border-top: 1px solid #E2E8F0; padding-top: 12px; margin-top: 12px; display: flex; flex-direction: column; gap: 6px; }
    .wa-reviews__title { margin: 0; font-size: 11px; font-weight: 800; letter-spacing: 0.04em; text-transform: uppercase; color: #0B1F33; }
    .wa-review { display: flex; gap: 8px; font-size: 12px; color: #667085; }
    .wa-review__rating { font-weight: 700; color: #0B1F33; flex-shrink: 0; }
    .wa-section-title { margin: 8px 0 0; font-size: 15px; font-weight: 800; color: #0B1F33; }
    .wa-section-sub { margin: 2px 0 10px; font-size: 11px; color: #667085; }
    .wa-empty { text-align: center; }
    .wa-empty__title { margin: 0; font-weight: 800; color: #0B1F33; font-size: 13px; }
    .wa-empty__sub { margin: 6px 0 0; font-size: 12px; color: #667085; }
    .wa-services { display: flex; flex-direction: column; gap: 10px; }
    .wa-service-filter { display: flex; gap: 6px; overflow-x: auto; padding: 4px 0 8px; scrollbar-width: none; }
    .wa-service-filter .wa-pill { padding: 6px 10px; border-radius: 999px; border: 1px solid #E2E8F0; background: white; font-size: 11px; font-weight: 700; color: #667085; cursor: pointer; flex-shrink: 0; }
    .wa-service-filter .wa-pill.active { background: #0B1F33; color: white; border-color: #0B1F33; }
    .wa-skeletons { display: flex; flex-direction: column; gap: 10px; }
    .wa-skeleton { height: 120px; border-radius: 16px; background: linear-gradient(90deg, #F1F5F9 25%, #E2E8F0 37%, #F1F5F9 63%); background-size: 400% 100%; animation: shimmer 1.4s ease infinite; border: 1px solid #E2E8F0; }
    @keyframes shimmer { 0% { background-position: 100% 0; } 100% { background-position: 0 0; } }
    .wa-error--inline { text-align: center; }
    .wa-error__actions { display: flex; gap: 8px; margin-top: 8px; }
    .wa-btn-ghost { background: #F6F8FA; color: #0B1F33; border: 1px solid #E2E8F0; width: 100%; }
    .wa-service-link { text-decoration: none; color: inherit; display: block; }
    .wa-service-link:focus-visible { outline: 2px solid #19B6A5; outline-offset: 2px; border-radius: 16px; }
  `]
})
export class ProviderProfilePage implements OnInit {
  private readonly marketplace = inject(MarketplaceService);
  private readonly locationService = inject(CustomerLocationService);
  private readonly discovery = inject(DiscoveryService);
  private readonly route = inject(ActivatedRoute);

  provider: ProviderProfileDto | null = null;
  loading = true;
  error: string | null = null;
  private providerId = '';

  services: MobileServiceDto[] = [];
  servicesLoading = false;
  servicesError: string | null = null;
  selectedCategoryId: string | null = null;
  serviceCategories: ServiceCategory[] = [];

  get tierLabel(): string {
    if (!this.provider) return '';
    if (this.provider.tierCode === 'T3' || this.provider.tier?.code === 'T3') return 'T3 Business';
    if (this.provider.tierCode === 'T2' || this.provider.tier?.code === 'T2') return 'T2 Team';
    return 'T1 Solo Pro';
  }

  ngOnInit(): void {
    this.providerId = this.route.snapshot.paramMap.get('providerId') ?? this.route.snapshot.paramMap.get('id') ?? '';
    this.route.paramMap.subscribe((pm) => {
      const next = pm.get('providerId') ?? pm.get('id') ?? '';
      if (next && next !== this.providerId) { this.providerId = next; this.load(); }
    });
    this.load();
    this.discovery.fetchCategories().subscribe({ next: (res) => this.serviceCategories = res.data, error: () => {} });
  }

  retry(): void { this.load(); }
  setCategory(catId: string | null): void { this.selectedCategoryId = catId; this.loadServices(); }

  loadServices(): void {
    if (!this.providerId) return;
    this.servicesLoading = true; this.servicesError = null;
    this.marketplace.fetchProviderServices(this.providerId, { categoryId: this.selectedCategoryId ?? undefined, page: 1, perPage: 50 }).subscribe({
      next: (res) => { this.servicesLoading = false; this.services = (res.data ?? []).filter((s) => s.status === 'ACTIVE').map((s) => ({ ...s, images: (s.images ?? []).slice(0,3) } as MobileServiceDto)); },
      error: (err) => { this.servicesLoading = false; const raw = err?.error?.error?.message ?? err?.message ?? 'Failed to load services'; this.servicesError = raw.includes('SQL') || raw.includes('prisma') ? 'Something went wrong. Please try again.' : raw; },
    });
  }

  private load(): void {
    if (!this.providerId) { this.loading = false; this.error = 'Invalid provider identifier'; return; }
    this.loading = true; this.error = null;
    const qLat = this.route.snapshot.queryParamMap.get('lat');
    const qLng = this.route.snapshot.queryParamMap.get('lng');
    let loc: { latitude: number; longitude: number } | undefined;
    if (qLat && qLng) { const lat = Number(qLat); const lng = Number(qLng); if (Number.isFinite(lat) && Number.isFinite(lng)) loc = { latitude: lat, longitude: lng }; }
    else { loc = this.locationService.snapshot; }
    this.marketplace.fetchProviderProfile(this.providerId, loc).subscribe({
      next: (res) => { this.loading = false; this.provider = res.data; this.loadServices(); },
      error: (err) => {
        this.loading = false;
        const raw = err?.error?.error?.message ?? err?.message ?? 'Failed to load provider';
        const status = err?.status;
        if (status === 404 || raw.toLowerCase().includes('not found')) this.error = 'Provider not found. It may be inactive or the link is incorrect.';
        else this.error = raw.includes('SQL') || raw.includes('prisma') ? 'Something went wrong. Please try again.' : raw;
      },
    });
  }
}

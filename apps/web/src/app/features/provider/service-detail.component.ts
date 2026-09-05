import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MarketplaceService } from '../../core/services/marketplace.service';
import { ServiceDto, ProviderProfileDto } from '../../core/models/discovery-radius.model';

@Component({
  selector: 'waasha-service-detail',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <div class="wa-detail">
      <a [routerLink]="['/marketplace/provider', providerId]" class="wa-back" aria-label="Back to provider profile">
        <span aria-hidden="true">←</span> Back to provider
      </a>

      <!-- loading -->
      <div *ngIf="loading" class="wa-card wa-loading" role="status" aria-label="Loading service">
        <div class="wa-skeleton wa-skeleton--title"></div>
        <div class="wa-skeleton wa-skeleton--line"></div>
        <div class="wa-skeleton wa-skeleton--grid"></div>
      </div>

      <!-- not found / error -->
      <div *ngIf="error && !loading" class="wa-card wa-error" role="alert">
        <p class="wa-error__title">{{ errorTitle }}</p>
        <p class="wa-error__msg">{{ errorMsg }}</p>
        <div class="wa-error__actions">
          <button type="button" class="wa-btn wa-btn-primary wa-btn--navy" (click)="retry()">Retry</button>
          <a routerLink="/marketplace" class="wa-btn wa-btn-ghost">Back to marketplace</a>
        </div>
      </div>

      <!-- service detail -->
      <ng-container *ngIf="!loading && !error && service">
        <section class="wa-card wa-detail__header" [attr.aria-label]="service.name">
          <div class="wa-detail__top">
            <div>
              <div class="wa-detail__tags">
                <span class="wa-pill wa-pill--teal" *ngIf="service.category as cat">{{ cat.name }}</span>
                <span class="wa-pill" [ngClass]="service.status === 'ACTIVE' ? 'wa-pill--ok' : 'wa-pill--bad'">{{ service.status }}</span>
                <span class="wa-pill wa-pill--muted"><span aria-hidden="true">◷</span> {{ service.durationMinutes }} min</span>
                <span class="wa-pill wa-pill--muted">{{ serviceModeLabel }}</span>
              </div>
              <h1 class="wa-detail__title">{{ service.name }}</h1>
              <p class="wa-detail__desc" *ngIf="service.description">{{ service.description }}</p>
              <p class="wa-detail__desc wa-detail__desc--empty" *ngIf="!service.description">No description provided.</p>
            </div>
            <div class="wa-detail__price-block">
              <div class="wa-detail__price">R{{ service.price }}</div>
              <div class="wa-detail__currency">{{ service.currency }}</div>
              <div class="wa-detail__price-note">Secure Checkout</div>
            </div>
          </div>

          <div class="wa-detail__images" *ngIf="service.images?.length">
            <div class="wa-detail__img" *ngFor="let img of service.images.slice(0,3); trackBy: trackImg" role="img" [attr.aria-label]="'Image for ' + service.name">
              <img [src]="img.imageUrl" [alt]="service.name" loading="lazy" class="wa-detail__img-el" />
            </div>
          </div>
          <div class="wa-detail__noimg" *ngIf="!service.images?.length">
            <span aria-hidden="true">🖼️</span> No images — provider can add up to 3 images per service
          </div>

          <p class="wa-detail__provider" *ngIf="providerName">
            Offered by <a [routerLink]="['/marketplace/provider', providerId]" class="wa-link">{{ providerName }}</a>
            <span *ngIf="providerCity"> • {{ providerCity }}</span>
          </p>
        </section>

        <section class="wa-card wa-detail__cta" aria-label="Booking action">
          <h2 class="wa-detail__cta-title">Ready to book?</h2>
          <p class="wa-detail__cta-sub">Choose a date and time in the next step. Availability and booking remain server-authoritative.</p>
          <button
            type="button"
            class="wa-btn wa-btn-primary wa-btn--navy wa-detail__cta-btn"
            aria-label="Choose date and time for {{ service.name }}"
            (click)="onChooseDateTime()"
          >
            Choose Date & Time
          </button>
          <p class="wa-detail__cta-note">Availability selection will be added in the next slice — no booking created yet.</p>
        </section>
      </ng-container>
    </div>
  `,
  styles: [`
    .wa-detail { display: flex; flex-direction: column; gap: 16px; max-width: 860px; margin: 0 auto; }
    .wa-back { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 700; color: var(--waasha-navy); text-decoration: none; }
    .wa-back:hover { text-decoration: underline; }
    .wa-card { background: white; border: 1px solid var(--waasha-border); border-radius: var(--waasha-radius); padding: 20px; box-shadow: 0 1px 2px rgba(11,31,51,0.04); }
    .wa-loading { display: flex; flex-direction: column; gap: 12px; }
    .wa-skeleton { height: 18px; border-radius: 8px; background: linear-gradient(90deg, #F1F5F9 25%, #E2E8F0 37%, #F1F5F9 63%); background-size: 400% 100%; animation: shimmer 1.4s ease infinite; }
    .wa-skeleton--title { height: 28px; width: 50%; }
    .wa-skeleton--line { height: 14px; width: 70%; }
    .wa-skeleton--grid { height: 160px; }
    @keyframes shimmer { 0% { background-position: 100% 0; } 100% { background-position: 0 0; } }
    .wa-error { background: #FEF2F2; border-color: #FECACA; }
    .wa-error__title { margin: 0; font-weight: 800; color: #991B1B; font-size: 14px; }
    .wa-error__msg { margin: 6px 0 12px; font-size: 13px; color: #991B1B; }
    .wa-error__actions { display: flex; gap: 8px; flex-wrap: wrap; }
    .wa-detail__header { display: flex; flex-direction: column; gap: 16px; }
    .wa-detail__top { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; }
    @media (max-width: 640px) { .wa-detail__top { flex-direction: column; } }
    .wa-detail__tags { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 8px; }
    .wa-pill { display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px; border-radius: 999px; font-size: 11px; font-weight: 700; }
    .wa-pill--teal { background: #E6F7F5; color: #0E7A6E; border: 1px solid #B9E8E2; }
    .wa-pill--muted { background: #F1F5F9; color: var(--waasha-navy); border: 1px solid var(--waasha-border); }
    .wa-pill--ok { background: #ECFDF5; color: #065F46; border: 1px solid #A7F3D0; }
    .wa-pill--bad { background: #FEF2F2; color: #991B1B; border: 1px solid #FECACA; }
    .wa-detail__title { margin: 0; font-size: 24px; font-weight: 800; color: var(--waasha-navy); letter-spacing: -0.02em; }
    .wa-detail__desc { margin: 8px 0 0; font-size: 14px; color: var(--waasha-muted); line-height: 1.6; }
    .wa-detail__desc--empty { font-style: italic; }
    .wa-detail__price-block { text-align: right; flex-shrink: 0; min-width: 110px; }
    .wa-detail__price { font-size: 26px; font-weight: 800; color: var(--waasha-navy); }
    .wa-detail__currency { font-size: 11px; color: var(--waasha-muted); font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; }
    .wa-detail__price-note { margin-top: 4px; font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--waasha-teal); }
    .wa-detail__images { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
    .wa-detail__img { aspect-ratio: 1; border-radius: 14px; overflow: hidden; background: var(--waasha-bg); border: 1px solid var(--waasha-border); }
    .wa-detail__img-el { width: 100%; height: 100%; object-fit: cover; }
    .wa-detail__noimg { display: grid; place-items: center; height: 110px; border-radius: 12px; background: var(--waasha-bg); border: 1px dashed var(--waasha-border); color: var(--waasha-muted); font-size: 12px; }
    .wa-detail__provider { margin: 0; font-size: 12px; color: var(--waasha-muted); }
    .wa-link { color: var(--waasha-teal); font-weight: 700; text-decoration: none; }
    .wa-link:hover { text-decoration: underline; }
    .wa-detail__cta { display: flex; flex-direction: column; gap: 10px; align-items: center; text-align: center; }
    .wa-detail__cta-title { margin: 0; font-size: 16px; font-weight: 800; color: var(--waasha-navy); }
    .wa-detail__cta-sub { margin: 0; font-size: 13px; color: var(--waasha-muted); line-height: 1.5; max-width: 520px; }
    .wa-detail__cta-btn { min-width: 260px; padding: 12px 20px; border-radius: 12px; font-size: 14px; }
    .wa-detail__cta-note { margin: 0; font-size: 11px; color: var(--waasha-muted); }
    .wa-btn--navy { background: var(--waasha-navy); color: white; border: 1px solid var(--waasha-navy); }
    .wa-btn--navy:hover { background: #132B4A; }
    .wa-btn-ghost { background: #F6F8FA; color: var(--waasha-navy); border: 1px solid var(--waasha-border); text-decoration: none; display: inline-flex; align-items: center; justify-content: center; padding: 9px 14px; border-radius: 12px; font-weight: 700; font-size: 13px; }
  `]
})
export class ServiceDetailComponent implements OnInit {
  private readonly marketplace = inject(MarketplaceService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  providerId = '';
  serviceId = '';
  service: ServiceDto | null = null;
  providerName: string | null = null;
  providerCity: string | null = null;
  loading = true;
  error = false;
  errorTitle = '';
  errorMsg = '';

  get serviceModeLabel(): string {
    if (!this.service) return '';
    if (this.service.serviceMode === 'PROVIDER_LOCATION') return 'At provider';
    if (this.service.serviceMode === 'CUSTOMER_LOCATION') return 'Home visit';
    return 'Provider or home';
  }

  ngOnInit(): void {
    this.providerId = this.route.snapshot.paramMap.get('providerId') ?? this.route.snapshot.paramMap.get('id') ?? '';
    this.serviceId = this.route.snapshot.paramMap.get('serviceId') ?? '';
    this.load();
    // also try to load provider name for context (best-effort)
    if (this.providerId) {
      this.marketplace.fetchProviderProfile(this.providerId).subscribe({
        next: (res: { data: ProviderProfileDto }) => {
          this.providerName = res.data.displayName;
          this.providerCity = res.data.location?.city ?? null;
        },
        error: () => {},
      });
    }
  }

  retry(): void { this.load(); }

  onChooseDateTime(): void {
    if (!this.providerId || !this.serviceId) return;
    this.router.navigate(['/marketplace/provider', this.providerId, 'service', this.serviceId, 'book']);
  }

  trackImg(_: number, img: { id: string }): string { return img.id; }

  private load(): void {
    if (!this.providerId || !this.serviceId) {
      this.loading = false;
      this.error = true;
      this.errorTitle = 'Invalid service link';
      this.errorMsg = 'The service address is missing a provider or service identifier.';
      return;
    }
    this.loading = true;
    this.error = false;
    this.marketplace.fetchServiceDetail(this.providerId, this.serviceId).subscribe({
      next: (res) => {
        this.loading = false;
        this.service = res.data;
        // ensure images capped at 3 (backend does, frontend also)
        if (this.service.images && this.service.images.length > 3) {
          this.service = { ...this.service, images: this.service.images.slice(0, 3) };
        }
      },
      error: (err) => {
        this.loading = false;
        this.error = true;
        const status = err?.status;
        const backendMsg = err?.error?.error?.message ?? err?.message ?? '';
        if (status === 404 || backendMsg.toLowerCase().includes('not found')) {
          this.errorTitle = 'Service not found';
          this.errorMsg = 'This service is no longer available or the link is incorrect.';
        } else if (backendMsg.includes('SQL') || backendMsg.includes('prisma')) {
          this.errorTitle = 'Something went wrong';
          this.errorMsg = 'Please try again. If the problem continues, return to the marketplace.';
        } else {
          this.errorTitle = 'Couldn\'t load service';
          this.errorMsg = backendMsg || 'Please try again.';
        }
      },
    });
  }
}

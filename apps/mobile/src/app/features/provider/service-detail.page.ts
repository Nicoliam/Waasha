import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { MarketplaceService } from '../../core/services/marketplace.service';
import { ServiceDto } from '../../core/services/marketplace.service';

@Component({
  selector: 'waasha-mobile-service-detail',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <div class="wa-detail">
      <a [routerLink]="['/marketplace/provider', providerId]" class="wa-back">← Back to provider</a>

      <div *ngIf="loading" class="wa-card wa-loading" role="status">Loading service…</div>

      <div *ngIf="error && !loading" class="wa-card wa-error" role="alert">
        <p class="wa-error__title">{{ errorTitle }}</p>
        <p class="wa-error__msg">{{ errorMsg }}</p>
        <div class="wa-error__actions">
          <button type="button" class="wa-btn wa-btn-primary" (click)="retry()">Retry</button>
          <a routerLink="/discovery" class="wa-btn wa-btn-ghost">Back to marketplace</a>
        </div>
      </div>

      <ng-container *ngIf="!loading && !error && service">
        <section class="wa-card">
          <div class="wa-tags">
            <span class="wa-pill wa-pill--teal" *ngIf="service.category as cat">{{ cat.name }}</span>
            <span class="wa-pill" [ngClass]="service.status === 'ACTIVE' ? 'wa-pill--ok' : 'wa-pill--bad'">{{ service.status }}</span>
            <span class="wa-pill">{{ service.durationMinutes }} min</span>
            <span class="wa-pill">{{ serviceModeLabel }}</span>
          </div>
          <h1 class="wa-title">{{ service.name }}</h1>
          <p class="wa-desc" *ngIf="service.description">{{ service.description }}</p>
          <p class="wa-desc wa-desc--empty" *ngIf="!service.description">No description provided.</p>

          <div class="wa-price-row">
            <div>
              <div class="wa-price">R{{ service.price }}</div>
              <div class="wa-currency">{{ service.currency }}</div>
            </div>
            <span class="wa-secure">Secure Checkout</span>
          </div>

          <div class="wa-images" *ngIf="service.images?.length">
            <div class="wa-img" *ngFor="let img of service.images.slice(0,3)">
              <img [src]="img.imageUrl" [alt]="service.name" loading="lazy" />
            </div>
          </div>
          <div class="wa-noimg" *ngIf="!service.images?.length">🖼️ No images — up to 3 images per service</div>
          <p class="wa-provider" *ngIf="providerName">Offered by {{ providerName }}</p>
        </section>

        <section class="wa-card wa-cta">
          <h2 class="wa-cta__title">Ready to book?</h2>
          <p class="wa-cta__sub">Choose a date and time in the next step. Availability is server-authoritative.</p>
          <button type="button" class="wa-btn wa-btn-primary" aria-label="Choose date and time for {{ service.name }}" (click)="onChooseDateTime()">
            Choose Date & Time
          </button>
          <p class="wa-cta__note">Availability selection will be added in the next slice.</p>
        </section>
      </ng-container>
    </div>
  `,
  styles: [`
    .wa-detail { display: flex; flex-direction: column; gap: 14px; padding: 12px 16px 24px; max-width: 560px; margin: 0 auto; }
    .wa-back { font-size: 13px; font-weight: 700; color: #0B1F33; text-decoration: none; }
    .wa-card { background: white; border: 1px solid #E2E8F0; border-radius: 16px; padding: 16px; box-shadow: 0 1px 2px rgba(16,24,40,0.04); }
    .wa-loading { text-align: center; font-size: 13px; color: #667085; }
    .wa-error { background: #FEF2F2; border-color: #FECACA; }
    .wa-error__title { margin: 0; font-weight: 800; color: #991B1B; font-size: 13px; }
    .wa-error__msg { margin: 6px 0 10px; font-size: 13px; color: #991B1B; }
    .wa-error__actions { display: flex; gap: 8px; }
    .wa-btn { display: inline-flex; align-items: center; justify-content: center; padding: 10px 14px; border-radius: 12px; border: 0; font-weight: 700; font-size: 13px; cursor: pointer; text-decoration: none; }
    .wa-btn-primary { background: #0B1F33; color: white; width: 100%; }
    .wa-btn-ghost { background: #F6F8FA; color: #0B1F33; border: 1px solid #E2E8F0; width: 100%; }
    .wa-tags { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 8px; }
    .wa-pill { padding: 3px 8px; border-radius: 999px; font-size: 10px; font-weight: 700; border: 1px solid #E2E8F0; background: #F6F8FA; color: #667085; }
    .wa-pill--teal { background: #E6F7F5; color: #0E7A6E; border-color: #B9E8E2; }
    .wa-pill--ok { background: #ECFDF5; color: #065F46; border-color: #A7F3D0; }
    .wa-pill--bad { background: #FEF2F2; color: #991B1B; border-color: #FECACA; }
    .wa-title { margin: 0; font-size: 20px; font-weight: 800; color: #0B1F33; letter-spacing: -0.02em; }
    .wa-desc { margin: 8px 0 0; font-size: 13px; color: #667085; line-height: 1.6; }
    .wa-desc--empty { font-style: italic; }
    .wa-price-row { display: flex; justify-content: space-between; align-items: center; margin-top: 12px; padding: 10px 12px; background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 12px; }
    .wa-price { font-size: 20px; font-weight: 800; color: #0B1F33; }
    .wa-currency { font-size: 10px; color: #667085; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; }
    .wa-secure { font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: #19B6A5; }
    .wa-images { display: grid; grid-template-columns: repeat(3,1fr); gap: 8px; margin-top: 12px; }
    .wa-img { aspect-ratio: 1; border-radius: 12px; overflow: hidden; background: #F6F8FA; border: 1px solid #E2E8F0; }
    .wa-img img { width: 100%; height: 100%; object-fit: cover; }
    .wa-noimg { margin-top: 12px; display: grid; place-items: center; height: 90px; border-radius: 12px; background: #F6F8FA; border: 1px dashed #E2E8F0; color: #667085; font-size: 12px; }
    .wa-provider { margin: 10px 0 0; font-size: 12px; color: #667085; }
    .wa-cta { display: flex; flex-direction: column; gap: 8px; align-items: center; text-align: center; }
    .wa-cta__title { margin: 0; font-size: 15px; font-weight: 800; color: #0B1F33; }
    .wa-cta__sub { margin: 0; font-size: 12px; color: #667085; line-height: 1.5; }
    .wa-cta__note { margin: 0; font-size: 10px; color: #667085; }
  `]
})
export class MobileServiceDetailPage implements OnInit {
  private readonly marketplace = inject(MarketplaceService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  providerId = '';
  serviceId = '';
  service: ServiceDto | null = null;
  providerName: string | null = null;
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
    if (this.providerId) {
      this.marketplace.fetchProviderProfile(this.providerId).subscribe({
        next: (res) => this.providerName = res.data.displayName,
        error: () => {},
      });
    }
  }

  retry(): void { this.load(); }
  onChooseDateTime(): void {
    if (!this.providerId || !this.serviceId) return;
    this.router.navigate(['/marketplace/provider', this.providerId, 'service', this.serviceId, 'book']);
  }

  private load(): void {
    if (!this.providerId || !this.serviceId) {
      this.loading = false; this.error = true;
      this.errorTitle = 'Invalid service link'; this.errorMsg = 'Missing provider or service identifier.'; return;
    }
    this.loading = true; this.error = false;
    this.marketplace.fetchServiceDetail(this.providerId, this.serviceId).subscribe({
      next: (res) => { this.loading = false; this.service = res.data; if (this.service.images.length > 3) this.service = { ...this.service, images: this.service.images.slice(0,3) }; },
      error: (err) => {
        this.loading = false; this.error = true;
        const status = err?.status; const msg = err?.error?.error?.message ?? err?.message ?? '';
        if (status === 404 || msg.toLowerCase().includes('not found')) { this.errorTitle = 'Service not found'; this.errorMsg = 'This service is no longer available.'; }
        else if (msg.includes('SQL') || msg.includes('prisma')) { this.errorTitle = 'Something went wrong'; this.errorMsg = 'Please try again.'; }
        else { this.errorTitle = "Couldn't load service"; this.errorMsg = msg || 'Please try again.'; }
      },
    });
  }
}

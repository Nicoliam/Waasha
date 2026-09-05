import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';

export interface MobileServiceDto {
  id: string;
  uuid: string;
  name: string;
  description?: string | null;
  price: number;
  currency: string;
  durationMinutes: number;
  serviceMode: string;
  status: string;
  category?: { id: string; code: string; name: string } | null;
  images: Array<{ id: string; imageUrl: string; sortOrder: number }>;
}

@Component({
  selector: 'waasha-mobile-service-card',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <article class="wa-service" [attr.aria-label]="service.name">
      <div class="wa-service__head">
        <div>
          <h4 class="wa-service__title">{{ service.name }}</h4>
          <p class="wa-service__cat" *ngIf="service.category as cat">{{ cat.name }}</p>
          <p class="wa-service__desc" *ngIf="service.description">{{ service.description }}</p>
        </div>
        <div class="wa-service__price">
          <div class="wa-price">R{{ service.price }}</div>
          <div class="wa-currency">{{ service.currency }}</div>
        </div>
      </div>

      <div class="wa-meta">
        <span class="wa-pill">{{ service.durationMinutes }} min</span>
        <span class="wa-pill">{{ serviceModeLabel }}</span>
        <span class="wa-pill wa-pill--ok" *ngIf="service.status === 'ACTIVE'">Available</span>
        <span class="wa-pill wa-pill--bad" *ngIf="service.status !== 'ACTIVE'">{{ service.status }}</span>
      </div>

      <div class="wa-images" *ngIf="service.images?.length">
        <div class="wa-img" *ngFor="let img of service.images.slice(0,3)">
          <img [src]="img.imageUrl" [alt]="service.name" loading="lazy" />
        </div>
      </div>
      <div class="wa-noimg" *ngIf="!service.images?.length">🖼️ No image — polished fallback</div>

      <a
        *ngIf="providerId && service.status === 'ACTIVE'"
        class="wa-btn wa-btn-primary wa-btn--link"
        [routerLink]="['/marketplace/provider', providerId, 'service', service.id]"
        [attr.aria-label]="'View service ' + service.name + ' details'"
      >
        Choose Date & Time
      </a>
      <button *ngIf="!providerId || service.status !== 'ACTIVE'" type="button" class="wa-btn wa-btn-primary" [disabled]="service.status !== 'ACTIVE'">
        {{ service.status === 'ACTIVE' ? 'Choose Date & Time' : 'Unavailable' }}
      </button>
      <p class="wa-note">Availability lands in the next slice.</p>
    </article>
  `,
  styles: [`
    .wa-service { background: white; border: 1px solid #E2E8F0; border-radius: 16px; padding: 14px; display: flex; flex-direction: column; gap: 10px; }
    .wa-service__head { display: flex; justify-content: space-between; gap: 12px; }
    .wa-service__title { margin: 0; font-size: 14px; font-weight: 800; color: #0B1F33; }
    .wa-service__cat { margin: 2px 0 0; font-size: 10px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: #19B6A5; }
    .wa-service__desc { margin: 6px 0 0; font-size: 12px; color: #667085; line-height: 1.5; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .wa-service__price { text-align: right; flex-shrink: 0; }
    .wa-price { font-weight: 800; color: #0B1F33; font-size: 16px; }
    .wa-currency { font-size: 10px; color: #667085; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; }
    .wa-meta { display: flex; gap: 6px; flex-wrap: wrap; }
    .wa-pill { padding: 4px 8px; border-radius: 999px; border: 1px solid #E2E8F0; background: #F6F8FA; font-size: 11px; font-weight: 600; color: #667085; }
    .wa-pill--ok { background: #ECFDF5; border-color: #A7F3D0; color: #065F46; }
    .wa-pill--bad { background: #FEF2F2; border-color: #FECACA; color: #991B1B; }
    .wa-images { display: grid; grid-template-columns: repeat(3,1fr); gap: 6px; }
    .wa-img { aspect-ratio: 1; border-radius: 10px; overflow: hidden; background: #F6F8FA; border: 1px solid #E2E8F0; }
    .wa-img img { width: 100%; height: 100%; object-fit: cover; }
    .wa-noimg { display: grid; place-items: center; height: 80px; border-radius: 10px; background: #F6F8FA; border: 1px dashed #E2E8F0; color: #667085; font-size: 12px; }
    .wa-btn { width: 100%; padding: 10px 14px; border-radius: 12px; border: 0; font-weight: 700; font-size: 13px; cursor: pointer; text-decoration: none; display: inline-flex; align-items: center; justify-content: center; }
    .wa-btn-primary { background: #0B1F33; color: white; }
    .wa-btn--link { cursor: pointer; }
    .wa-btn-primary:disabled { opacity: 0.6; }
    .wa-note { margin: 0; font-size: 10px; color: #667085; text-align: center; }
  `]
})
export class MobileServiceCardComponent {
  @Input({ required: true }) service!: MobileServiceDto;
  @Input() providerId?: string | null = null;
  get serviceModeLabel(): string {
    if (this.service.serviceMode === 'PROVIDER_LOCATION') return 'At provider';
    if (this.service.serviceMode === 'CUSTOMER_LOCATION') return 'Home visit';
    return 'Provider or home';
  }
}

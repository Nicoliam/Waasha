import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ServiceDto } from '../../../core/models/discovery-radius.model';

@Component({
  selector: 'waasha-service-card',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <article class="wa-service-card" [attr.aria-label]="service.name">
      <div class="wa-service-card__header">
        <div>
          <h4 class="wa-service-card__title">{{ service.name }}</h4>
          <p class="wa-service-card__category" *ngIf="service.category as cat">
            {{ cat.name }}
          </p>
          <p class="wa-service-card__desc" *ngIf="service.description">
            {{ service.description }}
          </p>
        </div>
        <div class="wa-service-card__price-block">
          <div class="wa-service-price">R{{ service.price }}</div>
          <div class="wa-service-currency">{{ service.currency }}</div>
        </div>
      </div>

      <div class="wa-service-card__meta">
        <span class="wa-meta-pill">
          <span aria-hidden="true">◷</span> {{ service.durationMinutes }} min
        </span>
        <span class="wa-meta-pill" *ngIf="service.serviceMode">
          {{ serviceModeLabel }}
        </span>
        <span class="wa-meta-pill wa-meta-pill--avail" *ngIf="service.status === 'ACTIVE'">
          Available
        </span>
        <span class="wa-meta-pill wa-meta-pill--paused" *ngIf="service.status !== 'ACTIVE'">
          {{ service.status }}
        </span>
      </div>

      <div class="wa-service-card__images" *ngIf="service.images?.length">
        <div
          class="wa-service-img"
          *ngFor="let img of service.images.slice(0,3); trackBy: trackImg"
          role="img"
          [attr.aria-label]="'Image for ' + service.name"
        >
          <img [src]="img.imageUrl" [alt]="service.name" loading="lazy" class="wa-service-img__el" />
        </div>
      </div>
      <div class="wa-service-card__fallback" *ngIf="!service.images?.length">
        <span aria-hidden="true">🖼️</span> No image — polished fallback
      </div>

      <a
        *ngIf="providerId && service.status === 'ACTIVE'"
        class="wa-btn wa-btn-primary wa-btn--navy wa-service-cta wa-service-cta--link"
        [routerLink]="['/marketplace/provider', providerId, 'service', service.id]"
        [attr.aria-label]="'View service ' + service.name + ' details'"
      >
        Choose Date & Time
      </a>
      <button
        *ngIf="!providerId || service.status !== 'ACTIVE'"
        type="button"
        class="wa-btn wa-btn-primary wa-btn--navy wa-service-cta"
        [disabled]="service.status !== 'ACTIVE'"
        [attr.aria-label]="'Select service ' + service.name"
      >
        {{ service.status === 'ACTIVE' ? 'Choose Date & Time' : 'Unavailable' }}
      </button>
      <p class="wa-service-note">Availability selection lands in the next slice.</p>
    </article>
  `,
  styles: [`
    .wa-service-card { background: white; border: 1px solid var(--waasha-border); border-radius: var(--waasha-radius); padding: 16px; display: flex; flex-direction: column; gap: 12px; box-shadow: 0 1px 2px rgba(11,31,51,0.04); }
    .wa-service-card__header { display: flex; justify-content: space-between; gap: 12px; }
    .wa-service-card__title { margin: 0; font-size: 15px; font-weight: 800; color: var(--waasha-navy); letter-spacing: -0.01em; }
    .wa-service-card__category { margin: 2px 0 0; font-size: 11px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--waasha-teal); }
    .wa-service-card__desc { margin: 6px 0 0; font-size: 13px; color: var(--waasha-muted); line-height: 1.5; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .wa-service-card__price-block { text-align: right; flex-shrink: 0; }
    .wa-service-price { font-size: 18px; font-weight: 800; color: var(--waasha-navy); }
    .wa-service-currency { font-size: 10px; color: var(--waasha-muted); font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; }
    .wa-service-card__meta { display: flex; gap: 6px; flex-wrap: wrap; }
    .wa-meta-pill { display: inline-flex; align-items: center; gap: 4px; padding: 4px 8px; border-radius: 999px; border: 1px solid var(--waasha-border); background: var(--waasha-bg); font-size: 11px; font-weight: 600; color: var(--waasha-muted); }
    .wa-meta-pill--avail { background: #ECFDF5; border-color: #A7F3D0; color: #065F46; }
    .wa-meta-pill--paused { background: #FEF2F2; border-color: #FECACA; color: #991B1B; }
    .wa-service-card__images { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
    .wa-service-img { aspect-ratio: 1; border-radius: 12px; overflow: hidden; background: var(--waasha-bg); border: 1px solid var(--waasha-border); }
    .wa-service-img__el { width: 100%; height: 100%; object-fit: cover; }
    .wa-service-card__fallback { display: grid; place-items: center; height: 88px; border-radius: 12px; background: var(--waasha-bg); border: 1px dashed var(--waasha-border); color: var(--waasha-muted); font-size: 12px; }
    .wa-service-cta { width: 100%; border-radius: 12px; padding: 11px 14px; text-decoration: none; display: inline-flex; align-items: center; justify-content: center; font-weight: 700; font-size: 13px; }
    .wa-service-cta--link { cursor: pointer; }
    .wa-btn--navy { background: var(--waasha-navy); color: white; border: 1px solid var(--waasha-navy); }
    .wa-service-note { margin: 0; font-size: 11px; color: var(--waasha-muted); text-align: center; }
  `]
})
export class ServiceCardComponent {
  @Input({ required: true }) service!: ServiceDto;
  @Input() providerId?: string | null = null;

  get serviceModeLabel(): string {
    if (this.service.serviceMode === 'PROVIDER_LOCATION') return 'At provider';
    if (this.service.serviceMode === 'CUSTOMER_LOCATION') return 'Home visit';
    return 'Provider or home';
  }

  trackImg(_: number, img: { id: string }): string { return img.id; }
}

import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ProviderCardDto } from '../../../core/models/discovery-radius.model';

@Component({
  selector: 'waasha-provider-card',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <article
      class="wa-provider-card"
      [attr.aria-label]="provider.displayName"
      role="article"
    >
      <!-- top row: tier + verified + distance -->
      <div class="wa-provider-card__header">
        <div class="wa-provider-card__tags">
          <span
            class="wa-pill"
            [ngClass]="{
              'wa-pill--navy': provider.tierCode === 'T3',
              'wa-pill--teal': provider.tierCode === 'T2',
              'wa-pill--muted': provider.tierCode === 'T1' || !provider.tierCode
            }"
            [attr.aria-label]="'Tier ' + (provider.tierCode || 'T1')"
          >
            <span class="wa-dot" [ngClass]="{
              'wa-dot--teal': provider.tierCode === 'T3',
              'wa-dot--navy': provider.tierCode === 'T2',
              'wa-dot--muted': provider.tierCode === 'T1' || !provider.tierCode
            }"></span>
            {{ tierLabel }}
          </span>
          <span *ngIf="provider.verificationStatus === 'VERIFIED'" class="wa-pill wa-pill--verified">
            <span aria-hidden="true">◆</span> Verified Pro
          </span>
        </div>
        <span class="wa-distance" aria-label="Distance {{ provider.distanceKm }} kilometers away">
          <span aria-hidden="true">◎</span> {{ provider.distanceKm | number:'1.1-1' }} km away
        </span>
      </div>

      <!-- title row -->
      <div class="wa-provider-card__title-row">
        <div class="wa-provider-card__identity">
          <div class="wa-avatar" aria-hidden="true">
            <img
              *ngIf="provider.profileImageUrl; else fallbackAvatar"
              [src]="provider.profileImageUrl"
              [alt]="provider.displayName"
              loading="lazy"
              class="wa-avatar__img"
            />
            <ng-template #fallbackAvatar>
              <span class="wa-avatar__fallback">{{ provider.displayName.charAt(0) | uppercase }}</span>
            </ng-template>
          </div>
          <div>
            <h3 class="wa-provider-card__name">{{ provider.displayName }}</h3>
            <p class="wa-provider-card__meta" *ngIf="provider.city || provider.province">
              {{ provider.city }}<span *ngIf="provider.city && provider.province">, </span>{{ provider.province }}
              <span *ngIf="provider.categories?.length"> • {{ provider.categories?.join(' • ') }}</span>
            </p>
            <p class="wa-provider-card__meta" *ngIf="!provider.city && provider.categories?.length">
              {{ provider.categories?.join(' • ') }}
            </p>
          </div>
        </div>
        <div *ngIf="provider.rating != null" class="wa-rating" aria-label="Rating {{ provider.rating }} out of 5, {{ provider.reviewCount }} reviews">
          <span class="wa-rating__star" aria-hidden="true">★</span>
          <span class="wa-rating__value">{{ provider.rating | number:'1.1-1' }}</span>
          <span class="wa-rating__count">({{ provider.reviewCount }})</span>
        </div>
      </div>

      <!-- pricing / service preview -->
      <div class="wa-provider-card__service" *ngIf="provider.startingPrice != null">
        <div class="wa-provider-card__service-main">
          <span class="wa-service-icon" aria-hidden="true">✦</span>
          <div>
            <div class="wa-service-title">Starting from</div>
            <div class="wa-service-sub">{{ provider.categories?.[0] || 'Service' }}</div>
          </div>
        </div>
        <div class="wa-provider-card__price">
          <div class="wa-price">R{{ provider.startingPrice }}</div>
          <span class="wa-price-tag">Secure Checkout</span>
        </div>
      </div>

      <!-- actions -->
      <div class="wa-provider-card__actions">
        <a
          class="wa-btn wa-btn-ghost wa-btn--sm"
          [routerLink]="['/marketplace/provider', provider.id]"
          [queryParams]="customerLoc ? { lat: customerLoc.latitude, lng: customerLoc.longitude } : {}"
          aria-label="View {{ provider.displayName }} profile"
        >
          Profile
        </a>
        <a
          class="wa-btn wa-btn-primary wa-btn--sm wa-btn--navy"
          [routerLink]="['/marketplace/provider', provider.id]"
          [queryParams]="customerLoc ? { lat: customerLoc.latitude, lng: customerLoc.longitude } : {}"
          [fragment]="'services'"
          aria-label="Book service with {{ provider.displayName }}"
        >
          Book Service
        </a>
      </div>
    </article>
  `,
  styles: [`
    .wa-provider-card { background: white; border: 1px solid var(--waasha-border); border-radius: var(--waasha-radius); padding: 16px; box-shadow: 0 1px 3px rgba(11,31,51,0.04); display: flex; flex-direction: column; gap: 12px; transition: box-shadow 0.15s; }
    .wa-provider-card:hover { box-shadow: 0 8px 16px -4px rgba(11,31,51,0.08); }
    .wa-provider-card__header { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; }
    .wa-provider-card__tags { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
    .wa-pill { display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px; border-radius: 999px; font-size: 11px; font-weight: 700; letter-spacing: 0.02em; }
    .wa-pill--navy { background: var(--waasha-navy); color: white; }
    .wa-pill--teal { background: #E6F7F5; color: var(--waasha-navy); border: 1px solid #B9E8E2; }
    .wa-pill--muted { background: #F1F5F9; color: var(--waasha-navy); border: 1px solid var(--waasha-border); }
    .wa-pill--verified { background: rgba(25,182,165,0.12); color: #0E7A6E; border: 1px solid rgba(25,182,165,0.25); font-size: 11px; }
    .wa-dot { width: 6px; height: 6px; border-radius: 999px; display: inline-block; }
    .wa-dot--teal { background: var(--waasha-teal); }
    .wa-dot--navy { background: var(--waasha-navy); }
    .wa-dot--muted { background: #94A3B8; }
    .wa-distance { display: inline-flex; align-items: center; gap: 4px; padding: 3px 10px; border-radius: 999px; background: #E6F7F5; color: #0E7A6E; font-size: 11px; font-weight: 700; }
    .wa-provider-card__title-row { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; }
    .wa-provider-card__identity { display: flex; gap: 12px; align-items: center; }
    .wa-avatar { width: 44px; height: 44px; border-radius: 12px; overflow: hidden; background: var(--waasha-bg); border: 1px solid var(--waasha-border); display: grid; place-items: center; flex-shrink: 0; }
    .wa-avatar__img { width: 100%; height: 100%; object-fit: cover; }
    .wa-avatar__fallback { font-weight: 800; color: var(--waasha-navy); }
    .wa-provider-card__name { margin: 0; font-size: 16px; font-weight: 800; color: var(--waasha-navy); letter-spacing: -0.015em; }
    .wa-provider-card__meta { margin: 2px 0 0; font-size: 12px; color: var(--waasha-muted); line-height: 1.4; }
    .wa-rating { display: inline-flex; align-items: center; gap: 4px; background: #FFFBEB; border: 1px solid #FDE68A; padding: 4px 8px; border-radius: 10px; flex-shrink: 0; }
    .wa-rating__star { color: #F59E0B; font-size: 13px; }
    .wa-rating__value { font-weight: 800; color: var(--waasha-navy); font-size: 13px; }
    .wa-rating__count { font-size: 11px; color: var(--waasha-muted); }
    .wa-provider-card__service { display: flex; justify-content: space-between; align-items: center; background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 12px; padding: 10px 12px; }
    .wa-provider-card__service-main { display: flex; gap: 8px; align-items: center; }
    .wa-service-icon { width: 28px; height: 28px; border-radius: 8px; background: white; border: 1px solid var(--waasha-border); display: grid; place-items: center; font-size: 12px; color: var(--waasha-teal); }
    .wa-service-title { font-size: 12px; font-weight: 700; color: var(--waasha-navy); }
    .wa-service-sub { font-size: 11px; color: var(--waasha-muted); }
    .wa-provider-card__price { text-align: right; }
    .wa-price { font-weight: 800; color: var(--waasha-navy); font-size: 16px; }
    .wa-price-tag { font-size: 10px; font-weight: 700; letter-spacing: 0.06em; text-transform: uppercase; color: var(--waasha-teal); }
    .wa-provider-card__actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; padding-top: 2px; }
    .wa-btn--sm { padding: 9px 12px; font-size: 13px; border-radius: 12px; text-decoration: none; }
    .wa-btn--navy { background: var(--waasha-navy); color: white; border: 1px solid var(--waasha-navy); }
    .wa-btn--navy:hover { background: #132B4A; }
  `]
})
export class ProviderCardComponent {
  @Input({ required: true }) provider!: ProviderCardDto;
  @Input() customerLoc?: { latitude: number; longitude: number } | null = null;

  get tierLabel(): string {
    if (this.provider.tierCode === 'T3') return 'T3 Business';
    if (this.provider.tierCode === 'T2') return 'T2 Team';
    if (this.provider.tierCode === 'T1') return 'T1 Solo Pro';
    return this.provider.tierName || 'Provider';
  }
}

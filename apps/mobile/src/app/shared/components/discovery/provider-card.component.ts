import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { EnrichedProviderCardDto } from '../../../core/models/discovery-radius.model';

@Component({
  selector: 'waasha-mobile-provider-card',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <article class="wa-card" [attr.aria-label]="provider.displayName">
      <div class="wa-card__header">
        <div class="wa-tags">
          <span class="wa-pill" [ngClass]="{
            'wa-pill--navy': provider.tierCode === 'T3',
            'wa-pill--teal': provider.tierCode === 'T2',
            'wa-pill--muted': provider.tierCode === 'T1' || !provider.tierCode
          }">{{ tierLabel }}</span>
          <span *ngIf="provider.verificationStatus === 'VERIFIED'" class="wa-pill wa-pill--verified">◆ Verified Pro</span>
        </div>
        <span class="wa-distance">{{ provider.distanceKm | number:'1.1-1' }} km away</span>
      </div>

      <div class="wa-card__title">
        <div class="wa-avatar">
          <img *ngIf="provider.profileImageUrl; else fb" [src]="provider.profileImageUrl" [alt]="provider.displayName" class="wa-avatar__img" loading="lazy" />
          <ng-template #fb><span class="wa-avatar__fb">{{ provider.displayName.charAt(0) | uppercase }}</span></ng-template>
        </div>
        <div class="wa-name-block">
          <h3 class="wa-name">{{ provider.displayName }}</h3>
          <p class="wa-meta">
            <span *ngIf="provider.city">{{ provider.city }}</span>
            <span *ngIf="provider.city && provider.categories?.length"> • </span>
            <span *ngIf="provider.categories?.length">{{ provider.categories?.join(' • ') }}</span>
          </p>
        </div>
        <div *ngIf="provider.rating != null" class="wa-rating">
          <span aria-hidden="true">★</span> {{ provider.rating | number:'1.1-1' }}
          <span class="wa-rating__count">({{ provider.reviewCount }})</span>
        </div>
      </div>

      <div class="wa-price-row" *ngIf="provider.startingPrice != null">
        <span class="wa-price-label">Starting from</span>
        <span class="wa-price">R{{ provider.startingPrice }}</span>
      </div>

      <div class="wa-actions">
        <a class="wa-btn wa-btn-ghost" [routerLink]="['/marketplace/provider', provider.id]" [queryParams]="customerLoc ? { lat: customerLoc.latitude, lng: customerLoc.longitude } : {}">Profile</a>
        <a class="wa-btn wa-btn-primary" [routerLink]="['/marketplace/provider', provider.id]" [queryParams]="customerLoc ? { lat: customerLoc.latitude, lng: customerLoc.longitude } : {}">Book Service</a>
      </div>
    </article>
  `,
  styles: [`
    .wa-card { background: white; border: 1px solid #E2E8F0; border-radius: 16px; padding: 14px; display: flex; flex-direction: column; gap: 10px; box-shadow: 0 1px 2px rgba(16,24,40,0.04); }
    .wa-card__header { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; }
    .wa-tags { display: flex; gap: 6px; flex-wrap: wrap; }
    .wa-pill { display: inline-flex; align-items: center; padding: 3px 8px; border-radius: 999px; font-size: 10px; font-weight: 700; }
    .wa-pill--navy { background: #0B1F33; color: white; }
    .wa-pill--teal { background: #E6F7F5; color: #0B1F33; border: 1px solid #B9E8E2; }
    .wa-pill--muted { background: #F1F5F9; color: #0B1F33; border: 1px solid #E2E8F0; }
    .wa-pill--verified { background: rgba(25,182,165,0.12); color: #0E7A6E; border: 1px solid rgba(25,182,165,0.25); }
    .wa-distance { background: #E6F7F5; color: #0E7A6E; padding: 3px 8px; border-radius: 999px; font-size: 10px; font-weight: 700; }
    .wa-card__title { display: flex; gap: 10px; align-items: center; }
    .wa-avatar { width: 44px; height: 44px; border-radius: 12px; background: #F6F8FA; border: 1px solid #E2E8F0; display: grid; place-items: center; overflow: hidden; flex-shrink: 0; }
    .wa-avatar__img { width: 100%; height: 100%; object-fit: cover; }
    .wa-avatar__fb { font-weight: 800; color: #0B1F33; }
    .wa-name { margin: 0; font-size: 15px; font-weight: 800; color: #0B1F33; }
    .wa-meta { margin: 2px 0 0; font-size: 11px; color: #667085; }
    .wa-rating { margin-left: auto; background: #FFFBEB; border: 1px solid #FDE68A; padding: 4px 6px; border-radius: 8px; font-size: 11px; font-weight: 700; color: #0B1F33; }
    .wa-rating__count { color: #667085; font-weight: 600; }
    .wa-price-row { display: flex; justify-content: space-between; align-items: center; background: #F8FAFC; border: 1px solid #E2E8F0; border-radius: 10px; padding: 8px 10px; }
    .wa-price-label { font-size: 11px; color: #667085; font-weight: 600; }
    .wa-price { font-weight: 800; color: #0B1F33; }
    .wa-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .wa-btn { display: inline-flex; align-items: center; justify-content: center; padding: 9px 12px; border-radius: 12px; font-size: 13px; font-weight: 700; text-decoration: none; cursor: pointer; border: 1px solid transparent; }
    .wa-btn-ghost { background: #F6F8FA; color: #0B1F33; border-color: #E2E8F0; }
    .wa-btn-primary { background: #0B1F33; color: white; }
  `]
})
export class MobileProviderCardComponent {
  @Input({ required: true }) provider!: EnrichedProviderCardDto;
  @Input() customerLoc?: { latitude: number; longitude: number } | null = null;
  get tierLabel(): string {
    if (this.provider.tierCode === 'T3') return 'T3 Business';
    if (this.provider.tierCode === 'T2') return 'T2 Team';
    return 'T1 Solo Pro';
  }
}

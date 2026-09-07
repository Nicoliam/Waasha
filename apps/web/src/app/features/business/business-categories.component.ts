import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { BusinessApiService, isOnline } from '../../core/services/business.service';
import { canManageBusiness, mutationErrorMessage, offlineMessage } from './business.utils';

/**
 * Slice 15 — T3 business categories overview (web).
 * A T3 business may operate multiple of the exact five Waasha launch
 * categories across its units. Categories themselves are platform-owned:
 * providers associate units with existing categories, never create them.
 */
@Component({
  selector: 'waasha-business-categories',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <div class="wa-cats">
      <header class="wa-cats__head">
        <div>
          <h1 class="wa-title">Business categories</h1>
          <p class="wa-sub">Barbers · Hair Salons &amp; Stylists · Nail Technicians · Beauty Services · Car Wash</p>
        </div>
        <a routerLink="/provider/business" class="wa-btn wa-btn-ghost wa-btn--sm">Business</a>
      </header>

      <div *ngIf="!online" class="wa-card wa-offline" role="status">{{ offlineText }}</div>
      <section *ngIf="loading" class="wa-card wa-loading" role="status">Loading categories…</section>
      <div *ngIf="loadError && !loading" class="wa-card wa-error" role="alert">
        <p class="wa-error__title">Couldn't load categories</p>
        <p class="wa-error__msg">{{ loadError }}</p>
        <button type="button" class="wa-btn wa-btn-primary wa-btn--navy wa-btn--sm" (click)="load()">Retry</button>
      </div>

      <section *ngIf="!loading && !loadError" class="wa-card" aria-label="Select business">
        <label class="wa-field"><span>Business</span>
          <select [(ngModel)]="businessId" (ngModelChange)="reload()" aria-label="Select business">
            <option *ngFor="let b of businesses" [value]="b.id">{{ b.displayName }}</option>
          </select>
        </label>
      </section>

      <section *ngIf="!loading && !loadError && businessId" class="wa-card" aria-label="Unit categories">
        <h2 class="wa-card__title">Categories by unit</h2>
        <ul *ngIf="rows.length > 0" class="wa-list">
          <li *ngFor="let r of rows" class="wa-row">
            <div><strong>{{ r.unit.name }}</strong><span class="wa-muted"> · {{ categoryNames(r.detail) }}</span></div>
            <a [routerLink]="['/provider/business/units', r.unit.id]" class="wa-btn wa-btn-ghost wa-btn--sm">Manage</a>
          </li>
        </ul>
        <p *ngIf="rows.length === 0" class="wa-muted">No units yet for this business.</p>
        <p *ngIf="formError" class="wa-field__error" role="alert">{{ formError }}</p>
      </section>
    </div>
  `,
})
export class BusinessCategoriesComponent implements OnInit {
  private readonly api = inject(BusinessApiService);
  businesses: any[] = [];
  businessId: string | null = null;
  rows: Array<{ unit: any; detail: any }> = [];
  loading = true;
  loadError: string | null = null;
  formError: string | null = null;

  get online(): boolean {
    return isOnline();
  }
  get offlineText(): string {
    return offlineMessage();
  }

  ngOnInit(): void {
    this.load();
  }

  categoryNames(detail: any): string {
    const cats = detail?.categories ?? [];
    if (cats.length === 0) return 'no categories';
    return cats.map((c: any) => c.name || c.code || c.id).join(', ');
  }

  load(): void {
    this.loading = true;
    this.loadError = null;
    this.api.getCapabilities().subscribe({
      next: (caps) => {
        if (!canManageBusiness(caps?.data?.tierCode)) {
          this.loading = false;
          this.loadError = 'Business categories need a T3 Business account.';
          return;
        }
        this.api.listBusinesses().subscribe({
          next: (res) => {
            this.businesses = res?.data ?? [];
            if (!this.businessId && this.businesses.length > 0) this.businessId = this.businesses[0].id;
            this.loading = false;
            if (this.businessId) this.reload();
          },
          error: (e) => {
            this.loading = false;
            this.loadError = mutationErrorMessage(e, 'Could not load businesses.');
          },
        });
      },
      error: (e) => {
        this.loading = false;
        this.loadError = mutationErrorMessage(e, 'Could not load capabilities.');
      },
    });
  }

  reload(): void {
    if (!this.businessId) return;
    this.rows = [];
    this.api.listUnits(this.businessId).subscribe({
      next: (res) => {
        const units = res?.data ?? [];
        if (units.length === 0) return;
        let pending = units.length;
        for (const u of units) {
          this.api.getUnit(u.id).subscribe({
            next: (detail) => {
              this.rows.push({ unit: u, detail: detail?.data ?? {} });
              pending -= 1;
            },
            error: (e) => {
              pending -= 1;
              this.formError = mutationErrorMessage(e, 'Could not load unit categories.');
            },
          });
        }
        void pending;
      },
      error: (e) => {
        this.loadError = mutationErrorMessage(e, 'Could not load units.');
      },
    });
  }
}

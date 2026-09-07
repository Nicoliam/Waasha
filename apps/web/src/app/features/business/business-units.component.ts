import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { BusinessApiService, isOnline } from '../../core/services/business.service';
import { canManageBusiness, mutationErrorMessage, offlineMessage, statusLabel } from './business.utils';

/**
 * Slice 15 — T3 business units list + create (web).
 * Units are activated/deactivated, never deleted. Location changes
 * never mutate historical booking destinations (server snapshots).
 */
@Component({
  selector: 'waasha-business-units',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <div class="wa-units">
      <header class="wa-units__head">
        <div>
          <h1 class="wa-title">Business units</h1>
          <p class="wa-sub">Each unit can have its own location, categories, services and staff.</p>
        </div>
        <a routerLink="/provider/business" class="wa-btn wa-btn-ghost wa-btn--sm">Business</a>
      </header>

      <div *ngIf="!online" class="wa-card wa-offline" role="status">{{ offlineText }}</div>
      <section *ngIf="loading" class="wa-card wa-loading" role="status">Loading units…</section>
      <div *ngIf="loadError && !loading" class="wa-card wa-error" role="alert">
        <p class="wa-error__title">Couldn't load units</p>
        <p class="wa-error__msg">{{ loadError }}</p>
        <button type="button" class="wa-btn wa-btn-primary wa-btn--navy wa-btn--sm" (click)="load()">Retry</button>
      </div>

      <section *ngIf="!loading && !loadError" class="wa-card" aria-label="Select business">
        <label class="wa-field"><span>Business</span>
          <select [(ngModel)]="businessId" (ngModelChange)="loadUnits()" aria-label="Select business">
            <option *ngFor="let b of businesses" [value]="b.id">{{ b.displayName }}</option>
          </select>
        </label>
      </section>

      <section *ngIf="!loading && !loadError && businessId" class="wa-card" aria-label="Units">
        <h2 class="wa-card__title">Units ({{ units.length }})</h2>
        <ul *ngIf="units.length > 0" class="wa-list">
          <li *ngFor="let u of units" class="wa-row">
            <div><strong>{{ u.name }}</strong><span class="wa-muted"> · {{ statusText(u.status) }} · {{ u.coverageRadiusKm }} km</span></div>
            <div class="wa-row__actions">
              <a [routerLink]="['/provider/business/units', u.id]" class="wa-btn wa-btn-ghost wa-btn--sm">Open</a>
              <button type="button" class="wa-btn wa-btn-ghost wa-btn--sm" (click)="toggleActive(u)" [disabled]="!online">{{ u.status === 'ACTIVE' ? 'Deactivate' : 'Activate' }}</button>
            </div>
          </li>
        </ul>
        <p *ngIf="units.length === 0" class="wa-muted">No units yet for this business.</p>
        <form (ngSubmit)="create()" class="wa-form" aria-label="Create unit">
          <label class="wa-field"><span>Unit name</span><input [(ngModel)]="newName" name="name" maxlength="120" required /></label>
          <label class="wa-field"><span>Coverage (km)</span>
            <select [(ngModel)]="newCoverage" name="coverage"><option [value]="10">10</option><option [value]="15">15</option><option [value]="20">20</option></select>
          </label>
          <p *ngIf="formError" class="wa-field__error" role="alert">{{ formError }}</p>
          <button type="submit" class="wa-btn wa-btn-primary wa-btn--navy wa-btn--sm" [disabled]="!online">Create unit</button>
        </form>
      </section>
    </div>
  `,
})
export class BusinessUnitsComponent implements OnInit {
  private readonly api = inject(BusinessApiService);
  businesses: any[] = [];
  businessId: string | null = null;
  units: any[] = [];
  loading = true;
  loadError: string | null = null;
  formError: string | null = null;
  newName = '';
  newCoverage = 10;

  get online(): boolean {
    return isOnline();
  }
  get offlineText(): string {
    return offlineMessage();
  }

  ngOnInit(): void {
    this.load();
  }

  statusText(s: string): string {
    return statusLabel(s);
  }

  load(): void {
    this.loading = true;
    this.loadError = null;
    this.api.getCapabilities().subscribe({
      next: (caps) => {
        if (!canManageBusiness(caps?.data?.tierCode)) {
          this.loading = false;
          this.loadError = 'Business units need a T3 Business account.';
          return;
        }
        this.api.listBusinesses().subscribe({
          next: (res) => {
            this.businesses = res?.data ?? [];
            if (!this.businessId && this.businesses.length > 0) this.businessId = this.businesses[0].id;
            this.loading = false;
            if (this.businessId) this.loadUnits();
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

  loadUnits(): void {
    if (!this.businessId) return;
    this.api.listUnits(this.businessId).subscribe({
      next: (res) => {
        this.units = res?.data ?? [];
      },
      error: (e) => {
        this.loadError = mutationErrorMessage(e, 'Could not load units.');
      },
    });
  }

  create(): void {
    if (!this.online) {
      this.formError = offlineMessage();
      return;
    }
    if (!this.businessId) return;
    this.formError = null;
    this.api.createUnit(this.businessId, { name: this.newName.trim(), coverageRadiusKm: Number(this.newCoverage) }).subscribe({
      next: () => {
        this.newName = '';
        this.loadUnits();
      },
      error: (e) => {
        this.formError = mutationErrorMessage(e, 'Could not create unit.');
      },
    });
  }

  toggleActive(u: any): void {
    if (!this.online) {
      this.formError = offlineMessage();
      return;
    }
    const call = u.status === 'ACTIVE' ? this.api.deactivateUnit(u.id) : this.api.activateUnit(u.id);
    call.subscribe({
      next: () => this.loadUnits(),
      error: (e) => {
        this.formError = mutationErrorMessage(e, 'Could not update unit.');
      },
    });
  }
}

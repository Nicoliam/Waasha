import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { BusinessApiService, isOnline } from '../../core/services/business.service';
import { mutationErrorMessage, offlineMessage, statusLabel } from './business.utils';

/**
 * Slice 15 — T3 business unit detail (mobile).
 * Edit, activate/deactivate, set location, manage categories and
 * attach/detach services. Price snapshots of existing bookings are
 * never touched — catalogue edits only affect future bookings.
 */
@Component({
  selector: 'waasha-mobile-business-unit-detail',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <div class="wa-unit">
      <header class="wa-unit__head">
        <div>
          <h1 class="wa-title">{{ unit?.name || 'Business unit' }}</h1>
          <p class="wa-sub" *ngIf="unit">Status: {{ statusText(unit.status) }} · Coverage: {{ unit.coverageRadiusKm }} km</p>
        </div>
        <a routerLink="/provider/business/units" class="wa-btn wa-btn-ghost wa-btn--sm">Units</a>
      </header>

      <div *ngIf="!online" class="wa-card wa-offline" role="status">{{ offlineText }}</div>
      <section *ngIf="loading" class="wa-card wa-loading" role="status">Loading unit…</section>
      <div *ngIf="loadError && !loading" class="wa-card wa-error" role="alert">
        <p class="wa-error__title">Couldn't load unit</p>
        <p class="wa-error__msg">{{ loadError }}</p>
        <button type="button" class="wa-btn wa-btn-primary wa-btn--navy wa-btn--sm" (click)="load()">Retry</button>
      </div>

      <ng-container *ngIf="!loading && !loadError && unit">
        <section class="wa-card" aria-label="Edit unit">
          <h2 class="wa-card__title">Details</h2>
          <form (ngSubmit)="save()" class="wa-form">
            <label class="wa-field"><span>Name</span><input [(ngModel)]="form.name" name="name" maxlength="120" required /></label>
            <label class="wa-field"><span>Description</span><textarea [(ngModel)]="form.description" name="description" rows="2" maxlength="2000"></textarea></label>
            <label class="wa-field"><span>Coverage (km)</span>
              <select [(ngModel)]="form.coverageRadiusKm" name="coverage"><option [value]="10">10</option><option [value]="15">15</option><option [value]="20">20</option></select>
            </label>
            <p *ngIf="formError" class="wa-field__error" role="alert">{{ formError }}</p>
            <button type="submit" class="wa-btn wa-btn-primary wa-btn--navy wa-btn--sm" [disabled]="!online">Save changes</button>
          </form>
        </section>

        <section class="wa-card" aria-label="Unit location">
          <h2 class="wa-card__title">Location</h2>
          <p class="wa-muted">Changing the unit location never rewrites past booking destinations.</p>
          <ul *ngIf="unit.locations?.length > 0" class="wa-list">
            <li *ngFor="let l of unit.locations" class="wa-row">
              <div>{{ l.city || 'Location' }}<span class="wa-muted"> · {{ l.latitude }}, {{ l.longitude }}{{ l.isPrimary ? ' · Primary' : '' }}</span></div>
            </li>
          </ul>
          <form (ngSubmit)="saveLocation()" class="wa-form">
            <label class="wa-field"><span>City</span><input [(ngModel)]="loc.city" name="city" /></label>
            <label class="wa-field"><span>Latitude</span><input [(ngModel)]="loc.latitude" name="lat" type="number" step="any" required /></label>
            <label class="wa-field"><span>Longitude</span><input [(ngModel)]="loc.longitude" name="lng" type="number" step="any" required /></label>
            <p *ngIf="formError" class="wa-field__error" role="alert">{{ formError }}</p>
            <button type="submit" class="wa-btn wa-btn-ghost wa-btn--sm" [disabled]="!online">Set location</button>
          </form>
        </section>

        <section class="wa-card" aria-label="Unit categories">
          <h2 class="wa-card__title">Categories</h2>
          <p class="wa-muted">Current: {{ (unit.categories || []).map(catName).join(', ') || 'none' }}</p>
          <form (ngSubmit)="saveCategories()" class="wa-form">
            <label class="wa-field"><span>Category codes or IDs (comma-separated, max 5)</span><input [(ngModel)]="categoryInput" name="categories" placeholder="BARBERS, NAILS" /></label>
            <button type="submit" class="wa-btn wa-btn-ghost wa-btn--sm" [disabled]="!online">Save categories</button>
          </form>
        </section>

        <section class="wa-card" aria-label="Unit services">
          <h2 class="wa-card__title">Services ({{ (unit.services || []).length }})</h2>
          <ul *ngIf="(unit.services || []).length > 0" class="wa-list">
            <li *ngFor="let s of unit.services" class="wa-row">
              <div><strong>{{ s.name }}</strong><span class="wa-muted"> · {{ s.status }}</span></div>
              <button type="button" class="wa-btn wa-btn-ghost wa-btn--sm" (click)="detach(s.id)" [disabled]="!online">Detach</button>
            </li>
          </ul>
          <form (ngSubmit)="attach()" class="wa-form">
            <label class="wa-field"><span>Attach service by ID</span><input [(ngModel)]="serviceId" name="serviceId" /></label>
            <button type="submit" class="wa-btn wa-btn-ghost wa-btn--sm" [disabled]="!online || !serviceId">Attach</button>
          </form>
        </section>
      </ng-container>
    </div>
  `,
})
export class BusinessUnitDetailPage implements OnInit {
  private readonly api = inject(BusinessApiService);
  private readonly route = inject(ActivatedRoute);
  unitId: string | null = null;
  unit: any = null;
  loading = true;
  loadError: string | null = null;
  formError: string | null = null;
  form = { name: '', description: '', coverageRadiusKm: 10 };
  loc: any = { city: '', latitude: null, longitude: null };
  categoryInput = '';
  serviceId = '';

  get online(): boolean {
    return isOnline();
  }
  get offlineText(): string {
    return offlineMessage();
  }

  ngOnInit(): void {
    this.unitId = this.route.snapshot.paramMap.get('id');
    this.load();
  }

  statusText(s: string): string {
    return statusLabel(s);
  }
  catName(c: any): string {
    return c?.name ?? c?.code ?? c?.id ?? '';
  }

  load(): void {
    if (!this.unitId) {
      this.loading = false;
      this.loadError = 'Unit id is missing.';
      return;
    }
    this.loading = true;
    this.loadError = null;
    this.api.getUnit(this.unitId).subscribe({
      next: (res) => {
        this.unit = res?.data ?? null;
        this.form = { name: this.unit?.name ?? '', description: this.unit?.description ?? '', coverageRadiusKm: this.unit?.coverageRadiusKm ?? 10 };
        this.categoryInput = (this.unit?.categories || []).map((c: any) => c.code || c.id).join(', ');
        this.loading = false;
      },
      error: (e) => {
        this.loading = false;
        this.loadError = mutationErrorMessage(e, 'Could not load unit.');
      },
    });
  }

  save(): void {
    if (!this.online || !this.unitId) {
      this.formError = offlineMessage();
      return;
    }
    this.formError = null;
    this.api.updateUnit(this.unitId, { name: this.form.name.trim(), description: this.form.description.trim() || null, coverageRadiusKm: Number(this.form.coverageRadiusKm) }).subscribe({
      next: () => this.load(),
      error: (e) => {
        this.formError = mutationErrorMessage(e, 'Could not save unit.');
      },
    });
  }

  saveLocation(): void {
    if (!this.online || !this.unitId) {
      this.formError = offlineMessage();
      return;
    }
    this.api.setUnitLocation(this.unitId, { city: this.loc.city || null, latitude: Number(this.loc.latitude), longitude: Number(this.loc.longitude) }).subscribe({
      next: () => this.load(),
      error: (e) => {
        this.formError = mutationErrorMessage(e, 'Could not set location.');
      },
    });
  }

  saveCategories(): void {
    if (!this.online || !this.unitId) {
      this.formError = offlineMessage();
      return;
    }
    const ids = this.categoryInput.split(',').map((s) => s.trim()).filter(Boolean);
    this.api.setUnitCategories(this.unitId, ids).subscribe({
      next: () => this.load(),
      error: (e) => {
        this.formError = mutationErrorMessage(e, 'Could not save categories.');
      },
    });
  }

  attach(): void {
    if (!this.online || !this.unitId || !this.serviceId.trim()) return;
    this.api.attachService(this.unitId, this.serviceId.trim()).subscribe({
      next: () => {
        this.serviceId = '';
        this.load();
      },
      error: (e) => {
        this.formError = mutationErrorMessage(e, 'Could not attach service.');
      },
    });
  }

  detach(serviceId: string): void {
    if (!this.online || !this.unitId) return;
    this.api.detachService(this.unitId, serviceId).subscribe({
      next: () => this.load(),
      error: (e) => {
        this.formError = mutationErrorMessage(e, 'Could not detach service.');
      },
    });
  }
}

import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { BusinessApiService, isOnline } from '../../core/services/business.service';
import { canManageBusiness, mutationErrorMessage, offlineMessage, statusLabel, tierLabel } from './business.utils';

/**
 * Slice 15 — T3 business dashboard (web).
 * Lists owned businesses and supports create/update/deactivate.
 * T1/T2 providers see an explicit capability gate; the server
 * still enforces tier (403) regardless of UI.
 */
@Component({
  selector: 'waasha-business-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <div class="wa-biz">
      <header class="wa-biz__head">
        <div>
          <h1 class="wa-title">Business management</h1>
          <p class="wa-sub">Tier: <strong>{{ tierText }}</strong> · T3 businesses run units, staff and categories.</p>
        </div>
        <nav class="wa-links" aria-label="Business sections">
          <a routerLink="/provider/business/units" class="wa-btn wa-btn-ghost wa-btn--sm">Units</a>
          <a routerLink="/provider/business/staff" class="wa-btn wa-btn-ghost wa-btn--sm">Staff</a>
          <a routerLink="/provider/business/categories" class="wa-btn wa-btn-ghost wa-btn--sm">Categories</a>
        </nav>
      </header>

      <div *ngIf="!online" class="wa-card wa-offline" role="status">{{ offlineText }}</div>
      <section *ngIf="loading" class="wa-card wa-loading" role="status">Loading businesses…</section>
      <div *ngIf="loadError && !loading" class="wa-card wa-error" role="alert">
        <p class="wa-error__title">{{ forbidden ? 'Not available for your tier' : "Couldn't load businesses" }}</p>
        <p class="wa-error__msg">{{ loadError }}</p>
        <button type="button" class="wa-btn wa-btn-primary wa-btn--navy wa-btn--sm" (click)="load()">Retry</button>
      </div>

      <section *ngIf="!loading && !loadError" class="wa-card" aria-label="Businesses">
        <h2 class="wa-card__title">Businesses ({{ businesses.length }})</h2>
        <ul *ngIf="businesses.length > 0" class="wa-list">
          <li *ngFor="let b of businesses" class="wa-row">
            <div>
              <strong>{{ b.displayName }}</strong>
              <span class="wa-muted"> · {{ statusText(b.status) }} · {{ b.verificationStatus }}</span>
              <div class="wa-muted wa-small">{{ b.legalName || 'No legal name' }}</div>
            </div>
            <div class="wa-row__actions">
              <a [routerLink]="['/provider/business/units', { business: b.id }]" class="wa-btn wa-btn-ghost wa-btn--sm">Units</a>
              <button type="button" class="wa-btn wa-btn-ghost wa-btn--sm" (click)="startEdit(b)">Edit</button>
              <button type="button" class="wa-btn wa-btn-ghost wa-btn--sm" (click)="toggleActive(b)" [disabled]="!online">{{ b.status === 'ACTIVE' ? 'Deactivate' : 'Reactivate' }}</button>
            </div>
          </li>
        </ul>
        <p *ngIf="businesses.length === 0" class="wa-muted">No business yet. Create your business account below.</p>
      </section>

      <section *ngIf="!loading && !loadError && (editing || businesses.length === 0)" class="wa-card" aria-label="Business form">
        <h2 class="wa-card__title">{{ editing ? 'Edit business' : 'Create business' }}</h2>
        <form (ngSubmit)="save()" class="wa-form">
          <label class="wa-field"><span>Display name</span><input [(ngModel)]="form.displayName" name="displayName" maxlength="120" required /></label>
          <label class="wa-field"><span>Legal name (optional)</span><input [(ngModel)]="form.legalName" name="legalName" maxlength="200" /></label>
          <label class="wa-field"><span>Description (optional)</span><textarea [(ngModel)]="form.description" name="description" rows="2" maxlength="2000"></textarea></label>
          <p *ngIf="formError" class="wa-field__error" role="alert">{{ formError }}</p>
          <div class="wa-row__actions">
            <button type="submit" class="wa-btn wa-btn-primary wa-btn--navy wa-btn--sm" [disabled]="saving || !online">{{ editing ? 'Save' : 'Create business' }}</button>
            <button *ngIf="editing" type="button" class="wa-btn wa-btn-ghost wa-btn--sm" (click)="cancelEdit()">Cancel</button>
          </div>
        </form>
      </section>
    </div>
  `,
})
export class BusinessDashboardComponent implements OnInit {
  private readonly api = inject(BusinessApiService);
  tier: string | null = null;
  businesses: any[] = [];
  loading = true;
  saving = false;
  loadError: string | null = null;
  formError: string | null = null;
  forbidden = false;
  editing: any = null;
  form = { displayName: '', legalName: '', description: '' };

  get tierText(): string {
    return tierLabel(this.tier);
  }
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
    this.forbidden = false;
    this.api.getCapabilities().subscribe({
      next: (caps) => {
        this.tier = caps?.data?.tierCode ?? null;
        if (!canManageBusiness(this.tier)) {
          this.loading = false;
          this.forbidden = true;
          this.loadError = 'Business management needs a T3 Business account. Your tier does not include businesses.';
          return;
        }
        this.api.listBusinesses().subscribe({
          next: (res) => {
            this.businesses = res?.data ?? [];
            this.loading = false;
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

  startEdit(b: any): void {
    this.editing = b;
    this.form = { displayName: b.displayName ?? '', legalName: b.legalName ?? '', description: b.description ?? '' };
  }

  cancelEdit(): void {
    this.editing = null;
    this.form = { displayName: '', legalName: '', description: '' };
    this.formError = null;
  }

  save(): void {
    if (!this.online) {
      this.formError = offlineMessage();
      return;
    }
    this.saving = true;
    this.formError = null;
    const payload = {
      displayName: this.form.displayName.trim(),
      legalName: this.form.legalName.trim() || null,
      description: this.form.description.trim() || null,
    };
    const done = () => {
      this.saving = false;
      this.cancelEdit();
      this.load();
    };
    if (this.editing) {
      this.api.updateBusiness(this.editing.id, payload).subscribe({
        next: done,
        error: (e) => {
          this.saving = false;
          this.formError = mutationErrorMessage(e, 'Could not save the business.');
        },
      });
    } else {
      this.api.createBusiness(payload).subscribe({
        next: done,
        error: (e) => {
          this.saving = false;
          this.formError = mutationErrorMessage(e, 'Could not create the business.');
        },
      });
    }
  }

  toggleActive(b: any): void {
    if (!this.online) {
      this.formError = offlineMessage();
      return;
    }
    this.api.updateBusiness(b.id, { status: b.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE' }).subscribe({
      next: () => this.load(),
      error: (e) => {
        this.formError = mutationErrorMessage(e, 'Could not update the business.');
      },
    });
  }
}

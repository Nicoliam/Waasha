import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ProviderServicesService } from '../../core/services/provider-services.service';
import {
  ServiceSummary,
  ServiceFilter,
  toSummary,
  filterServices,
  statusLabel,
  priceLabel,
  durationLabel,
  serviceErrorMessage,
} from './provider-services.utils';

const FILTERS: Array<{ value: ServiceFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
];

@Component({
  selector: 'waasha-provider-services',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <div class="wa-psvc">
      <header class="wa-psvc__head">
        <div>
          <h1 class="wa-title">Services</h1>
          <p class="wa-sub">Manage your catalogue. Price and duration changes apply to future bookings only — existing bookings keep their original values.</p>
        </div>
        <a routerLink="/provider/services/new" class="wa-btn wa-btn-primary wa-btn--navy wa-btn--sm">New service</a>
      </header>

      <div *ngIf="offline" class="wa-card wa-offline" role="status">
        You are offline. The cached list may be stale, and changes are deferred until you are back online.
      </div>

      <nav class="wa-filters" aria-label="Service filters">
        <button
          *ngFor="let f of filters"
          type="button"
          class="wa-filter"
          [class.active]="activeFilter === f.value"
          [attr.aria-selected]="activeFilter === f.value"
          (click)="setFilter(f.value)"
        >
          {{ f.label }} ({{ countFor(f.value) }})
        </button>
      </nav>

      <section *ngIf="loading" class="wa-card wa-loading" role="status">Loading services…</section>

      <div *ngIf="loadError && !loading" class="wa-card wa-error" role="alert">
        <p class="wa-error__title">{{ unauthorized ? 'Access denied' : "Couldn't load services" }}</p>
        <p class="wa-error__msg">{{ loadError }}</p>
        <div class="wa-error__actions">
          <button type="button" class="wa-btn wa-btn-primary wa-btn--navy wa-btn--sm" (click)="load()">Retry</button>
          <a *ngIf="unauthorized" routerLink="/auth/login" class="wa-btn wa-btn-ghost wa-btn--sm">Log in</a>
        </div>
      </div>

      <div *ngIf="!loading && !loadError">
        <div *ngIf="visible.length === 0" class="wa-card wa-empty" role="status">
          <p class="wa-empty__title">{{ emptyTitle }}</p>
          <p class="wa-empty__sub">{{ emptyHint }}</p>
          <a routerLink="/provider/services/new" class="wa-btn wa-btn-primary wa-btn--navy wa-btn--sm">Create your first service</a>
        </div>

        <ul *ngIf="visible.length > 0" class="wa-list">
          <li *ngFor="let s of visible; trackBy: trackService" class="wa-card wa-service">
            <img *ngIf="s.images.length > 0" [src]="s.images[0].imageUrl" [alt]="s.name" class="wa-service__img" loading="lazy" />
            <div class="wa-service__body">
              <div class="wa-service__top">
                <strong class="wa-service__name">{{ s.name }}</strong>
                <span class="wa-status" [attr.data-status]="s.status">{{ statusText(s.status) }}</span>
              </div>
              <p class="wa-muted">{{ s.category?.name || 'Uncategorised' }} • {{ modeText(s) }}</p>
              <p class="wa-service__meta">{{ priceText(s) }} • {{ durationText(s) }}</p>
              <div class="wa-service__actions">
                <a [routerLink]="['/provider/services', s.id]" class="wa-btn wa-btn-ghost wa-btn--sm">Edit</a>
                <button type="button" class="wa-btn wa-btn-ghost wa-btn--sm" (click)="toggleActive(s)" [disabled]="actingId === s.id">
                  {{ s.isActive ? 'Deactivate' : 'Activate' }}
                </button>
                <button type="button" class="wa-btn wa-btn-ghost wa-btn--sm wa-danger" (click)="remove(s)" [disabled]="actingId === s.id">
                  Delete
                </button>
              </div>
              <p *ngIf="actionErrorId === s.id" class="wa-error__msg" role="alert">{{ actionError }}</p>
            </div>
          </li>
        </ul>
      </div>
    </div>
  `,
})
export class ProviderServicesComponent implements OnInit {
  private readonly api = inject(ProviderServicesService);

  filters = FILTERS;
  activeFilter: ServiceFilter = 'all';
  services: ServiceSummary[] = [];
  loading = true;
  loadError: string | null = null;
  unauthorized = false;
  offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  actingId: string | null = null;
  actionErrorId: string | null = null;
  actionError: string | null = null;

  ngOnInit(): void {
    this.load();
  }

  get visible(): ServiceSummary[] {
    return filterServices(this.services, this.activeFilter);
  }

  get emptyTitle(): string {
    return this.activeFilter === 'active'
      ? 'No active services'
      : this.activeFilter === 'inactive'
        ? 'No inactive services'
        : 'No services yet';
  }

  get emptyHint(): string {
    return this.activeFilter === 'inactive'
      ? 'Deactivated services appear here and stay hidden from the marketplace.'
      : 'Create a service to appear in the marketplace. Inactive services stay hidden until you activate them.';
  }

  countFor(filter: ServiceFilter): number {
    return filterServices(this.services, filter).length;
  }

  setFilter(filter: ServiceFilter): void {
    this.activeFilter = filter;
  }

  trackService(_index: number, s: ServiceSummary): string {
    return s.id;
  }

  statusText(status: string): string {
    return statusLabel(status);
  }

  priceText(s: ServiceSummary): string {
    return priceLabel(s.price, s.currency);
  }

  durationText(s: ServiceSummary): string {
    return durationLabel(s.durationMinutes);
  }

  modeText(s: ServiceSummary): string {
    const modes: Record<string, string> = {
      PROVIDER_LOCATION: 'At provider',
      CUSTOMER_LOCATION: 'At customer',
      BOTH: 'Provider or customer',
    };
    return modes[(s.serviceMode ?? '').toUpperCase()] ?? s.serviceMode;
  }

  load(): void {
    this.loading = true;
    this.loadError = null;
    this.unauthorized = false;
    this.api.list({ page: 1, perPage: 50 }).subscribe({
      next: (res) => {
        this.services = Array.isArray(res.data) ? res.data.map(toSummary) : [];
        this.loading = false;
      },
      error: (e) => {
        this.loading = false;
        const code = e?.error?.error?.code as string | undefined;
        this.unauthorized = code === 'UNAUTHORIZED' || e?.status === 401;
        this.offline = e?.status === 0 || this.offline;
        this.loadError = serviceErrorMessage(code, "Couldn't load services. Check your connection and retry.");
      },
    });
  }

  toggleActive(s: ServiceSummary): void {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      this.actionErrorId = s.id;
      this.actionError = 'You are offline. Reconnect before changing a service — changes are never applied offline.';
      return;
    }
    this.actingId = s.id;
    this.actionErrorId = null;
    this.api.setActive(s.id, !s.isActive).subscribe({
      next: (res) => {
        this.actingId = null;
        if (res?.data) {
          const updated = toSummary(res.data);
          this.services = this.services.map((x) => (x.id === s.id ? updated : x));
        }
      },
      error: (e) => {
        this.actingId = null;
        this.actionErrorId = s.id;
        this.actionError = serviceErrorMessage(e?.error?.error?.code, 'Could not update the service. Try again.');
      },
    });
  }

  remove(s: ServiceSummary): void {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      this.actionErrorId = s.id;
      this.actionError = 'You are offline. Reconnect before changing a service — changes are never applied offline.';
      return;
    }
    this.actingId = s.id;
    this.actionErrorId = null;
    this.api.remove(s.id).subscribe({
      next: () => {
        this.actingId = null;
        this.services = this.services.filter((x) => x.id !== s.id);
      },
      error: (e) => {
        this.actingId = null;
        this.actionErrorId = s.id;
        this.actionError = serviceErrorMessage(e?.error?.error?.code, 'Could not delete the service. Try again.');
      },
    });
  }
}

import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AdminApiService } from '../../core/services/admin.service';
import { AdminNavComponent } from './admin-nav.component';
import { adminErrorMessage, money } from './admin.utils';

/**
 * Slice 16 — platform dashboard (web).
 * Operational metrics from real backend aggregates only; no PII lists,
 * no invented financial numbers.
 */
@Component({
  selector: 'waasha-admin-dashboard',
  standalone: true,
  imports: [CommonModule, AdminNavComponent],
  template: `
    <div class="wa-admin">
      <header><h1 class="wa-title">Admin · Platform dashboard</h1>
      <p class="wa-sub">Live operational metrics. Oversight only — financial snapshots are never edited here.</p></header>
      <waasha-admin-nav />
      <section *ngIf="loading" class="wa-card" role="status">Loading metrics…</section>
      <div *ngIf="error && !loading" class="wa-card wa-error" role="alert">
        <p class="wa-error__title">Couldn't load dashboard</p><p class="wa-error__msg">{{ error }}</p>
        <button type="button" class="wa-btn wa-btn--sm" (click)="load()">Retry</button>
      </div>
      <div *ngIf="m && !loading" class="wa-admin__grid">
        <section class="wa-card" aria-label="Users"><h2 class="wa-card__title">Users · {{ m.users.total }}</h2>
          <dl class="wa-meta"><div *ngFor="let s of statuses(m.users.byStatus)"><dt>{{ s[0] }}</dt><dd>{{ s[1] }}</dd></div></dl></section>
        <section class="wa-card" aria-label="Providers"><h2 class="wa-card__title">Providers · {{ m.providers.total }}</h2>
          <dl class="wa-meta">
            <div><dt>Active</dt><dd>{{ m.providers.active }}</dd></div>
            <div><dt>Verified</dt><dd>{{ m.providers.verified }}</dd></div>
            <div><dt>Pending verification</dt><dd>{{ m.providers.pendingVerification }}</dd></div>
            <div><dt>Verified students</dt><dd>{{ m.providers.verifiedStudents }}</dd></div>
          </dl></section>
        <section class="wa-card" aria-label="Businesses"><h2 class="wa-card__title">Business oversight</h2>
          <dl class="wa-meta">
            <div><dt>Active teams</dt><dd>{{ m.businesses.activeTeams }}</dd></div>
            <div><dt>Active businesses</dt><dd>{{ m.businesses.activeBusinesses }}</dd></div>
            <div><dt>Active units</dt><dd>{{ m.businesses.activeUnits }}</dd></div>
          </dl></section>
        <section class="wa-card" aria-label="Bookings"><h2 class="wa-card__title">Bookings · {{ m.bookings.total }}</h2>
          <dl class="wa-meta">
            <div><dt>Completed</dt><dd>{{ m.bookings.completed }}</dd></div>
            <div *ngFor="let s of statuses(m.bookings.byStatus)"><dt>{{ s[0] }}</dt><dd>{{ s[1] }}</dd></div>
          </dl></section>
        <section class="wa-card" aria-label="Finance"><h2 class="wa-card__title">Finance ({{ m.finance.currency }})</h2>
          <dl class="wa-meta">
            <div><dt>Paid volume</dt><dd>{{ money(m.finance.paidPaymentsTotal) }} ({{ m.finance.paidPaymentsCount }})</dd></div>
            <div><dt>Commission collected</dt><dd>{{ money(m.finance.commissionCollected) }}</dd></div>
            <div><dt>Outstanding cash liability</dt><dd>{{ money(m.finance.outstandingCashLiability) }}</dd></div>
          </dl></section>
        <section class="wa-card" aria-label="Operations"><h2 class="wa-card__title">Operations</h2>
          <dl class="wa-meta">
            <div><dt>Active services</dt><dd>{{ m.marketplace.activeServices }}</dd></div>
            <div><dt>Categories</dt><dd>{{ m.marketplace.categories }} (fixed at 5)</dd></div>
            <div><dt>Media pending moderation</dt><dd>{{ m.operations.mediaPendingModeration }}</dd></div>
            <div><dt>Inventory items tracked</dt><dd>{{ m.operations.lowStockItems }}</dd></div>
          </dl></section>
      </div>
    </div>
  `,
})
export class AdminDashboardComponent implements OnInit {
  private readonly api = inject(AdminApiService);
  m: any = null;
  loading = true;
  error: string | null = null;

  ngOnInit(): void { this.load(); }

  load(): void {
    this.loading = true;
    this.error = null;
    this.api.getDashboard().subscribe({
      next: (res) => { this.m = res.data; this.loading = false; },
      error: (err) => { this.error = adminErrorMessage(err); this.loading = false; },
    });
  }

  statuses(map: Record<string, number>): Array<[string, number]> {
    return Object.entries(map ?? {});
  }

  money(v: unknown): string { return money(v); }
}

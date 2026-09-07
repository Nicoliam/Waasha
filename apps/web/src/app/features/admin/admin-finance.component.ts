import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminApiService } from '../../core/services/admin.service';
import { AdminNavComponent } from './admin-nav.component';
import { adminErrorMessage, money, pageList, shortDate } from './admin.utils';

/**
 * Slice 16 — payment & finance oversight (web).
 * Inspect payments, commission snapshots, cash liability and settlements.
 * Read-only: payment status is never edited here, and no credentials or
 * webhook secrets are exposed by the API.
 */
@Component({
  selector: 'waasha-admin-finance',
  standalone: true,
  imports: [CommonModule, FormsModule, AdminNavComponent],
  template: `
    <div class="wa-admin">
      <header><h1 class="wa-title">Admin · Finance</h1>
      <p class="wa-sub">Read-only oversight. Historical snapshots are never rewritten.</p></header>
      <waasha-admin-nav />
      <section *ngIf="overview" class="wa-card" aria-label="Finance overview">
        <h2 class="wa-card__title">Overview ({{ overview.currency }})</h2>
        <dl class="wa-meta">
          <div><dt>Commission collected</dt><dd>{{ money(overview.commissionCollected) }} ({{ overview.paidCount }} paid)</dd></div>
          <div><dt>Outstanding cash liability</dt><dd>{{ money(overview.cashLiability?.outstanding) }}</dd></div>
          <div><dt>Total settled</dt><dd>{{ money(overview.cashLiability?.totalSettled) }}</dd></div>
        </dl>
        <h3 class="wa-card__sub">Payments by status</h3>
        <ul class="wa-list"><li *ngFor="let r of overview.paymentsByStatus">{{ r.status }} · {{ r.count }} · {{ money(r.totalAmount) }}</li></ul>
      </section>
      <section class="wa-card" aria-label="Search payments">
        <form (ngSubmit)="search()" class="wa-form wa-form--row">
          <label class="wa-field"><span>Status</span><select [(ngModel)]="status" name="status">
            <option value="">Any</option><option *ngFor="let s of statuses" [value]="s">{{ s }}</option></select></label>
          <label class="wa-field"><span>Method</span><select [(ngModel)]="method" name="method">
            <option value="">Any</option><option value="waasha_payment">Waasha payment</option>
            <option value="cash">Cash</option><option value="eft">EFT</option></select></label>
          <button type="submit" class="wa-btn wa-btn--sm" [disabled]="loading">Search</button>
        </form>
      </section>
      <section *ngIf="loading" class="wa-card" role="status">Loading payments…</section>
      <div *ngIf="error" class="wa-card wa-error" role="alert"><p>{{ error }}</p></div>
      <section *ngIf="!loading && !error" class="wa-card" aria-label="Payment results">
        <table *ngIf="payments.length > 0" class="wa-table">
          <thead><tr><th>Created</th><th>Method</th><th>Status</th><th>Amount</th><th>Commission</th><th></th></tr></thead>
          <tbody><tr *ngFor="let p of payments">
            <td>{{ date(p.createdAt) }}</td><td>{{ p.method }}</td><td>{{ p.status }}</td>
            <td>{{ money(p.amount) }}</td><td>{{ p.commissionAmount != null ? money(p.commissionAmount) + ' (' + p.commissionRate + '%)' : '—' }}</td>
            <td><button type="button" class="wa-btn wa-btn--sm" (click)="select(p.id)">Inspect</button></td>
          </tr></tbody>
        </table>
        <div class="wa-pager" *ngIf="meta.total > meta.perPage">
          <button type="button" *ngFor="let pg of pages()" class="wa-btn wa-btn--sm" [disabled]="pg === meta.page" (click)="goto(pg)">{{ pg }}</button>
        </div>
      </section>
      <section *ngIf="detail" class="wa-card" aria-label="Payment detail">
        <h2 class="wa-card__title">Payment · {{ detail.status }}</h2>
        <dl class="wa-meta">
          <div><dt>Amount</dt><dd>{{ money(detail.amount) }} {{ detail.currency }}</dd></div>
          <div><dt>Gateway</dt><dd>{{ detail.gateway }} ({{ detail.method }})</dd></div>
          <div><dt>Commission snapshot</dt><dd>{{ detail.commissionAmount != null ? money(detail.commissionAmount) + ' @ ' + detail.commissionRate + '%' : '—' }}</dd></div>
          <div><dt>Reference</dt><dd>{{ detail.internalReference || detail.providerReference || '—' }}</dd></div>
          <div><dt>Booking</dt><dd>{{ detail.booking?.id || '—' }} · {{ detail.booking?.status || '' }}</dd></div>
        </dl>
      </section>
    </div>
  `,
})
export class AdminFinanceComponent implements OnInit {
  private readonly api = inject(AdminApiService);
  status = '';
  method = '';
  statuses = ['PENDING', 'PROCESSING', 'PAID', 'FAILED', 'CANCELLED', 'REFUNDED'];
  payments: any[] = [];
  meta = { page: 1, perPage: 20, total: 0 };
  overview: any = null;
  detail: any = null;
  loading = false;
  error: string | null = null;

  ngOnInit(): void {
    this.api.getFinanceOverview().subscribe({
      next: (res) => { this.overview = res.data; },
      error: (err) => { this.error = adminErrorMessage(err); },
    });
    this.search();
  }

  search(): void {
    this.loading = true;
    this.error = null;
    this.api.listPayments({ status: this.status || undefined, method: this.method || undefined, page: this.meta.page, perPage: 20 }).subscribe({
      next: (res) => { this.payments = res.data; this.meta = res.meta; this.loading = false; },
      error: (err) => { this.error = adminErrorMessage(err); this.loading = false; },
    });
  }

  goto(p: number): void { this.meta.page = p; this.search(); }
  pages(): number[] { return pageList(this.meta.total, this.meta.perPage); }
  date(v: unknown): string { return shortDate(v); }
  money(v: unknown): string { return money(v); }

  select(id: string): void {
    this.api.getPayment(id).subscribe({
      next: (res) => { this.detail = res.data; },
      error: (err) => { this.error = adminErrorMessage(err); },
    });
  }
}

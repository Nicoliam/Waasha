import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { PartnerApiService } from '../../core/services/partner.service';

/**
 * Slice 17 — partner earnings / accruals (mobile — same APIs and rules as web).
 * Ledger accruals only — accrual is NOT payment. Paid out only once a
 * real payout mechanism exists (deferred).
 */
@Component({
  selector: 'waasha-mobile-partner-earnings',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <div class="wa-admin">
      <header><h1 class="wa-title">Partner · Earnings</h1>
      <p class="wa-sub">Accrued allocations from eligible completed services. Accrual is not payment.</p></header>
      <nav class="wa-adminnav" aria-label="Partner sections">
        <a routerLink="/partner/dashboard">Dashboard</a>
        <a routerLink="/partner/referrals">Referrals</a>
        <a routerLink="/partner/providers">Providers</a>
        <a routerLink="/partner/earnings">Earnings</a>
        <a routerLink="/partner/profile">Profile</a>
      </nav>
      <section *ngIf="loading" class="wa-card" role="status">Loading earnings…</section>
      <div *ngIf="error && !loading" class="wa-card wa-error" role="alert"><p>{{ error }}</p>
        <button type="button" class="wa-btn wa-btn--sm" (click)="load()">Retry</button></div>
      <section *ngIf="!loading && !error" class="wa-card" aria-label="Accruals">
        <p class="wa-muted" *ngIf="accruals.length === 0">No accruals yet. Only eligible completed services generate partner earnings — bookings alone never do.</p>
        <table *ngIf="accruals.length > 0" class="wa-table">
          <thead><tr><th>Booking</th><th>Gross</th><th>Commission</th><th>Share %</th><th>Accrued</th><th>Status</th><th>Earned</th></tr></thead>
          <tbody><tr *ngFor="let a of accruals">
            <td>{{ a.bookingId }}</td><td>{{ a.currency }} {{ a.grossAmount }}</td>
            <td>{{ a.commissionRate }}% ({{ a.currency }} {{ a.commissionAmount }})</td>
            <td>{{ a.partnerPercent }}%</td><td>{{ a.currency }} {{ a.partnerAmount }}</td>
            <td>{{ a.status }}</td><td>{{ a.earnedAt }}</td>
          </tr></tbody>
        </table>
        <p class="wa-muted" *ngIf="disclaimer">{{ disclaimer }}</p>
      </section>
    </div>
  `,
})
export class PartnerEarningsPage implements OnInit {
  private readonly api = inject(PartnerApiService);
  loading = true;
  error: string | null = null;
  accruals: any[] = [];
  disclaimer: string | null = null;

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading = true;
    this.error = null;
    this.api.listEarnings().subscribe({
      next: (res) => {
        this.accruals = res.data ?? [];
        this.disclaimer = res.meta?.disclaimer ?? null;
        this.loading = false;
      },
      error: (err) => {
        this.error = err?.error?.error?.message ?? err?.message ?? 'Failed to load earnings';
        this.loading = false;
      },
    });
  }
}

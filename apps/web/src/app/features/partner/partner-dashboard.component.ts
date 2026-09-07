import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { PartnerApiService } from '../../core/services/partner.service';

/**
 * Slice 17 — training-centre partner dashboard (web).
 * Real backend data only. Operational metrics with an explicit
 * no-guarantee disclaimer. No customer PII is rendered.
 */
@Component({
  selector: 'waasha-partner-dashboard',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <div class="wa-admin">
      <header><h1 class="wa-title">Partner · Dashboard</h1>
      <p class="wa-sub" *ngIf="data">Attributable activity for {{ data.partner?.displayName }}. No guaranteed customers, bookings, income or employment.</p></header>
      <nav class="wa-adminnav" aria-label="Partner sections">
        <a routerLink="/partner/dashboard">Dashboard</a>
        <a routerLink="/partner/referrals">Referrals</a>
        <a routerLink="/partner/providers">Providers</a>
        <a routerLink="/partner/earnings">Earnings</a>
        <a routerLink="/partner/profile">Profile</a>
      </nav>
      <section *ngIf="loading" class="wa-card" role="status">Loading dashboard…</section>
      <div *ngIf="error && !loading" class="wa-card wa-error" role="alert"><p>{{ error }}</p>
        <button type="button" class="wa-btn wa-btn--sm" (click)="load()">Retry</button></div>
      <section *ngIf="data && !loading" class="wa-card" aria-label="Partner metrics">
        <dl class="wa-meta">
          <div><dt>Partnership status</dt><dd>{{ data.partner?.status }} · verification {{ data.partner?.verificationStatus }}</dd></div>
          <div><dt>Referred students</dt><dd>{{ data.metrics?.referredStudents }}</dd></div>
          <div><dt>Active attributions</dt><dd>{{ data.metrics?.activeAttributions }}</dd></div>
          <div><dt>Verified students</dt><dd>{{ data.metrics?.verifiedStudents }}</dd></div>
          <div><dt>Active providers</dt><dd>{{ data.metrics?.activeProviders }}</dd></div>
          <div><dt>Services configured</dt><dd>{{ data.metrics?.servicesConfigured }}</dd></div>
          <div><dt>Completed eligible services</dt><dd>{{ data.metrics?.completedEligibleServices }}</dd></div>
          <div><dt>Accrued earnings</dt><dd>{{ data.metrics?.accruedEarningsCurrency }} {{ data.metrics?.accruedEarningsTotal }}</dd></div>
          <div><dt>Pending review items</dt><dd>{{ data.metrics?.pendingReviewItems }}</dd></div>
        </dl>
        <p class="wa-muted">{{ data.disclaimer }}</p>
      </section>
    </div>
  `,
})
export class PartnerDashboardComponent implements OnInit {
  private readonly api = inject(PartnerApiService);
  loading = true;
  error: string | null = null;
  data: any = null;

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading = true;
    this.error = null;
    this.api.getDashboard().subscribe({
      next: (res) => {
        this.data = res.data;
        this.loading = false;
      },
      error: (err) => {
        this.error = err?.error?.error?.message ?? err?.message ?? 'Failed to load dashboard';
        this.loading = false;
      },
    });
  }
}

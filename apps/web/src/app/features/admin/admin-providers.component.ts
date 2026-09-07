import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminApiService } from '../../core/services/admin.service';
import { AdminNavComponent } from './admin-nav.component';
import { adminErrorMessage, pageList, shortDate } from './admin.utils';

/**
 * Slice 16 — provider management + verification (web).
 * Search, profile, tier, verification/Student status, services, coverage,
 * team/business links, status changes, and the admin verification workflow
 * (approve/reject/revoke with notes). No ranking controls exist — by design.
 */
@Component({
  selector: 'waasha-admin-providers',
  standalone: true,
  imports: [CommonModule, FormsModule, AdminNavComponent],
  template: `
    <div class="wa-admin">
      <header><h1 class="wa-title">Admin · Providers &amp; verification</h1>
      <p class="wa-sub">Verification is admin-controlled. Student status is never self-assigned. No ranking preference exists.</p></header>
      <waasha-admin-nav />
      <section class="wa-card" aria-label="Search providers">
        <form (ngSubmit)="search()" class="wa-form wa-form--row">
          <label class="wa-field"><span>Name</span><input [(ngModel)]="q" name="q" maxlength="191" /></label>
          <label class="wa-field"><span>Tier</span><select [(ngModel)]="tier" name="tier">
            <option value="">Any</option><option value="T1">T1</option><option value="T2">T2</option>
            <option value="T3">T3</option><option value="STUDENT">STUDENT</option></select></label>
          <label class="wa-field"><span>Verification</span><select [(ngModel)]="verificationStatus" name="vs">
            <option value="">Any</option><option *ngFor="let s of vsOpts" [value]="s">{{ s }}</option></select></label>
          <label class="wa-field"><span>Student</span><select [(ngModel)]="student" name="st">
            <option value="">Any</option><option value="pending">Pending</option><option value="verified">Verified</option></select></label>
          <button type="submit" class="wa-btn wa-btn--sm" [disabled]="loading">Search</button>
        </form>
      </section>
      <section *ngIf="loading" class="wa-card" role="status">Loading providers…</section>
      <div *ngIf="error && !loading" class="wa-card wa-error" role="alert"><p>{{ error }}</p>
        <button type="button" class="wa-btn wa-btn--sm" (click)="search()">Retry</button></div>
      <section *ngIf="!loading && !error" class="wa-card" aria-label="Provider results">
        <p class="wa-muted" *ngIf="providers.length === 0">No providers match.</p>
        <table *ngIf="providers.length > 0" class="wa-table">
          <thead><tr><th>Name</th><th>Tier</th><th>Status</th><th>Verification</th><th>Student</th><th></th></tr></thead>
          <tbody><tr *ngFor="let p of providers">
            <td>{{ p.displayName || p.id }}</td><td>{{ p.tier }}</td><td>{{ p.status }}</td>
            <td>{{ p.verificationStatus }}</td><td>{{ p.isStudent ? p.studentVerificationStatus : '—' }}</td>
            <td><button type="button" class="wa-btn wa-btn--sm" (click)="select(p.id)">Inspect</button></td>
          </tr></tbody>
        </table>
        <div class="wa-pager" *ngIf="meta.total > meta.perPage">
          <button type="button" *ngFor="let p of pages()" class="wa-btn wa-btn--sm" [disabled]="p === meta.page" (click)="goto(p)">{{ p }}</button>
        </div>
      </section>
      <section *ngIf="detail" class="wa-card" aria-label="Provider detail">
        <h2 class="wa-card__title">{{ detail.displayName || detail.id }}</h2>
        <dl class="wa-meta">
          <div><dt>Tier</dt><dd>{{ detail.tier }} ({{ detail.providerType }})</dd></div>
          <div><dt>Status</dt><dd>{{ detail.status }}</dd></div>
          <div><dt>Verification</dt><dd>{{ detail.verificationStatus }}</dd></div>
          <div><dt>Student</dt><dd>{{ detail.isStudent ? detail.studentVerificationStatus : 'no' }}</dd></div>
          <div><dt>Coverage</dt><dd>{{ detail.coverageRadiusKm }} km</dd></div>
          <div><dt>Cash accepted</dt><dd>{{ detail.acceptCash ? 'yes' : 'no' }}</dd></div>
          <div><dt>Services</dt><dd>{{ (detail.services || []).length }}</dd></div>
        </dl>
        <div class="wa-row">
          <label class="wa-field"><span>Verification note</span>
            <input [(ngModel)]="notes" name="notes" maxlength="2000" placeholder="Reason / reference (audited)" /></label>
        </div>
        <div class="wa-row" role="group" aria-label="Verification actions">
          <button type="button" class="wa-btn wa-btn--sm" (click)="verify('APPROVE')">Approve</button>
          <button type="button" class="wa-btn wa-btn--sm" (click)="verify('REJECT')">Reject</button>
          <button type="button" class="wa-btn wa-btn--sm" (click)="verify('REVOKE')">Revoke</button>
          <button type="button" class="wa-btn wa-btn--sm" (click)="verifyStudent('APPROVE')">Student: approve</button>
          <button type="button" class="wa-btn wa-btn--sm" (click)="verifyStudent('REJECT')">Student: reject</button>
          <button type="button" class="wa-btn wa-btn--sm" (click)="verifyStudent('REVOKE')">Student: revoke</button>
          <button type="button" class="wa-btn wa-btn--sm" (click)="setStatus(detail.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE')">
            {{ detail.status === 'ACTIVE' ? 'Suspend' : 'Activate' }}</button>
        </div>
        <p *ngIf="actionError" class="wa-field__error" role="alert">{{ actionError }}</p>
        <h3 class="wa-card__sub">Verification history</h3>
        <ul class="wa-list"><li *ngFor="let a of detail.verificationHistory">{{ a.action }} · {{ date(a.createdAt) }}</li></ul>
      </section>
    </div>
  `,
})
export class AdminProvidersComponent implements OnInit {
  private readonly api = inject(AdminApiService);
  q = '';
  tier = '';
  verificationStatus = '';
  student = '';
  vsOpts = ['UNVERIFIED', 'PENDING', 'VERIFIED', 'REJECTED', 'EXPIRED', 'SUSPENDED'];
  providers: any[] = [];
  meta = { page: 1, perPage: 20, total: 0 };
  detail: any = null;
  notes = '';
  loading = false;
  error: string | null = null;
  actionError: string | null = null;

  ngOnInit(): void { this.search(); }

  search(): void {
    this.loading = true;
    this.error = null;
    this.api.searchProviders({
      q: this.q || undefined, tier: this.tier || undefined,
      verificationStatus: this.verificationStatus || undefined, student: this.student || undefined,
      page: this.meta.page, perPage: 20,
    }).subscribe({
      next: (res) => { this.providers = res.data; this.meta = res.meta; this.loading = false; },
      error: (err) => { this.error = adminErrorMessage(err); this.loading = false; },
    });
  }

  goto(p: number): void { this.meta.page = p; this.search(); }
  pages(): number[] { return pageList(this.meta.total, this.meta.perPage); }
  date(v: unknown): string { return shortDate(v); }

  select(id: string): void {
    this.actionError = null;
    this.api.getProvider(id).subscribe({
      next: (res) => { this.detail = res.data; },
      error: (err) => { this.actionError = adminErrorMessage(err); },
    });
  }

  verify(action: 'APPROVE' | 'REJECT' | 'REVOKE'): void {
    if (!this.detail || !window.confirm(`Confirm provider verification ${action}?`)) return;
    this.actionError = null;
    this.api.verifyProvider(this.detail.id, action, this.notes || null).subscribe({
      next: (res) => { this.detail.verificationStatus = res.data.verificationStatus; this.search(); },
      error: (err) => { this.actionError = adminErrorMessage(err); },
    });
  }

  verifyStudent(action: 'APPROVE' | 'REJECT' | 'REVOKE'): void {
    if (!this.detail || !window.confirm(`Confirm student verification ${action}? Verified students are never rank-boosted.`)) return;
    this.actionError = null;
    this.api.verifyStudent(this.detail.id, action, this.notes || null).subscribe({
      next: (res) => {
        this.detail.isStudent = res.data.isStudent;
        this.detail.studentVerificationStatus = res.data.studentVerificationStatus;
        this.search();
      },
      error: (err) => { this.actionError = adminErrorMessage(err); },
    });
  }

  setStatus(status: string): void {
    if (!this.detail || !window.confirm(`Confirm provider status → ${status}?`)) return;
    this.actionError = null;
    this.api.setProviderStatus(this.detail.id, status as 'ACTIVE' | 'PAUSED' | 'SUSPENDED').subscribe({
      next: (res) => { this.detail.status = res.data.status; this.search(); },
      error: (err) => { this.actionError = adminErrorMessage(err); },
    });
  }
}

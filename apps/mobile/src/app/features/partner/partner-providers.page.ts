import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { PartnerApiService } from '../../core/services/partner.service';

/**
 * Slice 17 — attributed provider list + training evidence (mobile — same APIs and rules as web).
 * Operational visibility only: no customer PII, no payment secrets.
 * Verification support is advisory — final Student verification stays
 * with the admin workflow.
 */
@Component({
  selector: 'waasha-mobile-partner-providers',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <div class="wa-admin">
      <header><h1 class="wa-title">Partner · Providers</h1>
      <p class="wa-sub">Providers attributed to your organisation. Affiliation never affects marketplace ranking.</p></header>
      <nav class="wa-adminnav" aria-label="Partner sections">
        <a routerLink="/partner/dashboard">Dashboard</a>
        <a routerLink="/partner/referrals">Referrals</a>
        <a routerLink="/partner/providers">Providers</a>
        <a routerLink="/partner/earnings">Earnings</a>
        <a routerLink="/partner/profile">Profile</a>
      </nav>
      <section *ngIf="loading" class="wa-card" role="status">Loading providers…</section>
      <div *ngIf="error && !loading" class="wa-card wa-error" role="alert"><p>{{ error }}</p>
        <button type="button" class="wa-btn wa-btn--sm" (click)="load()">Retry</button></div>
      <section *ngIf="!loading" class="wa-card" aria-label="Attributed providers">
        <p class="wa-muted" *ngIf="providers.length === 0">No attributed providers yet. Referrals become visible here after onboarding.</p>
        <table *ngIf="providers.length > 0" class="wa-table">
          <thead><tr><th>Provider</th><th>Status</th><th>Student</th><th>Services</th><th>Completed</th><th>Attribution</th><th></th></tr></thead>
          <tbody><tr *ngFor="let p of providers">
            <td>{{ p.displayName || p.providerId }}</td><td>{{ p.status }} / {{ p.verificationStatus }}</td>
            <td>{{ p.isStudent ? p.studentVerificationStatus : '—' }}</td>
            <td>{{ p.serviceCount }}</td><td>{{ p.completedEligibleServices }}</td><td>{{ p.attributionStatus }}</td>
            <td><button type="button" class="wa-btn wa-btn--sm" (click)="support(p.providerId)">Confirm training</button></td>
          </tr></tbody>
        </table>
        <p *ngIf="actionMsg" role="status">{{ actionMsg }}</p>
      </section>
      <section class="wa-card" aria-label="Training evidence">
        <h2 class="wa-card__title">Training evidence</h2>
        <form (ngSubmit)="submit()" class="wa-form wa-form--row">
          <label class="wa-field"><span>Provider ID</span><input [(ngModel)]="providerId" name="pid" maxlength="191" /></label>
          <label class="wa-field"><span>Programme</span><input [(ngModel)]="programme" name="prog" maxlength="191" /></label>
          <label class="wa-field"><span>Qualification ref</span><input [(ngModel)]="qualification" name="qual" maxlength="255" /></label>
          <label class="wa-field"><span>Confirmation</span><input [(ngModel)]="confirmation" name="conf" maxlength="5000" /></label>
          <button type="submit" class="wa-btn wa-btn--sm" [disabled]="submitting">Submit evidence</button>
        </form>
        <p *ngIf="evidenceMsg" role="status">{{ evidenceMsg }}</p>
        <table *ngIf="evidence.length > 0" class="wa-table">
          <thead><tr><th>Provider</th><th>Programme</th><th>Status</th><th>Created</th></tr></thead>
          <tbody><tr *ngFor="let e of evidence">
            <td>{{ e.providerId }}</td><td>{{ e.programme || '—' }}</td><td>{{ e.status }}</td><td>{{ e.createdAt }}</td>
          </tr></tbody>
        </table>
      </section>
    </div>
  `,
})
export class PartnerProvidersPage implements OnInit {
  private readonly api = inject(PartnerApiService);
  loading = true;
  submitting = false;
  error: string | null = null;
  providers: any[] = [];
  evidence: any[] = [];
  providerId = '';
  programme = '';
  qualification = '';
  confirmation = '';
  actionMsg: string | null = null;
  evidenceMsg: string | null = null;

  ngOnInit(): void {
    this.load();
    this.loadEvidence();
  }

  load(): void {
    this.loading = true;
    this.error = null;
    this.api.listProviders().subscribe({
      next: (res) => {
        this.providers = res.data ?? [];
        this.loading = false;
      },
      error: (err) => {
        this.error = err?.error?.error?.message ?? err?.message ?? 'Failed to load providers';
        this.loading = false;
      },
    });
  }

  loadEvidence(): void {
    this.api.listEvidence().subscribe({ next: (res) => (this.evidence = res.data ?? []), error: () => {} });
  }

  support(providerId: string): void {
    this.actionMsg = null;
    this.api.supportVerification(providerId).subscribe({
      next: () => {
        this.actionMsg = 'Training participation confirmed (advisory — final verification stays with Waasha).';
      },
      error: (err) => {
        this.actionMsg = err?.error?.error?.message ?? err?.message ?? 'Failed to confirm training';
      },
    });
  }

  submit(): void {
    this.submitting = true;
    this.evidenceMsg = null;
    this.api
      .submitEvidence({
        providerId: this.providerId,
        programme: this.programme || null,
        qualificationReference: this.qualification || null,
        institutionConfirmation: this.confirmation || null,
      })
      .subscribe({
        next: () => {
          this.evidenceMsg = 'Evidence submitted for admin review.';
          this.submitting = false;
          this.loadEvidence();
        },
        error: (err) => {
          this.evidenceMsg = err?.error?.error?.message ?? err?.message ?? 'Failed to submit evidence';
          this.submitting = false;
        },
      });
  }
}

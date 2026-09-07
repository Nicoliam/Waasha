import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { PartnerApiService } from '../../core/services/partner.service';

/**
 * Slice 17 — partner referral management (mobile — same APIs and rules as web).
 * Secure single-use invitation codes: the raw code is shown once at
 * creation and never again. Mutations are blocked offline.
 */
@Component({
  selector: 'waasha-mobile-partner-referrals',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <div class="wa-admin">
      <header><h1 class="wa-title">Partner · Referrals</h1>
      <p class="wa-sub">Invite prospective students. Share the code securely — it is shown once and cannot be recovered.</p></header>
      <nav class="wa-adminnav" aria-label="Partner sections">
        <a routerLink="/partner/dashboard">Dashboard</a>
        <a routerLink="/partner/referrals">Referrals</a>
        <a routerLink="/partner/providers">Providers</a>
        <a routerLink="/partner/earnings">Earnings</a>
        <a routerLink="/partner/profile">Profile</a>
      </nav>
      <section class="wa-card" aria-label="Create referral">
        <form (ngSubmit)="create()" class="wa-form wa-form--row">
          <label class="wa-field"><span>Invited email</span><input [(ngModel)]="email" name="email" maxlength="191" /></label>
          <label class="wa-field"><span>Invited phone</span><input [(ngModel)]="phone" name="phone" maxlength="32" /></label>
          <label class="wa-field"><span>Programme</span><input [(ngModel)]="programme" name="programme" maxlength="191" /></label>
          <button type="submit" class="wa-btn wa-btn--sm" [disabled]="creating">Create invitation</button>
        </form>
        <p *ngIf="formError" class="wa-field__error" role="alert">{{ formError }}</p>
        <div *ngIf="freshCode" class="wa-card" role="status">
          <p><strong>New invitation code (copy now — shown once):</strong></p>
          <p><code>{{ freshCode }}</code></p>
        </div>
      </section>
      <section class="wa-card" aria-label="Referral invitations">
        <p class="wa-muted" *ngIf="referrals.length === 0 && !loading">No invitations yet.</p>
        <table *ngIf="referrals.length > 0" class="wa-table">
          <thead><tr><th>Prefix</th><th>Invitee</th><th>Programme</th><th>Status</th><th>Expires</th><th></th></tr></thead>
          <tbody><tr *ngFor="let r of referrals">
            <td>{{ r.codePrefix }}…</td><td>{{ r.invitedEmail || r.invitedPhone }}</td>
            <td>{{ r.programme || '—' }}</td><td>{{ r.status }}</td><td>{{ r.expiresAt }}</td>
            <td><button *ngIf="r.status === 'PENDING'" type="button" class="wa-btn wa-btn--sm" (click)="revoke(r.id)">Revoke</button></td>
          </tr></tbody>
        </table>
      </section>
      <section class="wa-card" aria-label="Redeem referral">
        <h2 class="wa-card__title">Redeem a referral (prospective students)</h2>
        <form (ngSubmit)="redeem()" class="wa-form wa-form--row">
          <label class="wa-field"><span>Invitation code</span><input [(ngModel)]="code" name="code" maxlength="256" /></label>
          <button type="submit" class="wa-btn wa-btn--sm" [disabled]="redeeming">Redeem</button>
        </form>
        <p class="wa-muted">After redeeming, complete provider onboarding, then link the attribution below.</p>
        <button type="button" class="wa-btn wa-btn--sm" (click)="link()">Link attribution after onboarding</button>
        <p *ngIf="redeemMsg" role="status">{{ redeemMsg }}</p>
      </section>
    </div>
  `,
})
export class PartnerReferralsPage implements OnInit {
  private readonly api = inject(PartnerApiService);
  loading = true;
  creating = false;
  redeeming = false;
  email = '';
  phone = '';
  programme = '';
  code = '';
  referrals: any[] = [];
  freshCode: string | null = null;
  formError: string | null = null;
  redeemMsg: string | null = null;

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading = true;
    this.api.listReferrals().subscribe({
      next: (res) => {
        this.referrals = res.data ?? [];
        this.loading = false;
      },
      error: () => {
        this.loading = false;
      },
    });
  }

  create(): void {
    this.creating = true;
    this.formError = null;
    this.freshCode = null;
    this.api.createReferral({ invitedEmail: this.email || null, invitedPhone: this.phone || null, programme: this.programme || null }).subscribe({
      next: (res) => {
        this.freshCode = res.data?.code ?? null;
        this.creating = false;
        this.load();
      },
      error: (err) => {
        this.formError = err?.error?.error?.message ?? err?.message ?? 'Failed to create referral';
        this.creating = false;
      },
    });
  }

  revoke(id: string): void {
    this.api.revokeReferral(id).subscribe({ next: () => this.load(), error: () => this.load() });
  }

  redeem(): void {
    this.redeeming = true;
    this.redeemMsg = null;
    this.api.redeemReferral(this.code).subscribe({
      next: () => {
        this.redeemMsg = 'Referral claimed. Complete provider onboarding, then link the attribution.';
        this.redeeming = false;
        this.load();
      },
      error: (err) => {
        this.redeemMsg = err?.error?.error?.message ?? err?.message ?? 'Redeem failed';
        this.redeeming = false;
      },
    });
  }

  link(): void {
    this.api.linkAttribution().subscribe({
      next: () => {
        this.redeemMsg = 'Attribution linked to your provider profile.';
      },
      error: (err) => {
        this.redeemMsg = err?.error?.error?.message ?? err?.message ?? 'Link failed';
      },
    });
  }
}

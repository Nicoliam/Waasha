import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { PartnerApiService } from '../../core/services/partner.service';
import { AdminNavComponent } from './admin-nav.component';
import { adminErrorMessage } from './admin.utils';

/**
 * Slice 17 — admin training-centre oversight (web).
 * Search/review/approve/suspend/deactivate partners, inspect attribution
 * and evidence, configure partner share rules, inspect accruals, and
 * reverse accruals. All mutations audited server-side. Accruals are
 * ledger records — accrual is not payment.
 */
@Component({
  selector: 'waasha-admin-partners',
  standalone: true,
  imports: [CommonModule, FormsModule, AdminNavComponent],
  template: `
    <div class="wa-admin">
      <header><h1 class="wa-title">Admin · Training-centre partners</h1>
      <p class="wa-sub">Partnership lifecycle, attribution oversight, share configuration and accrual inspection. No ranking controls exist — by design.</p></header>
      <waasha-admin-nav />
      <section class="wa-card" aria-label="Search partners">
        <form (ngSubmit)="search()" class="wa-form wa-form--row">
          <label class="wa-field"><span>Search</span><input [(ngModel)]="q" name="q" maxlength="191" /></label>
          <label class="wa-field"><span>Status</span><select [(ngModel)]="status" name="st">
            <option value="">Any</option><option value="PENDING">PENDING</option><option value="ACTIVE">ACTIVE</option>
            <option value="SUSPENDED">SUSPENDED</option><option value="DEACTIVATED">DEACTIVATED</option></select></label>
          <button type="submit" class="wa-btn wa-btn--sm" [disabled]="loading">Search</button>
        </form>
      </section>
      <section *ngIf="loading" class="wa-card" role="status">Loading partners…</section>
      <div *ngIf="error && !loading" class="wa-card wa-error" role="alert"><p>{{ error }}</p>
        <button type="button" class="wa-btn wa-btn--sm" (click)="search()">Retry</button></div>
      <section *ngIf="!loading && !error" class="wa-card" aria-label="Partner results">
        <p class="wa-muted" *ngIf="partners.length === 0">No partners match.</p>
        <table *ngIf="partners.length > 0" class="wa-table">
          <thead><tr><th>Organisation</th><th>Type</th><th>Status</th><th>Verification</th><th></th></tr></thead>
          <tbody><tr *ngFor="let p of partners">
            <td>{{ p.displayName }}</td><td>{{ p.institutionType }}</td><td>{{ p.status }}</td><td>{{ p.verificationStatus }}</td>
            <td><button type="button" class="wa-btn wa-btn--sm" (click)="select(p.id)">Inspect</button></td>
          </tr></tbody>
        </table>
      </section>
      <section *ngIf="detail" class="wa-card" aria-label="Partner detail">
        <h2 class="wa-card__title">{{ detail.partner?.displayName }}</h2>
        <dl class="wa-meta">
          <div><dt>Status</dt><dd>{{ detail.partner?.status }}</dd></div>
          <div><dt>Verification</dt><dd>{{ detail.partner?.verificationStatus }}</dd></div>
          <div><dt>Members</dt><dd>{{ detail.members?.length }}</dd></div>
          <div><dt>Attributions</dt><dd>{{ detail.attributions?.length }}</dd></div>
          <div><dt>Accruals</dt><dd>{{ detail.accruals?.length }}</dd></div>
          <div><dt>Evidence</dt><dd>{{ detail.evidence?.length }}</dd></div>
        </dl>
        <div class="wa-row" role="group" aria-label="Lifecycle actions">
          <button type="button" class="wa-btn wa-btn--sm" (click)="setStatus('ACTIVE')">Approve / Activate</button>
          <button type="button" class="wa-btn wa-btn--sm" (click)="setStatus('SUSPENDED')">Suspend</button>
          <button type="button" class="wa-btn wa-btn--sm" (click)="setStatus('DEACTIVATED')">Deactivate</button>
          <button type="button" class="wa-btn wa-btn--sm" (click)="verify('APPROVE')">Verify</button>
          <button type="button" class="wa-btn wa-btn--sm" (click)="verify('REJECT')">Reject verification</button>
        </div>
        <div class="wa-row">
          <label class="wa-field"><span>Attribute provider ID</span><input [(ngModel)]="attrProviderId" name="ap" maxlength="191" /></label>
          <button type="button" class="wa-btn wa-btn--sm" (click)="attribute()">Attribute</button>
          <label class="wa-field"><span>End attribution ID</span><input [(ngModel)]="endAttrId" name="ea" maxlength="191" /></label>
          <label class="wa-field"><span>Reassign to partner ID</span><input [(ngModel)]="reassignTo" name="rt" maxlength="191" /></label>
          <button type="button" class="wa-btn wa-btn--sm" (click)="endAttribution()">End / Reassign</button>
        </div>
        <p *ngIf="actionError" class="wa-field__error" role="alert">{{ actionError }}</p>
        <h3 class="wa-card__sub">Share rules (configurable % of platform commission)</h3>
        <form (ngSubmit)="createRule()" class="wa-form wa-form--row">
          <label class="wa-field"><span>Scope</span><select [(ngModel)]="ruleScope" name="rs">
            <option value="GLOBAL">GLOBAL</option><option value="PARTNER">PARTNER</option><option value="PROGRAMME">PROGRAMME</option></select></label>
          <label class="wa-field"><span>Percent (0–100)</span><input [(ngModel)]="rulePercent" name="rp" type="number" min="0" max="100" /></label>
          <label class="wa-field"><span>Programme</span><input [(ngModel)]="ruleProgramme" name="rprog" maxlength="191" /></label>
          <button type="submit" class="wa-btn wa-btn--sm">Create rule</button>
        </form>
        <ul class="wa-list"><li *ngFor="let r of rules"> {{ r.scope }} · {{ r.percent }}% · active {{ r.isActive }}
          <button type="button" class="wa-btn wa-btn--sm" (click)="toggleRule(r)">{{ r.isActive ? 'Disable' : 'Enable' }}</button></li></ul>
        <h3 class="wa-card__sub">Accruals (ledger — not payouts)</h3>
        <ul class="wa-list"><li *ngFor="let a of accruals"> {{ a.bookingId }} · {{ a.currency }} {{ a.partnerAmount }} · {{ a.status }}
          <button *ngIf="a.status === 'ACCRUED'" type="button" class="wa-btn wa-btn--sm" (click)="reverseAccrual(a.id)">Reverse</button></li></ul>
      </section>
    </div>
  `,
})
export class AdminPartnersComponent implements OnInit {
  private readonly api = inject(PartnerApiService);
  q = '';
  status = '';
  loading = false;
  error: string | null = null;
  partners: any[] = [];
  detail: any = null;
  actionError: string | null = null;
  attrProviderId = '';
  endAttrId = '';
  reassignTo = '';
  ruleScope = 'GLOBAL';
  rulePercent: number | null = null;
  ruleProgramme = '';
  rules: any[] = [];
  accruals: any[] = [];

  ngOnInit(): void {
    this.search();
    this.loadRules();
  }

  search(): void {
    this.loading = true;
    this.error = null;
    this.api.adminSearch({ q: this.q || undefined, status: this.status || undefined }).subscribe({
      next: (res) => {
        this.partners = res.data ?? [];
        this.loading = false;
      },
      error: (err) => {
        this.error = adminErrorMessage(err);
        this.loading = false;
      },
    });
  }

  select(id: string): void {
    this.actionError = null;
    this.api.adminGet(id).subscribe({
      next: (res) => {
        this.detail = res.data;
        this.accruals = res.data?.accruals ?? [];
        this.loadRules();
      },
      error: (err) => {
        this.actionError = adminErrorMessage(err);
      },
    });
  }

  setStatus(status: string): void {
    if (!this.detail?.partner?.id) return;
    this.api.adminSetStatus(this.detail.partner.id, status).subscribe({
      next: (res) => {
        this.detail.partner = res.data;
        this.search();
      },
      error: (err) => {
        this.actionError = adminErrorMessage(err);
      },
    });
  }

  verify(action: string): void {
    if (!this.detail?.partner?.id) return;
    this.api.adminSetVerification(this.detail.partner.id, action).subscribe({
      next: (res) => {
        this.detail.partner = res.data;
        this.search();
      },
      error: (err) => {
        this.actionError = adminErrorMessage(err);
      },
    });
  }

  attribute(): void {
    if (!this.detail?.partner?.id || !this.attrProviderId) return;
    this.api.adminAttribute(this.detail.partner.id, this.attrProviderId).subscribe({
      next: () => this.select(this.detail.partner.id),
      error: (err) => {
        this.actionError = adminErrorMessage(err);
      },
    });
  }

  endAttribution(): void {
    if (!this.endAttrId) return;
    this.api.adminEndAttribution(this.endAttrId, { reason: null, reassignToPartnerId: this.reassignTo || null }).subscribe({
      next: () => this.select(this.detail.partner.id),
      error: (err) => {
        this.actionError = adminErrorMessage(err);
      },
    });
  }

  loadRules(): void {
    this.api.adminListRules(this.detail?.partner?.id ? { partnerId: this.detail.partner.id } : {}).subscribe({
      next: (res) => {
        this.rules = res.data ?? [];
      },
      error: () => {},
    });
  }

  createRule(): void {
    if (this.rulePercent === null) return;
    this.api
      .adminCreateRule({
        scope: this.ruleScope,
        partnerId: this.ruleScope === 'PARTNER' ? this.detail?.partner?.id : null,
        programme: this.ruleProgramme || null,
        percent: this.rulePercent,
      })
      .subscribe({
        next: () => this.loadRules(),
        error: (err) => {
          this.actionError = adminErrorMessage(err);
        },
      });
  }

  toggleRule(rule: any): void {
    this.api.adminUpdateRule(rule.id, { isActive: !rule.isActive }).subscribe({
      next: () => this.loadRules(),
      error: (err) => {
        this.actionError = adminErrorMessage(err);
      },
    });
  }

  reverseAccrual(id: string): void {
    this.api.adminReverseAccrual(id).subscribe({
      next: () => this.select(this.detail.partner.id),
      error: (err) => {
        this.actionError = adminErrorMessage(err);
      },
    });
  }
}

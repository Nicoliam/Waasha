import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminApiService } from '../../core/services/admin.service';
import { AdminNavComponent } from './admin-nav.component';
import { adminErrorMessage, pageList, shortDate } from './admin.utils';

/**
 * Slice 16 — business oversight (web).
 * Read-only inspection of T2 teams, T3 businesses, units and staff, plus
 * invitation oversight with audited revocation (Slice 15 identity-binding
 * risk mitigation). Provider/business write paths stay on Slice 15 APIs.
 */
@Component({
  selector: 'waasha-admin-businesses',
  standalone: true,
  imports: [CommonModule, FormsModule, AdminNavComponent],
  template: `
    <div class="wa-admin">
      <header><h1 class="wa-title">Admin · Businesses</h1>
      <p class="wa-sub">Oversight of teams, businesses, units, staff and invitations. Read-only except invitation revocation.</p></header>
      <waasha-admin-nav />
      <section class="wa-card" aria-label="Business scope">
        <div class="wa-form wa-form--row">
          <label class="wa-field"><span>Scope</span><select [(ngModel)]="tab" name="tab" (change)="load()">
            <option value="businesses">T3 businesses</option><option value="teams">T2 teams</option>
            <option value="invitations">Invitations</option></select></label>
          <label class="wa-field" *ngIf="tab === 'invitations'"><span>Invitation scope</span>
            <select [(ngModel)]="invScope" name="invScope" (change)="load()">
            <option value="all">All</option><option value="team">Team</option><option value="business">Business</option></select></label>
        </div>
      </section>
      <section *ngIf="loading" class="wa-card" role="status">Loading…</section>
      <div *ngIf="error && !loading" class="wa-card wa-error" role="alert"><p>{{ error }}</p>
        <button type="button" class="wa-btn wa-btn--sm" (click)="load()">Retry</button></div>
      <section *ngIf="!loading && !error && tab !== 'invitations'" class="wa-card" aria-label="Results">
        <table class="wa-table"><thead><tr><th>Name</th><th>Status</th><th>Created</th><th></th></tr></thead>
        <tbody><tr *ngFor="let b of rows">
          <td>{{ b.displayName || b.name || b.id }}</td><td>{{ b.status }}</td><td>{{ date(b.createdAt) }}</td>
          <td><button *ngIf="tab === 'businesses'" type="button" class="wa-btn wa-btn--sm" (click)="selectBusiness(b.id)">Inspect</button></td>
        </tr></tbody></table>
        <div class="wa-pager" *ngIf="meta.total > meta.perPage">
          <button type="button" *ngFor="let p of pages()" class="wa-btn wa-btn--sm" [disabled]="p === meta.page" (click)="goto(p)">{{ p }}</button>
        </div>
      </section>
      <section *ngIf="!loading && !error && tab === 'invitations'" class="wa-card" aria-label="Invitations">
        <p class="wa-muted">Email-only invites carry no identity binding — revoke anything suspicious. Token hashes are never shown.</p>
        <table class="wa-table" *ngIf="flatInvites().length > 0"><thead><tr><th>Scope</th><th>Status</th><th>Expires</th><th></th></tr></thead>
        <tbody><tr *ngFor="let inv of flatInvites()">
          <td>{{ inv._scope }}</td><td>{{ inv.status }}</td><td>{{ date(inv.expiresAt) }}</td>
          <td><button *ngIf="inv.status === 'PENDING'" type="button" class="wa-btn wa-btn--sm"
            (click)="revoke(inv._scope, inv.id)">Revoke</button></td>
        </tr></tbody></table>
        <p *ngIf="actionError" class="wa-field__error" role="alert">{{ actionError }}</p>
      </section>
      <section *ngIf="detail" class="wa-card" aria-label="Business detail">
        <h2 class="wa-card__title">{{ detail.displayName }}</h2>
        <dl class="wa-meta">
          <div><dt>Status</dt><dd>{{ detail.status }}</dd></div>
          <div><dt>Verification</dt><dd>{{ detail.verificationStatus }}</dd></div>
          <div><dt>Units</dt><dd>{{ (detail.units || []).length }}</dd></div>
          <div><dt>Staff rows</dt><dd>{{ (detail.staff || []).length }}</dd></div>
        </dl>
        <h3 class="wa-card__sub">Units</h3>
        <ul class="wa-list"><li *ngFor="let u of detail.units">{{ u.name }} · {{ u.status }} · {{ u.coverageRadiusKm }} km</li></ul>
      </section>
    </div>
  `,
})
export class AdminBusinessesComponent implements OnInit {
  private readonly api = inject(AdminApiService);
  tab: 'businesses' | 'teams' | 'invitations' = 'businesses';
  invScope: 'all' | 'team' | 'business' = 'all';
  rows: any[] = [];
  invites: any = null;
  meta = { page: 1, perPage: 20, total: 0 };
  detail: any = null;
  loading = false;
  error: string | null = null;
  actionError: string | null = null;

  ngOnInit(): void { this.load(); }

  load(): void {
    this.loading = true;
    this.error = null;
    if (this.tab === 'teams') {
      this.api.listTeams({ page: this.meta.page, perPage: 20 }).subscribe({
        next: (res) => { this.rows = res.data; this.meta = res.meta; this.loading = false; },
        error: (err) => { this.error = adminErrorMessage(err); this.loading = false; },
      });
    } else if (this.tab === 'businesses') {
      this.api.listBusinesses({ page: this.meta.page, perPage: 20 }).subscribe({
        next: (res) => { this.rows = res.data; this.meta = res.meta; this.loading = false; },
        error: (err) => { this.error = adminErrorMessage(err); this.loading = false; },
      });
    } else {
      this.api.listInvitations({ scope: this.invScope, page: this.meta.page, perPage: 20 }).subscribe({
        next: (res) => { this.invites = res.data; this.meta = { page: 1, perPage: 20, total: 0 }; this.loading = false; },
        error: (err) => { this.error = adminErrorMessage(err); this.loading = false; },
      });
    }
  }

  flatInvites(): any[] {
    if (!this.invites) return [];
    if (Array.isArray(this.invites)) return this.invites.map((i: any) => ({ ...i, _scope: this.invScope }));
    return [
      ...(this.invites.team || []).map((i: any) => ({ ...i, _scope: 'team' })),
      ...(this.invites.business || []).map((i: any) => ({ ...i, _scope: 'business' })),
    ];
  }

  goto(p: number): void { this.meta.page = p; this.load(); }
  pages(): number[] { return pageList(this.meta.total, this.meta.perPage); }
  date(v: unknown): string { return shortDate(v); }

  selectBusiness(id: string): void {
    this.api.getBusiness(id).subscribe({
      next: (res) => { this.detail = res.data; },
      error: (err) => { this.error = adminErrorMessage(err); },
    });
  }

  revoke(scope: 'team' | 'business', id: string): void {
    if (!window.confirm('Revoke this pending invitation? The invitee will no longer be able to accept.')) return;
    this.actionError = null;
    this.api.revokeInvitation(scope, id).subscribe({
      next: () => this.load(),
      error: (err) => { this.actionError = adminErrorMessage(err); },
    });
  }
}

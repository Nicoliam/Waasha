import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminApiService } from '../../core/services/admin.service';
import { AdminNavComponent } from './admin-nav.component';
import { adminErrorMessage, pageList, shortDate } from './admin.utils';

/**
 * Slice 16 — user management (web).
 * Search, profile + roles + status, deactivate/reactivate (audited),
 * recent audit. Passwords/hashes/tokens are never returned by the API
 * and therefore can never render here. Verification evidence beyond
 * status/notes is never requested by this UI.
 */
@Component({
  selector: 'waasha-admin-users',
  standalone: true,
  imports: [CommonModule, FormsModule, AdminNavComponent],
  template: `
    <div class="wa-admin">
      <header><h1 class="wa-title">Admin · Users</h1>
      <p class="wa-sub">Search accounts, inspect roles and status. Deactivation preserves all history.</p></header>
      <waasha-admin-nav />
      <section class="wa-card" aria-label="Search users">
        <form (ngSubmit)="search()" class="wa-form wa-form--row">
          <label class="wa-field"><span>Search (email)</span>
            <input [(ngModel)]="q" name="q" maxlength="191" placeholder="user@example.com" /></label>
          <label class="wa-field"><span>Status</span>
            <select [(ngModel)]="status" name="status">
              <option value="">Any</option>
              <option *ngFor="let s of userStatuses" [value]="s">{{ s }}</option>
            </select></label>
          <button type="submit" class="wa-btn wa-btn--sm" [disabled]="loading">Search</button>
        </form>
      </section>
      <section *ngIf="loading" class="wa-card" role="status">Loading users…</section>
      <div *ngIf="error && !loading" class="wa-card wa-error" role="alert"><p>{{ error }}</p>
        <button type="button" class="wa-btn wa-btn--sm" (click)="search()">Retry</button></div>
      <section *ngIf="!loading && !error" class="wa-card" aria-label="User results">
        <p class="wa-muted" *ngIf="users.length === 0">No users match.</p>
        <table *ngIf="users.length > 0" class="wa-table">
          <thead><tr><th>Email</th><th>Roles</th><th>Status</th><th>Created</th><th></th></tr></thead>
          <tbody><tr *ngFor="let u of users">
            <td>{{ u.email || '—' }}</td><td>{{ (u.roles || []).join(', ') }}</td><td>{{ u.status }}</td>
            <td>{{ date(u.createdAt) }}</td>
            <td><button type="button" class="wa-btn wa-btn--sm" (click)="select(u.id)">Inspect</button></td>
          </tr></tbody>
        </table>
        <div class="wa-pager" *ngIf="meta.total > meta.perPage">
          <button type="button" *ngFor="let p of pages()" class="wa-btn wa-btn--sm" [disabled]="p === meta.page" (click)="goto(p)">{{ p }}</button>
        </div>
      </section>
      <section *ngIf="detail" class="wa-card" aria-label="User detail">
        <h2 class="wa-card__title">{{ detail.email || detail.id }}</h2>
        <dl class="wa-meta">
          <div><dt>Status</dt><dd>{{ detail.status }}</dd></div>
          <div><dt>Roles</dt><dd>{{ (detail.roles || []).join(', ') || '—' }}</dd></div>
          <div><dt>Customer profile</dt><dd>{{ detail.customerProfile ? 'yes' : 'no' }}</dd></div>
          <div><dt>Provider profile</dt><dd>{{ detail.providerProfile ? 'yes' : 'no' }}</dd></div>
        </dl>
        <div class="wa-row">
          <button type="button" class="wa-btn wa-btn--sm" *ngIf="detail.status === 'ACTIVE'" (click)="confirm('SUSPENDED')">Suspend</button>
          <button type="button" class="wa-btn wa-btn--sm" *ngIf="detail.status === 'ACTIVE'" (click)="confirm('DEACTIVATED')">Deactivate</button>
          <button type="button" class="wa-btn wa-btn--sm" *ngIf="detail.status !== 'ACTIVE'" (click)="confirm('ACTIVE')">Reactivate</button>
        </div>
        <p *ngIf="actionError" class="wa-field__error" role="alert">{{ actionError }}</p>
        <h3 class="wa-card__sub">Recent audit</h3>
        <p class="wa-muted" *ngIf="(detail.recentAudit || []).length === 0">No audit entries.</p>
        <ul class="wa-list"><li *ngFor="let a of detail.recentAudit">{{ a.action }} · {{ date(a.createdAt) }}</li></ul>
      </section>
    </div>
  `,
})
export class AdminUsersComponent implements OnInit {
  private readonly api = inject(AdminApiService);
  q = '';
  status = '';
  userStatuses = ['ACTIVE', 'SUSPENDED', 'PENDING', 'PENDING_VERIFICATION', 'LOCKED', 'DEACTIVATED'];
  users: any[] = [];
  meta = { page: 1, perPage: 20, total: 0 };
  detail: any = null;
  loading = false;
  error: string | null = null;
  actionError: string | null = null;

  ngOnInit(): void { this.search(); }

  search(): void {
    this.loading = true;
    this.error = null;
    this.api.searchUsers({ q: this.q || undefined, status: this.status || undefined, page: this.meta.page, perPage: 20 }).subscribe({
      next: (res) => { this.users = res.data; this.meta = res.meta; this.loading = false; },
      error: (err) => { this.error = adminErrorMessage(err); this.loading = false; },
    });
  }

  goto(p: number): void { this.meta.page = p; this.search(); }
  pages(): number[] { return pageList(this.meta.total, this.meta.perPage); }
  date(v: unknown): string { return shortDate(v); }

  select(id: string): void {
    this.actionError = null;
    this.api.getUser(id).subscribe({
      next: (res) => { this.detail = res.data; },
      error: (err) => { this.actionError = adminErrorMessage(err); },
    });
  }

  confirm(status: 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED'): void {
    if (!this.detail) return;
    const label = status === 'ACTIVE' ? 'reactivate' : status === 'SUSPENDED' ? 'suspend' : 'deactivate';
    if (!window.confirm(`Confirm: ${label} ${this.detail.email || this.detail.id}? History is preserved.`)) return;
    this.actionError = null;
    this.api.setUserStatus(this.detail.id, status).subscribe({
      next: (res) => { this.detail = { ...this.detail, status: res.data.status }; this.search(); },
      error: (err) => { this.actionError = adminErrorMessage(err); },
    });
  }
}

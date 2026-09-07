import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminApiService } from '../../core/services/admin.service';
import { AdminNavComponent } from './admin-nav.component';
import { adminErrorMessage, pageList, shortDate } from './admin.utils';

/**
 * Slice 16 — audit log viewer (web).
 * Filter by actor, action, entity and date. Append-only: no edit or
 * delete controls exist. Secret-like metadata is redacted server-side.
 */
@Component({
  selector: 'waasha-admin-audit',
  standalone: true,
  imports: [CommonModule, FormsModule, AdminNavComponent],
  template: `
    <div class="wa-admin">
      <header><h1 class="wa-title">Admin · Audit log</h1>
      <p class="wa-sub">Append-only history of sensitive actions. Entries cannot be edited or deleted.</p></header>
      <waasha-admin-nav />
      <section class="wa-card" aria-label="Filter audit logs">
        <form (ngSubmit)="search()" class="wa-form wa-form--row">
          <label class="wa-field"><span>Action</span><input [(ngModel)]="action" name="action" maxlength="128" placeholder="USER_DEACTIVATED" /></label>
          <label class="wa-field"><span>Entity type</span><input [(ngModel)]="entityType" name="et" maxlength="64" placeholder="provider_profile" /></label>
          <label class="wa-field"><span>Entity id</span><input [(ngModel)]="entityId" name="eid" maxlength="64" /></label>
          <label class="wa-field"><span>Actor user id</span><input [(ngModel)]="actorUserId" name="actor" maxlength="64" /></label>
          <button type="submit" class="wa-btn wa-btn--sm" [disabled]="loading">Search</button>
        </form>
      </section>
      <section *ngIf="loading" class="wa-card" role="status">Loading audit logs…</section>
      <div *ngIf="error && !loading" class="wa-card wa-error" role="alert"><p>{{ error }}</p></div>
      <section *ngIf="!loading && !error" class="wa-card" aria-label="Audit results">
        <p class="wa-muted" *ngIf="logs.length === 0">No audit entries match.</p>
        <table *ngIf="logs.length > 0" class="wa-table">
          <thead><tr><th>Time</th><th>Action</th><th>Entity</th><th>Actor</th></tr></thead>
          <tbody><tr *ngFor="let a of logs">
            <td>{{ date(a.createdAt) }}</td><td>{{ a.action }}</td>
            <td>{{ a.entityType }} · {{ shortId(a.entityId) }}</td><td>{{ shortId(a.actorUserId) }}</td>
          </tr></tbody>
        </table>
        <div class="wa-pager" *ngIf="meta.total > meta.perPage">
          <button type="button" *ngFor="let p of pages()" class="wa-btn wa-btn--sm" [disabled]="p === meta.page" (click)="goto(p)">{{ p }}</button>
        </div>
      </section>
    </div>
  `,
})
export class AdminAuditComponent implements OnInit {
  private readonly api = inject(AdminApiService);
  action = '';
  entityType = '';
  entityId = '';
  actorUserId = '';
  logs: any[] = [];
  meta = { page: 1, perPage: 20, total: 0 };
  loading = false;
  error: string | null = null;

  ngOnInit(): void { this.search(); }

  search(): void {
    this.loading = true;
    this.error = null;
    this.api.listAuditLogs({
      action: this.action || undefined, entityType: this.entityType || undefined,
      entityId: this.entityId || undefined, actorUserId: this.actorUserId || undefined,
      page: this.meta.page, perPage: 20,
    }).subscribe({
      next: (res) => { this.logs = res.data; this.meta = res.meta; this.loading = false; },
      error: (err) => { this.error = adminErrorMessage(err); this.loading = false; },
    });
  }

  goto(p: number): void { this.meta.page = p; this.search(); }
  pages(): number[] { return pageList(this.meta.total, this.meta.perPage); }
  date(v: unknown): string { return shortDate(v); }
  shortId(v: unknown): string {
    const s = String(v ?? '—');
    return s.length > 12 ? `${s.slice(0, 8)}…` : s;
  }
}

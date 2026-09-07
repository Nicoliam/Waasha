import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminApiService } from '../../core/services/admin.service';
import { AdminNavComponent } from './admin-nav.component';
import { adminErrorMessage, pageList, shortDate } from './admin.utils';

/**
 * Slice 16 — notification & media oversight (web).
 * Reuses the Slice 7 notification architecture and Slice 11 media
 * abstraction. List views show previews/metadata only; moderation
 * actions are audited and never destroy historical references.
 */
@Component({
  selector: 'waasha-admin-ops',
  standalone: true,
  imports: [CommonModule, FormsModule, AdminNavComponent],
  template: `
    <div class="wa-admin">
      <header><h1 class="wa-title">Admin · Notifications &amp; media</h1>
      <p class="wa-sub">Delivery oversight and media moderation. No second notification system, no separate media pipeline.</p></header>
      <waasha-admin-nav />
      <section class="wa-card" aria-label="Notifications">
        <h2 class="wa-card__title">Notifications</h2>
        <form (ngSubmit)="loadNotifications()" class="wa-form wa-form--row">
          <label class="wa-field"><span>Status</span><select [(ngModel)]="notifStatus" name="ns">
            <option value="">Any</option><option value="UNREAD">UNREAD</option><option value="READ">READ</option></select></label>
          <label class="wa-field"><span>Type</span><input [(ngModel)]="notifType" name="nt" maxlength="64" placeholder="BOOKING_CREATED" /></label>
          <button type="submit" class="wa-btn wa-btn--sm" [disabled]="notifLoading">Search</button>
        </form>
        <p class="wa-muted" *ngIf="byType.length > 0">Volume by type: {{ typeSummary() }}</p>
        <ul class="wa-list"><li *ngFor="let n of notifications">
          <strong>{{ n.type }}</strong> · {{ n.channel }} · {{ n.status }} · {{ date(n.createdAt) }}<br />
          <span class="wa-muted">{{ n.title }} — {{ n.messagePreview }}</span></li></ul>
      </section>
      <section class="wa-card" aria-label="Media moderation">
        <h2 class="wa-card__title">Media moderation</h2>
        <form (ngSubmit)="loadMedia()" class="wa-form wa-form--row">
          <label class="wa-field"><span>Moderation</span><select [(ngModel)]="modStatus" name="ms">
            <option value="">Any</option><option *ngFor="let s of modOpts" [value]="s">{{ s }}</option></select></label>
          <button type="submit" class="wa-btn wa-btn--sm" [disabled]="mediaLoading">Search</button>
        </form>
        <table *ngIf="media.length > 0" class="wa-table">
          <thead><tr><th>Purpose</th><th>Owner</th><th>Status</th><th>Moderation</th><th></th></tr></thead>
          <tbody><tr *ngFor="let m of media">
            <td>{{ m.purpose }}</td><td>{{ m.ownerType }}</td><td>{{ m.status }}</td><td>{{ m.moderationStatus }}</td>
            <td>
              <button type="button" class="wa-btn wa-btn--sm" (click)="moderate(m.id, 'APPROVE')">Approve</button>
              <button type="button" class="wa-btn wa-btn--sm" (click)="moderate(m.id, 'REJECT')">Reject</button>
              <button type="button" class="wa-btn wa-btn--sm" (click)="moderate(m.id, 'HIDE')">Hide</button>
            </td>
          </tr></tbody>
        </table>
        <p *ngIf="opsError" class="wa-field__error" role="alert">{{ opsError }}</p>
      </section>
    </div>
  `,
})
export class AdminOpsComponent implements OnInit {
  private readonly api = inject(AdminApiService);
  notifications: any[] = [];
  byType: any[] = [];
  notifStatus = '';
  notifType = '';
  notifLoading = false;
  media: any[] = [];
  modStatus = 'PENDING';
  modOpts = ['PENDING', 'APPROVED', 'REJECTED', 'NEEDS_REVIEW', 'HIDDEN'];
  mediaLoading = false;
  opsError: string | null = null;

  ngOnInit(): void {
    this.loadNotifications();
    this.loadMedia();
  }

  date(v: unknown): string { return shortDate(v); }
  typeSummary(): string { return this.byType.map((t) => `${t.type}: ${t.count}`).join(' · '); }

  loadNotifications(): void {
    this.notifLoading = true;
    this.api.listNotifications({ status: this.notifStatus || undefined, type: this.notifType || undefined, perPage: 20 }).subscribe({
      next: (res) => {
        this.notifications = res.data;
        this.byType = (res.meta as any)?.byType ?? [];
        this.notifLoading = false;
      },
      error: (err) => { this.opsError = adminErrorMessage(err); this.notifLoading = false; },
    });
  }

  loadMedia(): void {
    this.mediaLoading = true;
    this.api.listMedia({ moderationStatus: this.modStatus || undefined, perPage: 20 }).subscribe({
      next: (res) => { this.media = res.data; this.mediaLoading = false; },
      error: (err) => { this.opsError = adminErrorMessage(err); this.mediaLoading = false; },
    });
  }

  moderate(id: string, action: 'APPROVE' | 'REJECT' | 'HIDE'): void {
    if (!window.confirm(`Confirm media moderation ${action}? This is audited; the asset is never deleted.`)) return;
    this.opsError = null;
    this.api.moderateMedia(id, action).subscribe({
      next: () => this.loadMedia(),
      error: (err) => { this.opsError = adminErrorMessage(err); },
    });
  }
}

import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AdminApiService } from '../../core/services/admin.service';
import { AdminNavComponent } from './admin-nav.component';
import { adminErrorMessage, money, pageList, shortDate } from './admin.utils';

/**
 * Slice 16 — booking oversight (web).
 * Search and inspect bookings with filters. Read-only: no state
 * transitions exist in the admin API, and precise customer locations
 * are never returned (area level only).
 */
@Component({
  selector: 'waasha-admin-bookings',
  standalone: true,
  imports: [CommonModule, FormsModule, AdminNavComponent],
  template: `
    <div class="wa-admin">
      <header><h1 class="wa-title">Admin · Bookings</h1>
      <p class="wa-sub">Read-only oversight. Booking state changes stay on the provider/customer lifecycle.</p></header>
      <waasha-admin-nav />
      <section class="wa-card" aria-label="Search bookings">
        <form (ngSubmit)="search()" class="wa-form wa-form--row">
          <label class="wa-field"><span>Status</span><select [(ngModel)]="status" name="status">
            <option value="">Any</option><option *ngFor="let s of statuses" [value]="s">{{ s }}</option></select></label>
          <label class="wa-field"><span>Payment</span><select [(ngModel)]="paymentStatus" name="ps">
            <option value="">Any</option><option *ngFor="let s of payStatuses" [value]="s">{{ s }}</option></select></label>
          <label class="wa-field"><span>From</span><input type="date" [(ngModel)]="from" name="from" /></label>
          <label class="wa-field"><span>To</span><input type="date" [(ngModel)]="to" name="to" /></label>
          <button type="submit" class="wa-btn wa-btn--sm" [disabled]="loading">Search</button>
        </form>
      </section>
      <section *ngIf="loading" class="wa-card" role="status">Loading bookings…</section>
      <div *ngIf="error && !loading" class="wa-card wa-error" role="alert"><p>{{ error }}</p>
        <button type="button" class="wa-btn wa-btn--sm" (click)="search()">Retry</button></div>
      <section *ngIf="!loading && !error" class="wa-card" aria-label="Booking results">
        <p class="wa-muted" *ngIf="bookings.length === 0">No bookings match.</p>
        <table *ngIf="bookings.length > 0" class="wa-table">
          <thead><tr><th>Scheduled</th><th>Status</th><th>Payment</th><th>Total</th><th></th></tr></thead>
          <tbody><tr *ngFor="let b of bookings">
            <td>{{ date(b.scheduledStart) }}</td><td>{{ b.status }}</td><td>{{ b.paymentStatus }}</td>
            <td>{{ money(b.totalAmount) }}</td>
            <td><button type="button" class="wa-btn wa-btn--sm" (click)="select(b.id)">Inspect</button></td>
          </tr></tbody>
        </table>
        <div class="wa-pager" *ngIf="meta.total > meta.perPage">
          <button type="button" *ngFor="let p of pages()" class="wa-btn wa-btn--sm" [disabled]="p === meta.page" (click)="goto(p)">{{ p }}</button>
        </div>
      </section>
      <section *ngIf="detail" class="wa-card" aria-label="Booking detail">
        <h2 class="wa-card__title">Booking · {{ detail.status }}</h2>
        <dl class="wa-meta">
          <div><dt>Scheduled</dt><dd>{{ date(detail.scheduledStart) }} → {{ date(detail.scheduledEnd) }}</dd></div>
          <div><dt>Total</dt><dd>{{ money(detail.totalAmount) }} {{ detail.currency }}</dd></div>
          <div><dt>Payment</dt><dd>{{ detail.paymentStatus }} ({{ detail.paymentMethod || '—' }})</dd></div>
          <div><dt>Area</dt><dd>{{ detail.location?.city || '—' }}, {{ detail.location?.province || '—' }}</dd></div>
          <div><dt>Items</dt><dd>{{ (detail.items || []).length }}</dd></div>
        </dl>
        <p class="wa-muted">Payment and service completion are separate states; neither is changed here.</p>
      </section>
    </div>
  `,
})
export class AdminBookingsComponent implements OnInit {
  private readonly api = inject(AdminApiService);
  status = '';
  paymentStatus = '';
  from = '';
  to = '';
  statuses = ['DRAFT', 'PENDING', 'ACCEPTED', 'CONFIRMED', 'PAYMENT_PENDING', 'PAID', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'DECLINED', 'REFUNDED', 'DISPUTED'];
  payStatuses = ['PENDING', 'PROCESSING', 'PAID', 'FAILED', 'CANCELLED', 'REFUNDED'];
  bookings: any[] = [];
  meta = { page: 1, perPage: 20, total: 0 };
  detail: any = null;
  loading = false;
  error: string | null = null;

  ngOnInit(): void { this.search(); }

  search(): void {
    this.loading = true;
    this.error = null;
    this.api.searchBookings({
      status: this.status || undefined, paymentStatus: this.paymentStatus || undefined,
      from: this.from || undefined, to: this.to || undefined, page: this.meta.page, perPage: 20,
    }).subscribe({
      next: (res) => { this.bookings = res.data; this.meta = res.meta; this.loading = false; },
      error: (err) => { this.error = adminErrorMessage(err); this.loading = false; },
    });
  }

  goto(p: number): void { this.meta.page = p; this.search(); }
  pages(): number[] { return pageList(this.meta.total, this.meta.perPage); }
  date(v: unknown): string { return shortDate(v); }
  money(v: unknown): string { return money(v); }

  select(id: string): void {
    this.api.getBooking(id).subscribe({
      next: (res) => { this.detail = res.data; },
      error: (err) => { this.error = adminErrorMessage(err); },
    });
  }
}

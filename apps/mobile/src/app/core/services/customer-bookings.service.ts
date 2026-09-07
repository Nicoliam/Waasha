import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';
import { CustomerInboxFilter } from '../../features/bookings/customer-bookings.utils';

export interface CustomerBookingsResponse {
  success: boolean;
  data: any[];
  meta: { page: number; perPage: number; total: number };
  /** All reads are server-authoritative; no offline write path exists. */
  source: 'server';
}

/**
 * Slice 6 — Customer booking API client (read-only).
 * Slice 12 — Customer booking actions (cancel / reschedule).
 *
 * Customer identity always comes from the authenticated session; no
 * customerId/userId is ever sent. Only the whitelisted action payloads
 * (optional reason, new scheduledStart) are sent — never price, status,
 * provider, payment or location fields. All mutations are
 * server-authoritative (`source: 'server'`); the UI must never claim a
 * transition succeeded without a server reply.
 * Uses constructor injection so the service is unit-testable without TestBed.
 */
@Injectable({ providedIn: 'root' })
export class CustomerBookingsService {
  constructor(private readonly http: HttpClient) {}

  listBookings(filter: CustomerInboxFilter = 'upcoming', page = 1, perPage = 20): Observable<CustomerBookingsResponse> {
    let params = new HttpParams().set('page', String(page)).set('perPage', String(perPage));
    if (filter && filter !== 'all') params = params.set('status', filter);
    return this.http
      .get<{ success: boolean; data: any[]; meta: CustomerBookingsResponse['meta'] }>('/api/v1/customers/me/bookings', { params })
      .pipe(map((res) => ({ ...res, source: 'server' as const })));
  }

  getDetail(id: string): Observable<{ success: boolean; data: any; source: 'server' }> {
    return this.http
      .get<{ success: boolean; data: any }>(`/api/v1/customers/me/bookings/${encodeURIComponent(id)}`)
      .pipe(map((res) => ({ ...res, source: 'server' as const })));
  }

  /** POST /api/v1/customers/me/bookings/:id/cancel — optional reason only. */
  cancelBooking(id: string, reason?: string): Observable<{ success: boolean; data: any; source: 'server' }> {
    const body = reason != null && reason.trim() !== '' ? { reason: reason.trim().slice(0, 500) } : {};
    return this.http
      .post<{ success: boolean; data: any }>(`/api/v1/customers/me/bookings/${encodeURIComponent(id)}/cancel`, body)
      .pipe(map((res) => ({ ...res, source: 'server' as const })));
  }

  /** POST /api/v1/customers/me/bookings/:id/reschedule — new scheduledStart only. */
  rescheduleBooking(id: string, scheduledStart: string): Observable<{ success: boolean; data: any; source: 'server' }> {
    return this.http
      .post<{ success: boolean; data: any }>(`/api/v1/customers/me/bookings/${encodeURIComponent(id)}/reschedule`, { scheduledStart })
      .pipe(map((res) => ({ ...res, source: 'server' as const })));
  }

  /**
   * Slice 13 — Submit the customer review for a COMPLETED booking.
   * Only rating + optional comment are sent; ownership is server-derived.
   */
  submitReview(id: string, rating: number, comment?: string): Observable<{ success: boolean; data: any; source: 'server' }> {
    const body: Record<string, unknown> = { rating };
    if (comment != null && comment.trim() !== '') body['comment'] = comment.trim().slice(0, 1000);
    return this.http
      .post<{ success: boolean; data: any }>(`/api/v1/customers/me/bookings/${encodeURIComponent(id)}/review`, body)
      .pipe(map((res) => ({ ...res, source: 'server' as const })));
  }

  /** GET review eligibility / existing review for a booking. */
  getReview(id: string): Observable<{ success: boolean; data: any; source: 'server' }> {
    return this.http
      .get<{ success: boolean; data: any }>(`/api/v1/customers/me/bookings/${encodeURIComponent(id)}/review`)
      .pipe(map((res) => ({ ...res, source: 'server' as const })));
  }
}

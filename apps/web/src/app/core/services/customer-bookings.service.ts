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
 *
 * Customer identity always comes from the authenticated session; no
 * customerId/userId is ever sent. There is intentionally no
 * cancel/complete/transition method: those transitions do not exist
 * server-side yet, and the UI must never manufacture them.
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
}

import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

export type ProviderInboxFilter = 'all' | 'incoming' | 'accepted' | 'rejected' | 'completed';

export interface ProviderInboxResponse {
  success: boolean;
  data: any[];
  meta: { page: number; perPage: number; total: number };
}

/**
 * Slice 5 — Provider booking API client.
 * Provider identity always comes from the authenticated session;
 * no providerId is ever sent as the source of authorization.
 * Uses constructor injection so the service is unit-testable without TestBed.
 */
@Injectable({ providedIn: 'root' })
export class ProviderBookingsService {
  constructor(private readonly http: HttpClient) {}

  listInbox(filter: ProviderInboxFilter = 'all', page = 1, perPage = 20): Observable<ProviderInboxResponse> {
    let params = new HttpParams().set('page', String(page)).set('perPage', String(perPage));
    if (filter && filter !== 'all') params = params.set('status', filter);
    return this.http.get<ProviderInboxResponse>('/api/v1/providers/me/bookings', { params });
  }

  getDetail(id: string): Observable<{ success: boolean; data: any }> {
    return this.http.get<{ success: boolean; data: any }>(`/api/v1/providers/me/bookings/${encodeURIComponent(id)}`);
  }

  accept(id: string): Observable<{ success: boolean; data: any }> {
    return this.http.post<{ success: boolean; data: any }>(`/api/v1/providers/me/bookings/${encodeURIComponent(id)}/accept`, {});
  }

  reject(id: string): Observable<{ success: boolean; data: any }> {
    return this.http.post<{ success: boolean; data: any }>(`/api/v1/providers/me/bookings/${encodeURIComponent(id)}/reject`, {});
  }

  getNavigation(id: string): Observable<{ success: boolean; data: any }> {
    return this.http.get<{ success: boolean; data: any }>(
      `/api/v1/providers/me/bookings/${encodeURIComponent(id)}/navigation`,
    );
  }
}

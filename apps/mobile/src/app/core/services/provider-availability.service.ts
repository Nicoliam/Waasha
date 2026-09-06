import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

/**
 * Slice 8 — Provider availability API client.
 * Provider identity always comes from the authenticated session;
 * no providerId/userId/tenantId is ever sent as ownership.
 * Uses constructor injection so the service is unit-testable without TestBed.
 */
@Injectable({ providedIn: 'root' })
export class ProviderAvailabilityService {
  constructor(private readonly http: HttpClient) {}

  getSchedule(businessUnitId?: string | null): Observable<{ success: boolean; data: any }> {
    let params = new HttpParams();
    if (businessUnitId) params = params.set('businessUnitId', businessUnitId);
    return this.http.get<{ success: boolean; data: any }>('/api/v1/providers/me/availability', { params });
  }

  listRules(businessUnitId?: string | null): Observable<{ success: boolean; data: any }> {
    let params = new HttpParams();
    if (businessUnitId) params = params.set('businessUnitId', businessUnitId);
    return this.http.get<{ success: boolean; data: any }>('/api/v1/providers/me/availability/rules', { params });
  }

  createRule(body: { dayOfWeek: number; startTime: string; endTime: string; isActive?: boolean; businessUnitId?: string }): Observable<{ success: boolean; data: any }> {
    return this.http.post<{ success: boolean; data: any }>('/api/v1/providers/me/availability/rules', body);
  }

  replaceRules(body: { rules: Array<{ dayOfWeek: number; startTime: string; endTime: string; isActive?: boolean }>; businessUnitId?: string }): Observable<{ success: boolean; data: any }> {
    return this.http.put<{ success: boolean; data: any }>('/api/v1/providers/me/availability/rules', body);
  }

  updateRule(id: string, body: { dayOfWeek?: number; startTime?: string; endTime?: string; isActive?: boolean }): Observable<{ success: boolean; data: any }> {
    return this.http.patch<{ success: boolean; data: any }>(`/api/v1/providers/me/availability/rules/${encodeURIComponent(id)}`, body);
  }

  deleteRule(id: string): Observable<{ success: boolean; data: any }> {
    return this.http.delete<{ success: boolean; data: any }>(`/api/v1/providers/me/availability/rules/${encodeURIComponent(id)}`);
  }

  listExceptions(page = 1, perPage = 20): Observable<{ success: boolean; data: any[]; meta: any; timezone: string }> {
    const params = new HttpParams().set('page', String(page)).set('perPage', String(perPage)).set('upcomingOnly', 'true');
    return this.http.get<{ success: boolean; data: any[]; meta: any; timezone: string }>(
      '/api/v1/providers/me/availability/exceptions',
      { params },
    );
  }

  createException(body: { date: string; kind: string; startTime?: string; endTime?: string; reason?: string }): Observable<{ success: boolean; data: any }> {
    return this.http.post<{ success: boolean; data: any }>('/api/v1/providers/me/availability/exceptions', body);
  }

  updateException(id: string, body: { date?: string; kind?: string; startTime?: string | null; endTime?: string | null; reason?: string }): Observable<{ success: boolean; data: any }> {
    return this.http.patch<{ success: boolean; data: any }>(
      `/api/v1/providers/me/availability/exceptions/${encodeURIComponent(id)}`,
      body,
    );
  }

  deleteException(id: string): Observable<{ success: boolean; data: any }> {
    return this.http.delete<{ success: boolean; data: any }>(
      `/api/v1/providers/me/availability/exceptions/${encodeURIComponent(id)}`,
    );
  }

  getConflicts(): Observable<{ success: boolean; data: { conflicts: any[]; timezone: string } }> {
    return this.http.get<{ success: boolean; data: { conflicts: any[]; timezone: string } }>(
      '/api/v1/providers/me/availability/conflicts',
    );
  }

  getTimezone(): Observable<{ success: boolean; data: { timezone: string } }> {
    return this.http.get<{ success: boolean; data: { timezone: string } }>('/api/v1/providers/me/availability/timezone');
  }

  updateTimezone(timezone: string): Observable<{ success: boolean; data: { timezone: string } }> {
    return this.http.put<{ success: boolean; data: { timezone: string } }>('/api/v1/providers/me/availability/timezone', { timezone });
  }
}

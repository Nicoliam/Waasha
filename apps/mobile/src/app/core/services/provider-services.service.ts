import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface ServiceImageRef {
  id?: string;
  imageUrl: string;
  sortOrder?: number;
}

export interface ProviderServicePayload {
  name: string;
  description?: string | null;
  serviceCategoryId: string;
  price: number;
  currency?: string;
  durationMinutes: number;
  serviceMode: string;
  status?: string;
  isActive?: boolean;
  businessUnitId?: string | null;
  images?: ServiceImageRef[];
  expectedUpdatedAt?: string;
}

export interface ProviderServiceResponse {
  success: boolean;
  data: any;
  meta?: { page: number; perPage: number; total: number };
}

/**
 * Slice 9 — Provider service catalogue API client.
 * Provider identity always comes from the authenticated session;
 * no providerId/userId/tenantId is ever sent as ownership.
 * Uses constructor injection so the service is unit-testable without TestBed.
 */
@Injectable({ providedIn: 'root' })
export class ProviderServicesService {
  constructor(private readonly http: HttpClient) {}

  list(params: { status?: string; categoryId?: string; page?: number; perPage?: number } = {}): Observable<ProviderServiceResponse> {
    let httpParams = new HttpParams()
      .set('page', String(params.page ?? 1))
      .set('perPage', String(params.perPage ?? 20));
    if (params.status) httpParams = httpParams.set('status', params.status);
    if (params.categoryId) httpParams = httpParams.set('categoryId', params.categoryId);
    return this.http.get<ProviderServiceResponse>('/api/v1/providers/me/services', { params: httpParams });
  }

  getDetail(id: string): Observable<{ success: boolean; data: any }> {
    return this.http.get<{ success: boolean; data: any }>(`/api/v1/providers/me/services/${encodeURIComponent(id)}`);
  }

  create(body: ProviderServicePayload): Observable<{ success: boolean; data: any }> {
    return this.http.post<{ success: boolean; data: any }>('/api/v1/providers/me/services', body);
  }

  replace(id: string, body: ProviderServicePayload): Observable<{ success: boolean; data: any }> {
    return this.http.put<{ success: boolean; data: any }>(`/api/v1/providers/me/services/${encodeURIComponent(id)}`, body);
  }

  update(id: string, body: Partial<ProviderServicePayload>): Observable<{ success: boolean; data: any }> {
    return this.http.patch<{ success: boolean; data: any }>(`/api/v1/providers/me/services/${encodeURIComponent(id)}`, body);
  }

  /** Activate (true) or deactivate (false). Deactivation never cancels existing bookings. */
  setActive(id: string, active: boolean): Observable<{ success: boolean; data: any }> {
    return this.update(id, { isActive: active });
  }

  remove(id: string): Observable<{ success: boolean; data: any }> {
    return this.http.delete<{ success: boolean; data: any }>(`/api/v1/providers/me/services/${encodeURIComponent(id)}`);
  }
}

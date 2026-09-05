import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ProviderProfileDto, ServiceDto } from '../models/discovery-radius.model';

interface ProviderProfileApiResponse {
  success: boolean;
  data: ProviderProfileDto;
}

interface ProviderServicesApiResponse {
  success: boolean;
  data: ServiceDto[];
  meta: { page: number; perPage: number; total: number };
}

interface ServiceDetailApiResponse {
  success: boolean;
  data: ServiceDto;
}

@Injectable({ providedIn: 'root' })
export class MarketplaceService {
  private readonly http = inject(HttpClient);

  fetchProviderProfile(providerId: string, customerLoc?: { latitude: number; longitude: number }): Observable<ProviderProfileApiResponse> {
    let params = new HttpParams();
    if (customerLoc) {
      params = params.set('latitude', String(customerLoc.latitude)).set('longitude', String(customerLoc.longitude));
    }
    return this.http.get<ProviderProfileApiResponse>(`/api/v1/marketplace/providers/${encodeURIComponent(providerId)}`, { params });
  }

  fetchProviderServices(
    providerId: string,
    opts?: { categoryId?: string; page?: number; perPage?: number },
  ): Observable<ProviderServicesApiResponse> {
    let params = new HttpParams();
    if (opts?.categoryId) params = params.set('categoryId', opts.categoryId);
    if (opts?.page) params = params.set('page', String(opts.page));
    if (opts?.perPage) params = params.set('perPage', String(opts.perPage));
    return this.http.get<ProviderServicesApiResponse>(`/api/v1/marketplace/providers/${encodeURIComponent(providerId)}/services`, { params });
  }

  fetchServiceDetail(providerId: string, serviceId: string): Observable<ServiceDetailApiResponse> {
    return this.http.get<ServiceDetailApiResponse>(
      `/api/v1/marketplace/providers/${encodeURIComponent(providerId)}/services/${encodeURIComponent(serviceId)}`,
    );
  }
}

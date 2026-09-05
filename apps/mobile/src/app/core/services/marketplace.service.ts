import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface ServiceImageDto {
  id: string;
  imageUrl: string;
  sortOrder: number;
}

export interface ServiceDto {
  id: string;
  uuid: string;
  name: string;
  description?: string | null;
  price: number;
  currency: string;
  durationMinutes: number;
  serviceMode: string;
  status: string;
  category?: { id: string; code: string; name: string } | null;
  images: ServiceImageDto[];
}

export interface ProviderProfileDto {
  id: string;
  displayName: string;
  bio?: string | null;
  profileImageUrl?: string | null;
  experienceSummary?: string | null;
  tier?: { code: string; name: string } | null;
  tierCode?: string | null;
  verificationStatus: string;
  status: string;
  coverageRadiusKm: number;
  customRequestsEnabled: boolean;
  location?: {
    city?: string | null;
    province?: string | null;
    latitude: number;
    longitude: number;
    isPrimary: boolean;
  } | null;
  distanceKm?: number | null;
  rating?: number | null;
  reviewCount: number;
  reviewsSample: Array<{ rating: number; comment: string | null; createdAt: string }>;
  isAvailable: boolean;
  services: ServiceDto[];
}

interface ProviderProfileApiResponse {
  success: boolean;
  data: ProviderProfileDto;
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
  ): Observable<{ success: boolean; data: ServiceDto[]; meta: { page: number; perPage: number; total: number } }> {
    let params = new HttpParams();
    if (opts?.categoryId) params = params.set('categoryId', opts.categoryId);
    if (opts?.page) params = params.set('page', String(opts.page));
    if (opts?.perPage) params = params.set('perPage', String(opts.perPage));
    return this.http.get<{ success: boolean; data: ServiceDto[]; meta: { page: number; perPage: number; total: number } }>(
      `/api/v1/marketplace/providers/${encodeURIComponent(providerId)}/services`,
      { params },
    );
  }

  fetchServiceDetail(providerId: string, serviceId: string): Observable<{ success: boolean; data: ServiceDto }> {
    return this.http.get<{ success: boolean; data: ServiceDto }>(
      `/api/v1/marketplace/providers/${encodeURIComponent(providerId)}/services/${encodeURIComponent(serviceId)}`,
    );
  }
}

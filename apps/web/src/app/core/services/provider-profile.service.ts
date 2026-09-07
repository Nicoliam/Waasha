import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface ProviderProfile {
  id: string;
  userId: string;
  displayName: string | null;
  bio: string | null;
  profileImageUrl: string | null;
  experienceSummary: string | null;
  customRequestsEnabled: boolean;
  providerType: string | null;
  verificationStatus: string | null;
  isStudent: boolean;
  studentVerificationStatus: string | null;
  status: string | null;
  coverageRadiusKm: number | null;
  acceptCash?: boolean;
  timezone: string | null;
  tier: { id: string; code: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProviderProfilePatch {
  displayName?: string;
  bio?: string | null;
  experienceSummary?: string | null;
  customRequestsEnabled?: boolean;
  profileImageUrl?: string | null;
}

/**
 * Slice 10 — Provider profile API client.
 * Identity always comes from the authenticated session; no
 * providerId/userId is ever sent as ownership. Uses constructor
 * injection so the service is unit-testable without TestBed.
 */
@Injectable({ providedIn: 'root' })
export class ProviderProfileService {
  constructor(private readonly http: HttpClient) {}

  getMe(): Observable<{ success: boolean; data: ProviderProfile }> {
    return this.http.get<{ success: boolean; data: ProviderProfile }>('/api/v1/providers/me');
  }

  updateMe(patch: ProviderProfilePatch): Observable<{ success: boolean; data: ProviderProfile }> {
    return this.http.patch<{ success: boolean; data: ProviderProfile }>('/api/v1/providers/me', patch);
  }
}

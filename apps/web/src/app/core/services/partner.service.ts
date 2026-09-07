import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';

/**
 * Slice 17 — Training-centre ecosystem API client (web).
 * Partner identity always comes from the authenticated session; no
 * partnerId is ever sent as authority. Mutations require connectivity:
 * they are blocked offline with an explicit "nothing was changed" error
 * and never queued or faked (full sync belongs to Slice 18).
 * Uses constructor injection so the service is unit-testable without TestBed.
 */

export function isPartnerOnline(): boolean {
  if (typeof navigator === 'undefined' || !('onLine' in navigator)) return true;
  return navigator.onLine !== false;
}

function toParams(query: Record<string, string | number | undefined>): HttpParams {
  let params = new HttpParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && String(v) !== '') params = params.set(k, String(v));
  }
  return params;
}

@Injectable({ providedIn: 'root' })
export class PartnerApiService {
  constructor(private readonly http: HttpClient) {}

  private guard(): Observable<never> | null {
    if (!isPartnerOnline()) {
      return throwError(() => new Error('You are offline. Partner changes cannot be saved right now — nothing was changed.'));
    }
    return null;
  }

  // ── Application / profile ──
  apply(input: Record<string, unknown>): Observable<{ success: boolean; data: any }> {
    const blocked = this.guard();
    if (blocked) return blocked as unknown as Observable<{ success: boolean; data: any }>;
    return this.http.post<{ success: boolean; data: any }>('/api/v1/partners/apply', input);
  }

  getMine(): Observable<{ success: boolean; data: any }> {
    return this.http.get<{ success: boolean; data: any }>('/api/v1/partners/me');
  }

  updateProfile(input: Record<string, unknown>): Observable<{ success: boolean; data: any }> {
    const blocked = this.guard();
    if (blocked) return blocked as unknown as Observable<{ success: boolean; data: any }>;
    return this.http.patch<{ success: boolean; data: any }>('/api/v1/partners/me', input);
  }

  // ── Dashboard / providers / earnings ──
  getDashboard(): Observable<{ success: boolean; data: any }> {
    return this.http.get<{ success: boolean; data: any }>('/api/v1/partners/me/dashboard');
  }

  listProviders(query?: { status?: string; page?: number; perPage?: number }): Observable<{ success: boolean; data: any[]; meta: any }> {
    return this.http.get<{ success: boolean; data: any[]; meta: any }>('/api/v1/partners/me/providers', {
      params: toParams((query ?? {}) as Record<string, string | number | undefined>),
    });
  }

  listEarnings(query?: { status?: string; page?: number; perPage?: number }): Observable<{ success: boolean; data: any[]; meta: any }> {
    return this.http.get<{ success: boolean; data: any[]; meta: any }>('/api/v1/partners/me/earnings', {
      params: toParams((query ?? {}) as Record<string, string | number | undefined>),
    });
  }

  // ── Referrals / attribution ──
  createReferral(input: { invitedEmail?: string | null; invitedPhone?: string | null; programme?: string | null }): Observable<{ success: boolean; data: any }> {
    const blocked = this.guard();
    if (blocked) return blocked as unknown as Observable<{ success: boolean; data: any }>;
    return this.http.post<{ success: boolean; data: any }>('/api/v1/partners/me/referrals', input);
  }

  listReferrals(query?: { status?: string; page?: number; perPage?: number }): Observable<{ success: boolean; data: any[]; meta: any }> {
    return this.http.get<{ success: boolean; data: any[]; meta: any }>('/api/v1/partners/me/referrals', {
      params: toParams((query ?? {}) as Record<string, string | number | undefined>),
    });
  }

  revokeReferral(id: string): Observable<{ success: boolean; data: any }> {
    const blocked = this.guard();
    if (blocked) return blocked as unknown as Observable<{ success: boolean; data: any }>;
    return this.http.post<{ success: boolean; data: any }>(`/api/v1/partners/me/referrals/${encodeURIComponent(id)}/revoke`, {});
  }

  redeemReferral(code: string): Observable<{ success: boolean; data: any }> {
    const blocked = this.guard();
    if (blocked) return blocked as unknown as Observable<{ success: boolean; data: any }>;
    return this.http.post<{ success: boolean; data: any }>('/api/v1/partners/referrals/redeem', { code });
  }

  linkAttribution(): Observable<{ success: boolean; data: any }> {
    const blocked = this.guard();
    if (blocked) return blocked as unknown as Observable<{ success: boolean; data: any }>;
    return this.http.post<{ success: boolean; data: any }>('/api/v1/partners/me/attribution/link', {});
  }

  // ── Evidence / verification support ──
  submitEvidence(input: Record<string, unknown>): Observable<{ success: boolean; data: any }> {
    const blocked = this.guard();
    if (blocked) return blocked as unknown as Observable<{ success: boolean; data: any }>;
    return this.http.post<{ success: boolean; data: any }>('/api/v1/partners/me/evidence', input);
  }

  listEvidence(query?: { status?: string; page?: number; perPage?: number }): Observable<{ success: boolean; data: any[]; meta: any }> {
    return this.http.get<{ success: boolean; data: any[]; meta: any }>('/api/v1/partners/me/evidence', {
      params: toParams((query ?? {}) as Record<string, string | number | undefined>),
    });
  }

  supportVerification(providerId: string): Observable<{ success: boolean; data: any }> {
    const blocked = this.guard();
    if (blocked) return blocked as unknown as Observable<{ success: boolean; data: any }>;
    return this.http.post<{ success: boolean; data: any }>(`/api/v1/partners/me/providers/${encodeURIComponent(providerId)}/support-verification`, {});
  }

  // ── Admin oversight (adminGuard is a UX gate only; server re-enforces requireAdmin) ──
  adminSearch(query?: { q?: string; status?: string; page?: number; perPage?: number }): Observable<{ success: boolean; data: any[]; meta: any }> {
    return this.http.get<{ success: boolean; data: any[]; meta: any }>('/api/v1/admin/partners', {
      params: toParams((query ?? {}) as Record<string, string | number | undefined>),
    });
  }

  adminGet(id: string): Observable<{ success: boolean; data: any }> {
    return this.http.get<{ success: boolean; data: any }>(`/api/v1/admin/partners/${encodeURIComponent(id)}`);
  }

  adminSetStatus(id: string, status: string): Observable<{ success: boolean; data: any }> {
    const blocked = this.guard();
    if (blocked) return blocked as unknown as Observable<{ success: boolean; data: any }>;
    return this.http.post<{ success: boolean; data: any }>(`/api/v1/admin/partners/${encodeURIComponent(id)}/status`, { status });
  }

  adminSetVerification(id: string, action: string): Observable<{ success: boolean; data: any }> {
    const blocked = this.guard();
    if (blocked) return blocked as unknown as Observable<{ success: boolean; data: any }>;
    return this.http.post<{ success: boolean; data: any }>(`/api/v1/admin/partners/${encodeURIComponent(id)}/verification`, { action });
  }

  adminAttribute(id: string, providerId: string): Observable<{ success: boolean; data: any }> {
    const blocked = this.guard();
    if (blocked) return blocked as unknown as Observable<{ success: boolean; data: any }>;
    return this.http.post<{ success: boolean; data: any }>(`/api/v1/admin/partners/${encodeURIComponent(id)}/attributions`, { providerId });
  }

  adminEndAttribution(attributionId: string, input: { reason?: string | null; reassignToPartnerId?: string | null }): Observable<{ success: boolean; data: any }> {
    const blocked = this.guard();
    if (blocked) return blocked as unknown as Observable<{ success: boolean; data: any }>;
    return this.http.post<{ success: boolean; data: any }>(`/api/v1/admin/partners/attributions/${encodeURIComponent(attributionId)}/end`, input);
  }

  adminReviewEvidence(evidenceId: string, action: string, note?: string | null): Observable<{ success: boolean; data: any }> {
    const blocked = this.guard();
    if (blocked) return blocked as unknown as Observable<{ success: boolean; data: any }>;
    return this.http.post<{ success: boolean; data: any }>(`/api/v1/admin/partners/evidence/${encodeURIComponent(evidenceId)}/review`, { action, note: note ?? null });
  }

  adminCreateRule(input: Record<string, unknown>): Observable<{ success: boolean; data: any }> {
    const blocked = this.guard();
    if (blocked) return blocked as unknown as Observable<{ success: boolean; data: any }>;
    return this.http.post<{ success: boolean; data: any }>('/api/v1/admin/partners/share-rules', input);
  }

  adminUpdateRule(ruleId: string, input: Record<string, unknown>): Observable<{ success: boolean; data: any }> {
    const blocked = this.guard();
    if (blocked) return blocked as unknown as Observable<{ success: boolean; data: any }>;
    return this.http.patch<{ success: boolean; data: any }>(`/api/v1/admin/partners/share-rules/${encodeURIComponent(ruleId)}`, input);
  }

  adminListRules(query?: { scope?: string; partnerId?: string }): Observable<{ success: boolean; data: any[]; meta: any }> {
    return this.http.get<{ success: boolean; data: any[]; meta: any }>('/api/v1/admin/partners/share-rules/list', {
      params: toParams((query ?? {}) as Record<string, string | number | undefined>),
    });
  }

  adminListAccruals(query?: { partnerId?: string; status?: string; page?: number; perPage?: number }): Observable<{ success: boolean; data: any[]; meta: any }> {
    return this.http.get<{ success: boolean; data: any[]; meta: any }>('/api/v1/admin/partners/accruals/list', {
      params: toParams((query ?? {}) as Record<string, string | number | undefined>),
    });
  }

  adminReverseAccrual(accrualId: string, reason?: string | null): Observable<{ success: boolean; data: any }> {
    const blocked = this.guard();
    if (blocked) return blocked as unknown as Observable<{ success: boolean; data: any }>;
    return this.http.post<{ success: boolean; data: any }>(`/api/v1/admin/partners/accruals/${encodeURIComponent(accrualId)}/reverse`, { reason: reason ?? null });
  }
}

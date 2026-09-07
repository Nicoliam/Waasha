import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';

/**
 * Slice 16 — Admin Platform API client (web).
 * All calls target the isolated /api/v1/admin namespace; the server
 * enforces requireAdmin (session-derived, DB-verified) regardless of UI.
 * Search/filter values are passed as query params only — never as
 * authority. Mutations require connectivity and are never queued offline.
 * Uses constructor injection so the service is unit-testable without TestBed.
 */

export function requireOnlineNow(): void {
  if (typeof navigator !== 'undefined' && 'onLine' in navigator && navigator.onLine === false) {
    throw new Error('OFFLINE');
  }
}

export function isAdminOnline(): boolean {
  if (typeof navigator === 'undefined' || !('onLine' in navigator)) return true;
  return navigator.onLine !== false;
}

export interface PageQuery {
  page?: number;
  perPage?: number;
}

function toParams(query: Record<string, string | number | undefined>): HttpParams {
  let params = new HttpParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && String(v) !== '') params = params.set(k, String(v));
  }
  return params;
}

@Injectable({ providedIn: 'root' })
export class AdminApiService {
  constructor(private readonly http: HttpClient) {}

  private guard(): Observable<never> | null {
    if (!isAdminOnline()) {
      return throwError(() => new Error('You are offline. Admin changes cannot be saved right now — nothing was changed.'));
    }
    return null;
  }

  // ── Dashboard ──
  getDashboard(): Observable<{ success: boolean; data: any }> {
    return this.http.get<{ success: boolean; data: any }>('/api/v1/admin/dashboard');
  }

  // ── Users ──
  searchUsers(query: PageQuery & { q?: string; status?: string }): Observable<{ success: boolean; data: any[]; meta: any }> {
    return this.http.get<{ success: boolean; data: any[]; meta: any }>('/api/v1/admin/users', {
      params: toParams(query as Record<string, string | number | undefined>),
    });
  }

  getUser(id: string): Observable<{ success: boolean; data: any }> {
    return this.http.get<{ success: boolean; data: any }>(`/api/v1/admin/users/${encodeURIComponent(id)}`);
  }

  setUserStatus(id: string, status: 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED'): Observable<{ success: boolean; data: any }> {
    const blocked = this.guard();
    if (blocked) return blocked as unknown as Observable<{ success: boolean; data: any }>;
    return this.http.patch<{ success: boolean; data: any }>(`/api/v1/admin/users/${encodeURIComponent(id)}/status`, { status });
  }

  // ── Providers ──
  searchProviders(
    query: PageQuery & { q?: string; tier?: string; verificationStatus?: string; student?: string; status?: string },
  ): Observable<{ success: boolean; data: any[]; meta: any }> {
    return this.http.get<{ success: boolean; data: any[]; meta: any }>('/api/v1/admin/providers', {
      params: toParams(query as Record<string, string | number | undefined>),
    });
  }

  getProvider(id: string): Observable<{ success: boolean; data: any }> {
    return this.http.get<{ success: boolean; data: any }>(`/api/v1/admin/providers/${encodeURIComponent(id)}`);
  }

  setProviderStatus(id: string, status: 'ACTIVE' | 'PAUSED' | 'SUSPENDED'): Observable<{ success: boolean; data: any }> {
    const blocked = this.guard();
    if (blocked) return blocked as unknown as Observable<{ success: boolean; data: any }>;
    return this.http.patch<{ success: boolean; data: any }>(`/api/v1/admin/providers/${encodeURIComponent(id)}/status`, { status });
  }

  verifyProvider(
    id: string,
    action: 'APPROVE' | 'REJECT' | 'REVOKE',
    notes?: string | null,
  ): Observable<{ success: boolean; data: any }> {
    const blocked = this.guard();
    if (blocked) return blocked as unknown as Observable<{ success: boolean; data: any }>;
    return this.http.post<{ success: boolean; data: any }>(`/api/v1/admin/providers/${encodeURIComponent(id)}/verification`, {
      action,
      notes: notes ?? null,
    });
  }

  verifyStudent(
    id: string,
    action: 'APPROVE' | 'REJECT' | 'REVOKE',
    notes?: string | null,
  ): Observable<{ success: boolean; data: any }> {
    const blocked = this.guard();
    if (blocked) return blocked as unknown as Observable<{ success: boolean; data: any }>;
    return this.http.post<{ success: boolean; data: any }>(
      `/api/v1/admin/providers/${encodeURIComponent(id)}/student-verification`,
      { action, notes: notes ?? null },
    );
  }

  // ── Business oversight (read-only + invitation revocation) ──
  listTeams(query: PageQuery & { status?: string }): Observable<{ success: boolean; data: any[]; meta: any }> {
    return this.http.get<{ success: boolean; data: any[]; meta: any }>('/api/v1/admin/teams', {
      params: toParams(query as Record<string, string | number | undefined>),
    });
  }

  listBusinesses(query: PageQuery & { status?: string }): Observable<{ success: boolean; data: any[]; meta: any }> {
    return this.http.get<{ success: boolean; data: any[]; meta: any }>('/api/v1/admin/businesses', {
      params: toParams(query as Record<string, string | number | undefined>),
    });
  }

  getBusiness(id: string): Observable<{ success: boolean; data: any }> {
    return this.http.get<{ success: boolean; data: any }>(`/api/v1/admin/businesses/${encodeURIComponent(id)}`);
  }

  getBusinessUnit(id: string): Observable<{ success: boolean; data: any }> {
    return this.http.get<{ success: boolean; data: any }>(`/api/v1/admin/business-units/${encodeURIComponent(id)}`);
  }

  listInvitations(
    query: PageQuery & { scope?: 'team' | 'business' | 'all'; status?: string },
  ): Observable<{ success: boolean; data: any; meta: any }> {
    return this.http.get<{ success: boolean; data: any; meta: any }>('/api/v1/admin/invitations', {
      params: toParams(query as Record<string, string | number | undefined>),
    });
  }

  revokeInvitation(scope: 'team' | 'business', id: string): Observable<{ success: boolean; data: any }> {
    const blocked = this.guard();
    if (blocked) return blocked as unknown as Observable<{ success: boolean; data: any }>;
    return this.http.post<{ success: boolean; data: any }>(
      `/api/v1/admin/invitations/${scope}/${encodeURIComponent(id)}/revoke`,
      {},
    );
  }

  // ── Booking oversight (read-only) ──
  searchBookings(
    query: PageQuery & {
      status?: string;
      providerId?: string;
      businessUnitId?: string;
      paymentStatus?: string;
      from?: string;
      to?: string;
    },
  ): Observable<{ success: boolean; data: any[]; meta: any }> {
    return this.http.get<{ success: boolean; data: any[]; meta: any }>('/api/v1/admin/bookings', {
      params: toParams(query as Record<string, string | number | undefined>),
    });
  }

  getBooking(id: string): Observable<{ success: boolean; data: any }> {
    return this.http.get<{ success: boolean; data: any }>(`/api/v1/admin/bookings/${encodeURIComponent(id)}`);
  }

  // ── Payments / finance oversight (read-only) ──
  listPayments(
    query: PageQuery & { status?: string; method?: string; providerId?: string },
  ): Observable<{ success: boolean; data: any[]; meta: any }> {
    return this.http.get<{ success: boolean; data: any[]; meta: any }>('/api/v1/admin/payments', {
      params: toParams(query as Record<string, string | number | undefined>),
    });
  }

  getPayment(id: string): Observable<{ success: boolean; data: any }> {
    return this.http.get<{ success: boolean; data: any }>(`/api/v1/admin/payments/${encodeURIComponent(id)}`);
  }

  getFinanceOverview(): Observable<{ success: boolean; data: any }> {
    return this.http.get<{ success: boolean; data: any }>('/api/v1/admin/finance/overview');
  }

  // ── Settings ──
  getSettings(): Observable<{ success: boolean; data: any[] }> {
    return this.http.get<{ success: boolean; data: any[] }>('/api/v1/admin/settings');
  }

  updateSetting(key: string, value: string | number | number[], expectedUpdatedAt?: string | null): Observable<{ success: boolean; data: any }> {
    const blocked = this.guard();
    if (blocked) return blocked as unknown as Observable<{ success: boolean; data: any }>;
    return this.http.patch<{ success: boolean; data: any }>(`/api/v1/admin/settings/${encodeURIComponent(key)}`, {
      value,
      expectedUpdatedAt: expectedUpdatedAt ?? null,
    });
  }

  // ── Audit viewer (read-only) ──
  listAuditLogs(
    query: PageQuery & {
      actorUserId?: string;
      action?: string;
      entityType?: string;
      entityId?: string;
      from?: string;
      to?: string;
    },
  ): Observable<{ success: boolean; data: any[]; meta: any }> {
    return this.http.get<{ success: boolean; data: any[]; meta: any }>('/api/v1/admin/audit-logs', {
      params: toParams(query as Record<string, string | number | undefined>),
    });
  }

  // ── Notification / media oversight ──
  listNotifications(
    query: PageQuery & { status?: string; type?: string },
  ): Observable<{ success: boolean; data: any[]; meta: any }> {
    return this.http.get<{ success: boolean; data: any[]; meta: any }>('/api/v1/admin/notifications', {
      params: toParams(query as Record<string, string | number | undefined>),
    });
  }

  getNotification(id: string): Observable<{ success: boolean; data: any }> {
    return this.http.get<{ success: boolean; data: any }>(`/api/v1/admin/notifications/${encodeURIComponent(id)}`);
  }

  listMedia(
    query: PageQuery & { moderationStatus?: string; status?: string; purpose?: string },
  ): Observable<{ success: boolean; data: any[]; meta: any }> {
    return this.http.get<{ success: boolean; data: any[]; meta: any }>('/api/v1/admin/media', {
      params: toParams(query as Record<string, string | number | undefined>),
    });
  }

  moderateMedia(id: string, action: 'APPROVE' | 'REJECT' | 'HIDE' | 'NEEDS_REVIEW'): Observable<{ success: boolean; data: any }> {
    const blocked = this.guard();
    if (blocked) return blocked as unknown as Observable<{ success: boolean; data: any }>;
    return this.http.patch<{ success: boolean; data: any }>(`/api/v1/admin/media/${encodeURIComponent(id)}/moderation`, { action });
  }
}

import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';

/**
 * Slice 15 — T2/T3 business-management API client (web).
 * Provider identity always comes from the authenticated session;
 * no providerId/businessId/teamId is ever sent as the source of
 * authorization — ids only select already-owned scope server-side.
 * Mutations require connectivity: they are blocked offline and never
 * queued or faked (Slice 18 owns sync).
 * Uses constructor injection so the service is unit-testable without TestBed.
 */

export function requireOnlineNow(): void {
  if (typeof navigator !== 'undefined' && 'onLine' in navigator && navigator.onLine === false) {
    throw new Error('OFFLINE');
  }
}

export function isOnline(): boolean {
  if (typeof navigator === 'undefined' || !('onLine' in navigator)) return true;
  return navigator.onLine !== false;
}

@Injectable({ providedIn: 'root' })
export class BusinessApiService {
  constructor(private readonly http: HttpClient) {}

  private guard(): Observable<never> | null {
    if (!isOnline()) {
      return throwError(() => new Error('You are offline. Changes cannot be saved right now — nothing was changed.'));
    }
    return null;
  }

  getCapabilities(): Observable<{ success: boolean; data: any }> {
    return this.http.get<{ success: boolean; data: any }>('/api/v1/providers/me/capabilities');
  }

  // ── T2 team ──
  getTeam(): Observable<{ success: boolean; data: any }> {
    return this.http.get<{ success: boolean; data: any }>('/api/v1/providers/me/team');
  }

  createTeam(input: { name: string; description?: string | null }): Observable<{ success: boolean; data: any }> {
    const blocked = this.guard();
    if (blocked) return blocked as Observable<{ success: boolean; data: any }>;
    return this.http.post<{ success: boolean; data: any }>('/api/v1/providers/me/team', input);
  }

  updateTeam(input: { name?: string; description?: string | null }): Observable<{ success: boolean; data: any }> {
    const blocked = this.guard();
    if (blocked) return blocked as Observable<{ success: boolean; data: any }>;
    return this.http.patch<{ success: boolean; data: any }>('/api/v1/providers/me/team', input);
  }

  listTeamMembers(): Observable<{ success: boolean; data: any[] }> {
    return this.http.get<{ success: boolean; data: any[] }>('/api/v1/providers/me/team/members');
  }

  addTeamMember(input: { providerId: string; role?: string }): Observable<{ success: boolean; data: any }> {
    const blocked = this.guard();
    if (blocked) return blocked as Observable<{ success: boolean; data: any }>;
    return this.http.post<{ success: boolean; data: any }>('/api/v1/providers/me/team/members', input);
  }

  updateTeamMember(id: string, input: { role?: string; status?: string }): Observable<{ success: boolean; data: any }> {
    const blocked = this.guard();
    if (blocked) return blocked as Observable<{ success: boolean; data: any }>;
    return this.http.patch<{ success: boolean; data: any }>(`/api/v1/providers/me/team/members/${encodeURIComponent(id)}`, input);
  }

  removeTeamMember(id: string): Observable<{ success: boolean; data: any }> {
    const blocked = this.guard();
    if (blocked) return blocked as Observable<{ success: boolean; data: any }>;
    return this.http.delete<{ success: boolean; data: any }>(`/api/v1/providers/me/team/members/${encodeURIComponent(id)}`);
  }

  listTeamInvitations(): Observable<{ success: boolean; data: any[] }> {
    return this.http.get<{ success: boolean; data: any[] }>('/api/v1/providers/me/team/invitations');
  }

  createTeamInvitation(input: { invitedProviderId?: string; invitedEmail?: string; role?: string }): Observable<{ success: boolean; data: any }> {
    const blocked = this.guard();
    if (blocked) return blocked as Observable<{ success: boolean; data: any }>;
    return this.http.post<{ success: boolean; data: any }>('/api/v1/providers/me/team/invitations', input);
  }

  revokeTeamInvitation(id: string): Observable<{ success: boolean; data: any }> {
    const blocked = this.guard();
    if (blocked) return blocked as Observable<{ success: boolean; data: any }>;
    return this.http.post<{ success: boolean; data: any }>(
      `/api/v1/providers/me/team/invitations/${encodeURIComponent(id)}/revoke`,
      {},
    );
  }

  acceptTeamInvitation(token: string): Observable<{ success: boolean; data: any }> {
    const blocked = this.guard();
    if (blocked) return blocked as Observable<{ success: boolean; data: any }>;
    return this.http.post<{ success: boolean; data: any }>('/api/v1/providers/me/team/invitations/accept', { token });
  }

  // ── T3 business ──
  listBusinesses(): Observable<{ success: boolean; data: any[] }> {
    return this.http.get<{ success: boolean; data: any[] }>('/api/v1/providers/me/business');
  }

  createBusiness(input: { displayName: string; legalName?: string | null; description?: string | null }): Observable<{ success: boolean; data: any }> {
    const blocked = this.guard();
    if (blocked) return blocked as Observable<{ success: boolean; data: any }>;
    return this.http.post<{ success: boolean; data: any }>('/api/v1/providers/me/business', input);
  }

  getBusiness(id: string): Observable<{ success: boolean; data: any }> {
    return this.http.get<{ success: boolean; data: any }>(`/api/v1/providers/me/business/${encodeURIComponent(id)}`);
  }

  updateBusiness(id: string, input: { displayName?: string; legalName?: string | null; description?: string | null; status?: string }): Observable<{ success: boolean; data: any }> {
    const blocked = this.guard();
    if (blocked) return blocked as Observable<{ success: boolean; data: any }>;
    return this.http.patch<{ success: boolean; data: any }>(`/api/v1/providers/me/business/${encodeURIComponent(id)}`, input);
  }

  listUnits(businessId: string): Observable<{ success: boolean; data: any[] }> {
    return this.http.get<{ success: boolean; data: any[] }>(`/api/v1/providers/me/business/${encodeURIComponent(businessId)}/units`);
  }

  createUnit(businessId: string, input: { name: string; description?: string | null; coverageRadiusKm?: number; location?: any; categoryIds?: string[] }): Observable<{ success: boolean; data: any }> {
    const blocked = this.guard();
    if (blocked) return blocked as Observable<{ success: boolean; data: any }>;
    return this.http.post<{ success: boolean; data: any }>(`/api/v1/providers/me/business/${encodeURIComponent(businessId)}/units`, input);
  }

  getUnit(unitId: string): Observable<{ success: boolean; data: any }> {
    return this.http.get<{ success: boolean; data: any }>(`/api/v1/providers/me/business/units/${encodeURIComponent(unitId)}`);
  }

  updateUnit(unitId: string, input: { name?: string; description?: string | null; coverageRadiusKm?: number; status?: string }): Observable<{ success: boolean; data: any }> {
    const blocked = this.guard();
    if (blocked) return blocked as Observable<{ success: boolean; data: any }>;
    return this.http.patch<{ success: boolean; data: any }>(`/api/v1/providers/me/business/units/${encodeURIComponent(unitId)}`, input);
  }

  activateUnit(unitId: string): Observable<{ success: boolean; data: any }> {
    const blocked = this.guard();
    if (blocked) return blocked as Observable<{ success: boolean; data: any }>;
    return this.http.post<{ success: boolean; data: any }>(`/api/v1/providers/me/business/units/${encodeURIComponent(unitId)}/activate`, {});
  }

  deactivateUnit(unitId: string): Observable<{ success: boolean; data: any }> {
    const blocked = this.guard();
    if (blocked) return blocked as Observable<{ success: boolean; data: any }>;
    return this.http.post<{ success: boolean; data: any }>(`/api/v1/providers/me/business/units/${encodeURIComponent(unitId)}/deactivate`, {});
  }

  setUnitLocation(unitId: string, location: any): Observable<{ success: boolean; data: any }> {
    const blocked = this.guard();
    if (blocked) return blocked as Observable<{ success: boolean; data: any }>;
    return this.http.post<{ success: boolean; data: any }>(`/api/v1/providers/me/business/units/${encodeURIComponent(unitId)}/location`, { location });
  }

  setUnitCategories(unitId: string, categoryIds: string[]): Observable<{ success: boolean; data: any }> {
    const blocked = this.guard();
    if (blocked) return blocked as Observable<{ success: boolean; data: any }>;
    return this.http.put<{ success: boolean; data: any }>(`/api/v1/providers/me/business/units/${encodeURIComponent(unitId)}/categories`, { categoryIds });
  }

  attachService(unitId: string, serviceId: string): Observable<{ success: boolean; data: any }> {
    const blocked = this.guard();
    if (blocked) return blocked as Observable<{ success: boolean; data: any }>;
    return this.http.post<{ success: boolean; data: any }>(
      `/api/v1/providers/me/business/units/${encodeURIComponent(unitId)}/services/${encodeURIComponent(serviceId)}/attach`,
      {},
    );
  }

  detachService(unitId: string, serviceId: string): Observable<{ success: boolean; data: any }> {
    const blocked = this.guard();
    if (blocked) return blocked as Observable<{ success: boolean; data: any }>;
    return this.http.delete<{ success: boolean; data: any }>(
      `/api/v1/providers/me/business/units/${encodeURIComponent(unitId)}/services/${encodeURIComponent(serviceId)}`,
    );
  }

  listStaff(businessId: string): Observable<{ success: boolean; data: any[] }> {
    return this.http.get<{ success: boolean; data: any[] }>(`/api/v1/providers/me/business/${encodeURIComponent(businessId)}/staff`);
  }

  addStaff(businessId: string, input: { providerId: string; role?: string; businessUnitId?: string | null }): Observable<{ success: boolean; data: any }> {
    const blocked = this.guard();
    if (blocked) return blocked as Observable<{ success: boolean; data: any }>;
    return this.http.post<{ success: boolean; data: any }>(`/api/v1/providers/me/business/${encodeURIComponent(businessId)}/staff`, input);
  }

  updateStaff(staffId: string, input: { role?: string; status?: string; businessUnitId?: string | null }): Observable<{ success: boolean; data: any }> {
    const blocked = this.guard();
    if (blocked) return blocked as Observable<{ success: boolean; data: any }>;
    return this.http.patch<{ success: boolean; data: any }>(`/api/v1/providers/me/business/staff/${encodeURIComponent(staffId)}`, input);
  }

  removeStaff(staffId: string): Observable<{ success: boolean; data: any }> {
    const blocked = this.guard();
    if (blocked) return blocked as Observable<{ success: boolean; data: any }>;
    return this.http.delete<{ success: boolean; data: any }>(`/api/v1/providers/me/business/staff/${encodeURIComponent(staffId)}`);
  }

  listStaffInvitations(businessId: string): Observable<{ success: boolean; data: any[] }> {
    return this.http.get<{ success: boolean; data: any[] }>(`/api/v1/providers/me/business/${encodeURIComponent(businessId)}/invitations`);
  }

  createStaffInvitation(businessId: string, input: { invitedProviderId?: string; invitedEmail?: string; role?: string; businessUnitId?: string | null }): Observable<{ success: boolean; data: any }> {
    const blocked = this.guard();
    if (blocked) return blocked as Observable<{ success: boolean; data: any }>;
    return this.http.post<{ success: boolean; data: any }>(`/api/v1/providers/me/business/${encodeURIComponent(businessId)}/invitations`, input);
  }

  revokeStaffInvitation(businessId: string, invitationId: string): Observable<{ success: boolean; data: any }> {
    const blocked = this.guard();
    if (blocked) return blocked as Observable<{ success: boolean; data: any }>;
    return this.http.post<{ success: boolean; data: any }>(
      `/api/v1/providers/me/business/${encodeURIComponent(businessId)}/invitations/${encodeURIComponent(invitationId)}/revoke`,
      {},
    );
  }

  acceptStaffInvitation(token: string): Observable<{ success: boolean; data: any }> {
    const blocked = this.guard();
    if (blocked) return blocked as Observable<{ success: boolean; data: any }>;
    return this.http.post<{ success: boolean; data: any }>('/api/v1/providers/me/business/invitations/accept', { token });
  }

  // ── Booking assignment ──
  assignBooking(bookingId: string, assignedProviderId: string): Observable<{ success: boolean; data: any }> {
    const blocked = this.guard();
    if (blocked) return blocked as Observable<{ success: boolean; data: any }>;
    return this.http.post<{ success: boolean; data: any }>(`/api/v1/providers/me/bookings/${encodeURIComponent(bookingId)}/assign`, { assignedProviderId });
  }

  unassignBooking(bookingId: string): Observable<{ success: boolean; data: any }> {
    const blocked = this.guard();
    if (blocked) return blocked as Observable<{ success: boolean; data: any }>;
    return this.http.post<{ success: boolean; data: any }>(`/api/v1/providers/me/bookings/${encodeURIComponent(bookingId)}/unassign`, {});
  }
}

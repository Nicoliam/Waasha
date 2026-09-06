import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, map } from 'rxjs';

export interface NotificationListResponse {
  success: boolean;
  data: any[];
  meta: { page: number; perPage: number; total: number; unreadCount: number };
  /** Reads are server-authoritative; mark-read is applied only on server reply. */
  source: 'server';
}

/**
 * Slice 7 — In-app notification API client.
 * Recipient identity always comes from the authenticated session.
 * Uses constructor injection so the service is unit-testable without TestBed.
 */
@Injectable({ providedIn: 'root' })
export class NotificationService {
  constructor(private readonly http: HttpClient) {}

  list(page = 1, perPage = 20, unreadOnly = false): Observable<NotificationListResponse> {
    let params = new HttpParams().set('page', String(page)).set('perPage', String(perPage));
    if (unreadOnly) params = params.set('unreadOnly', 'true');
    return this.http
      .get<{ success: boolean; data: any[]; meta: NotificationListResponse['meta'] }>('/api/v1/notifications', { params })
      .pipe(map((res) => ({ ...res, source: 'server' as const })));
  }

  unreadCount(): Observable<{ success: boolean; data: { unreadCount: number } }> {
    return this.http.get<{ success: boolean; data: { unreadCount: number } }>('/api/v1/notifications/unread-count');
  }

  markRead(id: string): Observable<{ success: boolean; data: any }> {
    return this.http.patch<{ success: boolean; data: any }>(`/api/v1/notifications/${encodeURIComponent(id)}/read`, {});
  }

  markAllRead(): Observable<{ success: boolean; data: { updated: number } }> {
    return this.http.post<{ success: boolean; data: { updated: number } }>('/api/v1/notifications/read-all', {});
  }

  getPreferences(): Observable<{ success: boolean; data: { preferences: any[] } }> {
    return this.http.get<{ success: boolean; data: { preferences: any[] } }>('/api/v1/notifications/preferences');
  }

  setPreference(channel: string, notificationType: string, isEnabled: boolean): Observable<{ success: boolean; data: any }> {
    return this.http.put<{ success: boolean; data: any }>('/api/v1/notifications/preferences', { channel, notificationType, isEnabled });
  }
}

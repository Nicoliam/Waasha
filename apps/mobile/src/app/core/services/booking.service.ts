import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface AvailabilityResponse {
  success: boolean;
  data: {
    providerId: string;
    serviceId: string;
    date: string;
    timezone: string;
    slots: Array<{ start: string; end: string; displayStart: string; displayEnd: string }>;
  };
}

export interface BookingCreatePayload {
  providerId: string;
  serviceId: string;
  scheduledStart: string;
  serviceLocationType?: 'PROVIDER' | 'CUSTOMER';
  customerLocation: {
    addressLine1?: string | null;
    city?: string | null;
    province?: string | null;
    postalCode?: string | null;
    country?: string | null;
    latitude: number;
    longitude: number;
    locationType?: string | null;
  };
}

@Injectable({ providedIn: 'root' })
export class BookingService {
  private readonly http = inject(HttpClient);

  getAvailability(providerId: string, serviceId: string, date: string): Observable<AvailabilityResponse> {
    const params = new HttpParams().set('providerId', providerId).set('serviceId', serviceId).set('date', date);
    return this.http.get<AvailabilityResponse>('/api/v1/bookings/availability', { params });
  }

  createBooking(payload: BookingCreatePayload): Observable<{ success: boolean; data: any }> {
    return this.http.post<{ success: boolean; data: any }>('/api/v1/bookings', payload);
  }

  getBooking(id: string): Observable<{ success: boolean; data: any }> {
    return this.http.get<{ success: boolean; data: any }>(`/api/v1/bookings/${encodeURIComponent(id)}`);
  }
}

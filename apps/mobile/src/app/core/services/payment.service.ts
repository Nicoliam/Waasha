import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Observable } from 'rxjs';

export type PaymentMethod = 'waasha_payment' | 'cash' | 'eft';

export interface PaymentIntentPayload {
  bookingId: string;
  method: PaymentMethod;
  idempotencyKey?: string | null;
  cashDetails?: { changeRequested?: boolean; amountTendered?: number | null } | null;
}

@Injectable({ providedIn: 'root' })
export class PaymentService {
  private readonly http = inject(HttpClient);

  createIntent(payload: PaymentIntentPayload, idempotencyKey?: string): Observable<{ success: boolean; data: any; meta?: any }> {
    let headers = new HttpHeaders();
    if (idempotencyKey) headers = headers.set('Idempotency-Key', idempotencyKey);
    return this.http.post<{ success: boolean; data: any; meta?: any }>('/api/v1/payments/intents', payload, { headers });
  }

  getByBooking(bookingId: string): Observable<{ success: boolean; data: any }> {
    return this.http.get<{ success: boolean; data: any }>(`/api/v1/payments/by-booking/${encodeURIComponent(bookingId)}`);
  }

  getById(paymentId: string): Observable<{ success: boolean; data: any }> {
    return this.http.get<{ success: boolean; data: any }>(`/api/v1/payments/${encodeURIComponent(paymentId)}`);
  }
}

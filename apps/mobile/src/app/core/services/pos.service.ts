/**
 * Slice 14 — POS API client (web).
 * Provider identity always comes from the authenticated session;
 * no providerId/businessId is ever sent as the source of authorization.
 * businessUnitId only selects an already-owned scope server-side.
 * Uses constructor injection so the service is unit-testable without TestBed.
 */
import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface PosSaleLineInput {
  lineType: 'SERVICE' | 'PRODUCT';
  serviceId?: string;
  inventoryItemId?: string;
  quantity: number;
}

export interface CreateSaleInput {
  paymentMethod: 'cash' | 'eft' | 'waasha_payment';
  paymentStatus?: 'PAID' | 'PENDING';
  businessUnitId?: string | null;
  note?: string | null;
  idempotencyKey?: string | null;
  lines: PosSaleLineInput[];
}

export interface PosSaleResponse {
  success: boolean;
  data: any;
}

@Injectable({ providedIn: 'root' })
export class PosApiService {
  constructor(private readonly http: HttpClient) {}

  listSales(opts: { page?: number; perPage?: number; paymentMethod?: string; paymentStatus?: string; status?: string } = {}): Observable<any> {
    let params = new HttpParams();
    if (opts.page) params = params.set('page', String(opts.page));
    if (opts.perPage) params = params.set('perPage', String(opts.perPage));
    if (opts.paymentMethod) params = params.set('paymentMethod', opts.paymentMethod);
    if (opts.paymentStatus) params = params.set('paymentStatus', opts.paymentStatus);
    if (opts.status) params = params.set('status', opts.status);
    return this.http.get('/api/v1/pos/sales', { params });
  }

  getSale(id: string): Observable<PosSaleResponse> {
    return this.http.get<PosSaleResponse>(`/api/v1/pos/sales/${encodeURIComponent(id)}`);
  }

  createSale(input: CreateSaleInput): Observable<PosSaleResponse> {
    const key = input.idempotencyKey ?? (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`) as string;
    const headers = { 'Idempotency-Key': key };
    return this.http.post<PosSaleResponse>('/api/v1/pos/sales', { ...input, idempotencyKey: key }, { headers });
  }

  reverseSale(id: string, reason?: string | null): Observable<PosSaleResponse> {
    return this.http.post<PosSaleResponse>(`/api/v1/pos/sales/${encodeURIComponent(id)}/reverse`, { reason: reason ?? null });
  }
}

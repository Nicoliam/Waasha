/**
 * Slice 14 — Inventory API client (web).
 * Provider identity always comes from the authenticated session.
 * Uses constructor injection so the service is unit-testable without TestBed.
 */
import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface CreateItemInput {
  name: string;
  description?: string | null;
  unit?: string;
  costPrice?: number;
  sellingPrice: number;
  quantityOnHand?: number;
  lowStockThreshold?: number;
  sku?: string | null;
  businessUnitId?: string | null;
}

@Injectable({ providedIn: 'root' })
export class InventoryApiService {
  constructor(private readonly http: HttpClient) {}

  listItems(opts: { page?: number; perPage?: number; isActive?: boolean; lowStock?: boolean; search?: string } = {}): Observable<any> {
    let params = new HttpParams();
    if (opts.page) params = params.set('page', String(opts.page));
    if (opts.perPage) params = params.set('perPage', String(opts.perPage));
    if (opts.isActive === true) params = params.set('isActive', 'true');
    if (opts.isActive === false) params = params.set('isActive', 'false');
    if (opts.lowStock) params = params.set('lowStock', 'true');
    if (opts.search) params = params.set('search', opts.search);
    return this.http.get('/api/v1/pos/inventory', { params });
  }

  getItem(id: string): Observable<any> {
    return this.http.get(`/api/v1/pos/inventory/${encodeURIComponent(id)}`);
  }

  createItem(input: CreateItemInput): Observable<any> {
    return this.http.post('/api/v1/pos/inventory', input);
  }

  updateItem(id: string, patch: Record<string, unknown>): Observable<any> {
    return this.http.patch(`/api/v1/pos/inventory/${encodeURIComponent(id)}`, patch);
  }

  activate(id: string): Observable<any> {
    return this.http.post(`/api/v1/pos/inventory/${encodeURIComponent(id)}/activate`, {});
  }

  deactivate(id: string): Observable<any> {
    return this.http.post(`/api/v1/pos/inventory/${encodeURIComponent(id)}/deactivate`, {});
  }

  receive(id: string, quantity: number, reason?: string | null): Observable<any> {
    return this.http.post(`/api/v1/pos/inventory/${encodeURIComponent(id)}/receive`, { quantity, reason: reason ?? null });
  }

  adjust(id: string, delta: number, reason?: string | null): Observable<any> {
    return this.http.post(`/api/v1/pos/inventory/${encodeURIComponent(id)}/adjust`, { delta, reason: reason ?? null });
  }

  movements(id: string, page = 1, perPage = 20): Observable<any> {
    const params = new HttpParams().set('page', String(page)).set('perPage', String(perPage));
    return this.http.get(`/api/v1/pos/inventory/${encodeURIComponent(id)}/movements`, { params });
  }
}

/** Minimal @angular/common/http stub: records params like the real HttpParams. */
export class HttpParams {
  private readonly map: Map<string, string>;
  constructor(from?: Record<string, string>) {
    this.map = new Map(Object.entries(from ?? {}));
  }
  set(param: string, value: string): HttpParams {
    const next = new HttpParams();
    (next as any).map = new Map(this.map);
    (next as any).map.set(param, value);
    return next;
  }
  get(param: string): string | null {
    return this.map.get(param) ?? null;
  }
  toString(): string {
    return [...this.map.entries()].map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
  }
}

export abstract class HttpClient {
  abstract get<T>(url: string, options?: unknown): unknown;
  abstract post<T>(url: string, body?: unknown): unknown;
}

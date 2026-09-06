import { describe, it, expect, vi } from 'vitest';
import { of } from 'rxjs';
import { CustomerBookingsService } from './customer-bookings.service';

function stubHttp() {
  return {
    get: vi.fn().mockReturnValue(of({ success: true, data: [], meta: { page: 1, perPage: 20, total: 0 } })),
  } as any;
}

describe('CustomerBookingsService', () => {
  it('lists the customer inbox without sending customer identity (session owns it)', () => {
    const http = stubHttp();
    const svc = new CustomerBookingsService(http);
    let source: unknown;
    svc.listBookings('upcoming', 1, 10).subscribe((res) => {
      source = res.source;
    });
    expect(http.get).toHaveBeenCalledWith('/api/v1/customers/me/bookings', expect.objectContaining({ params: expect.anything() }));
    const params = http.get.mock.calls[0][1].params;
    expect(params.get('status')).toBe('upcoming');
    expect(params.toString()).not.toMatch(/customerId|userId|tenantId/);
    expect(source).toBe('server');
  });

  it('loads detail through the customer-scoped endpoint and marks it server-authoritative', () => {
    const http = stubHttp();
    const svc = new CustomerBookingsService(http);
    svc.getDetail('bk-1').subscribe((res) => {
      expect(res.source).toBe('server');
    });
    expect(http.get).toHaveBeenCalledWith('/api/v1/customers/me/bookings/bk-1');
  });

  it('exposes no transition methods (cancellation/completion are deferred server-side)', () => {
    const svc = new CustomerBookingsService(stubHttp());
    expect((svc as any).cancel).toBeUndefined();
    expect((svc as any).complete).toBeUndefined();
    expect((svc as any).updateStatus).toBeUndefined();
  });
});

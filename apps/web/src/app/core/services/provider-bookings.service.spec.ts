import { describe, it, expect, vi } from 'vitest';
import { of } from 'rxjs';
import { ProviderBookingsService } from './provider-bookings.service';

function stubHttp() {
  return {
    get: vi.fn().mockReturnValue(of({ success: true, data: [] })),
    post: vi.fn().mockReturnValue(of({ success: true, data: {} })),
  } as any;
}

describe('ProviderBookingsService', () => {
  it('lists the inbox without sending providerId (session is the source of authorization)', () => {
    const http = stubHttp();
    const svc = new ProviderBookingsService(http);
    svc.listInbox('incoming', 1, 20).subscribe();
    expect(http.get).toHaveBeenCalledWith(
      '/api/v1/providers/me/bookings',
      expect.objectContaining({ params: expect.anything() }),
    );
    const params = http.get.mock.calls[0][1].params;
    expect(params.get('status')).toBe('incoming');
    expect(params.toString()).not.toContain('providerId');
  });

  it('accepts and rejects through the provider-owned endpoints', () => {
    const http = stubHttp();
    const svc = new ProviderBookingsService(http);
    svc.accept('bk-1').subscribe();
    svc.reject('bk-2').subscribe();
    expect(http.post).toHaveBeenCalledWith('/api/v1/providers/me/bookings/bk-1/accept', {});
    expect(http.post).toHaveBeenCalledWith('/api/v1/providers/me/bookings/bk-2/reject', {});
  });

  it('loads detail and authorized navigation data for the session provider', () => {
    const http = stubHttp();
    const svc = new ProviderBookingsService(http);
    svc.getDetail('bk-1').subscribe();
    svc.getNavigation('bk-1').subscribe();
    expect(http.get).toHaveBeenCalledWith('/api/v1/providers/me/bookings/bk-1');
    expect(http.get).toHaveBeenCalledWith('/api/v1/providers/me/bookings/bk-1/navigation');
  });
});

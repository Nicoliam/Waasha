import { describe, it, expect, vi } from 'vitest';
import { of } from 'rxjs';
import { ProviderAvailabilityService } from './provider-availability.service';

function stubHttp() {
  return {
    get: vi.fn().mockReturnValue(of({ success: true, data: {} })),
    post: vi.fn().mockReturnValue(of({ success: true, data: {} })),
    put: vi.fn().mockReturnValue(of({ success: true, data: {} })),
    patch: vi.fn().mockReturnValue(of({ success: true, data: {} })),
    delete: vi.fn().mockReturnValue(of({ success: true, data: {} })),
  } as any;
}

describe('ProviderAvailabilityService', () => {
  it('reads the schedule without sending providerId (session owns authorization)', () => {
    const http = stubHttp();
    const svc = new ProviderAvailabilityService(http);
    svc.getSchedule().subscribe();
    expect(http.get).toHaveBeenCalledWith('/api/v1/providers/me/availability', expect.objectContaining({ params: expect.anything() }));
    expect(http.get.mock.calls[0][1].params.toString()).not.toContain('providerId');
  });

  it('creates, replaces, updates, and deletes rules through session endpoints', () => {
    const http = stubHttp();
    const svc = new ProviderAvailabilityService(http);
    svc.createRule({ dayOfWeek: 1, startTime: '08:00', endTime: '12:00' }).subscribe();
    svc.replaceRules({ rules: [{ dayOfWeek: 1, startTime: '08:00', endTime: '12:00' }] }).subscribe();
    svc.updateRule('r1', { startTime: '09:00' }).subscribe();
    svc.deleteRule('r1').subscribe();
    expect(http.post).toHaveBeenCalledWith('/api/v1/providers/me/availability/rules', expect.objectContaining({ dayOfWeek: 1 }));
    expect(http.put).toHaveBeenCalledWith('/api/v1/providers/me/availability/rules', expect.anything());
    expect(http.patch).toHaveBeenCalledWith('/api/v1/providers/me/availability/rules/r1', { startTime: '09:00' });
    expect(http.delete).toHaveBeenCalledWith('/api/v1/providers/me/availability/rules/r1');
  });

  it('manages exceptions, conflicts, and timezone through session endpoints', () => {
    const http = stubHttp();
    const svc = new ProviderAvailabilityService(http);
    svc.createException({ date: '2026-12-25', kind: 'FULL_DAY' }).subscribe();
    svc.deleteException('e1').subscribe();
    svc.getConflicts().subscribe();
    svc.updateTimezone('Africa/Johannesburg').subscribe();
    expect(http.post).toHaveBeenCalledWith('/api/v1/providers/me/availability/exceptions', expect.objectContaining({ date: '2026-12-25' }));
    expect(http.delete).toHaveBeenCalledWith('/api/v1/providers/me/availability/exceptions/e1');
    expect(http.get).toHaveBeenCalledWith('/api/v1/providers/me/availability/conflicts');
    expect(http.put).toHaveBeenCalledWith('/api/v1/providers/me/availability/timezone', { timezone: 'Africa/Johannesburg' });
  });

  it('requests upcoming exceptions with pagination', () => {
    const http = stubHttp();
    const svc = new ProviderAvailabilityService(http);
    svc.listExceptions(2, 5).subscribe();
    const params = http.get.mock.calls[0][1].params;
    expect(params.get('page')).toBe('2');
    expect(params.get('perPage')).toBe('5');
    expect(params.get('upcomingOnly')).toBe('true');
  });
});

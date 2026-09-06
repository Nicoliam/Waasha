import { describe, it, expect, vi } from 'vitest';
import { of } from 'rxjs';
import { NotificationService } from './notification.service';

function stubHttp() {
  return {
    get: vi.fn().mockReturnValue(of({ success: true, data: [], meta: { page: 1, perPage: 20, total: 0, unreadCount: 0 } })),
    patch: vi.fn().mockReturnValue(of({ success: true, data: {} })),
    post: vi.fn().mockReturnValue(of({ success: true, data: { updated: 1 } })),
    put: vi.fn().mockReturnValue(of({ success: true, data: {} })),
  } as any;
}

describe('NotificationService', () => {
  it('lists and counts without sending recipient identity (session owns it)', () => {
    const http = stubHttp();
    const svc = new NotificationService(http);
    let source: unknown;
    svc.list(1, 20).subscribe((res) => {
      source = res.source;
    });
    expect(http.get).toHaveBeenCalledWith('/api/v1/notifications', expect.objectContaining({ params: expect.anything() }));
    const params = http.get.mock.calls[0][1].params;
    expect(params.toString()).not.toMatch(/userId|recipient|tenantId/);
    expect(source).toBe('server');
    svc.unreadCount().subscribe();
    expect(http.get).toHaveBeenCalledWith('/api/v1/notifications/unread-count');
  });

  it('marks read through the canonical endpoints', () => {
    const http = stubHttp();
    const svc = new NotificationService(http);
    svc.markRead('n1').subscribe();
    svc.markAllRead().subscribe();
    expect(http.patch).toHaveBeenCalledWith('/api/v1/notifications/n1/read', {});
    expect(http.post).toHaveBeenCalledWith('/api/v1/notifications/read-all', {});
  });

  it('reads and writes preferences without vendor coupling', () => {
    const http = stubHttp();
    const svc = new NotificationService(http);
    svc.getPreferences().subscribe();
    svc.setPreference('IN_APP', 'MARKETING', false).subscribe();
    expect(http.get).toHaveBeenCalledWith('/api/v1/notifications/preferences');
    expect(http.put).toHaveBeenCalledWith('/api/v1/notifications/preferences', {
      channel: 'IN_APP',
      notificationType: 'MARKETING',
      isEnabled: false,
    });
  });
});

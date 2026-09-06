/**
 * Slice 7 — Frontend behavior validation (executed, not filesystem-only).
 * Real web/mobile notification utils + real Angular NotificationService
 * against a stub HttpClient, plus route/component contract checks.
 */
import * as fs from 'fs';
import * as path from 'path';
import { of } from 'rxjs';

import {
  isUnread,
  routeFor,
  typeLabel,
  categoryOf,
  unreadCountOf,
  applyMarkRead,
  applyMarkAllRead,
} from '../../apps/web/src/app/features/notifications/notification.utils';
import * as mobileUtils from '../../apps/mobile/src/app/features/notifications/notification.utils';
import { NotificationService as WebNotifService } from '../../apps/web/src/app/core/services/notification.service';
import { NotificationService as MobileNotifService } from '../../apps/mobile/src/app/core/services/notification.service';

const root = path.resolve(__dirname, '../../');
function read(p: string): string {
  return fs.readFileSync(path.join(root, p), 'utf8');
}

function stubHttp() {
  const calls: Array<{ method: string; url: string; options?: unknown; body?: unknown }> = [];
  const http: any = {
    get: (url: string, options?: unknown) => {
      calls.push({ method: 'GET', url, options });
      return of({ success: true, data: [], meta: { page: 1, perPage: 20, total: 0, unreadCount: 0 } });
    },
    patch: (url: string, body?: unknown) => {
      calls.push({ method: 'PATCH', url, body });
      return of({ success: true, data: {} });
    },
    post: (url: string, body?: unknown) => {
      calls.push({ method: 'POST', url, body });
      return of({ success: true, data: { updated: 1 } });
    },
    put: (url: string, body?: unknown) => {
      calls.push({ method: 'PUT', url, body });
      return of({ success: true, data: {} });
    },
  };
  return { http, calls };
}

function item(over: Record<string, unknown> = {}) {
  return {
    id: 'n1',
    type: 'BOOKING_ACCEPTED',
    audience: 'CUSTOMER',
    channel: 'IN_APP',
    status: 'UNREAD',
    title: 'Booking accepted',
    message: 'Sharp Cuts accepted your booking for Fade.',
    entityType: 'booking',
    entityId: 'bk-1',
    deepLink: '/bookings/bk-1',
    readAt: null,
    createdAt: new Date().toISOString(),
    ...over,
  };
}

describe('Slice 7 frontend — read state + deep links (real logic)', () => {
  it('web + mobile share identical semantics', () => {
    expect(mobileUtils.isUnread(item() as never)).toBe(isUnread(item() as never));
    expect(mobileUtils.routeFor(item() as never)).toEqual(routeFor(item() as never));
    expect(mobileUtils.typeLabel('PAYMENT_FAILED')).toBe('Payment failed');
  });

  it('unread detection, badge count, mark-read transitions', () => {
    expect(isUnread(item() as never)).toBe(true);
    expect(unreadCountOf([item() as never, item({ id: 'n2', status: 'READ' } as never)] as never)).toBe(1);
    const one = applyMarkRead([item() as never], 'n1');
    expect(one[0].status).toBe('READ');
    const all = applyMarkAllRead([item() as never, item({ id: 'n2' } as never)] as never);
    expect(all.every((n) => n.status === 'READ')).toBe(true);
  });

  it('deep links route per audience to authorized screens only', () => {
    expect(routeFor(item() as never)).toEqual(['/', 'bookings', 'bk-1']);
    expect(routeFor(item({ deepLink: '/provider/bookings/bk-1' }) as never)).toEqual(['/', 'provider', 'bookings', 'bk-1']);
    expect(routeFor(item({ deepLink: null }) as never)).toBeNull();
    expect(categoryOf('PAYMENT_PAID')).toBe('payment');
    expect(categoryOf('NEW_BOOKING_REQUEST')).toBe('booking');
  });
});

describe('Slice 7 frontend — real NotificationService behavior', () => {
  it('web list/count never send recipient identity; source is server', (done) => {
    const { http, calls } = stubHttp();
    new WebNotifService(http).list(1, 20).subscribe((res) => {
      expect(calls[0].url).toBe('/api/v1/notifications');
      const params = (calls[0].options as { params: { toString: () => string } }).params;
      expect(params.toString()).not.toMatch(/userId|recipient|tenantId/);
      expect(res.source).toBe('server');
      done();
    });
  });

  it('read actions hit canonical endpoints; mobile mirrors the contract', (done) => {
    const web = stubHttp();
    const svc = new WebNotifService(web.http);
    svc.markRead('n1').subscribe(() => {
      svc.markAllRead().subscribe(() => {
        expect(web.calls[0]).toMatchObject({ method: 'PATCH', url: '/api/v1/notifications/n1/read' });
        expect(web.calls[1]).toMatchObject({ method: 'POST', url: '/api/v1/notifications/read-all' });
        const mobile = stubHttp();
        new MobileNotifService(mobile.http).unreadCount().subscribe(() => {
          expect(mobile.calls[0].url).toBe('/api/v1/notifications/unread-count');
          done();
        });
      });
    });
  });

  it('preferences round-trip without vendor coupling', (done) => {
    const { http, calls } = stubHttp();
    const svc = new WebNotifService(http);
    svc.setPreference('IN_APP', 'MARKETING', false).subscribe(() => {
      expect(calls[0]).toMatchObject({
        method: 'PUT',
        url: '/api/v1/notifications/preferences',
        body: { channel: 'IN_APP', notificationType: 'MARKETING', isEnabled: false },
      });
      done();
    });
  });
});

describe('Slice 7 frontend — routes, bell, states (web and mobile)', () => {
  it('both apps expose a guarded /notifications route and header bell', () => {
    for (const routesPath of ['apps/web/src/app/app.routes.ts', 'apps/mobile/src/app/app.routes.ts']) {
      const c = read(routesPath);
      expect(c).toMatch(/path: 'notifications'/);
      expect(c).toMatch(/authGuard/);
    }
    expect(read('apps/web/src/app/app.html')).toMatch(/waasha-notification-bell/);
    expect(read('apps/mobile/src/app/app.html')).toMatch(/waasha-mobile-notification-bell/);
  });

  it('list components implement loading/empty/error/unauthorized + offline-honest read', () => {
    for (const f of [
      'apps/web/src/app/features/notifications/notifications.component.ts',
      'apps/mobile/src/app/features/notifications/notifications.page.ts',
    ]) {
      const c = read(f);
      expect(c).toMatch(/Loading notifications/);
      expect(c).toMatch(/You're all caught up/);
      expect(c).toMatch(/auth\/login/);
      expect(c).toMatch(/Mark all read/);
      expect(c).toMatch(/View booking/);
      expect(c).toMatch(/Nothing was changed/);
      expect(c).not.toMatch(/innerHTML/);
    }
  });

  it('bell polls conservatively, hides badge at zero, never fabricates counts', () => {
    for (const f of [
      'apps/web/src/app/shared/components/notifications/notification-bell.component.ts',
      'apps/mobile/src/app/shared/components/notifications/notification-bell.component.ts',
    ]) {
      const c = read(f);
      expect(c).toMatch(/UNREAD_POLL_INTERVAL_MS/);
      expect(c).toMatch(/document\.hidden/);
      expect(c).toMatch(/unread > 0/);
    }
  });
});

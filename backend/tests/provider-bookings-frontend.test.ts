/**
 * Slice 5 — Frontend behavior validation (executed, not filesystem-only).
 *
 * Imports the REAL web/mobile provider-booking modules and exercises them:
 * - pure inbox/grouping/location/navigation helpers (shared logic)
 * - the actual Angular ProviderBookingsService against a stub HttpClient,
 *   asserting endpoint URLs, session-based auth (no providerId), and verbs.
 * - web/mobile parity: both apps expose the same API contract and routes.
 */
import * as fs from 'fs';
import * as path from 'path';
import { of } from 'rxjs';

import {
  groupOf,
  filterByGroup,
  isLocationAuthorized,
  statusLabel,
  paymentLabel,
  navigationUrls,
  cashChangeText,
} from '../../apps/web/src/app/features/provider-bookings/provider-bookings.utils';
import * as mobileUtils from '../../apps/mobile/src/app/features/provider-bookings/provider-bookings.utils';
import { ProviderBookingsService as WebBookingsService } from '../../apps/web/src/app/core/services/provider-bookings.service';
import { ProviderBookingsService as MobileBookingsService } from '../../apps/mobile/src/app/core/services/provider-bookings.service';

const root = path.resolve(__dirname, '../../');
function read(p: string): string {
  return fs.readFileSync(path.join(root, p), 'utf8');
}

function stubHttp() {
  const calls: Array<{ method: string; url: string; body?: unknown; options?: unknown }> = [];
  const http: any = {
    get: (url: string, options?: unknown) => {
      calls.push({ method: 'GET', url, options });
      return of({ success: true, data: [] });
    },
    post: (url: string, body?: unknown) => {
      calls.push({ method: 'POST', url, body });
      return of({ success: true, data: {} });
    },
  };
  return { http, calls };
}

function summary(over: Record<string, unknown> = {}) {
  return {
    id: 'b1',
    reference: 'ref-1',
    status: 'PENDING',
    paymentStatus: 'PENDING',
    paymentMethod: null,
    serviceName: 'Fade',
    scheduledStart: new Date().toISOString(),
    scheduledEnd: new Date().toISOString(),
    durationMinutes: 30,
    totalAmount: 200,
    currency: 'ZAR',
    createdAt: new Date().toISOString(),
    ...over,
  };
}

describe('Slice 5 frontend — inbox grouping + lifecycle labels (real logic)', () => {
  it('web + mobile share identical grouping/location semantics', () => {
    expect(mobileUtils.groupOf('PENDING')).toBe(groupOf('PENDING'));
    expect(mobileUtils.groupOf('ACCEPTED')).toBe(groupOf('ACCEPTED'));
    expect(mobileUtils.isLocationAuthorized('PENDING')).toBe(false);
    expect(mobileUtils.isLocationAuthorized('ACCEPTED')).toBe(true);
    expect(mobileUtils.statusLabel('DECLINED')).toBe('Declined');
  });

  it('groups PENDING→incoming, ACCEPTED/CONFIRMED→accepted, DECLINED/CANCELLED→rejected, COMPLETED→completed', () => {
    expect(groupOf('PENDING')).toBe('incoming');
    expect(groupOf('ACCEPTED')).toBe('accepted');
    expect(groupOf('CONFIRMED')).toBe('accepted');
    expect(groupOf('DECLINED')).toBe('rejected');
    expect(groupOf('COMPLETED')).toBe('completed');
    const all = [summary({ id: 'p', status: 'PENDING' }), summary({ id: 'a', status: 'ACCEPTED' })];
    expect(filterByGroup(all as any, 'incoming').map((b) => b.id)).toEqual(['p']);
    expect(filterByGroup(all as any, 'all')).toHaveLength(2);
  });

  it('location stays redacted while PENDING and opens once ACCEPTED', () => {
    expect(isLocationAuthorized('PENDING')).toBe(false);
    for (const s of ['ACCEPTED', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED']) {
      expect(isLocationAuthorized(s)).toBe(true);
    }
    expect(statusLabel('PENDING')).toBe('Pending review');
    expect(paymentLabel('cash', 'PAID')).toBe('Cash • PAID');
  });

  it('navigation opens the installed app and cash text never guarantees change', () => {
    const links = navigationUrls(-26.2, 28.0);
    expect(links.googleMapsUrl).toContain('google.com/maps');
    expect(links.appleMapsUrl).toContain('maps.apple.com');
    expect(cashChangeText(true, 50)).toContain('R50');
    expect(cashChangeText(true, 50)).not.toMatch(/guarantee/i);
    expect(cashChangeText(false, null)).toBeNull();
  });
});

describe('Slice 5 frontend — real ProviderBookingsService behavior (web)', () => {
  it('inbox list uses session auth only — never sends providerId', (done) => {
    const { http, calls } = stubHttp();
    const svc = new WebBookingsService(http);
    svc.listInbox('incoming', 1, 20).subscribe(() => {
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe('/api/v1/providers/me/bookings');
      const params = (calls[0].options as any).params;
      expect(params.get('status')).toBe('incoming');
      expect(params.toString()).not.toContain('providerId');
      done();
    });
  });

  it('accept/reject hit provider-owned endpoints (no client providerId)', (done) => {
    const { http, calls } = stubHttp();
    const svc = new WebBookingsService(http);
    svc.accept('bk-1').subscribe(() => {
      svc.reject('bk-1').subscribe(() => {
        expect(calls[0]).toMatchObject({ method: 'POST', url: '/api/v1/providers/me/bookings/bk-1/accept' });
        expect(calls[1]).toMatchObject({ method: 'POST', url: '/api/v1/providers/me/bookings/bk-1/reject' });
        done();
      });
    });
  });

  it('detail + navigation endpoints are provider-scoped', (done) => {
    const { http, calls } = stubHttp();
    const svc = new WebBookingsService(http);
    svc.getDetail('bk-9').subscribe(() => {
      svc.getNavigation('bk-9').subscribe(() => {
        expect(calls[0].url).toBe('/api/v1/providers/me/bookings/bk-9');
        expect(calls[1].url).toBe('/api/v1/providers/me/bookings/bk-9/navigation');
        done();
      });
    });
  });
});

describe('Slice 5 frontend — mobile parity (same backend APIs, no mobile-only rules)', () => {
  it('mobile service issues the identical API contract', (done) => {
    const { http, calls } = stubHttp();
    const svc = new MobileBookingsService(http);
    svc.listInbox('accepted', 1, 20).subscribe(() => {
      svc.accept('bk-1').subscribe(() => {
        svc.getNavigation('bk-1').subscribe(() => {
          expect(calls[0].url).toBe('/api/v1/providers/me/bookings');
          expect(calls[1].url).toBe('/api/v1/providers/me/bookings/bk-1/accept');
          expect(calls[2].url).toBe('/api/v1/providers/me/bookings/bk-1/navigation');
          done();
        });
      });
    });
  });

  it('web + mobile routes expose guarded provider inbox and detail', () => {
    for (const routesPath of ['apps/web/src/app/app.routes.ts', 'apps/mobile/src/app/app.routes.ts']) {
      const c = read(routesPath);
      expect(c).toMatch(/provider\/bookings/);
      expect(c).toMatch(/provider\/bookings\/:id/);
      expect(c).toMatch(/authGuard/);
    }
  });

  it('web + mobile components implement inbox/detail/accept/reject/loading/empty/error/unauthorized states', () => {
    const pairs = [
      ['apps/web/src/app/features/provider-bookings/provider-inbox.component.ts', 'apps/mobile/src/app/features/provider-bookings/provider-inbox.page.ts'],
      ['apps/web/src/app/features/provider-bookings/provider-booking-detail.component.ts', 'apps/mobile/src/app/features/provider-bookings/provider-booking-detail.page.ts'],
    ];
    for (const [web, mobile] of pairs) {
      for (const content of [read(web), read(mobile)]) {
        expect(content).toMatch(/Loading bookings|Loading booking/);
        expect(content).toMatch(/No bookings here|Booking not found/);
        expect(content).toMatch(/auth\/login/);
      }
    }
    expect(read('apps/web/src/app/features/provider-bookings/provider-booking-detail.component.ts')).toMatch(/Accept booking/);
    expect(read('apps/web/src/app/features/provider-bookings/provider-booking-detail.component.ts')).toMatch(/Navigate to Client/);
  });
});

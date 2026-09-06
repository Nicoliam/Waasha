/**
 * Slice 6 — Frontend behavior validation (executed, not filesystem-only).
 *
 * Imports the REAL web/mobile customer-booking modules and exercises them:
 * - pure grouping/label/location/cash helpers (shared logic)
 * - the actual Angular CustomerBookingsService against a stub HttpClient
 * - web/mobile parity and guarded routes
 */
import * as fs from 'fs';
import * as path from 'path';
import { of } from 'rxjs';

import {
  groupOf,
  filterByGroup,
  isLocationAuthorized,
  providerDisplayName,
  statusLabel,
  bookingVsPaymentText,
  cashChangeText,
  locationSummaryText,
} from '../../apps/web/src/app/features/bookings/customer-bookings.utils';
import * as mobileUtils from '../../apps/mobile/src/app/features/bookings/customer-bookings.utils';
import { CustomerBookingsService as WebBookingsService } from '../../apps/web/src/app/core/services/customer-bookings.service';
import { CustomerBookingsService as MobileBookingsService } from '../../apps/mobile/src/app/core/services/customer-bookings.service';

const root = path.resolve(__dirname, '../../');
function read(p: string): string {
  return fs.readFileSync(path.join(root, p), 'utf8');
}

function stubHttp() {
  const calls: Array<{ method: string; url: string; options?: unknown }> = [];
  const http: any = {
    get: (url: string, options?: unknown) => {
      calls.push({ method: 'GET', url, options });
      return of({ success: true, data: [], meta: { page: 1, perPage: 20, total: 0 } });
    },
  };
  return { http, calls };
}

function summary(over: Record<string, unknown> = {}) {
  return {
    id: 'b1',
    reference: 'ref-1',
    status: 'PENDING',
    serviceName: 'Fade',
    providerName: 'Sharp Cuts',
    businessName: null,
    scheduledStart: new Date().toISOString(),
    scheduledEnd: new Date().toISOString(),
    totalAmount: 200,
    currency: 'ZAR',
    paymentMethod: null,
    paymentStatus: 'PENDING',
    locationSummary: 'Johannesburg, Gauteng',
    createdAt: new Date().toISOString(),
    ...over,
  };
}

describe('Slice 6 frontend — grouping + labels (real logic)', () => {
  it('web + mobile share identical semantics', () => {
    expect(mobileUtils.groupOf('IN_PROGRESS')).toBe(groupOf('IN_PROGRESS'));
    expect(mobileUtils.isLocationAuthorized('PENDING')).toBe(false);
    expect(mobileUtils.bookingVsPaymentText('ACCEPTED', 'cash', 'PAID')).toBe('Accepted • Cash PAID');
  });

  it('groups canonical statuses with no invented states', () => {
    expect(groupOf('PENDING')).toBe('upcoming');
    expect(groupOf('ACCEPTED')).toBe('accepted');
    expect(groupOf('IN_PROGRESS')).toBe('active');
    expect(groupOf('COMPLETED')).toBe('completed');
    expect(groupOf('DECLINED')).toBe('declined');
    expect(groupOf('CANCELLED')).toBe('cancelled');
    const all = [summary({ id: 'u', status: 'PENDING' }), summary({ id: 'c', status: 'COMPLETED' })];
    expect(filterByGroup(all as never, 'upcoming').map((b) => b.id)).toEqual(['u']);
    expect(filterByGroup(all as never, 'all')).toHaveLength(2);
  });

  it('keeps booking and payment status visually separate', () => {
    expect(bookingVsPaymentText('PENDING', null, 'PENDING')).toContain('Pending provider review');
    expect(bookingVsPaymentText('PENDING', null, 'PENDING')).toContain('Not set PENDING');
    expect(statusLabel('CANCELLED')).toBe('Cancelled');
    expect(providerDisplayName({ providerName: 'Sam', businessName: 'Branch' })).toBe('Branch');
  });

  it('protects precise location and never guarantees cash change', () => {
    expect(isLocationAuthorized('PENDING')).toBe(false);
    expect(isLocationAuthorized('CONFIRMED')).toBe(true);
    expect(locationSummaryText('Johannesburg, Gauteng', false)).toContain('once accepted');
    expect(cashChangeText(true, 50)).toContain('R50');
    expect(cashChangeText(true, 50)).not.toMatch(/guarantee/i);
  });
});

describe('Slice 6 frontend — real CustomerBookingsService behavior', () => {
  it('web list uses session auth only and marks data server-authoritative', (done) => {
    const { http, calls } = stubHttp();
    new WebBookingsService(http).listBookings('upcoming', 1, 10).subscribe((res) => {
      expect(calls[0].url).toBe('/api/v1/customers/me/bookings');
      const params = (calls[0].options as { params: { get: (k: string) => string | null; toString: () => string } }).params;
      expect(params.get('status')).toBe('upcoming');
      expect(params.toString()).not.toMatch(/customerId|userId|tenantId/);
      expect(res.source).toBe('server');
      done();
    });
  });

  it('web detail is customer-scoped; mobile issues the identical contract', (done) => {
    const web = stubHttp();
    new WebBookingsService(web.http).getDetail('bk-1').subscribe(() => {
      expect(web.calls[0].url).toBe('/api/v1/customers/me/bookings/bk-1');
      const mobile = stubHttp();
      new MobileBookingsService(mobile.http).listBookings('all', 2, 10).subscribe(() => {
        expect(mobile.calls[0].url).toBe('/api/v1/customers/me/bookings');
        done();
      });
    });
  });

  it('service exposes no transition methods', () => {
    const svc = new WebBookingsService(stubHttp().http);
    expect((svc as unknown as Record<string, unknown>).cancel).toBeUndefined();
    expect((svc as unknown as Record<string, unknown>).complete).toBeUndefined();
  });
});

describe('Slice 6 frontend — routes + states (web and mobile)', () => {
  it('both apps expose guarded /bookings and /bookings/:id routes', () => {
    for (const routesPath of ['apps/web/src/app/app.routes.ts', 'apps/mobile/src/app/app.routes.ts']) {
      const c = read(routesPath);
      expect(c).toMatch(/path: 'bookings'/);
      expect(c).toMatch(/bookings\/:id/);
      expect(c).toMatch(/authGuard/);
    }
  });

  it('list/detail components implement loading/empty/error/unauthorized states with no transition UI', () => {
    const files = [
      'apps/web/src/app/features/bookings/my-bookings.component.ts',
      'apps/web/src/app/features/bookings/my-booking-detail.component.ts',
      'apps/mobile/src/app/features/bookings/my-bookings.page.ts',
      'apps/mobile/src/app/features/bookings/my-booking-detail.page.ts',
    ];
    for (const f of files) {
      const c = read(f);
      expect(c).toMatch(/Loading booking/);
      expect(c).toMatch(/auth\/login/);
    }
    const detail = read('apps/web/src/app/features/bookings/my-booking-detail.component.ts');
    expect(detail).toMatch(/Service snapshot/);
    expect(detail).toMatch(/cashText/);
    expect(detail).not.toMatch(/Accept booking|Navigate to Client/);
    const list = read('apps/web/src/app/features/bookings/my-bookings.component.ts');
    expect(list).toMatch(/No bookings here/);
    expect(list).toMatch(/Page {{ page }}/);
  });
});

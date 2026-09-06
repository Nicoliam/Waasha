/**
 * Slice 8 frontend — executable validation (not filesystem-only).
 *
 * Imports the REAL web/mobile provider-availability modules and exercises them:
 * - pure schedule mapping/validation/labels (shared logic)
 * - the actual Angular ProviderAvailabilityService against a stub HttpClient
 * - web/mobile parity, guarded routes, and server-confirmed/offline states
 */
import * as fs from 'fs';
import * as path from 'path';
import { of } from 'rxjs';

import {
  groupRulesByDay,
  validateWindow,
  findOverlap,
  validateExceptionDate,
  exceptionLabel,
  conflictMessage,
  offlineBlockedMessage,
  apiErrorMessage,
  dayName,
} from '../../apps/web/src/app/features/provider-availability/provider-availability.utils';
import * as mobileUtils from '../../apps/mobile/src/app/features/provider-availability/provider-availability.utils';
import { ProviderAvailabilityService as WebAvailabilityService } from '../../apps/web/src/app/core/services/provider-availability.service';
import { ProviderAvailabilityService as MobileAvailabilityService } from '../../apps/mobile/src/app/core/services/provider-availability.service';

const root = path.resolve(__dirname, '../../');
function read(p: string): string {
  return fs.readFileSync(path.join(root, p), 'utf8');
}

function stubHttp() {
  const calls: Array<{ method: string; url: string; body?: unknown; options?: unknown }> = [];
  const http: any = {
    get: (url: string, options?: unknown) => {
      calls.push({ method: 'GET', url, options });
      return of({ success: true, data: {}, meta: { page: 1, perPage: 20, total: 0 }, timezone: 'Africa/Johannesburg' });
    },
    post: (url: string, body?: unknown) => {
      calls.push({ method: 'POST', url, body });
      return of({ success: true, data: {} });
    },
    put: (url: string, body?: unknown) => {
      calls.push({ method: 'PUT', url, body });
      return of({ success: true, data: {} });
    },
    patch: (url: string, body?: unknown) => {
      calls.push({ method: 'PATCH', url, body });
      return of({ success: true, data: {} });
    },
    delete: (url: string) => {
      calls.push({ method: 'DELETE', url });
      return of({ success: true, data: {} });
    },
  };
  return { http, calls };
}

function webRule(over: Record<string, unknown> = {}) {
  return {
    id: 'r1',
    dayOfWeek: 1,
    dayName: 'Monday',
    startTime: '08:00',
    endTime: '12:00',
    timezone: 'Africa/Johannesburg',
    isActive: true,
    businessUnitId: null,
    ...over,
  };
}

describe('Slice 8 frontend — schedule mapping + validation (real logic)', () => {
  it('web + mobile share identical semantics', () => {
    expect(mobileUtils.dayName(1)).toBe(dayName(1));
    expect(mobileUtils.validateWindow(1, '12:00', '08:00')).toBe(validateWindow(1, '12:00', '08:00'));
    expect(mobileUtils.validateExceptionDate('2026-02-30')).toBe(validateExceptionDate('2026-02-30'));
    expect(mobileUtils.offlineBlockedMessage()).toBe(offlineBlockedMessage());
  });

  it('maps rules into seven sorted day groups', () => {
    const groups = groupRulesByDay([webRule({ id: 'b', startTime: '13:00', endTime: '17:00' }), webRule({ id: 'a' })] as never);
    expect(groups).toHaveLength(7);
    expect(groups[1].map((r) => r.id)).toEqual(['a', 'b']);
    expect(groups[6]).toEqual([]);
  });

  it('validates windows and detects overlaps client-side', () => {
    expect(validateWindow(1, '08:00', '12:00')).toBeNull();
    expect(validateWindow(9, '08:00', '12:00')).not.toBeNull();
    expect(validateWindow(1, '12:00', '12:00')).not.toBeNull();
    expect(findOverlap([{ startTime: '08:00', endTime: '12:00' }], { startTime: '11:30', endTime: '13:00' })).toBe(true);
    expect(findOverlap([{ startTime: '08:00', endTime: '12:00' }], { startTime: '12:00', endTime: '13:00' })).toBe(false);
  });

  it('labels exceptions and conflicts without implying auto-cancellation', () => {
    expect(exceptionLabel({ id: 'e', date: '2026-12-25', startTime: null, endTime: null, kind: 'FULL_DAY', type: 'UNAVAILABLE', reason: null } as never)).toContain('closed all day');
    const msg = conflictMessage({ bookingId: 'bk-1', scheduledStart: 'x', scheduledEnd: 'y', date: '2026-12-25', reason: 'Date is now fully closed' });
    expect(msg).toContain('kept as-is');
    expect(msg).not.toMatch(/cancel/i);
  });

  it('offline messaging blocks mutations without faking success', () => {
    expect(offlineBlockedMessage()).toMatch(/offline/i);
    expect(offlineBlockedMessage()).not.toMatch(/has been saved|was saved|saved successfully/i);
  });

  it('parses API errors with code and unauthorized routing signal', () => {
    const parsed = apiErrorMessage({ error: { code: 'AVAILABILITY_CONFLICT', message: 'Overlap' } });
    expect(parsed.message).toContain('AVAILABILITY_CONFLICT');
    expect(parsed.unauthorized).toBe(false);
    expect(apiErrorMessage({ status: 401 }).unauthorized).toBe(true);
  });
});

describe('Slice 8 frontend — real ProviderAvailabilityService contract', () => {
  it('web schedule/rules read uses session endpoints with no ownership ids', (done) => {
    const { http, calls } = stubHttp();
    new WebAvailabilityService(http).getSchedule().subscribe(() => {
      expect(calls[0].url).toBe('/api/v1/providers/me/availability');
      expect(calls[0].options).toBeDefined();
      done();
    });
  });

  it('web rule CRUD hits session endpoints with allowlisted bodies', (done) => {
    const { http, calls } = stubHttp();
    const svc = new WebAvailabilityService(http);
    svc.createRule({ dayOfWeek: 1, startTime: '08:00', endTime: '12:00' }).subscribe(() => {
      expect(calls[0].url).toBe('/api/v1/providers/me/availability/rules');
      expect(calls[0].body).toEqual({ dayOfWeek: 1, startTime: '08:00', endTime: '12:00' });
      expect(JSON.stringify(calls[0].body)).not.toMatch(/providerId|userId|tenantId/);
      done();
    });
  });

  it('web replace/update/delete/timezone/conflicts use the canonical contract', (done) => {
    const { http, calls } = stubHttp();
    const svc = new WebAvailabilityService(http);
    svc.replaceRules({ rules: [{ dayOfWeek: 1, startTime: '08:00', endTime: '12:00' }] }).subscribe(() => {
      expect(calls[0].method).toBe('PUT');
      expect(calls[0].url).toBe('/api/v1/providers/me/availability/rules');
      svc.updateRule('r1', { isActive: false }).subscribe(() => {
        expect(calls[1].method).toBe('PATCH');
        svc.deleteRule('r1').subscribe(() => {
          expect(calls[2].method).toBe('DELETE');
          svc.updateTimezone('Africa/Johannesburg').subscribe(() => {
            expect(calls[3].url).toBe('/api/v1/providers/me/availability/timezone');
            svc.getConflicts().subscribe(() => {
              expect(calls[4].url).toBe('/api/v1/providers/me/availability/conflicts');
              done();
            });
          });
        });
      });
    });
  });

  it('web exception CRUD uses the session contract; mobile issues the identical contract', (done) => {
    const web = stubHttp();
    new WebAvailabilityService(web.http).createException({ date: '2026-12-25', kind: 'FULL_DAY' }).subscribe(() => {
      expect(web.calls[0].url).toBe('/api/v1/providers/me/availability/exceptions');
      const mobile = stubHttp();
      new MobileAvailabilityService(mobile.http).createException({ date: '2026-12-25', kind: 'FULL_DAY' }).subscribe(() => {
        expect(mobile.calls[0].url).toBe(web.calls[0].url);
        expect(mobile.calls[0].body).toEqual(web.calls[0].body);
        new MobileAvailabilityService(mobile.http).getSchedule().subscribe(() => {
          expect(mobile.calls[1].url).toBe('/api/v1/providers/me/availability');
          done();
        });
      });
    });
  });

  it('exception listing is paginated with upcoming filter', (done) => {
    const { http, calls } = stubHttp();
    new WebAvailabilityService(http).listExceptions(2, 5).subscribe(() => {
      const params = (calls[0].options as { params: { get: (k: string) => string | null } }).params;
      expect(calls[0].url).toBe('/api/v1/providers/me/availability/exceptions');
      expect(params.get('page')).toBe('2');
      expect(params.get('upcomingOnly')).toBe('true');
      done();
    });
  });
});

describe('Slice 8 frontend — routes + states (web and mobile)', () => {
  it('both apps expose a guarded /provider/availability route with no providerId param', () => {
    for (const routesPath of ['apps/web/src/app/app.routes.ts', 'apps/mobile/src/app/app.routes.ts']) {
      const c = read(routesPath);
      expect(c).toMatch(/path: 'provider\/availability'/);
      expect(c).toMatch(/authGuard/);
      expect(c).not.toMatch(/provider\/availability\/:providerId/);
    }
  });

  it('scheduling screens implement loading/error/unauthorized/saving/conflict/offline states', () => {
    const files = [
      'apps/web/src/app/features/provider-availability/provider-availability.component.ts',
      'apps/mobile/src/app/features/provider-availability/provider-availability.page.ts',
    ];
    for (const f of files) {
      const c = read(f);
      expect(c).toMatch(/Loading your schedule/);
      expect(c).toMatch(/auth\/login/);
      expect(c).toMatch(/Saving/);
      expect(c).toMatch(/conflict/i);
      expect(c).toMatch(/offline/i);
      expect(c).toMatch(/never moved or cancelled/i);
      // Never generates slots client-side; never touches driver/finance logic
      expect(c).not.toMatch(/getAvailabilitySlots|localToUtc|durationMinutes/);
      expect(c).not.toMatch(/driver/i);
    }
  });

  it('scheduling screens block offline mutations instead of queueing silently', () => {
    for (const f of [
      'apps/web/src/app/features/provider-availability/provider-availability.component.ts',
      'apps/mobile/src/app/features/provider-availability/provider-availability.page.ts',
    ]) {
      const c = read(f);
      expect(c).toMatch(/navigator\.onLine/);
      expect(c).toMatch(/offlineMessage/);
    }
  });
});

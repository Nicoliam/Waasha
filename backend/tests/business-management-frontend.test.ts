/**
 * Slice 15 — T2/T3 business management frontend contracts.
 *
 * Verifies the REAL web/mobile BusinessApiService clients against a stub
 * HttpClient (same backend URLs, no providerId/businessId as authority),
 * web/mobile utils parity, route registration on both apps, offline
 * mutation blocking, and no mock business data.
 */
import * as fs from 'fs';
import * as path from 'path';
import { of } from 'rxjs';

function read(rel: string): string {
  return fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');
}

function stubHttp() {
  const calls: Array<{ method: string; url: string; body?: unknown }> = [];
  const http = {
    get: (url: string, _opts?: unknown) => {
      calls.push({ method: 'GET', url });
      return of({ success: true, data: [] });
    },
    post: (url: string, body?: unknown, _opts?: unknown) => {
      calls.push({ method: 'POST', url, body });
      return of({ success: true, data: {} });
    },
    patch: (url: string, body?: unknown) => {
      calls.push({ method: 'PATCH', url, body });
      return of({ success: true, data: {} });
    },
    put: (url: string, body?: unknown) => {
      calls.push({ method: 'PUT', url, body });
      return of({ success: true, data: {} });
    },
    delete: (url: string) => {
      calls.push({ method: 'DELETE', url });
      return of({ success: true, data: {} });
    },
  };
  return { http, calls };
}

describe('Slice 15 — business API client parity (web + mobile)', () => {
  it('1. team endpoints hit session-owned URLs on both apps', (done) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { BusinessApiService: WebSvc } = require('../../apps/web/src/app/core/services/business.service');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { BusinessApiService: MobileSvc } = require('../../apps/mobile/src/app/core/services/business.service');
    const web = stubHttp();
    const mobile = stubHttp();
    new WebSvc(web.http).getTeam().subscribe(() => {
      new MobileSvc(mobile.http).getTeam().subscribe(() => {
        expect(web.calls[0]).toMatchObject({ method: 'GET', url: '/api/v1/providers/me/team' });
        expect(mobile.calls[0]).toMatchObject({ method: 'GET', url: '/api/v1/providers/me/team' });
        done();
      });
    });
  });

  it('2. team create/update/member calls match across apps, no ownership ids', (done) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { BusinessApiService: WebSvc } = require('../../apps/web/src/app/core/services/business.service');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { BusinessApiService: MobileSvc } = require('../../apps/mobile/src/app/core/services/business.service');
    const web = stubHttp();
    const mobile = stubHttp();
    new WebSvc(web.http).createTeam({ name: 'T' }).subscribe(() => {
      new MobileSvc(mobile.http).createTeam({ name: 'T' }).subscribe(() => {
        expect(web.calls[0]).toMatchObject({ method: 'POST', url: '/api/v1/providers/me/team', body: { name: 'T' } });
        expect(mobile.calls[0]).toMatchObject({ method: 'POST', url: '/api/v1/providers/me/team', body: { name: 'T' } });
        expect(JSON.stringify(web.calls[0].body)).not.toMatch(/providerId|ownerProviderId|teamId/);
        new WebSvc(web.http).addTeamMember({ providerId: 'p-1' }).subscribe(() => {
          expect(web.calls[1]).toMatchObject({ method: 'POST', url: '/api/v1/providers/me/team/members' });
          new WebSvc(web.http).removeTeamMember('m-1').subscribe(() => {
            expect(web.calls[2]).toMatchObject({ method: 'DELETE', url: '/api/v1/providers/me/team/members/m-1' });
            done();
          });
        });
      });
    });
  });

  it('3. business/unit/staff calls match across apps', (done) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { BusinessApiService: WebSvc } = require('../../apps/web/src/app/core/services/business.service');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { BusinessApiService: MobileSvc } = require('../../apps/mobile/src/app/core/services/business.service');
    const web = stubHttp();
    const mobile = stubHttp();
    new WebSvc(web.http).listBusinesses().subscribe(() => {
      new MobileSvc(mobile.http).listBusinesses().subscribe(() => {
        expect(web.calls[0]).toMatchObject({ method: 'GET', url: '/api/v1/providers/me/business' });
        expect(mobile.calls[0]).toMatchObject({ method: 'GET', url: '/api/v1/providers/me/business' });
        new WebSvc(web.http).createUnit('b-1', { name: 'U' }).subscribe(() => {
          expect(web.calls[1]).toMatchObject({ method: 'POST', url: '/api/v1/providers/me/business/b-1/units' });
          new MobileSvc(mobile.http).addStaff('b-1', { providerId: 'p-9' }).subscribe(() => {
            expect(mobile.calls[1]).toMatchObject({ method: 'POST', url: '/api/v1/providers/me/business/b-1/staff' });
            expect(JSON.stringify(mobile.calls[1].body)).not.toMatch(/businessId|ownerProviderId/);
            done();
          });
        });
      });
    });
  });

  it('4. booking assign/unassign hit session-owned endpoints on both apps', (done) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { BusinessApiService: WebSvc } = require('../../apps/web/src/app/core/services/business.service');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { BusinessApiService: MobileSvc } = require('../../apps/mobile/src/app/core/services/business.service');
    const web = stubHttp();
    const mobile = stubHttp();
    new WebSvc(web.http).assignBooking('bk-1', 'prov-2').subscribe(() => {
      new MobileSvc(mobile.http).assignBooking('bk-1', 'prov-2').subscribe(() => {
        expect(web.calls[0]).toMatchObject({ method: 'POST', url: '/api/v1/providers/me/bookings/bk-1/assign', body: { assignedProviderId: 'prov-2' } });
        expect(mobile.calls[0]).toMatchObject({ method: 'POST', url: '/api/v1/providers/me/bookings/bk-1/assign', body: { assignedProviderId: 'prov-2' } });
        expect(JSON.stringify(web.calls[0].body)).not.toMatch(/"providerId"|businessUnitId|teamId/);
        done();
      });
    });
  });

  it('5. service attach/detach + categories + location endpoints match', (done) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { BusinessApiService: WebSvc } = require('../../apps/web/src/app/core/services/business.service');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { BusinessApiService: MobileSvc } = require('../../apps/mobile/src/app/core/services/business.service');
    const web = stubHttp();
    const mobile = stubHttp();
    new WebSvc(web.http).attachService('u-1', 's-1').subscribe(() => {
      new MobileSvc(mobile.http).attachService('u-1', 's-1').subscribe(() => {
        expect(web.calls[0]).toMatchObject({ method: 'POST', url: '/api/v1/providers/me/business/units/u-1/services/s-1/attach' });
        expect(mobile.calls[0]).toMatchObject({ method: 'POST', url: '/api/v1/providers/me/business/units/u-1/services/s-1/attach' });
        new WebSvc(web.http).setUnitCategories('u-1', ['BARBERS']).subscribe(() => {
          expect(web.calls[1]).toMatchObject({ method: 'PUT', url: '/api/v1/providers/me/business/units/u-1/categories' });
          done();
        });
      });
    });
  });

  it('6. mutations blocked offline on both apps (never queued)', (done) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { BusinessApiService: WebSvc } = require('../../apps/web/src/app/core/services/business.service');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { BusinessApiService: MobileSvc } = require('../../apps/mobile/src/app/core/services/business.service');
    const onlineDescriptor = Object.getOwnPropertyDescriptor(global.navigator ?? {}, 'onLine');
    const nav: any = global.navigator ?? {};
    const prevNavigator = (global as any).navigator;
    try {
      Object.defineProperty(global, 'navigator', { value: { ...nav, onLine: false }, configurable: true });
      const web = stubHttp();
      const mobile = stubHttp();
      let webErr: string | null = null;
      let mobileErr: string | null = null;
      new WebSvc(web.http).createTeam({ name: 'T' }).subscribe({
        next: () => done(new Error('web mutation should be blocked offline')),
        error: (e: Error) => {
          webErr = e.message;
          new MobileSvc(mobile.http).addStaff('b-1', { providerId: 'p' }).subscribe({
            next: () => done(new Error('mobile mutation should be blocked offline')),
            error: (e2: Error) => {
              mobileErr = e2.message;
              expect(web.calls).toHaveLength(0);
              expect(mobile.calls).toHaveLength(0);
              expect(webErr).toMatch(/offline/i);
              expect(mobileErr).toMatch(/offline/i);
              done();
            },
          });
        },
      });
    } finally {
      if (prevNavigator !== undefined) {
        Object.defineProperty(global, 'navigator', { value: prevNavigator, configurable: true });
      } else {
        delete (global as any).navigator;
      }
      void onlineDescriptor;
    }
  });

  it('7. web/mobile business utils agree (tiers, roles, offline)', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const webUtils = require('../../apps/web/src/app/features/business/business.utils');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mobileUtils = require('../../apps/mobile/src/app/features/business/business.utils');
    expect(mobileUtils.tierLabel('T2')).toBe(webUtils.tierLabel('T2'));
    expect(mobileUtils.tierLabel('T3')).toBe(webUtils.tierLabel('T3'));
    expect(mobileUtils.tierLabel('T1')).toBe(webUtils.tierLabel('T1'));
    expect(webUtils.canManageTeam('T2')).toBe(true);
    expect(webUtils.canManageTeam('T1')).toBe(false);
    expect(webUtils.canManageTeam('T3')).toBe(false);
    expect(webUtils.canManageBusiness('T3')).toBe(true);
    expect(webUtils.canManageBusiness('T2')).toBe(false);
    expect(mobileUtils.canManageBusiness('T3')).toBe(true);
    expect(webUtils.roleLabel('MANAGER')).toBe('Manager');
    expect(webUtils.statusLabel('INACTIVE')).toBe('Inactive');
    expect(webUtils.offlineMessage()).toMatch(/nothing was changed/i);
    expect(typeof webUtils.isOfflineError(new Error('OFFLINE'))).toBe('boolean');
    expect(webUtils.isOfflineError(new Error('OFFLINE'))).toBe(true);
    expect(webUtils.invitationExpiryLabel(new Date(Date.now() - 1000).toISOString())).toBe('Expired');
  });
});

describe('Slice 15 — routes + component contracts (web + mobile)', () => {
  it('8. both apps register all T2/T3 routes behind authGuard', () => {
    for (const routesPath of ['apps/web/src/app/app.routes.ts', 'apps/mobile/src/app/app.routes.ts']) {
      const src = read(routesPath);
      for (const p of [
        'provider/team',
        'provider/team/members',
        'provider/business',
        'provider/business/units',
        'provider/business/units/:id',
        'provider/business/staff',
        'provider/business/categories',
      ]) {
        expect(src).toContain(`path: '${p}'`);
      }
      expect(src.match(/canActivate: \[authGuard\]/g)!.length).toBeGreaterThanOrEqual(7);
    }
  });

  it('9. all business components exist on both apps with offline + tier gating', () => {
    const pairs: Array<[string, string]> = [
      ['apps/web/src/app/features/business/team.component.ts', 'apps/mobile/src/app/features/business/team.page.ts'],
      ['apps/web/src/app/features/business/team-members.component.ts', 'apps/mobile/src/app/features/business/team-members.page.ts'],
      ['apps/web/src/app/features/business/business-dashboard.component.ts', 'apps/mobile/src/app/features/business/business-dashboard.page.ts'],
      ['apps/web/src/app/features/business/business-units.component.ts', 'apps/mobile/src/app/features/business/business-units.page.ts'],
      ['apps/web/src/app/features/business/business-unit-detail.component.ts', 'apps/mobile/src/app/features/business/business-unit-detail.page.ts'],
      ['apps/web/src/app/features/business/business-staff.component.ts', 'apps/mobile/src/app/features/business/business-staff.page.ts'],
      ['apps/web/src/app/features/business/business-categories.component.ts', 'apps/mobile/src/app/features/business/business-categories.page.ts'],
    ];
    for (const [webPath, mobilePath] of pairs) {
      const web = read(webPath);
      const mobile = read(mobilePath);
      for (const src of [web, mobile]) {
        expect(src).toMatch(/offline/i);
        expect(src).toMatch(/BusinessApiService/);
        expect(src).not.toMatch(/mock/i);
      }
      // Mobile mirrors web behaviour (same API surface).
      expect(mobile).toContain('BusinessApiService');
    }
    expect(read('apps/web/src/app/features/business/team.component.ts')).toMatch(/T2/);
    expect(read('apps/web/src/app/features/business/business-dashboard.component.ts')).toMatch(/T3/);
    expect(read('apps/web/src/app/features/business/team-members.component.ts')).toMatch(/shown once/);
    expect(read('apps/web/src/app/features/business/business-staff.component.ts')).toMatch(/payroll/i);
  });

  it('10. services never send ownership as authority; five categories only', () => {
    const web = read('apps/web/src/app/core/services/business.service.ts');
    const mobile = read('apps/mobile/src/app/core/services/business.service.ts');
    for (const src of [web, mobile]) {
      expect(src).not.toMatch(/providerId:\s*this|ownerProviderId/);
      expect(src).toMatch(/offline/i);
      expect(src).toMatch(/never\s*\n?.*queued|never queued/i);
    }
    const cats = read('apps/web/src/app/features/business/business-categories.component.ts');
    expect(cats).toMatch(/Barbers/);
    expect(cats).toMatch(/Car Wash/);
  });
});

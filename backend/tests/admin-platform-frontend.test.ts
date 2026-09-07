/**
 * Slice 16 — Admin Platform frontend contracts (web).
 *
 * Verifies the REAL AdminApiService client against a stub HttpClient
 * (same backend URLs, no ids as authority), the adminGuard role gate,
 * admin route registration on web, explicit absence of an admin console
 * on mobile, offline mutation blocking, and no mock admin data.
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
    get: (url: string, opts?: any) => {
      calls.push({ method: 'GET', url, body: opts?.params });
      return of({ success: true, data: [] });
    },
    post: (url: string, body?: unknown) => {
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

describe('Slice 16 — admin API client + guards + routes', () => {
  it('1. dashboard + lists hit the isolated /admin namespace', (done) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { AdminApiService } = require('../../apps/web/src/app/core/services/admin.service');
    const { http, calls } = stubHttp();
    const api = new AdminApiService(http);
    api.getDashboard().subscribe(() => {
      api.searchUsers({ q: 'a' }).subscribe(() => {
        api.searchProviders({ tier: 'T1' }).subscribe(() => {
          expect(calls[0]).toMatchObject({ method: 'GET', url: '/api/v1/admin/dashboard' });
          expect(calls[1]).toMatchObject({ method: 'GET', url: '/api/v1/admin/users' });
          expect(calls[2]).toMatchObject({ method: 'GET', url: '/api/v1/admin/providers' });
          for (const c of calls) expect(c.url.startsWith('/api/v1/admin/')).toBe(true);
          done();
        });
      });
    });
  });

  it('2. verification + settings + moderation use explicit audited endpoints', (done) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { AdminApiService } = require('../../apps/web/src/app/core/services/admin.service');
    const { http, calls } = stubHttp();
    const api = new AdminApiService(http);
    api.verifyProvider('p-1', 'APPROVE', 'ok').subscribe(() => {
      api.verifyStudent('p-1', 'REJECT').subscribe(() => {
        api.updateSetting('commission_t1_percent', 20, null).subscribe(() => {
          api.moderateMedia('m-1', 'HIDE').subscribe(() => {
            api.revokeInvitation('team', 'i-1').subscribe(() => {
              expect(calls[0]).toMatchObject({ method: 'POST', url: '/api/v1/admin/providers/p-1/verification' });
              expect(calls[0].body).toMatchObject({ action: 'APPROVE' });
              expect(calls[1]).toMatchObject({ method: 'POST', url: '/api/v1/admin/providers/p-1/student-verification' });
              expect(calls[2]).toMatchObject({ method: 'PATCH', url: '/api/v1/admin/settings/commission_t1_percent' });
              expect(calls[3]).toMatchObject({ method: 'PATCH', url: '/api/v1/admin/media/m-1/moderation' });
              expect(calls[4]).toMatchObject({ method: 'POST', url: '/api/v1/admin/invitations/team/i-1/revoke' });
              done();
            });
          });
        });
      });
    });
  });

  it('3. booking/payment/audit reads are GET-only (no client-side transitions)', (done) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { AdminApiService } = require('../../apps/web/src/app/core/services/admin.service');
    const { http, calls } = stubHttp();
    const api = new AdminApiService(http);
    api.searchBookings({ status: 'COMPLETED' }).subscribe(() => {
      api.getBooking('b-1').subscribe(() => {
        api.listPayments({}).subscribe(() => {
          api.getFinanceOverview().subscribe(() => {
            api.listAuditLogs({}).subscribe(() => {
              expect(calls.map((c) => c.method)).toEqual(['GET', 'GET', 'GET', 'GET', 'GET']);
              expect(calls[0].url).toBe('/api/v1/admin/bookings');
              expect(calls[2].url).toBe('/api/v1/admin/payments');
              expect(calls[3].url).toBe('/api/v1/admin/finance/overview');
              expect(calls[4].url).toBe('/api/v1/admin/audit-logs');
              done();
            });
          });
        });
      });
    });
  });

  it('4. offline mutations are blocked, never queued', (done) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { AdminApiService, isAdminOnline } = require('../../apps/web/src/app/core/services/admin.service');
    expect(typeof isAdminOnline()).toBe('boolean');
    const src = read('apps/web/src/app/core/services/admin.service.ts');
    expect(src).toContain('OFFLINE');
    expect(src).toContain('nothing was changed');
    const { http, calls } = stubHttp();
    const api = new AdminApiService(http);
    const nav: any = global.navigator;
    const hadNavigator = typeof navigator !== 'undefined';
    const orig = hadNavigator ? { ...nav } : undefined;
    try {
      (global as any).navigator = { ...(nav ?? {}), onLine: false };
      let errored = '';
      api.updateSetting('commission_t1_percent', 20, null).subscribe({ error: (e: Error) => { errored = e.message; } });
      expect(errored).toMatch(/offline/i);
      expect(calls).toHaveLength(0);
      done();
    } finally {
      if (orig) (global as any).navigator = nav && orig ? Object.assign(nav, orig) : nav;
      else delete (global as any).navigator;
    }
  });

  it('5. adminGuard requires ADMIN role (UX gate; server re-enforces)', () => {
    const guard = read('apps/web/src/app/core/guards/admin.guard.ts');
    expect(guard).toContain("'ADMIN'");
    expect(guard).toContain('/auth/login');
  });

  it('6. web registers all admin sections behind adminGuard', () => {
    const routes = read('apps/web/src/app/app.routes.ts');
    for (const section of ['admin/dashboard', 'admin/users', 'admin/providers', 'admin/businesses', 'admin/bookings', 'admin/finance', 'admin/settings', 'admin/audit', 'admin/ops']) {
      expect(routes).toContain(`path: '${section}'`);
    }
    expect(routes).toContain('adminGuard');
    // Admin pages are operational — never marketplace-styled routes
    expect(routes).not.toContain("path: 'admin/marketplace'");
  });

  it('7. mobile has no admin console (explicit non-goal)', () => {
    const routes = read('apps/mobile/src/app/app.routes.ts');
    expect(routes).not.toContain('/admin');
    expect(routes).not.toContain('AdminApiService');
    expect(routes).not.toContain('adminGuard');
  });

  it('8. admin client sends no ids as authority + no mock data', () => {
    const src = read('apps/web/src/app/core/services/admin.service.ts');
    expect(src).not.toMatch(/providerId\s*:\s*['"]p-/);
    expect(src).not.toContain('MOCK');
    expect(src).toContain('/api/v1/admin/dashboard');
  });

  it('9. admin components confirm destructive actions + show permission errors', () => {
    for (const f of ['admin-users.component.ts', 'admin-providers.component.ts', 'admin-businesses.component.ts', 'admin-settings.component.ts', 'admin-ops.component.ts']) {
      const src = read(`apps/web/src/app/features/admin/${f}`);
      expect(src).toContain('window.confirm');
    }
    const users = read('apps/web/src/app/features/admin/admin-users.component.ts');
    expect(users).toMatch(/password/i);
  });

  it('10. admin UI never renders secrets, hashes, or precise locations', () => {
    const dir = 'apps/web/src/app/features/admin';
    const files = fs.readdirSync(path.join(__dirname, '..', '..', dir)).filter((f) => f.endsWith('.component.ts'));
    expect(files.length).toBeGreaterThanOrEqual(8);
    for (const f of files) {
      const src = read(`${dir}/${f}`);
      expect(src).not.toMatch(/passwordHash/i);
      expect(src).not.toMatch(/webhook[_-]?secret/i);
      expect(src).not.toMatch(/latitude/i);
      expect(src).not.toMatch(/longitude/i);
    }
  });
});

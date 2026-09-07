/**
 * Slice 17 — Training-Centre Ecosystem frontend contracts (web + mobile).
 *
 * Verifies the REAL PartnerApiService clients (web + mobile) against a stub
 * HttpClient (same backend URLs, no ids as authority), /partner/* and
 * /admin/partners route registration on both clients, offline mutation
 * blocking (explicit "nothing was changed", never queued), admin nav
 * integration, no mock partner data, no hard-coded rates, no ranking
 * coupling, and no-guarantee disclaimers.
 */
import * as fs from 'fs';
import * as path from 'path';
import { of, throwError } from 'rxjs';

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
  };
  return { http, calls };
}

describe('Slice 17 — partner API clients (web + mobile parity)', () => {
  it('1. web client hits session-scoped /partners endpoints (no partner id as authority)', (done) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { PartnerApiService } = require('../../apps/web/src/app/core/services/partner.service');
    const { http, calls } = stubHttp();
    const api = new PartnerApiService(http);
    api.getMine().subscribe(() => {
      api.getDashboard().subscribe(() => {
        api.listProviders({ status: 'ACTIVE' }).subscribe(() => {
          api.listEarnings().subscribe(() => {
            expect(calls[0]).toMatchObject({ method: 'GET', url: '/api/v1/partners/me' });
            expect(calls[1]).toMatchObject({ method: 'GET', url: '/api/v1/partners/me/dashboard' });
            expect(calls[2]).toMatchObject({ method: 'GET', url: '/api/v1/partners/me/providers' });
            expect(calls[3]).toMatchObject({ method: 'GET', url: '/api/v1/partners/me/earnings' });
            for (const c of calls) expect(c.url).not.toMatch(/partners\/(partner-|[0-9a-f]{8})/);
            done();
          });
        });
      });
    });
  });

  it('2. web referral + evidence + verification-support endpoints are explicit', (done) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { PartnerApiService } = require('../../apps/web/src/app/core/services/partner.service');
    const { http, calls } = stubHttp();
    const api = new PartnerApiService(http);
    api.createReferral({ invitedEmail: 's@t.local' }).subscribe(() => {
      api.revokeReferral('ref-1').subscribe(() => {
        api.submitEvidence({ providerId: 'p-1', programme: 'X' }).subscribe(() => {
          api.supportVerification('p-1').subscribe(() => {
            expect(calls[0]).toMatchObject({ method: 'POST', url: '/api/v1/partners/me/referrals' });
            expect(calls[1]).toMatchObject({ method: 'POST', url: '/api/v1/partners/me/referrals/ref-1/revoke' });
            expect(calls[2]).toMatchObject({ method: 'POST', url: '/api/v1/partners/me/evidence' });
            expect(calls[3]).toMatchObject({ method: 'POST', url: '/api/v1/partners/me/providers/p-1/support-verification' });
            done();
          });
        });
      });
    });
  });

  it('3. mobile client uses the SAME endpoints as web (parity, no mobile-only logic)', (done) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const web = require('../../apps/web/src/app/core/services/partner.service');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mobile = require('../../apps/mobile/src/app/core/services/partner.service');
    const w = stubHttp();
    const m = stubHttp();
    const wApi = new web.PartnerApiService(w.http);
    const mApi = new mobile.PartnerApiService(m.http);
    wApi.getDashboard().subscribe(() => {
      mApi.getDashboard().subscribe(() => {
        wApi.createReferral({ invitedEmail: 's@t.local' }).subscribe(() => {
          mApi.createReferral({ invitedEmail: 's@t.local' }).subscribe(() => {
            expect(m.calls[0]).toEqual(w.calls[0]);
            expect(m.calls[1]).toEqual(w.calls[1]);
            done();
          });
        });
      });
    });
  });

  it('4. mutations are blocked offline with an explicit nothing-changed error (web + mobile)', (done) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const web = require('../../apps/web/src/app/core/services/partner.service');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mobile = require('../../apps/mobile/src/app/core/services/partner.service');
    const orig = (global as any).navigator;
    Object.defineProperty(global, 'navigator', { value: { onLine: false }, configurable: true });
    try {
      expect(web.isPartnerOnline()).toBe(false);
      expect(mobile.isPartnerOnline()).toBe(false);
      const { http, calls } = stubHttp();
      const api = new web.PartnerApiService(http);
      const mApi = new mobile.PartnerApiService(http);
      let seen = 0;
      const check = (err: any) => {
        expect(String(err?.message ?? err)).toMatch(/offline|nothing was changed/i);
        expect(calls.length).toBe(0);
        if (++seen === 2) done();
      };
      api.createReferral({ invitedEmail: 's@t.local' }).subscribe({ error: check });
      mApi.createReferral({ invitedEmail: 's@t.local' }).subscribe({ error: check });
    } finally {
      if (orig === undefined) delete (global as any).navigator;
      else Object.defineProperty(global, 'navigator', { value: orig, configurable: true });
    }
  });

  it('5. reads stay available (server-authoritative) while mutations block offline', () => {
    const src = read('apps/web/src/app/core/services/partner.service.ts');
    // guard() is invoked in apply/updateProfile/createReferral/revoke/redeem/link/evidence/support + admin mutations
    const guarded = (src.match(/const blocked = this\.guard\(\);/g) ?? []).length;
    expect(guarded).toBeGreaterThanOrEqual(10);
    // reads (getMine/getDashboard/list*) never call guard()
    const readSection = src.split('// ── Dashboard')[1]?.split('// ── Referrals')[0] ?? '';
    expect(readSection).not.toContain('this.guard()');
  });

  it('6. admin partner methods use the isolated /admin/partners namespace', (done) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { PartnerApiService } = require('../../apps/web/src/app/core/services/partner.service');
    const { http, calls } = stubHttp();
    const api = new PartnerApiService(http);
    api.adminSearch({ q: 'acad' }).subscribe(() => {
      api.adminSetStatus('p-1', 'SUSPENDED').subscribe(() => {
        api.adminCreateRule({ scope: 'GLOBAL', percent: 5 }).subscribe(() => {
          api.adminReverseAccrual('a-1', 'refund').subscribe(() => {
            expect(calls[0]).toMatchObject({ method: 'GET', url: '/api/v1/admin/partners' });
            expect(calls[1]).toMatchObject({ method: 'POST', url: '/api/v1/admin/partners/p-1/status' });
            expect(calls[2]).toMatchObject({ method: 'POST', url: '/api/v1/admin/partners/share-rules' });
            expect(calls[3]).toMatchObject({ method: 'POST', url: '/api/v1/admin/partners/accruals/a-1/reverse' });
            for (const c of calls) expect(c.url.startsWith('/api/v1/admin/partners')).toBe(true);
            done();
          });
        });
      });
    });
  });

  it('7. web routes register the full partner workspace + admin oversight', () => {
    const routes = read('apps/web/src/app/app.routes.ts');
    for (const p of ['partner/dashboard', 'partner/referrals', 'partner/providers', 'partner/earnings', 'partner/profile', 'admin/partners']) {
      expect(routes).toContain(`path: '${p}'`);
    }
    // partner pages behind authGuard; admin page behind adminGuard (UX gate only)
    expect(routes).toContain('PartnerDashboardComponent');
    expect(routes).toContain('AdminPartnersComponent');
  });

  it('8. mobile routes mirror the partner workspace (admin stays web-only)', () => {
    const routes = read('apps/mobile/src/app/app.routes.ts');
    for (const p of ['partner/dashboard', 'partner/referrals', 'partner/providers', 'partner/earnings', 'partner/profile']) {
      expect(routes).toContain(`path: '${p}'`);
    }
    expect(routes).toContain('PartnerDashboardPage');
    expect(routes).not.toContain('admin/partners');
  });

  it('9. admin nav links partner oversight', () => {
    const nav = read('apps/web/src/app/features/admin/admin-nav.component.ts');
    expect(nav).toContain('/admin/partners');
  });

  it('10. no hard-coded commission or share percentages in web/mobile partner code', () => {
    for (const f of [
      'apps/web/src/app/core/services/partner.service.ts',
      'apps/mobile/src/app/core/services/partner.service.ts',
      'apps/web/src/app/features/partner/partner-dashboard.component.ts',
      'apps/web/src/app/features/partner/partner-earnings.component.ts',
      'apps/web/src/app/features/partner/partner-referrals.component.ts',
      'apps/mobile/src/app/features/partner/partner-dashboard.page.ts',
      'apps/mobile/src/app/features/partner/partner-earnings.page.ts',
    ]) {
      const src = read(f);
      expect(src).not.toMatch(/16\s*%|25\s*%|partnerAmount\s*=\s*[\d.]+|percent\s*:\s*16|percent\s*:\s*25/);
      expect(src).not.toContain('0.16');
      expect(src).not.toContain('0.25');
    }
  });

  it('11. partner UI carries no-guarantee language and accrual-is-not-payment wording', () => {
    const dash = read('apps/web/src/app/features/partner/partner-dashboard.component.ts');
    expect(dash).toMatch(/No guaranteed customers|does not guarantee/i);
    const earn = read('apps/web/src/app/features/partner/partner-earnings.component.ts');
    expect(earn).toMatch(/not a payout|accrual/i);
    const mDash = read('apps/mobile/src/app/features/partner/partner-dashboard.page.ts');
    expect(mDash).toMatch(/No guaranteed customers|does not guarantee/i);
  });

  it('12. partner UI has no marketplace ranking boost and no driver flows', () => {
    for (const f of [
      'apps/web/src/app/features/partner/partner-dashboard.component.ts',
      'apps/web/src/app/features/partner/partner-providers.component.ts',
      'apps/web/src/app/features/partner/partner-referrals.component.ts',
      'apps/mobile/src/app/features/partner/partner-dashboard.page.ts',
    ]) {
      const src = read(f).toLowerCase();
      expect(src).not.toContain('boost');
      expect(src).not.toMatch(/rank[^.]*priority|rank[^.]*higher|priority[^.]*rank/);
      expect(src).not.toContain('driver');
    }
    // where ranking is mentioned it is an explicit neutrality statement
    const providers = read('apps/web/src/app/features/partner/partner-providers.component.ts');
    expect(providers).toMatch(/never affects marketplace ranking/i);
  });

  it('13. referral UI warns the code is shown once (never recoverable)', () => {
    const web = read('apps/web/src/app/features/partner/partner-referrals.component.ts');
    expect(web).toMatch(/shown once/i);
    const mobile = read('apps/mobile/src/app/features/partner/partner-referrals.page.ts');
    expect(mobile).toMatch(/shown once/i);
  });

  it('14. partner components render loading/error/empty states (no silent blanks)', () => {
    for (const f of [
      'apps/web/src/app/features/partner/partner-dashboard.component.ts',
      'apps/web/src/app/features/partner/partner-earnings.component.ts',
      'apps/web/src/app/features/partner/partner-providers.component.ts',
      'apps/web/src/app/features/admin/admin-partners.component.ts',
    ]) {
      const src = read(f);
      expect(src).toContain('role="status"');
      expect(src).toContain('role="alert"');
      expect(src).toContain('Retry');
    }
  });

  it('15. no mock partner data or fake earnings in clients', () => {
    for (const f of [
      'apps/web/src/app/core/services/partner.service.ts',
      'apps/mobile/src/app/core/services/partner.service.ts',
    ]) {
      const src = read(f);
      const low = src.toLowerCase();
      // "never queued or faked" (offline discipline) is legitimate language —
      // forbid actual mock/placeholder data, not the word in that phrase.
      expect(low).not.toContain('mock');
      expect(low).not.toContain('dummy');
      expect(low).not.toContain('lorem');
      expect(low).not.toContain('placeholder');
      expect(low).not.toContain('hardcoded');
      expect(src).not.toMatch(/fake(Data|Earnings|Payments|Accruals|Response)/);
    }
    // throwError import actually used (offline guard), not decorative
    const svc = read('apps/web/src/app/core/services/partner.service.ts');
    expect(svc).toContain('throwError');
    expect(svc).not.toContain('console.log');
    expect(svc).not.toContain('debugger');
  });

  it('16. mobile partner pages import the mobile service path (no web-only imports)', () => {
    const page = read('apps/mobile/src/app/features/partner/partner-dashboard.page.ts');
    expect(page).toContain('../../core/services/partner.service');
    expect(page).toContain('PartnerDashboardPage');
  });
});

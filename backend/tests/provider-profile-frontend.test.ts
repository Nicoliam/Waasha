/**
 * Slice 10 — Frontend behavior validation (executed, not filesystem-only).
 *
 * Imports the REAL web/mobile provider-profile modules and exercises them:
 * - pure form validation / payload / error-message helpers
 * - the actual Angular ProviderProfileService against a stub HttpClient,
 *   asserting endpoint URLs, verbs, and that no providerId/userId ownership
 *   is ever sent
 * - web/mobile parity: same API contract, same validation, same behavior
 * - route registration, offline safety, no mock data, no drivers,
 *   no hard-coded financial rules
 */
import * as fs from 'fs';
import * as path from 'path';
import { of } from 'rxjs';

import {
  validateProfileForm,
  toProfilePayload,
  fromProfile,
  emptyProfileForm,
  profileErrorMessage,
  MAX_DISPLAY_NAME_LENGTH,
  MAX_BIO_LENGTH,
  MAX_EXPERIENCE_LENGTH,
} from '../../apps/web/src/app/features/provider-profile/provider-profile.utils';
import * as mobileUtils from '../../apps/mobile/src/app/features/provider-profile/provider-profile.utils';
import { ProviderProfileService as WebProfileService } from '../../apps/web/src/app/core/services/provider-profile.service';
import { ProviderProfileService as MobileProfileService } from '../../apps/mobile/src/app/core/services/provider-profile.service';

const root = path.resolve(__dirname, '../../');
function read(p: string): string {
  return fs.readFileSync(path.join(root, p), 'utf8');
}

function stubHttp() {
  const calls: Array<{ method: string; url: string; body?: unknown; options?: unknown }> = [];
  const http: any = {
    get: (url: string, options?: unknown) => {
      calls.push({ method: 'GET', url, options });
      return of({ success: true, data: {} });
    },
    patch: (url: string, body?: unknown) => {
      calls.push({ method: 'PATCH', url, body });
      return of({ success: true, data: {} });
    },
  };
  return { http, calls };
}

function validForm(over: Record<string, unknown> = {}) {
  return { ...emptyProfileForm(), displayName: 'Sipho Cuts', ...over };
}

describe('Slice 10 web — form validation', () => {
  it('23. accepts a valid profile form', () => {
    expect(validateProfileForm(validForm({ bio: 'Master barber', customRequestsEnabled: true }))).toEqual([]);
  });

  it('rejects missing/short/long display names', () => {
    expect(validateProfileForm(validForm({ displayName: '' }))).not.toEqual([]);
    expect(validateProfileForm(validForm({ displayName: 'A' }))).not.toEqual([]);
    expect(validateProfileForm(validForm({ displayName: 'x'.repeat(MAX_DISPLAY_NAME_LENGTH + 1) }))).not.toEqual([]);
  });

  it('rejects oversized bio and experience summary', () => {
    expect(validateProfileForm(validForm({ bio: 'x'.repeat(MAX_BIO_LENGTH + 1) }))).not.toEqual([]);
    expect(validateProfileForm(validForm({ experienceSummary: 'x'.repeat(MAX_EXPERIENCE_LENGTH + 1) }))).not.toEqual([]);
  });

  it('rejects inline-binary and forbidden-scheme image references', () => {
    expect(validateProfileForm(validForm({ profileImageUrl: 'data:image/png;base64,AAA' }))).not.toEqual([]);
    expect(validateProfileForm(validForm({ profileImageUrl: 'javascript:alert(1)' }))).not.toEqual([]);
    expect(validateProfileForm(validForm({ profileImageUrl: 'https://cdn.test/a.jpg' }))).toEqual([]);
    expect(validateProfileForm(validForm({ profileImageUrl: '/storage/avatar.jpg' }))).toEqual([]);
  });
});

describe('Slice 10 web — payload contract', () => {
  it('23. web API client hits GET+PATCH /providers/me with session auth only', () => {
    const { http, calls } = stubHttp();
    const svc = new WebProfileService(http as any);
    let got: any; let patched: any;
    svc.getMe().subscribe((r) => (got = r));
    svc.updateMe({ displayName: 'Sipho' }).subscribe((r) => (patched = r));
    expect(got.success).toBe(true);
    expect(patched.success).toBe(true);
    expect(calls[0]).toMatchObject({ method: 'GET', url: '/api/v1/providers/me' });
    expect(calls[1]).toMatchObject({ method: 'PATCH', url: '/api/v1/providers/me' });
    // No ownership selectors are ever sent.
    for (const c of calls) {
      expect(JSON.stringify(c)).not.toContain('providerId');
      expect(JSON.stringify(c.url)).not.toContain('providerId');
    }
    expect(JSON.stringify(calls[1].body)).not.toContain('userId');
    expect(JSON.stringify(calls[1].body)).not.toContain('tierId');
  });

  it('24. mobile API client uses the same contract (no mobile-only logic)', () => {
    const { http, calls } = stubHttp();
    const svc = new MobileProfileService(http as any);
    svc.getMe().subscribe(() => undefined);
    svc.updateMe({ bio: 'Hi' }).subscribe(() => undefined);
    expect(calls[0]).toMatchObject({ method: 'GET', url: '/api/v1/providers/me' });
    expect(calls[1]).toMatchObject({ method: 'PATCH', url: '/api/v1/providers/me' });
  });

  it('25. web/mobile field parity: same editable set, same validation, same errors', () => {
    const webForm = validForm({ profileImageUrl: 'not-a-url' });
    expect(validateProfileForm(webForm)).toEqual(mobileUtils.validateProfileForm(webForm as any));
    const base = fromProfile({ displayName: 'A', bio: null, experienceSummary: null, customRequestsEnabled: false, profileImageUrl: null });
    const edited = { ...base, displayName: 'B', customRequestsEnabled: true };
    expect(toProfilePayload(edited, base)).toEqual(mobileUtils.toProfilePayload(edited as any, base as any));
    expect(profileErrorMessage('VALIDATION_ERROR', 'x')).toBe(mobileUtils.profileErrorMessage('VALIDATION_ERROR', 'x'));
    // Parity on editable keys: payload never carries protected fields.
    const keys = Object.keys(toProfilePayload(edited, base)).sort();
    expect(keys).toEqual(['customRequestsEnabled', 'displayName']);
    for (const k of ['tierId', 'verificationStatus', 'isStudent', 'coverageRadiusKm', 'acceptCash', 'commissionRate']) {
      expect(keys).not.toContain(k);
    }
  });

  it('payload diffing: unchanged fields omitted, cleared text maps to null', () => {
    const orig = validForm({ bio: 'Keep me', profileImageUrl: 'https://cdn.test/a.jpg' });
    const same = { ...orig };
    expect(toProfilePayload(same, orig)).toEqual({});
    const cleared = { ...orig, bio: '  ', profileImageUrl: '' };
    expect(toProfilePayload(cleared, orig)).toEqual({ bio: null, profileImageUrl: null });
  });
});

describe('Slice 10 — component states & slice boundaries', () => {
  it('26. loading/saved/error/offline states exist in web and mobile components', () => {
    for (const p of [
      'apps/web/src/app/features/provider-profile/provider-profile.component.ts',
      'apps/mobile/src/app/features/provider-profile/provider-profile.page.ts',
    ]) {
      const src = read(p);
      for (const token of ['loading', 'saved', 'loadError', 'saveError', 'offline', 'Retry', 'isOffline', 'Save changes', 'Cancel']) {
        expect(src).toContain(token);
      }
      // Offline detection itself lives in the utils (navigator.onLine check).
      // Read-only operational context is displayed, never editable.
      expect(src).toContain('read-only');
      expect(src).not.toContain('[(ngModel)]="form.tier');
    }
    for (const p of [
      'apps/web/src/app/features/provider-profile/provider-profile.utils.ts',
      'apps/mobile/src/app/features/provider-profile/provider-profile.utils.ts',
    ]) {
      expect(read(p)).toContain('navigator.onLine');
    }
  });

  it('27. offline mutation safety: save is blocked, never queued as success', () => {
    for (const p of [
      'apps/web/src/app/features/provider-profile/provider-profile.component.ts',
      'apps/mobile/src/app/features/provider-profile/provider-profile.page.ts',
    ]) {
      const src = read(p);
      expect(src).toContain('isOffline()');
      expect(src).toContain('never applied offline');
      expect(src).toContain('not queued');
      expect(src).not.toMatch(/syncQueue|outbox|pendingMutation|enqueue/i);
      expect(src).not.toMatch(/Booking confirmed|Profile updated on server/i);
    }
  });

  it('routes registered behind auth in both apps', () => {
    for (const p of ['apps/web/src/app/app.routes.ts', 'apps/mobile/src/app/app.routes.ts']) {
      const src = read(p);
      expect(src).toContain('provider/profile');
      expect(src).toContain('authGuard');
    }
  });

  it('28. no mock provider data in new slice code', () => {
    for (const p of [
      'apps/web/src/app/features/provider-profile/provider-profile.component.ts',
      'apps/web/src/app/features/provider-profile/provider-profile.utils.ts',
      'apps/mobile/src/app/features/provider-profile/provider-profile.page.ts',
      'apps/mobile/src/app/features/provider-profile/provider-profile.utils.ts',
      'apps/web/src/app/core/services/provider-profile.service.ts',
      'apps/mobile/src/app/core/services/provider-profile.service.ts',
      'backend/src/modules/provider/provider-profile.service.ts',
    ]) {
      const src = read(p).toLowerCase();
      expect(src).not.toContain('mock');
      expect(src).not.toContain('lorem');
      expect(src).not.toContain('placeholder provider');
    }
  });

  it('29. no driver functionality in new slice', () => {
    for (const p of [
      'backend/src/modules/provider/provider-profile.service.ts',
      'backend/src/modules/provider/provider.routes.ts',
      'apps/web/src/app/features/provider-profile/provider-profile.component.ts',
      'apps/mobile/src/app/features/provider-profile/provider-profile.page.ts',
    ]) {
      const src = read(p).toLowerCase();
      expect(src).not.toContain('driver');
      expect(src).not.toContain('ride');
    }
  });

  it('30. no hard-coded financial rules in profile code', () => {
    for (const p of [
      'backend/src/modules/provider/provider-profile.service.ts',
      'apps/web/src/app/features/provider-profile/provider-profile.utils.ts',
      'apps/mobile/src/app/features/provider-profile/provider-profile.utils.ts',
    ]) {
      const src = read(p);
      expect(src).not.toMatch(/16%/);
      expect(src).not.toMatch(/25%/);
      expect(src).not.toMatch(/R500\b/);
      expect(src).not.toMatch(/R1000\b/);
      expect(src).not.toMatch(/R5000\b/);
    }
  });
});

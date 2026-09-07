/**
 * Slice 9 — Frontend behavior validation (executed, not filesystem-only).
 *
 * Imports the REAL web/mobile provider-service modules and exercises them:
 * - pure list-mapping / editor-validation / payload / error-message helpers
 * - the actual Angular ProviderServicesService against a stub HttpClient,
 *   asserting endpoint URLs, session-based auth (no providerId), and verbs
 * - web/mobile parity: same API contract, same validation, same behavior
 * - route registration in both apps
 */
import * as fs from 'fs';
import * as path from 'path';
import { of } from 'rxjs';

import {
  toSummary,
  filterServices,
  statusLabel,
  priceLabel,
  durationLabel,
  serviceModeLabel,
  validateEditor,
  toPayload,
  fromDetail,
  serviceErrorMessage,
  emptyEditor,
  MAX_SERVICE_IMAGES,
} from '../../apps/web/src/app/features/provider-services/provider-services.utils';
import * as mobileUtils from '../../apps/mobile/src/app/features/provider-services/provider-services.utils';
import { ProviderServicesService as WebServicesService } from '../../apps/web/src/app/core/services/provider-services.service';
import { ProviderServicesService as MobileServicesService } from '../../apps/mobile/src/app/core/services/provider-services.service';

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

function rawService(over: Record<string, unknown> = {}) {
  return {
    id: 'svc-1',
    uuid: 'uuid-1',
    name: 'Classic fade',
    description: 'Clean fade',
    price: 150,
    currency: 'ZAR',
    durationMinutes: 30,
    serviceMode: 'BOTH',
    status: 'ACTIVE',
    category: { id: 'c1', code: 'BARBERS', name: 'Barbers' },
    images: [{ id: 'i1', imageUrl: 'https://cdn.test/a.jpg', sortOrder: 0 }],
    ...over,
  };
}

describe('Slice 9 web — service list mapping', () => {
  it('maps backend DTO to summary with active flag and capped images', () => {
    const s = toSummary(rawService({ images: [1, 2, 3, 4].map((i) => ({ id: `i${i}`, imageUrl: `https://c/${i}`, sortOrder: i })) }));
    expect(s.id).toBe('svc-1');
    expect(s.isActive).toBe(true);
    expect(s.images).toHaveLength(MAX_SERVICE_IMAGES);
    expect(s.category?.name).toBe('Barbers');
  });

  it('PAUSED maps to inactive', () => {
    expect(toSummary(rawService({ status: 'PAUSED' })).isActive).toBe(false);
  });

  it('filters active/inactive/all', () => {
    const list = [toSummary(rawService({ id: 'a', status: 'ACTIVE' })), toSummary(rawService({ id: 'b', status: 'PAUSED' }))];
    expect(filterServices(list, 'active').map((s) => s.id)).toEqual(['a']);
    expect(filterServices(list, 'inactive').map((s) => s.id)).toEqual(['b']);
    expect(filterServices(list, 'all')).toHaveLength(2);
  });

  it('labels: status, price, duration, mode', () => {
    expect(statusLabel('ACTIVE')).toBe('Active');
    expect(statusLabel('PAUSED')).toBe('Inactive');
    expect(priceLabel(150, 'ZAR')).toBe('R150.00');
    expect(durationLabel(30)).toBe('30 min');
    expect(durationLabel(90)).toBe('1 hr 30 min');
    expect(serviceModeLabel('BOTH')).toContain('customer');
  });
});

describe('Slice 9 web — editor validation', () => {
  it('accepts a valid model', () => {
    const m = { ...emptyEditor(), name: 'Fade', serviceCategoryId: 'c1', price: '150', durationMinutes: '30' };
    expect(validateEditor(m)).toEqual([]);
  });

  it('rejects missing name, bad price, bad duration, bad mode, too many images', () => {
    const m = {
      ...emptyEditor(),
      name: ' ',
      serviceCategoryId: '',
      price: '-5',
      durationMinutes: '0',
      serviceMode: 'NOPE',
      images: ['a', 'b', 'c', 'd'],
    };
    const errors = validateEditor(m);
    expect(errors.length).toBeGreaterThanOrEqual(5);
  });

  it('rejects 3-decimal price and non-ZAR currency', () => {
    const m = { ...emptyEditor(), name: 'Fade', serviceCategoryId: 'c1', price: '10.999', currency: 'USD', durationMinutes: '30' };
    const errors = validateEditor(m);
    expect(errors.join('|')).toMatch(/2 decimal/);
    expect(errors.join('|')).toMatch(/ZAR/);
  });

  it('rejects inline data-URI images (no fake upload success)', () => {
    const m = { ...emptyEditor(), name: 'Fade', serviceCategoryId: 'c1', price: '10', durationMinutes: '30', images: ['data:image/png;base64,AAA'] };
    expect(validateEditor(m).join('|')).toMatch(/storage reference/);
  });

  it('payload strips mass-assignment surface and trims', () => {
    const m = { ...emptyEditor(), name: '  Fade ', description: '', serviceCategoryId: 'c1', price: '150.5', durationMinutes: '45' };
    const p = toPayload(m) as any;
    expect(p.name).toBe('Fade');
    expect(p.price).toBe(150.5);
    expect(p).not.toHaveProperty('providerId');
    expect(p.images).toEqual([]);
  });

  it('round-trips detail into editor model', () => {
    const m = fromDetail(rawService({ status: 'PAUSED', updatedAt: '2026-01-02T00:00:00.000Z' }));
    expect(m.name).toBe('Classic fade');
    expect(m.isActive).toBe(false);
    expect(m.serviceCategoryId).toBe('c1');
    expect(m.expectedUpdatedAt).toBe('2026-01-02T00:00:00.000Z');
  });

  it('error messages are provider-safe', () => {
    expect(serviceErrorMessage('SERVICE_HAS_BOOKINGS', 'x')).toMatch(/Deactivate/);
    expect(serviceErrorMessage('SERVICE_CONFLICT', 'x')).toMatch(/Reload/);
    expect(serviceErrorMessage('BOGUS_CODE', 'fallback')).toBe('fallback');
  });
});

describe('Slice 9 web — API contract (session auth, correct verbs)', () => {
  it('list/get/create/replace/patch/delete hit /providers/me/services with no providerId', async () => {
    const { http, calls } = stubHttp();
    const svc = new WebServicesService(http as any);
    const awaited = <T>(o: any): Promise<T> => new Promise((resolve) => (o as any).subscribe((v: T) => resolve(v)));
    await awaited(svc.list({ status: 'ACTIVE', page: 1 }));
    await awaited(svc.getDetail('svc-1'));
    await awaited(svc.create({ name: 'n', serviceCategoryId: 'c1', price: 1, durationMinutes: 30, serviceMode: 'BOTH' }));
    await awaited(svc.replace('svc-1', { name: 'n', serviceCategoryId: 'c1', price: 1, durationMinutes: 30, serviceMode: 'BOTH' }));
    await awaited(svc.update('svc-1', { price: 2 }));
    await awaited(svc.setActive('svc-1', false));
    await awaited(svc.remove('svc-1'));
    const verbs = calls.map((c) => c.method);
    expect(verbs).toEqual(['GET', 'GET', 'POST', 'PUT', 'PATCH', 'PATCH', 'DELETE']);
    expect(calls[0].url).toBe('/api/v1/providers/me/services');
    expect(calls[1].url).toBe('/api/v1/providers/me/services/svc-1');
    for (const c of calls) {
      expect(c.url).toContain('/api/v1/providers/me/services');
      expect(JSON.stringify(c.body ?? {})).not.toContain('providerId');
    }
    const setActive = calls[5];
    expect(setActive.body).toEqual({ isActive: false });
  });
});

describe('Slice 9 — web/mobile parity', () => {
  it('same validation semantics', () => {
    const m = { ...emptyEditor(), name: '', serviceCategoryId: '', price: 'x', durationMinutes: '0' };
    expect((mobileUtils as any).validateEditor(m).length).toBe((validateEditor(m as any) as string[]).length);
    expect((mobileUtils as any).MAX_SERVICE_IMAGES).toBe(MAX_SERVICE_IMAGES);
  });

  it('same mapping and error behavior', () => {
    expect((mobileUtils as any).toSummary(rawService()).id).toBe(toSummary(rawService()).id);
    expect((mobileUtils as any).serviceErrorMessage('SERVICE_CONFLICT', 'f')).toBe(serviceErrorMessage('SERVICE_CONFLICT', 'f'));
    expect((mobileUtils as any).priceLabel(150, 'ZAR')).toBe(priceLabel(150, 'ZAR'));
  });

  it('same service API contract', async () => {
    const web = stubHttp();
    const mobile = stubHttp();
    const w = new WebServicesService(web.http as any);
    const mo = new MobileServicesService(mobile.http as any);
    const awaited = (o: any): Promise<unknown> => new Promise((resolve) => (o as any).subscribe((v: unknown) => resolve(v)));
    await awaited(w.list());
    await awaited(mo.list());
    await awaited(w.create({ name: 'n', serviceCategoryId: 'c1', price: 1, durationMinutes: 30, serviceMode: 'BOTH' }));
    await awaited(mo.create({ name: 'n', serviceCategoryId: 'c1', price: 1, durationMinutes: 30, serviceMode: 'BOTH' }));
    expect(mobile.calls.map((c) => `${c.method} ${c.url}`)).toEqual(web.calls.map((c) => `${c.method} ${c.url}`));
  });

  it('both apps register provider service routes', () => {
    const webRoutes = read('apps/web/src/app/app.routes.ts');
    const mobileRoutes = read('apps/mobile/src/app/app.routes.ts');
    for (const content of [webRoutes, mobileRoutes]) {
      expect(content).toContain('provider/services');
      expect(content).toContain('provider/services/new');
      expect(content).toContain('provider/services/:serviceId');
    }
  });

  it('both apps render safe states (no unsanitized innerHTML in new screens)', () => {
    const files = [
      'apps/web/src/app/features/provider-services/provider-services.component.ts',
      'apps/web/src/app/features/provider-services/provider-service-editor.component.ts',
      'apps/mobile/src/app/features/provider-services/provider-services.page.ts',
      'apps/mobile/src/app/features/provider-services/provider-service-editor.page.ts',
    ];
    for (const f of files) {
      const content = read(f);
      expect(content).not.toContain('innerHTML');
      expect(content).toMatch(/loading|Loading/);
      expect(content).toMatch(/offline|Offline/);
    }
  });
});

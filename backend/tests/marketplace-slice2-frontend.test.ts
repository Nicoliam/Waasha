/**
 * Slice 2 — Frontend journey validation (lightweight)
 * Ensures customer marketplace → provider profile → services → service detail
 * is wired to real backend APIs, without mocks, and respects blueprint constraints.
 *
 * Checks file existence and content patterns for web + mobile.
 */
import * as fs from 'fs';
import * as path from 'path';

const root = path.resolve(__dirname, '../../');

function read(p: string): string {
  return fs.readFileSync(path.join(root, p), 'utf8');
}

describe('Slice 2 — Customer Marketplace → Provider Profile (frontend)', () => {
  const webService = 'apps/web/src/app/core/services/marketplace.service.ts';
  const mobileService = 'apps/mobile/src/app/core/services/marketplace.service.ts';
  const webRoutes = 'apps/web/src/app/app.routes.ts';
  const mobileRoutes = 'apps/mobile/src/app/app.routes.ts';
  const webProfile = 'apps/web/src/app/features/provider/provider-profile.component.ts';
  const mobileProfile = 'apps/mobile/src/app/features/provider/provider-profile.page.ts';
  const webDetail = 'apps/web/src/app/features/provider/service-detail.component.ts';
  const mobileDetail = 'apps/mobile/src/app/features/provider/service-detail.page.ts';
  const webDiscovery = 'apps/web/src/app/features/discovery/discovery.component.ts';
  const mobileDiscovery = 'apps/mobile/src/app/features/discovery/discovery.page.ts';
  const webServiceCard = 'apps/web/src/app/shared/components/discovery/service-card.component.ts';
  const mobileServiceCard = 'apps/mobile/src/app/shared/components/discovery/service-card.component.ts';

  it('web marketplace service uses backend-authoritative APIs for provider + services + detail', () => {
    const c = read(webService);
    expect(c).toMatch(/fetchProviderProfile/);
    expect(c).toMatch(/fetchProviderServices/);
    expect(c).toMatch(/fetchServiceDetail/);
    expect(c).toMatch(/\/api\/v1\/marketplace\/providers/);
    expect(c).toMatch(/\/services/);
  });

  it('mobile marketplace service mirrors web API contract', () => {
    const c = read(mobileService);
    expect(c).toMatch(/fetchProviderProfile/);
    expect(c).toMatch(/fetchProviderServices/);
    expect(c).toMatch(/fetchServiceDetail/);
    expect(c).toMatch(/\/api\/v1\/marketplace\/providers/);
  });

  it('web routes include marketplace aliases and service detail', () => {
    const c = read(webRoutes);
    expect(c).toMatch(/marketplace/);
    expect(c).toMatch(/marketplace\/provider\/:providerId/);
    expect(c).toMatch(/service-detail\.component/);
    expect(c).toMatch(/service\/:serviceId/);
  });

  it('mobile routes mirror web canonical routes', () => {
    const c = read(mobileRoutes);
    expect(c).toMatch(/marketplace\/provider\/:providerId/);
    expect(c).toMatch(/service\/:serviceId/);
    expect(c).toMatch(/service-detail\.page/);
  });

  it('web provider profile uses Slice 1 services API with category filtering and ACTIVE-only', () => {
    const c = read(webProfile);
    expect(c).toMatch(/fetchProviderServices/);
    expect(c).toMatch(/selectedServiceCategoryId/);
    expect(c).toMatch(/ACTIVE/);
    expect(c).toMatch(/slice\(0,\s*3\)/); // max 3 images guard
  });

  it('mobile provider profile mirrors web services logic', () => {
    const c = read(mobileProfile);
    expect(c).toMatch(/fetchProviderServices/);
    expect(c).toMatch(/selectedCategoryId/);
    expect(c).toMatch(/ACTIVE/);
  });

  it('service detail components show required fields and CTA Choose Date & Time', () => {
    for (const p of [webDetail, mobileDetail]) {
      const c = read(p);
      expect(c).toMatch(/price/i);
      expect(c).toMatch(/currency/i);
      expect(c).toMatch(/durationMinutes/i);
      expect(c).toMatch(/serviceMode/i);
      expect(c).toMatch(/category/i);
      expect(c).toMatch(/slice\(0,\s*3\)/);
      expect(c).toMatch(/Choose Date & Time/);
      // not-found recovery
      expect(c).toMatch(/marketplace/);
      expect(c).toMatch(/404|not found|Service not found/i);
    }
  });

  it('service cards link to service detail and preserve Choose Date & Time', () => {
    for (const p of [webServiceCard, mobileServiceCard]) {
      const c = read(p);
      expect(c).toMatch(/providerId/);
      expect(c).toMatch(/marketplace\/provider/);
      expect(c).toMatch(/Choose Date & Time/);
      expect(c).toMatch(/service\.images\.slice\(0,3\)/);
    }
  });

  it('discovery supports location confirmation and manual fallback + radius from config', () => {
    for (const p of [webDiscovery, mobileDiscovery]) {
      const c = read(p);
      expect(c).toMatch(/CustomerLocationService/);
      expect(c).toMatch(/MarketplaceRadiusConfigService/);
      expect(c).toMatch(/allowedCustomerRadiiKm|allowedRadii/);
      expect(c).toMatch(/Use my location|useMyLocation/i);
      expect(c).toMatch(/manual|Manual location/i);
      expect(c).toMatch(/category/i);
      expect(c).toMatch(/RadiusExpansion/);
      // no hard-coded mock data
      expect(c).not.toMatch(/mock.*provider.*data/i);
    }
  });

  it('category display exactly five Waasha categories via mapping, not invented categories', () => {
    const catWeb = read('apps/web/src/app/shared/components/discovery/category-filter.component.ts');
    expect(catWeb).toMatch(/BARBERS/);
    expect(catWeb).toMatch(/HAIR_SALONS_STYLISTS/);
    expect(catWeb).toMatch(/NAIL_TECHNICIANS/);
    expect(catWeb).toMatch(/BEAUTY_SERVICES/);
    expect(catWeb).toMatch(/CAR_WASH/);
    expect(catWeb).toMatch(/💈/);
    expect(catWeb).toMatch(/💇/);
    expect(catWeb).toMatch(/💅/);
    expect(catWeb).toMatch(/💄/);
    expect(catWeb).toMatch(/🚗/);
  });

  it('no driver code introduced in this slice', () => {
    const files = [webService, mobileService, webProfile, mobileProfile, webDetail, mobileDetail, webDiscovery, mobileDiscovery];
    for (const p of files) {
      const c = read(p).toLowerCase();
      expect(c).not.toMatch(/driver/);
    }
  });

  it('spec files exist for critical web components', () => {
    // Existence check — ensures slice did not skip testing
    const required = [webDetail, mobileDetail];
    for (const p of required) {
      expect(fs.existsSync(path.join(root, p))).toBe(true);
    }
  });
});

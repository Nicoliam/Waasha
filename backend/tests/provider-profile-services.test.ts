/**
 * Phase 2 Slice 1 — Provider profile + services read API
 * Validates: auth, ownership, public/private, category relationships, pagination, max 3 images, error shapes
 */
import request from 'supertest';
import jwt from 'jsonwebtoken';

function token(payload: { sub: string; roles?: string[] }) {
  const secret = process.env.JWT_SECRET ?? 'dev-jwt-secret-change-me';
  return jwt.sign(
    { uuid: payload.sub, email: `${payload.sub}@test.local`, ...payload },
    secret,
    { expiresIn: '1h', issuer: 'waasha', audience: 'waasha-app' } as any,
  );
}

const mockAdminSettingFindMany = jest.fn();
const mockServiceCategoryFindUnique = jest.fn();
const mockServiceCategoryFindMany = jest.fn();
const mockProviderProfileFindUnique = jest.fn();
const mockServiceCount = jest.fn();
const mockServiceFindMany = jest.fn();
const mockServiceFindUnique = jest.fn();
const mockBusinessFindMany = jest.fn();
const mockBusinessUnitFindMany = jest.fn();
const mockProviderLocationFindFirst = jest.fn();
const mockReviewAggregate = jest.fn();
const mockReviewFindMany = jest.fn();
const mockAvailabilityFindFirst = jest.fn();
const mockUserFindUnique = jest.fn();

jest.mock('../src/config/prisma', () => ({
  prisma: {
    adminSetting: { findMany: mockAdminSettingFindMany },
    serviceCategory: { findMany: mockServiceCategoryFindMany, findUnique: mockServiceCategoryFindUnique },
    providerProfile: { findUnique: mockProviderProfileFindUnique },
    providerLocation: { findFirst: mockProviderLocationFindFirst, findMany: jest.fn().mockResolvedValue([]) },
    service: { count: mockServiceCount, findMany: mockServiceFindMany, findUnique: mockServiceFindUnique, findFirst: jest.fn().mockResolvedValue(null) },
    business: { findMany: mockBusinessFindMany },
    businessUnit: { findMany: mockBusinessUnitFindMany },
    review: { aggregate: mockReviewAggregate, findMany: mockReviewFindMany, groupBy: jest.fn().mockResolvedValue([]) },
    availabilityRule: { findFirst: mockAvailabilityFindFirst },
    user: { findUnique: mockUserFindUnique },
    $queryRaw: jest.fn().mockResolvedValue([1]),
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  },
}));

import { app } from '../src/app';

beforeEach(() => {
  jest.clearAllMocks();
  mockAdminSettingFindMany.mockResolvedValue([]);
  mockServiceCategoryFindMany.mockResolvedValue([
    { id: 'c1', code: 'BARBERS', name: 'Barbers', sortOrder: 1 },
    { id: 'c2', code: 'HAIR_SALONS_STYLISTS', name: 'Hair Salons & Stylists', sortOrder: 2 },
  ]);
  mockServiceCategoryFindUnique.mockResolvedValue(null);
  mockBusinessFindMany.mockResolvedValue([]);
  mockBusinessUnitFindMany.mockResolvedValue([]);
  mockProviderLocationFindFirst.mockResolvedValue(null);
  mockReviewAggregate.mockResolvedValue({ _avg: { rating: null }, _count: { rating: 0 } });
  mockReviewFindMany.mockResolvedValue([]);
  mockAvailabilityFindFirst.mockResolvedValue(null);
  mockServiceCount.mockResolvedValue(0);
  mockServiceFindMany.mockResolvedValue([]);
  mockServiceFindUnique.mockResolvedValue(null);
  mockUserFindUnique.mockImplementation(async ({ where }: any) => {
    if (where?.id && typeof where.id === 'string' && where.id.startsWith('user')) {
      return { id: where.id, status: 'ACTIVE', uuid: where.id, email: `${where.id}@test.local` };
    }
    return null;
  });
});

describe('Public — GET /api/v1/marketplace/providers/:providerId/services', () => {
  it('returns paginated ACTIVE services with max 3 images', async () => {
    mockProviderProfileFindUnique.mockResolvedValue({ id: 'prov-1', status: 'ACTIVE', userId: 'user-1' } as any);
    mockServiceCount.mockResolvedValue(1);
    mockServiceFindMany.mockResolvedValue([
      {
        id: 'svc-1',
        uuid: 'uuid-1',
        name: 'Fade',
        description: 'Desc',
        price: 200 as any,
        currency: 'ZAR',
        durationMinutes: 30,
        serviceMode: 'BOTH',
        status: 'ACTIVE',
        category: { id: 'c1', code: 'BARBERS', name: 'Barbers' },
        images: [
          { id: 'i1', imageUrl: 'https://cdn/1.jpg', sortOrder: 0 },
          { id: 'i2', imageUrl: 'https://cdn/2.jpg', sortOrder: 1 },
          { id: 'i3', imageUrl: 'https://cdn/3.jpg', sortOrder: 2 },
          { id: 'i4', imageUrl: 'https://cdn/4.jpg', sortOrder: 3 },
        ],
      },
    ] as any);

    const res = await request(app).get('/api/v1/marketplace/providers/prov-1/services').query({ page: 1, perPage: 10 });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].images).toHaveLength(3);
    expect(res.body.meta.total).toBe(1);
    expect(res.body.meta.page).toBe(1);
    expect(res.body.data[0].price).toBe(200);
    // ensure service count was scoped to ACTIVE + providerId
    expect(mockServiceCount).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: 'ACTIVE' }) }));
  });

  it('404 for unknown provider', async () => {
    mockProviderProfileFindUnique.mockResolvedValue(null);
    const res = await request(app).get('/api/v1/marketplace/providers/unknown/services');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('PROVIDER_NOT_FOUND');
  });

  it('404 for inactive provider (private exposure prevention)', async () => {
    mockProviderProfileFindUnique.mockResolvedValue({ id: 'prov-2', status: 'PAUSED', userId: 'user-2' } as any);
    const res = await request(app).get('/api/v1/marketplace/providers/prov-2/services');
    expect(res.status).toBe(404);
  });

  it('422 for invalid categoryId', async () => {
    mockProviderProfileFindUnique.mockResolvedValue({ id: 'prov-1', status: 'ACTIVE', userId: 'user-1' } as any);
    mockServiceCategoryFindUnique.mockResolvedValue(null);
    const res = await request(app).get('/api/v1/marketplace/providers/prov-1/services').query({ categoryId: 'UNKNOWN' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INVALID_CATEGORY');
  });

  it('category filter by code resolves to id', async () => {
    mockProviderProfileFindUnique.mockResolvedValue({ id: 'prov-1', status: 'ACTIVE', userId: 'user-1' } as any);
    mockServiceCategoryFindUnique.mockImplementation(async ({ where }: any) => {
      if (where.code === 'BARBERS') return { id: 'c1', code: 'BARBERS', name: 'Barbers' } as any;
      if (where.id === 'c1') return { id: 'c1', code: 'BARBERS', name: 'Barbers' } as any;
      return null;
    });
    mockServiceCount.mockResolvedValue(0);
    mockServiceFindMany.mockResolvedValue([]);
    const res = await request(app).get('/api/v1/marketplace/providers/prov-1/services').query({ categoryId: 'BARBERS' });
    expect(res.status).toBe(200);
    expect(mockServiceCount).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ serviceCategoryId: 'c1' }) }));
  });

  it('empty state returns empty array', async () => {
    mockProviderProfileFindUnique.mockResolvedValue({ id: 'prov-1', status: 'ACTIVE', userId: 'user-1' } as any);
    mockServiceCount.mockResolvedValue(0);
    mockServiceFindMany.mockResolvedValue([]);
    const res = await request(app).get('/api/v1/marketplace/providers/prov-1/services');
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.meta.total).toBe(0);
  });
});

describe('Public — GET /api/v1/marketplace/providers/:providerId/services/:serviceId', () => {
  it('returns service detail with max 3 images', async () => {
    mockProviderProfileFindUnique.mockResolvedValue({ id: 'prov-1', status: 'ACTIVE', userId: 'user-1' } as any);
    mockServiceFindUnique.mockResolvedValue({
      id: 'svc-1',
      uuid: 'uuid-1',
      name: 'Fade',
      description: 'Desc',
      price: 150 as any,
      currency: 'ZAR',
      durationMinutes: 45,
      serviceMode: 'BOTH',
      status: 'ACTIVE',
      providerId: 'prov-1',
      businessUnitId: null,
      category: { id: 'c1', code: 'BARBERS', name: 'Barbers' },
      images: [
        { id: 'i1', imageUrl: 'https://cdn/1.jpg', sortOrder: 0 },
        { id: 'i2', imageUrl: 'https://cdn/2.jpg', sortOrder: 1 },
        { id: 'i3', imageUrl: 'https://cdn/3.jpg', sortOrder: 2 },
        { id: 'i4', imageUrl: 'https://cdn/4.jpg', sortOrder: 3 },
      ],
    } as any);

    const res = await request(app).get('/api/v1/marketplace/providers/prov-1/services/svc-1');
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe('svc-1');
    expect(res.body.data.price).toBe(150);
    expect(res.body.data.images).toHaveLength(3);
  });

  it('404 if service belongs to different provider', async () => {
    mockProviderProfileFindUnique.mockResolvedValue({ id: 'prov-1', status: 'ACTIVE', userId: 'user-1' } as any);
    mockServiceFindUnique.mockResolvedValue({
      id: 'svc-x',
      status: 'ACTIVE',
      providerId: 'other-prov',
      businessUnitId: null,
      category: { id: 'c1', code: 'BARBERS', name: 'Barbers' },
      images: [],
    } as any);
    const res = await request(app).get('/api/v1/marketplace/providers/prov-1/services/svc-x');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('SERVICE_NOT_FOUND');
  });

  it('404 for PAUSED service (customer must only see ACTIVE)', async () => {
    mockProviderProfileFindUnique.mockResolvedValue({ id: 'prov-1', status: 'ACTIVE', userId: 'user-1' } as any);
    mockServiceFindUnique.mockResolvedValue({
      id: 'svc-2',
      status: 'PAUSED',
      providerId: 'prov-1',
      images: [],
    } as any);
    const res = await request(app).get('/api/v1/marketplace/providers/prov-1/services/svc-2');
    expect(res.status).toBe(404);
  });

  it('404 for unknown provider on detail', async () => {
    mockProviderProfileFindUnique.mockResolvedValue(null);
    const res = await request(app).get('/api/v1/marketplace/providers/unknown/services/svc-1');
    expect(res.status).toBe(404);
  });
});

describe('Private — GET /api/v1/providers/me/services (authenticated)', () => {
  it('401 without auth', async () => {
    const res = await request(app).get('/api/v1/providers/me/services');
    expect(res.status).toBe(401);
  });

  it('404 if provider profile missing for user', async () => {
    const tok = token({ sub: 'user-noprov', roles: ['PROVIDER'] });
    mockUserFindUnique.mockResolvedValue({ id: 'user-noprov', status: 'ACTIVE' });
    mockProviderProfileFindUnique.mockResolvedValue(null);
    const res = await request(app).get('/api/v1/providers/me/services').set('Authorization', `Bearer ${tok}`);
    expect(res.status).toBe(404);
  });

  it('returns own services including PAUSED (provider view shows all)', async () => {
    const tok = token({ sub: 'user-1', roles: ['PROVIDER'] });
    mockProviderProfileFindUnique.mockResolvedValue({ id: 'prov-1', userId: 'user-1' } as any);
    mockServiceCount.mockResolvedValue(2);
    mockServiceFindMany.mockResolvedValue([
      { id: 'svc-1', status: 'ACTIVE', providerId: 'prov-1', businessUnitId: null, price: 100 as any, currency: 'ZAR', durationMinutes: 30, serviceMode: 'BOTH', category: { id: 'c1', code: 'BARBERS', name: 'Barbers' }, images: [{ id: 'i1', imageUrl: 'https://cdn/1.jpg', sortOrder: 0 }] },
      { id: 'svc-2', status: 'PAUSED', providerId: 'prov-1', businessUnitId: null, price: 120 as any, currency: 'ZAR', durationMinutes: 30, serviceMode: 'BOTH', category: { id: 'c1', code: 'BARBERS', name: 'Barbers' }, images: [] },
    ] as any);

    const res = await request(app).get('/api/v1/providers/me/services').set('Authorization', `Bearer ${tok}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data.map((s: any) => s.id)).toEqual(expect.arrayContaining(['svc-1', 'svc-2']));
  });

  it('tenant isolation: provider A cannot see provider B services via me endpoint (ownership via userId)', async () => {
    const tok = token({ sub: 'user-a', roles: ['PROVIDER'] });
    // attacker user-a owns prov-a only
    mockProviderProfileFindUnique.mockResolvedValue({ id: 'prov-a', userId: 'user-a' } as any);
    // Even if service belongs to prov-b, me endpoint only queries prov-a ownerWhere, so count will reflect only prov-a
    // Simulate that service table contains victim service but query where is scoped to prov-a — so our mock checks where
    mockServiceCount.mockImplementation(async ({ where }: any) => {
      // where should contain providerId prov-a, not victim
      expect(where.OR ? JSON.stringify(where.OR) : where.providerId).toMatch(/prov-a/);
      return 0;
    });
    mockServiceFindMany.mockResolvedValue([]);
    const res = await request(app).get('/api/v1/providers/me/services').set('Authorization', `Bearer ${tok}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('supports status and category filtering', async () => {
    const tok = token({ sub: 'user-1', roles: ['PROVIDER'] });
    mockProviderProfileFindUnique.mockResolvedValue({ id: 'prov-1', userId: 'user-1' } as any);
    mockServiceCategoryFindUnique.mockImplementation(async ({ where }: any) => {
      if (where.code === 'BARBERS' || where.id === 'c1') return { id: 'c1', code: 'BARBERS', name: 'Barbers' } as any;
      return null;
    });
    mockServiceCount.mockResolvedValue(1);
    mockServiceFindMany.mockResolvedValue([{ id: 'svc-1', status: 'ACTIVE', providerId: 'prov-1', price: 100 as any, currency: 'ZAR', durationMinutes: 30, serviceMode: 'BOTH', category: { id: 'c1', code: 'BARBERS', name: 'Barbers' }, images: [] }] as any);
    const res = await request(app).get('/api/v1/providers/me/services').set('Authorization', `Bearer ${tok}`).query({ status: 'ACTIVE', categoryId: 'BARBERS' });
    expect(res.status).toBe(200);
    expect(mockServiceCount).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: 'ACTIVE', serviceCategoryId: 'c1' }) }));
  });
});

describe('Private — GET /api/v1/providers/me/services/:serviceId', () => {
  it('401 without auth', async () => {
    const res = await request(app).get('/api/v1/providers/me/services/svc-1');
    expect(res.status).toBe(401);
  });

  it('404 if service belongs to another provider', async () => {
    const tok = token({ sub: 'user-a', roles: ['PROVIDER'] });
    mockProviderProfileFindUnique.mockResolvedValue({ id: 'prov-a', userId: 'user-a' } as any);
    mockServiceFindUnique.mockResolvedValue({ id: 'svc-victim', providerId: 'prov-victim', businessUnitId: null, status: 'ACTIVE', category: { id: 'c1', code: 'BARBERS', name: 'Barbers' }, images: [] } as any);
    const res = await request(app).get('/api/v1/providers/me/services/svc-victim').set('Authorization', `Bearer ${tok}`);
    expect(res.status).toBe(404);
  });

  it('returns own service even if PAUSED (provider can view own inactive)', async () => {
    const tok = token({ sub: 'user-1', roles: ['PROVIDER'] });
    mockProviderProfileFindUnique.mockResolvedValue({ id: 'prov-1', userId: 'user-1' } as any);
    mockServiceFindUnique.mockResolvedValue({ id: 'svc-2', uuid: 'uuid-2', name: 'Paused Service', providerId: 'prov-1', businessUnitId: null, status: 'PAUSED', price: 100 as any, currency: 'ZAR', durationMinutes: 30, serviceMode: 'BOTH', category: { id: 'c1', code: 'BARBERS', name: 'Barbers' }, images: [] } as any);
    const res = await request(app).get('/api/v1/providers/me/services/svc-2').set('Authorization', `Bearer ${tok}`);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('PAUSED');
  });
});

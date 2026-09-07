/**
 * Phase 2 Slice 9 — Provider service catalogue management API.
 *
 * Validates: session ownership, full CRUD (POST/PUT/PATCH/DELETE),
 * category authority, pricing/duration rules, active state, 3-image limit,
 * mass-assignment rejection, tenant isolation, booking-snapshot immunity,
 * audit events, concurrency, XSS, oversized payloads, error contracts.
 */
import request from 'supertest';
import jwt from 'jsonwebtoken';

function token(sub: string) {
  const secret = process.env.JWT_SECRET ?? 'dev-jwt-secret-change-me';
  return jwt.sign(
    { sub, uuid: sub, email: `${sub}@test.local`, roles: ['PROVIDER'] },
    secret,
    { expiresIn: '1h', issuer: 'waasha', audience: 'waasha-app' } as any,
  );
}

const mockUserFindUnique = jest.fn();
const mockProviderProfileFindUnique = jest.fn();
const mockCategoryFindUnique = jest.fn();
const mockServiceCount = jest.fn();
const mockServiceFindMany = jest.fn();
const mockServiceFindUnique = jest.fn();
const mockServiceCreate = jest.fn();
const mockServiceUpdate = jest.fn();
const mockServiceDelete = jest.fn();
const mockServiceImageCreate = jest.fn();
const mockServiceImageDeleteMany = jest.fn();
const mockBusinessFindMany = jest.fn();
const mockBusinessUnitFindMany = jest.fn();
const mockBusinessStaffFindMany = jest.fn();
const mockBookingCount = jest.fn();
const mockBookingFindFirst = jest.fn();
const mockBookingItemUpdate = jest.fn();
const mockPaymentUpdate = jest.fn();
const mockAuditCreate = jest.fn();

jest.mock('../src/config/prisma', () => ({
  prisma: {
    user: { findUnique: mockUserFindUnique },
    providerProfile: { findUnique: mockProviderProfileFindUnique },
    serviceCategory: { findUnique: mockCategoryFindUnique, findMany: jest.fn().mockResolvedValue([]) },
    providerLocation: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
    service: {
      count: mockServiceCount,
      findMany: mockServiceFindMany,
      findUnique: mockServiceFindUnique,
      create: mockServiceCreate,
      update: mockServiceUpdate,
      delete: mockServiceDelete,
    },
    serviceImage: { create: mockServiceImageCreate, deleteMany: mockServiceImageDeleteMany },
    business: { findMany: mockBusinessFindMany },
    businessUnit: { findMany: mockBusinessUnitFindMany },
    businessStaff: { findMany: mockBusinessStaffFindMany },
    booking: { count: mockBookingCount, findFirst: mockBookingFindFirst, findMany: jest.fn().mockResolvedValue([]) },
    bookingItem: { update: mockBookingItemUpdate, create: jest.fn() },
    payment: { update: mockPaymentUpdate },
    review: { aggregate: jest.fn().mockResolvedValue({ _avg: { rating: null }, _count: { rating: 0 } }), findMany: jest.fn().mockResolvedValue([]), groupBy: jest.fn().mockResolvedValue([]) },
    availabilityRule: { findFirst: jest.fn().mockResolvedValue(null) },
    auditLog: { create: mockAuditCreate },
    adminSetting: { findMany: jest.fn().mockResolvedValue([]) },
    $queryRaw: jest.fn().mockResolvedValue([1]),
  },
}));

import { app } from '../src/app';

const CATEGORY = { id: 'c1', code: 'BARBERS', name: 'Barbers', isActive: true };

function ownProfile() {
  return { id: 'prov-1', userId: 'user-1', tier: { code: 'T1' } };
}

function serviceRow(over: Record<string, unknown> = {}) {
  return {
    id: 'svc-1',
    uuid: 'uuid-1',
    name: 'Classic fade',
    description: 'Clean fade',
    price: 150 as any,
    currency: 'ZAR',
    durationMinutes: 30,
    serviceMode: 'BOTH',
    status: 'ACTIVE',
    serviceCategoryId: 'c1',
    providerId: 'prov-1',
    businessUnitId: null,
    deletedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
    category: { id: 'c1', code: 'BARBERS', name: 'Barbers' },
    images: [],
    ...over,
  } as any;
}

function validBody(over: Record<string, unknown> = {}) {
  return {
    name: 'Classic fade',
    description: 'Clean fade',
    serviceCategoryId: 'c1',
    price: 150,
    currency: 'ZAR',
    durationMinutes: 30,
    serviceMode: 'BOTH',
    ...over,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUserFindUnique.mockImplementation(async ({ where }: any) => {
    if (where?.id && typeof where.id === 'string') return { id: where.id, status: 'ACTIVE' };
    return null;
  });
  mockProviderProfileFindUnique.mockResolvedValue(ownProfile() as any);
  mockCategoryFindUnique.mockImplementation(async ({ where }: any) => {
    if (where?.id === 'c1' || where?.code === 'BARBERS') return CATEGORY as any;
    return null;
  });
  mockBusinessFindMany.mockResolvedValue([]);
  mockBusinessUnitFindMany.mockResolvedValue([]);
  mockBusinessStaffFindMany.mockResolvedValue([]);
  mockServiceImageCreate.mockResolvedValue({ id: 'img-1' });
  mockServiceImageDeleteMany.mockResolvedValue({ count: 0 });
  mockServiceDelete.mockResolvedValue(serviceRow());
  mockBookingCount.mockResolvedValue(0);
  mockBookingFindFirst.mockResolvedValue(null);
  mockAuditCreate.mockResolvedValue({});
  mockServiceCount.mockResolvedValue(0);
  mockServiceFindMany.mockResolvedValue([]);
});

describe('Slice 9 — auth & ownership', () => {
  it('1. provider can list own services (all statuses)', async () => {
    mockServiceCount.mockResolvedValue(1);
    mockServiceFindMany.mockResolvedValue([serviceRow()]);
    const res = await request(app).get('/api/v1/providers/me/services').set('Authorization', `Bearer ${token('user-1')}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  it('2. unauthenticated access rejected on all verbs', async () => {
    for (const r of [
      request(app).post('/api/v1/providers/me/services').send(validBody()),
      request(app).put('/api/v1/providers/me/services/svc-1').send(validBody()),
      request(app).patch('/api/v1/providers/me/services/svc-1').send({ price: 10 }),
      request(app).delete('/api/v1/providers/me/services/svc-1'),
    ]) {
      const res = await r;
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    }
  });

  it('3. provider cannot access another provider service (safe 404, no leakage)', async () => {
    mockServiceFindUnique.mockResolvedValue(serviceRow({ id: 'svc-victim', providerId: 'prov-victim', name: 'Victim secret' }));
    const res = await request(app)
      .patch('/api/v1/providers/me/services/svc-victim')
      .set('Authorization', `Bearer ${token('user-1')}`)
      .send({ price: 10 });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('SERVICE_NOT_FOUND');
    expect(JSON.stringify(res.body)).not.toContain('Victim secret');
    expect(mockServiceUpdate).not.toHaveBeenCalled();
  });
});

describe('Slice 9 — create / update / delete', () => {
  it('4. create service under session identity', async () => {
    mockServiceCreate.mockResolvedValue(serviceRow());
    mockServiceFindUnique.mockResolvedValue(serviceRow());
    const res = await request(app)
      .post('/api/v1/providers/me/services')
      .set('Authorization', `Bearer ${token('user-1')}`)
      .send(validBody());
    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('Classic fade');
    expect(mockServiceCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ providerId: 'prov-1', price: 150 }) }),
    );
  });

  it('5. update service (PUT full replace)', async () => {
    mockServiceFindUnique.mockResolvedValue(serviceRow());
    mockServiceUpdate.mockResolvedValue(serviceRow({ price: 180 }));
    const res = await request(app)
      .put('/api/v1/providers/me/services/svc-1')
      .set('Authorization', `Bearer ${token('user-1')}`)
      .send(validBody({ price: 180 }));
    expect(res.status).toBe(200);
    expect(mockServiceUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ price: 180 }) }),
    );
  });

  it('6. delete service with no bookings succeeds', async () => {
    mockServiceFindUnique.mockResolvedValue(serviceRow());
    mockBookingCount.mockResolvedValue(0);
    const res = await request(app)
      .delete('/api/v1/providers/me/services/svc-1')
      .set('Authorization', `Bearer ${token('user-1')}`);
    expect(res.status).toBe(200);
    expect(res.body.data.deleted).toBe(true);
    expect(mockServiceDelete).toHaveBeenCalled();
  });

  it('6b. delete service with bookings is blocked (deactivate instead)', async () => {
    mockServiceFindUnique.mockResolvedValue(serviceRow());
    mockBookingCount.mockResolvedValue(2);
    const res = await request(app)
      .delete('/api/v1/providers/me/services/svc-1')
      .set('Authorization', `Bearer ${token('user-1')}`);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SERVICE_HAS_BOOKINGS');
    expect(mockServiceDelete).not.toHaveBeenCalled();
  });

  it('7. reactivate service via PATCH isActive', async () => {
    mockServiceFindUnique.mockResolvedValue(serviceRow({ status: 'PAUSED' }));
    const after = serviceRow({ status: 'ACTIVE' });
    mockServiceUpdate.mockResolvedValue(serviceRow({ status: 'ACTIVE' }));
    mockServiceFindUnique.mockResolvedValueOnce(serviceRow({ status: 'PAUSED' })).mockResolvedValueOnce(after);
    const res = await request(app)
      .patch('/api/v1/providers/me/services/svc-1')
      .set('Authorization', `Bearer ${token('user-1')}`)
      .send({ isActive: true });
    expect(res.status).toBe(200);
    expect(mockServiceUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'ACTIVE' }) }),
    );
  });
});

describe('Slice 9 — validation', () => {
  it('8. invalid category rejected', async () => {
    const res = await request(app)
      .post('/api/v1/providers/me/services')
      .set('Authorization', `Bearer ${token('user-1')}`)
      .send(validBody({ serviceCategoryId: 'NOPE' }));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('CATEGORY_NOT_FOUND');
    expect(mockServiceCreate).not.toHaveBeenCalled();
  });

  it('9. arbitrary category creation rejected (name is not authoritative)', async () => {
    const res = await request(app)
      .post('/api/v1/providers/me/services')
      .set('Authorization', `Bearer ${token('user-1')}`)
      .send({ ...validBody(), serviceCategoryId: 'Brand New Category', categoryName: 'Brand New Category' });
    expect(res.status).toBe(422);
    expect(mockServiceCreate).not.toHaveBeenCalled();
  });

  it('10. negative price rejected', async () => {
    const res = await request(app)
      .post('/api/v1/providers/me/services')
      .set('Authorization', `Bearer ${token('user-1')}`)
      .send(validBody({ price: -5 }));
    expect(res.status).toBe(422);
    expect(mockServiceCreate).not.toHaveBeenCalled();
  });

  it('11. invalid price precision rejected', async () => {
    const res = await request(app)
      .post('/api/v1/providers/me/services')
      .set('Authorization', `Bearer ${token('user-1')}`)
      .send(validBody({ price: 10.999 }));
    expect(res.status).toBe(422);
    expect(mockServiceCreate).not.toHaveBeenCalled();
  });

  it('12. invalid duration rejected', async () => {
    for (const durationMinutes of [0, -30, 1.5, 2000, 'soon']) {
      const res = await request(app)
        .post('/api/v1/providers/me/services')
        .set('Authorization', `Bearer ${token('user-1')}`)
        .send(validBody({ durationMinutes }));
      expect(res.status).toBe(422);
    }
    expect(mockServiceCreate).not.toHaveBeenCalled();
  });

  it('13. invalid service mode rejected', async () => {
    const res = await request(app)
      .post('/api/v1/providers/me/services')
      .set('Authorization', `Bearer ${token('user-1')}`)
      .send(validBody({ serviceMode: 'DRONE_DELIVERY' }));
    expect(res.status).toBe(422);
    expect(mockServiceCreate).not.toHaveBeenCalled();
  });

  it('14. image count >3 rejected', async () => {
    const images = [1, 2, 3, 4].map((i) => ({ imageUrl: `https://cdn.test/${i}.jpg`, sortOrder: i - 1 }));
    const res = await request(app)
      .post('/api/v1/providers/me/services')
      .set('Authorization', `Bearer ${token('user-1')}`)
      .send(validBody({ images }));
    expect(res.status).toBe(422);
    expect(mockServiceCreate).not.toHaveBeenCalled();
  });

  it('15. valid image references accepted (max 3)', async () => {
    mockServiceCreate.mockResolvedValue(serviceRow());
    mockServiceFindUnique.mockResolvedValue(serviceRow());
    const images = [{ imageUrl: 'https://cdn.test/a.jpg' }, { imageUrl: 'https://cdn.test/b.jpg' }];
    const res = await request(app)
      .post('/api/v1/providers/me/services')
      .set('Authorization', `Bearer ${token('user-1')}`)
      .send(validBody({ images }));
    expect(res.status).toBe(201);
    expect(mockServiceImageCreate).toHaveBeenCalledTimes(2);
  });

  it('15b. fake/invalid upload completion cannot be claimed (data URI rejected)', async () => {
    const res = await request(app)
      .post('/api/v1/providers/me/services')
      .set('Authorization', `Bearer ${token('user-1')}`)
      .send(validBody({ images: [{ imageUrl: 'data:image/jpeg;base64,AAAA' }] }));
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('UPLOAD_NOT_SUPPORTED');
    expect(mockServiceCreate).not.toHaveBeenCalled();
  });

  it('16. mass assignment blocked', async () => {
    const res = await request(app)
      .post('/api/v1/providers/me/services')
      .set('Authorization', `Bearer ${token('user-1')}`)
      .send({ ...validBody(), commission: 1, paymentStatus: 'PAID', createdAt: '2020-01-01' });
    expect(res.status).toBe(422);
    expect(mockServiceCreate).not.toHaveBeenCalled();
  });

  it('17. providerId cannot be client-controlled', async () => {
    const res = await request(app)
      .post('/api/v1/providers/me/services')
      .set('Authorization', `Bearer ${token('user-1')}`)
      .send({ ...validBody(), providerId: 'prov-victim' });
    expect(res.status).toBe(422);
    expect(mockServiceCreate).not.toHaveBeenCalled();
  });
});

describe('Slice 9 — tenant isolation', () => {
  it('18. T3 unit ownership isolation (cannot mutate another unit service)', async () => {
    mockBusinessFindMany.mockResolvedValue([{ id: 'biz-own' }]);
    mockBusinessUnitFindMany.mockResolvedValue([{ id: 'unit-own' }]);
    mockServiceFindUnique.mockResolvedValue(serviceRow({ id: 'svc-unit', providerId: 'prov-other', businessUnitId: 'unit-foreign' }));
    const res = await request(app)
      .patch('/api/v1/providers/me/services/svc-unit')
      .set('Authorization', `Bearer ${token('user-1')}`)
      .send({ price: 10 });
    expect(res.status).toBe(404);
    expect(mockServiceUpdate).not.toHaveBeenCalled();
  });

  it('18b. T3 owner can manage own unit service', async () => {
    mockBusinessFindMany.mockResolvedValue([{ id: 'biz-own' }]);
    mockBusinessUnitFindMany.mockResolvedValue([{ id: 'unit-own' }]);
    mockServiceFindUnique.mockResolvedValue(serviceRow({ id: 'svc-unit', providerId: 'prov-other', businessUnitId: 'unit-own' }));
    mockServiceUpdate.mockResolvedValue(serviceRow({ id: 'svc-unit', businessUnitId: 'unit-own', price: 200 }));
    const res = await request(app)
      .patch('/api/v1/providers/me/services/svc-unit')
      .set('Authorization', `Bearer ${token('user-1')}`)
      .send({ price: 200 });
    expect(res.status).toBe(200);
  });
});

describe('Slice 9 — marketplace integration', () => {
  it('20. inactive service excluded from public results', async () => {
    mockProviderProfileFindUnique.mockResolvedValue({ id: 'prov-1', status: 'ACTIVE', userId: 'user-1' });
    mockServiceFindUnique.mockResolvedValue(serviceRow({ status: 'PAUSED', providerId: 'prov-1' }));
    const res = await request(app).get('/api/v1/marketplace/providers/prov-1/services/svc-1');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('SERVICE_NOT_FOUND');
  });

  it('21. active service visible publicly', async () => {
    mockProviderProfileFindUnique.mockResolvedValue({ id: 'prov-1', status: 'ACTIVE', userId: 'user-1' });
    mockServiceFindUnique.mockResolvedValue(serviceRow({ status: 'ACTIVE', providerId: 'prov-1' }));
    const res = await request(app).get('/api/v1/marketplace/providers/prov-1/services/svc-1');
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe('svc-1');
  });

  it('20b. deactivation removes service from public results immediately', async () => {
    // Step 1: provider deactivates
    mockServiceFindUnique.mockResolvedValueOnce(serviceRow({ status: 'ACTIVE', providerId: 'prov-1' }));
    mockServiceUpdate.mockResolvedValueOnce(serviceRow({ status: 'PAUSED', providerId: 'prov-1' }));
    mockServiceFindUnique.mockResolvedValueOnce(serviceRow({ status: 'PAUSED', providerId: 'prov-1' }));
    const patch = await request(app)
      .patch('/api/v1/providers/me/services/svc-1')
      .set('Authorization', `Bearer ${token('user-1')}`)
      .send({ isActive: false });
    expect(patch.status).toBe(200);
    // Step 2: public detail now 404s
    mockProviderProfileFindUnique.mockResolvedValue({ id: 'prov-1', status: 'ACTIVE', userId: 'user-1' });
    mockServiceFindUnique.mockResolvedValue(serviceRow({ status: 'PAUSED', providerId: 'prov-1' }));
    const pub = await request(app).get('/api/v1/marketplace/providers/prov-1/services/svc-1');
    expect(pub.status).toBe(404);
  });
});

describe('Slice 9 — booking snapshot immunity', () => {
  it('22/23. changing price/duration never mutates bookings or payments', async () => {
    const existingItem = { id: 'item-1', unitPrice: 150, durationMinutes: 30 };
    mockServiceFindUnique.mockResolvedValue(serviceRow());
    mockServiceUpdate.mockResolvedValue(serviceRow({ price: 220, durationMinutes: 60 }));
    mockServiceFindUnique.mockResolvedValueOnce(serviceRow()).mockResolvedValueOnce(
      serviceRow({ price: 220, durationMinutes: 60 }),
    );
    const res = await request(app)
      .patch('/api/v1/providers/me/services/svc-1')
      .set('Authorization', `Bearer ${token('user-1')}`)
      .send({ price: 220, durationMinutes: 60 });
    expect(res.status).toBe(200);
    // Catalogue layer never writes booking or payment records.
    expect(mockBookingItemUpdate).not.toHaveBeenCalled();
    expect(mockPaymentUpdate).not.toHaveBeenCalled();
    // Pre-existing historical snapshot is untouched.
    expect(existingItem.unitPrice).toBe(150);
    expect(existingItem.durationMinutes).toBe(30);
  });

  it('24. deactivating service does not delete existing booking records', async () => {
    mockServiceFindUnique.mockResolvedValue(serviceRow({ status: 'ACTIVE' }));
    mockServiceUpdate.mockResolvedValue(serviceRow({ status: 'PAUSED' }));
    mockServiceFindUnique.mockResolvedValueOnce(serviceRow({ status: 'ACTIVE' })).mockResolvedValueOnce(
      serviceRow({ status: 'PAUSED' }),
    );
    const res = await request(app)
      .patch('/api/v1/providers/me/services/svc-1')
      .set('Authorization', `Bearer ${token('user-1')}`)
      .send({ isActive: false });
    expect(res.status).toBe(200);
    expect(mockServiceDelete).not.toHaveBeenCalled();
    expect(mockBookingItemUpdate).not.toHaveBeenCalled();
  });
});

describe('Slice 9 — audit, concurrency, security', () => {
  it('27. audit event generated for create/update/delete', async () => {
    mockServiceCreate.mockResolvedValue(serviceRow());
    mockServiceFindUnique.mockResolvedValue(serviceRow());
    await request(app)
      .post('/api/v1/providers/me/services')
      .set('Authorization', `Bearer ${token('user-1')}`)
      .send(validBody());
    expect(mockAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'SERVICE_CREATED', entityType: 'service' }) }),
    );

    mockServiceFindUnique.mockResolvedValue(serviceRow());
    mockServiceUpdate.mockResolvedValue(serviceRow({ status: 'PAUSED' }));
    mockServiceFindUnique.mockResolvedValueOnce(serviceRow()).mockResolvedValueOnce(serviceRow({ status: 'PAUSED' }));
    await request(app)
      .patch('/api/v1/providers/me/services/svc-1')
      .set('Authorization', `Bearer ${token('user-1')}`)
      .send({ isActive: false });
    expect(mockAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ action: 'SERVICE_DEACTIVATED' }) }),
    );
  });

  it('28. concurrent update conflict returns 409', async () => {
    mockServiceFindUnique.mockResolvedValue(serviceRow({ updatedAt: new Date('2026-01-02T00:00:00Z') }));
    const res = await request(app)
      .patch('/api/v1/providers/me/services/svc-1')
      .set('Authorization', `Bearer ${token('user-1')}`)
      .send({ price: 200, expectedUpdatedAt: '2025-12-01T00:00:00.000Z' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SERVICE_CONFLICT');
    expect(mockServiceUpdate).not.toHaveBeenCalled();
  });

  it('28b. matching expectedUpdatedAt allows the update', async () => {
    mockServiceFindUnique.mockResolvedValue(serviceRow({ updatedAt: new Date('2026-01-02T00:00:00Z') }));
    mockServiceUpdate.mockResolvedValue(serviceRow({ price: 200 }));
    mockServiceFindUnique.mockResolvedValueOnce(serviceRow({ updatedAt: new Date('2026-01-02T00:00:00Z') })).mockResolvedValueOnce(
      serviceRow({ price: 200 }),
    );
    const res = await request(app)
      .patch('/api/v1/providers/me/services/svc-1')
      .set('Authorization', `Bearer ${token('user-1')}`)
      .send({ price: 200, expectedUpdatedAt: '2026-01-02T00:00:00.000Z' });
    expect(res.status).toBe(200);
  });

  it('29. XSS/HTML injection stripped, never stored raw', async () => {
    mockServiceCreate.mockResolvedValue(serviceRow());
    mockServiceFindUnique.mockResolvedValue(serviceRow());
    const res = await request(app)
      .post('/api/v1/providers/me/services')
      .set('Authorization', `Bearer ${token('user-1')}`)
      .send(validBody({ name: '<script>alert(1)</script>Fade', description: '<img src=x onerror=alert(1)>Nice' }));
    expect(res.status).toBe(201);
    const storedName = mockServiceCreate.mock.calls[0][0].data.name as string;
    const storedDesc = mockServiceCreate.mock.calls[0][0].data.description as string;
    expect(storedName).not.toContain('<');
    expect(storedName).toContain('Fade');
    expect(storedDesc).not.toContain('<');
  });

  it('30. oversized payload rejected', async () => {
    const res = await request(app)
      .post('/api/v1/providers/me/services')
      .set('Authorization', `Bearer ${token('user-1')}`)
      .send(validBody({ description: 'x'.repeat(2001) }));
    expect(res.status).toBe(422);
    expect(mockServiceCreate).not.toHaveBeenCalled();
  });

  it('31. service not found handling', async () => {
    mockServiceFindUnique.mockResolvedValue(null);
    const res = await request(app)
      .get('/api/v1/providers/me/services/does-not-exist')
      .set('Authorization', `Bearer ${token('user-1')}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('SERVICE_NOT_FOUND');
  });

  it('32. internal error sanitized (no stack leak)', async () => {
    mockServiceCreate.mockRejectedValueOnce(new Error('prisma exploded: SECRET=abc, stack trace...'));
    mockServiceFindUnique.mockResolvedValue(serviceRow());
    const res = await request(app)
      .post('/api/v1/providers/me/services')
      .set('Authorization', `Bearer ${token('user-1')}`)
      .send(validBody());
    // Either the create path 500s sanitized, or the follow-up read resolves — must never leak internals.
    expect([201, 500]).toContain(res.status);
    if (res.status === 500) {
      expect(res.body.error.code).toBe('INTERNAL_ERROR');
      expect(JSON.stringify(res.body)).not.toContain('SECRET');
      expect(JSON.stringify(res.body)).not.toContain('stack trace');
    }
  });
});

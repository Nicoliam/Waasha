/**
 * Phase 2 Slice 6 — Customer booking management (read-only).
 *
 * Covers the 22 required scenarios: scoped list/detail, safe 404s,
 * snapshot authority, payment separation, cash preservation, location
 * privacy, no customer-driven transitions, pagination, tenant isolation.
 */
import request from 'supertest';
import jwt from 'jsonwebtoken';

function token(sub: string) {
  const secret = process.env.JWT_SECRET ?? 'dev-jwt-secret-change-me';
  return jwt.sign({ uuid: sub, email: `${sub}@test.local`, sub }, secret, {
    expiresIn: '1h',
    issuer: 'waasha',
    audience: 'waasha-app',
  } as any);
}

// ---- mocks ----
const mockAdminSettingFindMany = jest.fn();
const mockUserFindUnique = jest.fn();
const mockCustomerProfileFindUnique = jest.fn();
const mockProviderProfileFindUnique = jest.fn();
const mockBusinessFindMany = jest.fn();
const mockBusinessUnitFindMany = jest.fn();
const mockBookingCount = jest.fn();
const mockBookingFindMany = jest.fn();
const mockBookingFindFirst = jest.fn();
const mockBookingFindUnique = jest.fn();
const mockServiceFindUnique = jest.fn();
const mockAuditCreate = jest.fn();
const mockQueryRaw = jest.fn().mockResolvedValue([1]);
const mockTransaction = jest.fn();

jest.mock('../src/config/prisma', () => ({
  prisma: {
    adminSetting: { findMany: mockAdminSettingFindMany },
    user: { findUnique: mockUserFindUnique },
    customerProfile: {
      findUnique: (...a: any[]) => (mockCustomerProfileFindUnique as any)(...a),
      update: jest.fn(),
    },
    providerProfile: { findUnique: (...a: any[]) => (mockProviderProfileFindUnique as any)(...a) },
    business: { findMany: (...a: any[]) => (mockBusinessFindMany as any)(...a) },
    businessUnit: { findMany: (...a: any[]) => (mockBusinessUnitFindMany as any)(...a) },
    booking: {
      count: (...a: any[]) => (mockBookingCount as any)(...a),
      findMany: (...a: any[]) => (mockBookingFindMany as any)(...a),
      findFirst: (...a: any[]) => (mockBookingFindFirst as any)(...a),
      findUnique: (...a: any[]) => (mockBookingFindUnique as any)(...a),
    },
    service: { findUnique: (...a: any[]) => (mockServiceFindUnique as any)(...a) },
    auditLog: { create: (...a: any[]) => (mockAuditCreate as any)(...a) },
    $queryRaw: (...a: any[]) => (mockQueryRaw as any)(...a),
    $transaction: (...a: any[]) => (mockTransaction as any)(...a),
  },
}));

import { app } from '../src/app';

// ---- fixtures ----
function futureAt(hour: string): Date {
  const d = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
  return new Date(`${d.toISOString().slice(0, 10)}T${hour}:00.000Z`);
}

function mkBooking(over: Record<string, unknown> = {}) {
  const start = futureAt('09:00');
  const end = new Date(start.getTime() + 30 * 60 * 1000);
  return {
    id: 'cb-pending',
    uuid: 'uuid-cb-pending',
    customerId: 'cust-1',
    providerId: 'prov-1',
    assignedProviderId: null,
    businessUnitId: null,
    serviceId: 'svc-1',
    bookingType: 'STANDARD',
    serviceLocationType: 'PROVIDER',
    scheduledStart: start,
    scheduledEnd: end,
    timezone: 'Africa/Johannesburg',
    status: 'PENDING',
    currency: 'ZAR',
    subtotal: 200,
    totalAmount: 200,
    paymentMethod: null as string | null,
    paymentStatus: 'PENDING',
    createdAt: new Date(),
    updatedAt: new Date(),
    items: [
      {
        serviceId: 'svc-1',
        serviceNameSnapshot: 'Fade',
        serviceDescriptionSnapshot: 'Classic fade',
        unitPrice: 200,
        quantity: 1,
        durationMinutes: 30,
        lineTotal: 200,
      },
    ],
    location: {
      locationType: 'PROVIDER',
      addressLine1: '10 Main Rd',
      city: 'Johannesburg',
      province: 'Gauteng',
      postalCode: '2196',
      country: 'ZA',
      latitude: -26.2,
      longitude: 28.0,
    },
    provider: { displayName: 'Sharp Cuts' },
    payment: null as Record<string, unknown> | null,
    cashPaymentDetail: null as Record<string, unknown> | null,
    ...over,
  };
}

let store: Record<string, ReturnType<typeof mkBooking>> = {};

function scopedList(where: { customerId?: string; status?: { in?: string[] } }): unknown[] {
  return Object.values(store).filter(
    (b) =>
      (!where.customerId || b.customerId === where.customerId) &&
      (!where.status?.in || where.status.in.includes(b.status as string)),
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  store = {};
  store['cb-pending'] = mkBooking();
  store['cb-accepted'] = mkBooking({ id: 'cb-accepted', uuid: 'uuid-cb-accepted', status: 'ACCEPTED' });
  store['cb-active'] = mkBooking({ id: 'cb-active', uuid: 'uuid-cb-active', status: 'IN_PROGRESS' });
  store['cb-completed'] = mkBooking({ id: 'cb-completed', uuid: 'uuid-cb-completed', status: 'COMPLETED' });
  store['cb-declined'] = mkBooking({ id: 'cb-declined', uuid: 'uuid-cb-declined', status: 'DECLINED' });
  store['cb-cancelled'] = mkBooking({ id: 'cb-cancelled', uuid: 'uuid-cb-cancelled', status: 'CANCELLED' });
  store['cb-other'] = mkBooking({ id: 'cb-other', uuid: 'uuid-cb-other', customerId: 'cust-2' });
  store['cb-paid'] = mkBooking({
    id: 'cb-paid',
    uuid: 'uuid-cb-paid',
    paymentMethod: 'cash',
    paymentStatus: 'PAID',
    payment: {
      method: 'cash',
      gateway: 'manual_cash',
      status: 'PAID',
      amount: 200,
      currency: 'ZAR',
      providerReference: null,
      paidAt: new Date(),
    },
    cashPaymentDetail: { changeRequested: true, amountTendered: 250, changeAmount: 50 },
  });
  store['cb-unit'] = mkBooking({ id: 'cb-unit', uuid: 'uuid-cb-unit', businessUnitId: 'unit-1' });

  mockAdminSettingFindMany.mockResolvedValue([]);
  mockBusinessFindMany.mockResolvedValue([]);
  mockBusinessUnitFindMany.mockImplementation(async ({ where }: any) => {
    if (where?.id?.in?.includes('unit-1')) return [{ id: 'unit-1', name: 'Sandton Branch' }];
    return [];
  });
  mockAuditCreate.mockResolvedValue({});

  mockUserFindUnique.mockImplementation(async ({ where }: any) => {
    if (['user-cust1', 'user-cust2'].includes(where?.id)) return { id: where.id, status: 'ACTIVE' } as never;
    return null;
  });
  mockCustomerProfileFindUnique.mockImplementation(async ({ where }: any) => {
    if (where?.userId === 'user-cust1') return { id: 'cust-1', userId: 'user-cust1' } as never;
    if (where?.userId === 'user-cust2') return { id: 'cust-2', userId: 'user-cust2' } as never;
    return null;
  });
  mockProviderProfileFindUnique.mockResolvedValue(null);
  mockBookingFindMany.mockImplementation(async ({ where, skip, take }: any) => {
    const all = scopedList(where ?? {});
    const start = Math.max(0, skip ?? 0);
    return take != null ? all.slice(start, start + take) : all.slice(start);
  });
  mockBookingCount.mockImplementation(async ({ where }: any) => scopedList(where ?? {}).length);
  mockBookingFindUnique.mockImplementation(async ({ where }: any) => store[where?.id] ?? null);
  mockBookingFindFirst.mockResolvedValue(null);
  mockServiceFindUnique.mockResolvedValue(null);
  mockTransaction.mockImplementation(async () => {
    throw new Error('no transitions in this slice');
  });
});

const cust1 = () => token('user-cust1');
const cust2 = () => token('user-cust2');

describe('Slice 6 — customer booking list', () => {
  it('1. authenticated customer can list own bookings with summary fields', async () => {
    const res = await request(app).get('/api/v1/customers/me/bookings').set('Authorization', `Bearer ${cust1()}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const ids = res.body.data.map((b: { id: string }) => b.id);
    expect(ids).toContain('cb-pending');
    expect(ids).not.toContain('cb-other');
    const first = res.body.data.find((b: { id: string }) => b.id === 'cb-pending');
    expect(first.reference).toBe('uuid-cb-pending');
    expect(first.providerName).toBe('Sharp Cuts');
    expect(first.serviceName).toBe('Fade');
    expect(first.scheduledStart).toBeDefined();
    expect(first.scheduledEnd).toBeDefined();
    expect(first.status).toBe('PENDING');
    expect(first.totalAmount).toBe(200);
    expect(first.paymentStatus).toBe('PENDING');
    expect(first.locationSummary).toBe('Johannesburg, Gauteng');
    expect(res.body.meta).toMatchObject({ page: 1, perPage: 20 });
    expect(res.body.meta.total).toBeGreaterThanOrEqual(7);
  });

  it('2. unauthenticated access rejected on list and detail', async () => {
    expect((await request(app).get('/api/v1/customers/me/bookings')).status).toBe(401);
    expect((await request(app).get('/api/v1/customers/me/bookings/cb-pending')).status).toBe(401);
  });

  it('3. customer cannot list another customer bookings', async () => {
    const res = await request(app).get('/api/v1/customers/me/bookings').set('Authorization', `Bearer ${cust2()}`);
    expect(res.status).toBe(200);
    expect(res.body.data.map((b: { id: string }) => b.id)).toEqual(['cb-other']);
  });

  it('16. canonical status filtering works (no invented statuses)', async () => {
    const get = (status: string) =>
      request(app).get('/api/v1/customers/me/bookings').query({ status }).set('Authorization', `Bearer ${cust1()}`);
    expect((await get('upcoming')).body.data.map((b: { id: string }) => b.id)).toEqual(['cb-pending', 'cb-paid', 'cb-unit']);
    expect((await get('accepted')).body.data.map((b: { id: string }) => b.id)).toEqual(['cb-accepted']);
    expect((await get('active')).body.data.map((b: { id: string }) => b.id)).toEqual(['cb-active']);
    expect((await get('completed')).body.data.map((b: { id: string }) => b.id)).toEqual(['cb-completed']);
    expect((await get('declined')).body.data.map((b: { id: string }) => b.id)).toEqual(['cb-declined']);
    expect((await get('cancelled')).body.data.map((b: { id: string }) => b.id)).toEqual(['cb-cancelled']);
    expect((await get('all')).body.meta.total).toBe(8);
  });

  it('17. pagination works with sane limits', async () => {
    const p1 = await request(app).get('/api/v1/customers/me/bookings').query({ page: 1, perPage: 2 }).set('Authorization', `Bearer ${cust1()}`);
    expect(p1.body.data).toHaveLength(2);
    expect(p1.body.meta).toMatchObject({ page: 1, perPage: 2, total: 8 });
    // Pagination abuse guard: perPage above the max is rejected, not silently honored.
    const capped = await request(app).get('/api/v1/customers/me/bookings').query({ perPage: 100 }).set('Authorization', `Bearer ${cust1()}`);
    expect(capped.status).toBe(422);
    expect(capped.body.error.code).toBe('VALIDATION_ERROR');
    const maxed = await request(app).get('/api/v1/customers/me/bookings').query({ perPage: 50 }).set('Authorization', `Bearer ${cust1()}`);
    expect(maxed.body.meta.perPage).toBe(50);
    const bad = await request(app).get('/api/v1/customers/me/bookings').query({ page: 0 }).set('Authorization', `Bearer ${cust1()}`);
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('19. authorization does not trust client-supplied customer identity', async () => {
    const res = await request(app)
      .get('/api/v1/customers/me/bookings')
      .query({ customerId: 'cust-2', userId: 'user-cust2' })
      .set('Authorization', `Bearer ${cust1()}`);
    expect(res.status).toBe(200);
    expect(res.body.data.map((b: { id: string }) => b.id)).not.toContain('cb-other');
  });

  it('internal errors stay safe (no SQL/prisma leakage)', async () => {
    mockBookingFindMany.mockRejectedValueOnce(new Error('SELECT * FROM bookings WHERE boom -- prisma P2002'));
    const res = await request(app).get('/api/v1/customers/me/bookings').set('Authorization', `Bearer ${cust1()}`);
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(res.body)).not.toMatch(/SELECT|prisma/i);
  });
});

describe('Slice 6 — customer booking detail', () => {
  it('4. customer can retrieve own booking', async () => {
    const res = await request(app).get('/api/v1/customers/me/bookings/cb-pending').set('Authorization', `Bearer ${cust1()}`);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe('cb-pending');
    expect(res.body.data.reference).toBe('uuid-cb-pending');
  });

  it('5. cross-customer booking detail returns safe 404', async () => {
    const res = await request(app).get('/api/v1/customers/me/bookings/cb-other').set('Authorization', `Bearer ${cust1()}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('BOOKING_NOT_FOUND');
  });

  it('6. missing provider follows existing rules (no fabricated provider data)', async () => {
    store['cb-noprov'] = mkBooking({ id: 'cb-noprov', uuid: 'uuid-cb-noprov', provider: null });
    const res = await request(app).get('/api/v1/customers/me/bookings/cb-noprov').set('Authorization', `Bearer ${cust1()}`);
    expect(res.status).toBe(200);
    expect(res.body.data.providerName).toBeNull();
  });

  it('7/8/9. snapshots returned and price/duration preserved', async () => {
    const res = await request(app).get('/api/v1/customers/me/bookings/cb-pending').set('Authorization', `Bearer ${cust1()}`);
    const item = res.body.data.items[0];
    expect(item.serviceNameSnapshot).toBe('Fade');
    expect(item.serviceDescriptionSnapshot).toBe('Classic fade');
    expect(item.unitPrice).toBe(200);
    expect(item.durationMinutes).toBe(30);
    expect(item.lineTotal).toBe(200);
    expect(res.body.data.totalAmount).toBe(200);
  });

  it('10. schedule/timezone returned correctly', async () => {
    const res = await request(app).get('/api/v1/customers/me/bookings/cb-pending').set('Authorization', `Bearer ${cust1()}`);
    expect(res.body.data.timezone).toBe('Africa/Johannesburg');
    const ms = new Date(res.body.data.scheduledEnd).getTime() - new Date(res.body.data.scheduledStart).getTime();
    expect(ms).toBe(30 * 60 * 1000);
  });

  it('11. payment status separate from booking status', async () => {
    const res = await request(app).get('/api/v1/customers/me/bookings/cb-paid').set('Authorization', `Bearer ${cust1()}`);
    expect(res.body.data.status).toBe('PENDING');
    expect(res.body.data.paymentStatus).toBe('PAID');
    expect(res.body.data.payment.method).toBe('cash');
    expect(res.body.data.payment.status).toBe('PAID');
    expect(res.body.data.payment.amount).toBe(200);
    expect(res.body.data.status).not.toBe('COMPLETED');
  });

  it('12/13. cash payment details and change information preserved', async () => {
    const res = await request(app).get('/api/v1/customers/me/bookings/cb-paid').set('Authorization', `Bearer ${cust1()}`);
    expect(res.body.data.paymentMethod).toBe('cash');
    expect(res.body.data.cash).toMatchObject({ changeRequested: true, amountTendered: 250, changeAmount: 50 });
  });

  it('business name resolved for business-unit bookings without N+1 failure', async () => {
    const res = await request(app).get('/api/v1/customers/me/bookings/cb-unit').set('Authorization', `Bearer ${cust1()}`);
    expect(res.status).toBe(200);
    expect(res.body.data.businessName).toBe('Sandton Branch');
  });

  it('20. precise location privacy: redacted while PENDING, full once ACCEPTED', async () => {
    const pending = await request(app).get('/api/v1/customers/me/bookings/cb-pending').set('Authorization', `Bearer ${cust1()}`);
    expect(pending.body.data.locationAuthorized).toBe(false);
    expect(pending.body.data.location.redacted).toBe(true);
    expect(pending.body.data.location.latitude).toBeNull();
    expect(pending.body.data.location.addressLine1).toBeNull();
    expect(pending.body.data.location.city).toBe('Johannesburg');

    const accepted = await request(app).get('/api/v1/customers/me/bookings/cb-accepted').set('Authorization', `Bearer ${cust1()}`);
    expect(accepted.body.data.locationAuthorized).toBe(true);
    expect(accepted.body.data.location.latitude).toBe(-26.2);
    expect(accepted.body.data.location.addressLine1).toBe('10 Main Rd');
  });

  it('21. historical booking location remains unchanged (snapshot, not live profile data)', async () => {
    const res = await request(app).get('/api/v1/customers/me/bookings/cb-pending').set('Authorization', `Bearer ${cust1()}`);
    expect(res.body.data.location.city).toBe('Johannesburg');
    expect(res.body.data.location.addressLine1).toBeNull(); // redacted, but…
    const accepted = await request(app).get('/api/v1/customers/me/bookings/cb-accepted').set('Authorization', `Bearer ${cust1()}`);
    expect(accepted.body.data.location.addressLine1).toBe('10 Main Rd');
    expect(accepted.body.data.location.postalCode).toBe('2196');
  });

  it('22. no provider navigation exposed through customer endpoint', async () => {
    const res = await request(app).get('/api/v1/customers/me/bookings/cb-accepted').set('Authorization', `Bearer ${cust1()}`);
    const payload = JSON.stringify(res.body.data);
    expect(payload).not.toMatch(/googleMapsUrl|appleMapsUrl|navigationAvailable|Navigate to/i);
    // Provider navigation endpoint itself rejects customers (no provider profile).
    const nav = await request(app).get('/api/v1/providers/me/bookings/cb-accepted/navigation').set('Authorization', `Bearer ${cust1()}`);
    expect(nav.status).toBe(404);
  });
});

describe('Slice 6 — no customer-driven transitions (cancellation deferred)', () => {
  it('14. customer cannot mark booking COMPLETED (no provider profile → provider actions 404)', async () => {
    const res = await request(app).post('/api/v1/providers/me/bookings/cb-pending/accept').set('Authorization', `Bearer ${cust1()}`);
    expect(res.status).toBe(404);
    expect(store['cb-pending'].status).toBe('PENDING');
  });

  it('15. unsupported lifecycle transitions rejected — no customer status forcing (Slice 12 owns POST cancel/reschedule)', async () => {
    // Slice 12 intentionally introduces POST /cancel and POST/PATCH
    // /reschedule as the only customer transitions; their behaviour is
    // covered in customer-booking-actions.test.ts. Anything else that
    // would let the client force status must still not exist.
    const put = await request(app).post('/api/v1/customers/me/bookings/cb-pending/cancel').set('Authorization', `Bearer ${cust1()}`).send({ status: 'COMPLETED' });
    expect(put.status).toBe(422); // strict schema: status can never be client-controlled
    for (const method of ['put'] as const) {
      const r = await (request(app) as unknown as Record<string, (url: string) => request.Test>)[method](
        '/api/v1/customers/me/bookings/cb-pending/cancel',
      ).set('Authorization', `Bearer ${cust1()}`);
      expect(r.status).toBe(404);
    }
    const patch = await request(app).patch('/api/v1/customers/me/bookings/cb-pending').set('Authorization', `Bearer ${cust1()}`).send({ status: 'COMPLETED' });
    expect(patch.status).toBe(404);
    expect(store['cb-pending'].status).toBe('PENDING');
  });

  it('18. tenant isolation — unit booking invisible to other customer', async () => {
    const res = await request(app).get('/api/v1/customers/me/bookings/cb-unit').set('Authorization', `Bearer ${cust2()}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('BOOKING_NOT_FOUND');
  });
});

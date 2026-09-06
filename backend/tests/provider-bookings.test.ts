/**
 * Phase 2 Slice 5 — Provider booking management.
 *
 * Covers the 24 required scenarios: inbox isolation, detail privacy,
 * PENDING → ACCEPTED / DECLINED transitions, conflict protection,
 * payment awareness, cash preservation, location authorization,
 * tenant isolation, and auditability.
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
const mockProviderProfileFindUnique = jest.fn();
const mockCustomerProfileFindUnique = jest.fn();
const mockBusinessFindMany = jest.fn();
const mockBusinessUnitFindMany = jest.fn();
const mockBookingCount = jest.fn();
const mockBookingFindMany = jest.fn();
const mockBookingFindFirst = jest.fn();
const mockBookingFindUnique = jest.fn();
const mockServiceFindUnique = jest.fn();
const mockAuditCreate = jest.fn();
const mockTransaction = jest.fn();

const mockTxBookingFindUnique = jest.fn();
const mockTxBookingFindFirst = jest.fn();
const mockTxBookingUpdate = jest.fn();
const mockTxProviderProfileFindUnique = jest.fn();
const mockTxServiceFindUnique = jest.fn();
const mockTxAuditCreate = jest.fn();

jest.mock('../src/config/prisma', () => ({
  prisma: {
    adminSetting: { findMany: mockAdminSettingFindMany },
    user: { findUnique: mockUserFindUnique },
    providerProfile: { findUnique: mockProviderProfileFindUnique },
    customerProfile: { findUnique: mockCustomerProfileFindUnique },
    business: { findMany: mockBusinessFindMany },
    businessUnit: { findMany: mockBusinessUnitFindMany },
    booking: {
      count: (...a: any[]) => (mockBookingCount as any)(...a),
      findMany: (...a: any[]) => (mockBookingFindMany as any)(...a),
      findFirst: (...a: any[]) => (mockBookingFindFirst as any)(...a),
      findUnique: (...a: any[]) => (mockBookingFindUnique as any)(...a),
    },
    service: { findUnique: (...a: any[]) => (mockServiceFindUnique as any)(...a) },
    auditLog: { create: (...a: any[]) => (mockAuditCreate as any)(...a) },
    $transaction: (...a: any[]) => (mockTransaction as any)(...a),
  },
}));

import { app } from '../src/app';

// ---- fixtures ----
const PROV1 = {
  id: 'prov-1',
  userId: 'user-prov1',
  status: 'ACTIVE',
  tier: { code: 'T1' },
  isStudent: false,
  studentVerificationStatus: 'UNVERIFIED',
};
const PROV2 = {
  id: 'prov-2',
  userId: 'user-prov2',
  status: 'ACTIVE',
  tier: { code: 'T1' },
  isStudent: false,
  studentVerificationStatus: 'UNVERIFIED',
};

function futureAt(hour: string): Date {
  const d = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
  const base = d.toISOString().slice(0, 10);
  return new Date(`${base}T${hour}:00.000Z`);
}

function mkBooking(over: any = {}) {
  const start = futureAt('09:00');
  const end = new Date(start.getTime() + 30 * 60 * 1000);
  return {
    id: 'bk-pending',
    uuid: 'uuid-bk-pending',
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
        id: 'it-1',
        bookingId: 'bk-pending',
        serviceId: 'svc-1',
        serviceNameSnapshot: 'Fade',
        serviceDescriptionSnapshot: 'Desc',
        unitPrice: 200,
        quantity: 1,
        durationMinutes: 30,
        lineTotal: 200,
      },
    ],
    location: {
      id: 'bloc-1',
      bookingId: 'bk-pending',
      locationType: 'PROVIDER',
      addressLine1: '10 Main Rd',
      city: 'Johannesburg',
      province: 'Gauteng',
      postalCode: '2196',
      country: 'ZA',
      latitude: -26.2,
      longitude: 28.0,
    },
    customer: { id: 'cust-1', displayName: 'Test Customer', firstName: 'Test', lastName: 'Customer' },
    payment: null as any,
    cashPaymentDetail: null as any,
    ...over,
  };
}

let store: Record<string, any> = {};
let conflictFixture: any = null;
let serviceOverrides: Record<string, any> = {};

const PROVIDER_BY_USER: Record<string, any> = {
  'user-prov1': PROV1,
  'user-prov2': PROV2,
};
const PROVIDER_BY_ID: Record<string, any> = { 'prov-1': PROV1, 'prov-2': PROV2 };

function scopedList(where: any): any[] {
  const all = Object.values(store);
  const ors: any[] = where?.OR ?? [];
  const inScope = (b: any) =>
    ors.length === 0 ||
    ors.some((c: any) => {
      if (c.providerId && b.providerId === c.providerId) return true;
      if (c.assignedProviderId && b.assignedProviderId === c.assignedProviderId) return true;
      if (c.businessUnitId?.in && b.businessUnitId && c.businessUnitId.in.includes(b.businessUnitId))
        return true;
      return false;
    });
  const statuses: string[] | null = where?.status?.in ?? null;
  return all.filter((b) => inScope(b) && (!statuses || statuses.includes(b.status)));
}

beforeEach(() => {
  jest.clearAllMocks();
  store = {};
  conflictFixture = null;
  serviceOverrides = {};

  const pending = mkBooking();
  store['bk-pending'] = pending;
  store['bk-accepted'] = mkBooking({ id: 'bk-accepted', uuid: 'uuid-bk-accepted', status: 'ACCEPTED' });
  store['bk-completed'] = mkBooking({ id: 'bk-completed', uuid: 'uuid-bk-completed', status: 'COMPLETED' });
  store['bk-cancelled'] = mkBooking({ id: 'bk-cancelled', uuid: 'uuid-bk-cancelled', status: 'CANCELLED' });
  store['bk-declined'] = mkBooking({ id: 'bk-declined', uuid: 'uuid-bk-declined', status: 'DECLINED' });
  store['bk-other'] = mkBooking({ id: 'bk-other', uuid: 'uuid-bk-other', providerId: 'prov-2' });

  mockAdminSettingFindMany.mockResolvedValue([]);
  // Tenant-aware business mocks: only user-prov1 owns biz-1/unit-1 in the T3 test.
  let t3Mode = false;
  (global as any).__waashaT3Mode = (v: boolean) => {
    t3Mode = v;
  };
  mockBusinessFindMany.mockImplementation(async ({ where }: any) => {
    if (t3Mode && where?.ownerProviderId === 'user-prov1') return [{ id: 'biz-1' }];
    return [];
  });
  mockBusinessUnitFindMany.mockImplementation(async () => {
    if (t3Mode) return [{ id: 'unit-1' }];
    return [];
  });
  mockCustomerProfileFindUnique.mockResolvedValue(null);
  mockAuditCreate.mockResolvedValue({});
  mockTxAuditCreate.mockResolvedValue({});

  mockUserFindUnique.mockImplementation(async ({ where }: any) => {
    if (PROVIDER_BY_USER[where?.id]) return { id: where.id, status: 'ACTIVE' } as any;
    if (where?.id === 'user-cust1') return { id: 'user-cust1', status: 'ACTIVE' } as any;
    return null;
  });
  mockProviderProfileFindUnique.mockImplementation(async ({ where }: any) => {
    if (where?.userId) return (PROVIDER_BY_USER[where.userId] as any) ?? null;
    if (where?.id) return (PROVIDER_BY_ID[where.id] as any) ?? null;
    return null;
  });
  mockTxProviderProfileFindUnique.mockImplementation(async ({ where }: any) => {
    if (where?.id) return (PROVIDER_BY_ID[where.id] as any) ?? null;
    if (where?.userId) return (PROVIDER_BY_USER[where.userId] as any) ?? null;
    return null;
  });

  mockBookingFindMany.mockImplementation(async ({ where }: any) => scopedList(where));
  mockBookingCount.mockImplementation(async ({ where }: any) => scopedList(where).length);
  mockBookingFindUnique.mockImplementation(async ({ where }: any) => store[where?.id] ?? null);
  mockBookingFindFirst.mockResolvedValue(null);

  const defaultService = { id: 'svc-1', providerId: 'prov-1', businessUnitId: null, status: 'ACTIVE' };
  mockServiceFindUnique.mockImplementation(async ({ where }: any) => {
    if (serviceOverrides[where?.id]) return serviceOverrides[where.id];
    if (where?.id === 'svc-1') return defaultService as any;
    if (where?.id === 'svc-other') return { id: 'svc-other', providerId: 'prov-2', businessUnitId: null, status: 'ACTIVE' } as any;
    return null;
  });
  mockTxServiceFindUnique.mockImplementation(async ({ where }: any) => {
    if (serviceOverrides[where?.id]) return serviceOverrides[where.id];
    if (where?.id === 'svc-1') return defaultService as any;
    if (where?.id === 'svc-other') return { id: 'svc-other', providerId: 'prov-2', businessUnitId: null, status: 'ACTIVE' } as any;
    return null;
  });

  mockTxBookingFindUnique.mockImplementation(async ({ where }: any) => store[where?.id] ?? null);
  mockTxBookingFindFirst.mockImplementation(async () => conflictFixture);
  mockTxBookingUpdate.mockImplementation(async ({ where, data }: any) => {
    const current = store[where.id];
    if (!current) throw new Error('missing');
    store[where.id] = { ...current, ...data };
    return store[where.id];
  });

  mockTransaction.mockImplementation(async (cb: any) => {
    const tx: any = {
      booking: {
        findUnique: mockTxBookingFindUnique,
        findFirst: mockTxBookingFindFirst,
        update: mockTxBookingUpdate,
      },
      providerProfile: { findUnique: mockTxProviderProfileFindUnique },
      service: { findUnique: mockTxServiceFindUnique },
      auditLog: { create: mockTxAuditCreate },
    };
    return cb(tx);
  });
});

const prov1 = () => token('user-prov1');
const prov2 = () => token('user-prov2');

describe('Slice 5 — provider booking inbox', () => {
  it('1. provider can retrieve own booking inbox with required fields', async () => {
    const res = await request(app).get('/api/v1/providers/me/bookings').set('Authorization', `Bearer ${prov1()}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const ids = res.body.data.map((b: any) => b.id);
    expect(ids).toContain('bk-pending');
    expect(ids).not.toContain('bk-other');
    const first = res.body.data.find((b: any) => b.id === 'bk-pending');
    expect(first.reference).toBe('uuid-bk-pending');
    expect(first.serviceName).toBe('Fade');
    expect(first.scheduledStart).toBeDefined();
    expect(first.durationMinutes).toBe(30);
    expect(first.status).toBe('PENDING');
    expect(first.paymentStatus).toBeDefined();
    expect(first.createdAt).toBeDefined();
  });

  it('2. provider cannot retrieve another provider booking (list excludes, detail 404)', async () => {
    const list = await request(app).get('/api/v1/providers/me/bookings').set('Authorization', `Bearer ${prov1()}`);
    expect(list.body.data.map((b: any) => b.id)).not.toContain('bk-other');
    const detail = await request(app).get('/api/v1/providers/me/bookings/bk-other').set('Authorization', `Bearer ${prov1()}`);
    expect(detail.status).toBe(404);
    expect(detail.body.error.code).toBe('BOOKING_NOT_FOUND');
  });

  it('3. provider can retrieve own booking detail', async () => {
    const res = await request(app).get('/api/v1/providers/me/bookings/bk-pending').set('Authorization', `Bearer ${prov1()}`);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe('bk-pending');
    expect(res.body.data.reference).toBe('uuid-bk-pending');
    expect(res.body.data.items[0].serviceNameSnapshot).toBe('Fade');
    expect(res.body.data.items[0].unitPrice).toBe(200);
    expect(res.body.data.customer.displayName).toBe('Test Customer');
  });

  it('4. unauthorized provider booking access rejected (401 no token, 404 cross-provider)', async () => {
    const noAuth = await request(app).get('/api/v1/providers/me/bookings');
    expect(noAuth.status).toBe(401);
    const cross = await request(app)
      .post('/api/v1/providers/me/bookings/bk-pending/accept')
      .set('Authorization', `Bearer ${prov2()}`);
    expect(cross.status).toBe(404);
    expect(cross.body.error.code).toBe('BOOKING_NOT_FOUND');
  });

  it('incoming/accepted/rejected/completed filters work', async () => {
    const incoming = await request(app).get('/api/v1/providers/me/bookings').query({ status: 'incoming' }).set('Authorization', `Bearer ${prov1()}`);
    expect(incoming.body.data.map((b: any) => b.id)).toEqual(['bk-pending']);
    const accepted = await request(app).get('/api/v1/providers/me/bookings').query({ status: 'accepted' }).set('Authorization', `Bearer ${prov1()}`);
    expect(accepted.body.data.map((b: any) => b.id)).toEqual(['bk-accepted']);
    const rejected = await request(app).get('/api/v1/providers/me/bookings').query({ status: 'rejected' }).set('Authorization', `Bearer ${prov1()}`);
    expect(rejected.body.data.map((b: any) => b.id).sort()).toEqual(['bk-cancelled', 'bk-declined']);
    const completed = await request(app).get('/api/v1/providers/me/bookings').query({ status: 'completed' }).set('Authorization', `Bearer ${prov1()}`);
    expect(completed.body.data.map((b: any) => b.id)).toEqual(['bk-completed']);
  });

  it('provider identity comes from session — no providerId param trusted', async () => {
    // Even if a client passes providerId, the inbox is scoped to the session provider.
    const res = await request(app)
      .get('/api/v1/providers/me/bookings')
      .query({ providerId: 'prov-2' })
      .set('Authorization', `Bearer ${prov1()}`);
    expect(res.status).toBe(200);
    expect(res.body.data.map((b: any) => b.id)).not.toContain('bk-other');
  });
});

describe('Slice 5 — accept / reject transitions', () => {
  it('5. pending booking can be accepted (PENDING → ACCEPTED)', async () => {
    const res = await request(app).post('/api/v1/providers/me/bookings/bk-pending/accept').set('Authorization', `Bearer ${prov1()}`);
    expect(res.status).toBe(200);
    expect(res.body.data.previousStatus).toBe('PENDING');
    expect(res.body.data.status).toBe('ACCEPTED');
    expect(store['bk-pending'].status).toBe('ACCEPTED');
  });

  it('6. pending booking can be rejected (PENDING → DECLINED)', async () => {
    const res = await request(app).post('/api/v1/providers/me/bookings/bk-pending/reject').set('Authorization', `Bearer ${prov1()}`);
    expect(res.status).toBe(200);
    expect(res.body.data.previousStatus).toBe('PENDING');
    expect(res.body.data.status).toBe('DECLINED');
    expect(store['bk-pending'].status).toBe('DECLINED');
  });

  it('7. invalid status transition rejected (accept ACCEPTED → 422)', async () => {
    const res = await request(app).post('/api/v1/providers/me/bookings/bk-accepted/accept').set('Authorization', `Bearer ${prov1()}`);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('BOOKING_INVALID_STATE');
  });

  it('7b. reject COMPLETED → 422, never backwards', async () => {
    const res = await request(app).post('/api/v1/providers/me/bookings/bk-completed/reject').set('Authorization', `Bearer ${prov1()}`);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('BOOKING_INVALID_STATE');
    expect(store['bk-completed'].status).toBe('COMPLETED');
  });

  it('8. completed booking cannot be accepted', async () => {
    const res = await request(app).post('/api/v1/providers/me/bookings/bk-completed/accept').set('Authorization', `Bearer ${prov1()}`);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('BOOKING_INVALID_STATE');
  });

  it('9. cancelled/rejected booking cannot be accepted', async () => {
    const c = await request(app).post('/api/v1/providers/me/bookings/bk-cancelled/accept').set('Authorization', `Bearer ${prov1()}`);
    expect(c.status).toBe(422);
    const r = await request(app).post('/api/v1/providers/me/bookings/bk-declined/accept').set('Authorization', `Bearer ${prov1()}`);
    expect(r.status).toBe(422);
  });

  it('never COMPLETED directly from PENDING via provider action', async () => {
    const res = await request(app).post('/api/v1/providers/me/bookings/bk-pending/accept').set('Authorization', `Bearer ${prov1()}`);
    expect(res.body.data.status).not.toBe('COMPLETED');
  });

  it('10. provider/service mismatch rejected', async () => {
    store['bk-mismatch'] = mkBooking({ id: 'bk-mismatch', uuid: 'uuid-bk-mismatch', serviceId: 'svc-other' });
    const res = await request(app).post('/api/v1/providers/me/bookings/bk-mismatch/accept').set('Authorization', `Bearer ${prov1()}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('PROVIDER_SERVICE_MISMATCH');
    expect(store['bk-mismatch'].status).toBe('PENDING');
  });

  it('11/12. acceptance re-checks availability — overlapping PENDING and ACCEPTED both 409', async () => {
    conflictFixture = { id: 'overlap-pending', status: 'PENDING' };
    const r1 = await request(app).post('/api/v1/providers/me/bookings/bk-pending/accept').set('Authorization', `Bearer ${prov1()}`);
    expect(r1.status).toBe(409);
    expect(r1.body.error.code).toBe('BOOKING_CONFLICT');
    expect(store['bk-pending'].status).toBe('PENDING');

    conflictFixture = { id: 'overlap-accepted', status: 'ACCEPTED' };
    const r2 = await request(app).post('/api/v1/providers/me/bookings/bk-pending/accept').set('Authorization', `Bearer ${prov1()}`);
    expect(r2.status).toBe(409);
  });

  it('13. concurrent acceptance cannot double-book (second sees committed ACCEPTED)', async () => {
    const first = await request(app).post('/api/v1/providers/me/bookings/bk-pending/accept').set('Authorization', `Bearer ${prov1()}`);
    expect(first.status).toBe(200);
    const second = await request(app).post('/api/v1/providers/me/bookings/bk-pending/accept').set('Authorization', `Bearer ${prov1()}`);
    expect(second.status).toBe(422);
    expect(second.body.error.code).toBe('BOOKING_INVALID_STATE');
  });

  it('14/15. historical price + duration snapshots unchanged by acceptance', async () => {
    await request(app).post('/api/v1/providers/me/bookings/bk-pending/accept').set('Authorization', `Bearer ${prov1()}`);
    expect(mockTxBookingUpdate).toHaveBeenCalledTimes(1);
    expect(mockTxBookingUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'bk-pending' }, data: { status: 'ACCEPTED' } }),
    );
    const item = store['bk-pending'].items[0];
    expect(item.unitPrice).toBe(200);
    expect(item.durationMinutes).toBe(30);
    expect(item.serviceNameSnapshot).toBe('Fade');
  });
});

describe('Slice 5 — payment awareness + cash', () => {
  beforeEach(() => {
    store['bk-paid'] = mkBooking({
      id: 'bk-paid',
      uuid: 'uuid-bk-paid',
      paymentMethod: 'cash',
      paymentStatus: 'PAID',
      payment: {
        id: 'pay-1',
        method: 'cash',
        gateway: 'manual_cash',
        status: 'PAID',
        amount: 200,
        currency: 'ZAR',
        commissionRate: 25,
        commissionAmount: 50,
        providerReference: null,
        paidAt: new Date(),
      },
      cashPaymentDetail: { changeRequested: true, amountTendered: 250, changeAmount: 50 },
    });
  });

  it('16. payment status is read from existing payment architecture', async () => {
    const res = await request(app).get('/api/v1/providers/me/bookings/bk-paid').set('Authorization', `Bearer ${prov1()}`);
    expect(res.status).toBe(200);
    expect(res.body.data.payment.method).toBe('cash');
    expect(res.body.data.payment.status).toBe('PAID');
    expect(res.body.data.payment.gateway).toBe('manual_cash');
    expect(res.body.data.payment.commissionRate).toBe(25);
  });

  it('17. payment PAID does not mark service completed (accept keeps lifecycle separate)', async () => {
    const res = await request(app).post('/api/v1/providers/me/bookings/bk-paid/accept').set('Authorization', `Bearer ${prov1()}`);
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('ACCEPTED');
    expect(res.body.data.paymentStatus).toBe('PAID');
    expect(store['bk-paid'].status).not.toBe('COMPLETED');
  });

  it('18. cash payment state preserved (change request, tendered, change amount)', async () => {
    const res = await request(app).get('/api/v1/providers/me/bookings/bk-paid').set('Authorization', `Bearer ${prov1()}`);
    expect(res.body.data.paymentMethod).toBe('cash');
    expect(res.body.data.cash.changeRequested).toBe(true);
    expect(res.body.data.cash.amountTendered).toBe(250);
    expect(res.body.data.cash.changeAmount).toBe(50);
  });

  it('19. cash cap + commission business rules remain enforced and unchanged', async () => {
    const { getCashCapForProvider } = await import('../src/modules/finance/cash-caps.service');
    const { getCommissionRateForProvider } = await import('../src/modules/finance/commission.service');
    const t1 = { isStudent: false, studentVerificationStatus: 'UNVERIFIED', tier: { code: 'T1' } };
    const student = { isStudent: true, studentVerificationStatus: 'VERIFIED', tier: { code: 'T1' } };
    expect(await getCommissionRateForProvider(t1 as any)).toBe(25);
    expect(await getCommissionRateForProvider(student as any)).toBe(16);
    expect(await getCashCapForProvider(t1 as any)).toBe(1000);
    expect(await getCashCapForProvider(student as any)).toBe(500);
    const t3 = { isStudent: false, studentVerificationStatus: 'UNVERIFIED', tier: { code: 'T3' } };
    expect(await getCashCapForProvider(t3 as any)).toBe(5000);
  });
});

describe('Slice 5 — location privacy + navigation', () => {
  it('20. precise location unavailable before authorization (PENDING redacted)', async () => {
    const res = await request(app).get('/api/v1/providers/me/bookings/bk-pending').set('Authorization', `Bearer ${prov1()}`);
    expect(res.status).toBe(200);
    expect(res.body.data.locationAuthorized).toBe(false);
    expect(res.body.data.location.latitude).toBeNull();
    expect(res.body.data.location.longitude).toBeNull();
    expect(res.body.data.location.addressLine1).toBeNull();
    expect(res.body.data.location.redacted).toBe(true);
    // Non-precise city context may remain for logistics.
    expect(res.body.data.location.city).toBe('Johannesburg');
  });

  it('21. precise location available after required authorization (ACCEPTED full)', async () => {
    const res = await request(app).get('/api/v1/providers/me/bookings/bk-accepted').set('Authorization', `Bearer ${prov1()}`);
    expect(res.status).toBe(200);
    expect(res.body.data.locationAuthorized).toBe(true);
    expect(res.body.data.location.latitude).toBe(-26.2);
    expect(res.body.data.location.longitude).toBe(28.0);
    expect(res.body.data.location.addressLine1).toBe('10 Main Rd');
    expect(res.body.data.location.redacted).toBe(false);
  });

  it('navigation blocked before authorization, allowed after, with deep links', async () => {
    const blocked = await request(app).get('/api/v1/providers/me/bookings/bk-pending/navigation').set('Authorization', `Bearer ${prov1()}`);
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('LOCATION_NOT_AUTHORIZED');

    const allowed = await request(app).get('/api/v1/providers/me/bookings/bk-accepted/navigation').set('Authorization', `Bearer ${prov1()}`);
    expect(allowed.status).toBe(200);
    expect(allowed.body.data.latitude).toBe(-26.2);
    expect(allowed.body.data.googleMapsUrl).toMatch(/google\.com\/maps/);
    expect(allowed.body.data.appleMapsUrl).toMatch(/maps\.apple\.com/);
  });

  it('22. provider navigation data cannot be accessed by unauthorized provider', async () => {
    const res = await request(app).get('/api/v1/providers/me/bookings/bk-accepted/navigation').set('Authorization', `Bearer ${prov2()}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('BOOKING_NOT_FOUND');
  });
});

describe('Slice 5 — tenant isolation + audit', () => {
  it('23. tenant isolation — T3 owner sees business-unit booking, outsider does not', async () => {
    // providerId null forces scope resolution via business-unit ownership alone.
    store['bk-unit'] = mkBooking({
      id: 'bk-unit',
      uuid: 'uuid-bk-unit',
      providerId: null,
      businessUnitId: 'unit-1',
      serviceId: 'svc-1',
    });
    (global as any).__waashaT3Mode(true);

    const owner = await request(app).get('/api/v1/providers/me/bookings/bk-unit').set('Authorization', `Bearer ${prov1()}`);
    expect(owner.status).toBe(200);

    const outsider = await request(app).get('/api/v1/providers/me/bookings/bk-unit').set('Authorization', `Bearer ${prov2()}`);
    expect(outsider.status).toBe(404);
  });

  it('24. audit/event generated for state transition (who, what, before, after)', async () => {
    await request(app).post('/api/v1/providers/me/bookings/bk-pending/accept').set('Authorization', `Bearer ${prov1()}`);
    expect(mockTxAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorUserId: 'user-prov1',
          action: 'BOOKING_ACCEPTED',
          entityType: 'booking',
          entityId: 'bk-pending',
          beforeJson: expect.objectContaining({ status: 'PENDING' }),
          afterJson: expect.objectContaining({ status: 'ACCEPTED' }),
        }),
      }),
    );
    // No sensitive payment credentials or precise coordinates in audit payload.
    const payload = JSON.stringify(mockTxAuditCreate.mock.calls[0][0]);
    expect(payload).not.toMatch(/-26\.2/);
    expect(payload).not.toMatch(/secret|PAYSTACK/i);

    await request(app).post('/api/v1/providers/me/bookings/bk-accepted/reject').set('Authorization', `Bearer ${prov1()}`).catch(() => {});
    // bk-accepted is ACCEPTED → reject invalid; use fresh pending for decline audit
    store['bk-pending2'] = mkBooking({ id: 'bk-pending2', uuid: 'uuid-bk-pending2' });
    await request(app).post('/api/v1/providers/me/bookings/bk-pending2/reject').set('Authorization', `Bearer ${prov1()}`);
    const actions = mockTxAuditCreate.mock.calls.map((c: any) => c[0].data.action);
    expect(actions).toContain('BOOKING_DECLINED');
  });

  it('booking is never silently deleted by rejection', async () => {
    await request(app).post('/api/v1/providers/me/bookings/bk-pending/reject').set('Authorization', `Bearer ${prov1()}`);
    expect(store['bk-pending']).toBeDefined();
    expect(store['bk-pending'].status).toBe('DECLINED');
    expect(store['bk-pending'].items[0].unitPrice).toBe(200);
  });
});

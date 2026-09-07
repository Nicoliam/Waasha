/**
 * Phase 2 Slice 12 — Customer booking actions (cancel / reschedule).
 *
 * Server-authoritative, transactional, audited, notified. Ownership always
 * derives from the authenticated session. Prisma is mocked at the module
 * boundary; the real route → service → notification code runs unmodified.
 */
import * as fs from 'fs';
import * as path from 'path';
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
const mockBookingCount = jest.fn();
const mockBookingFindMany = jest.fn();
const mockBookingFindFirst = jest.fn();
const mockBookingFindUnique = jest.fn();
const mockBookingUpdate = jest.fn();
const mockPaymentUpdate = jest.fn();
const mockAuditCreate = jest.fn();
const mockNotificationCreate = jest.fn();
const mockNotificationPreferenceFindUnique = jest.fn();
const mockTransaction = jest.fn();
const mockGetSlots = jest.fn();

jest.mock('../src/config/prisma', () => ({
  prisma: {
    adminSetting: { findMany: (...a: any[]) => (mockAdminSettingFindMany as any)(...a) },
    user: { findUnique: (...a: any[]) => (mockUserFindUnique as any)(...a) },
    customerProfile: { findUnique: (...a: any[]) => (mockCustomerProfileFindUnique as any)(...a) },
    providerProfile: { findUnique: (...a: any[]) => (mockProviderProfileFindUnique as any)(...a) },
    booking: {
      count: (...a: any[]) => (mockBookingCount as any)(...a),
      findMany: (...a: any[]) => (mockBookingFindMany as any)(...a),
      findFirst: (...a: any[]) => (mockBookingFindFirst as any)(...a),
      findUnique: (...a: any[]) => (mockBookingFindUnique as any)(...a),
      update: (...a: any[]) => (mockBookingUpdate as any)(...a),
    },
    payment: { update: (...a: any[]) => (mockPaymentUpdate as any)(...a) },
    notification: { create: (...a: any[]) => (mockNotificationCreate as any)(...a) },
    notificationPreference: { findUnique: (...a: any[]) => (mockNotificationPreferenceFindUnique as any)(...a) },
    auditLog: { create: (...a: any[]) => (mockAuditCreate as any)(...a) },
    $transaction: (...a: any[]) => (mockTransaction as any)(...a),
  },
}));

jest.mock('../src/modules/bookings/availability.service', () => {
  const actual = jest.requireActual('../src/modules/bookings/availability.service');
  return { ...actual, getAvailabilitySlots: (...a: any[]) => (mockGetSlots as any)(...a) };
});

import { app } from '../src/app';

// ---- fixtures ----
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function mkBooking(over: Record<string, unknown> = {}) {
  const start = new Date(Date.now() + 2 * DAY);
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
    createdAt: new Date(Date.now() - DAY),
    updatedAt: new Date(Date.now() - HOUR),
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
      id: 'loc-1',
      locationType: 'PROVIDER',
      addressLine1: '10 Main Rd',
      city: 'Johannesburg',
      province: 'Gauteng',
      postalCode: '2196',
      country: 'ZA',
      latitude: -26.2,
      longitude: 28.0,
    },
    payment: null as Record<string, unknown> | null,
    cashPaymentDetail: null as Record<string, unknown> | null,
    ...over,
  };
}

type Store = Record<string, ReturnType<typeof mkBooking>>;
let store: Store = {};

/** Fixed reschedule target: 3 days out, 10:00 UTC. */
const NEW_START_ISO = new Date(Math.ceil((Date.now() + 3 * DAY) / HOUR) * HOUR).toISOString();
const NEW_END_ISO = new Date(new Date(NEW_START_ISO).getTime() + 30 * 60 * 1000).toISOString();

function defaultSlots() {
  return {
    slots: [{ start: NEW_START_ISO, end: NEW_END_ISO, displayStart: '12:00', displayEnd: '12:30' }],
    providerId: 'prov-1',
    serviceId: 'svc-1',
    date: NEW_START_ISO.slice(0, 10),
    timezone: 'Africa/Johannesburg',
  };
}

function findOverlap(where: any) {
  const lt = new Date(where?.scheduledStart?.lt).getTime();
  const gt = new Date(where?.scheduledEnd?.gt).getTime();
  if (!Number.isFinite(lt) || !Number.isFinite(gt)) return null;
  const statuses: string[] = where?.status?.in ?? [];
  return (
    Object.values(store).find(
      (b) =>
        b.id !== where?.NOT?.id &&
        statuses.includes(b.status as string) &&
        new Date(b.scheduledStart as Date).getTime() < lt &&
        new Date(b.scheduledEnd as Date).getTime() > gt,
    ) ?? null
  );
}

const tx = {
  booking: {
    findUnique: async ({ where }: any) => store[where?.id] ?? null,
    findFirst: async (args: any) => findOverlap(args?.where),
    update: async ({ where, data }: any) => {
      const b = store[where?.id];
      if (!b) throw new Error('not found');
      Object.assign(b, data, { updatedAt: new Date() });
      return { ...b, items: b.items };
    },
  },
  auditLog: { create: (...a: any[]) => (mockAuditCreate as any)(...a) },
};

let notifSeq = 0;

beforeEach(() => {
  jest.clearAllMocks();
  notifSeq = 0;
  store = {};
  store['cb-pending'] = mkBooking();
  store['cb-accepted'] = mkBooking({ id: 'cb-accepted', uuid: 'uuid-cb-accepted', status: 'ACCEPTED' });
  store['cb-completed'] = mkBooking({ id: 'cb-completed', uuid: 'uuid-cb-completed', status: 'COMPLETED' });
  store['cb-cancelled'] = mkBooking({ id: 'cb-cancelled', uuid: 'uuid-cb-cancelled', status: 'CANCELLED' });
  store['cb-active'] = mkBooking({ id: 'cb-active', uuid: 'uuid-cb-active', status: 'IN_PROGRESS' });
  store['cb-declined'] = mkBooking({ id: 'cb-declined', uuid: 'uuid-cb-declined', status: 'DECLINED' });
  store['cb-other'] = mkBooking({ id: 'cb-other', uuid: 'uuid-cb-other', customerId: 'cust-2' });
  store['cb-started'] = mkBooking({
    id: 'cb-started',
    uuid: 'uuid-cb-started',
    scheduledStart: new Date(Date.now() - 10 * 60 * 1000),
    scheduledEnd: new Date(Date.now() + 20 * 60 * 1000),
  });
  store['cb-soon'] = mkBooking({
    id: 'cb-soon',
    uuid: 'uuid-cb-soon',
    scheduledStart: new Date(Date.now() + 30 * 60 * 1000),
    scheduledEnd: new Date(Date.now() + 60 * 60 * 1000),
  });
  store['cb-paid'] = mkBooking({
    id: 'cb-paid',
    uuid: 'uuid-cb-paid',
    status: 'PAID',
    paymentMethod: 'cash',
    paymentStatus: 'PAID',
    payment: { method: 'cash', gateway: 'manual_cash', status: 'PAID', amount: 200, currency: 'ZAR', providerReference: null, paidAt: new Date() },
    cashPaymentDetail: { changeRequested: true, amountTendered: 250, changeAmount: 50 },
  });

  mockAdminSettingFindMany.mockResolvedValue([]);
  mockAuditCreate.mockResolvedValue({});
  mockNotificationPreferenceFindUnique.mockResolvedValue(null);
  mockNotificationCreate.mockImplementation(async ({ data }: any) => {
    notifSeq += 1;
    return {
      id: `notif-${notifSeq}`,
      recipientUserId: data.recipientUserId,
      audience: data.audience,
      type: data.type,
      channel: 'IN_APP',
      status: 'UNREAD',
      title: data.title,
      message: data.message,
      entityType: data.entityType ?? null,
      entityId: data.entityId ?? null,
      readAt: null,
      createdAt: new Date(),
    };
  });
  mockUserFindUnique.mockImplementation(async ({ where }: any) => {
    if (['user-cust1', 'user-cust2'].includes(where?.id)) return { id: where.id, status: 'ACTIVE' } as never;
    return null;
  });
  mockCustomerProfileFindUnique.mockImplementation(async ({ where }: any) => {
    if (where?.userId === 'user-cust1') return { id: 'cust-1', userId: 'user-cust1' } as never;
    if (where?.userId === 'user-cust2') return { id: 'cust-2', userId: 'user-cust2' } as never;
    if (where?.id === 'cust-1') return { id: 'cust-1', userId: 'user-cust1', displayName: 'Cust One' } as never;
    if (where?.id === 'cust-2') return { id: 'cust-2', userId: 'user-cust2', displayName: 'Cust Two' } as never;
    return null;
  });
  mockProviderProfileFindUnique.mockImplementation(async ({ where }: any) => {
    if (where?.id === 'prov-1') return { id: 'prov-1', userId: 'user-prov1', displayName: 'Sharp Cuts' } as never;
    return null;
  });
  mockBookingFindUnique.mockImplementation(async ({ where }: any) => store[where?.id] ?? null);
  mockBookingFindFirst.mockImplementation(async (args: any) => findOverlap(args?.where));
  mockBookingFindMany.mockResolvedValue([]);
  mockBookingCount.mockResolvedValue(0);
  mockBookingUpdate.mockRejectedValue(new Error('direct update not allowed in this slice'));
  mockPaymentUpdate.mockRejectedValue(new Error('payment mutation not allowed in this slice'));
  mockTransaction.mockImplementation(async (cb: any) => (cb as any)(tx));
  mockGetSlots.mockImplementation(async () => defaultSlots());
});

const cust1 = () => token('user-cust1');
const cust2 = () => token('user-cust2');
const auth1 = { Authorization: `Bearer ${cust1()}` };

function notifTypes(): string[] {
  return mockNotificationCreate.mock.calls.map((c: any) => c[0]?.data?.type);
}
function notifKeys(): string[] {
  return mockNotificationCreate.mock.calls.map((c: any) => c[0]?.data?.eventKey);
}

describe('Slice 12 — customer cancellation', () => {
  it('1. customer cancellation happy path (PENDING → CANCELLED)', async () => {
    const res = await request(app).post('/api/v1/customers/me/bookings/cb-pending/cancel').set(auth1).send({});
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({ id: 'cb-pending', previousStatus: 'PENDING', status: 'CANCELLED' });
    expect(store['cb-pending'].status).toBe('CANCELLED');
  });

  it('2. customer can cancel an ACCEPTED booking', async () => {
    const res = await request(app).post('/api/v1/customers/me/bookings/cb-accepted/cancel').set(auth1).send({});
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('CANCELLED');
  });

  it('3. cancellation reason is validated and stored only in audit', async () => {
    const res = await request(app)
      .post('/api/v1/customers/me/bookings/cb-pending/cancel')
      .set(auth1)
      .send({ reason: 'Plans changed' });
    expect(res.status).toBe(200);
    const audit = mockAuditCreate.mock.calls[0][0];
    expect(audit.data.action).toBe('CUSTOMER_BOOKING_CANCELLED');
    expect(audit.data.afterJson.cancellationReason).toBe('Plans changed');
    // Reason never leaks into the response or booking snapshots.
    expect(JSON.stringify(res.body)).not.toContain('Plans changed');
  });

  it('4. unauthenticated cancellation → 401', async () => {
    expect((await request(app).post('/api/v1/customers/me/bookings/cb-pending/cancel').send({})).status).toBe(401);
  });

  it('5. cross-customer cancellation → safe 404', async () => {
    const res = await request(app)
      .post('/api/v1/customers/me/bookings/cb-other/cancel')
      .set(auth1)
      .send({});
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('BOOKING_NOT_FOUND');
    expect(store['cb-other'].status).toBe('PENDING');
  });

  it('6. COMPLETED cannot be cancelled → 422', async () => {
    const res = await request(app).post('/api/v1/customers/me/bookings/cb-completed/cancel').set(auth1).send({});
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('BOOKING_INVALID_STATE');
    expect(store['cb-completed'].status).toBe('COMPLETED');
  });

  it('7. already-CANCELLED / DECLINED / IN_PROGRESS cannot be cancelled → 422', async () => {
    for (const id of ['cb-cancelled', 'cb-declined', 'cb-active']) {
      const res = await request(app).post(`/api/v1/customers/me/bookings/${id}/cancel`).set(auth1).send({});
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('BOOKING_INVALID_STATE');
    }
  });

  it('8. cancellation after start (window closed) → 422, state preserved', async () => {
    const res = await request(app).post('/api/v1/customers/me/bookings/cb-started/cancel').set(auth1).send({});
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('BOOKING_CANCELLATION_WINDOW_CLOSED');
    expect(store['cb-started'].status).toBe('PENDING');
  });

  it('9. cancellation reason over 500 chars → 422', async () => {
    const res = await request(app)
      .post('/api/v1/customers/me/bookings/cb-pending/cancel')
      .set(auth1)
      .send({ reason: 'x'.repeat(501) });
    expect(res.status).toBe(422);
    expect(store['cb-pending'].status).toBe('PENDING');
  });

  it('10. non-string cancellation reason → 422', async () => {
    const res = await request(app)
      .post('/api/v1/customers/me/bookings/cb-pending/cancel')
      .set(auth1)
      .send({ reason: 42 });
    expect(res.status).toBe(422);
    expect(store['cb-pending'].status).toBe('PENDING');
  });

  it('11. mass-assignment fields rejected (customerId, status, price, providerId) → 422', async () => {
    const res = await request(app)
      .post('/api/v1/customers/me/bookings/cb-pending/cancel')
      .set(auth1)
      .send({ customerId: 'cust-2', userId: 'x', tenantId: 't', status: 'COMPLETED', price: 1, providerId: 'prov-9' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(store['cb-pending'].status).toBe('PENDING');
  });

  it('12. unknown booking → safe 404', async () => {
    const res = await request(app).post('/api/v1/customers/me/bookings/nope/cancel').set(auth1).send({});
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('BOOKING_NOT_FOUND');
  });

  it('13. concurrent provider-side transition invalidates cancel (re-read committed state)', async () => {
    // Client saw PENDING; provider flow committed IN_PROGRESS before our transaction re-read.
    store['cb-pending'].status = 'IN_PROGRESS';
    const res = await request(app).post('/api/v1/customers/me/bookings/cb-pending/cancel').set(auth1).send({});
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('BOOKING_INVALID_STATE');
  });

  it('14. cancellation while payment finalizes still succeeds with payment preserved', async () => {
    const before = JSON.stringify(store['cb-paid'].payment);
    const res = await request(app).post('/api/v1/customers/me/bookings/cb-paid/cancel').set(auth1).send({});
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('CANCELLED');
    expect(JSON.stringify(store['cb-paid'].payment)).toBe(before);
    expect(mockPaymentUpdate).not.toHaveBeenCalled();
  });

  it('15. no automatic refund: cancellation never mutates payments', async () => {
    await request(app).post('/api/v1/customers/me/bookings/cb-paid/cancel').set(auth1).send({});
    expect(mockPaymentUpdate).not.toHaveBeenCalled();
    expect(store['cb-paid'].paymentStatus).toBe('PAID');
    const audit = mockAuditCreate.mock.calls[0][0];
    expect(JSON.stringify(audit.data)).not.toMatch(/refund/i);
  });

  it('16. notifications emitted after commit with deterministic idempotent keys', async () => {
    await request(app).post('/api/v1/customers/me/bookings/cb-pending/cancel').set(auth1).send({});
    expect(notifTypes()).toEqual(expect.arrayContaining(['BOOKING_CANCELLED']));
    expect(notifKeys()).toContain('booking:cb-pending:cancelled:customer');
    expect(notifKeys()).toContain('booking:cb-pending:cancelled:provider');
    // Customer message never claims money was refunded.
    const custMsg = mockNotificationCreate.mock.calls.find((c: any) => c[0]?.data?.eventKey === 'booking:cb-pending:cancelled:customer')[0].data.message;
    expect(custMsg).toMatch(/no refund was processed/i);
    expect(custMsg).not.toMatch(/refund of .* (issued|completed|sent|paid)/i);
  });

  it('17. audit record captures actor, action, before/after, ip and user agent', async () => {
    await request(app).post('/api/v1/customers/me/bookings/cb-pending/cancel').set(auth1).set('User-Agent', 'waasha-test/1.0').send({ reason: 'x' });
    expect(mockAuditCreate).toHaveBeenCalledTimes(1);
    const d = mockAuditCreate.mock.calls[0][0].data;
    expect(d).toMatchObject({ actorUserId: 'user-cust1', action: 'CUSTOMER_BOOKING_CANCELLED', entityType: 'booking', entityId: 'cb-pending' });
    expect(d.beforeJson.status).toBe('PENDING');
    expect(d.afterJson.status).toBe('CANCELLED');
    expect(d.ipAddress).toBeDefined();
    expect(d.userAgent).toBeDefined();
    expect(JSON.stringify(d)).not.toMatch(/password|secret|token/i);
  });

  it('18. audit failure does not falsely report: transition stays truthful per existing policy', async () => {
    mockAuditCreate.mockRejectedValueOnce(new Error('audit down'));
    const res = await request(app).post('/api/v1/customers/me/bookings/cb-pending/cancel').set(auth1).send({});
    // Existing provider-booking policy: audit is best-effort inside the
    // transaction; the reported booking state always matches the commit.
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe(store['cb-pending'].status);
  });

  it('19. internal failure surfaces sanitized 500 without SQL leak', async () => {
    mockTransaction.mockRejectedValueOnce(new Error('SELECT * FROM bookings WHERE secret'));
    const res = await request(app).post('/api/v1/customers/me/bookings/cb-pending/cancel').set(auth1).send({});
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(res.body)).not.toContain('SELECT');
  });

  it('20. location snapshot untouched by cancellation', async () => {
    const before = JSON.stringify(store['cb-pending'].location);
    await request(app).post('/api/v1/customers/me/bookings/cb-pending/cancel').set(auth1).send({});
    expect(JSON.stringify(store['cb-pending'].location)).toBe(before);
  });

  it('21. historical price/duration snapshots preserved on cancel', async () => {
    const before = JSON.stringify(store['cb-pending'].items);
    const res = await request(app).post('/api/v1/customers/me/bookings/cb-pending/cancel').set(auth1).send({});
    expect(res.status).toBe(200);
    expect(JSON.stringify(store['cb-pending'].items)).toBe(before);
    expect(store['cb-pending'].totalAmount).toBe(200);
  });
});

describe('Slice 12 — customer rescheduling', () => {
  it('22. reschedule happy path preserves identity and status', async () => {
    const res = await request(app)
      .post('/api/v1/customers/me/bookings/cb-pending/reschedule')
      .set(auth1)
      .send({ scheduledStart: NEW_START_ISO });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({ id: 'cb-pending', previousStatus: 'PENDING', status: 'PENDING' });
    expect(new Date(res.body.data.scheduledStart).toISOString()).toBe(NEW_START_ISO);
    expect(new Date(res.body.data.scheduledEnd).toISOString()).toBe(NEW_END_ISO);
  });

  it('23. PATCH alias behaves identically', async () => {
    const res = await request(app)
      .patch('/api/v1/customers/me/bookings/cb-pending/reschedule')
      .set(auth1)
      .send({ scheduledStart: NEW_START_ISO });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('PENDING');
  });

  it('24. unauthenticated reschedule → 401 (POST and PATCH)', async () => {
    expect((await request(app).post('/api/v1/customers/me/bookings/cb-pending/reschedule').send({ scheduledStart: NEW_START_ISO })).status).toBe(401);
    expect((await request(app).patch('/api/v1/customers/me/bookings/cb-pending/reschedule').send({ scheduledStart: NEW_START_ISO })).status).toBe(401);
  });

  it('25. cross-customer reschedule → safe 404', async () => {
    const res = await request(app)
      .post('/api/v1/customers/me/bookings/cb-other/reschedule')
      .set(auth1)
      .send({ scheduledStart: NEW_START_ISO });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('BOOKING_NOT_FOUND');
  });

  it('26. COMPLETED / CANCELLED cannot be rescheduled → 422', async () => {
    for (const id of ['cb-completed', 'cb-cancelled', 'cb-active', 'cb-declined']) {
      const res = await request(app).post(`/api/v1/customers/me/bookings/${id}/reschedule`).set(auth1).send({ scheduledStart: NEW_START_ISO });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('BOOKING_INVALID_STATE');
    }
  });

  it('27. reschedule inside the cutoff window → 422', async () => {
    const res = await request(app)
      .post('/api/v1/customers/me/bookings/cb-soon/reschedule')
      .set(auth1)
      .send({ scheduledStart: NEW_START_ISO });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('BOOKING_RESCHEDULE_WINDOW_CLOSED');
  });

  it('28. missing / invalid / past scheduledStart → 422', async () => {
    expect((await request(app).post('/api/v1/customers/me/bookings/cb-pending/reschedule').set(auth1).send({})).status).toBe(422);
    const bad = await request(app).post('/api/v1/customers/me/bookings/cb-pending/reschedule').set(auth1).send({ scheduledStart: 'not-a-date' });
    expect(bad.status).toBe(422);
    const past = await request(app).post('/api/v1/customers/me/bookings/cb-pending/reschedule').set(auth1).send({ scheduledStart: new Date(Date.now() - HOUR).toISOString() });
    expect(past.status).toBe(422);
    expect(store['cb-pending'].status).toBe('PENDING');
  });

  it('29. mass-assignment rejected: duration, price, provider, status, payment, location', async () => {
    const res = await request(app)
      .post('/api/v1/customers/me/bookings/cb-pending/reschedule')
      .set(auth1)
      .send({ scheduledStart: NEW_START_ISO, durationMinutes: 5, price: 1, providerId: 'prov-9', serviceId: 'svc-9', status: 'COMPLETED', paymentStatus: 'PAID', customerId: 'cust-2', tenantId: 't' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('30. duration is server-authoritative (snapshot 30 min, not client input)', async () => {
    const res = await request(app)
      .post('/api/v1/customers/me/bookings/cb-pending/reschedule')
      .set(auth1)
      .send({ scheduledStart: NEW_START_ISO });
    expect(res.status).toBe(200);
    const ms = new Date(res.body.data.scheduledEnd).getTime() - new Date(res.body.data.scheduledStart).getTime();
    expect(ms).toBe(30 * 60 * 1000);
  });

  it('31. provider timezone is authoritative and preserved', async () => {
    const res = await request(app)
      .post('/api/v1/customers/me/bookings/cb-pending/reschedule')
      .set(auth1)
      .send({ scheduledStart: NEW_START_ISO });
    expect(res.status).toBe(200);
    expect(res.body.data.timezone).toBe('Africa/Johannesburg');
    expect(store['cb-pending'].timezone).toBe('Africa/Johannesburg');
  });

  it('32. slot rejected by availability engine → 409', async () => {
    mockGetSlots.mockResolvedValueOnce({ ...defaultSlots(), slots: [] });
    const res = await request(app)
      .post('/api/v1/customers/me/bookings/cb-pending/reschedule')
      .set(auth1)
      .send({ scheduledStart: NEW_START_ISO });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('SLOT_UNAVAILABLE');
  });

  it('33. overlapping booking committed concurrently → 409, nothing partially modified', async () => {
    const before = JSON.stringify({ s: store['cb-pending'].scheduledStart, e: store['cb-pending'].scheduledEnd });
    store['cb-blocker'] = mkBooking({
      id: 'cb-blocker',
      uuid: 'uuid-blocker',
      customerId: 'cust-2',
      status: 'CONFIRMED',
      scheduledStart: new Date(new Date(NEW_START_ISO).getTime() - 15 * 60 * 1000),
      scheduledEnd: new Date(new Date(NEW_START_ISO).getTime() + 15 * 60 * 1000),
    });
    const res = await request(app)
      .post('/api/v1/customers/me/bookings/cb-pending/reschedule')
      .set(auth1)
      .send({ scheduledStart: NEW_START_ISO });
    expect(res.status).toBe(409);
    expect(JSON.stringify({ s: store['cb-pending'].scheduledStart, e: store['cb-pending'].scheduledEnd })).toBe(before);
  });

  it('34. concurrent invalidation: booking completed before reschedule commits → 422', async () => {
    store['cb-pending'].status = 'COMPLETED';
    const res = await request(app)
      .post('/api/v1/customers/me/bookings/cb-pending/reschedule')
      .set(auth1)
      .send({ scheduledStart: NEW_START_ISO });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('BOOKING_INVALID_STATE');
  });

  it('35. identity preserved: same booking id, items and location untouched', async () => {
    const itemsBefore = JSON.stringify(store['cb-pending'].items);
    const locBefore = JSON.stringify(store['cb-pending'].location);
    const res = await request(app)
      .post('/api/v1/customers/me/bookings/cb-pending/reschedule')
      .set(auth1)
      .send({ scheduledStart: NEW_START_ISO });
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe('cb-pending');
    expect(JSON.stringify(store['cb-pending'].items)).toBe(itemsBefore);
    expect(JSON.stringify(store['cb-pending'].location)).toBe(locBefore);
    expect(store['cb-pending'].totalAmount).toBe(200);
  });

  it('36. payment record preserved on reschedule, never mutated', async () => {
    const res = await request(app)
      .post('/api/v1/customers/me/bookings/cb-paid/reschedule')
      .set(auth1)
      .send({ scheduledStart: NEW_START_ISO });
    expect(res.status).toBe(200);
    expect(store['cb-paid'].paymentStatus).toBe('PAID');
    expect(mockPaymentUpdate).not.toHaveBeenCalled();
  });

  it('37. reschedule notification emitted with deterministic slot-scoped key', async () => {
    await request(app).post('/api/v1/customers/me/bookings/cb-pending/reschedule').set(auth1).send({ scheduledStart: NEW_START_ISO });
    const slotMs = new Date(NEW_START_ISO).getTime();
    expect(notifKeys()).toContain(`booking:cb-pending:rescheduled:${slotMs}:customer`);
    expect(notifKeys()).toContain(`booking:cb-pending:rescheduled:${slotMs}:provider`);
    expect(notifTypes()).toContain('BOOKING_RESCHEDULED');
  });

  it('38. reschedule audit captures before/after schedule with actor and request context', async () => {
    const oldStart = new Date(store['cb-pending'].scheduledStart).toISOString();
    await request(app).post('/api/v1/customers/me/bookings/cb-pending/reschedule').set(auth1).send({ scheduledStart: NEW_START_ISO });
    const d = mockAuditCreate.mock.calls[0][0].data;
    expect(d).toMatchObject({ actorUserId: 'user-cust1', action: 'CUSTOMER_BOOKING_RESCHEDULED', entityType: 'booking', entityId: 'cb-pending' });
    expect(d.beforeJson.scheduledStart).toBe(oldStart);
    expect(d.afterJson.scheduledStart).toBe(NEW_START_ISO);
    expect(d.beforeJson.status).toBe(d.afterJson.status);
  });
});

describe('Slice 12 — cross-cutting guarantees', () => {
  it('39. no second state machine: only canonical CANCELLED target is used', async () => {
    const res = await request(app).post('/api/v1/customers/me/bookings/cb-pending/cancel').set(auth1).send({});
    expect(res.body.data.status).toBe('CANCELLED');
    expect(['CANCELLED']).toContain(res.body.data.status);
  });

  it('40. no driver functionality anywhere in the action responses or service', async () => {
    const c = await request(app).post('/api/v1/customers/me/bookings/cb-pending/cancel').set(auth1).send({});
    const r = await request(app).post('/api/v1/customers/me/bookings/cb-accepted/reschedule').set(auth1).send({ scheduledStart: NEW_START_ISO });
    expect(JSON.stringify(c.body)).not.toMatch(/driver/i);
    expect(JSON.stringify(r.body)).not.toMatch(/driver/i);
    const svc = fs.readFileSync(path.join(__dirname, '../src/modules/bookings/customer-booking-actions.service.ts'), 'utf8');
    expect(svc).not.toMatch(/driver/i);
  });

  it('41. no hard-coded financial rules in the action service', async () => {
    const svc = fs.readFileSync(path.join(__dirname, '../src/modules/bookings/customer-booking-actions.service.ts'), 'utf8');
    expect(svc).not.toMatch(/16%|25%|R500|R1000|R5000/);
    expect(svc).not.toMatch(/commissionRate\s*[:=]\s*0\.\d+/);
    // No refund issuance path may exist here — cancellation and refund are separate events.
    expect(svc).not.toMatch(/processRefund|issueRefund|createRefund|initiateRefund/);
  });

  it('42. config-driven windows: admin settings override defaults', async () => {
    const svc = await import('../src/modules/bookings/customer-booking-actions.service');
    mockAdminSettingFindMany.mockResolvedValueOnce([
      { settingKey: 'customer_cancellation_cutoff_minutes', settingValue: '120' },
      { settingKey: 'customer_reschedule_cutoff_minutes', settingValue: '180' },
    ]);
    const cfg = await svc.getCustomerBookingActionConfig();
    expect(cfg).toEqual({ cancellationCutoffMinutes: 120, rescheduleCutoffMinutes: 180 });
    const fallback = await svc.getCustomerBookingActionConfig();
    expect(fallback).toEqual({ cancellationCutoffMinutes: 0, rescheduleCutoffMinutes: 60 });
  });

  it('43. web action client contract: cancel + reschedule against session-scoped routes', async () => {
    const client = fs.readFileSync(path.join(__dirname, '../../apps/web/src/app/core/services/customer-bookings.service.ts'), 'utf8');
    expect(client).toContain('/api/v1/customers/me/bookings/${encodeURIComponent(id)}/cancel');
    expect(client).toContain('/api/v1/customers/me/bookings/${encodeURIComponent(id)}/reschedule');
    // No ownership/payment field is ever sent as request data (comments may name them to forbid them).
    expect(client).not.toMatch(/customerId\s*:|userId\s*:|tenantId\s*:|paymentStatus\s*:/);
  });

  it('44. mobile action client contract matches web', async () => {
    const mobile = fs.readFileSync(path.join(__dirname, '../../apps/mobile/src/app/core/services/customer-bookings.service.ts'), 'utf8');
    expect(mobile).toContain('/cancel');
    expect(mobile).toContain('/reschedule');
    const webUtils = fs.readFileSync(path.join(__dirname, '../../apps/web/src/app/features/bookings/customer-bookings.utils.ts'), 'utf8');
    const mobUtils = fs.readFileSync(path.join(__dirname, '../../apps/mobile/src/app/features/bookings/customer-bookings.utils.ts'), 'utf8');
    for (const fn of ['canCancelBooking', 'canRescheduleBooking', 'interpretActionError', 'isOnline']) {
      expect(webUtils).toContain(fn);
      expect(mobUtils).toContain(fn);
    }
  });

  it('45. web/mobile parity: both detail screens expose confirm-safe actions with real slots', async () => {
    for (const p of [
      '../../apps/web/src/app/features/bookings/my-booking-detail.component.ts',
      '../../apps/mobile/src/app/features/bookings/my-booking-detail.page.ts',
    ]) {
      const view = fs.readFileSync(path.join(__dirname, p), 'utf8');
      expect(view).toContain('Yes, cancel booking');
      expect(view).toContain('Confirm new time');
      expect(view).toContain('getAvailability');
      expect(view).not.toMatch(/mockSlot|fakeSlot|sampleSlot/i);
    }
  });

  it('46. offline safety: mutations are blocked with an explicit message, never queued as confirmed', async () => {
    for (const p of [
      '../../apps/web/src/app/features/bookings/customer-bookings.utils.ts',
      '../../apps/mobile/src/app/features/bookings/customer-bookings.utils.ts',
    ]) {
      const utils = fs.readFileSync(path.join(__dirname, p), 'utf8');
      expect(utils).toContain('navigator.onLine');
      expect(utils).toMatch(/needs a connection/);
    }
    for (const p of [
      '../../apps/web/src/app/features/bookings/my-booking-detail.component.ts',
      '../../apps/mobile/src/app/features/bookings/my-booking-detail.page.ts',
    ]) {
      const view = fs.readFileSync(path.join(__dirname, p), 'utf8');
      expect(view).not.toMatch(/offline.*queue|queue.*offline|syncQueue|outbox/i);
    }
  });

  it('47. second customer cannot touch first customer bookings via either action', async () => {
    const auth2 = { Authorization: `Bearer ${cust2()}` };
    expect((await request(app).post('/api/v1/customers/me/bookings/cb-pending/cancel').set(auth2).send({})).status).toBe(404);
    expect((await request(app).post('/api/v1/customers/me/bookings/cb-pending/reschedule').set(auth2).send({ scheduledStart: NEW_START_ISO })).status).toBe(404);
  });

  it('48. response envelope follows { success, data, error } with no Prisma leakage', async () => {
    const ok = await request(app).post('/api/v1/customers/me/bookings/cb-pending/cancel').set(auth1).send({});
    expect(ok.body.success).toBe(true);
    expect(ok.body.data.id).toBeDefined();
    const fail = await request(app).post('/api/v1/customers/me/bookings/cb-completed/cancel').set(auth1).send({});
    expect(fail.body.success).toBe(false);
    expect(fail.body.error.code).toBeDefined();
    expect(JSON.stringify(fail.body)).not.toMatch(/Prisma|prisma|\$transaction/);
  });

  it('49. payment-status/completion separation stated in customer notifications', async () => {
    await request(app).post('/api/v1/customers/me/bookings/cb-pending/cancel').set(auth1).send({});
    const msg = mockNotificationCreate.mock.calls.find((c: any) => c[0]?.data?.eventKey === 'booking:cb-pending:cancelled:customer')[0].data.message;
    expect(msg).toMatch(/payment status is unchanged/i);
  });

  it('50. availability exceptions respected: engine rejection surfaces cleanly', async () => {
    const err: any = new Error('Provider unavailable');
    err.status = 422;
    err.code = 'VALIDATION_ERROR';
    mockGetSlots.mockRejectedValueOnce(err);
    const res = await request(app)
      .post('/api/v1/customers/me/bookings/cb-pending/reschedule')
      .set(auth1)
      .send({ scheduledStart: NEW_START_ISO });
    expect(res.status).toBe(422);
    expect(store['cb-pending'].status).toBe('PENDING');
  });
});

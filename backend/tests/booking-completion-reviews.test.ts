/**
 * Phase 2 Slice 13 — Service completion & reviews.
 *
 * Covers the production lifecycle:
 *   BOOKING → IN_PROGRESS → COMPLETED → REVIEW ELIGIBILITY → REVIEW
 *
 * Server-authoritative, transactional, audited, notified. Ownership always
 * derives from the authenticated session. Prisma is mocked at the module
 * boundary; the real route → service → notification code runs unmodified.
 * Frontend contracts import the REAL web/mobile services and utils.
 */
import * as fs from 'fs';
import * as path from 'path';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { of } from 'rxjs';

function token(sub: string) {
  const secret = process.env.JWT_SECRET ?? 'dev-jwt-secret-change-me';
  return jwt.sign({ uuid: sub, email: `${sub}@test.local`, sub }, secret, {
    expiresIn: '1h',
    issuer: 'waasha',
    audience: 'waasha-app',
  } as any);
}

// ---- mocks ----
const mockUserFindUnique = jest.fn();
const mockCustomerProfileFindUnique = jest.fn();
const mockProviderProfileFindUnique = jest.fn();
const mockProviderProfileUpdate = jest.fn();
const mockBusinessFindMany = jest.fn();
const mockBusinessUnitFindMany = jest.fn();
const mockBusinessUnitFindUnique = jest.fn();
const mockBookingFindUnique = jest.fn();
const mockBookingFindFirst = jest.fn();
const mockBookingUpdate = jest.fn();
const mockPaymentFindUnique = jest.fn();
const mockPaymentUpdate = jest.fn();
const mockReviewFindUnique = jest.fn();
const mockCashLedgerCreate = jest.fn();
const mockAuditCreate = jest.fn();
const mockNotificationCreate = jest.fn();
const mockNotificationFindUnique = jest.fn();
const mockNotificationPreferenceFindUnique = jest.fn();
const mockTransaction = jest.fn();

jest.mock('../src/config/prisma', () => ({
  prisma: {
    user: { findUnique: (...a: any[]) => (mockUserFindUnique as any)(...a) },
    customerProfile: { findUnique: (...a: any[]) => (mockCustomerProfileFindUnique as any)(...a) },
    providerProfile: {
      findUnique: (...a: any[]) => (mockProviderProfileFindUnique as any)(...a),
      update: (...a: any[]) => (mockProviderProfileUpdate as any)(...a),
    },
    business: { findMany: (...a: any[]) => (mockBusinessFindMany as any)(...a) },
    businessUnit: {
      findMany: (...a: any[]) => (mockBusinessUnitFindMany as any)(...a),
      findUnique: (...a: any[]) => (mockBusinessUnitFindUnique as any)(...a),
    },
    booking: {
      findUnique: (...a: any[]) => (mockBookingFindUnique as any)(...a),
      findFirst: (...a: any[]) => (mockBookingFindFirst as any)(...a),
      update: (...a: any[]) => (mockBookingUpdate as any)(...a),
    },
    payment: {
      findUnique: (...a: any[]) => (mockPaymentFindUnique as any)(...a),
      update: (...a: any[]) => (mockPaymentUpdate as any)(...a),
    },
    review: {
      findUnique: (...a: any[]) => (mockReviewFindUnique as any)(...a),
    },
    cashLedgerEntry: { create: (...a: any[]) => (mockCashLedgerCreate as any)(...a) },
    notification: {
      create: (...a: any[]) => (mockNotificationCreate as any)(...a),
      findUnique: (...a: any[]) => (mockNotificationFindUnique as any)(...a),
    },
    notificationPreference: { findUnique: (...a: any[]) => (mockNotificationPreferenceFindUnique as any)(...a) },
    auditLog: { create: (...a: any[]) => (mockAuditCreate as any)(...a) },
    $transaction: (...a: any[]) => (mockTransaction as any)(...a),
  },
}));

import { app } from '../src/app';

// ---- fixtures ----
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function mkBooking(over: Record<string, unknown> = {}) {
  const start = new Date(Date.now() + DAY);
  const end = new Date(start.getTime() + 30 * 60 * 1000);
  return {
    id: 'bk-progress',
    uuid: 'uuid-bk-progress',
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
    status: 'IN_PROGRESS',
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
    ...over,
  };
}

function provProfile(id: string, userId: string, over: Record<string, unknown> = {}) {
  return {
    id,
    userId,
    status: 'ACTIVE',
    displayName: id === 'prov-1' ? 'Sharp Cuts' : 'Second Chair',
    tier: { code: 'T1' },
    isStudent: false,
    studentVerificationStatus: 'UNVERIFIED',
    ...over,
  };
}

type Store = Record<string, ReturnType<typeof mkBooking>>;
let store: Store = {};
let reviewStore: Record<string, any> = {};
let paymentStore: Record<string, any> = {};
let reviewSeq = 0;
let forceReviewP2002 = false;

const tx = {
  booking: {
    findUnique: async ({ where }: any) => store[where?.id] ?? null,
    findFirst: async () => null,
    update: async ({ where, data }: any) => {
      const b = store[where?.id];
      if (!b) throw new Error('not found');
      Object.assign(b, data, { updatedAt: new Date() });
      return { ...b, items: (b as any).items };
    },
  },
  providerProfile: {
    findUnique: async (args: any) => (mockProviderProfileFindUnique as any)(args),
  },
  payment: {
    findUnique: async ({ where }: any) => paymentStore[where?.bookingId] ?? null,
  },
  review: {
    findUnique: async ({ where }: any) => reviewStore[where?.bookingId] ?? null,
    create: async ({ data }: any) => {
      if (forceReviewP2002 || reviewStore[data.bookingId]) {
        const e: any = new Error('Unique constraint failed');
        e.code = 'P2002';
        throw e;
      }
      reviewSeq += 1;
      const row = { id: `rev-${reviewSeq}`, uuid: `uuid-rev-${reviewSeq}`, ...data, createdAt: new Date(), updatedAt: new Date() };
      reviewStore[data.bookingId] = row;
      return row;
    },
  },
  auditLog: { create: (...a: any[]) => (mockAuditCreate as any)(...a) },
};

let notifSeq = 0;
let notifRows: any[] = [];

beforeEach(() => {
  jest.clearAllMocks();
  notifSeq = 0;
  notifRows = [];
  reviewSeq = 0;
  forceReviewP2002 = false;
  store = {};
  reviewStore = {};
  paymentStore = {};

  store['bk-progress'] = mkBooking();
  store['bk-progress-paid'] = mkBooking({
    id: 'bk-progress-paid',
    uuid: 'uuid-bk-progress-paid',
    paymentMethod: 'cash',
    paymentStatus: 'PAID',
  });
  paymentStore['bk-progress-paid'] = {
    id: 'pay-1',
    bookingId: 'bk-progress-paid',
    method: 'cash',
    gateway: 'manual_cash',
    status: 'PAID',
    amount: 200,
    currency: 'ZAR',
    commissionRate: 25,
    commissionAmount: 50,
  };
  store['bk-pending'] = mkBooking({ id: 'bk-pending', uuid: 'uuid-bk-pending', status: 'PENDING' });
  store['bk-accepted'] = mkBooking({ id: 'bk-accepted', uuid: 'uuid-bk-accepted', status: 'ACCEPTED' });
  store['bk-confirmed'] = mkBooking({ id: 'bk-confirmed', uuid: 'uuid-bk-confirmed', status: 'CONFIRMED' });
  store['bk-declined'] = mkBooking({ id: 'bk-declined', uuid: 'uuid-bk-declined', status: 'DECLINED' });
  store['bk-cancelled'] = mkBooking({ id: 'bk-cancelled', uuid: 'uuid-bk-cancelled', status: 'CANCELLED' });
  store['bk-paid-status'] = mkBooking({
    id: 'bk-paid-status',
    uuid: 'uuid-bk-paid-status',
    status: 'PAID',
    paymentMethod: 'cash',
    paymentStatus: 'PAID',
  });
  store['bk-completed'] = mkBooking({ id: 'bk-completed', uuid: 'uuid-bk-completed', status: 'COMPLETED' });
  store['bk-completed-reviewed'] = mkBooking({
    id: 'bk-completed-reviewed',
    uuid: 'uuid-bk-completed-reviewed',
    status: 'COMPLETED',
  });
  reviewStore['bk-completed-reviewed'] = {
    id: 'rev-0',
    uuid: 'uuid-rev-0',
    bookingId: 'bk-completed-reviewed',
    rating: 5,
    comment: 'Great cut',
    createdAt: new Date(Date.now() - HOUR),
    updatedAt: new Date(Date.now() - HOUR),
  };
  store['bk-other'] = mkBooking({ id: 'bk-other', uuid: 'uuid-bk-other', customerId: 'cust-2', status: 'COMPLETED' });
  store['bk-assigned'] = mkBooking({
    id: 'bk-assigned',
    uuid: 'uuid-bk-assigned',
    providerId: 'prov-2',
    assignedProviderId: 'prov-1',
  });
  store['bk-prov2'] = mkBooking({ id: 'bk-prov2', uuid: 'uuid-bk-prov2', providerId: 'prov-2', status: 'IN_PROGRESS' });
  store['bk-student'] = mkBooking({ id: 'bk-student', uuid: 'uuid-bk-student', status: 'COMPLETED' });

  mockUserFindUnique.mockImplementation(async ({ where }: any) => {
    if (['user-prov1', 'user-prov2', 'user-cust1', 'user-cust2'].includes(where?.id)) {
      return { id: where.id, status: 'ACTIVE' } as never;
    }
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
    if (where?.userId === 'user-prov1' || where?.id === 'prov-1') return provProfile('prov-1', 'user-prov1') as never;
    if (where?.userId === 'user-prov2' || where?.id === 'prov-2') return provProfile('prov-2', 'user-prov2') as never;
    return null;
  });
  mockProviderProfileUpdate.mockRejectedValue(new Error('provider aggregates must not be mutated by reviews'));
  mockBusinessFindMany.mockResolvedValue([]);
  mockBusinessUnitFindMany.mockResolvedValue([]);
  mockBusinessUnitFindUnique.mockResolvedValue(null);
  mockBookingFindUnique.mockImplementation(async ({ where }: any) => store[where?.id] ?? null);
  mockBookingFindFirst.mockResolvedValue(null);
  mockBookingUpdate.mockRejectedValue(new Error('direct update not allowed'));
  mockPaymentFindUnique.mockImplementation(async ({ where }: any) => paymentStore[where?.bookingId] ?? null);
  mockPaymentUpdate.mockRejectedValue(new Error('payment mutation not allowed in this slice'));
  mockReviewFindUnique.mockImplementation(async ({ where }: any) => reviewStore[where?.bookingId] ?? null);
  mockCashLedgerCreate.mockRejectedValue(new Error('no ledger entries in completion/review slice'));
  mockAuditCreate.mockResolvedValue({});
  mockNotificationPreferenceFindUnique.mockResolvedValue(null);
  mockNotificationCreate.mockImplementation(async ({ data }: any) => {
    if (data?.eventKey && notifRows.some((r) => r.eventKey === data.eventKey)) {
      const e: any = new Error('Unique constraint failed on event_key');
      e.code = 'P2002';
      throw e;
    }
    notifSeq += 1;
    const row = {
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
      eventKey: data.eventKey ?? null,
      readAt: null,
      createdAt: new Date(),
    };
    notifRows.push(row);
    return row;
  });
  mockNotificationFindUnique.mockImplementation(async ({ where }: any) => {
    if (where?.eventKey) return notifRows.find((r) => r.eventKey === where.eventKey) ?? null;
    return notifRows.find((r) => r.id === where?.id) ?? null;
  });
  mockTransaction.mockImplementation(async (cb: any) => (cb as any)(tx));
});

const prov1 = () => token('user-prov1');
const prov2 = () => token('user-prov2');
const cust1 = () => token('user-cust1');
const cust2 = () => token('user-cust2');
const authProv1 = { Authorization: `Bearer ${prov1()}` };
const authProv2 = { Authorization: `Bearer ${prov2()}` };
const authCust1 = { Authorization: `Bearer ${cust1()}` };
const authCust2 = { Authorization: `Bearer ${cust2()}` };

function notifTypes(): string[] {
  return mockNotificationCreate.mock.calls.map((c: any) => c[0]?.data?.type);
}
function notifKeys(): string[] {
  return mockNotificationCreate.mock.calls.map((c: any) => c[0]?.data?.eventKey);
}

// ── Provider completion ────────────────────────────────────────────────

describe('Slice 13 — provider completion happy path', () => {
  it('1. provider completion happy path (IN_PROGRESS → COMPLETED)', async () => {
    const res = await request(app).post('/api/v1/providers/me/bookings/bk-progress/complete').set(authProv1).send({});
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({ id: 'bk-progress', previousStatus: 'IN_PROGRESS', status: 'COMPLETED' });
    expect(store['bk-progress'].status).toBe('COMPLETED');
  });

  it('2. completion response preserves price/duration snapshots', async () => {
    const before = JSON.parse(JSON.stringify(store['bk-progress-paid'].items));
    const res = await request(app).post('/api/v1/providers/me/bookings/bk-progress-paid/complete').set(authProv1).send({});
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ totalAmount: 200, subtotal: 200, currency: 'ZAR' });
    expect(store['bk-progress-paid'].items).toEqual(before);
    expect(store['bk-progress-paid'].items[0]).toMatchObject({ unitPrice: 200, durationMinutes: 30, lineTotal: 200, quantity: 1 });
  });

  it('3. unauthenticated completion → 401', async () => {
    expect((await request(app).post('/api/v1/providers/me/bookings/bk-progress/complete').send({})).status).toBe(401);
  });

  it('4. wrong provider completion → safe 404, state unchanged', async () => {
    const res = await request(app).post('/api/v1/providers/me/bookings/bk-prov2/complete').set(authProv1).send({});
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('BOOKING_NOT_FOUND');
    expect(store['bk-prov2'].status).toBe('IN_PROGRESS');
  });

  it('5. assigned provider in scope can complete', async () => {
    const res = await request(app).post('/api/v1/providers/me/bookings/bk-assigned/complete').set(authProv1).send({});
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('COMPLETED');
  });

  it('6. providerId/status in body rejected — no mass assignment', async () => {
    const res = await request(app)
      .post('/api/v1/providers/me/bookings/bk-progress/complete')
      .set(authProv1)
      .send({ providerId: 'prov-2', status: 'COMPLETED' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(store['bk-progress'].status).toBe('IN_PROGRESS');
  });

  it('7. tenant/business fields in completion body rejected', async () => {
    const res = await request(app)
      .post('/api/v1/providers/me/bookings/bk-progress/complete')
      .set(authProv1)
      .send({ businessUnitId: 'unit-1', tenantId: 't-1' });
    expect(res.status).toBe(422);
    expect(store['bk-progress'].status).toBe('IN_PROGRESS');
  });
});

describe('Slice 13 — completion state machine', () => {
  it.each([
    ['bk-pending', 'PENDING'],
    ['bk-accepted', 'ACCEPTED'],
    ['bk-confirmed', 'CONFIRMED'],
    ['bk-declined', 'DECLINED'],
    ['bk-cancelled', 'CANCELLED'],
    ['bk-paid-status', 'PAID'],
  ])('8. %s (%s) cannot complete directly → 422', async (id, status) => {
    const res = await request(app).post(`/api/v1/providers/me/bookings/${id}/complete`).set(authProv1).send({});
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('BOOKING_INVALID_STATE');
    expect(res.body.error.details).toMatchObject({ previousStatus: status, target: 'COMPLETED' });
    expect(store[id].status).toBe(status);
  });

  it('9. second completion after COMPLETED → 422, never silently overwritten', async () => {
    const first = await request(app).post('/api/v1/providers/me/bookings/bk-progress/complete').set(authProv1).send({});
    expect(first.status).toBe(200);
    const second = await request(app).post('/api/v1/providers/me/bookings/bk-progress/complete').set(authProv1).send({});
    expect(second.status).toBe(422);
    expect(second.body.error.code).toBe('BOOKING_INVALID_STATE');
  });

  it('10. concurrent transition conflict: booking cancelled before re-read → 422', async () => {
    mockTransaction.mockImplementationOnce(async (cb: any) =>
      (cb as any)({
        ...tx,
        booking: {
          ...tx.booking,
          findUnique: async () => ({ ...store['bk-progress'], status: 'CANCELLED' }),
        },
      }),
    );
    const res = await request(app).post('/api/v1/providers/me/bookings/bk-progress/complete').set(authProv1).send({});
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('BOOKING_INVALID_STATE');
    expect(store['bk-progress'].status).toBe('IN_PROGRESS');
  });

  it('11. inactive provider cannot complete → 403', async () => {
    mockProviderProfileFindUnique.mockResolvedValue(provProfile('prov-1', 'user-prov1', { status: 'SUSPENDED' }) as never);
    const res = await request(app).post('/api/v1/providers/me/bookings/bk-progress/complete').set(authProv1).send({});
    expect(res.status).toBe(403);
    expect(store['bk-progress'].status).toBe('IN_PROGRESS');
  });

  it('12. completion of unknown booking → safe 404', async () => {
    const res = await request(app).post('/api/v1/providers/me/bookings/bk-missing/complete').set(authProv1).send({});
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('BOOKING_NOT_FOUND');
  });
});

describe('Slice 13 — payment != completion, commission eligibility', () => {
  it('13. paid IN_PROGRESS booking completes with paymentStatus preserved as PAID', async () => {
    const res = await request(app).post('/api/v1/providers/me/bookings/bk-progress-paid/complete').set(authProv1).send({});
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('COMPLETED');
    expect(res.body.data.paymentStatus).toBe('PAID');
    expect(store['bk-progress-paid'].paymentStatus).toBe('PAID');
  });

  it('14. payment success alone never completes: PAID-status booking → 422', async () => {
    const res = await request(app).post('/api/v1/providers/me/bookings/bk-paid-status/complete').set(authProv1).send({});
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('BOOKING_INVALID_STATE');
    expect(store['bk-paid-status'].status).toBe('PAID');
  });

  it('15. completion never mutates payments or creates ledger entries', async () => {
    const res = await request(app).post('/api/v1/providers/me/bookings/bk-progress-paid/complete').set(authProv1).send({});
    expect(res.status).toBe(200);
    expect(mockPaymentUpdate).not.toHaveBeenCalled();
    expect(mockCashLedgerCreate).not.toHaveBeenCalled();
    expect(paymentStore['bk-progress-paid']).toMatchObject({ commissionRate: 25, commissionAmount: 50, status: 'PAID' });
  });

  it('16. commission snapshot preserved in completion audit (configurable finance, not recalculated)', async () => {
    await request(app).post('/api/v1/providers/me/bookings/bk-progress-paid/complete').set(authProv1).send({});
    const audit = mockAuditCreate.mock.calls[0][0];
    expect(audit.data.action).toBe('BOOKING_COMPLETED');
    expect(audit.data.afterJson).toMatchObject({ status: 'COMPLETED', commissionRate: 25, commissionAmount: 50 });
    expect(audit.data.beforeJson).toMatchObject({ status: 'IN_PROGRESS', paymentStatus: 'PAID' });
  });

  it('17. completion audit records actor, entity, before/after, IP and user agent', async () => {
    const res = await request(app)
      .post('/api/v1/providers/me/bookings/bk-progress/complete')
      .set(authProv1)
      .set('User-Agent', 'slice13-test')
      .send({});
    expect(res.status).toBe(200);
    const audit = mockAuditCreate.mock.calls[0][0];
    expect(audit.data).toMatchObject({
      actorUserId: 'user-prov1',
      action: 'BOOKING_COMPLETED',
      entityType: 'booking',
      entityId: 'bk-progress',
    });
    expect(audit.data.beforeJson.status).toBe('IN_PROGRESS');
    expect(audit.data.afterJson.status).toBe('COMPLETED');
    expect(audit.data.userAgent).toBe('slice13-test');
    expect(JSON.stringify(audit.data).includes('password')).toBe(false);
  });

  it('18. BOOKING_COMPLETED notification → customer, IN_APP, deterministic idempotency key', async () => {
    const res = await request(app).post('/api/v1/providers/me/bookings/bk-progress/complete').set(authProv1).send({});
    expect(res.status).toBe(200);
    expect(notifTypes()).toContain('BOOKING_COMPLETED');
    expect(notifKeys()).toContain('booking:bk-progress:status:COMPLETED');
    const created = mockNotificationCreate.mock.calls.map((c: any) => c[0].data);
    const completion = created.filter((d: any) => d.type === 'BOOKING_COMPLETED');
    expect(completion).toHaveLength(1);
    expect(completion[0]).toMatchObject({ audience: 'CUSTOMER', channel: 'IN_APP' });
    expect(completion[0].message).not.toMatch(/-?\d+\.\d+/);
  });

  it('19. failed completion sends no notification (post-commit only)', async () => {
    const res = await request(app).post('/api/v1/providers/me/bookings/bk-pending/complete').set(authProv1).send({});
    expect(res.status).toBe(422);
    expect(notifKeys()).not.toContain('booking:bk-pending:status:COMPLETED');
  });

  it('20. completion notification is idempotent across retries', async () => {
    const { notifyBookingCompleted } = await import('../src/modules/notifications/booking-notifications');
    const ref: any = {
      id: 'bk-progress',
      customerId: 'cust-1',
      providerId: 'prov-1',
      businessUnitId: null,
      scheduledStart: new Date(),
      timezone: 'Africa/Johannesburg',
      items: [{ serviceNameSnapshot: 'Fade' }],
    };
    await notifyBookingCompleted(ref);
    await notifyBookingCompleted(ref);
    const keys = notifKeys().filter((k) => k === 'booking:bk-progress:status:COMPLETED');
    expect(keys).toHaveLength(2); // second emit hits UNIQUE event_key → duplicate row returned, no second row
    expect(notifRows.filter((r) => r.eventKey === 'booking:bk-progress:status:COMPLETED')).toHaveLength(1);
  });
});

// ── Customer reviews ───────────────────────────────────────────────────

describe('Slice 13 — customer review happy path and auth', () => {
  it('21. review happy path on COMPLETED booking → 201', async () => {
    const res = await request(app)
      .post('/api/v1/customers/me/bookings/bk-completed/review')
      .set(authCust1)
      .send({ rating: 5, comment: 'Excellent service' });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({ bookingId: 'bk-completed', rating: 5, comment: 'Excellent service' });
  });

  it('22. review without comment → 201 with null comment', async () => {
    const res = await request(app).post('/api/v1/customers/me/bookings/bk-completed/review').set(authCust1).send({ rating: 4 });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ rating: 4, comment: null });
  });

  it('23. unauthenticated review → 401', async () => {
    expect((await request(app).post('/api/v1/customers/me/bookings/bk-completed/review').send({ rating: 5 })).status).toBe(401);
    expect((await request(app).get('/api/v1/customers/me/bookings/bk-completed/review')).status).toBe(401);
  });

  it('24. cross-customer review → safe 404', async () => {
    const res = await request(app).post('/api/v1/customers/me/bookings/bk-other/review').set(authCust1).send({ rating: 5 });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('BOOKING_NOT_FOUND');
    expect(reviewStore['bk-other']).toBeUndefined();
  });

  it('25. cross-customer eligibility check → safe 404', async () => {
    const res = await request(app).get('/api/v1/customers/me/bookings/bk-other/review').set(authCust1);
    expect(res.status).toBe(404);
  });
});

describe('Slice 13 — review eligibility', () => {
  it.each([
    ['bk-pending', 'PENDING'],
    ['bk-accepted', 'ACCEPTED'],
    ['bk-progress', 'IN_PROGRESS'],
    ['bk-cancelled', 'CANCELLED'],
    ['bk-declined', 'DECLINED'],
  ])('26. review blocked for %s (%s) → 422 REVIEW_NOT_ELIGIBLE', async (id, status) => {
    const res = await request(app).post(`/api/v1/customers/me/bookings/${id}/review`).set(authCust1).send({ rating: 5 });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('REVIEW_NOT_ELIGIBLE');
    expect(res.body.error.details).toMatchObject({ status });
  });

  it('27. eligibility endpoint: eligible COMPLETED, ineligible PENDING, hasReview after submit', async () => {
    const eligible = await request(app).get('/api/v1/customers/me/bookings/bk-completed/review').set(authCust1);
    expect(eligible.status).toBe(200);
    expect(eligible.body.data).toMatchObject({ eligible: true, hasReview: false });

    const pending = await request(app).get('/api/v1/customers/me/bookings/bk-pending/review').set(authCust1);
    expect(pending.body.data).toMatchObject({ eligible: false, reason: 'REVIEW_NOT_ELIGIBLE', hasReview: false });

    const reviewed = await request(app).get('/api/v1/customers/me/bookings/bk-completed-reviewed/review').set(authCust1);
    expect(reviewed.body.data).toMatchObject({ eligible: false, reason: 'REVIEW_ALREADY_EXISTS', hasReview: true });
    expect(reviewed.body.data.review).toMatchObject({ rating: 5 });
  });
});

describe('Slice 13 — review validation', () => {
  it.each([[0], [6], [-1], [1.5], ['5'], [null]])('28. invalid rating %p → 422', async (rating) => {
    const res = await request(app).post('/api/v1/customers/me/bookings/bk-completed/review').set(authCust1).send({ rating });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(reviewStore['bk-completed']).toBeUndefined();
  });

  it('29. missing rating → 422', async () => {
    const res = await request(app).post('/api/v1/customers/me/bookings/bk-completed/review').set(authCust1).send({ comment: 'No stars' });
    expect(res.status).toBe(422);
  });

  it('30. over-long comment → 422', async () => {
    const res = await request(app)
      .post('/api/v1/customers/me/bookings/bk-completed/review')
      .set(authCust1)
      .send({ rating: 5, comment: 'x'.repeat(1001) });
    expect(res.status).toBe(422);
  });

  it('31. non-string comment → 422', async () => {
    const res = await request(app)
      .post('/api/v1/customers/me/bookings/bk-completed/review')
      .set(authCust1)
      .send({ rating: 5, comment: 123 });
    expect(res.status).toBe(422);
  });

  it('32. whitespace-only comment accepted as null', async () => {
    const res = await request(app)
      .post('/api/v1/customers/me/bookings/bk-completed/review')
      .set(authCust1)
      .send({ rating: 3, comment: '   ' });
    expect(res.status).toBe(201);
    expect(res.body.data.comment).toBeNull();
  });

  it('33. ownership/financial fields rejected — providerId, customerId, price, status, payment, commission', async () => {
    const badBodies = [
      { rating: 5, providerId: 'prov-2' },
      { rating: 5, customerId: 'cust-2' },
      { rating: 5, serviceId: 'svc-9' },
      { rating: 5, status: 'COMPLETED' },
      { rating: 5, price: 1 },
      { rating: 5, payment: { status: 'PAID' } },
      { rating: 5, commission: 0 },
      { rating: 5, bookingId: 'bk-other' },
      { rating: 5, tenantId: 't-1', businessUnitId: 'u-1' },
    ];
    for (const body of badBodies) {
      const res = await request(app).post('/api/v1/customers/me/bookings/bk-completed/review').set(authCust1).send(body);
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    }
    expect(reviewStore['bk-completed']).toBeUndefined();
  });

  it('34. duplicate review → 409 REVIEW_ALREADY_EXISTS', async () => {
    const res = await request(app)
      .post('/api/v1/customers/me/bookings/bk-completed-reviewed/review')
      .set(authCust1)
      .send({ rating: 4 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('REVIEW_ALREADY_EXISTS');
  });

  it('35. second submit for same booking → 409, first review untouched', async () => {
    const first = await request(app)
      .post('/api/v1/customers/me/bookings/bk-completed/review')
      .set(authCust1)
      .send({ rating: 5 });
    expect(first.status).toBe(201);
    const second = await request(app)
      .post('/api/v1/customers/me/bookings/bk-completed/review')
      .set(authCust1)
      .send({ rating: 1 });
    expect(second.status).toBe(409);
    expect(reviewStore['bk-completed'].rating).toBe(5);
  });

  it('36. concurrent duplicate race (unique constraint) → clean 409, single review', async () => {
    forceReviewP2002 = true;
    const res = await request(app)
      .post('/api/v1/customers/me/bookings/bk-completed/review')
      .set(authCust1)
      .send({ rating: 5 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('REVIEW_ALREADY_EXISTS');
  });

  it('37. review audit records actor, entity, rating and request context', async () => {
    const res = await request(app)
      .post('/api/v1/customers/me/bookings/bk-completed/review')
      .set(authCust1)
      .set('User-Agent', 'slice13-test')
      .send({ rating: 5, comment: 'Top class' });
    expect(res.status).toBe(201);
    const audit = mockAuditCreate.mock.calls[0][0];
    expect(audit.data).toMatchObject({
      actorUserId: 'user-cust1',
      action: 'REVIEW_SUBMITTED',
      entityType: 'review',
    });
    expect(audit.data.afterJson).toMatchObject({ bookingId: 'bk-completed', rating: 5, hasComment: true });
    expect(audit.data.userAgent).toBe('slice13-test');
  });

  it('38. REVIEW_SUBMITTED notification → provider, IN_APP, deterministic key', async () => {
    const res = await request(app)
      .post('/api/v1/customers/me/bookings/bk-completed/review')
      .set(authCust1)
      .send({ rating: 4 });
    expect(res.status).toBe(201);
    expect(notifTypes()).toContain('REVIEW_SUBMITTED');
    expect(notifKeys()).toContain('booking:bk-completed:review-submitted');
    const created = mockNotificationCreate.mock.calls.map((c: any) => c[0].data);
    const reviewNotif = created.filter((d: any) => d.type === 'REVIEW_SUBMITTED');
    expect(reviewNotif).toHaveLength(1);
    expect(reviewNotif[0].audience).toBe('PROVIDER');
  });

  it('39. review derives provider from booking — service/price cannot be changed', async () => {
    const res = await request(app)
      .post('/api/v1/customers/me/bookings/bk-completed/review')
      .set(authCust1)
      .send({ rating: 5 });
    expect(res.status).toBe(201);
    expect(reviewStore['bk-completed']).toMatchObject({ customerId: 'cust-1', providerId: 'prov-1', rating: 5 });
    expect(store['bk-completed'].items[0]).toMatchObject({ unitPrice: 200, durationMinutes: 30 });
    expect(store['bk-completed'].totalAmount).toEqual(200);
  });
});

describe('Slice 13 — reputation, privacy, safety', () => {
  it('40. review never mutates provider aggregates (no ranking boost machinery)', async () => {
    const res = await request(app)
      .post('/api/v1/customers/me/bookings/bk-completed/review')
      .set(authCust1)
      .send({ rating: 5 });
    expect(res.status).toBe(201);
    expect(mockProviderProfileUpdate).not.toHaveBeenCalled();
    expect(res.body.data).not.toHaveProperty('rank');
    expect(res.body.data).not.toHaveProperty('boost');
    expect(res.body.data).not.toHaveProperty('score');
  });

  it('41. student booking review works with no ranking boost', async () => {
    mockProviderProfileFindUnique.mockImplementation(async ({ where }: any) => {
      if (where?.id === 'prov-1') return provProfile('prov-1', 'user-prov1', { isStudent: true, studentVerificationStatus: 'VERIFIED' }) as never;
      if (where?.userId === 'user-prov1') return provProfile('prov-1', 'user-prov1') as never;
      return null;
    });
    const res = await request(app).post('/api/v1/customers/me/bookings/bk-student/review').set(authCust1).send({ rating: 5 });
    expect(res.status).toBe(201);
    expect(res.body.data).not.toHaveProperty('boost');
    expect(mockProviderProfileUpdate).not.toHaveBeenCalled();
  });

  it('42. review responses expose no precise location or private address', async () => {
    const res = await request(app)
      .post('/api/v1/customers/me/bookings/bk-completed/review')
      .set(authCust1)
      .send({ rating: 5, comment: 'Lovely' });
    expect(res.status).toBe(201);
    const text = JSON.stringify(res.body.data);
    expect(text).not.toMatch(/latitude|longitude|addressLine1|postalCode/);
    const elig = await request(app).get('/api/v1/customers/me/bookings/bk-completed-reviewed/review').set(authCust1);
    expect(JSON.stringify(elig.body.data)).not.toMatch(/latitude|longitude|addressLine1/);
  });

  it('43. error responses are sanitized (no SQL/Prisma internals)', async () => {
    const bad = await request(app)
      .post('/api/v1/customers/me/bookings/bk-completed/review')
      .set(authCust1)
      .send({ rating: 'oops' });
    expect(bad.status).toBe(422);
    expect(JSON.stringify(bad.body)).not.toMatch(/prisma|SQL|at |stack|Error:/i);
    const missing = await request(app).post('/api/v1/providers/me/bookings/nope/complete').set(authProv1).send({});
    expect(JSON.stringify(missing.body)).not.toMatch(/prisma|SQL|at |stack/i);
  });

  it('44. script content is stored as inert text, never executed server-side', async () => {
    const payload = "<script>alert('xss')</script>Great";
    const res = await request(app)
      .post('/api/v1/customers/me/bookings/bk-completed/review')
      .set(authCust1)
      .send({ rating: 2, comment: payload });
    expect(res.status).toBe(201);
    expect(res.body.data.comment).toBe(payload);
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });

  it('45. no driver functionality in completion/review modules', () => {
    const root = path.resolve(__dirname, '../');
    const completion = fs.readFileSync(path.join(root, 'src/modules/bookings/booking-completion.service.ts'), 'utf8');
    const reviews = fs.readFileSync(path.join(root, 'src/modules/bookings/booking-reviews.service.ts'), 'utf8');
    const providerRoutes = fs.readFileSync(path.join(root, 'src/modules/provider/provider.routes.ts'), 'utf8');
    const customerRoutes = fs.readFileSync(path.join(root, 'src/modules/customer/customer.routes.ts'), 'utf8');
    for (const content of [completion, reviews, providerRoutes, customerRoutes]) {
      expect(content.toLowerCase()).not.toMatch(/driver/);
    }
  });

  it('46. no hard-coded finance rules in completion/review modules', () => {
    const root = path.resolve(__dirname, '../');
    const completion = fs.readFileSync(path.join(root, 'src/modules/bookings/booking-completion.service.ts'), 'utf8');
    const reviews = fs.readFileSync(path.join(root, 'src/modules/bookings/booking-reviews.service.ts'), 'utf8');
    for (const content of [completion, reviews]) {
      expect(content).not.toMatch(/R\s?500|R\s?1000|R\s?5000|16%|25%/);
      expect(content).not.toContain('cashLedgerEntry');
    }
    // Commission rate comes from the configurable finance architecture only.
    expect(completion).toMatch(/commissionRate/);
  });

  it('47. other-customer auth cannot review via second account either', async () => {
    const res = await request(app).post('/api/v1/customers/me/bookings/bk-completed/review').set(authCust2).send({ rating: 1 });
    expect(res.status).toBe(404);
    expect(reviewStore['bk-completed']).toBeUndefined();
  });

  it('48. second provider cannot complete first provider booking', async () => {
    const res = await request(app).post('/api/v1/providers/me/bookings/bk-progress/complete').set(authProv2).send({});
    expect(res.status).toBe(404);
    expect(store['bk-progress'].status).toBe('IN_PROGRESS');
  });
});

// ── Frontend contracts (real web/mobile modules) ───────────────────────

describe('Slice 13 — frontend contracts and parity', () => {
  const root = path.resolve(__dirname, '../../');
  const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');

  function stubHttp() {
    const calls: Array<{ method: string; url: string; body?: unknown; options?: unknown }> = [];
    const http: any = {
      get: (url: string, options?: unknown) => {
        calls.push({ method: 'GET', url, options });
        return of({ success: true, data: {} });
      },
      post: (url: string, body?: unknown) => {
        calls.push({ method: 'POST', url, body });
        return of({ success: true, data: {} });
      },
    };
    return { http, calls };
  }

  it('49. provider complete() hits the session-owned endpoint on web and mobile', (done) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { ProviderBookingsService: WebSvc } = require('../../apps/web/src/app/core/services/provider-bookings.service');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { ProviderBookingsService: MobileSvc } = require('../../apps/mobile/src/app/core/services/provider-bookings.service');
    const web = stubHttp();
    const mobile = stubHttp();
    new WebSvc(web.http).complete('bk-1').subscribe(() => {
      new MobileSvc(mobile.http).complete('bk-1').subscribe(() => {
        expect(web.calls[0]).toMatchObject({ method: 'POST', url: '/api/v1/providers/me/bookings/bk-1/complete', body: {} });
        expect(mobile.calls[0]).toMatchObject({ method: 'POST', url: '/api/v1/providers/me/bookings/bk-1/complete', body: {} });
        expect(JSON.stringify(web.calls[0].body)).not.toMatch(/providerId/);
        done();
      });
    });
  });

  it('50. customer submitReview/getReview hit session-owned endpoints with rating+comment only', (done) => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { CustomerBookingsService: WebSvc } = require('../../apps/web/src/app/core/services/customer-bookings.service');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { CustomerBookingsService: MobileSvc } = require('../../apps/mobile/src/app/core/services/customer-bookings.service');
    const web = stubHttp();
    const mobile = stubHttp();
    new WebSvc(web.http).submitReview('bk-1', 5, 'Great').subscribe(() => {
      new MobileSvc(mobile.http).submitReview('bk-1', 5, 'Great').subscribe(() => {
        expect(web.calls[0]).toMatchObject({
          method: 'POST',
          url: '/api/v1/customers/me/bookings/bk-1/review',
          body: { rating: 5, comment: 'Great' },
        });
        expect(mobile.calls[0]).toMatchObject({
          method: 'POST',
          url: '/api/v1/customers/me/bookings/bk-1/review',
          body: { rating: 5, comment: 'Great' },
        });
        new WebSvc(web.http).getReview('bk-1').subscribe(() => {
          expect(web.calls[1]).toMatchObject({ method: 'GET', url: '/api/v1/customers/me/bookings/bk-1/review' });
          done();
        });
      });
    });
  });

  it('51. web/mobile completion + review helpers agree (canComplete/canReview/rating)', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const webProv = require('../../apps/web/src/app/features/provider-bookings/provider-bookings.utils');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mobileProv = require('../../apps/mobile/src/app/features/provider-bookings/provider-bookings.utils');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const webCust = require('../../apps/web/src/app/features/bookings/customer-bookings.utils');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mobileCust = require('../../apps/mobile/src/app/features/bookings/customer-bookings.utils');
    for (const status of ['PENDING', 'ACCEPTED', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'DECLINED']) {
      expect(mobileProv.canCompleteBooking(status)).toBe(webProv.canCompleteBooking(status));
      expect(mobileCust.canReviewBooking(status)).toBe(webCust.canReviewBooking(status));
    }
    expect(webProv.canCompleteBooking('IN_PROGRESS')).toBe(true);
    expect(webProv.canCompleteBooking('PENDING')).toBe(false);
    expect(webCust.canReviewBooking('COMPLETED')).toBe(true);
    expect(webCust.canReviewBooking('IN_PROGRESS')).toBe(false);
    expect(webCust.REVIEW_RATINGS).toEqual([1, 2, 3, 4, 5]);
    expect(webCust.isValidRating(5)).toBe(true);
    expect(webCust.isValidRating(0)).toBe(false);
    expect(webCust.isValidRating(1.5)).toBe(false);
    expect(typeof webProv.isOnline()).toBe('boolean');
    expect(typeof webCust.isOnline()).toBe('boolean');
    // Duplicate-review errors map to user-safe conflict text on both apps.
    expect(webCust.interpretActionError({ status: 409, error: { error: { code: 'REVIEW_ALREADY_EXISTS' } } }).kind).toBe('conflict');
    expect(mobileCust.interpretActionError({ status: 422, error: { error: { code: 'REVIEW_NOT_ELIGIBLE' } } }).kind).toBe('invalid-state');
  });

  it('52. provider detail exposes Mark Service Complete only for IN_PROGRESS (web + mobile)', () => {
    const web = read('apps/web/src/app/features/provider-bookings/provider-booking-detail.component.ts');
    const mobile = read('apps/mobile/src/app/features/provider-bookings/provider-booking-detail.page.ts');
    for (const content of [web, mobile]) {
      expect(content).toMatch(/Mark Service Complete/);
      expect(content).toMatch(/canCompleteBooking/);
      expect(content).toMatch(/bookings\.complete\(/);
      expect(content).toMatch(/isOnline/);
      expect(content).toMatch(/Yes, mark complete/);
      // Legacy accept/reject workflow preserved.
      expect(content).toMatch(/Accept booking/);
    }
    // The session-owned completion endpoint lives in the API client.
    for (const svc of [
      read('apps/web/src/app/core/services/provider-bookings.service.ts'),
      read('apps/mobile/src/app/core/services/provider-bookings.service.ts'),
    ]) {
      expect(svc).toMatch(/\/complete/);
    }
  });

  it('53. customer detail exposes Leave-a-Review with text-only rendering (web + mobile)', () => {
    const web = read('apps/web/src/app/features/bookings/my-booking-detail.component.ts');
    const mobile = read('apps/mobile/src/app/features/bookings/my-booking-detail.page.ts');
    for (const content of [web, mobile]) {
      expect(content).toMatch(/Submit review/);
      expect(content).toMatch(/canReviewBooking/);
      expect(content).toMatch(/submitReview/);
      expect(content).toMatch(/getReview/);
      expect(content).toMatch(/isOnline/);
      // Review content rendered as text interpolation — never raw HTML.
      expect(content).not.toMatch(/innerHTML/);
      expect(content).toMatch(/\{\{\s*existingReview\.comment\s*\}\}/);
    }
  });

  it('54. offline safety: completion/review guarded, never queued as success', () => {
    const webProv = read('apps/web/src/app/features/provider-bookings/provider-booking-detail.component.ts');
    const webCust = read('apps/web/src/app/features/bookings/my-booking-detail.component.ts');
    for (const content of [webProv, webCust]) {
      expect(content).toMatch(/isOnline\(\)/);
    }
    // The user-safe offline copy lives in the shared utils (single source).
    const custUtils = read('apps/web/src/app/features/bookings/customer-bookings.utils.ts');
    const provUtils = read('apps/web/src/app/features/provider-bookings/provider-bookings.utils.ts');
    expect(custUtils).toMatch(/nothing was changed/);
    expect(webProv).toMatch(/nothing was changed/);
    // Services are thin HTTP clients with no local state queue or fake success.
    const svc = read('apps/web/src/app/core/services/customer-bookings.service.ts');
    expect(svc).not.toMatch(/localStorage|IndexedDB|queue|pending:/i);
    const provSvc = read('apps/web/src/app/core/services/provider-bookings.service.ts');
    expect(provSvc).not.toMatch(/localStorage|IndexedDB|queue/i);
  });
});

/**
 * Phase 2 Slice 7 — Notifications & booking communication.
 *
 * 27 scenarios: event generation, server-side recipients, safe 404s,
 * pagination, read state, idempotency, payment separation, preferences,
 * snapshot content, privacy, tenant isolation, sanitized errors.
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
const mockUserFindUnique = jest.fn();
const mockCustomerProfileFindUnique = jest.fn();
const mockProviderProfileFindUnique = jest.fn();
const mockBusinessFindUnique = jest.fn();
const mockBusinessUnitFindUnique = jest.fn();
const mockBookingFindUnique = jest.fn();
const mockNotificationCreate = jest.fn();
const mockNotificationFindUnique = jest.fn();
const mockNotificationFindMany = jest.fn();
const mockNotificationCount = jest.fn();
const mockNotificationUpdate = jest.fn();
const mockNotificationUpdateMany = jest.fn();
const mockPrefFindUnique = jest.fn();
const mockPrefFindMany = jest.fn();
const mockPrefUpsert = jest.fn();
const mockAuditCreate = jest.fn();

jest.mock('../src/config/prisma', () => ({
  prisma: {
    user: { findUnique: (...a: any[]) => (mockUserFindUnique as any)(...a) },
    customerProfile: { findUnique: (...a: any[]) => (mockCustomerProfileFindUnique as any)(...a) },
    providerProfile: { findUnique: (...a: any[]) => (mockProviderProfileFindUnique as any)(...a) },
    business: { findUnique: (...a: any[]) => (mockBusinessFindUnique as any)(...a) },
    businessUnit: { findUnique: (...a: any[]) => (mockBusinessUnitFindUnique as any)(...a) },
    booking: { findUnique: (...a: any[]) => (mockBookingFindUnique as any)(...a) },
    notification: {
      create: (...a: any[]) => (mockNotificationCreate as any)(...a),
      findUnique: (...a: any[]) => (mockNotificationFindUnique as any)(...a),
      findMany: (...a: any[]) => (mockNotificationFindMany as any)(...a),
      count: (...a: any[]) => (mockNotificationCount as any)(...a),
      update: (...a: any[]) => (mockNotificationUpdate as any)(...a),
      updateMany: (...a: any[]) => (mockNotificationUpdateMany as any)(...a),
    },
    notificationPreference: {
      findUnique: (...a: any[]) => (mockPrefFindUnique as any)(...a),
      findMany: (...a: any[]) => (mockPrefFindMany as any)(...a),
      upsert: (...a: any[]) => (mockPrefUpsert as any)(...a),
    },
    auditLog: { create: (...a: any[]) => (mockAuditCreate as any)(...a) },
  },
}));

import { app } from '../src/app';
import { emitNotification, deliverViaChannel } from '../src/modules/notifications/notification.service';
import {
  notifyBookingCreated,
  notifyBookingReviewed,
  notifyCashRecorded,
  notifyEftPending,
  notifyPaymentResolved,
} from '../src/modules/notifications/booking-notifications';

// ---- fixtures ----
let notifStore: Record<string, any> = {};
let prefStore: Record<string, any> = {};
let seq = 0;
let failNextCreateOnce: { code: string } | null = null;

function filtered(where: { recipientUserId?: string; status?: string }): any[] {
  return Object.values(notifStore)
    .filter((n) => (!where.recipientUserId || n.recipientUserId === where.recipientUserId) && (!where.status || n.status === where.status))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

const CUSTOMERS: Record<string, any> = {
  'cust-1': { userId: 'user-cust1', displayName: 'Test Customer', firstName: 'Test' },
  'cust-2': { userId: 'user-cust2', displayName: 'Second Customer', firstName: 'Second' },
};
const PROVIDERS: Record<string, any> = {
  'prov-1': { userId: 'user-prov1', displayName: 'Sharp Cuts' },
};

beforeEach(() => {
  jest.clearAllMocks();
  notifStore = {};
  prefStore = {};
  seq = 0;
  failNextCreateOnce = null;

  mockUserFindUnique.mockImplementation(async ({ where }: any) => {
    if (['user-cust1', 'user-cust2', 'user-prov1', 'user-provBiz'].includes(where?.id)) {
      return { id: where.id, status: 'ACTIVE' } as never;
    }
    return null;
  });
  mockCustomerProfileFindUnique.mockImplementation(async ({ where }: any) => {
    if (where?.id) {
      const c = CUSTOMERS[where.id];
      return c ? { id: where.id, ...c } : null;
    }
    return null;
  });
  mockProviderProfileFindUnique.mockImplementation(async ({ where }: any) => {
    if (where?.id) {
      const p = PROVIDERS[where.id];
      return p ? { id: where.id, ...p } : null;
    }
    return null;
  });
  mockBusinessUnitFindUnique.mockImplementation(async ({ where }: any) => {
    if (where?.id === 'unit-1') return { id: 'unit-1', businessId: 'biz-1' } as never;
    return null;
  });
  mockBusinessFindUnique.mockImplementation(async ({ where }: any) => {
    if (where?.id === 'biz-1') return { id: 'biz-1', ownerProviderId: 'user-provBiz' } as never;
    return null;
  });
  mockBookingFindUnique.mockImplementation(async ({ where }: any) => {
    if (where?.id === 'bk-1') {
      return {
        id: 'bk-1',
        customerId: 'cust-1',
        providerId: 'prov-1',
        businessUnitId: null,
        items: [{ serviceNameSnapshot: 'Fade' }],
      } as never;
    }
    return null;
  });

  mockNotificationCreate.mockImplementation(async ({ data }: any) => {
    if (failNextCreateOnce) {
      const f = failNextCreateOnce;
      failNextCreateOnce = null;
      throw f;
    }
    if (data.eventKey && Object.values(notifStore).some((n) => n.eventKey === data.eventKey)) {
      throw { code: 'P2002', meta: { target: ['event_key'] } };
    }
    seq += 1;
    const row = {
      id: `n${seq}`,
      status: 'UNREAD',
      readAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...data,
    };
    notifStore[row.id] = row;
    return row;
  });
  mockNotificationFindUnique.mockImplementation(async ({ where }: any) => {
    if (where?.id) return notifStore[where.id] ?? null;
    if (where?.eventKey) return Object.values(notifStore).find((n) => n.eventKey === where.eventKey) ?? null;
    return null;
  });
  mockNotificationFindMany.mockImplementation(async ({ where, skip, take }: any) => {
    const all = filtered(where ?? {});
    const start = Math.max(0, skip ?? 0);
    return take != null ? all.slice(start, start + take) : all.slice(start);
  });
  mockNotificationCount.mockImplementation(async ({ where }: any) => filtered(where ?? {}).length);
  mockNotificationUpdate.mockImplementation(async ({ where, data }: any) => {
    if (!notifStore[where.id]) throw { code: 'P2025' };
    notifStore[where.id] = { ...notifStore[where.id], ...data };
    return notifStore[where.id];
  });
  mockNotificationUpdateMany.mockImplementation(async ({ where, data }: any) => {
    let count = 0;
    for (const n of filtered(where ?? {})) {
      notifStore[n.id] = { ...n, ...data };
      count += 1;
    }
    return { count };
  });

  mockPrefFindUnique.mockImplementation(async ({ where }: any) => {
    const k = where?.userId_channel_notificationType;
    if (!k) return null;
    return prefStore[`${k.userId}:${k.channel}:${k.notificationType}`] ?? null;
  });
  mockPrefFindMany.mockImplementation(async ({ where }: any) => {
    return Object.values(prefStore).filter((p) => !where?.userId || p.userId === where.userId);
  });
  mockPrefUpsert.mockImplementation(async ({ where, create, update }: any) => {
    const k = where?.userId_channel_notificationType;
    const key = `${k.userId}:${k.channel}:${k.notificationType}`;
    prefStore[key] = { id: `pref-${key}`, ...(prefStore[key] ?? {}), ...create, ...update };
    return prefStore[key];
  });
  mockAuditCreate.mockResolvedValue({});
});

const cust1 = () => token('user-cust1');
const cust2 = () => token('user-cust2');
const prov1 = () => token('user-prov1');

function bookingRef(over: Record<string, unknown> = {}) {
  return {
    id: 'bk-1',
    customerId: 'cust-1',
    providerId: 'prov-1',
    businessUnitId: null,
    scheduledStart: new Date('2026-09-08T09:00:00.000Z'),
    timezone: 'Africa/Johannesburg',
    items: [{ serviceNameSnapshot: 'Fade' }],
    ...over,
  };
}

describe('Slice 7 — booking event generation', () => {
  it('1. customer receives booking-created notification from snapshots', async () => {
    await notifyBookingCreated(bookingRef());
    const mine = Object.values(notifStore).filter((n) => n.recipientUserId === 'user-cust1');
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ audience: 'CUSTOMER', type: 'BOOKING_CREATED', channel: 'IN_APP', status: 'UNREAD' });
    expect(mine[0].title).toBe('Booking submitted');
    expect(mine[0].message).toContain('Fade');
    expect(mine[0].message).toContain('Sharp Cuts');
    expect(mine[0].eventKey).toBe('booking:bk-1:status:PENDING:customer');
  });

  it('2. provider receives new booking notification with minimal customer info', async () => {
    await notifyBookingCreated(bookingRef());
    const prov = Object.values(notifStore).filter((n) => n.recipientUserId === 'user-prov1');
    expect(prov).toHaveLength(1);
    expect(prov[0]).toMatchObject({ audience: 'PROVIDER', type: 'NEW_BOOKING_REQUEST' });
    expect(prov[0].title).toBe('New booking request');
    expect(prov[0].message).toContain('Test Customer');
    expect(prov[0].message).toContain('Fade');
    expect(JSON.stringify(prov[0])).not.toMatch(/@test\.local|password|token/i);
  });

  it('3. provider accept generates customer notification', async () => {
    await notifyBookingReviewed(bookingRef(), 'ACCEPTED');
    const mine = Object.values(notifStore).filter((n) => n.recipientUserId === 'user-cust1');
    expect(mine).toHaveLength(1);
    expect(mine[0].title).toBe('Booking accepted');
    expect(mine[0].message).toBe('Sharp Cuts accepted your booking for Fade.');
    expect(mine[0].eventKey).toBe('booking:bk-1:status:ACCEPTED');
  });

  it('4. provider decline generates customer notification', async () => {
    await notifyBookingReviewed(bookingRef(), 'DECLINED');
    const mine = Object.values(notifStore).filter((n) => n.recipientUserId === 'user-cust1');
    expect(mine).toHaveLength(1);
    expect(mine[0].title).toBe('Booking declined');
    expect(mine[0].message).toContain('declined your booking for Fade');
    expect(mine[0].eventKey).toBe('booking:bk-1:status:DECLINED');
  });

  it('5. recipients derived server-side; unknown parties fail silently without crashing', async () => {
    await notifyBookingCreated(bookingRef({ customerId: 'cust-ghost', providerId: 'prov-ghost' }));
    expect(Object.keys(notifStore)).toHaveLength(0);
    expect(mockCustomerProfileFindUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'cust-ghost' } }));
  });

  it('19. content uses booking snapshots, never mutable service data', async () => {
    await notifyBookingReviewed(bookingRef({ items: [{ serviceNameSnapshot: 'Legacy Name' }] }), 'ACCEPTED');
    const mine = Object.values(notifStore).filter((n) => n.recipientUserId === 'user-cust1');
    expect(mine[0].message).toContain('Legacy Name');
    expect(mockNotificationCreate).toHaveBeenCalled();
  });

  it('20. no sensitive location leakage in notification payloads', async () => {
    await notifyBookingCreated(bookingRef());
    await notifyBookingReviewed(bookingRef(), 'ACCEPTED');
    const payload = JSON.stringify(Object.values(notifStore));
    expect(payload).not.toMatch(/-26\.2|28\.0|Main Rd|latitude|longitude/i);
  });

  it('21. no HTML/XSS injection — bodies stay plain text', async () => {
    CUSTOMERS['cust-x'] = { userId: 'user-x', displayName: '<script>alert(1)</script>', firstName: 'X' };
    mockUserFindUnique.mockImplementation(async ({ where }: any) => ({ id: where.id, status: 'ACTIVE' }) as never);
    await notifyBookingCreated(bookingRef({ customerId: 'cust-x' }));
    const prov = Object.values(notifStore).filter((n) => n.recipientUserId === 'user-prov1');
    expect(prov[0].message).toContain('<script>alert(1)</script>'); // stored as inert text
    expect(prov[0]).not.toHaveProperty('html');
    expect(prov[0]).not.toHaveProperty('richText');
    delete CUSTOMERS['cust-x'];
  });

  it('22. tenant isolation — T3 unit booking notifies the business owner, not outsiders', async () => {
    await notifyBookingCreated(bookingRef({ providerId: null, businessUnitId: 'unit-1' }));
    const owner = Object.values(notifStore).filter((n) => n.recipientUserId === 'user-provBiz');
    expect(owner).toHaveLength(1);
    expect(owner[0].type).toBe('NEW_BOOKING_REQUEST');
    expect(Object.values(notifStore).some((n) => n.recipientUserId === 'user-cust2')).toBe(false);
  });
});

describe('Slice 7 — payment notifications', () => {
  const cashPayment = { id: 'pay-1', bookingId: 'bk-1', method: 'cash', status: 'PAID', amount: 200, currency: 'ZAR' };

  it('15a. cash recorded notifies the provider with change text', async () => {
    await notifyCashRecorded(cashPayment, { changeRequested: true, changeAmount: 50 });
    const prov = Object.values(notifStore).filter((n) => n.recipientUserId === 'user-prov1');
    expect(prov).toHaveLength(1);
    expect(prov[0]).toMatchObject({ type: 'CASH_RECORDED', audience: 'PROVIDER' });
    expect(prov[0].message).toContain('R50 change');
    expect(prov[0].eventKey).toBe('payment:pay-1:cash-recorded');
  });

  it('15b. EFT pending notifies the customer (never auto-PAID)', async () => {
    await notifyEftPending({ ...cashPayment, id: 'pay-2', method: 'eft', status: 'PENDING' });
    const mine = Object.values(notifStore).filter((n) => n.recipientUserId === 'user-cust1');
    expect(mine).toHaveLength(1);
    expect(mine[0].type).toBe('PAYMENT_EFT_PENDING');
    expect(mine[0].message).toContain('awaiting confirmation');
  });

  it('15c/16. webhook PAID notifies both parties; payment stays separate from completion', async () => {
    await notifyPaymentResolved({ ...cashPayment, method: 'waasha_payment', status: 'PAID' }, 'gw-ev-1', 'PAID');
    const cust = Object.values(notifStore).filter((n) => n.recipientUserId === 'user-cust1');
    const prov = Object.values(notifStore).filter((n) => n.recipientUserId === 'user-prov1');
    expect(cust).toHaveLength(1);
    expect(prov).toHaveLength(1);
    expect(cust[0].type).toBe('PAYMENT_PAID');
    expect(cust[0].message).toContain('separate from service completion');
    expect(cust[0].eventKey).toContain('gw-ev-1');
  });

  it('payment FAILED notifies the customer with retry guidance', async () => {
    await notifyPaymentResolved({ ...cashPayment, method: 'waasha_payment', status: 'FAILED' }, 'gw-ev-2', 'FAILED');
    const cust = Object.values(notifStore).filter((n) => n.recipientUserId === 'user-cust1');
    expect(cust[0].type).toBe('PAYMENT_FAILED');
    expect(cust[0].message).toContain('retry');
  });
});

describe('Slice 7 — idempotency', () => {
  it('13. duplicate booking event does not duplicate the notification', async () => {
    await notifyBookingReviewed(bookingRef(), 'ACCEPTED');
    await notifyBookingReviewed(bookingRef(), 'ACCEPTED');
    const mine = Object.values(notifStore).filter((n) => n.recipientUserId === 'user-cust1');
    expect(mine).toHaveLength(1);
  });

  it('14. concurrent/retried event remains idempotent via event_key unique race', async () => {
    failNextCreateOnce = { code: 'P2002' };
    // Seed the row the "losing" transaction would find on retry lookup.
    notifStore.seed = {
      id: 'seed',
      recipientUserId: 'user-cust1',
      audience: 'CUSTOMER',
      type: 'BOOKING_ACCEPTED',
      channel: 'IN_APP',
      status: 'UNREAD',
      title: 'Booking accepted',
      message: 'Sharp Cuts accepted your booking for Fade.',
      entityType: 'booking',
      entityId: 'bk-1',
      eventKey: 'booking:bk-1:status:ACCEPTED',
      readAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const res = await emitNotification({
      recipientUserId: 'user-cust1',
      audience: 'CUSTOMER',
      type: 'BOOKING_ACCEPTED',
      title: 'Booking accepted',
      message: 'Sharp Cuts accepted your booking for Fade.',
      entityType: 'booking',
      entityId: 'bk-1',
      eventKey: 'booking:bk-1:status:ACCEPTED',
    });
    expect(res.duplicate).toBe(true);
    expect(res.notification?.id).toBe('seed');
    expect(Object.values(notifStore).filter((n) => n.eventKey === 'booking:bk-1:status:ACCEPTED')).toHaveLength(1);
  });

  it('24. unsupported channel delivery is skipped, never faked', async () => {
    const receipt = await deliverViaChannel('PUSH', {
      recipientUserId: 'user-cust1',
      audience: 'CUSTOMER',
      type: 'BOOKING_ACCEPTED',
      title: 't',
      message: 'm',
    });
    expect(receipt).toMatchObject({ channel: 'PUSH', delivered: false, reason: 'NO_ADAPTER_REGISTERED' });
    expect(Object.keys(notifStore)).toHaveLength(0);
  });

  it('24b. invalid intent rejected without side effects', async () => {
    await expect(
      emitNotification({ recipientUserId: '', audience: 'CUSTOMER', type: 'BOOKING_ACCEPTED', title: 't', message: 'm' }),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(Object.keys(notifStore)).toHaveLength(0);
  });
});

describe('Slice 7 — notification API + authorization', () => {
  beforeEach(async () => {
    await notifyBookingReviewed(bookingRef(), 'ACCEPTED');
    await notifyBookingCreated(bookingRef({ id: 'bk-2' }));
  });

  it('lists own notifications with DTO shape (no Prisma leakage)', async () => {
    const res = await request(app).get('/api/v1/notifications').set('Authorization', `Bearer ${cust1()}`);
    expect(res.status).toBe(200);
    // bk-2 creation: customer BOOKING_CREATED + provider NEW_BOOKING_REQUEST; accept: BOOKING_ACCEPTED
    expect(res.body.data.length).toBeGreaterThanOrEqual(2);
    const first = res.body.data[0];
    expect(Object.keys(first).sort()).toEqual(
      ['audience', 'channel', 'createdAt', 'deepLink', 'entityId', 'entityType', 'id', 'message', 'readAt', 'status', 'title', 'type'].sort(),
    );
    expect(first.deepLink).toMatch(/^\/bookings\//);
    expect(res.body.meta.unreadCount).toBeGreaterThanOrEqual(2);
  });

  it('6. cross-user notification access returns safe 404', async () => {
    const mine = await request(app).get('/api/v1/notifications').set('Authorization', `Bearer ${cust1()}`);
    const id = mine.body.data[0].id;
    const cross = await request(app).patch(`/api/v1/notifications/${id}/read`).set('Authorization', `Bearer ${cust2()}`);
    expect(cross.status).toBe(404);
    expect(cross.body.error.code).toBe('NOTIFICATION_NOT_FOUND');
    const crossGet = await request(app).get('/api/v1/notifications').set('Authorization', `Bearer ${cust2()}`);
    expect(crossGet.body.data).toHaveLength(0);
  });

  it('7. unauthenticated notification access rejected', async () => {
    expect((await request(app).get('/api/v1/notifications')).status).toBe(401);
    expect((await request(app).get('/api/v1/notifications/unread-count')).status).toBe(401);
    expect((await request(app).post('/api/v1/notifications/n1/read')).status).toBe(401);
  });

  it('8/26. pagination with sane bounds', async () => {
    const p1 = await request(app).get('/api/v1/notifications').query({ page: 1, perPage: 1 }).set('Authorization', `Bearer ${cust1()}`);
    expect(p1.body.data).toHaveLength(1);
    expect(p1.body.meta.page).toBe(1);
    expect((await request(app).get('/api/v1/notifications').query({ perPage: 100 }).set('Authorization', `Bearer ${cust1()}`)).status).toBe(422);
    expect((await request(app).get('/api/v1/notifications').query({ page: 0 }).set('Authorization', `Bearer ${cust1()}`)).status).toBe(422);
  });

  it('9/10/12. unread count, mark one read (PATCH + POST), count updates', async () => {
    const before = await request(app).get('/api/v1/notifications/unread-count').set('Authorization', `Bearer ${cust1()}`);
    expect(before.body.data.unreadCount).toBeGreaterThanOrEqual(2);
    const list = await request(app).get('/api/v1/notifications').set('Authorization', `Bearer ${cust1()}`);
    const id = list.body.data[0].id;
    const marked = await request(app).patch(`/api/v1/notifications/${id}/read`).set('Authorization', `Bearer ${cust1()}`);
    expect(marked.status).toBe(200);
    expect(marked.body.data.notification.status).toBe('READ');
    const after = await request(app).get('/api/v1/notifications/unread-count').set('Authorization', `Bearer ${cust1()}`);
    expect(after.body.data.unreadCount).toBe(before.body.data.unreadCount - 1);
    // POST alias also works
    const id2 = list.body.data[1].id;
    expect((await request(app).post(`/api/v1/notifications/${id2}/read`).set('Authorization', `Bearer ${cust1()}`)).status).toBe(200);
  });

  it('11. mark all read', async () => {
    const res = await request(app).post('/api/v1/notifications/read-all').set('Authorization', `Bearer ${cust1()}`);
    expect(res.status).toBe(200);
    expect(res.body.data.updated).toBeGreaterThanOrEqual(2);
    expect((await request(app).get('/api/v1/notifications/unread-count').set('Authorization', `Bearer ${cust1()}`)).body.data.unreadCount).toBe(0);
  });

  it('provider inbox is separate; deep links route per audience', async () => {
    const prov = await request(app).get('/api/v1/notifications').set('Authorization', `Bearer ${prov1()}`);
    expect(prov.body.data.length).toBeGreaterThanOrEqual(1);
    expect(prov.body.data[0].audience).toBe('PROVIDER');
    expect(prov.body.data[0].deepLink).toMatch(/^\/provider\/bookings\//);
    // Provider cannot see customer notifications and vice versa (recipient-scoped).
    expect(prov.body.data.every((n: { recipientUserId?: string }) => n.recipientUserId === undefined)).toBe(true);
  });

  it('25. invalid notification ID handling → safe 404', async () => {
    const res = await request(app).patch('/api/v1/notifications/does-not-exist/read').set('Authorization', `Bearer ${cust1()}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOTIFICATION_NOT_FOUND');
  });

  it('27. internal errors sanitized', async () => {
    mockNotificationFindMany.mockRejectedValueOnce(new Error('SELECT * FROM notifications -- prisma boom'));
    const res = await request(app).get('/api/v1/notifications').set('Authorization', `Bearer ${cust1()}`);
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(res.body)).not.toMatch(/SELECT|prisma/i);
  });

  it('23. related booking access remains authorized (deep link target enforced elsewhere)', async () => {
    const mine = await request(app).get('/api/v1/notifications').set('Authorization', `Bearer ${cust1()}`);
    const withLink = mine.body.data.find((n: { deepLink: string | null }) => n.deepLink);
    expect(withLink.deepLink).toMatch(/^\/bookings\/bk-/);
  });
});

describe('Slice 7 — preferences', () => {
  it('17. defaults: all categories enabled; marketing separately listed', async () => {
    const res = await request(app).get('/api/v1/notifications/preferences').set('Authorization', `Bearer ${cust1()}`);
    expect(res.status).toBe(200);
    const types = res.body.data.preferences.map((p: { notificationType: string }) => p.notificationType);
    expect(types).toContain('BOOKING_UPDATES');
    expect(types).toContain('PAYMENT_UPDATES');
    expect(types).toContain('MARKETING');
    expect(res.body.data.preferences.every((p: { isEnabled: boolean }) => p.isEnabled)).toBe(true);
  });

  it('18. marketing can be disabled; transactional IN_APP is locked', async () => {
    const off = await request(app).put('/api/v1/notifications/preferences').set('Authorization', `Bearer ${cust1()}`).send({ channel: 'IN_APP', notificationType: 'MARKETING', isEnabled: false });
    expect(off.status).toBe(200);
    expect(off.body.data.preference.isEnabled).toBe(false);
    const locked = await request(app).put('/api/v1/notifications/preferences').set('Authorization', `Bearer ${cust1()}`).send({ channel: 'IN_APP', notificationType: 'BOOKING_UPDATES', isEnabled: false });
    expect(locked.status).toBe(422);
    expect(locked.body.error.code).toBe('PREFERENCE_LOCKED');
    const bad = await request(app).put('/api/v1/notifications/preferences').set('Authorization', `Bearer ${cust1()}`).send({ channel: 'CARRIER_PIGEON', notificationType: 'MARKETING', isEnabled: true });
    expect(bad.status).toBe(422);
  });

  it('transactional emission ignores stale disabled rows (fail-safe)', async () => {
    prefStore['user-cust1:IN_APP:BOOKING_UPDATES'] = { userId: 'user-cust1', channel: 'IN_APP', notificationType: 'BOOKING_UPDATES', isEnabled: false };
    await notifyBookingReviewed(bookingRef(), 'ACCEPTED');
    expect(Object.values(notifStore).filter((n) => n.recipientUserId === 'user-cust1')).toHaveLength(1);
  });

  it('migration + schema carry the idempotency contract', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const sql = fs.readFileSync(path.resolve(__dirname, '../prisma/migrations/20260906060000_add_notifications/migration.sql'), 'utf8');
    expect(sql).toMatch(/CREATE TABLE `notifications`/);
    expect(sql).toMatch(/event_key/);
    expect(sql).toMatch(/UNIQUE INDEX `notifications_event_key_key`/);
    expect(sql).toMatch(/CREATE TABLE `notification_preferences`/);
  });
});

/**
 * Phase 2 Slice 3 — Booking foundation: availability + creation + snapshots + security
 * Covers 16 required scenarios + frontend contract.
 */
import request from 'supertest';
import jwt from 'jsonwebtoken';

function token(payload: { sub: string; roles?: string[] }) {
  const secret = process.env.JWT_SECRET ?? 'dev-jwt-secret-change-me';
  return jwt.sign({ uuid: payload.sub, email: `${payload.sub}@test.local`, ...payload }, secret, { expiresIn: '1h', issuer: 'waasha', audience: 'waasha-app' } as any);
}

// ---- mocks ----
const mockAdminSettingFindMany = jest.fn();
const mockProviderProfileFindUnique = jest.fn();
const mockServiceFindUnique = jest.fn();
const mockBusinessFindMany = jest.fn();
const mockBusinessUnitFindMany = jest.fn();
const mockProviderLocationFindFirst = jest.fn();
const mockAvailabilityRuleFindMany = jest.fn();
const mockAvailabilityExceptionFindMany = jest.fn();
const mockBookingFindMany = jest.fn();
const mockBookingFindFirst = jest.fn();
const mockBookingCreate = jest.fn();
const mockBookingFindUnique = jest.fn();
const mockBookingItemCreate = jest.fn();
const mockBookingLocationCreate = jest.fn();
const mockCustomerProfileFindUnique = jest.fn();
const mockUserFindUnique = jest.fn();
const mockAuditCreate = jest.fn();
const mockQueryRaw = jest.fn().mockResolvedValue([1]);
const mockTransaction = jest.fn();

jest.mock('../src/config/prisma', () => ({
  prisma: {
    adminSetting: { findMany: mockAdminSettingFindMany },
    providerProfile: { findUnique: mockProviderProfileFindUnique },
    service: { findUnique: mockServiceFindUnique },
    business: { findMany: mockBusinessFindMany },
    businessUnit: { findMany: mockBusinessUnitFindMany },
    providerLocation: { findFirst: mockProviderLocationFindFirst },
    availabilityRule: { findMany: mockAvailabilityRuleFindMany },
    availabilityException: { findMany: mockAvailabilityExceptionFindMany },
    booking: { findMany: mockBookingFindMany, findFirst: mockBookingFindFirst, create: mockBookingCreate, findUnique: mockBookingFindUnique },
    bookingItem: { create: mockBookingItemCreate },
    bookingLocation: { create: mockBookingLocationCreate },
    customerProfile: { findUnique: mockCustomerProfileFindUnique },
    user: { findUnique: mockUserFindUnique },
    auditLog: { create: mockAuditCreate },
    $queryRaw: mockQueryRaw,
    $transaction: (...args: any[]) => (mockTransaction as any)(...args),
  },
}));

import { app } from '../src/app';
import { localToUtcIso, getDayOfWeekForProviderDate, DEFAULT_TIMEZONE } from '../src/utils/timezone';

// helpers
function futureDateStr(daysAhead = 2): string {
  const d = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}
function dayOfWeekFor(dateStr: string, tz: string = DEFAULT_TIMEZONE): number {
  return getDayOfWeekForProviderDate(dateStr, tz);
}
function slotIso(dateStr: string, localTime: string, tz: string = DEFAULT_TIMEZONE): string {
  return localToUtcIso(dateStr, localTime, tz);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAdminSettingFindMany.mockResolvedValue([]);
  mockBusinessFindMany.mockResolvedValue([]);
  mockBusinessUnitFindMany.mockResolvedValue([]);
  mockProviderLocationFindFirst.mockResolvedValue(null);
  mockAvailabilityRuleFindMany.mockResolvedValue([]);
  mockAvailabilityExceptionFindMany.mockResolvedValue([]);
  mockBookingFindMany.mockResolvedValue([]);
  mockBookingFindFirst.mockResolvedValue(null);
  mockAuditCreate.mockResolvedValue({});
  mockQueryRaw.mockResolvedValue([1]);
  mockCustomerProfileFindUnique.mockResolvedValue(null);
  mockUserFindUnique.mockImplementation(async ({ where }: any) => {
    if (where?.id && String(where.id).startsWith('user')) return { id: where.id, status: 'ACTIVE' } as any;
    return null;
  });

  // Default transaction behavior: execute callback with prisma-like tx
  mockTransaction.mockImplementation(async (cb: any, _opts: any) => {
    const tx: any = {
      booking: { findFirst: mockBookingFindFirst, create: mockBookingCreate, findUnique: mockBookingFindUnique },
      bookingItem: { create: mockBookingItemCreate },
      bookingLocation: { create: mockBookingLocationCreate },
      providerCashAccount: { findUnique: jest.fn().mockResolvedValue(null) },
      auditLog: { create: mockAuditCreate },
      $queryRaw: mockQueryRaw,
    };
    // For booking creation transaction, cb expects (tx) => ...
    if (typeof cb === 'function') return cb(tx);
    return cb;
  });

  let lastItemPrice = 200;
  let lastItemDuration = 30;
  mockBookingCreate.mockImplementation(async ({ data }: any) => ({
    id: 'booking-1',
    uuid: 'uuid-booking-1',
    customerId: data.customerId,
    providerId: data.providerId,
    serviceId: data.serviceId,
    scheduledStart: data.scheduledStart,
    scheduledEnd: data.scheduledEnd,
    timezone: data.timezone,
    status: data.status,
    currency: data.currency,
    subtotal: data.subtotal,
    totalAmount: data.totalAmount,
    paymentStatus: data.paymentStatus,
    serviceLocationType: data.serviceLocationType,
  }));
  mockBookingItemCreate.mockImplementation(async ({ data }: any) => {
    lastItemPrice = data.unitPrice;
    lastItemDuration = data.durationMinutes;
    return { id: 'item-1', ...data };
  });
  mockBookingLocationCreate.mockImplementation(async ({ data }: any) => ({ id: 'bloc-1', ...data }));
  mockBookingFindUnique.mockImplementation(async ({ where }: any) => {
    if (where.id === 'booking-1') {
      return {
        id: 'booking-1',
        uuid: 'uuid-booking-1',
        customerId: 'cust-1',
        providerId: 'prov-1',
        serviceId: 'svc-1',
        scheduledStart: new Date(futureDateStr(2) + 'T09:00:00.000Z'),
        scheduledEnd: new Date(futureDateStr(2) + `T09:${String(lastItemDuration).padStart(2, '0')}:00.000Z`),
        timezone: 'Africa/Johannesburg',
        status: 'PENDING',
        currency: 'ZAR',
        subtotal: lastItemPrice,
        totalAmount: lastItemPrice,
        paymentStatus: 'PENDING',
        serviceLocationType: 'PROVIDER',
        items: [
          { id: 'item-1', serviceNameSnapshot: 'Fade', unitPrice: lastItemPrice, durationMinutes: lastItemDuration, lineTotal: lastItemPrice, currency: 'ZAR' },
        ],
        location: {
          id: 'bloc-1',
          bookingId: 'booking-1',
          locationType: 'PROVIDER',
          addressLine1: '10 Main Rd',
          city: 'Johannesburg',
          province: 'Gauteng',
          postalCode: '2196',
          country: 'ZA',
          latitude: -26.2,
          longitude: 28.0,
        },
      } as any;
    }
    if (where.id === 'booking-other') {
      return { id: 'booking-other', customerId: 'cust-other', providerId: 'prov-1', status: 'PENDING', items: [], location: null } as any;
    }
    return null;
  });
});

describe('GET /api/v1/bookings/availability', () => {
  it('1. successful availability retrieval', async () => {
    const date = futureDateStr(2);
    const dow = dayOfWeekFor(date);
    const tok = token({ sub: 'user-cust1' });
    mockUserFindUnique.mockResolvedValue({ id: 'user-cust1', status: 'ACTIVE' } as any);
    mockCustomerProfileFindUnique.mockResolvedValue({ id: 'cust-1', userId: 'user-cust1' } as any);
    mockProviderProfileFindUnique.mockResolvedValue({ id: 'prov-1', status: 'ACTIVE', userId: 'user-prov1' } as any);
    mockServiceFindUnique.mockResolvedValue({ id: 'svc-1', status: 'ACTIVE', providerId: 'prov-1', durationMinutes: 30, price: 200, currency: 'ZAR', serviceMode: 'BOTH' } as any);
    mockAvailabilityRuleFindMany.mockResolvedValue([{ providerId: 'prov-1', dayOfWeek: dow, startTime: '09:00', endTime: '11:00', isActive: true, timezone: 'Africa/Johannesburg' }]);
    mockAvailabilityExceptionFindMany.mockResolvedValue([]);
    mockBookingFindMany.mockResolvedValue([]);

    const res = await request(app).get('/api/v1/bookings/availability').set('Authorization', `Bearer ${tok}`).query({ providerId: 'prov-1', serviceId: 'svc-1', date });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.slots).toHaveLength(4); // 09:00-11:00 with 30min = 4 slots
    expect(res.body.data.slots[0].displayStart).toBe('09:00');
  });

  it('2. unavailable date/time — no rules yields no slots', async () => {
    const date = futureDateStr(3);
    const tok = token({ sub: 'user-cust1' });
    mockUserFindUnique.mockResolvedValue({ id: 'user-cust1', status: 'ACTIVE' } as any);
    mockProviderProfileFindUnique.mockResolvedValue({ id: 'prov-1', status: 'ACTIVE', userId: 'user-prov1' } as any);
    mockServiceFindUnique.mockResolvedValue({ id: 'svc-1', status: 'ACTIVE', providerId: 'prov-1', durationMinutes: 30, price: 200, currency: 'ZAR', serviceMode: 'BOTH' } as any);
    mockAvailabilityRuleFindMany.mockResolvedValue([]);
    mockAvailabilityExceptionFindMany.mockResolvedValue([]);
    mockBookingFindMany.mockResolvedValue([]);
    const res = await request(app).get('/api/v1/bookings/availability').set('Authorization', `Bearer ${tok}`).query({ providerId: 'prov-1', serviceId: 'svc-1', date });
    expect(res.status).toBe(200);
    expect(res.body.data.slots).toEqual([]);
  });

  it('3. provider availability exception — UNAVAILABLE all day', async () => {
    const date = futureDateStr(4);
    const dow = dayOfWeekFor(date);
    const tok = token({ sub: 'user-cust1' });
    mockUserFindUnique.mockResolvedValue({ id: 'user-cust1', status: 'ACTIVE' } as any);
    mockProviderProfileFindUnique.mockResolvedValue({ id: 'prov-1', status: 'ACTIVE', userId: 'user-prov1' } as any);
    mockServiceFindUnique.mockResolvedValue({ id: 'svc-1', status: 'ACTIVE', providerId: 'prov-1', durationMinutes: 30, price: 200, currency: 'ZAR', serviceMode: 'BOTH' } as any);
    mockAvailabilityRuleFindMany.mockResolvedValue([{ providerId: 'prov-1', dayOfWeek: dow, startTime: '09:00', endTime: '17:00', isActive: true }]);
    mockAvailabilityExceptionFindMany.mockResolvedValue([{ providerId: 'prov-1', date: new Date(date + 'T00:00:00Z'), type: 'UNAVAILABLE', startTime: null, endTime: null }]);
    mockBookingFindMany.mockResolvedValue([]);
    const res = await request(app).get('/api/v1/bookings/availability').set('Authorization', `Bearer ${tok}`).query({ providerId: 'prov-1', serviceId: 'svc-1', date });
    expect(res.status).toBe(200);
    expect(res.body.data.slots).toEqual([]);
  });

  it('4. existing booking conflict filters overlapping slot', async () => {
    const date = futureDateStr(2);
    const dow = dayOfWeekFor(date);
    const tok = token({ sub: 'user-cust1' });
    mockUserFindUnique.mockResolvedValue({ id: 'user-cust1', status: 'ACTIVE' } as any);
    mockProviderProfileFindUnique.mockResolvedValue({ id: 'prov-1', status: 'ACTIVE', userId: 'user-prov1', timezone: 'Africa/Johannesburg' } as any);
    mockServiceFindUnique.mockResolvedValue({ id: 'svc-1', status: 'ACTIVE', providerId: 'prov-1', durationMinutes: 30, price: 200, currency: 'ZAR', serviceMode: 'BOTH' } as any);
    mockAvailabilityRuleFindMany.mockResolvedValue([{ providerId: 'prov-1', dayOfWeek: dow, startTime: '09:00', endTime: '10:00', isActive: true }]);
    mockAvailabilityExceptionFindMany.mockResolvedValue([]);
    mockBookingFindMany.mockResolvedValue([
      { scheduledStart: new Date(slotIso(date, '09:00')), scheduledEnd: new Date(slotIso(date, '09:30')), status: 'PENDING' },
    ]);
    const res = await request(app).get('/api/v1/bookings/availability').set('Authorization', `Bearer ${tok}`).query({ providerId: 'prov-1', serviceId: 'svc-1', date });
    expect(res.status).toBe(200);
    // 09:00-09:30 blocked, only 09:30-10:00 remains
    expect(res.body.data.slots).toHaveLength(1);
    expect(res.body.data.slots[0].displayStart).toBe('09:30');
  });

  it('5. service duration respected — 45min slots', async () => {
    const date = futureDateStr(2);
    const dow = dayOfWeekFor(date);
    const tok = token({ sub: 'user-cust1' });
    mockUserFindUnique.mockResolvedValue({ id: 'user-cust1', status: 'ACTIVE' } as any);
    mockProviderProfileFindUnique.mockResolvedValue({ id: 'prov-1', status: 'ACTIVE', userId: 'user-prov1' } as any);
    mockServiceFindUnique.mockResolvedValue({ id: 'svc-1', status: 'ACTIVE', providerId: 'prov-1', durationMinutes: 45, price: 300, currency: 'ZAR', serviceMode: 'BOTH' } as any);
    mockAvailabilityRuleFindMany.mockResolvedValue([{ providerId: 'prov-1', dayOfWeek: dow, startTime: '09:00', endTime: '10:30', isActive: true }]);
    mockAvailabilityExceptionFindMany.mockResolvedValue([]);
    mockBookingFindMany.mockResolvedValue([]);
    const res = await request(app).get('/api/v1/bookings/availability').set('Authorization', `Bearer ${tok}`).query({ providerId: 'prov-1', serviceId: 'svc-1', date });
    expect(res.status).toBe(200);
    // 09:00-10:30 with 45min = 2 slots (09:00-09:45, 09:45-10:30)
    expect(res.body.data.slots).toHaveLength(2);
    expect(res.body.data.slots[1].displayEnd).toBe('10:30');
  });

  it('6. inactive provider rejected', async () => {
    const date = futureDateStr(2);
    const tok = token({ sub: 'user-cust1' });
    mockUserFindUnique.mockResolvedValue({ id: 'user-cust1', status: 'ACTIVE' } as any);
    mockProviderProfileFindUnique.mockResolvedValue({ id: 'prov-1', status: 'PAUSED', userId: 'user-prov1' } as any);
    const res = await request(app).get('/api/v1/bookings/availability').set('Authorization', `Bearer ${tok}`).query({ providerId: 'prov-1', serviceId: 'svc-1', date });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('PROVIDER_NOT_FOUND');
  });

  it('7. inactive service rejected', async () => {
    const date = futureDateStr(2);
    const tok = token({ sub: 'user-cust1' });
    mockUserFindUnique.mockResolvedValue({ id: 'user-cust1', status: 'ACTIVE' } as any);
    mockProviderProfileFindUnique.mockResolvedValue({ id: 'prov-1', status: 'ACTIVE', userId: 'user-prov1' } as any);
    mockServiceFindUnique.mockResolvedValue({ id: 'svc-1', status: 'PAUSED', providerId: 'prov-1', durationMinutes: 30 } as any);
    const res = await request(app).get('/api/v1/bookings/availability').set('Authorization', `Bearer ${tok}`).query({ providerId: 'prov-1', serviceId: 'svc-1', date });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('SERVICE_NOT_FOUND');
  });
});

describe('POST /api/v1/bookings', () => {
  const basePayload = (date: string, tz: string = DEFAULT_TIMEZONE) => ({
    providerId: 'prov-1',
    serviceId: 'svc-1',
    scheduledStart: slotIso(date, '09:00', tz),
    customerLocation: { latitude: -26.2, longitude: 28.0, city: 'Johannesburg', province: 'Gauteng', addressLine1: '1 Test Rd', postalCode: '2196', country: 'ZA' },
  });

  it('8. unauthorized booking rejected — no token', async () => {
    const date = futureDateStr(2);
    const res = await request(app).post('/api/v1/bookings').send(basePayload(date));
    expect(res.status).toBe(401);
  });

  it('9. provider/service mismatch rejected', async () => {
    const date = futureDateStr(2);
    const dow = dayOfWeekFor(date);
    const tok = token({ sub: 'user-cust1' });
    mockUserFindUnique.mockResolvedValue({ id: 'user-cust1', status: 'ACTIVE' } as any);
    mockCustomerProfileFindUnique.mockResolvedValue({ id: 'cust-1', userId: 'user-cust1' } as any);
    mockProviderProfileFindUnique.mockResolvedValue({ id: 'prov-1', status: 'ACTIVE', userId: 'user-prov1' } as any);
    // service belongs to other provider
    mockServiceFindUnique.mockResolvedValue({ id: 'svc-1', status: 'ACTIVE', providerId: 'prov-other', businessUnitId: null, durationMinutes: 30, price: 200, currency: 'ZAR', serviceMode: 'BOTH', name: 'Fade', description: 'Desc' } as any);
    const res = await request(app).post('/api/v1/bookings').set('Authorization', `Bearer ${tok}`).send(basePayload(date));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('PROVIDER_SERVICE_MISMATCH');
  });

  it('10. historical price snapshot preserved', async () => {
    const date = futureDateStr(2);
    const dow = dayOfWeekFor(date);
    const tok = token({ sub: 'user-cust1' });
    mockUserFindUnique.mockResolvedValue({ id: 'user-cust1', status: 'ACTIVE' } as any);
    mockCustomerProfileFindUnique.mockResolvedValue({ id: 'cust-1', userId: 'user-cust1' } as any);
    mockProviderProfileFindUnique.mockResolvedValue({ id: 'prov-1', status: 'ACTIVE', userId: 'user-prov1', tier: { code: 'T1' } } as any);
    mockServiceFindUnique.mockResolvedValue({ id: 'svc-1', status: 'ACTIVE', providerId: 'prov-1', businessUnitId: null, durationMinutes: 30, price: 250, currency: 'ZAR', serviceMode: 'BOTH', name: 'Fade', description: 'Desc' } as any);
    mockProviderLocationFindFirst.mockResolvedValue({ id: 'loc-1', providerId: 'prov-1', addressLine1: '10 Main Rd', city: 'Johannesburg', province: 'Gauteng', postalCode: '2196', country: 'ZA', latitude: -26.2, longitude: 28.0, isActive: true, isPrimary: true });
    mockAvailabilityRuleFindMany.mockResolvedValue([{ providerId: 'prov-1', dayOfWeek: dow, startTime: '09:00', endTime: '11:00', isActive: true }]);
    mockAvailabilityExceptionFindMany.mockResolvedValue([]);
    mockBookingFindMany.mockResolvedValue([]);
    mockBookingFindFirst.mockResolvedValue(null);

    const res = await request(app).post('/api/v1/bookings').set('Authorization', `Bearer ${tok}`).send(basePayload(date));
    expect(res.status).toBe(201);
    expect(res.body.data.items[0].unitPrice).toBe(250);
    // Ensure BookingItem snapshot captured price, not client-supplied
    expect(mockBookingItemCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ unitPrice: 250, lineTotal: 250 }) }));
  });

  it('11. historical duration snapshot', async () => {
    const date = futureDateStr(2);
    const dow = dayOfWeekFor(date);
    const tok = token({ sub: 'user-cust1' });
    mockUserFindUnique.mockResolvedValue({ id: 'user-cust1', status: 'ACTIVE' } as any);
    mockCustomerProfileFindUnique.mockResolvedValue({ id: 'cust-1', userId: 'user-cust1' } as any);
    mockProviderProfileFindUnique.mockResolvedValue({ id: 'prov-1', status: 'ACTIVE', userId: 'user-prov1', tier: { code: 'T1' } } as any);
    mockServiceFindUnique.mockResolvedValue({ id: 'svc-1', status: 'ACTIVE', providerId: 'prov-1', businessUnitId: null, durationMinutes: 45, price: 200, currency: 'ZAR', serviceMode: 'BOTH', name: 'Fade', description: 'Desc' } as any);
    mockProviderLocationFindFirst.mockResolvedValue(null);
    mockAvailabilityRuleFindMany.mockResolvedValue([{ providerId: 'prov-1', dayOfWeek: dow, startTime: '09:00', endTime: '11:00', isActive: true }]);
    mockAvailabilityExceptionFindMany.mockResolvedValue([]);
    mockBookingFindMany.mockResolvedValue([]);
    mockBookingFindFirst.mockResolvedValue(null);

    const payload = { ...basePayload(date), scheduledStart: slotIso(date, '09:00') };
    const res = await request(app).post('/api/v1/bookings').set('Authorization', `Bearer ${tok}`).send(payload);
    expect(res.status).toBe(201);
    expect(mockBookingItemCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ durationMinutes: 45 }) }));
    // scheduledEnd should reflect duration
    const createdBooking = mockBookingCreate.mock.calls[mockBookingCreate.mock.calls.length - 1][0].data;
    const durationMs = new Date(createdBooking.scheduledEnd).getTime() - new Date(createdBooking.scheduledStart).getTime();
    expect(durationMs).toBe(45 * 60 * 1000);
  });

  it('12. booking location snapshot', async () => {
    const date = futureDateStr(2);
    const dow = dayOfWeekFor(date);
    const tok = token({ sub: 'user-cust1' });
    mockUserFindUnique.mockResolvedValue({ id: 'user-cust1', status: 'ACTIVE' } as any);
    mockCustomerProfileFindUnique.mockResolvedValue({ id: 'cust-1', userId: 'user-cust1' } as any);
    mockProviderProfileFindUnique.mockResolvedValue({ id: 'prov-1', status: 'ACTIVE', userId: 'user-prov1', tier: { code: 'T1' } } as any);
    mockServiceFindUnique.mockResolvedValue({ id: 'svc-1', status: 'ACTIVE', providerId: 'prov-1', businessUnitId: null, durationMinutes: 30, price: 200, currency: 'ZAR', serviceMode: 'CUSTOMER_LOCATION', name: 'Home Cut', description: 'Desc' } as any);
    mockAvailabilityRuleFindMany.mockResolvedValue([{ providerId: 'prov-1', dayOfWeek: dow, startTime: '09:00', endTime: '11:00', isActive: true }]);
    mockAvailabilityExceptionFindMany.mockResolvedValue([]);
    mockBookingFindMany.mockResolvedValue([]);
    mockBookingFindFirst.mockResolvedValue(null);

    const payload = {
      providerId: 'prov-1',
      serviceId: 'svc-1',
      scheduledStart: slotIso(date, '09:00'),
      customerLocation: { latitude: -26.2, longitude: 28.0, addressLine1: '123 Customer St', city: 'Sandton', province: 'Gauteng', postalCode: '2196', country: 'ZA' },
    };
    const res = await request(app).post('/api/v1/bookings').set('Authorization', `Bearer ${tok}`).send(payload);
    expect(res.status).toBe(201);
    expect(mockBookingLocationCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ addressLine1: '123 Customer St', city: 'Sandton', latitude: -26.2 }) }));
    expect(res.body.data.location.addressLine1).toBeDefined();
  });

  it('13. booking does not become COMPLETED automatically', async () => {
    const date = futureDateStr(2);
    const dow = dayOfWeekFor(date);
    const tok = token({ sub: 'user-cust1' });
    mockUserFindUnique.mockResolvedValue({ id: 'user-cust1', status: 'ACTIVE' } as any);
    mockCustomerProfileFindUnique.mockResolvedValue({ id: 'cust-1', userId: 'user-cust1' } as any);
    mockProviderProfileFindUnique.mockResolvedValue({ id: 'prov-1', status: 'ACTIVE', userId: 'user-prov1', tier: { code: 'T1' } } as any);
    mockServiceFindUnique.mockResolvedValue({ id: 'svc-1', status: 'ACTIVE', providerId: 'prov-1', durationMinutes: 30, price: 200, currency: 'ZAR', serviceMode: 'BOTH', name: 'Fade', description: 'Desc' } as any);
    mockProviderLocationFindFirst.mockResolvedValue(null);
    mockAvailabilityRuleFindMany.mockResolvedValue([{ providerId: 'prov-1', dayOfWeek: dow, startTime: '09:00', endTime: '11:00', isActive: true }]);
    mockAvailabilityExceptionFindMany.mockResolvedValue([]);
    mockBookingFindMany.mockResolvedValue([]);
    mockBookingFindFirst.mockResolvedValue(null);
    const res = await request(app).post('/api/v1/bookings').set('Authorization', `Bearer ${tok}`).send(basePayload(date));
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('PENDING');
    expect(res.body.data.status).not.toBe('COMPLETED');
  });

  it('14. duplicate/conflicting booking protection — second same slot 409', async () => {
    const date = futureDateStr(2);
    const dow = dayOfWeekFor(date);
    const tok = token({ sub: 'user-cust1' });
    mockUserFindUnique.mockResolvedValue({ id: 'user-cust1', status: 'ACTIVE' } as any);
    mockCustomerProfileFindUnique.mockResolvedValue({ id: 'cust-1', userId: 'user-cust1' } as any);
    mockProviderProfileFindUnique.mockResolvedValue({ id: 'prov-1', status: 'ACTIVE', userId: 'user-prov1', tier: { code: 'T1' } } as any);
    mockServiceFindUnique.mockResolvedValue({ id: 'svc-1', status: 'ACTIVE', providerId: 'prov-1', durationMinutes: 30, price: 200, currency: 'ZAR', serviceMode: 'BOTH', name: 'Fade', description: 'Desc' } as any);
    mockProviderLocationFindFirst.mockResolvedValue(null);
    mockAvailabilityRuleFindMany.mockResolvedValue([{ providerId: 'prov-1', dayOfWeek: dow, startTime: '09:00', endTime: '11:00', isActive: true }]);
    mockAvailabilityExceptionFindMany.mockResolvedValue([]);
    mockBookingFindMany.mockResolvedValue([]);
    // First booking needs 2 checks (pre + inside tx) both null; second booking pre-check returns existing
    mockBookingFindFirst.mockResolvedValueOnce(null).mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'existing', status: 'PENDING' } as any);

    const payload = basePayload(date);
    const res1 = await request(app).post('/api/v1/bookings').set('Authorization', `Bearer ${tok}`).send(payload);
    expect(res1.status).toBe(201);
    const res2 = await request(app).post('/api/v1/bookings').set('Authorization', `Bearer ${tok}`).send(payload);
    expect(res2.status).toBe(409);
    expect(res2.body.error.code).toMatch(/BOOKING_CONFLICT|SLOT_UNAVAILABLE/);
  });

  it('15. tenant isolation — customer cannot view other customer booking', async () => {
    const tok = token({ sub: 'user-cust1' });
    mockUserFindUnique.mockResolvedValue({ id: 'user-cust1', status: 'ACTIVE' } as any);
    mockCustomerProfileFindUnique.mockResolvedValue({ id: 'cust-1', userId: 'user-cust1' } as any);
    mockProviderProfileFindUnique.mockResolvedValue(null);
    mockBookingFindUnique.mockResolvedValue({ id: 'booking-other', customerId: 'cust-other', providerId: 'prov-1', status: 'PENDING', items: [], location: null } as any);

    const res = await request(app).get('/api/v1/bookings/booking-other').set('Authorization', `Bearer ${tok}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('16. customer booking creation success — end-to-end (isolates price/duration tenant)', async () => {
    const date = futureDateStr(2);
    const dow = dayOfWeekFor(date);
    const tok = token({ sub: 'user-cust1' });
    mockUserFindUnique.mockResolvedValue({ id: 'user-cust1', status: 'ACTIVE' } as any);
    mockCustomerProfileFindUnique.mockResolvedValue({ id: 'cust-1', userId: 'user-cust1' } as any);
    mockProviderProfileFindUnique.mockResolvedValue({ id: 'prov-1', status: 'ACTIVE', userId: 'user-prov1', tier: { code: 'T1' } } as any);
    mockServiceFindUnique.mockResolvedValue({
      id: 'svc-1',
      status: 'ACTIVE',
      providerId: 'prov-1',
      businessUnitId: null,
      durationMinutes: 30,
      price: 180,
      currency: 'ZAR',
      serviceMode: 'BOTH',
      name: 'Beard Trim',
      description: 'Quick trim',
    } as any);
    mockProviderLocationFindFirst.mockResolvedValue({ id: 'loc-1', providerId: 'prov-1', addressLine1: '10 Provider Ave', city: 'Johannesburg', province: 'Gauteng', postalCode: '2000', country: 'ZA', latitude: -26.1, longitude: 28.0, isActive: true, isPrimary: true });
    mockAvailabilityRuleFindMany.mockResolvedValue([{ providerId: 'prov-1', dayOfWeek: dow, startTime: '08:00', endTime: '12:00', isActive: true }]);
    mockAvailabilityExceptionFindMany.mockResolvedValue([]);
    mockBookingFindMany.mockResolvedValue([]);
    mockBookingFindFirst.mockResolvedValue(null);

    // Attempt to send client price override — backend must ignore
    const payload = {
      providerId: 'prov-1',
      serviceId: 'svc-1',
      scheduledStart: slotIso(date, '08:30'),
      customerLocation: { latitude: -26.2, longitude: 28.0, addressLine1: 'Customer Addr', city: 'Sandton', province: 'Gauteng', postalCode: '2196', country: 'ZA' },
      // malicious extra fields (should be ignored by validation/backend)
      price: 1,
      durationMinutes: 5,
    };
    const res = await request(app).post('/api/v1/bookings').set('Authorization', `Bearer ${tok}`).send(payload);
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('PENDING');
    // Snapshot must be authoritative 180, 30 — not 1, 5
    expect(mockBookingItemCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ unitPrice: 180, durationMinutes: 30 }) }));
    // Also fetch own booking after creation
    mockCustomerProfileFindUnique.mockResolvedValue({ id: 'cust-1', userId: 'user-cust1' } as any);
    mockProviderProfileFindUnique.mockResolvedValue(null as any);
    // mockBookingFindUnique already returns booking-1 for this flow
    const getRes = await request(app).get('/api/v1/bookings/booking-1').set('Authorization', `Bearer ${tok}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.data.id).toBe('booking-1');
  });
});

describe('GET /api/v1/bookings/:id — auth isolation', () => {
  it('401 without token', async () => {
    const res = await request(app).get('/api/v1/bookings/booking-1');
    expect(res.status).toBe(401);
  });
});

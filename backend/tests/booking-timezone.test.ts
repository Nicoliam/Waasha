/**
 * Slice 3 Timezone Hardening — proves provider-local calendar handling
 * 7 required cases + extra DST boundary checks
 */
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { localToUtcIso, getDayOfWeekForProviderDate, DEFAULT_TIMEZONE } from '../src/utils/timezone';

function token(payload: { sub: string; roles?: string[] }) {
  const secret = process.env.JWT_SECRET ?? 'dev-jwt-secret-change-me';
  return jwt.sign({ uuid: payload.sub, email: `${payload.sub}@test.local`, ...payload }, secret, {
    expiresIn: '1h',
    issuer: 'waasha',
    audience: 'waasha-app',
  } as any);
}

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
    adminSetting: { findMany: jest.fn().mockResolvedValue([]) },
    $queryRaw: mockQueryRaw,
    $transaction: (...args: any[]) => (mockTransaction as any)(...args),
  },
}));

import { app } from '../src/app';

function dow(dateStr: string, tz: string): number {
  return getDayOfWeekForProviderDate(dateStr, tz);
}

/**
 * Provider-local calendar date guaranteed in the future (avoids time-of-day
 * rot: hardcoded "today" morning slots expire mid-run and 422 correctly).
 * Intent of the slot tests is preserved — only the date floats.
 */
function futureLocalDate(tz: string): string {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
  return fmt.format(new Date(Date.now() + 48 * 3600 * 1000));
}

beforeEach(() => {
  jest.clearAllMocks();
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
    if (where?.id) return { id: where.id, status: 'ACTIVE' } as any;
    return null;
  });
  mockTransaction.mockImplementation(async (cb: any) => {
    const tx: any = {
      booking: { findFirst: mockBookingFindFirst, create: mockBookingCreate },
      bookingItem: { create: mockBookingItemCreate },
      bookingLocation: { create: mockBookingLocationCreate },
      auditLog: { create: mockAuditCreate },
      $queryRaw: mockQueryRaw,
    };
    if (typeof cb === 'function') return cb(tx);
    return cb;
  });
  mockBookingCreate.mockImplementation(async ({ data }: any) => ({
    id: 'booking-tz-1',
    uuid: 'uuid-tz-1',
    customerId: data.customerId,
    providerId: data.providerId,
    serviceId: data.serviceId,
    scheduledStart: data.scheduledStart,
    scheduledEnd: data.scheduledEnd,
    timezone: data.timezone,
    status: data.status,
  }));
  mockBookingItemCreate.mockImplementation(async ({ data }: any) => ({ id: 'item-tz-1', ...data }));
  mockBookingLocationCreate.mockImplementation(async ({ data }: any) => ({ id: 'bloc-tz-1', ...data }));
  mockBookingFindUnique.mockImplementation(async ({ where }: any) => {
    if (where.id === 'booking-tz-1') {
      return {
        id: 'booking-tz-1',
        customerId: 'cust-tz-1',
        providerId: 'prov-tz-1',
        serviceId: 'svc-tz-1',
        scheduledStart: new Date('2026-09-07T07:00:00.000Z'),
        scheduledEnd: new Date('2026-09-07T07:30:00.000Z'),
        timezone: 'Africa/Johannesburg',
        status: 'PENDING',
        items: [{ id: 'item-tz-1', serviceNameSnapshot: 'Cut', unitPrice: 200, durationMinutes: 30 }],
        location: { id: 'bloc-tz-1', bookingId: 'booking-tz-1', locationType: 'PROVIDER', latitude: -26.2, longitude: 28.0 },
      } as any;
    }
    return null;
  });
});

describe('Timezone hardening — availability provider-local calendar', () => {
  it('1. Africa/Johannesburg provider: requested date resolves to correct local day-of-week', async () => {
    const date = '2026-09-07'; // Monday
    const tz = 'Africa/Johannesburg';
    const expectedDow = dow(date, tz); // 1 Monday
    expect(expectedDow).toBe(1);
    const tok = token({ sub: 'user-cust1' });
    mockUserFindUnique.mockResolvedValue({ id: 'user-cust1', status: 'ACTIVE' } as any);
    mockProviderProfileFindUnique.mockResolvedValue({ id: 'prov-tz-1', status: 'ACTIVE', userId: 'user-prov1', timezone: tz } as any);
    mockServiceFindUnique.mockResolvedValue({ id: 'svc-tz-1', status: 'ACTIVE', providerId: 'prov-tz-1', durationMinutes: 30, price: 200, currency: 'ZAR', serviceMode: 'BOTH' } as any);
    mockAvailabilityRuleFindMany.mockResolvedValue([{ providerId: 'prov-tz-1', dayOfWeek: expectedDow, startTime: '09:00', endTime: '10:00', isActive: true }]);
    mockAvailabilityExceptionFindMany.mockResolvedValue([]);
    mockBookingFindMany.mockResolvedValue([]);

    const res = await request(app).get('/api/v1/bookings/availability').set('Authorization', `Bearer ${tok}`).query({ providerId: 'prov-tz-1', serviceId: 'svc-tz-1', date });
    expect(res.status).toBe(200);
    expect(res.body.data.timezone).toBe(tz);
    expect(res.body.data.slots).toHaveLength(2);
    expect(mockAvailabilityRuleFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ dayOfWeek: 1 }) }));
  });

  it('2. Provider with timezone where UTC date differs from local date (Pacific/Auckland UTC+12) — still correct local dow', async () => {
    // 2026-09-05 in Auckland is Saturday (6), but UTC midnight for Auckland local 00:00 is 2026-09-04T12:00Z Friday
    const date = '2026-09-05';
    const tz = 'Pacific/Auckland';
    const expectedDow = dow(date, tz);
    expect(expectedDow).toBe(6); // Saturday
    const tok = token({ sub: 'user-cust1' });
    mockUserFindUnique.mockResolvedValue({ id: 'user-cust1', status: 'ACTIVE' } as any);
    mockProviderProfileFindUnique.mockResolvedValue({ id: 'prov-akl', status: 'ACTIVE', userId: 'user-prov-akl', timezone: tz } as any);
    mockServiceFindUnique.mockResolvedValue({ id: 'svc-tz-1', status: 'ACTIVE', providerId: 'prov-akl', durationMinutes: 30, price: 200, currency: 'ZAR', serviceMode: 'BOTH' } as any);
    // Only rule for Saturday should match
    mockAvailabilityRuleFindMany.mockResolvedValue([{ providerId: 'prov-akl', dayOfWeek: expectedDow, startTime: '09:00', endTime: '10:00', isActive: true }]);
    mockAvailabilityExceptionFindMany.mockResolvedValue([]);
    mockBookingFindMany.mockResolvedValue([]);

    const res = await request(app).get('/api/v1/bookings/availability').set('Authorization', `Bearer ${tok}`).query({ providerId: 'prov-akl', serviceId: 'svc-tz-1', date });
    expect(res.status).toBe(200);
    expect(res.body.data.timezone).toBe(tz);
    expect(res.body.data.slots).toHaveLength(2);
    expect(mockAvailabilityRuleFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ dayOfWeek: 6 }) }));
  });

  it('3. Availability rule evaluated using provider-local date, not UTC date (forward offset proves)', async () => {
    // Provider in Pacific/Kiritimati UTC+14: local 2026-09-05 Saturday => UTC 2026-09-04 Friday
    // If UTC wrongly used, dow would be 5 (Friday). Correct is 6 Saturday, so Friday rule must NOT be used
    const date = '2026-09-05';
    const tz = 'Pacific/Kiritimati';
    const tok = token({ sub: 'user-cust1' });
    mockUserFindUnique.mockResolvedValue({ id: 'user-cust1', status: 'ACTIVE' } as any);
    mockProviderProfileFindUnique.mockResolvedValue({ id: 'prov-kirit', status: 'ACTIVE', userId: 'user-kirit', timezone: tz } as any);
    mockServiceFindUnique.mockResolvedValue({ id: 'svc-tz-1', status: 'ACTIVE', providerId: 'prov-kirit', durationMinutes: 30, price: 200, currency: 'ZAR', serviceMode: 'BOTH' } as any);
    // Mock implementation that returns rule only if dow==6
    mockAvailabilityRuleFindMany.mockImplementation(async ({ where }: any) => {
      if (where.dayOfWeek === 6) return [{ providerId: 'prov-kirit', dayOfWeek: 6, startTime: '09:00', endTime: '09:30', isActive: true }];
      return [];
    });
    mockAvailabilityExceptionFindMany.mockResolvedValue([]);
    mockBookingFindMany.mockResolvedValue([]);

    const res = await request(app).get('/api/v1/bookings/availability').set('Authorization', `Bearer ${tok}`).query({ providerId: 'prov-kirit', serviceId: 'svc-tz-1', date });
    expect(res.status).toBe(200);
    // Should have 1 slot because Saturday rule matched, proving not using UTC Friday
    expect(res.body.data.slots).toHaveLength(1);
    expect(res.body.data.slots[0].displayStart).toBe('09:00');
    // Ensure the service was queried for Saturday
    expect(mockAvailabilityRuleFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ dayOfWeek: 6 }) }));
  });

  it('4. Slot start/end represent correct provider-local time (JHB + New York)', async () => {
    const tok = token({ sub: 'user-cust1' });
    mockUserFindUnique.mockResolvedValue({ id: 'user-cust1', status: 'ACTIVE' } as any);

    // JHB: 09:00 local => 07:00Z (UTC+2)
    const dateJhb = '2026-09-07';
    const tzJhb = 'Africa/Johannesburg';
    mockProviderProfileFindUnique.mockResolvedValue({ id: 'prov-jhb', status: 'ACTIVE', userId: 'user-jhb', timezone: tzJhb } as any);
    mockServiceFindUnique.mockResolvedValue({ id: 'svc-tz-1', status: 'ACTIVE', providerId: 'prov-jhb', durationMinutes: 30, price: 200, currency: 'ZAR', serviceMode: 'BOTH' } as any);
    mockAvailabilityRuleFindMany.mockResolvedValue([{ providerId: 'prov-jhb', dayOfWeek: dow(dateJhb, tzJhb), startTime: '09:00', endTime: '09:30', isActive: true }]);
    mockAvailabilityExceptionFindMany.mockResolvedValue([]);
    mockBookingFindMany.mockResolvedValue([]);
    const resJhb = await request(app).get('/api/v1/bookings/availability').set('Authorization', `Bearer ${tok}`).query({ providerId: 'prov-jhb', serviceId: 'svc-tz-1', date: dateJhb });
    expect(resJhb.body.data.slots[0].start).toBe(localToUtcIso(dateJhb, '09:00', tzJhb));
    expect(resJhb.body.data.slots[0].start).toBe('2026-09-07T07:00:00.000Z');
    expect(resJhb.body.data.slots[0].displayStart).toBe('09:00');

    // New York summer EDT UTC-4: 09:00 local => 13:00Z
    const dateNySummer = '2026-07-01';
    const tzNy = 'America/New_York';
    mockProviderProfileFindUnique.mockResolvedValue({ id: 'prov-ny', status: 'ACTIVE', userId: 'user-ny', timezone: tzNy } as any);
    mockServiceFindUnique.mockResolvedValue({ id: 'svc-tz-1', status: 'ACTIVE', providerId: 'prov-ny', durationMinutes: 30, price: 200, currency: 'ZAR', serviceMode: 'BOTH' } as any);
    mockAvailabilityRuleFindMany.mockResolvedValue([{ providerId: 'prov-ny', dayOfWeek: dow(dateNySummer, tzNy), startTime: '09:00', endTime: '09:30', isActive: true }]);
    mockAvailabilityExceptionFindMany.mockResolvedValue([]);
    mockBookingFindMany.mockResolvedValue([]);
    const resNy = await request(app).get('/api/v1/bookings/availability').set('Authorization', `Bearer ${tok}`).query({ providerId: 'prov-ny', serviceId: 'svc-tz-1', date: dateNySummer });
    expect(resNy.body.data.slots[0].start).toBe(localToUtcIso(dateNySummer, '09:00', tzNy));
    expect(resNy.body.data.slots[0].start).toBe('2026-07-01T13:00:00.000Z');
    // winter EST UTC-5: 09:00 => 14:00Z
    const dateNyWinter = '2026-01-15';
    mockProviderProfileFindUnique.mockResolvedValue({ id: 'prov-ny', status: 'ACTIVE', userId: 'user-ny', timezone: tzNy } as any);
    mockServiceFindUnique.mockResolvedValue({ id: 'svc-tz-1', status: 'ACTIVE', providerId: 'prov-ny', durationMinutes: 30, price: 200, currency: 'ZAR', serviceMode: 'BOTH' } as any);
    mockAvailabilityRuleFindMany.mockResolvedValue([{ providerId: 'prov-ny', dayOfWeek: dow(dateNyWinter, tzNy), startTime: '09:00', endTime: '09:30', isActive: true }]);
    const resNyWinter = await request(app).get('/api/v1/bookings/availability').set('Authorization', `Bearer ${tok}`).query({ providerId: 'prov-ny', serviceId: 'svc-tz-1', date: dateNyWinter });
    expect(resNyWinter.body.data.slots[0].start).toBe(localToUtcIso(dateNyWinter, '09:00', tzNy));
    expect(resNyWinter.body.data.slots[0].start).toBe('2026-01-15T14:00:00.000Z');
  });

  it('5. Existing booking conflict still blocks the correct local slot (provider-local)', async () => {
    const tz = 'Africa/Johannesburg';
    const date = futureLocalDate(tz);
    const tok = token({ sub: 'user-cust1' });
    mockUserFindUnique.mockResolvedValue({ id: 'user-cust1', status: 'ACTIVE' } as any);
    mockProviderProfileFindUnique.mockResolvedValue({ id: 'prov-jhb', status: 'ACTIVE', userId: 'user-jhb', timezone: tz } as any);
    mockServiceFindUnique.mockResolvedValue({ id: 'svc-tz-1', status: 'ACTIVE', providerId: 'prov-jhb', durationMinutes: 30, price: 200, currency: 'ZAR', serviceMode: 'BOTH' } as any);
    mockAvailabilityRuleFindMany.mockResolvedValue([{ providerId: 'prov-jhb', dayOfWeek: dow(date, tz), startTime: '09:00', endTime: '10:00', isActive: true }]);
    mockAvailabilityExceptionFindMany.mockResolvedValue([]);
    // Booking occupies 09:00-09:30 local => 07:00-07:30Z
    const bStart = new Date(localToUtcIso(date, '09:00', tz));
    const bEnd = new Date(localToUtcIso(date, '09:30', tz));
    mockBookingFindMany.mockResolvedValue([{ scheduledStart: bStart, scheduledEnd: bEnd, status: 'PENDING' }]);

    const res = await request(app).get('/api/v1/bookings/availability').set('Authorization', `Bearer ${tok}`).query({ providerId: 'prov-jhb', serviceId: 'svc-tz-1', date });
    expect(res.status).toBe(200);
    expect(res.body.data.slots).toHaveLength(1);
    expect(res.body.data.slots[0].displayStart).toBe('09:30');
    expect(res.body.data.slots[0].start).toBe(localToUtcIso(date, '09:30', tz));
  });

  it('6. Booking created from an available local slot persists correctly', async () => {
    const tz = 'Africa/Johannesburg';
    const date = futureLocalDate(tz);
    const tok = token({ sub: 'user-cust1' });
    mockUserFindUnique.mockResolvedValue({ id: 'user-cust1', status: 'ACTIVE' } as any);
    mockCustomerProfileFindUnique.mockResolvedValue({ id: 'cust-tz-1', userId: 'user-cust1' } as any);
    mockProviderProfileFindUnique.mockResolvedValue({ id: 'prov-jhb', status: 'ACTIVE', userId: 'user-jhb', timezone: tz, tier: { code: 'T1' } } as any);
    mockServiceFindUnique.mockResolvedValue({ id: 'svc-tz-1', status: 'ACTIVE', providerId: 'prov-jhb', businessUnitId: null, durationMinutes: 30, price: 200, currency: 'ZAR', serviceMode: 'BOTH', name: 'Cut', description: 'Desc' } as any);
    mockAvailabilityRuleFindMany.mockResolvedValue([{ providerId: 'prov-jhb', dayOfWeek: dow(date, tz), startTime: '09:00', endTime: '11:00', isActive: true }]);
    mockAvailabilityExceptionFindMany.mockResolvedValue([]);
    mockBookingFindMany.mockResolvedValue([]);
    mockBookingFindFirst.mockResolvedValue(null);

    const scheduledStart = localToUtcIso(date, '09:30', tz); // choose second slot
    const res = await request(app)
      .post('/api/v1/bookings')
      .set('Authorization', `Bearer ${tok}`)
      .send({
        providerId: 'prov-jhb',
        serviceId: 'svc-tz-1',
        scheduledStart,
        customerLocation: { latitude: -26.2, longitude: 28.0, addressLine1: '1 Test', city: 'JHB', province: 'Gauteng', postalCode: '2000', country: 'ZA' },
      });
    expect(res.status).toBe(201);
    expect(mockBookingCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          scheduledStart: new Date(scheduledStart),
          timezone: tz,
        }),
      }),
    );
    // Verify that scheduledStart persisted equals the provider-local slot UTC
    const createdData = mockBookingCreate.mock.calls[0][0].data;
    expect(createdData.scheduledStart.toISOString()).toBe(scheduledStart);
  });

  it('7. DST-sensitive timezone — America/New_York summer vs winter offset difference', async () => {
    const tok = token({ sub: 'user-cust1' });
    mockUserFindUnique.mockResolvedValue({ id: 'user-cust1', status: 'ACTIVE' } as any);
    const tz = 'America/New_York';

    // Summer: 2026-07-01 09:00 EDT => 13:00Z
    const summerDate = '2026-07-01';
    mockProviderProfileFindUnique.mockResolvedValue({ id: 'prov-ny', status: 'ACTIVE', userId: 'user-ny', timezone: tz } as any);
    mockServiceFindUnique.mockResolvedValue({ id: 'svc-tz-1', status: 'ACTIVE', providerId: 'prov-ny', durationMinutes: 30, price: 200, currency: 'ZAR', serviceMode: 'BOTH' } as any);
    mockAvailabilityRuleFindMany.mockResolvedValue([{ providerId: 'prov-ny', dayOfWeek: dow(summerDate, tz), startTime: '09:00', endTime: '10:00', isActive: true }]);
    mockAvailabilityExceptionFindMany.mockResolvedValue([]);
    mockBookingFindMany.mockResolvedValue([]);
    const resSummer = await request(app).get('/api/v1/bookings/availability').set('Authorization', `Bearer ${tok}`).query({ providerId: 'prov-ny', serviceId: 'svc-tz-1', date: summerDate });
    expect(resSummer.body.data.slots[0].start).toBe('2026-07-01T13:00:00.000Z');

    // Winter: 2026-01-15 09:00 EST => 14:00Z (1 hour later in UTC)
    const winterDate = '2026-01-15';
    mockProviderProfileFindUnique.mockResolvedValue({ id: 'prov-ny', status: 'ACTIVE', userId: 'user-ny', timezone: tz } as any);
    mockServiceFindUnique.mockResolvedValue({ id: 'svc-tz-1', status: 'ACTIVE', providerId: 'prov-ny', durationMinutes: 30, price: 200, currency: 'ZAR', serviceMode: 'BOTH' } as any);
    mockAvailabilityRuleFindMany.mockResolvedValue([{ providerId: 'prov-ny', dayOfWeek: dow(winterDate, tz), startTime: '09:00', endTime: '10:00', isActive: true }]);
    const resWinter = await request(app).get('/api/v1/bookings/availability').set('Authorization', `Bearer ${tok}`).query({ providerId: 'prov-ny', serviceId: 'svc-tz-1', date: winterDate });
    expect(resWinter.body.data.slots[0].start).toBe('2026-01-15T14:00:00.000Z');

    // Ensure DST difference is exactly 60 minutes
    const summerMs = new Date(resSummer.body.data.slots[0].start).getTime();
    const winterMsLocalWallSame = new Date(resWinter.body.data.slots[0].start).getTime();
    // Wall time same 09:00 but UTC differs by 1 hour; we check that summer UTC is 1h earlier than winter for same wall
    // Compute offset: winter 14:00Z vs summer 13:00Z
    expect(winterMsLocalWallSame - summerMs).not.toBe(0);
    // Specifically for these dates, winter UTC should be +3600000 relative to summer if normalized to same day offset
    // Verify our helper yields correct offsets
    expect(localToUtcIso(summerDate, '09:00', tz)).toBe('2026-07-01T13:00:00.000Z');
    expect(localToUtcIso(winterDate, '09:00', tz)).toBe('2026-01-15T14:00:00.000Z');
  });

  it('7b. DST transition week — Europe/London (BST vs GMT)', async () => {
    const tz = 'Europe/London';
    // 2026-07-01 BST UTC+1: 09:00 => 08:00Z
    expect(localToUtcIso('2026-07-01', '09:00', tz)).toBe('2026-07-01T08:00:00.000Z');
    // 2026-01-15 GMT UTC+0: 09:00 => 09:00Z
    expect(localToUtcIso('2026-01-15', '09:00', tz)).toBe('2026-01-15T09:00:00.000Z');
  });
});

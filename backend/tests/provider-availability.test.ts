/**
 * Phase 2 Slice 8 — Provider availability & scheduling management.
 *
 * Covers: own-schedule read, auth, cross-provider isolation, rule CRUD,
 * validation (day/time/range/overlap), timezone (incl. DST), exceptions,
 * booking-engine integration, duration handling, no silent booking mutation,
 * conflict warnings, T3 unit isolation, concurrency-safe replace,
 * mass-assignment protection, pagination, and error sanitization.
 */
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { localToUtcIso } from '../src/utils/timezone';

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
const mockProfileFindUnique = jest.fn();
const mockProfileUpdate = jest.fn();
const mockRuleFindMany = jest.fn();
const mockRuleFindUnique = jest.fn();
const mockRuleCreate = jest.fn();
const mockRuleUpdate = jest.fn();
const mockRuleDelete = jest.fn();
const mockRuleDeleteMany = jest.fn();
const mockRuleCount = jest.fn();
const mockRuleUpdateMany = jest.fn();
const mockExcFindMany = jest.fn();
const mockExcFindUnique = jest.fn();
const mockExcCreate = jest.fn();
const mockExcUpdate = jest.fn();
const mockExcDelete = jest.fn();
const mockExcCount = jest.fn();
const mockBusinessUnitFindUnique = jest.fn();
const mockBusinessFindUnique = jest.fn();
const mockBookingFindMany = jest.fn();
const mockBookingDelete = jest.fn();
const mockServiceFindUnique = jest.fn();
const mockAuditCreate = jest.fn();
const mockTransaction = jest.fn();

jest.mock('../src/config/prisma', () => ({
  prisma: {
    user: { findUnique: (...a: any[]) => (mockUserFindUnique as any)(...a) },
    providerProfile: {
      findUnique: (...a: any[]) => (mockProfileFindUnique as any)(...a),
      update: (...a: any[]) => (mockProfileUpdate as any)(...a),
    },
    availabilityRule: {
      findMany: (...a: any[]) => (mockRuleFindMany as any)(...a),
      findUnique: (...a: any[]) => (mockRuleFindUnique as any)(...a),
      create: (...a: any[]) => (mockRuleCreate as any)(...a),
      update: (...a: any[]) => (mockRuleUpdate as any)(...a),
      delete: (...a: any[]) => (mockRuleDelete as any)(...a),
      deleteMany: (...a: any[]) => (mockRuleDeleteMany as any)(...a),
      count: (...a: any[]) => (mockRuleCount as any)(...a),
      updateMany: (...a: any[]) => (mockRuleUpdateMany as any)(...a),
    },
    availabilityException: {
      findMany: (...a: any[]) => (mockExcFindMany as any)(...a),
      findUnique: (...a: any[]) => (mockExcFindUnique as any)(...a),
      create: (...a: any[]) => (mockExcCreate as any)(...a),
      update: (...a: any[]) => (mockExcUpdate as any)(...a),
      delete: (...a: any[]) => (mockExcDelete as any)(...a),
      count: (...a: any[]) => (mockExcCount as any)(...a),
    },
    businessUnit: { findUnique: (...a: any[]) => (mockBusinessUnitFindUnique as any)(...a) },
    business: { findUnique: (...a: any[]) => (mockBusinessFindUnique as any)(...a) },
    booking: {
      findMany: (...a: any[]) => (mockBookingFindMany as any)(...a),
      delete: (...a: any[]) => (mockBookingDelete as any)(...a),
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
  timezone: 'Africa/Johannesburg',
  tier: { code: 'T1' },
  providerType: 'INDIVIDUAL',
};
const PROV2 = {
  id: 'prov-2',
  userId: 'user-prov2',
  status: 'ACTIVE',
  timezone: 'Africa/Johannesburg',
  tier: { code: 'T1' },
  providerType: 'INDIVIDUAL',
};

function mkRule(over: any = {}) {
  return {
    id: 'rule-1',
    providerId: 'prov-1',
    businessUnitId: null,
    dayOfWeek: 1,
    startTime: '08:00',
    endTime: '12:00',
    timezone: 'Africa/Johannesburg',
    isActive: true,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...over,
  };
}

function mkExc(over: any = {}) {
  return {
    id: 'exc-1',
    providerId: 'prov-1',
    businessUnitId: null,
    date: new Date(Date.UTC(2026, 11, 25)),
    startTime: null,
    endTime: null,
    type: 'UNAVAILABLE',
    reason: 'Christmas',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    ...over,
  };
}

const T1 = token('user-prov1');
const T2 = token('user-prov2');

beforeEach(() => {
  jest.clearAllMocks();
  mockUserFindUnique.mockImplementation(async ({ where }: any) => {
    if (where?.id === 'user-prov1' || where?.id === 'user-prov2') return { id: where.id, status: 'ACTIVE' };
    return null;
  });
  mockProfileFindUnique.mockImplementation(async ({ where }: any) => {
    if (where?.userId === 'user-prov1') return PROV1;
    if (where?.userId === 'user-prov2') return PROV2;
    if (where?.id === 'prov-1') return PROV1;
    if (where?.id === 'prov-2') return PROV2;
    return null;
  });
  mockRuleFindMany.mockResolvedValue([]);
  mockExcFindMany.mockResolvedValue([]);
  mockExcCount.mockResolvedValue(0);
  mockRuleCount.mockResolvedValue(0);
  mockBookingFindMany.mockResolvedValue([]);
  mockAuditCreate.mockResolvedValue({});
  mockBusinessUnitFindUnique.mockResolvedValue(null);
  mockBusinessFindUnique.mockResolvedValue(null);
  mockServiceFindUnique.mockResolvedValue(null);
  mockRuleUpdateMany.mockResolvedValue({ count: 0 });
  mockTransaction.mockImplementation(async (cb: any) => {
    const tx = {
      availabilityRule: {
        deleteMany: mockRuleDeleteMany,
        create: mockRuleCreate,
        findMany: mockRuleFindMany,
      },
    };
    return cb(tx);
  });
});

// 1. unauthenticated read rejected
test('unauthenticated availability read is rejected', async () => {
  const res = await request(app).get('/api/v1/providers/me/availability');
  expect(res.status).toBe(401);
  expect(res.body.error.code).toBe('UNAUTHORIZED');
});

// 2. provider can read own availability (timezone + rules + exceptions)
test('provider reads own schedule with timezone', async () => {
  mockRuleFindMany.mockResolvedValue([mkRule()]);
  mockExcFindMany.mockResolvedValue([mkExc()]);
  const res = await request(app).get('/api/v1/providers/me/availability').set('Authorization', `Bearer ${T1}`);
  expect(res.status).toBe(200);
  expect(res.body.data.timezone).toBe('Africa/Johannesburg');
  expect(res.body.data.rules).toHaveLength(1);
  expect(res.body.data.rules[0].dayName).toBe('Monday');
  expect(res.body.data.exceptions).toHaveLength(1);
});

// 3. provider without profile gets 404
test('schedule read without provider profile returns PROVIDER_NOT_FOUND', async () => {
  mockProfileFindUnique.mockResolvedValue(null);
  const res = await request(app).get('/api/v1/providers/me/availability').set('Authorization', `Bearer ${T1}`);
  expect(res.status).toBe(404);
  expect(res.body.error.code).toBe('PROVIDER_NOT_FOUND');
});

// 4. cross-provider rule update fails safely (no leakage, no mutation)
test('provider cannot update another provider rule', async () => {
  mockRuleFindUnique.mockResolvedValue(mkRule({ id: 'rule-x', providerId: 'prov-2' }));
  const res = await request(app)
    .patch('/api/v1/providers/me/availability/rules/rule-x')
    .set('Authorization', `Bearer ${T1}`)
    .send({ startTime: '09:00', endTime: '10:00' });
  expect(res.status).toBe(404);
  expect(res.body.error.code).toBe('AVAILABILITY_NOT_FOUND');
  expect(mockRuleUpdate).not.toHaveBeenCalled();
});

// 5. create weekly rule + DTO shape (no raw model leakage)
test('provider creates a weekly rule', async () => {
  const created = mkRule({ id: 'rule-new', dayOfWeek: 2, startTime: '13:00', endTime: '17:00' });
  mockRuleCreate.mockResolvedValue(created);
  const res = await request(app)
    .post('/api/v1/providers/me/availability/rules')
    .set('Authorization', `Bearer ${T1}`)
    .send({ dayOfWeek: 2, startTime: '13:00', endTime: '17:00' });
  expect(res.status).toBe(201);
  expect(res.body.data.rule.dayOfWeek).toBe(2);
  expect(res.body.data.rule.dayName).toBe('Tuesday');
  expect(res.body.data.timezone).toBe('Africa/Johannesburg');
  expect(mockAuditCreate).toHaveBeenCalled();
});

// 6. invalid day rejected
test('invalid dayOfWeek rejected', async () => {
  const res = await request(app)
    .post('/api/v1/providers/me/availability/rules')
    .set('Authorization', `Bearer ${T1}`)
    .send({ dayOfWeek: 7, startTime: '08:00', endTime: '12:00' });
  expect(res.status).toBe(422);
  expect(res.body.error.code).toBe('AVAILABILITY_INVALID');
  expect(mockRuleCreate).not.toHaveBeenCalled();
});

// 7. invalid time rejected
test('malformed time rejected', async () => {
  const res = await request(app)
    .post('/api/v1/providers/me/availability/rules')
    .set('Authorization', `Bearer ${T1}`)
    .send({ dayOfWeek: 1, startTime: '25:00', endTime: '26:00' });
  expect(res.status).toBe(422);
  expect(mockRuleCreate).not.toHaveBeenCalled();
});

// 8. start >= end rejected
test('endTime before startTime rejected', async () => {
  const res = await request(app)
    .post('/api/v1/providers/me/availability/rules')
    .set('Authorization', `Bearer ${T1}`)
    .send({ dayOfWeek: 1, startTime: '12:00', endTime: '08:00' });
  expect(res.status).toBe(422);
  expect(res.body.error.code).toBe('AVAILABILITY_INVALID');
});

// 9. overlapping windows rejected with 409
test('overlapping window on same day rejected', async () => {
  mockRuleFindMany.mockResolvedValue([mkRule({ startTime: '08:00', endTime: '12:00' })]);
  const res = await request(app)
    .post('/api/v1/providers/me/availability/rules')
    .set('Authorization', `Bearer ${T1}`)
    .send({ dayOfWeek: 1, startTime: '11:00', endTime: '14:00' });
  expect(res.status).toBe(409);
  expect(res.body.error.code).toBe('AVAILABILITY_CONFLICT');
  expect(mockRuleCreate).not.toHaveBeenCalled();
});

// 10. non-overlapping second window allowed (multi-window preserved)
test('second non-overlapping window same day allowed', async () => {
  mockRuleFindMany.mockResolvedValue([mkRule({ startTime: '08:00', endTime: '12:00' })]);
  mockRuleCreate.mockResolvedValue(mkRule({ id: 'rule-2', startTime: '13:00', endTime: '17:00' }));
  const res = await request(app)
    .post('/api/v1/providers/me/availability/rules')
    .set('Authorization', `Bearer ${T1}`)
    .send({ dayOfWeek: 1, startTime: '13:00', endTime: '17:00' });
  expect(res.status).toBe(201);
  expect(res.body.data.rule.startTime).toBe('13:00');
});

// 11. update rule
test('provider updates own rule', async () => {
  mockRuleFindUnique.mockResolvedValue(mkRule());
  mockRuleUpdate.mockResolvedValue(mkRule({ startTime: '09:00', endTime: '12:00' }));
  const res = await request(app)
    .patch('/api/v1/providers/me/availability/rules/rule-1')
    .set('Authorization', `Bearer ${T1}`)
    .send({ startTime: '09:00', endTime: '12:00' });
  expect(res.status).toBe(200);
  expect(res.body.data.rule.startTime).toBe('09:00');
});

// 12. delete rule
test('provider deletes own rule', async () => {
  mockRuleFindUnique.mockResolvedValue(mkRule());
  mockRuleDelete.mockResolvedValue(mkRule());
  const res = await request(app).delete('/api/v1/providers/me/availability/rules/rule-1').set('Authorization', `Bearer ${T1}`);
  expect(res.status).toBe(200);
  expect(res.body.data.removed).toBe('rule-1');
});

// 13. delete missing rule → 404
test('delete missing rule returns AVAILABILITY_NOT_FOUND', async () => {
  mockRuleFindUnique.mockResolvedValue(null);
  const res = await request(app).delete('/api/v1/providers/me/availability/rules/nope').set('Authorization', `Bearer ${T1}`);
  expect(res.status).toBe(404);
  expect(res.body.error.code).toBe('AVAILABILITY_NOT_FOUND');
});

// 14. bulk replace with multiple windows per day
test('bulk replace accepts multiple windows per day', async () => {
  mockRuleCreate.mockImplementation(async ({ data }: any) => ({ id: `r-${data.startTime}`, ...data, createdAt: new Date(), updatedAt: new Date() }));
  mockRuleFindMany.mockResolvedValue([]);
  mockTransaction.mockImplementation(async (cb: any) => {
    const created: any[] = [];
    const tx = {
      availabilityRule: {
        deleteMany: mockRuleDeleteMany,
        create: async ({ data }: any) => {
          const row = { id: `r-${data.startTime}`, ...data, createdAt: new Date(), updatedAt: new Date() };
          created.push(row);
          return row;
        },
        findMany: async () => created,
      },
    };
    return cb(tx);
  });
  const res = await request(app)
    .put('/api/v1/providers/me/availability/rules')
    .set('Authorization', `Bearer ${T1}`)
    .send({ rules: [{ dayOfWeek: 1, startTime: '08:00', endTime: '12:00' }, { dayOfWeek: 1, startTime: '13:00', endTime: '17:00' }] });
  expect(res.status).toBe(200);
  expect(res.body.data.rules).toHaveLength(2);
});

// 15. bulk replace overlapping set rejected
test('bulk replace with overlaps rejected', async () => {
  const res = await request(app)
    .put('/api/v1/providers/me/availability/rules')
    .set('Authorization', `Bearer ${T1}`)
    .send({ rules: [{ dayOfWeek: 1, startTime: '08:00', endTime: '12:00' }, { dayOfWeek: 1, startTime: '11:00', endTime: '14:00' }] });
  expect(res.status).toBe(409);
});

// 16. bulk replace oversized rejected
test('bulk replace beyond sane limit rejected', async () => {
  const rules = Array.from({ length: 29 }, (_, i) => ({ dayOfWeek: i % 7, startTime: '08:00', endTime: '08:30' }));
  const res = await request(app).put('/api/v1/providers/me/availability/rules').set('Authorization', `Bearer ${T1}`).send({ rules });
  expect(res.status).toBe(422);
});

// 17. timezone returned + preserved
test('provider timezone returned on rules list', async () => {
  const res = await request(app).get('/api/v1/providers/me/availability/rules').set('Authorization', `Bearer ${T1}`);
  expect(res.status).toBe(200);
  expect(res.body.data.timezone).toBe('Africa/Johannesburg');
});

// 18. timezone update valid
test('provider updates timezone to valid IANA zone', async () => {
  mockProfileUpdate.mockResolvedValue({ ...PROV1, timezone: 'America/New_York' });
  const res = await request(app)
    .put('/api/v1/providers/me/availability/timezone')
    .set('Authorization', `Bearer ${T1}`)
    .send({ timezone: 'America/New_York' });
  expect(res.status).toBe(200);
  expect(res.body.data.timezone).toBe('America/New_York');
});

// 19. timezone injection rejected
test('invalid timezone rejected', async () => {
  const res = await request(app)
    .put('/api/v1/providers/me/availability/timezone')
    .set('Authorization', `Bearer ${T1}`)
    .send({ timezone: 'Mars/Olympus' });
  expect(res.status).toBe(422);
  expect(res.body.error.code).toBe('AVAILABILITY_INVALID');
  expect(mockProfileUpdate).not.toHaveBeenCalled();
});

// 20. DST-sensitive provider-local conversion (Slice 3 hardening intact)
test('DST-sensitive conversion differs across DST boundary', () => {
  // America/New_York: EST (-05:00) in Jan, EDT (-04:00) in Jul
  const jan = localToUtcIso('2026-01-12', '09:00', 'America/New_York');
  const jul = localToUtcIso('2026-07-13', '09:00', 'America/New_York');
  expect(jan).toBe('2026-01-12T14:00:00.000Z');
  expect(jul).toBe('2026-07-13T13:00:00.000Z');
});

// 21. exception creation (full day)
test('provider creates full-day exception', async () => {
  mockExcCreate.mockResolvedValue(mkExc());
  const res = await request(app)
    .post('/api/v1/providers/me/availability/exceptions')
    .set('Authorization', `Bearer ${T1}`)
    .send({ date: '2026-12-25', kind: 'FULL_DAY', reason: 'Christmas' });
  expect(res.status).toBe(201);
  expect(res.body.data.exception.kind).toBe('FULL_DAY');
  expect(res.body.data.exception.date).toBe('2026-12-25');
});

// 22. partial-day blocked exception
test('provider creates partial blocked exception', async () => {
  mockExcCreate.mockResolvedValue(mkExc({ id: 'exc-2', date: new Date(Date.UTC(2026, 11, 24)), startTime: '14:00', endTime: '17:00' }));
  const res = await request(app)
    .post('/api/v1/providers/me/availability/exceptions')
    .set('Authorization', `Bearer ${T1}`)
    .send({ date: '2026-12-24', kind: 'BLOCKED', startTime: '14:00', endTime: '17:00' });
  expect(res.status).toBe(201);
  expect(res.body.data.exception.kind).toBe('BLOCKED');
});

// 23. custom-hours exception
test('provider creates special-hours exception', async () => {
  mockExcCreate.mockResolvedValue(mkExc({ id: 'exc-3', date: new Date(Date.UTC(2026, 11, 24)), startTime: '08:00', endTime: '12:00', type: 'CUSTOM_HOURS' }));
  const res = await request(app)
    .post('/api/v1/providers/me/availability/exceptions')
    .set('Authorization', `Bearer ${T1}`)
    .send({ date: '2026-12-24', kind: 'CUSTOM_HOURS', startTime: '08:00', endTime: '12:00' });
  expect(res.status).toBe(201);
  expect(res.body.data.exception.type).toBe('CUSTOM_HOURS');
});

// 24. invalid exception date
test('invalid exception date rejected', async () => {
  const res = await request(app)
    .post('/api/v1/providers/me/availability/exceptions')
    .set('Authorization', `Bearer ${T1}`)
    .send({ date: '2026-02-30', kind: 'FULL_DAY' });
  expect(res.status).toBe(422);
  expect(mockExcCreate).not.toHaveBeenCalled();
});

// 25. invalid exception time
test('exception end before start rejected', async () => {
  const res = await request(app)
    .post('/api/v1/providers/me/availability/exceptions')
    .set('Authorization', `Bearer ${T1}`)
    .send({ date: '2026-12-24', kind: 'BLOCKED', startTime: '17:00', endTime: '14:00' });
  expect(res.status).toBe(422);
  expect(mockExcCreate).not.toHaveBeenCalled();
});

// 26. duplicate full-day on same date conflicts
test('second exception on full-day date conflicts', async () => {
  mockExcFindMany.mockResolvedValue([mkExc()]);
  const res = await request(app)
    .post('/api/v1/providers/me/availability/exceptions')
    .set('Authorization', `Bearer ${T1}`)
    .send({ date: '2026-12-25', kind: 'BLOCKED', startTime: '14:00', endTime: '17:00' });
  expect(res.status).toBe(409);
  expect(res.body.error.code).toBe('AVAILABILITY_CONFLICT');
});

// 27. exception update + delete
test('provider updates and deletes own exception', async () => {
  mockExcFindUnique.mockResolvedValue(mkExc());
  mockExcUpdate.mockResolvedValue(mkExc({ reason: 'Updated' }));
  const upd = await request(app)
    .patch('/api/v1/providers/me/availability/exceptions/exc-1')
    .set('Authorization', `Bearer ${T1}`)
    .send({ reason: 'Updated' });
  expect(upd.status).toBe(200);
  expect(upd.body.data.exception.reason).toBe('Updated');

  mockExcDelete.mockResolvedValue(mkExc());
  const del = await request(app).delete('/api/v1/providers/me/availability/exceptions/exc-1').set('Authorization', `Bearer ${T1}`);
  expect(del.status).toBe(200);
  expect(del.body.data.removed).toBe('exc-1');
});

// 28. cross-provider exception isolation
test('provider cannot delete another provider exception', async () => {
  mockExcFindUnique.mockResolvedValue(mkExc({ id: 'exc-x', providerId: 'prov-2' }));
  const res = await request(app).delete('/api/v1/providers/me/availability/exceptions/exc-x').set('Authorization', `Bearer ${T1}`);
  expect(res.status).toBe(404);
  expect(mockExcDelete).not.toHaveBeenCalled();
});

// 29. availability feeds slot generation; duration respected (45-min service in 60-min window → one slot)
test('availability change reflected in slot generation with duration respected', async () => {
  // 2026-09-07 is a Monday
  mockServiceFindUnique.mockResolvedValue({ id: 'svc-1', status: 'ACTIVE', providerId: 'prov-1', businessUnitId: null, durationMinutes: 45, price: 200, currency: 'ZAR', name: 'Cut' });
  mockRuleFindMany.mockResolvedValue([mkRule({ dayOfWeek: 1, startTime: '09:00', endTime: '10:00' })]);
  const res = await request(app)
    .get('/api/v1/bookings/availability')
    .set('Authorization', `Bearer ${T1}`)
    .query({ providerId: 'prov-1', serviceId: 'svc-1', date: '2026-09-07' });
  expect(res.status).toBe(200);
  expect(res.body.data.timezone).toBe('Africa/Johannesburg');
  expect(res.body.data.slots).toHaveLength(1);
  expect(res.body.data.slots[0].displayStart).toBe('09:00');
  expect(res.body.data.slots[0].displayEnd).toBe('09:45');
});

// 30. full-day exception empties slots
test('full-day exception removes slots for that date', async () => {
  mockServiceFindUnique.mockResolvedValue({ id: 'svc-1', status: 'ACTIVE', providerId: 'prov-1', businessUnitId: null, durationMinutes: 30, price: 200, currency: 'ZAR', name: 'Cut' });
  mockRuleFindMany.mockResolvedValue([mkRule({ dayOfWeek: 4, startTime: '08:00', endTime: '17:00' })]);
  mockExcFindMany.mockResolvedValue([mkExc({ date: new Date(Date.UTC(2026, 11, 25)) })]);
  const res = await request(app)
    .get('/api/v1/bookings/availability')
    .set('Authorization', `Bearer ${T1}`)
    .query({ providerId: 'prov-1', serviceId: 'svc-1', date: '2026-12-25' });
  expect(res.status).toBe(200);
  expect(res.body.data.slots).toHaveLength(0);
});

// 31. existing bookings never deleted/mutated by availability update — conflict warned
test('narrowing hours warns about overlapping booking without touching it', async () => {
  mockRuleFindUnique.mockResolvedValue(mkRule());
  mockRuleUpdate.mockResolvedValue(mkRule({ startTime: '13:00', endTime: '17:00' }));
  // Existing 09:30 booking (provider-local) now outside 13:00–17:00 window
  mockRuleFindMany.mockResolvedValue([mkRule({ startTime: '13:00', endTime: '17:00' })]);
  mockBookingFindMany.mockResolvedValue([
    { id: 'bk-1', scheduledStart: new Date('2026-09-08T07:30:00Z'), scheduledEnd: new Date('2026-09-08T08:00:00Z'), status: 'ACCEPTED' },
  ]);
  const res = await request(app)
    .patch('/api/v1/providers/me/availability/rules/rule-1')
    .set('Authorization', `Bearer ${T1}`)
    .send({ startTime: '13:00', endTime: '17:00' });
  expect(res.status).toBe(200);
  expect(res.body.data.conflicts).toHaveLength(1);
  expect(res.body.data.conflicts[0].bookingId).toBe('bk-1');
  expect(mockBookingDelete).not.toHaveBeenCalled();
});

// 32. conflicts endpoint surfaces warnings
test('conflicts endpoint returns upcoming violations', async () => {
  mockRuleFindMany.mockResolvedValue([]);
  mockBookingFindMany.mockResolvedValue([
    { id: 'bk-9', scheduledStart: new Date(Date.now() + 86400000), scheduledEnd: new Date(Date.now() + 86400000 + 1800000), status: 'CONFIRMED' },
  ]);
  const res = await request(app).get('/api/v1/providers/me/availability/conflicts').set('Authorization', `Bearer ${T1}`);
  expect(res.status).toBe(200);
  expect(res.body.data.conflicts).toHaveLength(1);
});

// 33. T3 unit isolation — foreign unit forbidden
test('rule mutation on unowned business unit is forbidden', async () => {
  mockBusinessUnitFindUnique.mockResolvedValue({ id: 'unit-x', businessId: 'biz-x' });
  mockBusinessFindUnique.mockResolvedValue({ id: 'biz-x', ownerProviderId: 'user-other' });
  const res = await request(app)
    .post('/api/v1/providers/me/availability/rules')
    .set('Authorization', `Bearer ${T1}`)
    .send({ dayOfWeek: 1, startTime: '08:00', endTime: '12:00', businessUnitId: 'unit-x' });
  expect(res.status).toBe(403);
  expect(res.body.error.code).toBe('FORBIDDEN');
  expect(mockRuleCreate).not.toHaveBeenCalled();
});

// 34. T3 owned unit allowed
test('rule mutation on owned business unit succeeds', async () => {
  mockBusinessUnitFindUnique.mockResolvedValue({ id: 'unit-1', businessId: 'biz-1' });
  mockBusinessFindUnique.mockResolvedValue({ id: 'biz-1', ownerProviderId: 'user-prov1' });
  mockRuleCreate.mockResolvedValue({ id: 'r-u1', providerId: null, businessUnitId: 'unit-1', dayOfWeek: 1, startTime: '08:00', endTime: '12:00', timezone: 'Africa/Johannesburg', isActive: true, createdAt: new Date(), updatedAt: new Date() });
  const res = await request(app)
    .post('/api/v1/providers/me/availability/rules')
    .set('Authorization', `Bearer ${T1}`)
    .send({ dayOfWeek: 1, startTime: '08:00', endTime: '12:00', businessUnitId: 'unit-1' });
  expect(res.status).toBe(201);
});

// 35. mass-assignment protection
test('client cannot inject ownership or identity fields', async () => {
  mockRuleCreate.mockResolvedValue(mkRule({ id: 'rule-safe' }));
  const res = await request(app)
    .post('/api/v1/providers/me/availability/rules')
    .set('Authorization', `Bearer ${T1}`)
    .send({ dayOfWeek: 1, startTime: '08:00', endTime: '12:00', id: 'hacked', providerId: 'prov-2', isActive: true });
  expect(res.status).toBe(201);
  const data = mockRuleCreate.mock.calls[0][0].data;
  expect(data.providerId).toBe('prov-1');
  expect(data.id).toBeUndefined();
});

// 36. pagination + limits
test('exception list paginates and rejects oversized pages', async () => {
  const res = await request(app)
    .get('/api/v1/providers/me/availability/exceptions')
    .set('Authorization', `Bearer ${T1}`)
    .query({ page: '2', perPage: '5' });
  expect(res.status).toBe(200);
  expect(mockExcFindMany.mock.calls[0][0].skip).toBe(5);
  expect(mockExcFindMany.mock.calls[0][0].take).toBe(5);

  const bad = await request(app)
    .get('/api/v1/providers/me/availability/exceptions')
    .set('Authorization', `Bearer ${T1}`)
    .query({ perPage: '999' });
  expect(bad.status).toBe(422);
});

// 37. internal errors sanitized (no SQL leak)
test('database failure returns sanitized INTERNAL_ERROR', async () => {
  mockRuleFindMany.mockRejectedValue(new Error('SELECT `x` FROM `availability_rules` WHERE ... secret'));
  const res = await request(app).get('/api/v1/providers/me/availability/rules').set('Authorization', `Bearer ${T1}`);
  expect(res.status).toBe(500);
  expect(res.body.error.code).toBe('INTERNAL_ERROR');
  expect(JSON.stringify(res.body)).not.toContain('SELECT');
});

// 38. second provider isolated from first provider's data path
test('second provider schedule read uses own scope', async () => {
  mockRuleFindMany.mockResolvedValue([]);
  const res = await request(app).get('/api/v1/providers/me/availability').set('Authorization', `Bearer ${T2}`);
  expect(res.status).toBe(200);
  const where = mockRuleFindMany.mock.calls[0][0].where;
  expect(where.providerId).toBe('prov-2');
});

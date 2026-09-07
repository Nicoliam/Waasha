/**
 * Slice 16 — Admin Platform.
 *
 * Covers DB-verified admin authorization (all roles denied, stale-token
 * escalation denied, admin allowed), user management with PII protection,
 * provider management + verification + Student verification, business
 * oversight (read-only + invitation revocation), booking oversight
 * (read-only, privacy-preserving, no state transitions), finance oversight
 * (read-only, snapshots immutable), allowlisted configuration with
 * validation + audit + optimistic concurrency, append-only audit viewer
 * with redaction, notification/media oversight, dashboard metrics, and
 * IDOR / mass-assignment / injection / secret-leakage security tests.
 *
 * Prisma is mocked at the module boundary; the real requireAdmin →
 * route → service → audit code runs unmodified.
 */
import request from 'supertest';
import jwt from 'jsonwebtoken';

// ---- mocks ----
const mockUserFindUnique = jest.fn();
const mockUserFindMany = jest.fn();
const mockUserCount = jest.fn();
const mockUserUpdate = jest.fn();
const mockUserGroupBy = jest.fn();
const mockUserRoleFindMany = jest.fn();
const mockProviderFindMany = jest.fn();
const mockProviderCount = jest.fn();
const mockProviderFindUnique = jest.fn();
const mockProviderUpdate = jest.fn();
const mockTeamMemberFindMany = jest.fn();
const mockTeamFindMany = jest.fn();
const mockTeamCount = jest.fn();
const mockBusinessFindMany = jest.fn();
const mockBusinessCount = jest.fn();
const mockBusinessFindUnique = jest.fn();
const mockUnitFindUnique = jest.fn();
const mockUnitCount = jest.fn();
const mockStaffFindMany = jest.fn();
const mockTeamInvFindMany = jest.fn();
const mockTeamInvCount = jest.fn();
const mockTeamInvFindUnique = jest.fn();
const mockTeamInvUpdate = jest.fn();
const mockStaffInvFindMany = jest.fn();
const mockStaffInvCount = jest.fn();
const mockStaffInvFindUnique = jest.fn();
const mockStaffInvUpdate = jest.fn();
const mockBookingFindMany = jest.fn();
const mockBookingCount = jest.fn();
const mockBookingFindUnique = jest.fn();
const mockBookingGroupBy = jest.fn();
const mockPaymentAggregate = jest.fn();
const mockPaymentGroupBy = jest.fn();
const mockPaymentFindMany = jest.fn();
const mockPaymentCount = jest.fn();
const mockPaymentFindUnique = jest.fn();
const mockCashAccountAggregate = jest.fn();
const mockLedgerGroupBy = jest.fn();
const mockLedgerFindMany = jest.fn();
const mockServiceCount = jest.fn();
const mockCategoryCount = jest.fn();
const mockMediaCount = jest.fn();
const mockMediaFindMany = jest.fn();
const mockMediaFindUnique = jest.fn();
const mockMediaUpdate = jest.fn();
const mockInventoryCount = jest.fn();
const mockNotifCount = jest.fn();
const mockNotifFindMany = jest.fn();
const mockNotifGroupBy = jest.fn();
const mockNotifFindUnique = jest.fn();
const mockAdminFindMany = jest.fn();
const mockAdminFindUnique = jest.fn();
const mockAdminUpsert = jest.fn();
const mockAuditCreate = jest.fn();
const mockAuditFindMany = jest.fn();
const mockAuditCount = jest.fn();

jest.mock('../src/config/prisma', () => ({
  prisma: {
    user: {
      findUnique: (...a: any[]) => (mockUserFindUnique as any)(...a),
      findMany: (...a: any[]) => (mockUserFindMany as any)(...a),
      count: (...a: any[]) => (mockUserCount as any)(...a),
      update: (...a: any[]) => (mockUserUpdate as any)(...a),
      groupBy: (...a: any[]) => (mockUserGroupBy as any)(...a),
    },
    userRole: { findMany: (...a: any[]) => (mockUserRoleFindMany as any)(...a) },
    providerProfile: {
      findMany: (...a: any[]) => (mockProviderFindMany as any)(...a),
      count: (...a: any[]) => (mockProviderCount as any)(...a),
      findUnique: (...a: any[]) => (mockProviderFindUnique as any)(...a),
      update: (...a: any[]) => (mockProviderUpdate as any)(...a),
    },
    teamMember: { findMany: (...a: any[]) => (mockTeamMemberFindMany as any)(...a) },
    team: {
      findMany: (...a: any[]) => (mockTeamFindMany as any)(...a),
      count: (...a: any[]) => (mockTeamCount as any)(...a),
    },
    business: {
      findMany: (...a: any[]) => (mockBusinessFindMany as any)(...a),
      count: (...a: any[]) => (mockBusinessCount as any)(...a),
      findUnique: (...a: any[]) => (mockBusinessFindUnique as any)(...a),
    },
    businessUnit: {
      findUnique: (...a: any[]) => (mockUnitFindUnique as any)(...a),
      count: (...a: any[]) => (mockUnitCount as any)(...a),
    },
    businessStaff: { findMany: (...a: any[]) => (mockStaffFindMany as any)(...a) },
    teamInvitation: {
      findMany: (...a: any[]) => (mockTeamInvFindMany as any)(...a),
      count: (...a: any[]) => (mockTeamInvCount as any)(...a),
      findUnique: (...a: any[]) => (mockTeamInvFindUnique as any)(...a),
      update: (...a: any[]) => (mockTeamInvUpdate as any)(...a),
    },
    businessStaffInvitation: {
      findMany: (...a: any[]) => (mockStaffInvFindMany as any)(...a),
      count: (...a: any[]) => (mockStaffInvCount as any)(...a),
      findUnique: (...a: any[]) => (mockStaffInvFindUnique as any)(...a),
      update: (...a: any[]) => (mockStaffInvUpdate as any)(...a),
    },
    booking: {
      findMany: (...a: any[]) => (mockBookingFindMany as any)(...a),
      count: (...a: any[]) => (mockBookingCount as any)(...a),
      findUnique: (...a: any[]) => (mockBookingFindUnique as any)(...a),
      groupBy: (...a: any[]) => (mockBookingGroupBy as any)(...a),
    },
    payment: {
      aggregate: (...a: any[]) => (mockPaymentAggregate as any)(...a),
      groupBy: (...a: any[]) => (mockPaymentGroupBy as any)(...a),
      findMany: (...a: any[]) => (mockPaymentFindMany as any)(...a),
      count: (...a: any[]) => (mockPaymentCount as any)(...a),
      findUnique: (...a: any[]) => (mockPaymentFindUnique as any)(...a),
    },
    providerCashAccount: { aggregate: (...a: any[]) => (mockCashAccountAggregate as any)(...a) },
    cashLedgerEntry: {
      groupBy: (...a: any[]) => (mockLedgerGroupBy as any)(...a),
      findMany: (...a: any[]) => (mockLedgerFindMany as any)(...a),
    },
    service: { count: (...a: any[]) => (mockServiceCount as any)(...a) },
    serviceCategory: { count: (...a: any[]) => (mockCategoryCount as any)(...a) },
    mediaAsset: {
      count: (...a: any[]) => (mockMediaCount as any)(...a),
      findMany: (...a: any[]) => (mockMediaFindMany as any)(...a),
      findUnique: (...a: any[]) => (mockMediaFindUnique as any)(...a),
      update: (...a: any[]) => (mockMediaUpdate as any)(...a),
    },
    inventoryItem: { count: (...a: any[]) => (mockInventoryCount as any)(...a) },
    notification: {
      count: (...a: any[]) => (mockNotifCount as any)(...a),
      findMany: (...a: any[]) => (mockNotifFindMany as any)(...a),
      groupBy: (...a: any[]) => (mockNotifGroupBy as any)(...a),
      findUnique: (...a: any[]) => (mockNotifFindUnique as any)(...a),
    },
    adminSetting: {
      findMany: (...a: any[]) => (mockAdminFindMany as any)(...a),
      findUnique: (...a: any[]) => (mockAdminFindUnique as any)(...a),
      upsert: (...a: any[]) => (mockAdminUpsert as any)(...a),
    },
    auditLog: {
      create: (...a: any[]) => (mockAuditCreate as any)(...a),
      findMany: (...a: any[]) => (mockAuditFindMany as any)(...a),
      count: (...a: any[]) => (mockAuditCount as any)(...a),
    },
  },
}));

import { app } from '../src/app';

const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-jwt-secret-change-me';

function token(sub: string, roles: string[] = []) {
  return jwt.sign({ sub, uuid: sub, email: `${sub}@test.local`, roles }, JWT_SECRET, {
    expiresIn: '1h',
    issuer: 'waasha',
    audience: 'waasha-app',
    algorithm: 'HS256',
  } as any);
}

let roleByUser: Record<string, string[]> = {};

const DEFAULT_SETTING_ROWS = [
  { settingKey: 'commission_student_percent', settingValue: '16', valueType: 'NUMBER', isSensitive: false, updatedAt: '2026-01-01T00:00:00.000Z' },
  { settingKey: 'commission_t1_percent', settingValue: '25', valueType: 'NUMBER', isSensitive: false, updatedAt: '2026-01-01T00:00:00.000Z' },
  { settingKey: 'commission_t2_percent', settingValue: '25', valueType: 'NUMBER', isSensitive: false, updatedAt: '2026-01-01T00:00:00.000Z' },
  { settingKey: 'commission_t3_percent', settingValue: '25', valueType: 'NUMBER', isSensitive: false, updatedAt: '2026-01-01T00:00:00.000Z' },
  { settingKey: 'cash_cap_student', settingValue: '500', valueType: 'NUMBER', isSensitive: false, updatedAt: '2026-01-01T00:00:00.000Z' },
  { settingKey: 'cash_cap_t1', settingValue: '1000', valueType: 'NUMBER', isSensitive: false, updatedAt: '2026-01-01T00:00:00.000Z' },
  { settingKey: 'cash_cap_t2', settingValue: '1000', valueType: 'NUMBER', isSensitive: false, updatedAt: '2026-01-01T00:00:00.000Z' },
  { settingKey: 'cash_cap_t3', settingValue: '5000', valueType: 'NUMBER', isSensitive: false, updatedAt: '2026-01-01T00:00:00.000Z' },
  { settingKey: 'default_discovery_radius_km', settingValue: '10', valueType: 'NUMBER', isSensitive: false, updatedAt: '2026-01-01T00:00:00.000Z' },
  { settingKey: 'max_discovery_radius_km', settingValue: '20', valueType: 'NUMBER', isSensitive: false, updatedAt: '2026-01-01T00:00:00.000Z' },
  { settingKey: 'allowed_customer_radii_km', settingValue: '[10,15,20]', valueType: 'JSON', isSensitive: false, updatedAt: '2026-01-01T00:00:00.000Z' },
  { settingKey: 'allowed_provider_coverages_km', settingValue: '[10,15,20]', valueType: 'JSON', isSensitive: false, updatedAt: '2026-01-01T00:00:00.000Z' },
  { settingKey: 'max_provider_coverage_km', settingValue: '20', valueType: 'NUMBER', isSensitive: false, updatedAt: '2026-01-01T00:00:00.000Z' },
];

beforeEach(() => {
  jest.clearAllMocks();
  roleByUser = {
    'user-admin': ['ADMIN'],
    'user-cust': ['CUSTOMER'],
    'user-prov': ['PROVIDER'],
    'user-t2': ['PROVIDER'],
    'user-t3': ['PROVIDER'],
  };
  mockUserFindUnique.mockImplementation(async ({ where }: any) => {
    const id = where?.id ?? where?.uuid;
    if (!id || id === 'user-ghost') return null;
    if (id === 'user-suspended') return { id, status: 'SUSPENDED', uuid: id, email: `${id}@test.local` };
    return { id, status: 'ACTIVE', uuid: id, email: `${id}@test.local` };
  });
  mockUserRoleFindMany.mockImplementation(async ({ where }: any) => {
    const roles = roleByUser[where?.userId] ?? [];
    return roles.map((code) => ({ role: { code } }));
  });
  mockUserFindMany.mockResolvedValue([]);
  mockUserCount.mockResolvedValue(0);
  mockUserUpdate.mockImplementation(async ({ where, data }: any) => ({ id: where.id, ...data }));
  mockUserGroupBy.mockResolvedValue([]);
  mockProviderFindMany.mockResolvedValue([]);
  mockProviderCount.mockResolvedValue(0);
  mockProviderFindUnique.mockResolvedValue(null);
  mockProviderUpdate.mockImplementation(async ({ where, data }: any) => ({ id: where.id, ...data }));
  mockTeamMemberFindMany.mockResolvedValue([]);
  mockTeamFindMany.mockResolvedValue([]);
  mockTeamCount.mockResolvedValue(0);
  mockBusinessFindMany.mockResolvedValue([]);
  mockBusinessCount.mockResolvedValue(0);
  mockBusinessFindUnique.mockResolvedValue(null);
  mockUnitFindUnique.mockResolvedValue(null);
  mockUnitCount.mockResolvedValue(0);
  mockStaffFindMany.mockResolvedValue([]);
  mockTeamInvFindMany.mockResolvedValue([]);
  mockTeamInvCount.mockResolvedValue(0);
  mockTeamInvFindUnique.mockResolvedValue(null);
  mockTeamInvUpdate.mockImplementation(async ({ where, data }: any) => ({ id: where.id, ...data }));
  mockStaffInvFindMany.mockResolvedValue([]);
  mockStaffInvCount.mockResolvedValue(0);
  mockStaffInvFindUnique.mockResolvedValue(null);
  mockStaffInvUpdate.mockImplementation(async ({ where, data }: any) => ({ id: where.id, ...data }));
  mockBookingFindMany.mockResolvedValue([]);
  mockBookingCount.mockResolvedValue(0);
  mockBookingFindUnique.mockResolvedValue(null);
  mockBookingGroupBy.mockResolvedValue([]);
  mockPaymentAggregate.mockResolvedValue({});
  mockPaymentGroupBy.mockResolvedValue([]);
  mockPaymentFindMany.mockResolvedValue([]);
  mockPaymentCount.mockResolvedValue(0);
  mockPaymentFindUnique.mockResolvedValue(null);
  mockCashAccountAggregate.mockResolvedValue({});
  mockLedgerGroupBy.mockResolvedValue([]);
  mockLedgerFindMany.mockResolvedValue([]);
  mockServiceCount.mockResolvedValue(0);
  mockCategoryCount.mockResolvedValue(5);
  mockMediaCount.mockResolvedValue(0);
  mockMediaFindMany.mockResolvedValue([]);
  mockMediaFindUnique.mockResolvedValue(null);
  mockMediaUpdate.mockImplementation(async ({ where, data }: any) => ({ id: where.id, ...data }));
  mockInventoryCount.mockResolvedValue(0);
  mockNotifCount.mockResolvedValue(0);
  mockNotifFindMany.mockResolvedValue([]);
  mockNotifGroupBy.mockResolvedValue([]);
  mockNotifFindUnique.mockResolvedValue(null);
  mockAdminFindMany.mockResolvedValue(DEFAULT_SETTING_ROWS);
  mockAdminFindUnique.mockResolvedValue(null);
  mockAdminUpsert.mockImplementation(async ({ where, update, create }: any) => ({
    settingKey: where.settingKey,
    settingValue: update?.settingValue ?? create?.settingValue,
    isSensitive: false,
    updatedAt: new Date().toISOString(),
  }));
  mockAuditCreate.mockResolvedValue({});
  mockAuditFindMany.mockResolvedValue([]);
  mockAuditCount.mockResolvedValue(0);
});

const adminAuth = () => ({ Authorization: `Bearer ${token('user-admin', ['ADMIN'])}` });
const custAuth = () => ({ Authorization: `Bearer ${token('user-cust', ['CUSTOMER'])}` });
const provAuth = () => ({ Authorization: `Bearer ${token('user-prov', ['PROVIDER'])}` });

// ── 1. Authorization ────────────────────────────────────────────────────

describe('Slice 16 — admin authorization', () => {
  it('1. unauthenticated dashboard → 401', async () => {
    await request(app).get('/api/v1/admin/dashboard').expect(401);
  });

  it('2. unauthenticated users list → 401', async () => {
    await request(app).get('/api/v1/admin/users').expect(401);
  });

  it('3. unauthenticated settings write → 401', async () => {
    await request(app).patch('/api/v1/admin/settings/commission_t1_percent').send({ value: 20 }).expect(401);
  });

  it('4. customer → 403 on dashboard', async () => {
    const res = await request(app).get('/api/v1/admin/dashboard').set(custAuth()).expect(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('5. provider → 403 on providers list', async () => {
    await request(app).get('/api/v1/admin/providers').set(provAuth()).expect(403);
  });

  it('6. T2 provider → 403 on verification write', async () => {
    await request(app)
      .post('/api/v1/admin/providers/prov-1/verification')
      .set({ Authorization: `Bearer ${token('user-t2', ['PROVIDER'])}` })
      .send({ action: 'APPROVE' })
      .expect(403);
    expect(mockProviderUpdate).not.toHaveBeenCalled();
  });

  it('7. T3 provider → 403 on settings write', async () => {
    await request(app)
      .patch('/api/v1/admin/settings/cash_cap_t3')
      .set({ Authorization: `Bearer ${token('user-t3', ['PROVIDER'])}` })
      .send({ value: 4000 })
      .expect(403);
    expect(mockAdminUpsert).not.toHaveBeenCalled();
  });

  it('8. stale-token escalation denied: JWT claims ADMIN but DB role is CUSTOMER → 403', async () => {
    // Token carries a server-signed ADMIN claim issued before revocation;
    // authority comes from the DB, so access is still denied.
    const stale = { Authorization: `Bearer ${token('user-cust', ['ADMIN'])}` };
    const res = await request(app).get('/api/v1/admin/dashboard').set(stale).expect(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('9. unknown user (deleted from DB) → 401 even with valid signature', async () => {
    await request(app)
      .get('/api/v1/admin/dashboard')
      .set({ Authorization: `Bearer ${token('user-ghost', ['ADMIN'])}` })
      .expect(401);
  });

  it('10. suspended admin account → denied by session check', async () => {
    roleByUser['user-suspended'] = ['ADMIN'];
    await request(app)
      .get('/api/v1/admin/dashboard')
      .set({ Authorization: `Bearer ${token('user-suspended', ['ADMIN'])}` })
      .expect(403);
  });

  it('11. admin → allowed across namespaces (dashboard, audit, finance)', async () => {
    await request(app).get('/api/v1/admin/dashboard').set(adminAuth()).expect(200);
    await request(app).get('/api/v1/admin/audit-logs').set(adminAuth()).expect(200);
    await request(app).get('/api/v1/admin/finance/overview').set(adminAuth()).expect(200);
  });

  it('12. admin APIs are not exposed under provider/customer namespaces', async () => {
    await request(app).get('/api/v1/providers/admin/dashboard').set(adminAuth()).expect(404);
    await request(app).get('/api/v1/customers/admin/dashboard').set(adminAuth()).expect(404);
  });
});

// ── 2. Dashboard ────────────────────────────────────────────────────────

describe('Slice 16 — admin dashboard', () => {
  it('13. returns clearly-defined metric groups from real aggregates', async () => {
    mockUserCount.mockResolvedValue(42);
    mockProviderCount.mockResolvedValue(10);
    mockBookingCount.mockResolvedValue(7);
    mockCategoryCount.mockResolvedValue(5);
    const res = await request(app).get('/api/v1/admin/dashboard').set(adminAuth()).expect(200);
    const d = res.body.data;
    expect(d.users.total).toBe(42);
    expect(d.providers.total).toBe(10);
    expect(d.bookings.total).toBe(7);
    expect(d.marketplace.categories).toBe(5);
    expect(d.finance.currency).toBe('ZAR');
    expect(d.finance.paidPaymentsTotal).toBe(0);
    expect(d.finance.outstandingCashLiability).toBe(0);
  });

  it('14. financial numbers come from aggregates, not invented', async () => {
    mockPaymentAggregate.mockResolvedValue({ _sum: { amount: '1500.00', commissionAmount: '375.00' }, _count: 6 });
    mockCashAccountAggregate.mockResolvedValue({ _sum: { outstandingCommission: '250.50' } });
    const res = await request(app).get('/api/v1/admin/dashboard').set(adminAuth()).expect(200);
    expect(res.body.data.finance.paidPaymentsTotal).toBe(1500);
    expect(res.body.data.finance.commissionCollected).toBe(375);
    expect(res.body.data.finance.paidPaymentsCount).toBe(6);
    expect(res.body.data.finance.outstandingCashLiability).toBe(250.5);
  });

  it('15. exposes no PII lists', async () => {
    const res = await request(app).get('/api/v1/admin/dashboard').set(adminAuth()).expect(200);
    const raw = JSON.stringify(res.body.data);
    expect(raw).not.toContain('@test.local');
    expect(raw).not.toContain('passwordHash');
  });
});

// ── 3. Users ────────────────────────────────────────────────────────────

describe('Slice 16 — user management', () => {
  it('16. search users returns sanitized rows with roles + meta', async () => {
    mockUserFindMany.mockResolvedValue([
      { id: 'u-1', email: 'a@test.local', passwordHash: 'HASH', status: 'ACTIVE', roles: [{ role: { code: 'CUSTOMER' } }] },
    ]);
    mockUserCount.mockResolvedValue(1);
    const res = await request(app).get('/api/v1/admin/users').set(adminAuth()).expect(200);
    expect(res.body.data[0].email).toBe('a@test.local');
    expect(res.body.data[0].passwordHash).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain('HASH');
    expect(res.body.data[0].roles).toEqual(['CUSTOMER']);
    expect(res.body.meta).toMatchObject({ page: 1, total: 1 });
  });

  it('17. status filter is passed to the query', async () => {
    await request(app).get('/api/v1/admin/users?status=SUSPENDED').set(adminAuth()).expect(200);
    expect(mockUserFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ status: 'SUSPENDED' }) }));
  });

  it('18. pagination abuse rejected: perPage above 50 → 422', async () => {
    await request(app).get('/api/v1/admin/users?perPage=1000').set(adminAuth()).expect(422);
  });

  it('19. invalid page → 422', async () => {
    await request(app).get('/api/v1/admin/users?page=0').set(adminAuth()).expect(422);
  });

  it('20. user detail includes roles + audit, never secrets', async () => {
    mockUserFindUnique.mockImplementation(async () => ({
      id: 'u-1', email: 'a@test.local', passwordHash: 'HASH', status: 'ACTIVE',
      roles: [{ role: { code: 'PROVIDER' } }], customerProfile: null, providerProfile: { id: 'p-1' },
    }));
    mockAuditFindMany.mockResolvedValue([{ id: 'a-1', action: 'LOGIN', entityType: 'user', entityId: 'u-1', beforeJson: { password: 'x' } }]);
    const res = await request(app).get('/api/v1/admin/users/u-1').set(adminAuth()).expect(200);
    expect(res.body.data.roles).toEqual(['PROVIDER']);
    expect(JSON.stringify(res.body)).not.toContain('HASH');
    expect(res.body.data.recentAudit[0].beforeJson.password).toBe('[REDACTED]');
  });

  it('21. unknown user → 404', async () => {
    mockUserFindUnique.mockResolvedValue(null);
    // restore auth for admin: user lookup for auth uses id user-admin
    mockUserFindUnique.mockImplementation(async ({ where }: any) => {
      if (where?.id === 'user-admin') return { id: 'user-admin', status: 'ACTIVE' };
      return null;
    });
    await request(app).get('/api/v1/admin/users/nope').set(adminAuth()).expect(404);
  });

  it('22. suspend is an explicit audited domain operation', async () => {
    mockUserFindUnique.mockImplementation(async ({ where }: any) => {
      if (where?.id === 'user-admin') return { id: 'user-admin', status: 'ACTIVE' };
      return { id: 'u-9', status: 'ACTIVE' };
    });
    const res = await request(app).patch('/api/v1/admin/users/u-9/status').set(adminAuth()).send({ status: 'SUSPENDED' }).expect(200);
    expect(res.body.data.status).toBe('SUSPENDED');
    expect(mockUserUpdate).toHaveBeenCalledWith({ where: { id: 'u-9' }, data: { status: 'SUSPENDED' } });
    expect(mockAuditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'USER_DEACTIVATED', actorUserId: 'user-admin', entityId: 'u-9' }),
    }));
  });

  it('23. reactivate writes USER_REACTIVATED audit', async () => {
    mockUserFindUnique.mockImplementation(async ({ where }: any) => {
      if (where?.id === 'user-admin') return { id: 'user-admin', status: 'ACTIVE' };
      return { id: 'u-9', status: 'SUSPENDED' };
    });
    await request(app).patch('/api/v1/admin/users/u-9/status').set(adminAuth()).send({ status: 'ACTIVE' }).expect(200);
    expect(mockAuditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'USER_REACTIVATED' }),
    }));
  });

  it('24. DELETED is not an admin-settable status (history preserved) → 422', async () => {
    await request(app).patch('/api/v1/admin/users/u-9/status').set(adminAuth()).send({ status: 'DELETED' }).expect(422);
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });

  it('25. mass assignment blocked: extra roles field rejected by strict schema', async () => {
    const res = await request(app)
      .patch('/api/v1/admin/users/u-9/status')
      .set(adminAuth())
      .send({ status: 'SUSPENDED', roles: ['ADMIN'] })
      .expect(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(mockUserUpdate).not.toHaveBeenCalled();
  });
});

// ── 4. Providers ────────────────────────────────────────────────────────

describe('Slice 16 — provider management', () => {
  it('26. search returns oversight view (tier, verification, student, coverage)', async () => {
    mockProviderFindMany.mockResolvedValue([
      {
        id: 'p-1', displayName: 'A', tier: { code: 'T1' }, providerType: 'INDIVIDUAL',
        status: 'ACTIVE', verificationStatus: 'VERIFIED', isStudent: false,
        studentVerificationStatus: 'UNVERIFIED', coverageRadiusKm: 10, acceptCash: true,
        createdAt: '2026-01-01', user: { id: 'u-1', email: 'a@test.local', status: 'ACTIVE' },
      },
    ]);
    mockProviderCount.mockResolvedValue(1);
    const res = await request(app).get('/api/v1/admin/providers').set(adminAuth()).expect(200);
    expect(res.body.data[0]).toMatchObject({ tier: 'T1', verificationStatus: 'VERIFIED', coverageRadiusKm: 10 });
    expect(res.body.meta.total).toBe(1);
  });

  it('27. no ranking signals emitted or accepted', async () => {
    mockProviderFindMany.mockResolvedValue([{ id: 'p-1', tier: { code: 'T3' }, user: null }]);
    const res = await request(app).get('/api/v1/admin/providers').set(adminAuth()).expect(200);
    const raw = JSON.stringify(res.body);
    expect(raw).not.toMatch(/rank|boost|score|priority/i);
  });

  it('28. tier + student filters narrow the query', async () => {
    await request(app).get('/api/v1/admin/providers?tier=T2&student=verified').set(adminAuth()).expect(200);
    expect(mockProviderFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tier: { code: 'T2' }, studentVerificationStatus: 'VERIFIED' }),
      }),
    );
  });

  it('29. provider detail bundles services, coverage, team/business links, history', async () => {
    mockProviderFindUnique.mockResolvedValue({
      id: 'p-1', displayName: 'A', tier: { code: 'T2' }, providerType: 'TEAM', status: 'ACTIVE',
      verificationStatus: 'PENDING', isStudent: false, studentVerificationStatus: 'UNVERIFIED',
      coverageRadiusKm: 15, acceptCash: true, customRequestsEnabled: false, timezone: 'Africa/Johannesburg',
      createdAt: '2026-01-01', user: { id: 'u-1' }, locations: [], services: [{ id: 's-1' }],
    });
    mockTeamMemberFindMany.mockResolvedValue([{ teamId: 't-1' }]);
    mockStaffFindMany.mockResolvedValue([]);
    mockAuditFindMany.mockResolvedValue([{ id: 'a-1', action: 'STUDENT_VERIFICATION_REQUESTED' }]);
    const res = await request(app).get('/api/v1/admin/providers/p-1').set(adminAuth()).expect(200);
    expect(res.body.data.tier).toBe('T2');
    expect(res.body.data.teams).toEqual([{ teamId: 't-1' }]);
    expect(res.body.data.verificationHistory[0].action).toBe('STUDENT_VERIFICATION_REQUESTED');
  });

  it('30. provider detail 404', async () => {
    await request(app).get('/api/v1/admin/providers/nope').set(adminAuth()).expect(404);
  });

  it('31. provider status change is audited and never touches tier', async () => {
    mockProviderFindUnique.mockResolvedValue({ id: 'p-1', status: 'ACTIVE' });
    const res = await request(app).patch('/api/v1/admin/providers/p-1/status').set(adminAuth()).send({ status: 'SUSPENDED' }).expect(200);
    expect(res.body.data.status).toBe('SUSPENDED');
    const [updateArg] = mockProviderUpdate.mock.calls[0];
    expect(JSON.stringify(updateArg)).not.toContain('tier');
    expect(mockAuditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'PROVIDER_STATUS_CHANGED', entityId: 'p-1' }),
    }));
  });

  it('32. invalid provider status → 422 without write', async () => {
    await request(app).patch('/api/v1/admin/providers/p-1/status').set(adminAuth()).send({ status: 'DELETED' }).expect(422);
    expect(mockProviderUpdate).not.toHaveBeenCalled();
  });
});

// ── 5. Verification ─────────────────────────────────────────────────────

describe('Slice 16 — verification workflows', () => {
  it('33. approve provider verification → VERIFIED + audit', async () => {
    mockProviderFindUnique.mockResolvedValue({ id: 'p-1', verificationStatus: 'PENDING' });
    const res = await request(app).post('/api/v1/admin/providers/p-1/verification').set(adminAuth()).send({ action: 'APPROVE' }).expect(200);
    expect(res.body.data.verificationStatus).toBe('VERIFIED');
    expect(mockAuditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'PROVIDER_VERIFICATION_APPROVE', actorUserId: 'user-admin' }),
    }));
  });

  it('34. reject records notes in audit trail', async () => {
    mockProviderFindUnique.mockResolvedValue({ id: 'p-1', verificationStatus: 'PENDING' });
    const res = await request(app)
      .post('/api/v1/admin/providers/p-1/verification')
      .set(adminAuth())
      .send({ action: 'REJECT', notes: 'ID document illegible' })
      .expect(200);
    expect(res.body.data.verificationStatus).toBe('REJECTED');
    expect(mockAuditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ afterJson: expect.objectContaining({ notes: 'ID document illegible' }) }),
    }));
  });

  it('35. revoke → SUSPENDED', async () => {
    mockProviderFindUnique.mockResolvedValue({ id: 'p-1', verificationStatus: 'VERIFIED' });
    const res = await request(app).post('/api/v1/admin/providers/p-1/verification').set(adminAuth()).send({ action: 'REVOKE' }).expect(200);
    expect(res.body.data.verificationStatus).toBe('SUSPENDED');
  });

  it('36. invalid action → 422 without write', async () => {
    await request(app).post('/api/v1/admin/providers/p-1/verification').set(adminAuth()).send({ action: 'SELF_APPROVE' }).expect(422);
    expect(mockProviderUpdate).not.toHaveBeenCalled();
  });

  it('37. forged actorUserId in body rejected; audit always uses session admin', async () => {
    mockProviderFindUnique.mockResolvedValue({ id: 'p-1', verificationStatus: 'PENDING' });
    await request(app)
      .post('/api/v1/admin/providers/p-1/verification')
      .set(adminAuth())
      .send({ action: 'APPROVE', actorUserId: 'user-prov' })
      .expect(422);
    expect(mockProviderUpdate).not.toHaveBeenCalled();
  });

  it('38. student approve: admin-controlled VERIFIED (never self-assigned)', async () => {
    mockProviderFindUnique.mockResolvedValue({ id: 'p-1', isStudent: false, studentVerificationStatus: 'PENDING' });
    const res = await request(app).post('/api/v1/admin/providers/p-1/student-verification').set(adminAuth()).send({ action: 'APPROVE' }).expect(200);
    expect(res.body.data.isStudent).toBe(true);
    expect(mockProviderUpdate).toHaveBeenCalledWith({
      where: { id: 'p-1' },
      data: { isStudent: true, studentVerificationStatus: 'VERIFIED' },
    });
  });

  it('39. student reject → not a student', async () => {
    mockProviderFindUnique.mockResolvedValue({ id: 'p-1', isStudent: false, studentVerificationStatus: 'PENDING' });
    const res = await request(app).post('/api/v1/admin/providers/p-1/student-verification').set(adminAuth()).send({ action: 'REJECT' }).expect(200);
    expect(res.body.data).toMatchObject({ isStudent: false, studentVerificationStatus: 'REJECTED' });
  });

  it('40. student revoke clears verified status', async () => {
    mockProviderFindUnique.mockResolvedValue({ id: 'p-1', isStudent: true, studentVerificationStatus: 'VERIFIED' });
    const res = await request(app).post('/api/v1/admin/providers/p-1/student-verification').set(adminAuth()).send({ action: 'REVOKE' }).expect(200);
    expect(res.body.data).toMatchObject({ isStudent: false, studentVerificationStatus: 'UNVERIFIED' });
  });

  it('41. provider cannot self-verify via admin endpoint → 403', async () => {
    await request(app).post('/api/v1/admin/providers/p-1/student-verification').set(provAuth()).send({ action: 'APPROVE' }).expect(403);
    expect(mockProviderUpdate).not.toHaveBeenCalled();
  });

  it('42. verification on missing provider → 404', async () => {
    await request(app).post('/api/v1/admin/providers/nope/verification').set(adminAuth()).send({ action: 'APPROVE' }).expect(404);
  });
});

// ── 6. Business oversight + invitations ─────────────────────────────────

describe('Slice 16 — business oversight', () => {
  it('43. list teams (T2 oversight)', async () => {
    mockTeamFindMany.mockResolvedValue([{ id: 't-1', name: 'Team', status: 'ACTIVE' }]);
    mockTeamCount.mockResolvedValue(1);
    const res = await request(app).get('/api/v1/admin/teams').set(adminAuth()).expect(200);
    expect(res.body.data[0].name).toBe('Team');
    expect(res.body.meta.total).toBe(1);
  });

  it('44. list businesses (T3 oversight)', async () => {
    mockBusinessFindMany.mockResolvedValue([{ id: 'b-1', displayName: 'Biz', status: 'ACTIVE' }]);
    const res = await request(app).get('/api/v1/admin/businesses').set(adminAuth()).expect(200);
    expect(res.body.data[0].displayName).toBe('Biz');
  });

  it('45. business detail shows units, staff, ownership lineage', async () => {
    mockBusinessFindUnique.mockResolvedValue({
      id: 'b-1', displayName: 'Biz', status: 'ACTIVE', ownerProviderId: 'p-9',
      units: [{ id: 'u-1', name: 'Unit' }], staff: [{ id: 's-1' }],
    });
    const res = await request(app).get('/api/v1/admin/businesses/b-1').set(adminAuth()).expect(200);
    expect(res.body.data.units).toHaveLength(1);
    expect(res.body.data.ownerProviderId).toBe('p-9');
  });

  it('46. missing business → 404', async () => {
    await request(app).get('/api/v1/admin/businesses/nope').set(adminAuth()).expect(404);
  });

  it('47. business-unit detail + 404', async () => {
    mockUnitFindUnique.mockImplementation(async ({ where }: any) => (where?.id === 'u-1' ? { id: 'u-1', name: 'Unit' } : null));
    await request(app).get('/api/v1/admin/business-units/u-1').set(adminAuth()).expect(200);
    await request(app).get('/api/v1/admin/business-units/nope').set(adminAuth()).expect(404);
  });

  it('48. admin business surface is read-only: no create/update routes', async () => {
    await request(app).post('/api/v1/admin/businesses').set(adminAuth()).send({ displayName: 'X' }).expect(404);
    await request(app).patch('/api/v1/admin/businesses/b-1').set(adminAuth()).send({ displayName: 'Y' }).expect(404);
  });

  it('49. invitation list never exposes token hashes', async () => {
    mockTeamInvFindMany.mockResolvedValue([{ id: 'i-1', status: 'PENDING', tokenHash: 'SECRET-HASH' }]);
    mockTeamInvCount.mockResolvedValue(1);
    const res = await request(app).get('/api/v1/admin/invitations?scope=team').set(adminAuth()).expect(200);
    expect(JSON.stringify(res.body)).not.toContain('SECRET-HASH');
    expect(res.body.data[0].status).toBe('PENDING');
  });

  it('50. revoke pending team invitation → audited', async () => {
    mockTeamInvFindUnique.mockResolvedValue({ id: 'i-1', status: 'PENDING' });
    const res = await request(app).post('/api/v1/admin/invitations/team/i-1/revoke').set(adminAuth()).expect(200);
    expect(res.body.data.status).toBe('REVOKED');
    expect(mockAuditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'TEAM_INVITATION_REVOKED_ADMIN', entityId: 'i-1' }),
    }));
  });

  it('51. revoke accepted invitation → 422 (single-use preserved)', async () => {
    mockTeamInvFindUnique.mockResolvedValue({ id: 'i-2', status: 'ACCEPTED' });
    await request(app).post('/api/v1/admin/invitations/team/i-2/revoke').set(adminAuth()).expect(422);
    expect(mockTeamInvUpdate).not.toHaveBeenCalled();
  });

  it('52. revoke missing invitation → 404; invalid scope → 422', async () => {
    await request(app).post('/api/v1/admin/invitations/team/nope/revoke').set(adminAuth()).expect(404);
    await request(app).post('/api/v1/admin/invitations/other/i-1/revoke').set(adminAuth()).expect(422);
  });
});

// ── 7. Bookings ─────────────────────────────────────────────────────────

describe('Slice 16 — booking oversight', () => {
  it('53. search bookings sanitizes precise location', async () => {
    mockBookingFindMany.mockResolvedValue([
      {
        id: 'bk-1', status: 'CONFIRMED', paymentStatus: 'PAID', totalAmount: '150.00',
        location: { locationType: 'CUSTOMER', addressLine1: '12 Secret St', city: 'Cape Town', province: 'WC', latitude: -33.9, longitude: 18.4 },
        customer: { id: 'c-1', displayName: 'C' }, items: [],
      },
    ]);
    mockBookingCount.mockResolvedValue(1);
    const res = await request(app).get('/api/v1/admin/bookings').set(adminAuth()).expect(200);
    const loc = res.body.data[0].location;
    expect(loc.city).toBe('Cape Town');
    expect(loc.latitude).toBeUndefined();
    expect(loc.longitude).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain('Secret St');
  });

  it('54. unknown booking status filter → 422', async () => {
    await request(app).get('/api/v1/admin/bookings?status=HACKED').set(adminAuth()).expect(422);
  });

  it('55. invalid date filters → 422', async () => {
    await request(app).get('/api/v1/admin/bookings?from=not-a-date').set(adminAuth()).expect(422);
  });

  it('56. filters reach the query (status + provider + payment)', async () => {
    await request(app).get('/api/v1/admin/bookings?status=COMPLETED&providerId=p-1&paymentStatus=PAID').set(adminAuth()).expect(200);
    expect(mockBookingFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ status: 'COMPLETED', providerId: 'p-1', paymentStatus: 'PAID' }) }),
    );
  });

  it('57. booking detail keeps payment separate from completion, area-level location', async () => {
    mockBookingFindUnique.mockResolvedValue({
      id: 'bk-1', status: 'IN_PROGRESS', paymentStatus: 'PAID', totalAmount: '200.00', currency: 'ZAR',
      location: { locationType: 'PROVIDER', city: 'Durban', province: 'KZN', latitude: 1, longitude: 2 },
      customer: { id: 'c-1', displayName: 'C' }, items: [{ id: 'li-1' }],
      payment: { id: 'pay-1', status: 'PAID', metadata: { gateway_secret: 's3cr3t' } },
      review: null,
    });
    const res = await request(app).get('/api/v1/admin/bookings/bk-1').set(adminAuth()).expect(200);
    expect(res.body.data.status).toBe('IN_PROGRESS');
    expect(res.body.data.payment.status).toBe('PAID');
    expect(res.body.data.location.latitude).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain('s3cr3t');
  });

  it('58. booking detail 404', async () => {
    await request(app).get('/api/v1/admin/bookings/nope').set(adminAuth()).expect(404);
  });

  it('59. no admin booking state transitions exist', async () => {
    await request(app).post('/api/v1/admin/bookings/bk-1/accept').set(adminAuth()).expect(404);
    await request(app).patch('/api/v1/admin/bookings/bk-1').set(adminAuth()).send({ status: 'COMPLETED' }).expect(404);
    await request(app).post('/api/v1/admin/bookings/bk-1/complete').set(adminAuth()).expect(404);
  });
});

// ── 8. Finance ──────────────────────────────────────────────────────────

describe('Slice 16 — finance oversight', () => {
  it('60. list payments redacts secret-like metadata', async () => {
    mockPaymentFindMany.mockResolvedValue([
      { id: 'pay-1', status: 'PAID', method: 'waasha_payment', amount: '150.00', metadata: { webhook_secret: 'shh', order: 'A1' } },
    ]);
    mockPaymentCount.mockResolvedValue(1);
    const res = await request(app).get('/api/v1/admin/payments').set(adminAuth()).expect(200);
    expect(res.body.data[0].metadata.webhook_secret).toBe('[REDACTED]');
    expect(res.body.data[0].metadata.order).toBe('A1');
  });

  it('61. unknown payment status → 422', async () => {
    await request(app).get('/api/v1/admin/payments?status=MINTED').set(adminAuth()).expect(422);
  });

  it('62. payment detail shows reconciliation context, no mutation surface', async () => {
    mockPaymentFindUnique.mockResolvedValue({
      id: 'pay-1', status: 'PAID', method: 'cash', amount: '100.00', commissionRate: '25', commissionAmount: '25.00',
      metadata: null, booking: { id: 'bk-1', status: 'COMPLETED', paymentStatus: 'PAID' },
      events: [{ id: 'e-1', eventType: 'CASH_CONFIRMED', payload: { api_token: 't' } }],
    });
    const res = await request(app).get('/api/v1/admin/payments/pay-1').set(adminAuth()).expect(200);
    expect(res.body.data.booking.status).toBe('COMPLETED');
    expect(res.body.data.events[0].payload.api_token).toBe('[REDACTED]');
    await request(app).patch('/api/v1/admin/payments/pay-1').set(adminAuth()).send({ status: 'FAILED' }).expect(404);
    await request(app).post('/api/v1/admin/payments/pay-1/refund').set(adminAuth()).expect(404);
  });

  it('63. finance overview aggregates liability, settlements, ledger types', async () => {
    mockPaymentGroupBy.mockResolvedValue([{ status: 'PAID', _count: { status: 3 }, _sum: { amount: '900.00' } }]);
    mockPaymentAggregate.mockResolvedValue({ _sum: { commissionAmount: '225.00' }, _count: 3 });
    mockCashAccountAggregate.mockResolvedValue({ _sum: { outstandingCommission: '120.00', totalCashGross: '480.00', totalSettled: '360.00' } });
    mockLedgerGroupBy.mockResolvedValue([{ type: 'ACCRUAL', _count: { type: 2 }, _sum: { commissionAmount: '120.00' } }]);
    mockLedgerFindMany.mockResolvedValue([{ id: 'l-1', type: 'SETTLEMENT' }]);
    const res = await request(app).get('/api/v1/admin/finance/overview').set(adminAuth()).expect(200);
    const d = res.body.data;
    expect(d.currency).toBe('ZAR');
    expect(d.commissionCollected).toBe(225);
    expect(d.cashLiability.outstanding).toBe(120);
    expect(d.paymentsByStatus[0]).toMatchObject({ status: 'PAID', count: 3 });
    expect(d.recentSettlements).toHaveLength(1);
  });

  it('64. commission reconfiguration never rewrites historical payments', async () => {
    const res = await request(app).patch('/api/v1/admin/settings/commission_t1_percent').set(adminAuth()).send({ value: 20 }).expect(200);
    expect(res.body.data.value).toBe('20');
    expect(mockPaymentFindUnique).not.toHaveBeenCalled();
  });
});

// ── 9. Configuration ────────────────────────────────────────────────────

describe('Slice 16 — configuration', () => {
  it('65. settings list exposes allowlisted keys with defaults', async () => {
    const res = await request(app).get('/api/v1/admin/settings').set(adminAuth()).expect(200);
    const keys = res.body.data.map((s: any) => s.key);
    expect(keys).toContain('commission_student_percent');
    expect(keys).toContain('cash_cap_t3');
    expect(keys).toContain('max_discovery_radius_km');
    const student = res.body.data.find((s: any) => s.key === 'commission_student_percent');
    expect(student.value).toBe('16');
  });

  it('66. valid commission update → upsert + before/after audit', async () => {
    mockAdminFindUnique.mockResolvedValue({ settingKey: 'commission_t2_percent', settingValue: '25' });
    await request(app).patch('/api/v1/admin/settings/commission_t2_percent').set(adminAuth()).send({ value: 22 }).expect(200);
    expect(mockAdminUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { settingKey: 'commission_t2_percent' },
      update: { settingValue: '22' },
    }));
    expect(mockAuditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: 'ADMIN_SETTING_UPDATED',
        beforeJson: { settingValue: '25' },
        afterJson: { settingValue: '22' },
      }),
    }));
  });

  it('67. commission above 100 → 422', async () => {
    await request(app).patch('/api/v1/admin/settings/commission_t1_percent').set(adminAuth()).send({ value: 101 }).expect(422);
    expect(mockAdminUpsert).not.toHaveBeenCalled();
  });

  it('68. negative / non-numeric commission → 422', async () => {
    await request(app).patch('/api/v1/admin/settings/commission_t1_percent').set(adminAuth()).send({ value: -5 }).expect(422);
    await request(app).patch('/api/v1/admin/settings/commission_t1_percent').set(adminAuth()).send({ value: 'lots' }).expect(422);
    expect(mockAdminUpsert).not.toHaveBeenCalled();
  });

  it('69. unknown setting key → 404 (no arbitrary config)', async () => {
    await request(app).patch('/api/v1/admin/settings/paystack_secret_key').set(adminAuth()).send({ value: 'sk-1' }).expect(404);
    expect(mockAdminUpsert).not.toHaveBeenCalled();
  });

  it('70. architectural constants are immutable', async () => {
    await request(app).patch('/api/v1/admin/settings/max_service_images').set(adminAuth()).send({ value: 5 }).expect(422);
    await request(app).patch('/api/v1/admin/settings/max_custom_request_images').set(adminAuth()).send({ value: 5 }).expect(422);
    expect(mockAdminUpsert).not.toHaveBeenCalled();
  });

  it('71. cash caps validate as integer ZAR amounts', async () => {
    await request(app).patch('/api/v1/admin/settings/cash_cap_t3').set(adminAuth()).send({ value: 6000 }).expect(200);
    await request(app).patch('/api/v1/admin/settings/cash_cap_student').set(adminAuth()).send({ value: -1 }).expect(422);
    await request(app).patch('/api/v1/admin/settings/cash_cap_t1').set(adminAuth()).send({ value: 10.5 }).expect(422);
  });

  it('72. marketplace radii respect the absolute 20 km maximum', async () => {
    await request(app).patch('/api/v1/admin/settings/default_discovery_radius_km').set(adminAuth()).send({ value: 15 }).expect(200);
    await request(app).patch('/api/v1/admin/settings/max_discovery_radius_km').set(adminAuth()).send({ value: 25 }).expect(422);
    await request(app).patch('/api/v1/admin/settings/max_provider_coverage_km').set(adminAuth()).send({ value: 50 }).expect(422);
  });

  it('73. radius lists must stay within the 10/15/20 expansion sequence', async () => {
    await request(app).patch('/api/v1/admin/settings/allowed_customer_radii_km').set(adminAuth()).send({ value: [10, 15, 20] }).expect(200);
    expect(mockAdminUpsert).toHaveBeenCalledWith(expect.objectContaining({ update: { settingValue: '[10,15,20]' } }));
    await request(app).patch('/api/v1/admin/settings/allowed_customer_radii_km').set(adminAuth()).send({ value: [10, 25] }).expect(422);
    await request(app).patch('/api/v1/admin/settings/allowed_provider_coverages_km').set(adminAuth()).send({ value: [] }).expect(422);
  });

  it('74. concurrent modification detected via optimistic version check → 409', async () => {
    mockAdminFindUnique.mockResolvedValue({ settingKey: 'commission_t1_percent', settingValue: '25', updatedAt: '2026-02-01T00:00:00.000Z' });
    const res = await request(app)
      .patch('/api/v1/admin/settings/commission_t1_percent')
      .set(adminAuth())
      .send({ value: 20, expectedUpdatedAt: '2026-01-01T00:00:00.000Z' })
      .expect(409);
    expect(res.body.error.code).toBe('SETTING_CONFLICT');
    expect(mockAdminUpsert).not.toHaveBeenCalled();
  });

  it('75. matching version proceeds', async () => {
    mockAdminFindUnique.mockResolvedValue({ settingKey: 'commission_t1_percent', settingValue: '25', updatedAt: '2026-02-01T00:00:00.000Z' });
    await request(app)
      .patch('/api/v1/admin/settings/commission_t1_percent')
      .set(adminAuth())
      .send({ value: 20, expectedUpdatedAt: '2026-02-01T00:00:00.000Z' })
      .expect(200);
    expect(mockAdminUpsert).toHaveBeenCalled();
  });

  it('76. sensitive values redacted in settings list', async () => {
    mockAdminFindMany.mockResolvedValue([
      { settingKey: 'commission_t1_percent', settingValue: '25', valueType: 'NUMBER', isSensitive: true, updatedAt: '2026-01-01T00:00:00.000Z' },
    ]);
    const res = await request(app).get('/api/v1/admin/settings').set(adminAuth()).expect(200);
    expect(res.body.data.find((s: any) => s.key === 'commission_t1_percent').value).toBe('[REDACTED]');
  });

  it('77. mass assignment: unexpected body fields rejected', async () => {
    await request(app)
      .patch('/api/v1/admin/settings/commission_t1_percent')
      .set(adminAuth())
      .send({ value: 20, isSensitive: false })
      .expect(422);
    expect(mockAdminUpsert).not.toHaveBeenCalled();
  });
});

// ── 10. Audit viewer ────────────────────────────────────────────────────

describe('Slice 16 — audit viewer', () => {
  it('78. filters reach the query; pagination meta returned', async () => {
    mockAuditFindMany.mockResolvedValue([{ id: 'a-1', action: 'USER_DEACTIVATED' }]);
    mockAuditCount.mockResolvedValue(1);
    const res = await request(app)
      .get('/api/v1/admin/audit-logs?action=USER_DEACTIVATED&entityType=user&entityId=u-9&actorUserId=user-admin')
      .set(adminAuth())
      .expect(200);
    expect(mockAuditFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ action: 'USER_DEACTIVATED', entityType: 'user', entityId: 'u-9', actorUserId: 'user-admin' }),
    }));
    expect(res.body.meta.total).toBe(1);
  });

  it('79. filter injection neutralized: malformed entityType never reaches the query', async () => {
    await request(app).get('/api/v1/admin/audit-logs?entityType=user;DROP').set(adminAuth()).expect(200);
    const where = mockAuditFindMany.mock.calls[0][0].where;
    expect(JSON.stringify(where)).not.toContain('DROP');
  });

  it('80. audit history is append-only: no edit/delete routes', async () => {
    await request(app).put('/api/v1/admin/audit-logs/a-1').set(adminAuth()).send({ action: 'X' }).expect(404);
    await request(app).delete('/api/v1/admin/audit-logs/a-1').set(adminAuth()).expect(404);
    await request(app).patch('/api/v1/admin/audit-logs/a-1').set(adminAuth()).send({ action: 'X' }).expect(404);
  });

  it('81. secret-like metadata redacted in output', async () => {
    mockAuditFindMany.mockResolvedValue([
      { id: 'a-1', action: 'LOGIN', afterJson: { refreshToken: 'abc', email: 'a@test.local' } },
    ]);
    const res = await request(app).get('/api/v1/admin/audit-logs').set(adminAuth()).expect(200);
    expect(res.body.data[0].afterJson.refreshToken).toBe('[REDACTED]');
    expect(res.body.data[0].afterJson.email).toBe('a@test.local');
  });

  it('82. invalid date range → 422', async () => {
    await request(app).get('/api/v1/admin/audit-logs?from=tomorrow-never').set(adminAuth()).expect(422);
  });
});

// ── 11. Notifications / media ───────────────────────────────────────────

describe('Slice 16 — notification & media oversight', () => {
  it('83. notification list shows previews, not full private content', async () => {
    const long = 'x'.repeat(300);
    mockNotifFindMany.mockResolvedValue([
      { id: 'n-1', type: 'BOOKING_CREATED', channel: 'IN_APP', audience: 'CUSTOMER', status: 'UNREAD', title: 'T', message: long, entityType: 'booking', entityId: 'b', createdAt: '2026-01-01' },
    ]);
    mockNotifGroupBy.mockResolvedValue([{ type: 'BOOKING_CREATED', _count: { type: 1 } }]);
    const res = await request(app).get('/api/v1/admin/notifications').set(adminAuth()).expect(200);
    expect(res.body.data[0].messagePreview.length).toBeLessThan(long.length);
    expect(res.body.data[0].message).toBeUndefined();
  });

  it('84. invalid notification type filter → 422', async () => {
    await request(app).get('/api/v1/admin/notifications?type=drop;table').set(adminAuth()).expect(422);
  });

  it('85. media list filters by moderation status', async () => {
    mockMediaFindMany.mockResolvedValue([{ id: 'm-1', moderationStatus: 'PENDING', purpose: 'SERVICE' }]);
    const res = await request(app).get('/api/v1/admin/media?moderationStatus=PENDING').set(adminAuth()).expect(200);
    expect(mockMediaFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ moderationStatus: 'PENDING' }) }));
    expect(res.body.data[0].id).toBe('m-1');
  });

  it('86. invalid moderation status → 422', async () => {
    await request(app).get('/api/v1/admin/media?moderationStatus=SHADY').set(adminAuth()).expect(422);
  });

  it('87. moderation approve is audited; asset never deleted', async () => {
    mockMediaFindUnique.mockResolvedValue({ id: 'm-1', moderationStatus: 'PENDING' });
    const res = await request(app).patch('/api/v1/admin/media/m-1/moderation').set(adminAuth()).send({ action: 'APPROVE' }).expect(200);
    expect(res.body.data.moderationStatus).toBe('APPROVED');
    expect(mockAuditCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'MEDIA_MODERATION_APPROVE', entityId: 'm-1' }),
    }));
    await request(app).delete('/api/v1/admin/media/m-1').set(adminAuth()).expect(404);
  });

  it('88. invalid moderation action → 422 without write', async () => {
    await request(app).patch('/api/v1/admin/media/m-1/moderation').set(adminAuth()).send({ action: 'NUKE' }).expect(422);
    expect(mockMediaUpdate).not.toHaveBeenCalled();
  });
});

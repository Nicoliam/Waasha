/**
 * Slice 19 — Security & Data-Integrity Hardening.
 *
 * ITEM 1 — Legacy Student verification authorization:
 *  - canonical rule: session identifies user, DB user_roles → roles decides
 *    admin authority, JWT role claims NEVER sufficient.
 *  - legacy POST /api/v1/finance/admin/verify-student/:providerId delegates
 *    to the canonical admin.service.setStudentVerification (single
 *    implementation, single audit path, centralized exactly-once notify).
 *  - canonical POST /api/v1/admin/providers/:id/student-verification fires
 *    the student-verification outcome hook exactly once.
 *
 * ITEM 2 — Referral concurrency / conditional writes:
 *  - redeem/revoke use atomic conditional (updateMany + status predicate).
 *  - single-use: exactly one concurrent winner, rest get safe 422.
 *  - attribution never duplicates ACTIVE rows (lock + checks + P2002 map).
 *
 * Prisma is mocked at the module boundary; the real authMiddleware →
 * requireAdmin → route → service → audit/notify code runs unmodified.
 */
import request from 'supertest';
import jwt from 'jsonwebtoken';

// ---- mocks ----
const mockUserFindUnique = jest.fn();
const mockUserRoleFindMany = jest.fn();
const mockRoleFindUnique = jest.fn();
const mockProviderFindUnique = jest.fn();
const mockProviderUpdate = jest.fn();
const mockPartnerFindUnique = jest.fn();
const mockMemberFindFirst = jest.fn();
const mockMemberFindMany = jest.fn();
const mockReferralCreate = jest.fn();
const mockReferralFindUnique = jest.fn();
const mockReferralFindFirst = jest.fn();
const mockReferralFindMany = jest.fn();
const mockReferralCount = jest.fn();
const mockReferralUpdate = jest.fn();
const mockReferralUpdateMany = jest.fn();
const mockAttrFindFirst = jest.fn();
const mockAttrFindUnique = jest.fn();
const mockAttrFindMany = jest.fn();
const mockAttrCount = jest.fn();
const mockAttrCreate = jest.fn();
const mockAttrUpdate = jest.fn();
const mockAttrUpdateMany = jest.fn();
const mockSettingFindMany = jest.fn();
const mockSettingFindUnique = jest.fn();
const mockSettingUpsert = jest.fn();
const mockAuditCreate = jest.fn();
const mockNotifCreate = jest.fn();
const mockNotifFindUnique = jest.fn();
const mockNotifPrefFindUnique = jest.fn();
const mockTx = jest.fn();

jest.mock('../src/config/prisma', () => ({
  prisma: {
    user: { findUnique: (...a: any[]) => (mockUserFindUnique as any)(...a) },
    userRole: { findMany: (...a: any[]) => (mockUserRoleFindMany as any)(...a) },
    role: { findUnique: (...a: any[]) => (mockRoleFindUnique as any)(...a) },
    providerProfile: {
      findUnique: (...a: any[]) => (mockProviderFindUnique as any)(...a),
      update: (...a: any[]) => (mockProviderUpdate as any)(...a),
    },
    trainingPartner: {
      findUnique: (...a: any[]) => (mockPartnerFindUnique as any)(...a),
    },
    trainingPartnerMember: {
      findFirst: (...a: any[]) => (mockMemberFindFirst as any)(...a),
      findMany: (...a: any[]) => (mockMemberFindMany as any)(...a),
    },
    trainingReferral: {
      create: (...a: any[]) => (mockReferralCreate as any)(...a),
      findUnique: (...a: any[]) => (mockReferralFindUnique as any)(...a),
      findFirst: (...a: any[]) => (mockReferralFindFirst as any)(...a),
      findMany: (...a: any[]) => (mockReferralFindMany as any)(...a),
      count: (...a: any[]) => (mockReferralCount as any)(...a),
      update: (...a: any[]) => (mockReferralUpdate as any)(...a),
      updateMany: (...a: any[]) => (mockReferralUpdateMany as any)(...a),
    },
    trainingAttribution: {
      findFirst: (...a: any[]) => (mockAttrFindFirst as any)(...a),
      findUnique: (...a: any[]) => (mockAttrFindUnique as any)(...a),
      findMany: (...a: any[]) => (mockAttrFindMany as any)(...a),
      count: (...a: any[]) => (mockAttrCount as any)(...a),
      create: (...a: any[]) => (mockAttrCreate as any)(...a),
      update: (...a: any[]) => (mockAttrUpdate as any)(...a),
      updateMany: (...a: any[]) => (mockAttrUpdateMany as any)(...a),
    },
    adminSetting: {
      findMany: (...a: any[]) => (mockSettingFindMany as any)(...a),
      findUnique: (...a: any[]) => (mockSettingFindUnique as any)(...a),
      upsert: (...a: any[]) => (mockSettingUpsert as any)(...a),
    },
    auditLog: { create: (...a: any[]) => (mockAuditCreate as any)(...a) },
    notification: {
      create: (...a: any[]) => (mockNotifCreate as any)(...a),
      findUnique: (...a: any[]) => (mockNotifFindUnique as any)(...a),
    },
    notificationPreference: { findUnique: (...a: any[]) => (mockNotifPrefFindUnique as any)(...a) },
    $transaction: (...a: any[]) => (mockTx as any)(...a),
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
const authH = (sub: string, roles: string[] = []) => ({ Authorization: `Bearer ${token(sub, roles)}` });
// DB-backed admin: JWT may carry anything — authority comes from user_roles.
const dbAdmin = (sub: string) => authH(sub, []);
// Stale-token attack: JWT claims ADMIN but DB holds no ADMIN grant.
const staleAdminClaim = (sub: string) => authH(sub, ['ADMIN']);

const COMMISSION_ROWS = [
  { settingKey: 'commission_student_percent', settingValue: '16' },
  { settingKey: 'commission_t1_percent', settingValue: '25' },
  { settingKey: 'commission_t2_percent', settingValue: '25' },
  { settingKey: 'commission_t3_percent', settingValue: '25' },
  { settingKey: 'cash_cap_student', settingValue: '500' },
  { settingKey: 'cash_cap_t1', settingValue: '1000' },
  { settingKey: 'cash_cap_t2', settingValue: '1000' },
  { settingKey: 'cash_cap_t3', settingValue: '5000' },
];

const partnerA = {
  id: 'partner-a', uuid: 'uuid-a', legalName: 'Academy A (Pty) Ltd', displayName: 'Academy A',
  institutionType: 'ACADEMY', status: 'ACTIVE', verificationStatus: 'VERIFIED',
};

// Users with DB ADMIN grants. Everyone else (incl. stale-JWT holder) is denied.
let dbAdmins = new Set<string>(['user-admin']);

beforeEach(() => {
  // reset (not just clear) so no Once-queue or persistent impl leaks across tests.
  jest.resetAllMocks();
  dbAdmins = new Set<string>(['user-admin']);
  mockUserFindUnique.mockImplementation(async ({ where }: any) => {
    const id = where?.id ?? where?.uuid;
    if (!id || id === 'user-ghost') return null;
    return { id, status: 'ACTIVE', uuid: id, email: `${id}@test.local` };
  });
  mockUserRoleFindMany.mockImplementation(async ({ where }: any) => {
    if (dbAdmins.has(where?.userId)) return [{ userId: where.userId, role: { code: 'ADMIN' } }];
    return [];
  });
  mockRoleFindUnique.mockResolvedValue(null);
  mockProviderFindUnique.mockResolvedValue(null);
  mockProviderUpdate.mockImplementation(async ({ where, data }: any) => ({ id: where.id, ...data }));
  mockPartnerFindUnique.mockImplementation(async ({ where }: any) => {
    if (where?.id === 'partner-a') return partnerA;
    if (where?.id === 'partner-b') return { ...partnerA, id: 'partner-b', uuid: 'uuid-b', displayName: 'College B' };
    return null;
  });
  mockMemberFindFirst.mockResolvedValue(null);
  mockMemberFindMany.mockResolvedValue([{ userId: 'user-owner-a' }]);
  mockReferralFindUnique.mockResolvedValue(null);
  mockReferralFindFirst.mockResolvedValue(null);
  mockReferralFindMany.mockResolvedValue([]);
  mockReferralCount.mockResolvedValue(0);
  mockReferralUpdateMany.mockImplementation(async () => ({ count: 1 }));
  mockAttrFindFirst.mockResolvedValue(null);
  mockAttrFindUnique.mockResolvedValue(null);
  mockAttrFindMany.mockResolvedValue([]);
  mockAttrCount.mockResolvedValue(0);
  mockAttrCreate.mockImplementation(async ({ data }: any) => ({ id: 'att-1', ...data }));
  mockAttrUpdate.mockImplementation(async ({ where, data }: any) => ({ id: where.id, ...data }));
  mockAttrUpdateMany.mockImplementation(async () => ({ count: 1 }));
  mockSettingFindMany.mockResolvedValue(COMMISSION_ROWS);
  mockSettingFindUnique.mockResolvedValue(null);
  mockAuditCreate.mockImplementation(async ({ data }: any) => ({ id: 'audit-1', ...data }));
  mockNotifCreate.mockImplementation(async ({ data }: any) => ({ id: `notif-${data?.eventKey ?? 'x'}`, ...data }));
  mockNotifFindUnique.mockResolvedValue(null);
  mockNotifPrefFindUnique.mockResolvedValue(null);
  mockTx.mockImplementation(async (fn: any) => fn({
    trainingAttribution: {
      findFirst: (...a: any[]) => (mockAttrFindFirst as any)(...a),
      findUnique: (...a: any[]) => (mockAttrFindUnique as any)(...a),
      findMany: (...a: any[]) => (mockAttrFindMany as any)(...a),
      create: (...a: any[]) => (mockAttrCreate as any)(...a),
      update: (...a: any[]) => (mockAttrUpdate as any)(...a),
      updateMany: (...a: any[]) => (mockAttrUpdateMany as any)(...a),
    },
    $queryRaw: async () => [],
  }));
});

// ── ITEM 1 — Student verification authorization ──────────────────────────

describe('Slice 19 — Item 1: Student verification authorization', () => {
  it('1. legacy endpoint rejects unauthenticated callers → 401 without write', async () => {
    const res = await request(app).post('/api/v1/finance/admin/verify-student/prov-1').send({ action: 'APPROVE' });
    expect(res.status).toBe(401);
    expect(mockProviderUpdate).not.toHaveBeenCalled();
  });

  it('2. stale JWT ADMIN claim cannot authorize legacy endpoint → 403 without write', async () => {
    const res = await request(app)
      .post('/api/v1/finance/admin/verify-student/prov-1')
      .set(staleAdminClaim('user-stale'))
      .send({ action: 'APPROVE' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
    expect(mockProviderUpdate).not.toHaveBeenCalled();
    expect(mockAuditCreate).not.toHaveBeenCalled();
  });

  it('3. customer cannot authorize legacy endpoint → 403', async () => {
    const res = await request(app)
      .post('/api/v1/finance/admin/verify-student/prov-1')
      .set(authH('user-cust', ['CUSTOMER']))
      .send({ action: 'APPROVE' });
    expect(res.status).toBe(403);
    expect(mockProviderUpdate).not.toHaveBeenCalled();
  });

  it('4. provider cannot authorize legacy endpoint → 403', async () => {
    const res = await request(app)
      .post('/api/v1/finance/admin/verify-student/prov-1')
      .set(authH('user-prov', ['PROVIDER']))
      .send({ action: 'APPROVE' });
    expect(res.status).toBe(403);
    expect(mockProviderUpdate).not.toHaveBeenCalled();
  });

  it('5. T2/T3 owners (provider-role users) cannot authorize legacy endpoint → 403', async () => {
    for (const u of ['user-t2', 'user-t3']) {
      const res = await request(app)
        .post('/api/v1/finance/admin/verify-student/prov-1')
        .set(authH(u, ['PROVIDER']))
        .send({ action: 'APPROVE' });
      expect(res.status).toBe(403);
    }
    expect(mockProviderUpdate).not.toHaveBeenCalled();
  });

  it('6. stale JWT ADMIN claim cannot authorize canonical endpoint → 403 without write', async () => {
    const res = await request(app)
      .post('/api/v1/admin/providers/p-1/student-verification')
      .set(staleAdminClaim('user-stale'))
      .send({ action: 'APPROVE' });
    expect(res.status).toBe(403);
    expect(mockProviderUpdate).not.toHaveBeenCalled();
  });

  it('7. canonical admin path succeeds with audit (DB admin, no JWT role needed)', async () => {
    mockProviderFindUnique.mockResolvedValue({ id: 'p-1', isStudent: false, studentVerificationStatus: 'PENDING' });
    const res = await request(app)
      .post('/api/v1/admin/providers/p-1/student-verification')
      .set(dbAdmin('user-admin'))
      .send({ action: 'APPROVE' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ isStudent: true, studentVerificationStatus: 'VERIFIED' });
    expect(mockProviderUpdate).toHaveBeenCalledWith({
      where: { id: 'p-1' },
      data: { isStudent: true, studentVerificationStatus: 'VERIFIED' },
    });
    const audit = mockAuditCreate.mock.calls.find((c) => c[0]?.data?.action === 'STUDENT_VERIFICATION_APPROVE');
    expect(audit).toBeDefined();
    expect(audit[0].data.actorUserId).toBe('user-admin');
    expect(audit[0].data.beforeJson).toMatchObject({ isStudent: false, studentVerificationStatus: 'PENDING' });
  });

  it('8. legacy path uses the same authorization + same service effect (DB admin succeeds)', async () => {
    mockProviderFindUnique.mockResolvedValue({ id: 'prov-1', isStudent: false, studentVerificationStatus: 'PENDING' });
    const res = await request(app)
      .post('/api/v1/finance/admin/verify-student/prov-1')
      .set(dbAdmin('user-admin'))
      .send({ action: 'APPROVE' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ isStudent: true, studentVerificationStatus: 'VERIFIED' });
    expect(mockProviderUpdate).toHaveBeenCalledWith({
      where: { id: 'prov-1' },
      data: { isStudent: true, studentVerificationStatus: 'VERIFIED' },
    });
    const audit = mockAuditCreate.mock.calls.find((c) => c[0]?.data?.action === 'STUDENT_VERIFICATION_APPROVE');
    expect(audit).toBeDefined();
    expect(audit[0].data.actorUserId).toBe('user-admin');
  });

  it('9. canonical path notifies the outcome hook exactly once (provider + partner, idempotent keys)', async () => {
    mockProviderFindUnique.mockImplementation(async ({ where }: any) => {
      if (where?.id === 'p-1') return { id: 'p-1', userId: 'user-prov', isStudent: false, studentVerificationStatus: 'PENDING' };
      return null;
    });
    mockAttrFindFirst.mockResolvedValue({ id: 'att-1', partnerId: 'partner-a', providerId: 'p-1', status: 'ACTIVE' });
    const res = await request(app)
      .post('/api/v1/admin/providers/p-1/student-verification')
      .set(dbAdmin('user-admin'))
      .send({ action: 'APPROVE' });
    expect(res.status).toBe(200);
    const providerNotes = mockNotifCreate.mock.calls.filter((c) => c[0]?.data?.eventKey === 'student:outcome:p-1:VERIFIED');
    expect(providerNotes).toHaveLength(1);
    expect(providerNotes[0][0].data.type).toBe('STUDENT_VERIFICATION_APPROVED');
    // Partner-member fan-out uses distinct per-user idempotency keys — no duplicates.
    const keys = mockNotifCreate.mock.calls.map((c) => c[0]?.data?.eventKey);
    expect(keys.length).toBe(new Set(keys).size);
  });

  it('10. legacy path notifies exactly once (no duplicated notification logic)', async () => {
    mockProviderFindUnique.mockImplementation(async ({ where }: any) => {
      if (where?.id === 'prov-1') return { id: 'prov-1', userId: 'user-prov', isStudent: false, studentVerificationStatus: 'PENDING' };
      return null;
    });
    mockAttrFindFirst.mockResolvedValue({ id: 'att-1', partnerId: 'partner-a', providerId: 'prov-1', status: 'ACTIVE' });
    const res = await request(app)
      .post('/api/v1/finance/admin/verify-student/prov-1')
      .set(dbAdmin('user-admin'))
      .send({ action: 'APPROVE' });
    expect(res.status).toBe(200);
    const providerNotes = mockNotifCreate.mock.calls.filter((c) => c[0]?.data?.eventKey === 'student:outcome:prov-1:VERIFIED');
    expect(providerNotes).toHaveLength(1);
  });

  it('11. Student status cannot be self-assigned (request → PENDING only; direct verify forbidden)', async () => {
    mockProviderFindUnique.mockResolvedValue({ id: 'prov-1', userId: 'user-prov', isStudent: false, studentVerificationStatus: 'UNVERIFIED' });
    mockProviderUpdate.mockResolvedValue({ id: 'prov-1', studentVerificationStatus: 'PENDING' } as any);
    const req = await request(app).put('/api/v1/finance/student-request').set(authH('user-prov', ['PROVIDER'])).send({});
    expect(req.status).toBe(200);
    expect(req.body.data.studentVerificationStatus).toBe('PENDING');
    expect(mockProviderUpdate).toHaveBeenCalledWith({ where: { id: 'prov-1' }, data: { studentVerificationStatus: 'PENDING' } });
    // And the provider cannot approve themselves via either admin path.
    await request(app).post('/api/v1/admin/providers/prov-1/student-verification').set(authH('user-prov', ['PROVIDER'])).send({ action: 'APPROVE' }).expect(403);
    await request(app).post('/api/v1/finance/admin/verify-student/prov-1').set(authH('user-prov', ['PROVIDER'])).send({ action: 'APPROVE' }).expect(403);
  });

  it('12. commission configuration unaffected by verification (16/25 + caps, no setting writes)', async () => {
    mockProviderFindUnique.mockResolvedValue({ id: 'p-1', isStudent: false, studentVerificationStatus: 'PENDING' });
    await request(app).post('/api/v1/admin/providers/p-1/student-verification').set(dbAdmin('user-admin')).send({ action: 'APPROVE' }).expect(200);
    expect(mockSettingUpsert).not.toHaveBeenCalled();
    const rates = await request(app).get('/api/v1/finance/commission-rates').expect(200);
    expect(rates.body.data.rates).toMatchObject({ student: 16, t1: 25, t2: 25, t3: 25 });
    expect(rates.body.data.caps).toMatchObject({ student: 500, t1: 1000, t2: 1000, t3: 5000 });
  });
});

// ── ITEM 2 — Referral concurrency / conditional writes ───────────────────

describe('Slice 19 — Item 2: referral concurrency', () => {
  const future = () => new Date(Date.now() + 999999);
  const pendingReferral = () => ({ id: 'ref-1', partnerId: 'partner-a', status: 'PENDING', expiresAt: future(), codePrefix: 'WAA-AB', programme: null });

  it('13. single successful redemption uses a conditional write + audit', async () => {
    mockReferralFindUnique.mockResolvedValue(pendingReferral());
    mockProviderFindUnique.mockResolvedValue(null);
    mockReferralUpdateMany.mockResolvedValueOnce({ count: 1 });
    const res = await request(app).post('/api/v1/partners/referrals/redeem').set(authH('user-new')).send({ code: 'WAA-good' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('CLAIMED');
    expect(mockReferralUpdateMany).toHaveBeenCalledWith({
      where: { id: 'ref-1', status: 'PENDING', expiresAt: { gte: expect.any(Date) } },
      data: { status: 'CLAIMED', claimedByUserId: 'user-new', claimedAt: expect.any(Date) },
    });
    expect(JSON.stringify(mockAuditCreate.mock.calls)).toContain('REFERRAL_CLAIMED');
  });

  it('14. concurrent redemption: exactly one succeeds, loser gets safe 422 (no double claim)', async () => {
    const pending = pendingReferral();
    // req1 reads PENDING; req2 reads PENDING; req2's post-race re-read sees CLAIMED.
    mockReferralFindUnique
      .mockResolvedValueOnce(pending)
      .mockResolvedValueOnce(pending)
      .mockResolvedValue({ ...pending, status: 'CLAIMED' });
    mockProviderFindUnique.mockResolvedValue(null);
    // Winner claims; loser finds nothing to transition.
    mockReferralUpdateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    const first = await request(app).post('/api/v1/partners/referrals/redeem').set(authH('user-a')).send({ code: 'WAA-race' });
    expect(first.status).toBe(200);
    const second = await request(app).post('/api/v1/partners/referrals/redeem').set(authH('user-b')).send({ code: 'WAA-race' });
    expect(second.status).toBe(422);
    expect(second.body.error.code).toBe('REFERRAL_INVALID_STATE');
    const claims = mockAuditCreate.mock.calls.filter((c) => c[0]?.data?.action === 'REFERRAL_CLAIMED');
    expect(claims).toHaveLength(1);
  });

  it('15. second redemption of a used code is safely rejected (uniform, no oracle)', async () => {
    mockReferralFindUnique.mockResolvedValue({ ...pendingReferral(), status: 'CLAIMED' });
    const res = await request(app).post('/api/v1/partners/referrals/redeem').set(authH('user-x')).send({ code: 'WAA-used' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('REFERRAL_INVALID_STATE');
    expect(mockReferralUpdateMany).not.toHaveBeenCalled();
    expect(mockAuditCreate).not.toHaveBeenCalled();
  });

  it('16. revoke is a conditional PENDING → REVOKED transition', async () => {
    mockMemberFindFirst.mockImplementation(async ({ where }: any) =>
      where?.userId === 'user-owner-a'
        ? { id: 'm-1', partnerId: 'partner-a', userId: 'user-owner-a', role: 'OWNER', status: 'ACTIVE', partner: partnerA }
        : null,
    );
    mockReferralFindUnique.mockResolvedValue({ id: 'ref-1', partnerId: 'partner-a', status: 'PENDING' });
    mockReferralUpdateMany.mockResolvedValueOnce({ count: 1 });
    const res = await request(app).post('/api/v1/partners/me/referrals/ref-1/revoke').set(authH('user-owner-a'));
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('REVOKED');
    expect(mockReferralUpdateMany).toHaveBeenCalledWith({
      where: { id: 'ref-1', partnerId: 'partner-a', status: 'PENDING' },
      data: { status: 'REVOKED' },
    });
  });

  it('17. revoke loses to a concurrent redeem → safe 422, no state change', async () => {
    mockMemberFindFirst.mockImplementation(async ({ where }: any) =>
      where?.userId === 'user-owner-a'
        ? { id: 'm-1', partnerId: 'partner-a', userId: 'user-owner-a', role: 'OWNER', status: 'ACTIVE', partner: partnerA }
        : null,
    );
    mockReferralFindUnique
      .mockResolvedValueOnce({ id: 'ref-1', partnerId: 'partner-a', status: 'PENDING' })
      .mockResolvedValueOnce({ id: 'ref-1', partnerId: 'partner-a', status: 'CLAIMED' });
    mockReferralUpdateMany.mockResolvedValueOnce({ count: 0 });
    const res = await request(app).post('/api/v1/partners/me/referrals/ref-1/revoke').set(authH('user-owner-a'));
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('REFERRAL_INVALID_STATE');
    expect(JSON.stringify(mockAuditCreate.mock.calls)).not.toContain('REFERRAL_REVOKED');
  });

  it('18. expiry race: expired code transitions PENDING → EXPIRED conditionally and rejects', async () => {
    mockReferralFindUnique.mockResolvedValue({ id: 'ref-1', partnerId: 'partner-a', status: 'PENDING', expiresAt: new Date(Date.now() - 1000), codePrefix: 'WAA-AB' });
    mockReferralUpdateMany.mockResolvedValueOnce({ count: 1 });
    const res = await request(app).post('/api/v1/partners/referrals/redeem').set(authH('user-late')).send({ code: 'WAA-old' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('REFERRAL_EXPIRED');
    expect(mockReferralUpdateMany).toHaveBeenCalledWith({ where: { id: 'ref-1', status: 'PENDING' }, data: { status: 'EXPIRED' } });
    expect(JSON.stringify(mockAuditCreate.mock.calls)).not.toContain('REFERRAL_CLAIMED');
  });

  it('19. duplicate ACTIVE attribution prevented on link (pre-check, no create)', async () => {
    mockProviderFindUnique.mockResolvedValue({ id: 'prov-1', userId: 'user-new' });
    mockReferralFindFirst.mockResolvedValue({ id: 'ref-1', partnerId: 'partner-a', status: 'CLAIMED' });
    mockAttrFindFirst.mockResolvedValue({ id: 'att-old', status: 'ACTIVE' });
    const res = await request(app).post('/api/v1/partners/me/attribution/link').set(authH('user-new'));
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('ATTRIBUTION_EXISTS');
    expect(mockAttrCreate).not.toHaveBeenCalled();
  });

  it('20. unique-violation on concurrent link maps to deterministic 422 (never duplicate ACTIVE)', async () => {
    mockProviderFindUnique.mockResolvedValue({ id: 'prov-1', userId: 'user-new' });
    mockReferralFindFirst.mockResolvedValue({ id: 'ref-1', partnerId: 'partner-a', status: 'CLAIMED' });
    mockAttrFindFirst.mockResolvedValue(null);
    mockAttrFindUnique.mockResolvedValue(null);
    mockAttrFindMany.mockResolvedValue([]);
    mockAttrCreate.mockRejectedValueOnce(Object.assign(new Error('Unique constraint failed on the constraint: `training_centre_providers_partner_id_provider_id_key`'), { code: 'P2002' }));
    const res = await request(app).post('/api/v1/partners/me/attribution/link').set(authH('user-new'));
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('ATTRIBUTION_EXISTS');
  });

  it('21. provider cannot self-assign: link binds only to the claimed referral partner', async () => {
    mockProviderFindUnique.mockResolvedValue({ id: 'prov-1', userId: 'user-new' });
    mockReferralFindFirst.mockResolvedValue({ id: 'ref-1', partnerId: 'partner-a', status: 'CLAIMED' });
    mockAttrFindFirst.mockResolvedValue(null);
    mockAttrFindUnique.mockResolvedValue(null);
    mockAttrFindMany.mockResolvedValue([]);
    mockAttrCreate.mockImplementation(async ({ data }: any) => ({ id: 'att-1', ...data }));
    // Even if the caller smuggles a partner id, the body is ignored — binding is server-derived.
    const res = await request(app).post('/api/v1/partners/me/attribution/link').set(authH('user-new')).send({ partnerId: 'partner-b' });
    expect(res.status).toBe(201);
    expect(res.body.data.partnerId).toBe('partner-a');
    expect(mockAttrCreate.mock.calls[0][0].data.partnerId).toBe('partner-a');
    expect(mockAttrCreate.mock.calls[0][0].data.source).toBe('REFERRAL_CODE');
  });

  it('22. redeem schema is strict — partnerId smuggling rejected', async () => {
    const res = await request(app)
      .post('/api/v1/partners/referrals/redeem')
      .set(authH('user-new'))
      .send({ code: 'WAA-good', partnerId: 'partner-b' });
    expect(res.status).toBe(422);
  });

  it('23. admin reassignment remains authorized with audit', async () => {
    mockAttrFindUnique.mockResolvedValue({ id: 'att-1', partnerId: 'partner-a', providerId: 'prov-1', status: 'ACTIVE', referredUserId: 'u1' });
    mockAttrCreate.mockImplementation(async ({ data }: any) => ({ id: 'att-2', ...data }));
    const res = await request(app)
      .post('/api/v1/admin/partners/attributions/att-1/end')
      .set(dbAdmin('user-admin'))
      .send({ reason: 'Moved cities', reassignToPartnerId: 'partner-b' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('ENDED');
    expect(res.body.data.reassignedTo.partnerId).toBe('partner-b');
    expect(JSON.stringify(mockAuditCreate.mock.calls)).toContain('ATTRIBUTION_REASSIGNED');
  });

  it('24. admin cannot double-end an attribution (conditional end → safe 422)', async () => {
    mockAttrFindUnique.mockResolvedValue({ id: 'att-1', partnerId: 'partner-a', providerId: 'prov-1', status: 'ENDED' });
    const res = await request(app)
      .post('/api/v1/admin/partners/attributions/att-1/end')
      .set(dbAdmin('user-admin'))
      .send({ reason: 'again' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('ATTRIBUTION_INVALID_STATE');
  });

  it('25. audit trail records referral lifecycle correctly', async () => {
    mockMemberFindFirst.mockImplementation(async ({ where }: any) =>
      where?.userId === 'user-owner-a'
        ? { id: 'm-1', partnerId: 'partner-a', userId: 'user-owner-a', role: 'OWNER', status: 'ACTIVE', partner: partnerA }
        : null,
    );
    mockReferralFindUnique.mockResolvedValue(pendingReferral());
    mockProviderFindUnique.mockResolvedValue(null);
    mockReferralUpdateMany.mockResolvedValueOnce({ count: 1 });
    await request(app).post('/api/v1/partners/referrals/redeem').set(authH('user-new')).send({ code: 'WAA-good' });
    const claim = mockAuditCreate.mock.calls.find((c) => c[0]?.data?.action === 'REFERRAL_CLAIMED');
    expect(claim).toBeDefined();
    expect(claim[0].data.actorUserId).toBe('user-new');
    expect(claim[0].data.entityId).toBe('ref-1');
    expect(JSON.stringify(claim[0].data.afterJson)).not.toContain('WAA-good');
  });
});

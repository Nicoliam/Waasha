/**
 * Slice 17 — Training-Centre Ecosystem (backend).
 *
 * Covers partner application/lifecycle/profile, session-derived partner
 * authorization, referral issuance/redemption/linking, attribution
 * integrity, training evidence, advisory Student-verification support,
 * configurable partner share rules, accrual finance integration,
 * admin oversight, audit/notification hooks, marketplace neutrality,
 * and IDOR / privilege-escalation / PII-leakage security tests.
 *
 * Prisma is mocked at the module boundary; the real authMiddleware →
 * requireAdmin → route → service → audit code runs unmodified.
 */
import request from 'supertest';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

// ---- mocks ----
const mockUserFindUnique = jest.fn();
const mockUserRoleFindMany = jest.fn();
const mockUserRoleUpsert = jest.fn();
const mockRoleFindUnique = jest.fn();
const mockProviderFindUnique = jest.fn();
const mockProviderFindMany = jest.fn();
const mockPartnerCreate = jest.fn();
const mockPartnerFindUnique = jest.fn();
const mockPartnerFindMany = jest.fn();
const mockPartnerCount = jest.fn();
const mockPartnerUpdate = jest.fn();
const mockMemberFindFirst = jest.fn();
const mockMemberFindMany = jest.fn();
const mockMemberCreate = jest.fn();
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
const mockAttrDelete = jest.fn();
const mockEvidenceCreate = jest.fn();
const mockEvidenceFindUnique = jest.fn();
const mockEvidenceFindMany = jest.fn();
const mockEvidenceCount = jest.fn();
const mockEvidenceUpdate = jest.fn();
const mockRuleFindFirst = jest.fn();
const mockRuleFindMany = jest.fn();
const mockRuleCount = jest.fn();
const mockRuleCreate = jest.fn();
const mockRuleFindUnique = jest.fn();
const mockRuleUpdate = jest.fn();
const mockAccrualCreate = jest.fn();
const mockAccrualFindUnique = jest.fn();
const mockAccrualFindMany = jest.fn();
const mockAccrualCount = jest.fn();
const mockAccrualUpdate = jest.fn();
const mockBookingFindUnique = jest.fn();
const mockBookingCount = jest.fn();
const mockPaymentFindUnique = jest.fn();
const mockServiceCount = jest.fn();
const mockSettingFindUnique = jest.fn();
const mockAuditCreate = jest.fn();
const mockNotifCreate = jest.fn();
const mockNotifFindUnique = jest.fn();
const mockNotifPrefFindUnique = jest.fn();
const mockProviderUpdate = jest.fn();
const mockTx = jest.fn();

jest.mock('../src/config/prisma', () => ({
  prisma: {
    user: { findUnique: (...a: any[]) => (mockUserFindUnique as any)(...a) },
    userRole: {
      findMany: (...a: any[]) => (mockUserRoleFindMany as any)(...a),
      upsert: (...a: any[]) => (mockUserRoleUpsert as any)(...a),
    },
    role: { findUnique: (...a: any[]) => (mockRoleFindUnique as any)(...a) },
    providerProfile: {
      findUnique: (...a: any[]) => (mockProviderFindUnique as any)(...a),
      findMany: (...a: any[]) => (mockProviderFindMany as any)(...a),
      update: (...a: any[]) => (mockProviderUpdate as any)(...a),
    },
    trainingPartner: {
      create: (...a: any[]) => (mockPartnerCreate as any)(...a),
      findUnique: (...a: any[]) => (mockPartnerFindUnique as any)(...a),
      findMany: (...a: any[]) => (mockPartnerFindMany as any)(...a),
      count: (...a: any[]) => (mockPartnerCount as any)(...a),
      update: (...a: any[]) => (mockPartnerUpdate as any)(...a),
    },
    trainingPartnerMember: {
      findFirst: (...a: any[]) => (mockMemberFindFirst as any)(...a),
      findMany: (...a: any[]) => (mockMemberFindMany as any)(...a),
      create: (...a: any[]) => (mockMemberCreate as any)(...a),
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
      delete: (...a: any[]) => (mockAttrDelete as any)(...a),
    },
    trainingEvidence: {
      create: (...a: any[]) => (mockEvidenceCreate as any)(...a),
      findUnique: (...a: any[]) => (mockEvidenceFindUnique as any)(...a),
      findMany: (...a: any[]) => (mockEvidenceFindMany as any)(...a),
      count: (...a: any[]) => (mockEvidenceCount as any)(...a),
      update: (...a: any[]) => (mockEvidenceUpdate as any)(...a),
    },
    partnerShareRule: {
      findFirst: (...a: any[]) => (mockRuleFindFirst as any)(...a),
      findMany: (...a: any[]) => (mockRuleFindMany as any)(...a),
      count: (...a: any[]) => (mockRuleCount as any)(...a),
      create: (...a: any[]) => (mockRuleCreate as any)(...a),
      findUnique: (...a: any[]) => (mockRuleFindUnique as any)(...a),
      update: (...a: any[]) => (mockRuleUpdate as any)(...a),
    },
    partnerAccrual: {
      create: (...a: any[]) => (mockAccrualCreate as any)(...a),
      findUnique: (...a: any[]) => (mockAccrualFindUnique as any)(...a),
      findMany: (...a: any[]) => (mockAccrualFindMany as any)(...a),
      count: (...a: any[]) => (mockAccrualCount as any)(...a),
      update: (...a: any[]) => (mockAccrualUpdate as any)(...a),
    },
    booking: {
      findUnique: (...a: any[]) => (mockBookingFindUnique as any)(...a),
      count: (...a: any[]) => (mockBookingCount as any)(...a),
    },
    payment: { findUnique: (...a: any[]) => (mockPaymentFindUnique as any)(...a) },
    service: { count: (...a: any[]) => (mockServiceCount as any)(...a) },
    adminSetting: { findUnique: (...a: any[]) => (mockSettingFindUnique as any)(...a) },
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
import * as partnerSvc from '../src/modules/partners/training-partner.service';

const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-jwt-secret-change-me';

function token(sub: string) {
  return jwt.sign({ sub, uuid: sub, email: `${sub}@test.local` }, JWT_SECRET, {
    expiresIn: '1h',
    issuer: 'waasha',
    audience: 'waasha-app',
    algorithm: 'HS256',
  } as any);
}

const auth = (sub: string) => ({ Authorization: `Bearer ${token(sub)}` });

// ---- fixtures ----
const partnerA = {
  id: 'partner-a', uuid: 'uuid-a', legalName: 'Academy A (Pty) Ltd', displayName: 'Academy A',
  description: null, institutionType: 'ACADEMY', contactEmail: 'a@test.local', contactPhone: null,
  website: null, addressLine1: null, city: 'Cape Town', province: 'WC', postalCode: null,
  country: 'ZA', categoriesServed: ['BARBERS'], logoUrl: null, status: 'ACTIVE',
  verificationStatus: 'VERIFIED', partnershipNotes: 'secret-notes', createdAt: new Date(), updatedAt: new Date(),
};
const partnerB = { ...partnerA, id: 'partner-b', uuid: 'uuid-b', displayName: 'College B' };
const partnerPending = { ...partnerA, id: 'partner-p', uuid: 'uuid-p', displayName: 'Pending College', status: 'PENDING', verificationStatus: 'UNVERIFIED' };

const memberOwnerA = { id: 'm-1', partnerId: 'partner-a', userId: 'user-owner-a', role: 'OWNER', status: 'ACTIVE', partner: partnerA };
const memberStaffA = { id: 'm-2', partnerId: 'partner-a', userId: 'user-staff-a', role: 'STAFF', status: 'ACTIVE', partner: partnerA };
const memberOwnerB = { id: 'm-3', partnerId: 'partner-b', userId: 'user-owner-b', role: 'OWNER', status: 'ACTIVE', partner: partnerB };

function membershipFor(userId: string) {
  if (userId === 'user-owner-a') return memberOwnerA;
  if (userId === 'user-staff-a') return memberStaffA;
  if (userId === 'user-owner-b') return memberOwnerB;
  return null;
}

const rolesByUser: Record<string, string[]> = {
  'user-admin': ['ADMIN'],
  'user-owner-a': ['TRAINING_CENTRE'],
  'user-staff-a': ['TRAINING_CENTRE'],
  'user-cust': ['CUSTOMER'],
  'user-prov': ['PROVIDER'],
};

beforeEach(() => {
  jest.clearAllMocks();
  mockUserFindUnique.mockImplementation(async ({ where }: any) => {
    const id = where?.id ?? where?.uuid;
    if (!id || id === 'user-ghost') return null;
    return { id, status: 'ACTIVE', uuid: id, email: `${id}@test.local` };
  });
  mockUserRoleFindMany.mockImplementation(async ({ where }: any) => {
    const codes = rolesByUser[where?.userId] ?? [];
    return codes.map((code) => ({ userId: where?.userId, role: { code } }));
  });
  mockUserRoleUpsert.mockImplementation(async ({ create }: any) => ({ ...create }));
  mockRoleFindUnique.mockImplementation(async ({ where }: any) => {
    if (where?.code === 'TRAINING_CENTRE') return { id: 'role-tc', code: 'TRAINING_CENTRE', name: 'Training Centre' };
    if (where?.code === 'ADMIN') return { id: 'role-admin', code: 'ADMIN', name: 'Admin' };
    return null;
  });
  mockMemberFindFirst.mockImplementation(async ({ where }: any) => membershipFor(where?.userId) ?? null);
  mockMemberFindMany.mockImplementation(async ({ where }: any) => {
    const all = [memberOwnerA, memberStaffA, memberOwnerB];
    return all.filter((m) => !where?.partnerId || m.partnerId === where.partnerId);
  });
  mockPartnerFindUnique.mockImplementation(async ({ where }: any) => {
    if (where?.id === 'partner-a') return partnerA;
    if (where?.id === 'partner-b') return partnerB;
    if (where?.id === 'partner-p') return partnerPending;
    return null;
  });
  mockPartnerFindMany.mockResolvedValue([partnerA]);
  mockPartnerCount.mockResolvedValue(1);
  mockReferralFindMany.mockResolvedValue([]);
  mockReferralCount.mockResolvedValue(0);
  mockReferralFindUnique.mockResolvedValue(null);
  mockReferralFindFirst.mockResolvedValue(null);
  mockAttrFindFirst.mockResolvedValue(null);
  mockAttrFindUnique.mockResolvedValue(null);
  mockAttrFindMany.mockResolvedValue([]);
  mockAttrCount.mockResolvedValue(0);
  mockEvidenceFindMany.mockResolvedValue([]);
  mockEvidenceCount.mockResolvedValue(0);
  mockEvidenceFindUnique.mockResolvedValue(null);
  mockProviderFindUnique.mockResolvedValue(null);
  mockProviderFindMany.mockResolvedValue([]);
  mockBookingFindUnique.mockResolvedValue(null);
  mockBookingCount.mockResolvedValue(0);
  mockPaymentFindUnique.mockResolvedValue(null);
  mockServiceCount.mockResolvedValue(0);
  mockSettingFindUnique.mockResolvedValue(null);
  mockAuditCreate.mockImplementation(async ({ data }: any) => ({ id: 'audit-1', ...data }));
  mockNotifCreate.mockImplementation(async ({ data }: any) => ({ id: 'notif-1', ...data }));
  mockNotifFindUnique.mockResolvedValue(null);
  mockNotifPrefFindUnique.mockResolvedValue(null);
  mockRuleFindFirst.mockResolvedValue(null);
  mockRuleFindMany.mockResolvedValue([]);
  mockRuleCount.mockResolvedValue(0);
  mockAccrualFindMany.mockResolvedValue([]);
  mockAccrualCount.mockResolvedValue(0);
  mockAccrualFindUnique.mockResolvedValue(null);
  mockReferralUpdateMany.mockImplementation(async () => ({ count: 1 }));
  mockTx.mockImplementation(async (fn: any) => fn({
    trainingAttribution: {
      findFirst: (...a: any[]) => (mockAttrFindFirst as any)(...a),
      findUnique: (...a: any[]) => (mockAttrFindUnique as any)(...a),
      findMany: (...a: any[]) => (mockAttrFindMany as any)(...a),
      create: (...a: any[]) => (mockAttrCreate as any)(...a),
      update: (...a: any[]) => (mockAttrUpdate as any)(...a),
      updateMany: (...a: any[]) => ({ count: 1 }),
    },
    $queryRaw: async () => [],
  }));
});

const validApply = {
  legalName: 'New Academy (Pty) Ltd', displayName: 'New Academy', institutionType: 'COLLEGE',
  contactEmail: 'new@test.local', city: 'Durban', categoriesServed: ['BARBERS', 'CAR_WASH'],
};

describe('Slice 17 — partner application & lifecycle', () => {
  it('1. unauthenticated application is rejected', async () => {
    const res = await request(app).post('/api/v1/partners/apply').send(validApply);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  }, 60000);

  it('2. application creates a PENDING partner with OWNER membership and TRAINING_CENTRE role (never ADMIN)', async () => {
    mockMemberFindFirst.mockResolvedValueOnce(null);
    mockPartnerCreate.mockImplementation(async ({ data }: any) => ({ id: 'partner-new', uuid: 'u-new', ...data }));
    mockMemberCreate.mockImplementation(async ({ data }: any) => ({ id: 'm-new', ...data }));
    const res = await request(app).post('/api/v1/partners/apply').set(auth('user-new')).send(validApply);
    expect(res.status).toBe(201);
    expect(res.body.data.partner.status).toBe('PENDING');
    expect(res.body.data.membership.role).toBe('OWNER');
    expect(mockPartnerCreate).toHaveBeenCalled();
    expect(mockRoleFindUnique).toHaveBeenCalledWith({ where: { code: 'TRAINING_CENTRE' } });
    expect(mockUserRoleUpsert).toHaveBeenCalled();
    const upsertArg = mockUserRoleUpsert.mock.calls[0][0];
    expect(upsertArg.create.roleId).toBe('role-tc');
    expect(JSON.stringify(upsertArg)).not.toContain('role-admin');
    const audit = mockAuditCreate.mock.calls.find((c) => c[0]?.data?.action === 'PARTNER_APPLIED');
    expect(audit).toBeDefined();
  });

  it('3. application rejects unknown institution types', async () => {
    const res = await request(app).post('/api/v1/partners/apply').set(auth('user-new')).send({ ...validApply, institutionType: 'SPACEPORT' });
    expect(res.status).toBe(422);
  });

  it('4. application rejects non-launch categories', async () => {
    const res = await request(app).post('/api/v1/partners/apply').set(auth('user-new')).send({ ...validApply, categoriesServed: ['RIDES'] });
    expect(res.status).toBe(422);
  });

  it('5. applicant already in a partner cannot apply again', async () => {
    const res = await request(app).post('/api/v1/partners/apply').set(auth('user-owner-a')).send(validApply);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('PARTNER_ALREADY_MEMBER');
  });

  it('6. mass assignment: client-supplied status is rejected, created status stays PENDING', async () => {
    // Strict schema rejects `status` before any service/prisma call, so no
    // mocks are queued here (a queued Once would leak into later tests).
    const res = await request(app).post('/api/v1/partners/apply').set(auth('user-new')).send({ ...validApply, status: 'ACTIVE' });
    expect(res.status).toBe(422);
    expect(mockPartnerCreate).not.toHaveBeenCalled();
  });

  it('7. admin approves a pending partner with audit', async () => {
    mockPartnerFindUnique.mockResolvedValueOnce({ ...partnerPending });
    mockPartnerUpdate.mockImplementation(async ({ data }: any) => ({ ...partnerPending, ...data }));
    const res = await request(app).post('/api/v1/admin/partners/partner-p/status').set(auth('user-admin')).send({ status: 'ACTIVE' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('ACTIVE');
    const audit = mockAuditCreate.mock.calls.find((c) => c[0]?.data?.action === 'PARTNER_APPROVED');
    expect(audit).toBeDefined();
    expect(audit[0].data.entityId).toBe('partner-p');
  });

  it('8. admin cannot make an illegal transition (ACTIVE back to PENDING)', async () => {
    const res = await request(app).post('/api/v1/admin/partners/partner-a/status').set(auth('user-admin')).send({ status: 'PENDING' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('PARTNER_INVALID_TRANSITION');
  });

  it('9. admin suspends then reactivates', async () => {
    mockPartnerUpdate.mockImplementation(async ({ where, data }: any) => ({ id: where.id, ...data }));
    const s = await request(app).post('/api/v1/admin/partners/partner-a/status').set(auth('user-admin')).send({ status: 'SUSPENDED' });
    expect(s.status).toBe(200);
    mockPartnerFindUnique.mockResolvedValueOnce({ ...partnerA, status: 'SUSPENDED' });
    const r = await request(app).post('/api/v1/admin/partners/partner-a/status').set(auth('user-admin')).send({ status: 'ACTIVE' });
    expect(r.status).toBe(200);
  });

  it('10. admin deactivates; history endpoints still serve the partner record', async () => {
    mockPartnerUpdate.mockImplementation(async ({ where, data }: any) => ({ ...partnerA, id: where.id, ...data }));
    const res = await request(app).post('/api/v1/admin/partners/partner-a/status').set(auth('user-admin')).send({ status: 'DEACTIVATED' });
    expect(res.status).toBe(200);
    expect(mockAttrDelete).not.toHaveBeenCalled();
    const detail = await request(app).get('/api/v1/admin/partners/partner-a').set(auth('user-admin'));
    expect(detail.status).toBe(200);
    expect(detail.body.data.partner.id).toBe('partner-a');
  });

  it('11. non-admin cannot change partner status', async () => {
    const res = await request(app).post('/api/v1/admin/partners/partner-a/status').set(auth('user-owner-a')).send({ status: 'SUSPENDED' });
    expect(res.status).toBe(403);
  });

  it('12. admin verification approve/reject is audited', async () => {
    mockPartnerUpdate.mockImplementation(async ({ where, data }: any) => ({ ...partnerA, ...data }));
    const res = await request(app).post('/api/v1/admin/partners/partner-a/verification').set(auth('user-admin')).send({ action: 'APPROVE' });
    expect(res.status).toBe(200);
    expect(res.body.data.verificationStatus).toBe('VERIFIED');
    expect(mockAuditCreate.mock.calls.some((c) => c[0]?.data?.action === 'PARTNER_VERIFICATION_CHANGED')).toBe(true);
  });

  it('13. partner profile response never leaks internal notes', async () => {
    const res = await request(app).get('/api/v1/partners/me').set(auth('user-owner-a'));
    expect(res.status).toBe(200);
    expect(res.body.data.partner.displayName).toBe('Academy A');
    expect(res.body.data.partner.partnershipNotes).toBeUndefined();
    expect(JSON.stringify(res.body)).not.toContain('secret-notes');
  });

  it('14. owner can update profile; status self-update is rejected', async () => {
    mockPartnerUpdate.mockImplementation(async ({ data }: any) => ({ ...partnerA, ...data }));
    const ok = await request(app).patch('/api/v1/partners/me').set(auth('user-owner-a')).send({ city: 'Stellenbosch' });
    expect(ok.status).toBe(200);
    const bad = await request(app).patch('/api/v1/partners/me').set(auth('user-owner-a')).send({ status: 'ACTIVE' });
    expect(bad.status).toBe(422);
  });

  it('15. staff cannot update the partner profile', async () => {
    const res = await request(app).patch('/api/v1/partners/me').set(auth('user-staff-a')).send({ city: 'X' });
    expect(res.status).toBe(403);
  });
});

describe('Slice 17 — partner authorization boundaries', () => {
  it('16. customers cannot access partner self-service', async () => {
    const res = await request(app).get('/api/v1/partners/me').set(auth('user-cust'));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('PARTNER_FORBIDDEN');
  });

  it('17. plain providers cannot access partner self-service', async () => {
    const res = await request(app).get('/api/v1/partners/me/dashboard').set(auth('user-prov'));
    expect(res.status).toBe(403);
  });

  it('18. partner users cannot reach admin oversight', async () => {
    const res = await request(app).get('/api/v1/admin/partners').set(auth('user-owner-a'));
    expect(res.status).toBe(403);
  });

  it('19. cross-partner access is impossible (revoking partner B referral as partner A yields 404)', async () => {
    // referral belongs to partner B — service compares referral.partnerId to session partner
    mockReferralFindUnique.mockResolvedValueOnce({ id: 'ref-b', partnerId: 'partner-b', status: 'PENDING' });
    const res = await request(app).post('/api/v1/partners/me/referrals/ref-b/revoke').set(auth('user-owner-a'));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('REFERRAL_NOT_FOUND');
  });

  it('20. dashboard contains only aggregate metrics — no customer PII', async () => {
    mockAttrFindMany.mockResolvedValueOnce([]);
    mockAccrualFindMany.mockResolvedValueOnce([]);
    mockEvidenceCount.mockResolvedValueOnce(0);
    const res = await request(app).get('/api/v1/partners/me/dashboard').set(auth('user-owner-a'));
    expect(res.status).toBe(200);
    expect(res.body.data.metrics).toBeDefined();
    expect(res.body.data.disclaimer).toMatch(/does not guarantee/i);
    // No customer-domain data: only the partner's own organisation profile + aggregates.
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/customerId|customerEmail|passwordHash|phoneVerified|bookingId/i);
  });

  it('21. attributed provider list exposes no customer data, emails or secrets', async () => {
    mockAttrFindMany.mockResolvedValueOnce([
      { id: 'att-1', partnerId: 'partner-a', providerId: 'prov-1', status: 'ACTIVE', source: 'REFERRAL_CODE', referredAt: new Date(), approvedAt: new Date() },
    ]);
    mockAttrCount.mockResolvedValueOnce(1);
    mockProviderFindMany.mockResolvedValueOnce([
      { id: 'prov-1', displayName: 'Thandi', verificationStatus: 'VERIFIED', studentVerificationStatus: 'VERIFIED', isStudent: true, status: 'ACTIVE', tier: { code: 'T1' } },
    ]);
    const res = await request(app).get('/api/v1/partners/me/providers').set(auth('user-owner-a'));
    expect(res.status).toBe(200);
    expect(res.body.data[0].displayName).toBe('Thandi');
    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/email|phone|address|token|secret|password/i);
  });
});

describe('Slice 17 — referrals & attribution', () => {
  it('22. owner creates a referral; raw code returned once, only hash persisted', async () => {
    mockReferralCreate.mockImplementation(async ({ data }: any) => ({ id: 'ref-1', ...data }));
    const res = await request(app).post('/api/v1/partners/me/referrals').set(auth('user-owner-a')).send({ invitedEmail: 'stu@test.local', programme: 'Barbering 101' });
    expect(res.status).toBe(201);
    expect(res.body.data.code).toMatch(/^WAA-/);
    const stored = mockReferralCreate.mock.calls[0][0].data;
    expect(stored.codeHash).not.toContain('WAA-');
    expect(stored.codeHash).toBe(crypto.createHash('sha256').update(res.body.data.code, 'utf8').digest('hex'));
    expect(stored.codePrefix).toBe(res.body.data.code.slice(0, 6));
    expect(stored.code).toBeUndefined();
    expect(stored.codeHash).not.toContain(res.body.data.code);
    expect(JSON.stringify(mockAuditCreate.mock.calls)).toContain('REFERRAL_CREATED');
  });

  it('23. staff cannot issue referrals', async () => {
    const res = await request(app).post('/api/v1/partners/me/referrals').set(auth('user-staff-a')).send({ invitedEmail: 's@test.local' });
    expect(res.status).toBe(403);
  });

  it('24. referral requires a contact', async () => {
    const res = await request(app).post('/api/v1/partners/me/referrals').set(auth('user-owner-a')).send({ programme: 'X' });
    expect(res.status).toBe(422);
  });

  it('25. referral listing never exposes code hashes or raw codes', async () => {
    mockReferralFindMany.mockResolvedValueOnce([
      { id: 'ref-1', codeHash: 'deadbeef', codePrefix: 'WAA-AB', invitedEmail: 's@test.local', programme: null, status: 'PENDING', expiresAt: new Date(), claimedByUserId: null, claimedAt: null, createdAt: new Date() },
    ]);
    mockReferralCount.mockResolvedValueOnce(1);
    const res = await request(app).get('/api/v1/partners/me/referrals').set(auth('user-owner-a'));
    expect(res.status).toBe(200);
    expect(res.body.data[0].codePrefix).toBe('WAA-AB');
    expect(JSON.stringify(res.body)).not.toContain('deadbeef');
    expect(res.body.data[0].code).toBeUndefined();
    expect(res.body.data[0].codeHash).toBeUndefined();
  });

  it('26. owner revokes a pending referral with audit', async () => {
    mockReferralFindUnique.mockResolvedValueOnce({ id: 'ref-1', partnerId: 'partner-a', status: 'PENDING' });
    mockReferralUpdateMany.mockResolvedValueOnce({ count: 1 });
    const res = await request(app).post('/api/v1/partners/me/referrals/ref-1/revoke').set(auth('user-owner-a'));
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('REVOKED');
    expect(mockReferralUpdateMany).toHaveBeenCalledWith({
      where: { id: 'ref-1', partnerId: 'partner-a', status: 'PENDING' },
      data: { status: 'REVOKED' },
    });
    expect(JSON.stringify(mockAuditCreate.mock.calls)).toContain('REFERRAL_REVOKED');
  });

  it('27. revoking an already-claimed referral fails', async () => {
    mockReferralFindUnique.mockResolvedValueOnce({ id: 'ref-1', partnerId: 'partner-a', status: 'CLAIMED' });
    const res = await request(app).post('/api/v1/partners/me/referrals/ref-1/revoke').set(auth('user-owner-a'));
    expect(res.status).toBe(422);
  });

  it('28. redeeming an unknown code yields uniform 404 (no guessing oracle)', async () => {
    mockReferralFindUnique.mockResolvedValueOnce(null);
    const res = await request(app).post('/api/v1/partners/referrals/redeem').set(auth('user-prov')).send({ code: 'WAA-guess' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('REFERRAL_NOT_FOUND');
  });

  it('29. redeeming an already-used code fails without revealing state', async () => {
    mockReferralFindUnique.mockResolvedValueOnce({ id: 'ref-1', partnerId: 'partner-a', status: 'CLAIMED', expiresAt: new Date(Date.now() + 99999), codePrefix: 'WAA-AB' });
    const res = await request(app).post('/api/v1/partners/referrals/redeem').set(auth('user-prov')).send({ code: 'WAA-used' });
    expect(res.status).toBe(422);
  });

  it('30. expired codes are marked EXPIRED and rejected', async () => {
    mockReferralFindUnique.mockResolvedValueOnce({ id: 'ref-1', partnerId: 'partner-a', status: 'PENDING', expiresAt: new Date(Date.now() - 1000), codePrefix: 'WAA-AB' });
    mockReferralUpdateMany.mockResolvedValueOnce({ count: 1 });
    const res = await request(app).post('/api/v1/partners/referrals/redeem').set(auth('user-prov')).send({ code: 'WAA-old' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('REFERRAL_EXPIRED');
    expect(mockReferralUpdateMany).toHaveBeenCalledWith({ where: { id: 'ref-1', status: 'PENDING' }, data: { status: 'EXPIRED' } });
  });

  it('31. users already attributed cannot claim another referral', async () => {
    const future = new Date(Date.now() + 999999);
    mockReferralFindUnique.mockResolvedValueOnce({ id: 'ref-1', partnerId: 'partner-a', status: 'PENDING', expiresAt: future, codePrefix: 'WAA-AB' });
    mockProviderFindUnique.mockResolvedValueOnce({ id: 'prov-x', userId: 'user-prov' });
    mockAttrFindFirst.mockResolvedValueOnce({ id: 'att-old', status: 'ACTIVE' });
    const res = await request(app).post('/api/v1/partners/referrals/redeem').set(auth('user-prov')).send({ code: 'WAA-dup' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('ATTRIBUTION_EXISTS');
  });

  it('32. successful redemption claims without creating attribution yet', async () => {
    const future = new Date(Date.now() + 999999);
    mockReferralFindUnique.mockResolvedValueOnce({ id: 'ref-1', partnerId: 'partner-a', status: 'PENDING', expiresAt: future, codePrefix: 'WAA-AB', programme: 'Barbering' });
    mockProviderFindUnique.mockResolvedValueOnce(null);
    mockReferralUpdateMany.mockResolvedValueOnce({ count: 1 });
    const res = await request(app).post('/api/v1/partners/referrals/redeem').set(auth('user-newprov')).send({ code: 'WAA-good' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('CLAIMED');
    expect(mockReferralUpdateMany).toHaveBeenCalledWith({
      where: { id: 'ref-1', status: 'PENDING', expiresAt: { gte: expect.any(Date) } },
      data: { status: 'CLAIMED', claimedByUserId: 'user-newprov', claimedAt: expect.any(Date) },
    });
    expect(mockAttrCreate).not.toHaveBeenCalled();
  });

  it('33. linking attribution requires a completed provider profile', async () => {
    mockProviderFindUnique.mockResolvedValueOnce(null);
    const res = await request(app).post('/api/v1/partners/me/attribution/link').set(auth('user-newprov'));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('PROVIDER_NOT_FOUND');
  });

  it('34. linking attribution requires a claimed referral', async () => {
    mockProviderFindUnique.mockResolvedValueOnce({ id: 'prov-1', userId: 'user-newprov' });
    mockReferralFindFirst.mockResolvedValueOnce(null);
    const res = await request(app).post('/api/v1/partners/me/attribution/link').set(auth('user-newprov'));
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('REFERRAL_NOT_CLAIMED');
  });

  it('35. linking creates attribution bound to the claimed referral partner (no self-assignment)', async () => {
    mockProviderFindUnique.mockResolvedValueOnce({ id: 'prov-1', userId: 'user-newprov' });
    mockReferralFindFirst.mockResolvedValueOnce({ id: 'ref-1', partnerId: 'partner-a', status: 'CLAIMED' });
    mockAttrFindFirst.mockResolvedValueOnce(null);
    mockAttrFindUnique.mockResolvedValueOnce(null);
    mockAttrCreate.mockImplementation(async ({ data }: any) => ({ id: 'att-1', ...data }));
    const res = await request(app).post('/api/v1/partners/me/attribution/link').set(auth('user-newprov'));
    expect(res.status).toBe(201);
    expect(res.body.data.partnerId).toBe('partner-a');
    expect(mockAttrCreate.mock.calls[0][0].data.source).toBe('REFERRAL_CODE');
    expect(JSON.stringify(mockAuditCreate.mock.calls)).toContain('ATTRIBUTION_LINKED');
  });

  it('36. duplicate attribution is rejected', async () => {
    mockProviderFindUnique.mockResolvedValueOnce({ id: 'prov-1', userId: 'user-newprov' });
    mockReferralFindFirst.mockResolvedValueOnce({ id: 'ref-1', partnerId: 'partner-a', status: 'CLAIMED' });
    mockAttrFindFirst.mockResolvedValueOnce({ id: 'att-old', status: 'ACTIVE' });
    const res = await request(app).post('/api/v1/partners/me/attribution/link').set(auth('user-newprov'));
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('ATTRIBUTION_EXISTS');
  });

  it('37. admin attribution is an explicit audited operation', async () => {
    mockProviderFindUnique.mockResolvedValueOnce({ id: 'prov-9', userId: 'user-p9' });
    mockAttrFindFirst.mockResolvedValueOnce(null);
    mockAttrFindUnique.mockResolvedValueOnce(null);
    mockAttrCreate.mockImplementation(async ({ data }: any) => ({ id: 'att-9', ...data }));
    const res = await request(app).post('/api/v1/admin/partners/partner-a/attributions').set(auth('user-admin')).send({ providerId: 'prov-9' });
    expect(res.status).toBe(201);
    expect(JSON.stringify(mockAuditCreate.mock.calls)).toContain('ATTRIBUTION_CREATED_ADMIN');
  });

  it('38. admin cannot double-attribute an already-attributed provider', async () => {
    mockProviderFindUnique.mockResolvedValueOnce({ id: 'prov-9', userId: 'user-p9' });
    mockAttrFindFirst.mockResolvedValueOnce({ id: 'att-9', status: 'ACTIVE' });
    const res = await request(app).post('/api/v1/admin/partners/partner-a/attributions').set(auth('user-admin')).send({ providerId: 'prov-9' });
    expect(res.status).toBe(422);
  });

  it('39. admin ends attribution without deleting history; reassignment is explicit', async () => {
    mockAttrFindUnique.mockResolvedValueOnce({ id: 'att-1', partnerId: 'partner-a', providerId: 'prov-1', status: 'ACTIVE', referredUserId: 'u1' });
    mockAttrUpdate.mockImplementation(async ({ data }: any) => ({ id: 'att-1', ...data }));
    mockAttrCreate.mockImplementation(async ({ data }: any) => ({ id: 'att-2', ...data }));
    const res = await request(app).post('/api/v1/admin/partners/attributions/att-1/end').set(auth('user-admin')).send({ reason: 'Moved cities', reassignToPartnerId: 'partner-b' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('ENDED');
    expect(res.body.data.reassignedTo.partnerId).toBe('partner-b');
    expect(mockAttrDelete).not.toHaveBeenCalled();
    expect(JSON.stringify(mockAuditCreate.mock.calls)).toContain('ATTRIBUTION_REASSIGNED');
  });

  it('40. reassignment to the same partner is rejected', async () => {
    mockAttrFindUnique.mockResolvedValueOnce({ id: 'att-1', partnerId: 'partner-a', providerId: 'prov-1', status: 'ACTIVE' });
    const res = await request(app).post('/api/v1/admin/partners/attributions/att-1/end').set(auth('user-admin')).send({ reassignToPartnerId: 'partner-a' });
    expect(res.status).toBe(422);
  });
});

describe('Slice 17 — training evidence & Student verification', () => {
  it('41. partner submits evidence for an attributed provider', async () => {
    mockAttrFindFirst.mockResolvedValueOnce({ id: 'att-1', partnerId: 'partner-a', providerId: 'prov-1', status: 'ACTIVE' });
    mockEvidenceCreate.mockImplementation(async ({ data }: any) => ({ id: 'ev-1', createdAt: new Date(), ...data }));
    const res = await request(app).post('/api/v1/partners/me/evidence').set(auth('user-owner-a')).send({ providerId: 'prov-1', programme: 'Barbering 101', qualificationReference: 'CERT-123' });
    expect(res.status).toBe(201);
    expect(res.body.data.status).toBe('SUBMITTED');
    expect(JSON.stringify(mockAuditCreate.mock.calls)).toContain('TRAINING_EVIDENCE_SUBMITTED');
  });

  it('42. evidence for a non-attributed (forged) provider id is rejected', async () => {
    mockAttrFindFirst.mockResolvedValueOnce(null);
    const res = await request(app).post('/api/v1/partners/me/evidence').set(auth('user-owner-a')).send({ providerId: 'prov-stranger', programme: 'X' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('ATTRIBUTION_NOT_FOUND');
  });

  it('43. evidence requires at least one evidence field', async () => {
    mockAttrFindFirst.mockResolvedValueOnce({ id: 'att-1', partnerId: 'partner-a', providerId: 'prov-1', status: 'ACTIVE' });
    const res = await request(app).post('/api/v1/partners/me/evidence').set(auth('user-owner-a')).send({ providerId: 'prov-1' });
    expect(res.status).toBe(422);
  });

  it('44. evidence rejects future completion dates', async () => {
    mockAttrFindFirst.mockResolvedValueOnce({ id: 'att-1', partnerId: 'partner-a', providerId: 'prov-1', status: 'ACTIVE' });
    const res = await request(app).post('/api/v1/partners/me/evidence').set(auth('user-owner-a')).send({ providerId: 'prov-1', programme: 'X', completionDate: '2999-01-01' });
    expect(res.status).toBe(422);
  });

  it('45. evidence listing exposes references only — never private content or storage keys', async () => {
    mockEvidenceFindMany.mockResolvedValueOnce([
      { id: 'ev-1', providerId: 'prov-1', attributionId: 'att-1', programme: 'Barbering', qualificationReference: 'CERT-1', institutionConfirmation: 'signed by principal', completionDate: new Date(), mediaAssetId: 'media-1', status: 'SUBMITTED', reviewNote: null, createdAt: new Date() },
    ]);
    mockEvidenceCount.mockResolvedValueOnce(1);
    const res = await request(app).get('/api/v1/partners/me/evidence').set(auth('user-owner-a'));
    expect(res.status).toBe(200);
    expect(res.body.data[0].hasInstitutionConfirmation).toBe(true);
    expect(res.body.data[0].hasMediaReference).toBe(true);
    const body = JSON.stringify(res.body);
    expect(body).not.toContain('signed by principal');
    expect(body).not.toContain('media-1');
    expect(body).not.toContain('storage');
  });

  it('46. admin reviews evidence (approve) with audit', async () => {
    mockEvidenceFindUnique.mockResolvedValueOnce({ id: 'ev-1', status: 'SUBMITTED' });
    mockEvidenceUpdate.mockImplementation(async ({ data }: any) => ({ id: 'ev-1', ...data }));
    const res = await request(app).post('/api/v1/admin/partners/evidence/ev-1/review').set(auth('user-admin')).send({ action: 'APPROVE', note: 'Verified certificate' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('APPROVED');
    expect(JSON.stringify(mockAuditCreate.mock.calls)).toContain('TRAINING_EVIDENCE_REVIEWED');
  });

  it('47. reviewing already-reviewed evidence fails', async () => {
    mockEvidenceFindUnique.mockResolvedValueOnce({ id: 'ev-1', status: 'APPROVED' });
    const res = await request(app).post('/api/v1/admin/partners/evidence/ev-1/review').set(auth('user-admin')).send({ action: 'REJECT' });
    expect(res.status).toBe(422);
  });

  it('48. partner verification support is advisory only — never grants Student status or rate', async () => {
    mockAttrFindFirst.mockResolvedValueOnce({ id: 'att-1', partnerId: 'partner-a', providerId: 'prov-1', status: 'ACTIVE' });
    mockProviderFindUnique.mockResolvedValueOnce({ id: 'prov-1', userId: 'user-p1' });
    const res = await request(app).post('/api/v1/partners/me/providers/prov-1/support-verification').set(auth('user-owner-a'));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ supported: true, advisoryOnly: true });
    expect(mockProviderUpdate).not.toHaveBeenCalled();
    expect(JSON.stringify(mockAuditCreate.mock.calls)).toContain('STUDENT_VERIFICATION_SUPPORTED');
  });

  it('49. partner cannot support verification for unattributed providers', async () => {
    mockAttrFindFirst.mockResolvedValueOnce(null);
    const res = await request(app).post('/api/v1/partners/me/providers/prov-stranger/support-verification').set(auth('user-owner-a'));
    expect(res.status).toBe(404);
  });
});

describe('Slice 17 — share rules & accrual finance', () => {
  it('50. admin creates a partner-scoped share rule with audit', async () => {
    mockRuleCreate.mockImplementation(async ({ data }: any) => ({ id: 'rule-1', ...data }));
    const res = await request(app).post('/api/v1/admin/partners/share-rules').set(auth('user-admin')).send({ scope: 'PARTNER', partnerId: 'partner-a', percent: 10 });
    expect(res.status).toBe(201);
    expect(Number(res.body.data.percent)).toBe(10);
    expect(JSON.stringify(mockAuditCreate.mock.calls)).toContain('PARTNER_RULE_CREATED');
  });

  it('51. percentages are validated (0–100)', async () => {
    const res = await request(app).post('/api/v1/admin/partners/share-rules').set(auth('user-admin')).send({ scope: 'GLOBAL', percent: 150 });
    expect(res.status).toBe(422);
  });

  it('52. GLOBAL rules must not carry a partner id; PROGRAMME rules require a programme', async () => {
    const g = await request(app).post('/api/v1/admin/partners/share-rules').set(auth('user-admin')).send({ scope: 'GLOBAL', partnerId: 'partner-a', percent: 5 });
    expect(g.status).toBe(422);
    const p = await request(app).post('/api/v1/admin/partners/share-rules').set(auth('user-admin')).send({ scope: 'PROGRAMME', percent: 5 });
    expect(p.status).toBe(422);
  });

  it('53. partner users cannot configure finance rules', async () => {
    const res = await request(app).post('/api/v1/admin/partners/share-rules').set(auth('user-owner-a')).send({ scope: 'GLOBAL', percent: 5 });
    expect(res.status).toBe(403);
  });

  it('54. share rule updates are audited and preserve rule history', async () => {
    mockRuleFindUnique.mockResolvedValueOnce({ id: 'rule-1', percent: 10, isActive: true });
    mockRuleUpdate.mockImplementation(async ({ data }: any) => ({ id: 'rule-1', percent: 10, isActive: true, ...data }));
    const res = await request(app).patch('/api/v1/admin/partners/share-rules/rule-1').set(auth('user-admin')).send({ percent: 12 });
    expect(res.status).toBe(200);
    expect(JSON.stringify(mockAuditCreate.mock.calls)).toContain('PARTNER_RULE_UPDATED');
    expect(mockRuleCreate).not.toHaveBeenCalled();
  });

  it('55. eligible COMPLETED booking accrues with snapshotted commission math', async () => {
    mockBookingFindUnique.mockResolvedValueOnce({ id: 'b-1', status: 'COMPLETED', providerId: 'prov-1', totalAmount: 200, currency: 'ZAR' });
    mockAttrFindFirst.mockResolvedValueOnce({ id: 'att-1', partnerId: 'partner-a', providerId: 'prov-1', status: 'ACTIVE' });
    mockPaymentFindUnique.mockResolvedValueOnce({ id: 'pay-1', status: 'PAID', commissionRate: 16, commissionAmount: 32, currency: 'ZAR' });
    mockRuleFindFirst.mockResolvedValueOnce({ id: 'rule-1', percent: 10, isActive: true, effectiveFrom: new Date(Date.now() - 9999), effectiveTo: null });
    mockAccrualCreate.mockImplementation(async ({ data }: any) => ({ id: 'acc-1', earnedAt: new Date(), createdAt: new Date(), ...data }));
    const accrual = await partnerSvc.recordPartnerAccrualForBooking('b-1');
    expect(accrual).not.toBeNull();
    expect(Number(accrual.commissionRate)).toBe(16);
    expect(Number(accrual.commissionAmount)).toBe(32);
    expect(Number(accrual.partnerPercent)).toBe(10);
    expect(Number(accrual.partnerAmount)).toBe(3.2);
    expect(accrual.status).toBe('ACCRUED');
    expect(accrual.paidAt ?? null).toBeNull();
  });

  it('56. cancelled bookings never accrue', async () => {
    mockBookingFindUnique.mockResolvedValueOnce({ id: 'b-2', status: 'CANCELLED', providerId: 'prov-1', totalAmount: 200 });
    expect(await partnerSvc.recordPartnerAccrualForBooking('b-2')).toBeNull();
    expect(mockAccrualCreate).not.toHaveBeenCalled();
  });

  it('57. declined bookings never accrue', async () => {
    mockBookingFindUnique.mockResolvedValueOnce({ id: 'b-3', status: 'DECLINED', providerId: 'prov-1', totalAmount: 200 });
    expect(await partnerSvc.recordPartnerAccrualForBooking('b-3')).toBeNull();
    expect(mockAccrualCreate).not.toHaveBeenCalled();
  });

  it('58. payments alone never accrue — booking must be COMPLETED', async () => {
    mockBookingFindUnique.mockResolvedValueOnce({ id: 'b-4', status: 'PAID', providerId: 'prov-1', totalAmount: 200 });
    expect(await partnerSvc.recordPartnerAccrualForBooking('b-4')).toBeNull();
    expect(mockAccrualCreate).not.toHaveBeenCalled();
  });

  it('59. no attribution means no accrual', async () => {
    mockBookingFindUnique.mockResolvedValueOnce({ id: 'b-5', status: 'COMPLETED', providerId: 'prov-9', totalAmount: 200 });
    mockAttrFindFirst.mockResolvedValueOnce(null);
    expect(await partnerSvc.recordPartnerAccrualForBooking('b-5')).toBeNull();
  });

  it('60. zero configured share means no accrual (no invented splits)', async () => {
    mockBookingFindUnique.mockResolvedValueOnce({ id: 'b-6', status: 'COMPLETED', providerId: 'prov-1', totalAmount: 200, currency: 'ZAR' });
    mockAttrFindFirst.mockResolvedValueOnce({ id: 'att-1', partnerId: 'partner-a', providerId: 'prov-1', status: 'ACTIVE' });
    mockPaymentFindUnique.mockResolvedValueOnce({ id: 'pay-1', status: 'PAID', commissionRate: 25, commissionAmount: 50 });
    mockRuleFindFirst.mockResolvedValueOnce(null);
    mockSettingFindUnique.mockResolvedValueOnce(null);
    expect(await partnerSvc.recordPartnerAccrualForBooking('b-6')).toBeNull();
    expect(mockAccrualCreate).not.toHaveBeenCalled();
  });

  it('61. duplicate accrual attempts return the existing record (idempotent)', async () => {
    const existing = { id: 'acc-1', partnerId: 'partner-a', providerId: 'prov-1', bookingId: 'b-1', grossAmount: 200, commissionRate: 16, commissionAmount: 32, partnerPercent: 10, partnerAmount: 3.2, currency: 'ZAR', ruleId: 'rule-1', status: 'ACCRUED', earnedAt: new Date(), createdAt: new Date() };
    mockBookingFindUnique.mockResolvedValueOnce({ id: 'b-1', status: 'COMPLETED', providerId: 'prov-1', totalAmount: 200, currency: 'ZAR' });
    mockAttrFindFirst.mockResolvedValueOnce({ id: 'att-1', partnerId: 'partner-a', providerId: 'prov-1', status: 'ACTIVE' });
    mockPaymentFindUnique.mockResolvedValueOnce({ id: 'pay-1', status: 'PAID', commissionRate: 16, commissionAmount: 32 });
    mockRuleFindFirst.mockResolvedValueOnce({ id: 'rule-1', percent: 10, isActive: true, effectiveFrom: new Date(Date.now() - 9999), effectiveTo: null });
    mockAccrualCreate.mockRejectedValueOnce(Object.assign(new Error('Unique constraint'), { code: 'P2002' }));
    mockAccrualFindUnique.mockResolvedValueOnce(existing);
    const accrual = await partnerSvc.recordPartnerAccrualForBooking('b-1');
    expect(accrual?.id).toBe('acc-1');
  });

  it('62. share precedence: PARTNER rule beats GLOBAL rule', async () => {
    mockRuleFindFirst.mockImplementation(async ({ where }: any) => {
      if (where?.scope === 'PARTNER') return { id: 'rule-p', percent: 15, isActive: true, effectiveFrom: new Date(Date.now() - 9999), effectiveTo: null };
      if (where?.scope === 'GLOBAL') return { id: 'rule-g', percent: 5, isActive: true, effectiveFrom: new Date(Date.now() - 9999), effectiveTo: null };
      return null;
    });
    const share = await partnerSvc.resolvePartnerShare('partner-a', null);
    expect(share.source).toBe('PARTNER');
    expect(share.percent).toBe(15);
  });

  it('63. admin accrual list carries totals and an accrual-is-not-payment disclaimer', async () => {
    mockAccrualFindMany.mockResolvedValueOnce([
      { id: 'acc-1', partnerId: 'partner-a', providerId: 'prov-1', bookingId: 'b-1', grossAmount: 200, commissionRate: 16, commissionAmount: 32, partnerPercent: 10, partnerAmount: 3.2, currency: 'ZAR', ruleId: 'rule-1', status: 'ACCRUED', earnedAt: new Date(), createdAt: new Date() },
    ]);
    mockAccrualCount.mockResolvedValueOnce(1);
    const res = await request(app).get('/api/v1/admin/partners/accruals/list').set(auth('user-admin'));
    expect(res.status).toBe(200);
    expect(res.body.meta.totals.accruedAmount).toBe(3.2);
    expect(res.body.meta.disclaimer).toMatch(/not payment/i);
  });

  it('64. admin reverses an accrual via state change (history preserved)', async () => {
    mockAccrualFindUnique.mockResolvedValueOnce({ id: 'acc-1', status: 'ACCRUED' });
    mockAccrualUpdate.mockImplementation(async ({ data }: any) => ({ id: 'acc-1', ...data }));
    const res = await request(app).post('/api/v1/admin/partners/accruals/acc-1/reverse').set(auth('user-admin')).send({ reason: 'Booking refunded' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('REVERSED');
    expect(JSON.stringify(mockAuditCreate.mock.calls)).toContain('PARTNER_ACCRUAL_REVERSED');
  });

  it('65. reversing a non-ACCRUED record fails', async () => {
    mockAccrualFindUnique.mockResolvedValueOnce({ id: 'acc-1', status: 'REVERSED' });
    const res = await request(app).post('/api/v1/admin/partners/accruals/acc-1/reverse').set(auth('user-admin')).send({});
    expect(res.status).toBe(422);
  });

  it('66. partner earnings view is accrual-only with disclaimer (never presented as payout)', async () => {
    mockAccrualFindMany.mockResolvedValueOnce([]);
    mockAccrualCount.mockResolvedValueOnce(0);
    const res = await request(app).get('/api/v1/partners/me/earnings').set(auth('user-owner-a'));
    expect(res.status).toBe(200);
    expect(res.body.meta.disclaimer).toMatch(/not.*payment|accrual/i);
  });
});

describe('Slice 17 — notifications, audit & resilience', () => {
  it('67. partner approval notifies members and admins without breaking the write', async () => {
    mockPartnerFindUnique.mockResolvedValueOnce({ ...partnerPending });
    mockPartnerUpdate.mockImplementation(async ({ data }: any) => ({ ...partnerPending, ...data }));
    mockNotifCreate.mockRejectedValueOnce(new Error('notify down'));
    const res = await request(app).post('/api/v1/admin/partners/partner-p/status').set(auth('user-admin')).send({ status: 'ACTIVE' });
    expect(res.status).toBe(200);
  });

  it('68. audit failures fail closed (action not recorded, action not applied silently)', async () => {
    mockMemberFindFirst.mockResolvedValueOnce(null);
    mockPartnerCreate.mockImplementation(async ({ data }: any) => ({ id: 'partner-x', uuid: 'u-x', ...data }));
    mockMemberCreate.mockImplementation(async ({ data }: any) => ({ id: 'm-x', ...data }));
    mockAuditCreate.mockRejectedValueOnce(new Error('audit down'));
    const res = await request(app).post('/api/v1/partners/apply').set(auth('user-new')).send(validApply);
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('AUDIT_UNAVAILABLE');
  });

  it('69. completion hook records partner accruals post-commit (source integration)', async () => {
    const fs = jest.requireActual('fs');
    const path = jest.requireActual('path');
    const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'modules', 'bookings', 'booking-completion.service.ts'), 'utf8');
    expect(src).toContain('recordPartnerAccrualForBooking');
    // best-effort post-commit: failures swallowed, never breaks completion
    expect(src).toMatch(/catch\(\(\) => null\)|catch \(\(\) => null\)/);
  });

  it('70. Student verification outcome notifies the attributed partner (source integration)', async () => {
    const fs = jest.requireActual('fs');
    const path = jest.requireActual('path');
    // Slice 19 — centralized exactly-once hook lives in the canonical
    // admin.service.setStudentVerification; the legacy finance route
    // delegates there (no duplicated notification logic).
    const adminSvc = fs.readFileSync(path.join(__dirname, '..', 'src', 'modules', 'admin', 'admin.service.ts'), 'utf8');
    expect(adminSvc).toContain('notifyStudentVerificationOutcome');
    const legacy = fs.readFileSync(path.join(__dirname, '..', 'src', 'modules', 'finance', 'finance.routes.ts'), 'utf8');
    expect(legacy).toContain('setStudentVerification');
    expect(legacy).not.toContain('notifyStudentVerificationOutcome');
  });

  it('71. marketplace has no ranking coupling to partners (no boost, no priority)', async () => {
    const fs = jest.requireActual('fs');
    const path = jest.requireActual('path');
    const svc = fs.readFileSync(path.join(__dirname, '..', 'src', 'modules', 'partners', 'training-partner.service.ts'), 'utf8');
    // Neutrality is documented; strip comments/strings then require zero ranking machinery.
    const code = svc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '').replace(/'[^']*'|"[^"]*"|`[^`]*`/g, "''");
    expect(code).not.toMatch(/boost|rank|priority|score/i);
    expect(svc).toMatch(/no ranking coupling/i);
    const market = fs.readFileSync(path.join(__dirname, '..', 'src', 'modules', 'marketplace', 'marketplace.routes.ts'), 'utf8');
    expect(market).not.toMatch(/training|partner/i);
  });

  it('72. no hard-coded commission or share percentages in partner backend', async () => {
    const fs = jest.requireActual('fs');
    const path = jest.requireActual('path');
    const dir = path.join(__dirname, '..', 'src', 'modules', 'partners');
    const files = fs.readdirSync(dir).filter((f: string) => f.endsWith('.ts'));
    for (const f of files) {
      const src: string = fs.readFileSync(path.join(dir, f), 'utf8');
      // 16/25 appear only in comments explaining defaults, never as rate literals in logic
      const codeLines = src.split('\n').filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//'));
      const code = codeLines.join('\n');
      expect(code).not.toMatch(/commissionRate\s*=\s*16|commissionRate\s*=\s*25/);
      expect(code).not.toMatch(/partnerPercent\s*=\s*\d/);
    }
  });

  it('73. no driver functionality in the partner module', async () => {
    const fs = jest.requireActual('fs');
    const path = jest.requireActual('path');
    const svc = fs.readFileSync(path.join(__dirname, '..', 'src', 'modules', 'partners', 'training-partner.service.ts'), 'utf8');
    expect(svc).not.toMatch(/driver|ride/i);
  });

  it('74. referral secrets never reach audit logs or notifications', async () => {
    mockReferralCreate.mockImplementation(async ({ data }: any) => ({ id: 'ref-1', ...data }));
    const res = await request(app).post('/api/v1/partners/me/referrals').set(auth('user-owner-a')).send({ invitedEmail: 's@test.local' });
    const raw: string = res.body.data.code;
    expect(raw).toBeTruthy();
    for (const call of mockAuditCreate.mock.calls) expect(JSON.stringify(call)).not.toContain(raw);
    for (const call of mockNotifCreate.mock.calls) expect(JSON.stringify(call)).not.toContain(raw);
  });

  it('75. forged partner id in admin attribution target is validated', async () => {
    mockAttrFindUnique.mockResolvedValueOnce({ id: 'att-1', partnerId: 'partner-a', providerId: 'prov-1', status: 'ACTIVE' });
    const res = await request(app).post('/api/v1/admin/partners/attributions/att-1/end').set(auth('user-admin')).send({ reassignToPartnerId: 'partner-ghost' });
    expect(res.status).toBe(404);
  });
});

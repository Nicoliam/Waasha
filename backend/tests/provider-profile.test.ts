/**
 * Phase 2 Slice 10 — Provider profile management API.
 *
 * Covers: GET own profile, PATCH own profile, unauthenticated GET/PATCH,
 * missing profile, valid displayName/bio/experience/customRequests/image-ref,
 * allowlist + userId/providerId/tier/type/verification/student/commission/
 * cash-cap/coverage manipulation attempts, audit, sanitized errors.
 */
import request from 'supertest';
import jwt from 'jsonwebtoken';

function token(sub: string) {
  const secret = process.env.JWT_SECRET ?? 'dev-jwt-secret-change-me';
  return jwt.sign(
    { sub, uuid: sub, email: `${sub}@test.local`, roles: ['PROVIDER'] },
    secret,
    { expiresIn: '1h', issuer: 'waasha', audience: 'waasha-app' } as any,
  );
}

const mockUserFindUnique = jest.fn();
const mockProfileFindUnique = jest.fn();
const mockProfileUpdate = jest.fn();
const mockAuditCreate = jest.fn();

jest.mock('../src/config/prisma', () => ({
  prisma: {
    user: { findUnique: mockUserFindUnique },
    providerProfile: { findUnique: mockProfileFindUnique, update: mockProfileUpdate },
    serviceCategory: { findUnique: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
    providerLocation: { findFirst: jest.fn().mockResolvedValue(null), findMany: jest.fn().mockResolvedValue([]) },
    auditLog: { create: mockAuditCreate },
    adminSetting: { findMany: jest.fn().mockResolvedValue([]) },
    $queryRaw: jest.fn().mockResolvedValue([1]),
  },
}));

import { app } from '../src/app';

function profileRow(over: Record<string, unknown> = {}) {
  return {
    id: 'prov-1',
    userId: 'user-1',
    displayName: 'Sipho Cuts',
    bio: 'Master barber',
    profileImageUrl: 'https://cdn.test/avatar.jpg',
    experienceSummary: '8 years experience',
    customRequestsEnabled: false,
    providerType: 'INDIVIDUAL',
    verificationStatus: 'VERIFIED',
    isStudent: false,
    studentVerificationStatus: 'UNVERIFIED',
    status: 'ACTIVE',
    coverageRadiusKm: 10,
    acceptCash: true,
    timezone: 'Africa/Johannesburg',
    tier: { id: 't1', code: 'T1', name: 'Individual' },
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-02-01T00:00:00Z'),
    ...over,
  } as any;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUserFindUnique.mockImplementation(async ({ where }: any) => {
    if (where?.id && typeof where.id === 'string') return { id: where.id, status: 'ACTIVE' };
    return null;
  });
  mockProfileFindUnique.mockResolvedValue(profileRow());
  mockProfileUpdate.mockImplementation(async ({ data }: any) => profileRow({ ...data }));
  mockAuditCreate.mockResolvedValue({});
});

describe('Slice 10 — GET own profile', () => {
  it('1. GET own profile returns session-owned data with read-only context', async () => {
    const res = await request(app).get('/api/v1/providers/me').set('Authorization', `Bearer ${token('user-1')}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe('prov-1');
    expect(res.body.data.displayName).toBe('Sipho Cuts');
    expect(res.body.data.tier.code).toBe('T1');
    expect(res.body.data.verificationStatus).toBe('VERIFIED');
    expect(res.body.data.coverageRadiusKm).toBe(10);
    expect(mockProfileFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-1' } }),
    );
  });

  it('3. unauthenticated GET rejected with 401', async () => {
    const res = await request(app).get('/api/v1/providers/me');
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('5. missing provider profile returns 404 PROVIDER_NOT_FOUND', async () => {
    mockProfileFindUnique.mockResolvedValue(null);
    const res = await request(app).get('/api/v1/providers/me').set('Authorization', `Bearer ${token('user-9')}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('PROVIDER_NOT_FOUND');
  });

  it('attacker JWT providerId cannot redirect the lookup (session userId only)', async () => {
    const attacker = jwt.sign(
      { sub: 'attacker', uuid: 'attacker', email: 'a@t.local', roles: ['PROVIDER'], providerId: 'prov-victim' },
      process.env.JWT_SECRET ?? 'dev-jwt-secret-change-me',
      { expiresIn: '1h', issuer: 'waasha', audience: 'waasha-app' } as any,
    );
    mockUserFindUnique.mockResolvedValue({ id: 'attacker', status: 'ACTIVE' });
    mockProfileFindUnique.mockResolvedValue(profileRow({ id: 'prov-attacker', userId: 'attacker' }));
    const res = await request(app).get('/api/v1/providers/me').set('Authorization', `Bearer ${attacker}`);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe('prov-attacker');
    expect(mockProfileFindUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'attacker' } }));
  });
});

describe('Slice 10 — PATCH own profile (valid fields)', () => {
  it('2. PATCH own profile updates editable fields', async () => {
    const res = await request(app)
      .patch('/api/v1/providers/me')
      .set('Authorization', `Bearer ${token('user-1')}`)
      .send({ displayName: 'Sipho Deluxe', customRequestsEnabled: true });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(mockProfileUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ displayName: 'Sipho Deluxe', customRequestsEnabled: true }) }),
    );
  });

  it('4. unauthenticated PATCH rejected with 401', async () => {
    const res = await request(app).patch('/api/v1/providers/me').send({ displayName: 'Nope' });
    expect(res.status).toBe(401);
    expect(mockProfileUpdate).not.toHaveBeenCalled();
  });

  it('6. valid display name accepted', async () => {
    const res = await request(app)
      .patch('/api/v1/providers/me')
      .set('Authorization', `Bearer ${token('user-1')}`)
      .send({ displayName: 'Ama Styles' });
    expect(res.status).toBe(200);
    expect(mockProfileUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ displayName: 'Ama Styles' }) }),
    );
  });

  it('6b. blank/too-short display name rejected', async () => {
    for (const displayName of ['', ' ', 'A']) {
      const res = await request(app)
        .patch('/api/v1/providers/me')
        .set('Authorization', `Bearer ${token('user-1')}`)
        .send({ displayName });
      expect(res.status).toBe(422);
    }
    expect(mockProfileUpdate).not.toHaveBeenCalled();
  });

  it('7. valid bio accepted', async () => {
    const res = await request(app)
      .patch('/api/v1/providers/me')
      .set('Authorization', `Bearer ${token('user-1')}`)
      .send({ bio: 'Specialist in fades and beard trims.' });
    expect(res.status).toBe(200);
  });

  it('7b. oversized bio rejected', async () => {
    const res = await request(app)
      .patch('/api/v1/providers/me')
      .set('Authorization', `Bearer ${token('user-1')}`)
      .send({ bio: 'x'.repeat(2001) });
    expect(res.status).toBe(422);
    expect(mockProfileUpdate).not.toHaveBeenCalled();
  });

  it('8. valid experience summary accepted', async () => {
    const res = await request(app)
      .patch('/api/v1/providers/me')
      .set('Authorization', `Bearer ${token('user-1')}`)
      .send({ experienceSummary: '10 years across Johannesburg salons.' });
    expect(res.status).toBe(200);
  });

  it('9. customRequestsEnabled update accepted and persisted', async () => {
    const res = await request(app)
      .patch('/api/v1/providers/me')
      .set('Authorization', `Bearer ${token('user-1')}`)
      .send({ customRequestsEnabled: true });
    expect(res.status).toBe(200);
    expect(mockProfileUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ customRequestsEnabled: true }) }),
    );
  });

  it('9b. non-boolean customRequestsEnabled rejected', async () => {
    const res = await request(app)
      .patch('/api/v1/providers/me')
      .set('Authorization', `Bearer ${token('user-1')}`)
      .send({ customRequestsEnabled: 'yes' });
    expect(res.status).toBe(422);
    expect(mockProfileUpdate).not.toHaveBeenCalled();
  });

  it('10. profile image reference accepted; inline binary rejected', async () => {
    const ok = await request(app)
      .patch('/api/v1/providers/me')
      .set('Authorization', `Bearer ${token('user-1')}`)
      .send({ profileImageUrl: 'https://cdn.test/new-avatar.jpg' });
    expect(ok.status).toBe(200);

    const bad = await request(app)
      .patch('/api/v1/providers/me')
      .set('Authorization', `Bearer ${token('user-1')}`)
      .send({ profileImageUrl: 'data:image/jpeg;base64,AAAA' });
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('UPLOAD_NOT_SUPPORTED');
  });

  it('HTML in text fields is sanitized, never stored raw', async () => {
    const res = await request(app)
      .patch('/api/v1/providers/me')
      .set('Authorization', `Bearer ${token('user-1')}`)
      .send({ displayName: '<script>alert(1)</script>Sipho' });
    expect(res.status).toBe(200);
    const stored = mockProfileUpdate.mock.calls[0][0].data.displayName as string;
    expect(stored).not.toContain('<');
    expect(stored).toContain('Sipho');
  });

  it('empty PATCH body rejected', async () => {
    const res = await request(app)
      .patch('/api/v1/providers/me')
      .set('Authorization', `Bearer ${token('user-1')}`)
      .send({});
    expect(res.status).toBe(422);
    expect(mockProfileUpdate).not.toHaveBeenCalled();
  });
});

describe('Slice 10 — allowlist / mass assignment', () => {
  it('11. unknown fields rejected', async () => {
    const res = await request(app)
      .patch('/api/v1/providers/me')
      .set('Authorization', `Bearer ${token('user-1')}`)
      .send({ displayName: 'Sipho', nickname: 'Sips' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(mockProfileUpdate).not.toHaveBeenCalled();
  });

  it('12. attempted userId manipulation rejected', async () => {
    const res = await request(app)
      .patch('/api/v1/providers/me')
      .set('Authorization', `Bearer ${token('user-1')}`)
      .send({ userId: 'victim-user', displayName: 'Sipho' });
    expect(res.status).toBe(422);
    expect(mockProfileUpdate).not.toHaveBeenCalled();
  });

  it('13. attempted providerId manipulation rejected', async () => {
    const res = await request(app)
      .patch('/api/v1/providers/me')
      .set('Authorization', `Bearer ${token('user-1')}`)
      .send({ providerId: 'prov-victim', displayName: 'Sipho' });
    expect(res.status).toBe(422);
    expect(mockProfileUpdate).not.toHaveBeenCalled();
  });

  it('14. attempted tier modification rejected', async () => {
    for (const body of [{ tierId: 't3' }, { tier: { code: 'T3' } }]) {
      const res = await request(app)
        .patch('/api/v1/providers/me')
        .set('Authorization', `Bearer ${token('user-1')}`)
        .send(body);
      expect(res.status).toBe(422);
    }
    expect(mockProfileUpdate).not.toHaveBeenCalled();
  });

  it('15. attempted providerType modification rejected', async () => {
    const res = await request(app)
      .patch('/api/v1/providers/me')
      .set('Authorization', `Bearer ${token('user-1')}`)
      .send({ providerType: 'BUSINESS' });
    expect(res.status).toBe(422);
    expect(mockProfileUpdate).not.toHaveBeenCalled();
  });

  it('16. attempted verification modification rejected', async () => {
    const res = await request(app)
      .patch('/api/v1/providers/me')
      .set('Authorization', `Bearer ${token('user-1')}`)
      .send({ verificationStatus: 'VERIFIED' });
    expect(res.status).toBe(422);
    expect(mockProfileUpdate).not.toHaveBeenCalled();
  });

  it('17. attempted Student modification rejected', async () => {
    for (const body of [{ isStudent: true }, { studentVerificationStatus: 'VERIFIED' }]) {
      const res = await request(app)
        .patch('/api/v1/providers/me')
        .set('Authorization', `Bearer ${token('user-1')}`)
        .send(body);
      expect(res.status).toBe(422);
    }
    expect(mockProfileUpdate).not.toHaveBeenCalled();
  });

  it('18. attempted commission modification rejected', async () => {
    for (const body of [{ commission: 5 }, { commissionRate: 5 }, { commissionAmount: 5 }]) {
      const res = await request(app)
        .patch('/api/v1/providers/me')
        .set('Authorization', `Bearer ${token('user-1')}`)
        .send(body);
      expect(res.status).toBe(422);
    }
    expect(mockProfileUpdate).not.toHaveBeenCalled();
  });

  it('19. attempted cash-cap / acceptCash modification rejected', async () => {
    for (const body of [{ acceptCash: false }, { cashCap: 99999 }, { outstandingCommission: 0 }]) {
      const res = await request(app)
        .patch('/api/v1/providers/me')
        .set('Authorization', `Bearer ${token('user-1')}`)
        .send(body);
      expect(res.status).toBe(422);
    }
    expect(mockProfileUpdate).not.toHaveBeenCalled();
  });

  it('20. attempted coverage-radius modification rejected (coverage endpoint owns it)', async () => {
    const res = await request(app)
      .patch('/api/v1/providers/me')
      .set('Authorization', `Bearer ${token('user-1')}`)
      .send({ coverageRadiusKm: 20 });
    expect(res.status).toBe(422);
    expect(mockProfileUpdate).not.toHaveBeenCalled();
  });

  it('role escalation and timestamp manipulation rejected', async () => {
    for (const body of [
      { role: 'ADMIN' },
      { roles: ['ADMIN'] },
      { status: 'SUSPENDED' },
      { createdAt: '2020-01-01' },
      { id: 'prov-other' },
    ]) {
      const res = await request(app)
        .patch('/api/v1/providers/me')
        .set('Authorization', `Bearer ${token('user-1')}`)
        .send(body);
      expect(res.status).toBe(422);
    }
    expect(mockProfileUpdate).not.toHaveBeenCalled();
  });

  it('missing profile on PATCH returns 404', async () => {
    mockProfileFindUnique.mockResolvedValue(null);
    const res = await request(app)
      .patch('/api/v1/providers/me')
      .set('Authorization', `Bearer ${token('user-9')}`)
      .send({ displayName: 'Sipho' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('PROVIDER_NOT_FOUND');
  });
});

describe('Slice 10 — audit & error hygiene', () => {
  it('21. audit log records actor, entity, action, before/after, ip, user agent', async () => {
    await request(app)
      .patch('/api/v1/providers/me')
      .set('Authorization', `Bearer ${token('user-1')}`)
      .set('User-Agent', 'slice10-test-agent')
      .send({ displayName: 'Sipho Deluxe' });
    expect(mockAuditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          actorUserId: 'user-1',
          action: 'PROVIDER_PROFILE_UPDATED',
          entityType: 'provider_profile',
          entityId: 'prov-1',
        }),
      }),
    );
    const payload = mockAuditCreate.mock.calls[0][0].data;
    expect(payload.beforeJson.displayName).toBe('Sipho Cuts');
    expect(payload.afterJson.displayName).toBe('Sipho Deluxe');
    expect(payload.ipAddress).toBeDefined();
    expect(payload.userAgent).toContain('slice10-test-agent');
  });

  it('22. sanitized server error never leaks internals', async () => {
    mockProfileUpdate.mockRejectedValueOnce(new Error('prisma exploded: SECRET=abc, stack trace...'));
    // getOwnProfile succeeds first (findUnique), update throws -> service propagates null->404 or 500
    mockProfileFindUnique.mockResolvedValueOnce(profileRow());
    const res = await request(app)
      .patch('/api/v1/providers/me')
      .set('Authorization', `Bearer ${token('user-1')}`)
      .send({ displayName: 'Sipho' });
    expect([404, 500]).toContain(res.status);
    expect(JSON.stringify(res.body)).not.toContain('SECRET');
    expect(JSON.stringify(res.body)).not.toContain('stack trace');
    expect(JSON.stringify(res.body)).not.toContain('prisma exploded');
  });

  it('API shape { success, data, error } holds on success and failure', async () => {
    const ok = await request(app).get('/api/v1/providers/me').set('Authorization', `Bearer ${token('user-1')}`);
    expect(ok.body).toHaveProperty('success', true);
    expect(ok.body).toHaveProperty('data');

    const bad = await request(app).get('/api/v1/providers/me');
    expect(bad.body).toHaveProperty('success', false);
    expect(bad.body).toHaveProperty('error');
  });

  it('no hard-coded financial rules in the profile path', async () => {
    const res = await request(app)
      .patch('/api/v1/providers/me')
      .set('Authorization', `Bearer ${token('user-1')}`)
      .send({ displayName: 'Sipho' });
    expect(res.status).toBe(200);
    // Commission/caps are never derived here: update payload carries editable fields only.
    const data = mockProfileUpdate.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('commissionRate');
    expect(data).not.toHaveProperty('commissionAmount');
    expect(data).not.toHaveProperty('cashCap');
  });
});

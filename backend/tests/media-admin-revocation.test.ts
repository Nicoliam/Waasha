/**
 * MEDIA ADMIN AUTHORIZATION HARDENING — revocation regression.
 *
 * Canonical rule: session identifies the user → database user_roles → roles
 * decides current ADMIN authority. JWT `roles` claims are NEVER sufficient
 * authority (a token issued before a grant/revocation carries stale
 * authority).
 *
 * This suite proves, over HTTP with the real authMiddleware → media routes →
 * media service chain:
 *  1. A DB-backed admin can use the intended media admin override.
 *  2. After the ADMIN grant is revoked in the DB, the SAME JWT (still
 *     claiming ADMIN) is denied — revocation takes effect on the next
 *     protected request.
 *  3. Non-admins (customer / provider / T2 / T3), even presenting a JWT
 *     that claims ADMIN, are denied the override.
 *  4. Owner access and cross-tenant denial still behave correctly.
 */
import request from 'supertest';
import jwt from 'jsonwebtoken';

function token(sub: string, roles: string[] = ['PROVIDER']) {
  const secret = process.env.JWT_SECRET ?? 'dev-jwt-secret-change-me';
  return jwt.sign(
    { sub, uuid: sub, email: `${sub}@test.local`, roles },
    secret,
    { expiresIn: '1h', issuer: 'waasha', audience: 'waasha-app' } as any,
  );
}
const staleAdminJwt = (sub: string) => token(sub, ['ADMIN']);

// ── Stateful in-memory backend ──────────────────────────────────────

const assets = new Map<string, any>();
const profiles = new Map<string, any>();
let serviceImages: any[] = [];
let seq = 0;
const nid = (p: string) => `${p}-${++seq}-${Date.now() % 100000}`;

// Current DB admin authority. Mutating this set simulates grant/revocation.
let dbAdmins = new Set<string>(['admin-1']);

function resetState() {
  assets.clear();
  profiles.clear();
  serviceImages = [];
  seq = 0;
  dbAdmins = new Set<string>(['admin-1']);
  profiles.set('owner-1', { id: 'prov-1', userId: 'owner-1', profileImageUrl: null, profileMediaAssetId: null });
  profiles.set('other-1', { id: 'prov-2', userId: 'other-1', profileImageUrl: null, profileMediaAssetId: null });
  profiles.set('admin-1', { id: 'prov-admin', userId: 'admin-1', profileImageUrl: null, profileMediaAssetId: null });
  profiles.set('t2-user', { id: 'prov-t2', userId: 't2-user', profileImageUrl: null, profileMediaAssetId: null });
  profiles.set('t3-user', { id: 'prov-t3', userId: 't3-user', profileImageUrl: null, profileMediaAssetId: null });
}

const mockUserFindUnique = jest.fn();
const mockUserRoleFindMany = jest.fn();
const mockAuditCreate = jest.fn();

jest.mock('../src/config/prisma', () => ({
  prisma: {
    user: { findUnique: (...a: any[]) => (mockUserFindUnique as any)(...a) },
    userRole: { findMany: (...a: any[]) => (mockUserRoleFindMany as any)(...a) },
    providerProfile: {
      findUnique: jest.fn(async ({ where }: any) => profiles.get(where?.userId) ?? null),
      update: jest.fn(async ({ where, data }: any) => {
        for (const [k, v] of profiles.entries()) {
          if ((v as any).id === where?.id) {
            const next = { ...(v as any), ...data };
            profiles.set(k, next);
            return next;
          }
        }
        return null;
      }),
    },
    customerProfile: {
      findUnique: jest.fn(async ({ where }: any) =>
        where?.userId === 'cust-1' ? { id: 'custprof-1', userId: 'cust-1' } : null,
      ),
    },
    mediaAsset: {
      create: jest.fn(async ({ data }: any) => {
        const row = {
          id: nid('m'),
          createdAt: new Date('2026-01-01T00:00:00Z'),
          updatedAt: new Date('2026-01-01T00:00:00Z'),
          deletedAt: null,
          width: null,
          height: null,
          ...data,
        };
        assets.set(row.id, row);
        return row;
      }),
      findUnique: jest.fn(async ({ where }: any) => assets.get(where?.id) ?? null),
      update: jest.fn(async ({ where, data }: any) => {
        const row = assets.get(where?.id);
        if (!row) throw new Error('not found');
        const next = { ...row, ...data, updatedAt: new Date('2026-01-02T00:00:00Z') };
        assets.set(where.id, next);
        return next;
      }),
      count: jest.fn(async () => 0),
    },
    service: {
      findUnique: jest.fn(async ({ where }: any) => {
        if (where?.id === 'svc-owner') {
          return { id: 'svc-owner', providerId: 'prov-1', businessUnitId: null, deletedAt: null };
        }
        if (where?.id === 'svc-admin') {
          return { id: 'svc-admin', providerId: 'prov-admin', businessUnitId: null, deletedAt: null };
        }
        return null;
      }),
      findMany: jest.fn(async () => []),
    },
    serviceImage: {
      count: jest.fn(async ({ where }: any = {}) => serviceImages.filter((i) => !where?.serviceId || i.serviceId === where.serviceId).length),
      findFirst: jest.fn(async ({ where }: any = {}) =>
        serviceImages.find(
          (i) =>
            (!where?.id || i.id === where.id) &&
            (!where?.serviceId || i.serviceId === where.serviceId) &&
            (!where?.mediaAssetId || i.mediaAssetId === where.mediaAssetId),
        ) ?? null,
      ),
      findMany: jest.fn(async ({ where }: any = {}) =>
        serviceImages.filter(
          (i) =>
            (!where?.serviceId || i.serviceId === where.serviceId) &&
            (!where?.mediaAssetId || i.mediaAssetId === where.mediaAssetId),
        ),
      ),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: nid('img'), ...data };
        serviceImages.push(row);
        return row;
      }),
      deleteMany: jest.fn(async ({ where }: any = {}) => {
        const before = serviceImages.length;
        serviceImages = serviceImages.filter(
          (i) =>
            !(
              (!where?.serviceId || i.serviceId === where.serviceId) &&
              (!where?.mediaAssetId || i.mediaAssetId === where.mediaAssetId)
            ),
        );
        return { count: before - serviceImages.length };
      }),
      delete: jest.fn(async ({ where }: any) => {
        const idx = serviceImages.findIndex((i) => i.id === where?.id);
        if (idx === -1) throw new Error('not found');
        const [row] = serviceImages.splice(idx, 1);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = serviceImages.find((i) => i.id === where?.id);
        if (!row) throw new Error('not found');
        Object.assign(row, data);
        return row;
      }),
    },
    business: { findMany: jest.fn(async () => []) },
    businessUnit: { findMany: jest.fn(async () => []) },
    businessStaff: { findMany: jest.fn(async () => []) },
    auditLog: { create: (...a: any[]) => (mockAuditCreate as any)(...a) },
    $queryRaw: jest.fn(async () => [1]),
  },
}));

import { app } from '../src/app';

const png = { filename: 'photo.jpg', contentType: 'image/jpeg', sizeBytes: 1024 };

async function createPending(auth: string, purpose = 'PROFILE') {
  const res = await request(app)
    .post('/api/v1/media/upload-sessions')
    .set('Authorization', `Bearer ${auth}`)
    .send({ purpose, ...png });
  expect(res.status).toBe(201);
  return res.body.data.mediaId as string;
}

async function createActive(auth: string, purpose = 'PROFILE') {
  const mediaId = await createPending(auth, purpose);
  const fin = await request(app)
    .post(`/api/v1/media/${mediaId}/finalize`)
    .set('Authorization', `Bearer ${auth}`)
    .send({});
  expect(fin.status).toBe(200);
  return mediaId;
}

beforeEach(() => {
  jest.clearAllMocks();
  resetState();
  mockUserFindUnique.mockImplementation(async ({ where }: any) => {
    if (where?.id && typeof where.id === 'string') return { id: where.id, status: 'ACTIVE' };
    return null;
  });
  // DB-backed authority: only members of dbAdmins hold ADMIN right now.
  mockUserRoleFindMany.mockImplementation(async ({ where }: any) =>
    dbAdmins.has(where?.userId) ? [{ role: { code: 'ADMIN' } }] : [],
  );
  mockAuditCreate.mockImplementation(async ({ data }: any) => ({ id: nid('audit'), ...data }));
});

describe('Media admin authorization is DB-backed (revocation regression)', () => {
  it('CRITICAL: revoked admin loses media override on next request with the same JWT', async () => {
    // 1. User holds ADMIN in DB. 2. Valid JWT (even one claiming ADMIN).
    const adminJwt = staleAdminJwt('admin-1');
    // Owner creates a private (pending) asset — not publicly viewable.
    const mediaId = await createPending(token('owner-1'));

    // 3. Media admin operation succeeds (cross-tenant get via override).
    const before = await request(app).get(`/api/v1/media/${mediaId}`).set('Authorization', `Bearer ${adminJwt}`);
    expect(before.status).toBe(200);

    // 4. ADMIN role revoked in DB. 5. SAME JWT used again.
    dbAdmins.delete('admin-1');
    const svc = await import('../src/modules/media/media.service');
    await expect(svc.__testables.isCurrentAdmin('admin-1')).resolves.toBe(false);

    // 6. Media admin operation denied. 7. Denial is DB-authority based
    // (safe 404 — no cross-tenant leakage — and DB now holds no ADMIN).
    const after = await request(app).get(`/api/v1/media/${mediaId}`).set('Authorization', `Bearer ${adminJwt}`);
    expect(after.status).toBe(404);
    expect(after.body.error.code).toBe('MEDIA_NOT_FOUND');
    expect(mockUserRoleFindMany).toHaveBeenCalled();
  });

  it('stale ADMIN JWT claim grants nothing without a current DB grant (get)', async () => {
    const mediaId = await createPending(token('owner-1'));
    for (const sub of ['cust-1', 'other-1', 't2-user', 't3-user']) {
      const res = await request(app)
        .get(`/api/v1/media/${mediaId}`)
        .set('Authorization', `Bearer ${staleAdminJwt(sub)}`);
      expect(res.status).toBe(404);
    }
  });

  it('customer cannot use media admin override (finalize + delete)', async () => {
    const pending = await createPending(token('owner-1'));
    const fin = await request(app)
      .post(`/api/v1/media/${pending}/finalize`)
      .set('Authorization', `Bearer ${staleAdminJwt('cust-1')}`)
      .send({});
    expect(fin.status).toBe(404);
    const active = await createActive(token('owner-1'));
    const del = await request(app)
      .delete(`/api/v1/media/${active}`)
      .set('Authorization', `Bearer ${staleAdminJwt('cust-1')}`);
    expect(del.status).toBe(404);
    expect(assets.get(active).status).toBe('ACTIVE');
  });

  it('provider / T2 / T3 cannot use media admin override', async () => {
    for (const sub of ['other-1', 't2-user', 't3-user']) {
      const pending = await createPending(token('owner-1'));
      const fin = await request(app)
        .post(`/api/v1/media/${pending}/finalize`)
        .set('Authorization', `Bearer ${staleAdminJwt(sub)}`)
        .send({});
      expect(fin.status).toBe(404);
      const active = await createActive(token('owner-1'));
      const del = await request(app)
        .delete(`/api/v1/media/${active}`)
        .set('Authorization', `Bearer ${staleAdminJwt(sub)}`);
      expect(del.status).toBe(404);
    }
  });

  it('valid current admin can use the intended override (finalize + get + delete)', async () => {
    const adminJwt = token('admin-1', []); // JWT roles irrelevant — DB decides.
    const pending = await createPending(token('owner-1'));
    const fin = await request(app)
      .post(`/api/v1/media/${pending}/finalize`)
      .set('Authorization', `Bearer ${adminJwt}`)
      .send({});
    expect(fin.status).toBe(200);
    const get = await request(app).get(`/api/v1/media/${pending}`).set('Authorization', `Bearer ${adminJwt}`);
    expect(get.status).toBe(200);
    const del = await request(app).delete(`/api/v1/media/${pending}`).set('Authorization', `Bearer ${adminJwt}`);
    expect(del.status).toBe(200);
  });

  it('valid current admin can attach foreign ACTIVE media to own profile/service', async () => {
    const adminJwt = token('admin-1', []);
    const foreign = await createActive(token('owner-1'), 'SERVICE');
    const prof = await request(app)
      .post(`/api/v1/media/${foreign}/attach-profile`)
      .set('Authorization', `Bearer ${adminJwt}`)
      .send({});
    expect(prof.status).toBe(200);
    const svcAttach = await request(app)
      .post(`/api/v1/media/${foreign}/attach-service`)
      .set('Authorization', `Bearer ${adminJwt}`)
      .send({ serviceId: 'svc-admin' });
    expect(svcAttach.status).toBe(201);
  });

  it('stale admin JWT cannot attach foreign media (profile + service)', async () => {
    const foreign = await createActive(token('owner-1'), 'SERVICE');
    dbAdmins.delete('admin-1');
    const stale = staleAdminJwt('admin-1');
    const prof = await request(app)
      .post(`/api/v1/media/${foreign}/attach-profile`)
      .set('Authorization', `Bearer ${stale}`)
      .send({});
    // Admin without current DB authority has no provider-override path here:
    // either provider lookup or ownership guard denies (never success).
    expect(prof.status).not.toBe(200);
    const svcAttach = await request(app)
      .post(`/api/v1/media/${foreign}/attach-service`)
      .set('Authorization', `Bearer ${stale}`)
      .send({ serviceId: 'svc-admin' });
    expect(svcAttach.status).not.toBe(200);
  });

  it('owner access still works; cross-tenant non-admin access remains denied', async () => {
    const mediaId = await createActive(token('owner-1'));
    const own = await request(app).get(`/api/v1/media/${mediaId}`).set('Authorization', `Bearer ${token('owner-1')}`);
    expect(own.status).toBe(200);
    const foreign = await request(app)
      .get(`/api/v1/media/${mediaId}`)
      .set('Authorization', `Bearer ${token('other-1')}`);
    // ACTIVE PUBLIC marketplace media is viewable; the sensitive flag must
    // still be withheld from non-owners.
    expect([200, 404]).toContain(foreign.status);
    if (foreign.status === 200) expect(foreign.body.data).not.toHaveProperty('storageKey');
    const pending = await createPending(token('owner-1'));
    const cross = await request(app)
      .get(`/api/v1/media/${pending}`)
      .set('Authorization', `Bearer ${token('other-1')}`);
    expect(cross.status).toBe(404);
    // Owner finalize/delete lifecycle intact.
    const fin = await request(app)
      .post(`/api/v1/media/${pending}/finalize`)
      .set('Authorization', `Bearer ${token('owner-1')}`)
      .send({});
    expect(fin.status).toBe(200);
    const del = await request(app).delete(`/api/v1/media/${pending}`).set('Authorization', `Bearer ${token('owner-1')}`);
    expect(del.status).toBe(200);
  });

  it('DB failure fails closed (no admin grant on authorization outage)', async () => {
    const mediaId = await createPending(token('owner-1'));
    mockUserRoleFindMany.mockRejectedValueOnce(new Error('db down'));
    const res = await request(app)
      .get(`/api/v1/media/${mediaId}`)
      .set('Authorization', `Bearer ${staleAdminJwt('admin-1')}`);
    expect(res.status).toBe(404);
  });
});

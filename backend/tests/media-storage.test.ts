/**
 * Phase 2 Slice 11 — Media & file storage infrastructure.
 *
 * Validates the production-grade media foundation over HTTP (supertest):
 * session ownership, tenant isolation, server-side file validation,
 * traversal/bucket attacks, safe upload lifecycle (PENDING→ACTIVE),
 * idempotent finalization, profile/service attachment, 3-image limits,
 * safe deletion, auditability, sanitized errors, web/mobile contract
 * parity, offline safety, retry behaviour, and no-vendor/no-secret rules.
 */
import * as fs from 'fs';
import * as path from 'path';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { of } from 'rxjs';

function token(sub: string, roles: string[] = ['PROVIDER']) {
  const secret = process.env.JWT_SECRET ?? 'dev-jwt-secret-change-me';
  return jwt.sign(
    { sub, uuid: sub, email: `${sub}@test.local`, roles },
    secret,
    { expiresIn: '1h', issuer: 'waasha', audience: 'waasha-app' } as any,
  );
}

// ── Stateful in-memory backend ──────────────────────────────────────

const assets = new Map<string, any>();
const profiles = new Map<string, any>();
let serviceImages: any[] = [];
let seq = 0;
const nid = (p: string) => `${p}-${++seq}-${Date.now() % 100000}`;
const auditCalls: any[] = [];

function resetState() {
  assets.clear();
  profiles.clear();
  serviceImages = [];
  seq = 0;
  auditCalls.length = 0;
  profiles.set('user-1', { id: 'prov-1', userId: 'user-1', profileImageUrl: null, profileMediaAssetId: null });
  profiles.set('user-2', { id: 'prov-2', userId: 'user-2', profileImageUrl: null, profileMediaAssetId: null });
}

const mockUserFindUnique = jest.fn();
const mockAuditCreate = jest.fn();

jest.mock('../src/config/prisma', () => ({
  prisma: {
    user: { findUnique: mockUserFindUnique },
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
      count: jest.fn(async ({ where }: any = {}) => {
        let rows = [...assets.values()];
        if (where?.ownerType) rows = rows.filter((r) => r.ownerType === where.ownerType);
        if (where?.ownerId) rows = rows.filter((r) => r.ownerId === where.ownerId);
        if (where?.purpose) rows = rows.filter((r) => r.purpose === where.purpose);
        if (where?.targetId) rows = rows.filter((r) => r.targetId === where.targetId);
        if (where?.status && typeof where.status === 'object' && where.status.not) {
          rows = rows.filter((r) => r.status !== where.status.not);
        }
        return rows.length;
      }),
    },
    service: {
      findUnique: jest.fn(async ({ where }: any) => {
        if (where?.id === 'svc-1') {
          return { id: 'svc-1', providerId: 'prov-1', businessUnitId: null, deletedAt: null };
        }
        if (where?.id === 'svc-other') {
          return { id: 'svc-2', providerId: 'prov-2', businessUnitId: null, deletedAt: null };
        }
        return null;
      }),
      findMany: jest.fn(async () => []),
      count: jest.fn(async () => 0),
      create: jest.fn(async ({ data }: any) => ({ id: nid('svc'), uuid: nid('uuid'), ...data })),
      update: jest.fn(async ({ data }: any) => ({ id: 'svc-1', ...data })),
      delete: jest.fn(async () => ({ id: 'svc-1' })),
    },
    serviceCategory: {
      findUnique: jest.fn(async ({ where }: any) =>
        where?.id === 'c1' || where?.code === 'BARBERS'
          ? { id: 'c1', code: 'BARBERS', name: 'Barbers', isActive: true }
          : null,
      ),
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
        serviceImages
          .filter(
            (i) =>
              (!where?.serviceId || i.serviceId === where.serviceId) &&
              (!where?.mediaAssetId || i.mediaAssetId === where.mediaAssetId),
          )
          .sort((a, b) => a.sortOrder - b.sortOrder),
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
    booking: { count: jest.fn(async () => 0), findFirst: jest.fn(async () => null) },
    auditLog: { create: mockAuditCreate },
    $queryRaw: jest.fn(async () => [1]),
  },
}));

import { app } from '../src/app';

const png = { filename: 'photo.jpg', contentType: 'image/jpeg', sizeBytes: 1024 };

async function createSession(auth: string, body: Record<string, unknown> = {}) {
  return request(app)
    .post('/api/v1/media/upload-sessions')
    .set('Authorization', `Bearer ${auth}`)
    .send({ purpose: 'PROFILE', ...png, ...body });
}

async function createActiveAsset(auth: string, purpose = 'PROFILE', extra: Record<string, unknown> = {}) {
  const session = await createSession(auth, { purpose, ...extra });
  expect(session.status).toBe(201);
  const mediaId = session.body.data.mediaId as string;
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
  mockAuditCreate.mockImplementation(async ({ data }: any) => {
    auditCalls.push(data);
    return { id: nid('audit'), ...data };
  });
});

// ── Authentication / ownership ──────────────────────────────────────

describe('Slice 11 — auth & ownership', () => {
  it('1. authenticated upload-session creation succeeds', async () => {
    const res = await createSession(token('user-1'));
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.mediaId).toBeTruthy();
    expect(res.body.data.status).toBe('PENDING_UPLOAD');
    expect(res.body.data.viewUrl).toBeNull();
    expect(res.body.data.upload.uploadMethod).toBe('PUT');
    expect(res.body.data.upload.uploadUrl).toBeTruthy();
    expect(res.body.data.upload.expiresAt).toBeTruthy();
  });

  it('2. unauthenticated upload-session rejected', async () => {
    const res = await request(app).post('/api/v1/media/upload-sessions').send({ purpose: 'PROFILE', ...png });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('3. provider ownership derived from session', async () => {
    const res = await createSession(token('user-1'));
    const row = assets.get(res.body.data.mediaId);
    expect(row.ownerType).toBe('PROVIDER');
    expect(row.ownerId).toBe('prov-1');
    expect(row.createdBy).toBe('user-1');
  });

  it('4. tenant isolation: foreign asset invisible (safe 404)', async () => {
    const mediaId = await createActiveAsset(token('user-1'));
    const fin = await request(app)
      .post(`/api/v1/media/${mediaId}/finalize`)
      .set('Authorization', `Bearer ${token('user-2')}`)
      .send({});
    expect(fin.status).toBe(404);
    expect(fin.body.error.code).toBe('MEDIA_NOT_FOUND');
    const get = await request(app).get(`/api/v1/media/${mediaId}`).set('Authorization', `Bearer ${token('user-2')}`);
    // Public ACTIVE marketplace media is viewable; private/pending is not.
    expect([200, 404]).toContain(get.status);
  });

  it('5. service ownership enforced on session target', async () => {
    const res = await createSession(token('user-1'), { purpose: 'SERVICE', targetId: 'svc-other' });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('SERVICE_NOT_FOUND');
    const ok = await createSession(token('user-1'), { purpose: 'SERVICE', targetId: 'svc-1' });
    expect(ok.status).toBe(201);
  });

  it('6. customer ownership: customers create custom-request sessions; providers without customer profile cannot', async () => {
    const ok = await createSession(token('cust-1', ['CUSTOMER']), { purpose: 'CUSTOM_REQUEST', filename: 'ref.jpg' });
    expect(ok.status).toBe(201);
    expect(assets.get(ok.body.data.mediaId).ownerType).toBe('CUSTOMER');
    const denied = await createSession(token('user-1'), { purpose: 'CUSTOM_REQUEST', filename: 'ref.jpg' });
    expect(denied.status).toBe(404);
    expect(denied.body.error.code).toBe('CUSTOMER_NOT_FOUND');
  });

  it('13. unauthorized media access rejected (no token)', async () => {
    const mediaId = await createActiveAsset(token('user-1'));
    const res = await request(app).get(`/api/v1/media/${mediaId}`);
    expect(res.status).toBe(401);
  });
});

// ── File validation ─────────────────────────────────────────────────

describe('Slice 11 — server-side file validation', () => {
  it('7. invalid MIME type rejected', async () => {
    const res = await createSession(token('user-1'), { contentType: 'application/x-sh', filename: 'run.sh' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('INVALID_MIME_TYPE');
  });

  it('7b. executable upload rejected', async () => {
    const res = await createSession(token('user-1'), { contentType: 'text/html', filename: 'page.html' });
    expect(res.status).toBe(422);
  });

  it('8. extension/content mismatch rejected', async () => {
    const res = await createSession(token('user-1'), { contentType: 'image/jpeg', filename: 'photo.png' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('CONTENT_MISMATCH');
  });

  it('9. file-size limit enforced', async () => {
    const res = await createSession(token('user-1'), { purpose: 'SERVICE', filename: 'big.jpg', sizeBytes: 20 * 1024 * 1024 });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('FILE_TOO_LARGE');
  });

  it('10. filename validation rejects traversal', async () => {
    for (const filename of ['../../etc/passwd.jpg', '/abs/path.jpg', 'C:\\win.jpg']) {
      const res = await createSession(token('user-1'), { filename });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('INVALID_FILENAME');
    }
    // Overlong names rejected at the contract boundary (422 either way).
    const long = await createSession(token('user-1'), { filename: 'a'.repeat(300) + '.jpg' });
    expect(long.status).toBe(422);
  });

  it('11. object-key traversal attack rejected', async () => {
    const before = assets.size;
    const res = await createSession(token('user-1'), { storageKey: '../../evil', filename: 'photo.jpg' } as any);
    expect(res.status).toBe(422);
    expect(['INVALID_STORAGE_KEY', 'VALIDATION_ERROR']).toContain(res.body.error.code);
    expect(assets.size).toBe(before);
    // Service-level control fires with the precise code when reached directly.
    const svc = await import('../src/modules/media/media.service');
    await expect(
      svc.createUploadSession('user-1', { purpose: 'PROFILE', filename: 'photo.jpg', contentType: 'image/jpeg', sizeBytes: 10, storageKey: '../../evil' }),
    ).rejects.toMatchObject({ code: 'INVALID_STORAGE_KEY' });
  });

  it('12. arbitrary bucket/key attack rejected', async () => {
    const before = assets.size;
    const res = await createSession(token('user-1'), { bucket: 'other-bucket', objectKey: 'waasha/private/x', filename: 'photo.jpg' } as any);
    expect(res.status).toBe(422);
    expect(['INVALID_STORAGE_KEY', 'VALIDATION_ERROR']).toContain(res.body.error.code);
    expect(assets.size).toBe(before);
    const svc = await import('../src/modules/media/media.service');
    await expect(
      svc.createUploadSession('user-1', { purpose: 'PROFILE', filename: 'photo.jpg', contentType: 'image/jpeg', sizeBytes: 10, bucket: 'other-bucket' }),
    ).rejects.toMatchObject({ code: 'INVALID_STORAGE_KEY' });
  });
});

// ── Upload lifecycle ────────────────────────────────────────────────

describe('Slice 11 — upload lifecycle', () => {
  it('14. upload session creation returns controlled target without internal keys', async () => {
    const res = await createSession(token('user-1'));
    const data = res.body.data;
    expect(data.upload.uploadUrl).toBeTruthy();
    expect(data).not.toHaveProperty('storageKey');
    expect(data).not.toHaveProperty('checksum');
    expect(data).not.toHaveProperty('ownerId');
    expect(JSON.stringify(data)).not.toMatch(/secret|accesskey|password|credential/i);
  });

  it('15. incomplete upload is never active', async () => {
    const session = await createSession(token('user-1'));
    const mediaId = session.body.data.mediaId as string;
    const get = await request(app).get(`/api/v1/media/${mediaId}`).set('Authorization', `Bearer ${token('user-1')}`);
    expect(get.status).toBe(200);
    expect(get.body.data.status).toBe('PENDING_UPLOAD');
    expect(get.body.data.viewUrl).toBeNull();
    const attach = await request(app)
      .post(`/api/v1/media/${mediaId}/attach-profile`)
      .set('Authorization', `Bearer ${token('user-1')}`)
      .send({});
    expect(attach.status).toBe(422);
    expect(attach.body.error.code).toBe('MEDIA_NOT_READY');
  });

  it('16. successful finalization promotes to ACTIVE with view URL', async () => {
    const session = await createSession(token('user-1'));
    const mediaId = session.body.data.mediaId as string;
    const fin = await request(app)
      .post(`/api/v1/media/${mediaId}/finalize`)
      .set('Authorization', `Bearer ${token('user-1')}`)
      .send({ sizeBytes: 1024, detectedMimeType: 'image/jpeg', width: 800, height: 600 });
    expect(fin.status).toBe(200);
    expect(fin.body.data.status).toBe('ACTIVE');
    // Server-generated namespaced key — never the raw client filename.
    expect(fin.body.data.viewUrl).toContain('waasha/public/providers/prov-1');
    expect(fin.body.data.viewUrl).toContain('.jpg');
  });

  it('17. repeated finalization is idempotent', async () => {
    const mediaId = await createActiveAsset(token('user-1'));
    const again = await request(app)
      .post(`/api/v1/media/${mediaId}/finalize`)
      .set('Authorization', `Bearer ${token('user-1')}`)
      .send({});
    expect(again.status).toBe(200);
    expect(again.body.data.status).toBe('ACTIVE');
    expect(again.body.data.idempotentReplay).toBe(true);
    expect(assets.get(mediaId).status).toBe('ACTIVE');
  });

  it('18. failed finalization marks FAILED and allows safe retry', async () => {
    const session = await createSession(token('user-1'));
    const mediaId = session.body.data.mediaId as string;
    const bad = await request(app)
      .post(`/api/v1/media/${mediaId}/finalize`)
      .set('Authorization', `Bearer ${token('user-1')}`)
      .send({ sizeBytes: 999 });
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('INTEGRITY_MISMATCH');
    expect(assets.get(mediaId).status).toBe('FAILED');
    const retry = await request(app)
      .post(`/api/v1/media/${mediaId}/finalize`)
      .set('Authorization', `Bearer ${token('user-1')}`)
      .send({ sizeBytes: 1024 });
    expect(retry.status).toBe(200);
    expect(retry.body.data.status).toBe('ACTIVE');
  });

  it('19. media status transitions are audited', async () => {
    const mediaId = await createActiveAsset(token('user-1'));
    const actions = auditCalls.filter((a) => a.entityId === mediaId).map((a) => a.action);
    expect(actions).toContain('MEDIA_UPLOAD_SESSION_CREATED');
    expect(actions).toContain('MEDIA_FINALIZED');
    expect(assets.get(mediaId).status).toBe('ACTIVE');
  });

  it('30. audit events recorded for attach/delete', async () => {
    const mediaId = await createActiveAsset(token('user-1'));
    await request(app).post(`/api/v1/media/${mediaId}/attach-profile`).set('Authorization', `Bearer ${token('user-1')}`).send({});
    await request(app).delete(`/api/v1/media/${mediaId}`).set('Authorization', `Bearer ${token('user-1')}`);
    const actions = auditCalls.filter((a) => a.entityId === mediaId).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(['MEDIA_ATTACHED', 'MEDIA_DELETED']));
  });

  it('31. server errors are sanitized (no stack/SQL leak)', async () => {
    const prismaMod = jest.requireMock('../src/config/prisma') as any;
    prismaMod.prisma.mediaAsset.create.mockRejectedValueOnce(new Error('connect ECONNREFUSED sql: SELECT * FROM x'));
    const res = await createSession(token('user-1'));
    expect(res.status).toBe(500);
    expect(res.body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(res.body)).not.toMatch(/ECONNREFUSED|SELECT|at Object|node_modules/);
  });
});

// ── Attachment: profile & service ───────────────────────────────────

describe('Slice 11 — profile/service attachment', () => {
  it('20. profile image attachment links finalized media', async () => {
    const mediaId = await createActiveAsset(token('user-1'));
    const res = await request(app)
      .post(`/api/v1/media/${mediaId}/attach-profile`)
      .set('Authorization', `Bearer ${token('user-1')}`)
      .send({});
    expect(res.status).toBe(200);
    expect(res.body.data.profileImageUrl).toBeTruthy();
    expect(profiles.get('user-1').profileMediaAssetId).toBe(mediaId);
    // Slice 10 profile page keeps working and exposes the new image.
    const me = await request(app).get('/api/v1/providers/me').set('Authorization', `Bearer ${token('user-1')}`);
    expect(me.status).toBe(200);
    expect(me.body.data.profileImageUrl).toBe(res.body.data.profileImageUrl);
  });

  it('20b. PATCH profile with profileMediaAssetId resolves owned media', async () => {
    const mediaId = await createActiveAsset(token('user-1'));
    const res = await request(app)
      .patch('/api/v1/providers/me')
      .set('Authorization', `Bearer ${token('user-1')}`)
      .send({ profileMediaAssetId: mediaId });
    expect(res.status).toBe(200);
    expect(res.body.data.profileImageUrl).toBeTruthy();
  });

  it('20c. PATCH profile with foreign mediaAssetId is safely rejected', async () => {
    const mediaId = await createActiveAsset(token('user-2'));
    const res = await request(app)
      .patch('/api/v1/providers/me')
      .set('Authorization', `Bearer ${token('user-1')}`)
      .send({ profileMediaAssetId: mediaId });
    expect(res.status).toBe(404);
  });

  it('21. service image attachment links owned media', async () => {
    const mediaId = await createActiveAsset(token('user-1'), 'SERVICE', { targetId: 'svc-1' });
    const res = await request(app)
      .post(`/api/v1/media/${mediaId}/attach-service`)
      .set('Authorization', `Bearer ${token('user-1')}`)
      .send({ serviceId: 'svc-1' });
    expect(res.status).toBe(201);
    expect(res.body.data.imageUrl).toBeTruthy();
    expect(serviceImages).toHaveLength(1);
    expect(serviceImages[0].mediaAssetId).toBe(mediaId);
  });

  it('21b. service create accepts { mediaId } entries for owned ACTIVE media', async () => {
    const mediaId = await createActiveAsset(token('user-1'), 'SERVICE');
    const prismaMod = jest.requireMock('../src/config/prisma') as any;
    prismaMod.prisma.serviceCategory = { findUnique: jest.fn(async () => ({ id: 'c1', code: 'BARBERS', name: 'Barbers', isActive: true })) };
    prismaMod.prisma.service.create.mockResolvedValueOnce({ id: 'svc-new', uuid: 'u', price: 100, currency: 'ZAR' });
    prismaMod.prisma.service.findUnique.mockResolvedValueOnce({
      id: 'svc-new', uuid: 'u', name: 'Fade', price: 100, currency: 'ZAR', durationMinutes: 30,
      serviceMode: 'BOTH', status: 'ACTIVE', serviceCategoryId: 'c1', providerId: 'prov-1',
      businessUnitId: null, createdAt: new Date(), updatedAt: new Date(),
      category: { id: 'c1', code: 'BARBERS', name: 'Barbers' }, images: [],
    });
    const res = await request(app)
      .post('/api/v1/providers/me/services')
      .set('Authorization', `Bearer ${token('user-1')}`)
      .send({
        name: 'Fade', serviceCategoryId: 'c1', price: 100, currency: 'ZAR',
        durationMinutes: 30, serviceMode: 'BOTH', images: [{ mediaId }],
      });
    expect(res.status).toBe(201);
    const created = serviceImages.find((i) => i.serviceId === 'svc-new');
    expect(created?.mediaAssetId).toBe(mediaId);
  });

  it('21c. foreign mediaId in service images safely rejected', async () => {
    const mediaId = await createActiveAsset(token('user-2'), 'SERVICE');
    const prismaMod = jest.requireMock('../src/config/prisma') as any;
    prismaMod.prisma.serviceCategory = { findUnique: jest.fn(async () => ({ id: 'c1', code: 'BARBERS', name: 'Barbers', isActive: true })) };
    const res = await request(app)
      .post('/api/v1/providers/me/services')
      .set('Authorization', `Bearer ${token('user-1')}`)
      .send({
        name: 'Fade', serviceCategoryId: 'c1', price: 100, currency: 'ZAR',
        durationMinutes: 30, serviceMode: 'BOTH', images: [{ mediaId }],
      });
    expect(res.status).toBe(404);
  });

  it('22. maximum 3 service images enforced on attach', async () => {
    serviceImages = [0, 1, 2].map((i) => ({ id: `img-${i}`, serviceId: 'svc-1', imageUrl: `https://cdn/x${i}.jpg`, storageKey: null, mediaAssetId: null, sortOrder: i }));
    const mediaId = await createActiveAsset(token('user-1'), 'SERVICE');
    const res = await request(app)
      .post(`/api/v1/media/${mediaId}/attach-service`)
      .set('Authorization', `Bearer ${token('user-1')}`)
      .send({ serviceId: 'svc-1' });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('SERVICE_IMAGE_LIMIT');
  });

  it('23. removing a service image detaches without touching the asset', async () => {
    const mediaId = await createActiveAsset(token('user-1'), 'SERVICE');
    await request(app).post(`/api/v1/media/${mediaId}/attach-service`).set('Authorization', `Bearer ${token('user-1')}`).send({ serviceId: 'svc-1' });
    // Second image keeps ordering dense after removal.
    const second = await createActiveAsset(token('user-1'), 'SERVICE');
    await request(app).post(`/api/v1/media/${second}/attach-service`).set('Authorization', `Bearer ${token('user-1')}`).send({ serviceId: 'svc-1' });
    const imgId = serviceImages[0].id;
    const del = await request(app)
      .delete(`/api/v1/providers/me/services/svc-1/images/${imgId}`)
      .set('Authorization', `Bearer ${token('user-1')}`);
    expect(del.status).toBe(200);
    expect(del.body.data.deleted).toBe(true);
    expect(serviceImages).toHaveLength(1);
    expect(serviceImages[0].sortOrder).toBe(0);
    // Underlying media rows preserved (detachment only).
    expect(assets.get(mediaId).status).toBe('ACTIVE');
  });

  it('24. replacing profile image never deletes the newly assigned asset', async () => {
    const first = await createActiveAsset(token('user-1'));
    await request(app).post(`/api/v1/media/${first}/attach-profile`).set('Authorization', `Bearer ${token('user-1')}`).send({});
    const second = await createActiveAsset(token('user-1'));
    const res = await request(app).post(`/api/v1/media/${second}/attach-profile`).set('Authorization', `Bearer ${token('user-1')}`).send({});
    expect(res.status).toBe(200);
    expect(profiles.get('user-1').profileMediaAssetId).toBe(second);
    expect(assets.get(first).status).toBe('ACTIVE');
    expect(assets.get(second).status).toBe('ACTIVE');
  });

  it('25. historical references protected: media delete detaches but never corrupts services/bookings', async () => {
    const mediaId = await createActiveAsset(token('user-1'), 'SERVICE');
    await request(app).post(`/api/v1/media/${mediaId}/attach-service`).set('Authorization', `Bearer ${token('user-1')}`).send({ serviceId: 'svc-1' });
    const prismaMod = jest.requireMock('../src/config/prisma') as any;
    const del = await request(app).delete(`/api/v1/media/${mediaId}`).set('Authorization', `Bearer ${token('user-1')}`);
    expect(del.status).toBe(200);
    expect(serviceImages).toHaveLength(0);
    expect(assets.get(mediaId).status).toBe('DELETED');
    // Booking records never written by media deletion (snapshots preserved).
    expect(prismaMod.prisma.booking.count).not.toHaveBeenCalled();
    const actions = auditCalls.filter((a) => a.entityId === mediaId).map((a) => a.action);
    expect(actions).toContain('MEDIA_DETACHED');
  });
});

// ── Deletion authorization ──────────────────────────────────────────

describe('Slice 11 — deletion authorization', () => {
  it('26. deletion requires ownership (foreign delete → 404)', async () => {
    const mediaId = await createActiveAsset(token('user-1'));
    const res = await request(app).delete(`/api/v1/media/${mediaId}`).set('Authorization', `Bearer ${token('user-2')}`);
    expect(res.status).toBe(404);
    expect(assets.get(mediaId).status).toBe('ACTIVE');
  });

  it('27. cross-tenant deletion rejected (customer cannot delete provider media)', async () => {
    const mediaId = await createActiveAsset(token('user-1'));
    const res = await request(app).delete(`/api/v1/media/${mediaId}`).set('Authorization', `Bearer ${token('cust-1', ['CUSTOMER'])}`);
    expect(res.status).toBe(404);
    expect(assets.get(mediaId).status).toBe('ACTIVE');
  });

  it('27b. cross-tenant attach rejected (provider cannot attach another provider media)', async () => {
    const mediaId = await createActiveAsset(token('user-2'), 'SERVICE');
    const res = await request(app)
      .post(`/api/v1/media/${mediaId}/attach-service`)
      .set('Authorization', `Bearer ${token('user-1')}`)
      .send({ serviceId: 'svc-1' });
    expect(res.status).toBe(404);
  });
});

// ── Secrets / credentials ───────────────────────────────────────────

describe('Slice 11 — no secrets, no vendor lock-in', () => {
  it('28. signed upload information does not leak secrets', async () => {
    const session = await createSession(token('user-1'));
    expect(session.status).toBe(201);
    const blob = JSON.stringify(session.body);
    expect(blob).not.toMatch(/secret|accesskey|private[_-]?key|bearer |passwd|pwd|AKIA|afrihost|s3\.amazonaws/i);
    expect(session.body.data.upload.uploadUrl).not.toMatch(/secret|key=|token=|signature=/i);
  });

  it('29. no credentials in finalize/get/delete responses', async () => {
    const mediaId = await createActiveAsset(token('user-1'));
    const get = await request(app).get(`/api/v1/media/${mediaId}`).set('Authorization', `Bearer ${token('user-1')}`);
    expect(JSON.stringify(get.body)).not.toMatch(/secret|accesskey|password|credential|bearer /i);
    const del = await request(app).delete(`/api/v1/media/${mediaId}`).set('Authorization', `Bearer ${token('user-1')}`);
    expect(JSON.stringify(del.body)).not.toMatch(/secret|accesskey|password|credential/i);
  });

  it('38. no hard-coded storage provider in domain code', async () => {
    const root = path.resolve(__dirname, '../../');
    const domainFiles = [
      'backend/src/modules/media/media.service.ts',
      'backend/src/modules/media/media.routes.ts',
      'backend/src/modules/media/media.validation.ts',
      'backend/src/modules/media/media.config.ts',
      'backend/src/modules/provider/provider-services.service.ts',
      'backend/src/modules/provider/provider-profile.service.ts',
    ];
    for (const f of domainFiles) {
      const src = fs.readFileSync(path.join(root, f), 'utf8');
      expect(src).not.toMatch(/aws-sdk|@aws-sdk|afrihost|multer|S3Client|PutObjectCommand/i);
      expect(src).not.toMatch(/AKIA|secretAccessKey|accessKeyId/i);
    }
    const factory = fs.readFileSync(path.join(root, 'backend/src/infrastructure/storage/index.ts'), 'utf8');
    expect(factory).toMatch(/STORAGE_PROVIDER/);
  });

  it('39. no hard-coded credentials or buckets in new code', async () => {
    const root = path.resolve(__dirname, '../../');
    const files = [
      'backend/src/modules/media/media.service.ts',
      'backend/src/modules/media/media.routes.ts',
      'backend/src/infrastructure/storage/test-adapter.storage.ts',
      'backend/src/infrastructure/storage/storage.interface.ts',
      'backend/prisma/migrations/20260906070000_add_media_assets/migration.sql',
    ];
    for (const f of files) {
      const src = fs.readFileSync(path.join(root, f), 'utf8');
      expect(src).not.toMatch(/AKIA[0-9A-Z]{16}|secretAccessKey|BEGIN (RSA )?PRIVATE KEY|mongodb(\+srv)?:\/\/[^ ]+:[^ ]+@/i);
    }
    const envSrc = fs.readFileSync(path.join(root, 'backend/src/config/env.ts'), 'utf8');
    expect(envSrc).toMatch(/WAASHA_STORAGE_PROVIDER/);
    expect(envSrc).toMatch(/WAASHA_STORAGE_BUCKET/);
  });

  it('40. no driver functionality introduced', async () => {
    const root = path.resolve(__dirname, '../../');
    const files = [
      'backend/src/modules/media/media.service.ts',
      'backend/src/modules/media/media.routes.ts',
      'backend/src/modules/media/media.validation.ts',
      'backend/src/modules/media/media.config.ts',
      'backend/src/infrastructure/storage/test-adapter.storage.ts',
      'apps/web/src/app/core/services/media.service.ts',
      'apps/mobile/src/app/core/services/media.service.ts',
    ];
    for (const f of files) {
      const src = fs.readFileSync(path.join(root, f), 'utf8');
      expect(src.toLowerCase()).not.toMatch(/driver|ride-hail|trip_fare/);
    }
  });
});

// ── Web / mobile contract & parity ──────────────────────────────────

describe('Slice 11 — web/mobile contract & offline', () => {
  function stubHttp() {
    const calls: Array<{ method: string; url: string; body?: unknown }> = [];
    const http: any = {
      get: (url: string) => {
        calls.push({ method: 'GET', url });
        return of({ success: true, data: {} });
      },
      post: (url: string, body?: unknown) => {
        calls.push({ method: 'POST', url, body });
        return of({ success: true, data: {} });
      },
      delete: (url: string) => {
        calls.push({ method: 'DELETE', url });
        return of({ success: true, data: {} });
      },
    };
    return { http, calls };
  }

  it('32. web API contract: media verbs/paths, no ownership ids', async () => {
    const { MediaService } = await import('../../apps/web/src/app/core/services/media.service');
    const { http, calls } = stubHttp();
    const svc = new MediaService(http as any);
    const awaited = (o: any): Promise<unknown> => new Promise((resolve) => (o as any).subscribe((v: unknown) => resolve(v)));
    await awaited(svc.createUploadSession({ purpose: 'PROFILE', filename: 'a.jpg', contentType: 'image/jpeg', sizeBytes: 10 }));
    await awaited(svc.finalizeUpload('m-1', {}));
    await awaited(svc.getMedia('m-1'));
    await awaited(svc.attachProfile('m-1'));
    await awaited(svc.attachService('m-1', 'svc-1'));
    await awaited(svc.removeServiceImage('svc-1', 'img-1'));
    await awaited(svc.deleteMedia('m-1'));
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'POST /api/v1/media/upload-sessions',
      'POST /api/v1/media/m-1/finalize',
      'GET /api/v1/media/m-1',
      'POST /api/v1/media/m-1/attach-profile',
      'POST /api/v1/media/m-1/attach-service',
      'DELETE /api/v1/providers/me/services/svc-1/images/img-1',
      'DELETE /api/v1/media/m-1',
    ]);
    for (const c of calls) {
      expect(JSON.stringify(c.body ?? {})).not.toMatch(/providerId|tenantId|userId/);
    }
  });

  it('33. mobile API contract matches web', async () => {
    const web = await import('../../apps/web/src/app/core/services/media.service');
    const mobile = await import('../../apps/mobile/src/app/core/services/media.service');
    const w = stubHttp();
    const m = stubHttp();
    const ws = new web.MediaService(w.http as any);
    const ms = new mobile.MediaService(m.http as any);
    const awaited = (o: any): Promise<unknown> => new Promise((resolve) => (o as any).subscribe((v: unknown) => resolve(v)));
    await awaited(ws.createUploadSession({ purpose: 'SERVICE', filename: 'a.jpg', contentType: 'image/jpeg', sizeBytes: 10 }));
    await awaited(ms.createUploadSession({ purpose: 'SERVICE', filename: 'a.jpg', contentType: 'image/jpeg', sizeBytes: 10 }));
    await awaited(ws.attachService('m-1', 'svc-1'));
    await awaited(ms.attachService('m-1', 'svc-1'));
    expect(m.calls.map((c) => `${c.method} ${c.url}`)).toEqual(w.calls.map((c) => `${c.method} ${c.url}`));
    expect(JSON.stringify(m.calls)).toBe(JSON.stringify(w.calls));
  });

  it('34. web/mobile parity: same validation and error messages', async () => {
    const webV = await import('../../apps/web/src/app/core/services/media-upload');
    const mobileV = await import('../../apps/mobile/src/app/core/services/media-upload');
    const file = { name: 'photo.jpg', type: 'image/jpeg', size: 100 };
    expect(mobileV.validateFileForUpload(file, 'PROFILE')).toEqual(webV.validateFileForUpload(file, 'PROFILE'));
    expect(mobileV.validateFileForUpload({ name: 'x.exe', type: 'application/x-sh', size: 10 }, 'PROFILE')).toEqual(
      webV.validateFileForUpload({ name: 'x.exe', type: 'application/x-sh', size: 10 }, 'PROFILE'),
    );
    expect(mobileV.validateFileForUpload({ name: 'big.jpg', type: 'image/jpeg', size: 99 * 1024 * 1024 }, 'PROFILE')).toEqual(
      webV.validateFileForUpload({ name: 'big.jpg', type: 'image/jpeg', size: 99 * 1024 * 1024 }, 'PROFILE'),
    );
    for (const code of ['OFFLINE', 'FILE_TOO_LARGE', 'UPLOAD_FAILED', 'FINALIZE_FAILED', 'MEDIA_NOT_READY', 'SERVICE_IMAGE_LIMIT', 'BOGUS']) {
      expect(mobileV.uploadErrorMessage(code, 'f')).toBe(webV.uploadErrorMessage(code, 'f'));
    }
    expect(mobileV.MAX_SERVICE_IMAGES).toBe(webV.MAX_SERVICE_IMAGES);
  });

  it('35. offline upload safety: blocked before any network call, no fake reference', async () => {
    const { MediaService } = await import('../../apps/web/src/app/core/services/media.service');
    const { http, calls } = stubHttp();
    const svc = new MediaService(http as any);
    const prevNavigator = (global as any).navigator;
    (global as any).navigator = { onLine: false };
    try {
      const file = new File(['bytes'], 'photo.jpg', { type: 'image/jpeg' });
      await expect(
        new Promise((_, reject) => (svc.uploadFile(file, 'PROFILE') as any).subscribe({ next: () => reject(new Error('must not succeed')), error: reject })),
      ).rejects.toMatchObject({ code: 'OFFLINE' });
      expect(calls).toHaveLength(0);
    } finally {
      (global as any).navigator = prevNavigator;
    }
  });

  it('36. retry behaviour: failed PUT then success completes honestly', async () => {
    const { MediaService } = await import('../../apps/web/src/app/core/services/media.service');
    const sessionData = {
      success: true,
      data: {
        mediaId: 'm-9',
        upload: { uploadUrl: 'https://upload.local/x', uploadMethod: 'PUT', expiresAt: new Date().toISOString(), maxSizeBytes: 100 },
      },
    };
    const finalizeData = { success: true, data: { mediaId: 'm-9', status: 'ACTIVE', viewUrl: 'https://media.local/x.jpg' } };
    const posts: string[] = [];
    const http: any = {
      post: (url: string) => {
        posts.push(url);
        return of(url.endsWith('/upload-sessions') ? sessionData : finalizeData);
      },
    };
    const svc = new MediaService(http as any);
    const prevNavigator = (global as any).navigator;
    const prevFetch = (global as any).fetch;
    (global as any).navigator = { onLine: true };
    let attempts = 0;
    (global as any).fetch = jest.fn(async () => ({ ok: ++attempts >= 2 }));
    try {
      const run = (): Promise<any> =>
        new Promise((resolve, reject) => (svc.uploadFile(new File(['b'], 'a.jpg', { type: 'image/jpeg' }), 'PROFILE') as any).subscribe({ next: resolve, error: reject }));
      await expect(run()).rejects.toMatchObject({ code: 'UPLOAD_FAILED' });
      expect(posts.filter((u) => u.endsWith('/finalize'))).toHaveLength(0);
      const outcome = await run();
      expect(outcome.status).toBe('ACTIVE');
      expect(outcome.viewUrl).toBe('https://media.local/x.jpg');
    } finally {
      (global as any).navigator = prevNavigator;
      (global as any).fetch = prevFetch;
    }
  });

  it('37. no mock-success: PUT failure never finalizes', async () => {
    const { MediaService } = await import('../../apps/web/src/app/core/services/media.service');
    const posts: string[] = [];
    const http: any = {
      post: (url: string) => {
        posts.push(url);
        return of({ success: true, data: { mediaId: 'm-x', upload: { uploadUrl: 'https://upload.local/x', uploadMethod: 'PUT', expiresAt: '', maxSizeBytes: 10 } } });
      },
    };
    const svc = new MediaService(http as any);
    const prevNavigator = (global as any).navigator;
    const prevFetch = (global as any).fetch;
    (global as any).navigator = { onLine: true };
    (global as any).fetch = jest.fn(async () => ({ ok: false }));
    try {
      await expect(
        new Promise((_, reject) =>
          (svc.uploadFile(new File(['b'], 'a.jpg', { type: 'image/jpeg' }), 'PROFILE') as any).subscribe({ next: () => reject(new Error('must not succeed')), error: reject }),
        ),
      ).rejects.toMatchObject({ code: 'UPLOAD_FAILED' });
      expect(posts.filter((u) => u.endsWith('/finalize'))).toHaveLength(0);
    } finally {
      (global as any).navigator = prevNavigator;
      (global as any).fetch = prevFetch;
    }
  });

  it('35b. client validation blocks unsupported/too-large files before network', async () => {
    const webV = await import('../../apps/web/src/app/core/services/media-upload');
    expect(webV.validateFileForUpload({ name: 'run.exe', type: 'application/x-msdownload', size: 100 }, 'PROFILE').join('|')).toMatch(/Unsupported/);
    expect(webV.validateFileForUpload({ name: 'big.jpg', type: 'image/jpeg', size: 50 * 1024 * 1024 }, 'PROFILE').join('|')).toMatch(/too large/);
    expect(webV.validateFileForUpload({ name: 'photo.png', type: 'image/jpeg', size: 100 }, 'PROFILE').join('|')).toMatch(/extension/);
    expect(webV.validateFileForUpload({ name: 'photo.jpg', type: 'image/jpeg', size: 100 }, 'PROFILE')).toEqual([]);
  });
});

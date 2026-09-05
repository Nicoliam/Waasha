import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../config/prisma';
import { authMiddleware } from '../../middleware/auth';
import { getMarketplaceConfig } from '../marketplace/marketplace-config.service';

const router = Router();

// All /providers/me/* require authentication
router.use(authMiddleware);

// GET /api/v1/providers/me — own provider profile (tenant isolation)
router.get('/me', async (req: Request, res: Response) => {
  const authUser = req.authUser!;
  const profile = await prisma.providerProfile.findUnique({
    where: { userId: authUser.userId },
    include: { tier: true },
  });
  if (!profile) {
    return res.status(404).json({ success: false, error: { code: 'PROVIDER_NOT_FOUND', message: 'Provider profile not found' } });
  }
  return res.json({ success: true, data: profile });
});

// GET /api/v1/providers/me/coverage
router.get('/me/coverage', async (req: Request, res: Response) => {
  const authUser = req.authUser!;
  // Tenant isolation: provider ownership — must own providerProfile
  const profile = await prisma.providerProfile.findUnique({
    where: { userId: authUser.userId },
    select: { id: true, coverageRadiusKm: true },
  });
  if (!profile) {
    return res.status(404).json({
      success: false,
      error: { code: 'PROVIDER_NOT_FOUND', message: 'Provider profile not found for authenticated user' },
    });
  }
  return res.json({ success: true, data: { coverageRadiusKm: profile.coverageRadiusKm } });
});

// PUT /api/v1/providers/me/coverage
const updateSchema = z.object({
  coverageRadiusKm: z.number(),
});

router.put('/me/coverage', async (req: Request, res: Response) => {
  const authUser = req.authUser!;
  const parsed = updateSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(422).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Invalid body', details: parsed.error.flatten() },
    });
  }
  const { coverageRadiusKm } = parsed.data;

  const config = await getMarketplaceConfig();
  const allowed = config.allowed_provider_coverages_km;
  const max = config.max_provider_coverage_km;

  // Backend-authoritative validation — never trust frontend
  if (!allowed.includes(coverageRadiusKm)) {
    return res.status(422).json({
      success: false,
      error: {
        code: 'INVALID_COVERAGE',
        message: `coverageRadiusKm must be one of [${allowed.join(', ')}]`,
        details: { allowed, received: coverageRadiusKm },
      },
    });
  }
  if (coverageRadiusKm > max) {
    return res.status(422).json({
      success: false,
      error: { code: 'COVERAGE_EXCEEDS_MAX', message: `coverageRadiusKm must not exceed ${max}` },
    });
  }
  if (coverageRadiusKm < Math.min(...allowed)) {
    return res.status(422).json({
      success: false,
      error: { code: 'COVERAGE_BELOW_MIN', message: `coverageRadiusKm must be at least ${Math.min(...allowed)}` },
    });
  }

  const profile = await prisma.providerProfile.findUnique({
    where: { userId: authUser.userId },
    select: { id: true, userId: true },
  });
  if (!profile) {
    return res.status(404).json({
      success: false,
      error: { code: 'PROVIDER_NOT_FOUND', message: 'Provider profile not found' },
    });
  }

  // Ownership enforced by userId match — cross-provider update impossible because profile lookup is by authUser.userId
  const before = await prisma.providerProfile.findUnique({ where: { id: profile.id } });
  const updated = await prisma.providerProfile.update({
    where: { id: profile.id },
    data: { coverageRadiusKm },
    select: { coverageRadiusKm: true, updatedAt: true },
  });

  // Audit log — security requirement
  try {
    await prisma.auditLog.create({
      data: {
        actorUserId: authUser.userId,
        action: 'PROVIDER_COVERAGE_UPDATED',
        entityType: 'provider_profile',
        entityId: profile.id,
        beforeJson: { coverageRadiusKm: before?.coverageRadiusKm } as any,
        afterJson: { coverageRadiusKm: updated.coverageRadiusKm } as any,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });
  } catch {}

  return res.json({ success: true, data: { coverageRadiusKm: updated.coverageRadiusKm } });
});

// ── Provider own services — Phase 2 Slice 1 (authenticated, ownership enforced) ────
// GET /api/v1/providers/me/services — own services (all statuses), paginated, max 3 images
router.get('/me/services', async (req: Request, res: Response) => {
  const authUser = req.authUser!;
  const profile = await prisma.providerProfile.findUnique({
    where: { userId: authUser.userId },
    select: { id: true, userId: true },
  });
  if (!profile) {
    return res.status(404).json({ success: false, error: { code: 'PROVIDER_NOT_FOUND', message: 'Provider profile not found' } });
  }

  const querySchema = z.object({
    categoryId: z.string().optional(),
    status: z.enum(['ACTIVE', 'PAUSED', 'DRAFT', 'SUSPENDED']).optional(),
    page: z.coerce.number().int().min(1).default(1),
    perPage: z.coerce.number().int().min(1).max(50).default(20),
  });
  const parsed = querySchema.safeParse(req.query as any);
  if (!parsed.success) {
    return res.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid query', details: parsed.error.flatten() } });
  }
  const { categoryId, status, page, perPage } = parsed.data;

  let resolvedCategoryId: string | null = null;
  if (categoryId) {
    const byId = await prisma.serviceCategory.findUnique({ where: { id: categoryId } }).catch(() => null);
    if (byId) resolvedCategoryId = byId.id;
    else {
      const byCode = await prisma.serviceCategory.findUnique({ where: { code: categoryId } }).catch(() => null);
      if (!byCode) return res.status(422).json({ success: false, error: { code: 'INVALID_CATEGORY', message: 'Invalid categoryId' } });
      resolvedCategoryId = byCode.id;
    }
  }

  let ownedUnitIds: string[] = [];
  try {
    const businesses = await (prisma as any).business?.findMany?.({ where: { ownerProviderId: profile.userId }, select: { id: true } }) ?? [];
    if (Array.isArray(businesses) && businesses.length > 0) {
      const units = await (prisma as any).businessUnit?.findMany?.({ where: { businessId: { in: businesses.map((b: any) => b.id) } }, select: { id: true } }) ?? [];
      ownedUnitIds = (units as any[]).map((u) => u.id);
    }
  } catch {
    ownedUnitIds = [];
  }

  const ownerWhere: any =
    ownedUnitIds.length > 0 ? { OR: [{ providerId: profile.id }, { businessUnitId: { in: ownedUnitIds } }] } : { providerId: profile.id };
  const where: any = {
    ...ownerWhere,
    ...(status ? { status } : {}),
    ...(resolvedCategoryId ? { serviceCategoryId: resolvedCategoryId } : {}),
  };

  try {
    const total = await prisma.service.count({ where } as any);
    const services = await prisma.service.findMany({
      where: where as any,
      include: {
        category: { select: { id: true, code: true, name: true } },
        images: { orderBy: { sortOrder: 'asc' }, take: 3 },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * perPage,
      take: perPage,
    });
    return res.json({
      success: true,
      data: services.map((s: any) => ({
        id: s.id,
        uuid: s.uuid,
        name: s.name,
        description: s.description,
        price: Number(s.price),
        currency: s.currency,
        durationMinutes: s.durationMinutes,
        serviceMode: s.serviceMode,
        status: s.status,
        category: s.category,
        providerId: s.providerId,
        businessUnitId: s.businessUnitId,
        images: (s.images ?? []).slice(0, 3).map((img: any) => ({ id: img.id, imageUrl: img.imageUrl, sortOrder: img.sortOrder })),
      })),
      meta: { page, perPage, total },
    });
  } catch {
    return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to load services' } });
  }
});

// GET /api/v1/providers/me/services/:serviceId — own service detail (any status, ownership enforced)
router.get('/me/services/:serviceId', async (req: Request, res: Response) => {
  const authUser = req.authUser!;
  const { serviceId } = req.params as { serviceId: string };
  const profile = await prisma.providerProfile.findUnique({ where: { userId: authUser.userId }, select: { id: true, userId: true } });
  if (!profile) {
    return res.status(404).json({ success: false, error: { code: 'PROVIDER_NOT_FOUND', message: 'Provider profile not found' } });
  }
  try {
    let ownedUnitIds: string[] = [];
    try {
      const businesses = await (prisma as any).business?.findMany?.({ where: { ownerProviderId: profile.userId }, select: { id: true } }) ?? [];
      if (Array.isArray(businesses) && businesses.length > 0) {
        const units = await (prisma as any).businessUnit?.findMany?.({ where: { businessId: { in: businesses.map((b: any) => b.id) } }, select: { id: true } }) ?? [];
        ownedUnitIds = (units as any[]).map((u) => u.id);
      }
    } catch {
      ownedUnitIds = [];
    }

    const service = await prisma.service.findUnique({
      where: { id: serviceId },
      include: {
        category: { select: { id: true, code: true, name: true } },
        images: { orderBy: { sortOrder: 'asc' }, take: 3 },
      },
    } as any);
    if (!service) {
      return res.status(404).json({ success: false, error: { code: 'SERVICE_NOT_FOUND', message: 'Service not found' } });
    }
    const belongs =
      (service as any).providerId === profile.id ||
      (ownedUnitIds.length > 0 && ownedUnitIds.includes((service as any).businessUnitId));
    if (!belongs) {
      return res.status(404).json({ success: false, error: { code: 'SERVICE_NOT_FOUND', message: 'Service not found for provider' } });
    }
    return res.json({
      success: true,
      data: {
        id: (service as any).id,
        uuid: (service as any).uuid,
        name: (service as any).name,
        description: (service as any).description,
        price: Number((service as any).price),
        currency: (service as any).currency,
        durationMinutes: (service as any).durationMinutes,
        serviceMode: (service as any).serviceMode,
        status: (service as any).status,
        category: (service as any).category,
        providerId: (service as any).providerId,
        businessUnitId: (service as any).businessUnitId,
        images: ((service as any).images ?? []).slice(0, 3).map((img: any) => ({ id: img.id, imageUrl: img.imageUrl, sortOrder: img.sortOrder })),
      },
    });
  } catch {
    return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to load service' } });
  }
});

export default router;

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../config/prisma';
import { authMiddleware } from '../../middleware/auth';
import { getMarketplaceConfig } from '../marketplace/marketplace-config.service';

const router = Router();

// All /providers/me/* require authentication
router.use(authMiddleware);

// GET /api/v1/providers/me — own provider profile (tenant isolation)
// Ownership comes from the authenticated session userId only.
// Returns the established API shape { success, data, error }.
router.get('/me', async (req: Request, res: Response) => {
  try {
    const svc = await import('./provider-profile.service');
    const data = await svc.getOwnProfile(req.authUser!.userId);
    return res.json({ success: true, data });
  } catch (err: any) {
    if (err && typeof err.status === 'number') {
      return res.status(err.status).json({
        success: false,
        error: {
          code: err.code ?? 'ERROR',
          message: err.message,
          ...(err.details !== undefined ? { details: err.details } : {}),
        },
      });
    }
    return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to load profile' } });
  }
});

// PATCH /api/v1/providers/me — Slice 10 provider profile management.
// Editable allowlist: displayName, bio, experienceSummary,
// customRequestsEnabled, profileImageUrl (reference-only).
// MEDIA NOTE (deferred): profileImageUrl is a reference string only. The
// existing media/storage abstraction remains the source of truth; no upload
// endpoint, signed URL flow, S3 credentials, or vendor SDK are introduced
// in this slice. Upload wiring is deferred until the media vertical slice.
router.patch('/me', async (req: Request, res: Response) => {
  try {
    const svc = await import('./provider-profile.service');
    const data = await svc.patchOwnProfile(req.authUser!.userId, (req.body ?? {}) as Record<string, unknown>, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return res.json({ success: true, data });
  } catch (err: any) {
    if (err && typeof err.status === 'number') {
      return res.status(err.status).json({
        success: false,
        error: {
          code: err.code ?? 'ERROR',
          message: err.message,
          ...(err.details !== undefined ? { details: err.details } : {}),
        },
      });
    }
    return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to update profile' } });
  }
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

// ── Provider booking management — Phase 2 Slice 5 ───────────────────────────
// All endpoints derive provider identity from the authenticated session.
// Never accept providerId from the client as the source of authorization.
router.get('/me/bookings', async (req: Request, res: Response) => {
  const authUser = req.authUser!;
  const schema = z.object({
    status: z.string().optional(),
    page: z.coerce.number().int().min(1).default(1),
    perPage: z.coerce.number().int().min(1).max(50).default(20),
  });
  const parsed = schema.safeParse(req.query as any);
  if (!parsed.success) {
    return res.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid query', details: parsed.error.flatten() } });
  }
  try {
    const { listProviderBookings } = await import('../bookings/provider-bookings.service');
    const result = await listProviderBookings(authUser.userId, {
      status: parsed.data.status,
      page: parsed.data.page,
      perPage: parsed.data.perPage,
    });
    return res.json({ success: true, data: result.bookings, meta: result.meta });
  } catch (err: any) {
    if (err.status) return res.status(err.status).json({ success: false, error: { code: err.code ?? 'ERROR', message: err.message, details: err.details } });
    return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to load bookings' } });
  }
});

router.get('/me/bookings/:id/navigation', async (req: Request, res: Response) => {
  const authUser = req.authUser!;
  const id = req.params.id as string;
  if (!id) return res.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Booking id required' } });
  try {
    const { getProviderBookingNavigation } = await import('../bookings/provider-bookings.service');
    const nav = await getProviderBookingNavigation(authUser.userId, id);
    return res.json({ success: true, data: nav });
  } catch (err: any) {
    if (err.status) return res.status(err.status).json({ success: false, error: { code: err.code ?? 'ERROR', message: err.message, details: err.details } });
    return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to load navigation' } });
  }
});

router.get('/me/bookings/:id', async (req: Request, res: Response) => {
  const authUser = req.authUser!;
  const id = req.params.id as string;
  if (!id) return res.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Booking id required' } });
  try {
    const { getProviderBookingDetail } = await import('../bookings/provider-bookings.service');
    const booking = await getProviderBookingDetail(authUser.userId, id);
    return res.json({ success: true, data: booking });
  } catch (err: any) {
    if (err.status) return res.status(err.status).json({ success: false, error: { code: err.code ?? 'ERROR', message: err.message, details: err.details } });
    return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to load booking' } });
  }
});

async function handleProviderBookingTransition(req: Request, res: Response, target: 'accept' | 'reject') {
  const authUser = req.authUser!;
  const id = req.params.id as string;
  if (!id) return res.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Booking id required' } });
  try {
    const svc = await import('../bookings/provider-bookings.service');
    const result =
      target === 'accept'
        ? await svc.acceptProviderBooking(authUser.userId, id)
        : await svc.rejectProviderBooking(authUser.userId, id);
    return res.json({ success: true, data: result });
  } catch (err: any) {
    if (err.status) return res.status(err.status).json({ success: false, error: { code: err.code ?? 'ERROR', message: err.message, details: err.details } });
    return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to update booking' } });
  }
}

router.post('/me/bookings/:id/accept', async (req: Request, res: Response) => handleProviderBookingTransition(req, res, 'accept'));
router.post('/me/bookings/:id/reject', async (req: Request, res: Response) => handleProviderBookingTransition(req, res, 'reject'));
// Blueprint-canonical alias: rejection records DECLINED.
router.post('/me/bookings/:id/decline', async (req: Request, res: Response) => handleProviderBookingTransition(req, res, 'reject'));

// ── Provider service completion — Phase 2 Slice 13 ──────────────────────────
// IN_PROGRESS → COMPLETED only. The body carries no authority: any ownership,
// status, price, payment or commission field is rejected (mass-assignment
// safe). Provider identity always comes from the authenticated session.
router.post('/me/bookings/:id/complete', async (req: Request, res: Response) => {
  const authUser = req.authUser!;
  const id = req.params.id as string;
  if (!id) return res.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Booking id required' } });
  const bodySchema = z.object({}).strict();
  const parsed = bodySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid body', details: parsed.error.flatten() } });
  }
  try {
    const { completeProviderBooking } = await import('../bookings/booking-completion.service');
    const result = await completeProviderBooking(authUser.userId, id, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return res.json({ success: true, data: result });
  } catch (err: any) {
    if (err.status) return res.status(err.status).json({ success: false, error: { code: err.code ?? 'ERROR', message: err.message, details: err.details } });
    return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to complete booking' } });
  }
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

// ── Provider service catalogue management — Phase 2 Slice 9 ────────────────
// Provider identity always comes from the authenticated session.
// POST creates under the session provider; PUT/PATCH/DELETE are ownership-checked.
// Price/duration edits never mutate existing bookings (historical snapshots).
function serviceError(res: Response, err: any, fallback: string) {
  if (err && typeof err.status === 'number') {
    return res.status(err.status).json({
      success: false,
      error: { code: err.code ?? 'ERROR', message: err.message, ...(err.details !== undefined ? { details: err.details } : {}) },
    });
  }
  return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: fallback } });
}

router.post('/me/services', async (req: Request, res: Response) => {
  try {
    const svc = await import('./provider-services.service');
    const data = await svc.createService(req.authUser!.userId, (req.body ?? {}) as Record<string, unknown>, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return res.status(201).json({ success: true, data });
  } catch (err: any) {
    return serviceError(res, err, 'Failed to create service');
  }
});

router.put('/me/services/:serviceId', async (req: Request, res: Response) => {
  try {
    const svc = await import('./provider-services.service');
    const data = await svc.replaceService(req.authUser!.userId, req.params.serviceId as string, (req.body ?? {}) as Record<string, unknown>, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return res.json({ success: true, data });
  } catch (err: any) {
    return serviceError(res, err, 'Failed to update service');
  }
});

router.patch('/me/services/:serviceId', async (req: Request, res: Response) => {
  try {
    const svc = await import('./provider-services.service');
    const data = await svc.patchService(req.authUser!.userId, req.params.serviceId as string, (req.body ?? {}) as Record<string, unknown>, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return res.json({ success: true, data });
  } catch (err: any) {
    return serviceError(res, err, 'Failed to update service');
  }
});

router.delete('/me/services/:serviceId/images/:imageId', async (req: Request, res: Response) => {
  try {
    const svc = await import('../media/media.service');
    const data = await svc.removeServiceImage(
      req.authUser!.userId,
      req.params.serviceId as string,
      req.params.imageId as string,
      {
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      },
    );
    return res.json({ success: true, data });
  } catch (err: any) {
    return serviceError(res, err, 'Failed to remove service image');
  }
});

router.delete('/me/services/:serviceId', async (req: Request, res: Response) => {
  try {
    const svc = await import('./provider-services.service');
    const data = await svc.deleteService(req.authUser!.userId, req.params.serviceId as string, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return res.json({ success: true, data });
  } catch (err: any) {
    return serviceError(res, err, 'Failed to delete service');
  }
});

// ── Provider availability & scheduling — Phase 2 Slice 8 ────────────────────
// Provider identity always comes from the authenticated session.
// businessUnitId (T3) is verified against businesses owned by the session user.
function availabilityError(res: Response, err: any, fallback: string) {
  if (err && typeof err.status === 'number') {
    return res.status(err.status).json({
      success: false,
      error: { code: err.code ?? 'ERROR', message: err.message, ...(err.details !== undefined ? { details: err.details } : {}) },
    });
  }
  return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: fallback } });
}

function availabilityCtx(req: Request) {
  return { ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined };
}

router.get('/me/availability', async (req: Request, res: Response) => {
  try {
    const svc = await import('../availability/availability.service');
    const data = await svc.getSchedule(req.authUser!.userId, (req.query.businessUnitId as string | undefined) ?? null);
    return res.json({ success: true, data });
  } catch (err: any) {
    return availabilityError(res, err, 'Failed to load availability');
  }
});

router.get('/me/availability/rules', async (req: Request, res: Response) => {
  try {
    const svc = await import('../availability/availability.service');
    const data = await svc.listRules(req.authUser!.userId, (req.query.businessUnitId as string | undefined) ?? null);
    return res.json({ success: true, data });
  } catch (err: any) {
    return availabilityError(res, err, 'Failed to load availability rules');
  }
});

router.post('/me/availability/rules', async (req: Request, res: Response) => {
  try {
    const svc = await import('../availability/availability.service');
    const data = await svc.createRule(req.authUser!.userId, req.body ?? {}, availabilityCtx(req));
    return res.status(201).json({ success: true, data });
  } catch (err: any) {
    return availabilityError(res, err, 'Failed to create availability rule');
  }
});

router.put('/me/availability/rules', async (req: Request, res: Response) => {
  try {
    const svc = await import('../availability/availability.service');
    const data = await svc.replaceRules(req.authUser!.userId, req.body ?? {}, availabilityCtx(req));
    return res.json({ success: true, data });
  } catch (err: any) {
    return availabilityError(res, err, 'Failed to replace availability rules');
  }
});

router.patch('/me/availability/rules/:id', async (req: Request, res: Response) => {
  try {
    const svc = await import('../availability/availability.service');
    const data = await svc.updateRule(req.authUser!.userId, req.params.id as string, req.body ?? {}, availabilityCtx(req));
    return res.json({ success: true, data });
  } catch (err: any) {
    return availabilityError(res, err, 'Failed to update availability rule');
  }
});

router.delete('/me/availability/rules/:id', async (req: Request, res: Response) => {
  try {
    const svc = await import('../availability/availability.service');
    const data = await svc.deleteRule(
      req.authUser!.userId,
      req.params.id as string,
      ((req.query.businessUnitId ?? req.body?.businessUnitId) as string | undefined) ?? null,
      availabilityCtx(req),
    );
    return res.json({ success: true, data });
  } catch (err: any) {
    return availabilityError(res, err, 'Failed to delete availability rule');
  }
});

router.get('/me/availability/exceptions', async (req: Request, res: Response) => {
  try {
    const svc = await import('../availability/availability.service');
    const data = await svc.listExceptions(req.authUser!.userId, {
      page: req.query.page,
      perPage: req.query.perPage,
      businessUnitId: (req.query.businessUnitId as string | undefined) ?? null,
      upcomingOnly: req.query.upcomingOnly === 'true' || req.query.upcomingOnly === '1',
    });
    return res.json({ success: true, data: data.exceptions, meta: data.meta, timezone: data.timezone });
  } catch (err: any) {
    return availabilityError(res, err, 'Failed to load availability exceptions');
  }
});

router.post('/me/availability/exceptions', async (req: Request, res: Response) => {
  try {
    const svc = await import('../availability/availability.service');
    const data = await svc.createException(req.authUser!.userId, req.body ?? {}, availabilityCtx(req));
    return res.status(201).json({ success: true, data });
  } catch (err: any) {
    return availabilityError(res, err, 'Failed to create availability exception');
  }
});

router.patch('/me/availability/exceptions/:id', async (req: Request, res: Response) => {
  try {
    const svc = await import('../availability/availability.service');
    const data = await svc.updateException(req.authUser!.userId, req.params.id as string, req.body ?? {}, availabilityCtx(req));
    return res.json({ success: true, data });
  } catch (err: any) {
    return availabilityError(res, err, 'Failed to update availability exception');
  }
});

router.delete('/me/availability/exceptions/:id', async (req: Request, res: Response) => {
  try {
    const svc = await import('../availability/availability.service');
    const data = await svc.deleteException(
      req.authUser!.userId,
      req.params.id as string,
      ((req.query.businessUnitId ?? req.body?.businessUnitId) as string | undefined) ?? null,
      availabilityCtx(req),
    );
    return res.json({ success: true, data });
  } catch (err: any) {
    return availabilityError(res, err, 'Failed to delete availability exception');
  }
});

router.get('/me/availability/conflicts', async (req: Request, res: Response) => {
  try {
    const svc = await import('../availability/availability.service');
    const scope = await svc.resolveScope(req.authUser!.userId, (req.query.businessUnitId as string | undefined) ?? null);
    const conflicts = await svc.findConflicts(req.authUser!.userId, scope);
    return res.json({ success: true, data: { conflicts, timezone: scope.timezone } });
  } catch (err: any) {
    return availabilityError(res, err, 'Failed to check conflicts');
  }
});

router.get('/me/availability/timezone', async (req: Request, res: Response) => {
  try {
    const svc = await import('../availability/availability.service');
    const data = await svc.getTimezone(req.authUser!.userId);
    return res.json({ success: true, data });
  } catch (err: any) {
    return availabilityError(res, err, 'Failed to load timezone');
  }
});

router.put('/me/availability/timezone', async (req: Request, res: Response) => {
  try {
    const svc = await import('../availability/availability.service');
    const data = await svc.updateTimezone(req.authUser!.userId, (req.body ?? {}).timezone, availabilityCtx(req));
    return res.json({ success: true, data });
  } catch (err: any) {
    return availabilityError(res, err, 'Failed to update timezone');
  }
});

export default router;

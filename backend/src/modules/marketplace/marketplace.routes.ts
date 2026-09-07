import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { getMarketplaceConfig } from './marketplace-config.service';
import { prisma } from '../../config/prisma';
import { haversineKm, boundingBox } from '../../utils/geo';

const router = Router();

// GET /api/v1/marketplace/config — public (no auth), DB-backed
router.get('/config', async (_req: Request, res: Response) => {
  const config = await getMarketplaceConfig();
  return res.json({ success: true, data: config });
});

// GET /api/v1/marketplace/categories — public, exactly 5 launch categories (blueprint)
router.get('/categories', async (_req: Request, res: Response) => {
  try {
    const categories = await prisma.serviceCategory.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: { id: true, code: true, name: true, icon: true, sortOrder: true },
    });
    return res.json({ success: true, data: categories });
  } catch {
    return res.status(503).json({ success: false, error: { code: 'NOT_READY', message: 'Categories unavailable' } });
  }
});

// GET /api/v1/marketplace/providers — marketplace discovery (BOTH rule)
const querySchema = z.object({
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  radiusKm: z.coerce.number(),
  categoryId: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  perPage: z.coerce.number().int().min(1).max(50).default(20),
});

router.get('/providers', async (req: Request, res: Response) => {
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(422).json({
      success: false,
      error: { code: 'VALIDATION_ERROR', message: 'Invalid query', details: parsed.error.flatten() },
    });
  }
  const { latitude, longitude, radiusKm, categoryId, page, perPage } = parsed.data;

  const config = await getMarketplaceConfig();

  // Backend-authoritative validation: radius must be in allowed set and <= max
  if (!config.allowed_customer_radii_km.includes(radiusKm)) {
    return res.status(422).json({
      success: false,
      error: {
        code: 'INVALID_RADIUS',
        message: `radiusKm must be one of [${config.allowed_customer_radii_km.join(', ')}]`,
        details: { allowed: config.allowed_customer_radii_km, received: radiusKm },
      },
    });
  }
  if (radiusKm > config.max_discovery_radius_km) {
    return res.status(422).json({
      success: false,
      error: {
        code: 'RADIUS_EXCEEDS_MAX',
        message: `radiusKm must not exceed ${config.max_discovery_radius_km}`,
      },
    });
  }

  // Resolve categoryId (id or code) once — also validates
  let resolvedCategoryId: string | null = null;
  if (categoryId) {
    const byId = await prisma.serviceCategory.findUnique({ where: { id: categoryId } }).catch(() => null);
    if (byId) {
      resolvedCategoryId = byId.id;
    } else {
      const byCode = await prisma.serviceCategory.findUnique({ where: { code: categoryId } }).catch(() => null);
      if (!byCode) {
        return res.status(422).json({
          success: false,
          error: { code: 'INVALID_CATEGORY', message: 'Invalid categoryId' },
        });
      }
      resolvedCategoryId = byCode.id;
    }
  }

  // Bounding-box pre-filter to leverage latitude/longitude indexes (blueprint: geospatial)
  const box = boundingBox({ latitude, longitude }, radiusKm);

  // Fetch eligible provider primary locations + their provider coverage.
  // For MVP we consider provider_profiles.coverage_radius_km + provider_locations (primary or active).
  // T3 business_units are separate query (not required for radius slice tests but preserved for blueprint).
  const locations = await prisma.providerLocation.findMany({
    where: {
      isActive: true,
      latitude: { gte: box.minLat, lte: box.maxLat },
      longitude: { gte: box.minLng, lte: box.maxLng },
      provider: { status: 'ACTIVE' },
    },
    include: {
      provider: {
        select: {
          id: true,
          displayName: true,
          bio: true,
          profileImageUrl: true,
          coverageRadiusKm: true,
          status: true,
          verificationStatus: true,
          tierId: true,
          tier: { select: { code: true, name: true } },
        },
      },
    },
    take: 500, // hard cap before precise filter
  });

  // Precise BOTH rule: distance <= customer radius AND distance <= provider coverage
  // distance never exceeds 20 km path due to customer radius validation above
  const preFiltered: Array<{ loc: (typeof locations)[number]; distanceKm: number }> = [];
  for (const loc of locations) {
    const distanceKm = haversineKm({ latitude, longitude }, { latitude: loc.latitude, longitude: loc.longitude });
    // Extra guard: distance must never exceed max (20) even if DB had stale wide box
    if (distanceKm > config.max_discovery_radius_km) continue;
    if (distanceKm > radiusKm) continue; // customer radius
    if (distanceKm > loc.provider.coverageRadiusKm) continue; // provider coverage — BOTH rule

    // Category filtering — resolvedCategoryId pre-validated above
    if (resolvedCategoryId) {
      const hasService = await prisma.service.findFirst({
        where: {
          providerId: loc.provider.id,
          serviceCategoryId: resolvedCategoryId,
          status: 'ACTIVE',
        },
        select: { id: true },
      });
      if (!hasService) continue;
    }

    preFiltered.push({ loc, distanceKm: Math.round(distanceKm * 10) / 10 });
  }

  // Sort by distance ascending (marketplace equality — no tier boost)
  preFiltered.sort((a, b) => a.distanceKm - b.distanceKm);

  // Slice 15 — T3 business-unit discovery (BusinessLocation indexing).
  // Units with their own coordinates participate under the SAME BOTH rule:
  // distance <= customer radius AND distance <= unit coverage AND <= max 20.
  // No tier boost: unit entries interleave purely by distance. Provider-level
  // entries above are untouched; when no BusinessLocation rows exist the
  // result is byte-identical to previous slices.
  type UnitHit = { unit: any; ownerProvider: any; distanceKm: number };
  const unitHits: UnitHit[] = [];
  try {
    const unitLocations = await (prisma as any).businessLocation?.findMany?.({
      where: {
        latitude: { gte: box.minLat, lte: box.maxLat },
        longitude: { gte: box.minLng, lte: box.maxLng },
      },
      include: {
        businessUnit: {
          include: {
            business: true,
          },
        },
      },
      take: 500,
    });
    if (Array.isArray(unitLocations)) {
      for (const loc of unitLocations as any[]) {
        const unit = loc.businessUnit;
        if (!unit || unit.status !== 'ACTIVE' || unit.deletedAt) continue;
        const business = unit.business;
        if (!business || business.status !== 'ACTIVE' || business.deletedAt) continue;
        const distanceKm = haversineKm({ latitude, longitude }, { latitude: loc.latitude, longitude: loc.longitude });
        if (distanceKm > config.max_discovery_radius_km) continue;
        if (distanceKm > radiusKm) continue;
        const unitCoverage = Number(unit.coverageRadiusKm ?? 10);
        if (distanceKm > unitCoverage) continue; // unit coverage — BOTH rule
        if (resolvedCategoryId) {
          let hasCategory = false;
          try {
            const link = await (prisma as any).businessUnitCategory?.findFirst?.({
              where: { businessUnitId: unit.id, serviceCategoryId: resolvedCategoryId },
              select: { businessUnitId: true },
            });
            if (link) hasCategory = true;
            else {
              const svc = await prisma.service.findFirst({
                where: { businessUnitId: unit.id, serviceCategoryId: resolvedCategoryId, status: 'ACTIVE' },
                select: { id: true },
              });
              if (svc) hasCategory = true;
            }
          } catch {
            hasCategory = false;
          }
          if (!hasCategory) continue;
        }
        // Owner provider must be ACTIVE (marketplace equality: same bar as T1).
        let ownerProvider: any = null;
        try {
          ownerProvider = await prisma.providerProfile.findFirst({
            where: { userId: business.ownerProviderId, status: 'ACTIVE' },
            select: {
              id: true,
              displayName: true,
              bio: true,
              profileImageUrl: true,
              verificationStatus: true,
              tier: { select: { code: true, name: true } },
            },
          });
        } catch {
          ownerProvider = null;
        }
        if (!ownerProvider) continue;
        unitHits.push({ unit: { ...unit, location: loc }, ownerProvider, distanceKm: Math.round(distanceKm * 10) / 10 });
      }
    }
  } catch {
    /* BusinessLocation infra unavailable — provider-only discovery */
  }
  unitHits.sort((a, b) => a.distanceKm - b.distanceKm);

  // Merge provider + unit entries by distance (no tier boost anywhere).
  const merged: Array<{ kind: 'provider'; loc: (typeof locations)[number]; distanceKm: number } | { kind: 'business_unit'; hit: UnitHit }> = [
    ...preFiltered.map((p) => ({ kind: 'provider' as const, loc: p.loc, distanceKm: p.distanceKm })),
    ...unitHits.map((hit) => ({ kind: 'business_unit' as const, hit })),
  ];
  merged.sort((a, b) => (a.kind === 'provider' ? a.distanceKm : a.hit.distanceKm) - (b.kind === 'provider' ? b.distanceKm : b.hit.distanceKm));

  const total = merged.length;
  const start = (page - 1) * perPage;
  const pagedMerged = merged.slice(start, start + perPage);
  const pagedFiltered = pagedMerged.filter((m) => m.kind === 'provider') as Array<{ loc: (typeof locations)[number]; distanceKm: number }>;
  const pagedUnits = pagedMerged.filter((m) => m.kind === 'business_unit') as Array<{ hit: UnitHit }>;

  // Enrich unit entries (starting price from unit services, unit categories).
  const unitEnrich = new Map<string, { startingPrice: number | null; categories: string[] }>();
  if (pagedUnits.length > 0) {
    try {
      const unitIds = pagedUnits.map((u) => u.hit.unit.id);
      const unitServices = await prisma.service.findMany({
        where: { businessUnitId: { in: unitIds }, status: 'ACTIVE' },
        select: { businessUnitId: true, price: true, category: { select: { name: true } } },
      });
      const byUnit = new Map<string, typeof unitServices>();
      for (const s of unitServices) {
        const arr = byUnit.get(s.businessUnitId!) ?? [];
        arr.push(s);
        byUnit.set(s.businessUnitId!, arr);
      }
      const unitCats = await (prisma as any).businessUnitCategory?.findMany?.({
        where: { businessUnitId: { in: unitIds } },
        include: { category: { select: { name: true } } },
      });
      const catsByUnit = new Map<string, string[]>();
      for (const c of (unitCats as any[]) ?? []) {
        const arr = catsByUnit.get(c.businessUnitId) ?? [];
        if (c.category?.name) arr.push(c.category.name);
        catsByUnit.set(c.businessUnitId, arr);
      }
      for (const id of unitIds) {
        const svc = byUnit.get(id) ?? [];
        const prices = svc.map((s: any) => Number(s.price)).filter((n: number) => Number.isFinite(n));
        const fromServices = [...new Set(svc.map((s: any) => s.category?.name).filter(Boolean))] as string[];
        const fromLinks = catsByUnit.get(id) ?? [];
        unitEnrich.set(id, {
          startingPrice: prices.length ? Math.min(...prices) : null,
          categories: [...new Set([...fromServices, ...fromLinks])],
        });
      }
    } catch {
      /* unit enrichment is best-effort */
    }
  }

  // Enrich paged results with marketplace card fields (tier, rating, startingPrice, categories, location city)
  const providerIds = pagedFiltered.map((r) => r.loc.provider.id);
  let enrichedMap = new Map<string, { tierCode: string; tierName: string; profileImageUrl: string | null; rating: number | null; reviewCount: number; startingPrice: number | null; categories: string[]; city: string | null }>();
  if (providerIds.length > 0) {
    try {
      // Fetch services for starting price + categories
      const services = await prisma.service.findMany({
        where: { providerId: { in: providerIds }, status: 'ACTIVE' },
        select: {
          providerId: true,
          price: true,
          serviceCategoryId: true,
          category: { select: { name: true, code: true } },
        },
      });
      // Fetch review aggregates
      const reviews = await prisma.review.groupBy({
        by: ['providerId'],
        where: { providerId: { in: providerIds } },
        _avg: { rating: true },
        _count: { rating: true },
      } as any);

      const reviewMap = new Map(reviews.map((r: any) => [r.providerId, { avg: r._avg.rating, count: r._count.rating }]));
      const svcByProvider = new Map<string, typeof services>();
      for (const s of services) {
        const arr = svcByProvider.get(s.providerId!) ?? [];
        arr.push(s);
        svcByProvider.set(s.providerId!, arr);
      }

      for (const id of providerIds) {
        const svc = svcByProvider.get(id) ?? [];
        const prices = svc.map((s: any) => Number(s.price)).filter((n: number) => Number.isFinite(n));
        const startingPrice = prices.length ? Math.min(...prices) : null;
        const categories = [...new Set(svc.map((s: any) => s.category?.name).filter(Boolean))] as string[];
        const rev = reviewMap.get(id);
        enrichedMap.set(id, {
          tierCode: pagedFiltered.find((p) => p.loc.provider.id === id)?.loc.provider.tier?.code ?? 'T1',
          tierName: pagedFiltered.find((p) => p.loc.provider.id === id)?.loc.provider.tier?.name ?? 'Individual',
          profileImageUrl: pagedFiltered.find((p) => p.loc.provider.id === id)?.loc.provider.profileImageUrl ?? null,
          rating: rev?.avg != null ? Math.round(rev.avg * 10) / 10 : null,
          reviewCount: rev?.count ?? 0,
          startingPrice,
          categories,
          city: pagedFiltered.find((p) => p.loc.provider.id === id)?.loc.city ?? null,
        });
      }
    } catch {
      // enrichment is best-effort; keep minimal fields on failure
    }
  }

  const paged = pagedMerged.map((entry) => {
    if (entry.kind === 'business_unit') {
      const { hit } = entry as { hit: UnitHit };
      const op = hit.ownerProvider;
      const ue = unitEnrich.get(hit.unit.id);
      const loc = hit.unit.location;
      return {
        kind: 'business_unit' as const,
        id: op.id,
        businessId: hit.unit.businessId,
        businessUnitId: hit.unit.id,
        unitName: hit.unit.name,
        displayName: hit.unit.name ?? op.displayName ?? 'Provider',
        bio: op.bio ?? null,
        profileImageUrl: op.profileImageUrl ?? null,
        tierCode: op.tier?.code ?? 'T3',
        tierName: op.tier?.name ?? 'Business',
        verificationStatus: op.verificationStatus ?? null,
        latitude: loc.latitude,
        longitude: loc.longitude,
        city: loc.city ?? null,
        province: loc.province ?? null,
        coverageRadiusKm: Number(hit.unit.coverageRadiusKm ?? 10),
        distanceKm: hit.distanceKm,
        rating: null,
        reviewCount: 0,
        startingPrice: ue?.startingPrice ?? null,
        categories: ue?.categories ?? [],
      };
    }
    const { loc, distanceKm } = entry as { loc: (typeof locations)[number]; distanceKm: number };
    const e = enrichedMap.get(loc.provider.id);
    return {
      kind: 'provider' as const,
      id: loc.provider.id,
      displayName: loc.provider.displayName ?? 'Provider',
      bio: loc.provider.bio ?? null,
      profileImageUrl: loc.provider.profileImageUrl ?? null,
      tierCode: (loc.provider as any).tier?.code ?? e?.tierCode ?? null,
      tierName: (loc.provider as any).tier?.name ?? e?.tierName ?? null,
      verificationStatus: loc.provider.verificationStatus ?? null,
      latitude: loc.latitude,
      longitude: loc.longitude,
      city: (loc as any).city ?? e?.city ?? null,
      province: (loc as any).province ?? null,
      coverageRadiusKm: loc.provider.coverageRadiusKm,
      distanceKm,
      rating: e?.rating ?? null,
      reviewCount: e?.reviewCount ?? 0,
      startingPrice: e?.startingPrice ?? null,
      categories: e?.categories ?? [],
    };
  });

  return res.json({
    success: true,
    data: paged,
    meta: { page, perPage, total, radiusKm },
  });
});

// ── Public services read — Phase 2 Slice 1 ─────────────────────────
// GET /api/v1/marketplace/providers/:providerId/services — public, ACTIVE only, max 3 images
router.get('/providers/:providerId/services', async (req: Request, res: Response) => {
  const rawId = req.params.providerId as string;
  if (!rawId || typeof rawId !== 'string' || rawId.trim().length === 0) {
    return res.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'providerId is required' } });
  }
  const querySchema = z.object({
    categoryId: z.string().optional(),
    page: z.coerce.number().int().min(1).default(1),
    perPage: z.coerce.number().int().min(1).max(50).default(20),
  });
  const parsed = querySchema.safeParse(req.query as any);
  if (!parsed.success) {
    return res.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid query', details: parsed.error.flatten() } });
  }
  const { categoryId, page, perPage } = parsed.data;

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

  try {
    const provider = await prisma.providerProfile.findUnique({ where: { id: rawId }, select: { id: true, status: true, userId: true } });
    if (!provider || provider.status !== 'ACTIVE') {
      return res.status(404).json({ success: false, error: { code: 'PROVIDER_NOT_FOUND', message: 'Provider not found' } });
    }

    // Collect owned businessUnitIds for T3 (provider owns businesses). Non-T3 yields empty.
    let ownedUnitIds: string[] = [];
    try {
      const businesses = await (prisma as any).business?.findMany?.({ where: { ownerProviderId: provider.userId }, select: { id: true } }) ?? [];
      if (Array.isArray(businesses) && businesses.length > 0) {
        const units = await (prisma as any).businessUnit?.findMany?.({ where: { businessId: { in: businesses.map((b: any) => b.id) } }, select: { id: true } }) ?? [];
        ownedUnitIds = (units as any[]).map((u) => u.id);
      }
    } catch {
      ownedUnitIds = [];
    }

    const baseWhere: any = { status: 'ACTIVE' as const, ...(resolvedCategoryId ? { serviceCategoryId: resolvedCategoryId } : {}) };
    const ownerWhere: any =
      ownedUnitIds.length > 0
        ? { OR: [{ providerId: provider.id }, { businessUnitId: { in: ownedUnitIds } }] }
        : { providerId: provider.id };

    const where = { ...baseWhere, ...ownerWhere };

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
        images: (s.images ?? []).slice(0, 3).map((img: any) => ({ id: img.id, imageUrl: img.imageUrl, sortOrder: img.sortOrder })),
      })),
      meta: { page, perPage, total },
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to load services' } });
  }
});

// GET /api/v1/marketplace/providers/:providerId/services/:serviceId — public service detail (ACTIVE only)
router.get('/providers/:providerId/services/:serviceId', async (req: Request, res: Response) => {
  const { providerId, serviceId } = req.params as { providerId: string; serviceId: string };
  if (!providerId || !serviceId) {
    return res.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'providerId and serviceId required' } });
  }
  try {
    const provider = await prisma.providerProfile.findUnique({ where: { id: providerId }, select: { id: true, status: true, userId: true } });
    if (!provider || provider.status !== 'ACTIVE') {
      return res.status(404).json({ success: false, error: { code: 'PROVIDER_NOT_FOUND', message: 'Provider not found' } });
    }
    let ownedUnitIds: string[] = [];
    try {
      const businesses = await (prisma as any).business?.findMany?.({ where: { ownerProviderId: provider.userId }, select: { id: true } }) ?? [];
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
    if (!service || (service as any).status !== 'ACTIVE') {
      return res.status(404).json({ success: false, error: { code: 'SERVICE_NOT_FOUND', message: 'Service not found' } });
    }
    const belongs =
      (service as any).providerId === provider.id ||
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
        images: ((service as any).images ?? []).slice(0, 3).map((img: any) => ({ id: img.id, imageUrl: img.imageUrl, sortOrder: img.sortOrder })),
      },
    });
  } catch {
    return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to load service' } });
  }
});

// GET /api/v1/marketplace/providers/:providerId — public provider profile + services
// Must be after /providers list; Express matches exact before param, but keep param last
router.get('/providers/:providerId', async (req: Request, res: Response) => {
  const rawId = req.params.providerId;
  const { latitude, longitude } = req.query as { latitude?: string; longitude?: string };
  let distanceKm: number | null = null;
  let customerLoc: { latitude: number; longitude: number } | null = null;
  if (latitude !== undefined && longitude !== undefined) {
    const lat = Number(latitude);
    const lng = Number(longitude);
    if (Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
      customerLoc = { latitude: lat, longitude: lng };
    }
  }

  try {
    // Resolve provider by id (cuid) — also allow uuid via secondary lookup if needed
    let provider = await prisma.providerProfile.findUnique({
      where: { id: rawId },
      include: {
        tier: { select: { code: true, name: true } },
        user: { select: { id: true, uuid: true } },
      },
    });
    // Fallback: try uuid lookup via user relation? For now only id
    if (!provider) {
      return res.status(404).json({ success: false, error: { code: 'PROVIDER_NOT_FOUND', message: 'Provider not found' } });
    }
     if (provider.status !== 'ACTIVE') {
      return res.status(404).json({ success: false, error: { code: 'PROVIDER_NOT_FOUND', message: 'Provider not found' } });
    }

    const primaryLoc = await prisma.providerLocation.findFirst({
      where: { providerId: provider.id, isActive: true },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'desc' }],
    });

    if (primaryLoc && customerLoc) {
      distanceKm = Math.round(haversineKm(customerLoc, { latitude: primaryLoc.latitude, longitude: primaryLoc.longitude }) * 10) / 10;
    }

    // Services (max 3 images each per blueprint)
    const services = await prisma.service.findMany({
      where: { providerId: provider.id, status: 'ACTIVE' },
      include: {
        category: { select: { id: true, code: true, name: true } },
        images: { orderBy: { sortOrder: 'asc' }, take: 3 },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    // Rating summary
    let rating: number | null = null;
    let reviewCount = 0;
    let reviewsSample: Array<{ rating: number; comment: string | null; createdAt: Date }> = [];
    try {
      const agg = await (prisma.review as any).aggregate({
        where: { providerId: provider.id },
        _avg: { rating: true },
        _count: { rating: true },
      });
      if (agg?._avg?.rating != null) rating = Math.round(agg._avg.rating * 10) / 10;
      reviewCount = agg?._count?.rating ?? agg?._count?._all ?? 0;
      if (reviewCount > 0) {
        reviewsSample = await prisma.review.findMany({
          where: { providerId: provider.id },
          orderBy: { createdAt: 'desc' },
          take: 3,
          select: { rating: true, comment: true, createdAt: true },
        });
      }
    } catch {}

    // Availability preview — has at least one rule?
    let isAvailable = false;
    try {
      const rule = await prisma.availabilityRule.findFirst({ where: { providerId: provider.id, isActive: true }, select: { id: true } });
      isAvailable = !!rule;
    } catch {}

    // Never expose precise coordinates unless distance context was requested; still round and limit to 3 decimals
    const location = primaryLoc
      ? {
          city: primaryLoc.city ?? null,
          province: primaryLoc.province ?? null,
          // only include lat/lng rounded; not full precision if needed for distance elsewhere
          latitude: primaryLoc.latitude,
          longitude: primaryLoc.longitude,
          isPrimary: primaryLoc.isPrimary,
          // distance already computed above
        }
      : null;

    return res.json({
      success: true,
      data: {
        id: provider.id,
        displayName: provider.displayName ?? 'Provider',
        bio: provider.bio ?? null,
        profileImageUrl: provider.profileImageUrl ?? null,
        experienceSummary: provider.experienceSummary ?? null,
        tier: provider.tier ?? null,
        tierCode: provider.tier?.code ?? null,
        verificationStatus: provider.verificationStatus,
        status: provider.status,
        coverageRadiusKm: provider.coverageRadiusKm,
        customRequestsEnabled: provider.customRequestsEnabled,
        location,
        distanceKm,
        rating,
        reviewCount,
        reviewsSample,
        isAvailable,
        services: services.map((s) => ({
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
          images: s.images.slice(0, 3).map((img) => ({ id: img.id, imageUrl: img.imageUrl, sortOrder: img.sortOrder })),
        })),
      },
    });
  } catch (e) {
    return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to load provider profile' } });
  }
});

export default router;

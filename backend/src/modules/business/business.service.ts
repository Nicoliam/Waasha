import * as crypto from 'crypto';
import { prisma } from '../../config/prisma';
import {
  audit,
  canManageBusiness,
  err,
  ownsBusiness,
  ownsUnit,
  requireT3,
  resolveBusinessScope,
  sanitizeText,
} from './business-scope';
import { emitNotification } from '../notifications/notification.service';
import { getMarketplaceConfig } from '../marketplace/marketplace-config.service';

/**
 * Slice 15 — T3 business management.
 *
 * Uses the existing Business/BusinessUnit/BusinessUnitCategory/
 * BusinessStaff/BusinessLocation models only.
 *
 * - Businesses/units/staff are deactivated, never deleted — historical
 *   bookings (businessUnitId snapshots), services and POS rows stay intact.
 * - Changing a unit location never mutates booking_locations snapshots.
 * - Categories: exactly the five launch service_categories; providers
 *   cannot create categories.
 * - No payroll, salary, commission or settlement logic here (non-goals).
 * - No acceptCash toggling here — finance architecture owns it.
 * - Staff invitations mirror the T2 invitation security model.
 */

export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const STAFF_ROLES = ['MANAGER', 'STAFF'] as const;
export const STAFF_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export const UNIT_STATUSES = ['ACTIVE', 'INACTIVE'] as const;

function tokenPair(): { raw: string; hash: string } {
  const raw = crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(raw).digest('hex');
  return { raw, hash };
}

function notify(intent: Parameters<typeof emitNotification>[0]): void {
  try {
    void (emitNotification(intent) as Promise<unknown>).catch(() => {});
  } catch {
    /* notifications never fail domain writes */
  }
}

async function providerUserId(providerId: string): Promise<string | null> {
  try {
    const p = await (prisma as any).providerProfile.findUnique({
      where: { id: providerId },
      select: { userId: true },
    });
    return (p as any)?.userId ?? null;
  } catch {
    return null;
  }
}

async function providerDisplayName(providerId: string): Promise<string | null> {
  try {
    const p = await (prisma as any).providerProfile.findUnique({
      where: { id: providerId },
      select: { displayName: true },
    });
    return (p as any)?.displayName ?? null;
  } catch {
    return null;
  }
}

function rejectForbidden(body: Record<string, unknown>, fields: string[]): void {
  for (const f of fields) {
    if (body[f] !== undefined) throw err(422, 'VALIDATION_ERROR', `${f} must not be supplied`);
  }
}

// ── Business ─────────────────────────────────────────────────────────

function serializeBusiness(b: any, units?: any[]): any {
  return {
    id: b.id,
    uuid: b.uuid ?? null,
    legalName: b.legalName ?? null,
    displayName: b.displayName,
    description: b.description ?? null,
    status: b.status,
    verificationStatus: b.verificationStatus ?? b.verification_status ?? 'UNVERIFIED',
    unitCount: units ? units.length : undefined,
    units: units ?? undefined,
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
  };
}

export async function createBusiness(
  sessionUserId: string,
  input: Record<string, unknown>,
  ctx?: { ip?: string; userAgent?: string },
): Promise<any> {
  const scope = await resolveBusinessScope(sessionUserId);
  requireT3(scope);
  rejectForbidden(input, ['ownerProviderId', 'providerId', 'businessId', 'verificationStatus', 'acceptCash']);

  const displayName = typeof input.displayName === 'string' ? sanitizeText(input.displayName) : '';
  if (!displayName || displayName.length > 120) {
    throw err(422, 'VALIDATION_ERROR', 'displayName is required (max 120 characters)');
  }
  const legalName =
    typeof input.legalName === 'string' && input.legalName.trim().length > 0
      ? sanitizeText(input.legalName)
      : null;
  if (legalName && legalName.length > 200) throw err(422, 'VALIDATION_ERROR', 'legalName is too long');
  const description =
    typeof input.description === 'string' && input.description.trim().length > 0
      ? sanitizeText(input.description)
      : null;
  if (description && description.length > 2000) throw err(422, 'VALIDATION_ERROR', 'description is too long');

  const business = await prisma.business.create({
    data: {
      ownerProviderId: (scope.profile as any).userId,
      legalName,
      displayName,
      description,
      status: 'ACTIVE',
    } as any,
  });
  await audit(sessionUserId, 'BUSINESS_CREATED', 'business', (business as any).id, null, { displayName }, ctx);
  return serializeBusiness(business, []);
}

export async function listBusinesses(sessionUserId: string): Promise<any[]> {
  const scope = await resolveBusinessScope(sessionUserId);
  requireT3(scope);
  if (scope.ownedBusinessIds.length === 0) return [];
  const rows = await prisma.business.findMany({
    where: { id: { in: scope.ownedBusinessIds } },
    orderBy: { createdAt: 'asc' },
  });
  // Managers (non-owners) with staff rows see their businesses read-only.
  const managedIds = scope.staffRows.map((r) => r.businessId).filter((id) => !scope.ownedBusinessIds.includes(id));
  let managed: any[] = [];
  if (managedIds.length > 0) {
    managed = (await prisma.business.findMany({ where: { id: { in: managedIds } } }).catch(() => [])) as any[];
  }
  return [...(rows as any[]), ...managed].map((b) => serializeBusiness(b));
}

async function getOwnedBusinessOrFail(scope: Awaited<ReturnType<typeof resolveBusinessScope>>, businessId: string): Promise<any> {
  const business = await prisma.business.findUnique({ where: { id: businessId } }).catch(() => null);
  // Safe 404 for cross-tenant ids.
  if (!business || !ownsBusiness(scope, businessId)) {
    throw err(404, 'BUSINESS_NOT_FOUND', 'Business not found');
  }
  return business;
}

export async function getBusiness(sessionUserId: string, businessId: string): Promise<any> {
  const scope = await resolveBusinessScope(sessionUserId);
  requireT3(scope);
  const business = await getOwnedBusinessOrFail(scope, businessId);
  const units = await prisma.businessUnit
    .findMany({ where: { businessId }, orderBy: { createdAt: 'asc' } })
    .catch(() => []);
  return serializeBusiness(business, ((units as any[]) ?? []).map(serializeUnit));
}

export async function updateBusiness(
  sessionUserId: string,
  businessId: string,
  input: Record<string, unknown>,
  ctx?: { ip?: string; userAgent?: string },
): Promise<any> {
  const scope = await resolveBusinessScope(sessionUserId);
  requireT3(scope);
  const business = await getOwnedBusinessOrFail(scope, businessId);
  rejectForbidden(input, ['ownerProviderId', 'providerId', 'businessId', 'verificationStatus', 'acceptCash']);

  const data: Record<string, unknown> = {};
  if (input.displayName !== undefined) {
    const v = typeof input.displayName === 'string' ? sanitizeText(input.displayName) : '';
    if (!v || v.length > 120) throw err(422, 'VALIDATION_ERROR', 'displayName is required (max 120 characters)');
    data.displayName = v;
  }
  if (input.legalName !== undefined) {
    if (input.legalName !== null && typeof input.legalName !== 'string') {
      throw err(422, 'VALIDATION_ERROR', 'legalName must be a string or null');
    }
    data.legalName = input.legalName === null ? null : sanitizeText(input.legalName as string);
  }
  if (input.description !== undefined) {
    if (input.description !== null && typeof input.description !== 'string') {
      throw err(422, 'VALIDATION_ERROR', 'description must be a string or null');
    }
    const d = input.description === null ? null : sanitizeText(input.description as string);
    if (d && d.length > 2000) throw err(422, 'VALIDATION_ERROR', 'description is too long');
    data.description = d;
  }
  if (input.status !== undefined) {
    const s = String(input.status).toUpperCase();
    if (!['ACTIVE', 'INACTIVE'].includes(s)) throw err(422, 'VALIDATION_ERROR', 'status must be ACTIVE or INACTIVE');
    data.status = s;
  }
  if (Object.keys(data).length === 0) throw err(422, 'VALIDATION_ERROR', 'Nothing to update');

  const before = {
    displayName: (business as any).displayName,
    legalName: (business as any).legalName,
    description: (business as any).description,
    status: (business as any).status,
  };
  const updated = await prisma.business.update({ where: { id: businessId }, data: data as any });
  await audit(
    sessionUserId,
    (data.status === 'INACTIVE' ? 'BUSINESS_DEACTIVATED' : 'BUSINESS_UPDATED') as string,
    'business',
    businessId,
    before,
    data,
    ctx,
  );
  return serializeBusiness(updated);
}

// ── Units ────────────────────────────────────────────────────────────

function serializeUnit(u: any): any {
  return {
    id: u.id,
    uuid: u.uuid ?? null,
    businessId: u.businessId,
    name: u.name,
    description: u.description ?? null,
    status: u.status,
    coverageRadiusKm: u.coverageRadiusKm ?? 10,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
  };
}

async function validateCoverage(input: unknown): Promise<number> {
  const config = await getMarketplaceConfig();
  const allowed: number[] = (config as any).allowed_provider_coverages_km ?? [10, 15, 20];
  const max: number = (config as any).max_provider_coverage_km ?? 20;
  const v = Number(input);
  if (!Number.isFinite(v) || !allowed.includes(v)) {
    throw err(422, 'INVALID_COVERAGE', `coverageRadiusKm must be one of [${allowed.join(', ')}]`);
  }
  if (v > max) throw err(422, 'COVERAGE_EXCEEDS_MAX', `coverageRadiusKm must not exceed ${max}`);
  return v;
}

export async function createUnit(
  sessionUserId: string,
  businessId: string,
  input: Record<string, unknown>,
  ctx?: { ip?: string; userAgent?: string },
): Promise<any> {
  const scope = await resolveBusinessScope(sessionUserId);
  requireT3(scope);
  await getOwnedBusinessOrFail(scope, businessId);
  rejectForbidden(input, ['businessId', 'providerId', 'ownerProviderId', 'acceptCash']);

  const name = typeof input.name === 'string' ? sanitizeText(input.name) : '';
  if (!name || name.length > 120) throw err(422, 'VALIDATION_ERROR', 'name is required (max 120 characters)');
  const description =
    typeof input.description === 'string' && input.description.trim().length > 0
      ? sanitizeText(input.description)
      : null;
  if (description && description.length > 2000) throw err(422, 'VALIDATION_ERROR', 'description is too long');
  const coverageRadiusKm =
    input.coverageRadiusKm !== undefined ? await validateCoverage(input.coverageRadiusKm) : 10;

  const unit = await prisma.$transaction(async (tx: any) => {
    const created = await tx.businessUnit.create({
      data: { businessId, name, description, status: 'ACTIVE', coverageRadiusKm } as any,
    });
    // Optional initial location + categories in the same transaction.
    if (input.location !== undefined && input.location !== null) {
      await tx.businessLocation.create({
        data: { businessUnitId: (created as any).id, ...validatedLocation(input.location), isPrimary: true } as any,
      });
    }
    if (input.categoryIds !== undefined) {
      const ids = await resolveCategoryIds(input.categoryIds);
      for (const cid of ids) {
        await tx.businessUnitCategory.create({
          data: { businessUnitId: (created as any).id, serviceCategoryId: cid },
        });
      }
    }
    return created;
  });
  await audit(sessionUserId, 'BUSINESS_UNIT_CREATED', 'business_unit', (unit as any).id, null, { businessId, name }, ctx);
  return serializeUnit(unit);
}

export async function listUnits(sessionUserId: string, businessId: string): Promise<any[]> {
  const scope = await resolveBusinessScope(sessionUserId);
  requireT3(scope);
  await getOwnedBusinessOrFail(scope, businessId);
  const rows = await prisma.businessUnit
    .findMany({ where: { businessId }, orderBy: { createdAt: 'asc' } })
    .catch(() => []);
  return ((rows as any[]) ?? []).map(serializeUnit);
}

async function getUnitOrFail(scope: Awaited<ReturnType<typeof resolveBusinessScope>>, unitId: string): Promise<any> {
  const unit = await prisma.businessUnit.findUnique({ where: { id: unitId } }).catch(() => null);
  if (!unit || !ownsUnit(scope, unitId)) throw err(404, 'BUSINESS_UNIT_NOT_FOUND', 'Business unit not found');
  return unit;
}

export async function getUnit(sessionUserId: string, unitId: string): Promise<any> {
  const scope = await resolveBusinessScope(sessionUserId);
  requireT3(scope);
  const unit = await getUnitOrFail(scope, unitId);
  const [locations, categories, services] = await Promise.all([
    prisma.businessLocation.findMany({ where: { businessUnitId: unitId } }).catch(() => []),
    prisma.businessUnitCategory
      .findMany({ where: { businessUnitId: unitId }, include: { category: true } })
      .catch(() => []),
    prisma.service
      .findMany({ where: { businessUnitId: unitId }, select: { id: true, name: true, status: true } })
      .catch(() => []),
  ]);
  return {
    ...serializeUnit(unit),
    locations: ((locations as any[]) ?? []).map((l: any) => ({
      id: l.id,
      label: l.label ?? null,
      addressLine1: l.addressLine1 ?? null,
      city: l.city ?? null,
      province: l.province ?? null,
      postalCode: l.postalCode ?? null,
      country: l.country ?? 'ZA',
      latitude: l.latitude,
      longitude: l.longitude,
      isPrimary: l.isPrimary ?? false,
    })),
    categories: ((categories as any[]) ?? []).map((c: any) => ({
      id: c.category?.id ?? c.serviceCategoryId,
      code: c.category?.code ?? null,
      name: c.category?.name ?? null,
    })),
    services: ((services as any[]) ?? []).map((s: any) => ({ id: s.id, name: s.name, status: s.status })),
  };
}

export async function updateUnit(
  sessionUserId: string,
  unitId: string,
  input: Record<string, unknown>,
  ctx?: { ip?: string; userAgent?: string },
): Promise<any> {
  const scope = await resolveBusinessScope(sessionUserId);
  requireT3(scope);
  const unit = await getUnitOrFail(scope, unitId);
  rejectForbidden(input, ['businessId', 'providerId', 'ownerProviderId', 'acceptCash']);

  const data: Record<string, unknown> = {};
  if (input.name !== undefined) {
    const v = typeof input.name === 'string' ? sanitizeText(input.name) : '';
    if (!v || v.length > 120) throw err(422, 'VALIDATION_ERROR', 'name is required (max 120 characters)');
    data.name = v;
  }
  if (input.description !== undefined) {
    if (input.description !== null && typeof input.description !== 'string') {
      throw err(422, 'VALIDATION_ERROR', 'description must be a string or null');
    }
    data.description = input.description === null ? null : sanitizeText(input.description as string);
  }
  if (input.coverageRadiusKm !== undefined) data.coverageRadiusKm = await validateCoverage(input.coverageRadiusKm);
  if (input.status !== undefined) {
    const s = String(input.status).toUpperCase();
    if (!(UNIT_STATUSES as readonly string[]).includes(s)) {
      throw err(422, 'VALIDATION_ERROR', 'status must be ACTIVE or INACTIVE');
    }
    data.status = s;
  }
  if (Object.keys(data).length === 0) throw err(422, 'VALIDATION_ERROR', 'Nothing to update');

  const before = {
    name: (unit as any).name,
    description: (unit as any).description,
    status: (unit as any).status,
    coverageRadiusKm: (unit as any).coverageRadiusKm,
  };
  const updated = await prisma.businessUnit.update({ where: { id: unitId }, data: data as any });
  const action = data.status === 'INACTIVE' ? 'BUSINESS_UNIT_DEACTIVATED' : data.status === 'ACTIVE' && before.status !== 'ACTIVE' ? 'BUSINESS_UNIT_ACTIVATED' : 'BUSINESS_UNIT_UPDATED';
  await audit(sessionUserId, action, 'business_unit', unitId, before, data, ctx);
  notify({
    recipientUserId: sessionUserId,
    audience: 'PROVIDER',
    type: 'BUSINESS_UNIT_UPDATED',
    title: 'Business unit updated',
    message: `Unit ${(updated as any).name} was updated (${action}).`,
    entityType: 'business_unit',
    entityId: unitId,
    eventKey: `unit:${unitId}:${action}:${Date.now()}`,
  });
  return serializeUnit(updated);
}

export async function setUnitActive(
  sessionUserId: string,
  unitId: string,
  active: boolean,
  ctx?: { ip?: string; userAgent?: string },
): Promise<any> {
  return updateUnit(sessionUserId, unitId, { status: active ? 'ACTIVE' : 'INACTIVE' }, ctx);
}

// ── Unit location ────────────────────────────────────────────────────

function validatedLocation(input: unknown): {
  label: string | null;
  addressLine1: string | null;
  city: string | null;
  province: string | null;
  postalCode: string | null;
  country: string;
  latitude: number;
  longitude: number;
} {
  if (!input || typeof input !== 'object') throw err(422, 'VALIDATION_ERROR', 'location is required');
  const b = input as Record<string, unknown>;
  const latitude = Number(b.latitude);
  const longitude = Number(b.longitude);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    throw err(422, 'VALIDATION_ERROR', 'location.latitude must be between -90 and 90');
  }
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw err(422, 'VALIDATION_ERROR', 'location.longitude must be between -180 and 180');
  }
  const str = (v: unknown, max: number, field: string): string | null => {
    if (v === undefined || v === null || v === '') return null;
    if (typeof v !== 'string') throw err(422, 'VALIDATION_ERROR', `${field} must be a string`);
    const s = sanitizeText(v);
    if (s.length > max) throw err(422, 'VALIDATION_ERROR', `${field} is too long`);
    return s.length === 0 ? null : s;
  };
  return {
    label: str(b.label, 120, 'location.label'),
    addressLine1: str(b.addressLine1, 255, 'location.addressLine1'),
    city: str(b.city, 120, 'location.city'),
    province: str(b.province, 120, 'location.province'),
    postalCode: str(b.postalCode, 20, 'location.postalCode'),
    country: (str(b.country, 2, 'location.country') ?? 'ZA').toUpperCase(),
    latitude,
    longitude,
  };
}

export async function setUnitLocation(
  sessionUserId: string,
  unitId: string,
  input: Record<string, unknown>,
  ctx?: { ip?: string; userAgent?: string },
): Promise<any> {
  const scope = await resolveBusinessScope(sessionUserId);
  requireT3(scope);
  await getUnitOrFail(scope, unitId);
  const loc = validatedLocation(input.location ?? input);

  // Historical booking destinations are snapshots (booking_locations) and
  // are never touched here — only the unit's operational location changes.
  const created = await prisma.businessLocation.create({
    data: { businessUnitId: unitId, ...loc, isPrimary: true } as any,
  });
  // Keep exactly one primary location per unit.
  try {
    const others = await prisma.businessLocation.findMany({ where: { businessUnitId: unitId } }).catch(() => []);
    for (const o of (others as any[]) ?? []) {
      if ((o as any).id !== (created as any).id && (o as any).isPrimary) {
        await prisma.businessLocation.update({ where: { id: (o as any).id }, data: { isPrimary: false } }).catch(() => null);
      }
    }
  } catch {
    /* primary demotion is best-effort */
  }
  await audit(sessionUserId, 'BUSINESS_UNIT_LOCATION_UPDATED', 'business_location', (created as any).id, null, { businessUnitId: unitId }, ctx);
  return created;
}

// ── Unit categories ──────────────────────────────────────────────────

async function resolveCategoryIds(input: unknown): Promise<string[]> {
  if (!Array.isArray(input) || input.length === 0 || input.length > 5) {
    throw err(422, 'VALIDATION_ERROR', 'categoryIds must be a non-empty array (max 5)');
  }
  const unique = [...new Set(input.map((v) => String(v)))];
  const resolved: string[] = [];
  for (const raw of unique) {
    const byId = await prisma.serviceCategory.findUnique({ where: { id: raw } }).catch(() => null);
    if (byId) {
      resolved.push((byId as any).id);
      continue;
    }
    const byCode = await prisma.serviceCategory.findUnique({ where: { code: raw } }).catch(() => null);
    if (!byCode) throw err(422, 'INVALID_CATEGORY', `Unknown category: ${raw}`);
    resolved.push((byCode as any).id);
  }
  return resolved;
}

export async function setUnitCategories(
  sessionUserId: string,
  unitId: string,
  input: Record<string, unknown>,
  ctx?: { ip?: string; userAgent?: string },
): Promise<any[]> {
  const scope = await resolveBusinessScope(sessionUserId);
  requireT3(scope);
  await getUnitOrFail(scope, unitId);
  const ids = await resolveCategoryIds(input.categoryIds);

  const before = await prisma.businessUnitCategory.findMany({ where: { businessUnitId: unitId } }).catch(() => []);
  await prisma.$transaction(async (tx: any) => {
    await tx.businessUnitCategory.deleteMany({ where: { businessUnitId: unitId } });
    for (const cid of ids) {
      await tx.businessUnitCategory.create({ data: { businessUnitId: unitId, serviceCategoryId: cid } });
    }
  });
  await audit(
    sessionUserId,
    'BUSINESS_UNIT_CATEGORIES_UPDATED',
    'business_unit',
    unitId,
    { categoryIds: ((before as any[]) ?? []).map((r: any) => r.serviceCategoryId) },
    { categoryIds: ids },
    ctx,
  );
  const rows = await prisma.businessUnitCategory
    .findMany({ where: { businessUnitId: unitId }, include: { category: true } })
    .catch(() => []);
  return ((rows as any[]) ?? []).map((c: any) => ({
    id: c.category?.id ?? c.serviceCategoryId,
    code: c.category?.code ?? null,
    name: c.category?.name ?? null,
  }));
}

// ── Staff ────────────────────────────────────────────────────────────

function serializeStaff(s: any, displayName?: string | null): any {
  return {
    id: s.id,
    businessId: s.businessId,
    businessUnitId: s.businessUnitId ?? null,
    providerId: s.providerId,
    providerDisplayName: displayName ?? null,
    role: s.role,
    status: s.status,
    joinedAt: s.joinedAt ?? s.createdAt,
  };
}

async function assertCanManageStaff(
  scope: Awaited<ReturnType<typeof resolveBusinessScope>>,
  businessId: string,
): Promise<void> {
  if (!canManageBusiness(scope, businessId)) {
    // Distinguish unknown (404) from forbidden (403).
    const business = await prisma.business.findUnique({ where: { id: businessId } }).catch(() => null);
    if (!business || !scope.ownedBusinessIds.includes(businessId)) {
      const isStaff = scope.staffRows.some((r) => r.businessId === businessId);
      if (!business || !isStaff) throw err(404, 'BUSINESS_NOT_FOUND', 'Business not found');
    }
    throw err(403, 'FORBIDDEN', 'Staff management requires owner or manager permission');
  }
}

export async function listStaff(sessionUserId: string, businessId: string): Promise<any[]> {
  const scope = await resolveBusinessScope(sessionUserId);
  requireT3(scope);
  const business = await prisma.business.findUnique({ where: { id: businessId } }).catch(() => null);
  const visible =
    business &&
    (ownsBusiness(scope, businessId) || scope.staffRows.some((r) => r.businessId === businessId));
  if (!visible) throw err(404, 'BUSINESS_NOT_FOUND', 'Business not found');
  const rows = await prisma.businessStaff
    .findMany({ where: { businessId }, orderBy: { createdAt: 'asc' } })
    .catch(() => []);
  const out: any[] = [];
  for (const r of (rows as any[]) ?? []) {
    out.push(serializeStaff(r, await providerDisplayName((r as any).providerId)));
  }
  return out;
}

export async function addStaff(
  sessionUserId: string,
  businessId: string,
  input: Record<string, unknown>,
  ctx?: { ip?: string; userAgent?: string },
): Promise<any> {
  const scope = await resolveBusinessScope(sessionUserId);
  requireT3(scope);
  await getOwnedBusinessOrFail(scope, businessId);
  await assertCanManageStaff(scope, businessId);

  const providerId = typeof input.providerId === 'string' ? input.providerId.trim() : '';
  if (!providerId) throw err(422, 'VALIDATION_ERROR', 'providerId is required');
  if (providerId === (scope.profile as any).id) {
    throw err(422, 'VALIDATION_ERROR', 'The business owner already operates the business');
  }
  const role = String(input.role ?? 'STAFF').toUpperCase();
  if (!(STAFF_ROLES as readonly string[]).includes(role)) {
    throw err(422, 'VALIDATION_ERROR', 'role must be MANAGER or STAFF');
  }
  let businessUnitId: string | null = null;
  if (input.businessUnitId !== undefined && input.businessUnitId !== null && input.businessUnitId !== '') {
    businessUnitId = String(input.businessUnitId);
    const unit = await prisma.businessUnit.findUnique({ where: { id: businessUnitId } }).catch(() => null);
    if (!unit || (unit as any).businessId !== businessId) {
      throw err(422, 'INVALID_UNIT', 'businessUnitId must belong to this business');
    }
  }

  const target = await (prisma as any).providerProfile
    .findUnique({ where: { id: providerId }, select: { id: true, status: true } })
    .catch(() => null);
  if (!target) throw err(404, 'PROVIDER_NOT_FOUND', 'Provider not found');
  if ((target as any).status !== 'ACTIVE') throw err(422, 'PROVIDER_INACTIVE', 'Provider account is not active');

  const existing = await prisma.businessStaff
    .findFirst({ where: { businessId, providerId } })
    .catch(() => null);
  if (existing) {
    if ((existing as any).status === 'ACTIVE') throw err(409, 'STAFF_EXISTS', 'Provider is already staff');
    const reactivated = await prisma.$transaction(async (tx: any) =>
      tx.businessStaff.update({
        where: { id: (existing as any).id },
        data: { status: 'ACTIVE', role, businessUnitId },
      }),
    );
    await audit(sessionUserId, 'STAFF_ADDED', 'business_staff', (reactivated as any).id, { status: 'INACTIVE' }, { status: 'ACTIVE', role, businessUnitId }, ctx);
    return serializeStaff(reactivated, await providerDisplayName(providerId));
  }

  const row = await prisma.$transaction(async (tx: any) =>
    tx.businessStaff.create({ data: { businessId, businessUnitId, providerId, role, status: 'ACTIVE' } }),
  );
  await audit(sessionUserId, 'STAFF_ADDED', 'business_staff', (row as any).id, null, { businessId, providerId, role, businessUnitId }, ctx);
  const recipient = await providerUserId(providerId);
  if (recipient) {
    notify({
      recipientUserId: recipient,
      audience: 'PROVIDER',
      type: 'STAFF_ADDED',
      title: 'Added to a business',
      message: `You were added to a business as ${role}.`,
      entityType: 'business',
      entityId: businessId,
      eventKey: `staff:${(row as any).id}:added`,
    });
  }
  return serializeStaff(row, await providerDisplayName(providerId));
}

async function getStaffOrFail(scope: Awaited<ReturnType<typeof resolveBusinessScope>>, staffId: string): Promise<any> {
  const row = await prisma.businessStaff.findUnique({ where: { id: staffId } }).catch(() => null);
  if (!row || !ownsBusiness(scope, (row as any).businessId)) {
    throw err(404, 'STAFF_NOT_FOUND', 'Staff not found');
  }
  return row;
}

export async function updateStaff(
  sessionUserId: string,
  staffId: string,
  input: Record<string, unknown>,
  ctx?: { ip?: string; userAgent?: string },
): Promise<any> {
  const scope = await resolveBusinessScope(sessionUserId);
  requireT3(scope);
  const row = await getStaffOrFail(scope, staffId);
  await assertCanManageStaff(scope, (row as any).businessId);
  if (input.providerId !== undefined || input.businessId !== undefined) {
    throw err(422, 'VALIDATION_ERROR', 'providerId/businessId must not be supplied');
  }

  const data: Record<string, unknown> = {};
  if (input.role !== undefined) {
    const role = String(input.role).toUpperCase();
    if (!(STAFF_ROLES as readonly string[]).includes(role) && role !== 'OWNER') {
      throw err(422, 'VALIDATION_ERROR', 'role must be MANAGER or STAFF');
    }
    if (role === 'OWNER') throw err(422, 'VALIDATION_ERROR', 'OWNER is reserved for the business owner');
    data.role = role;
  }
  if (input.status !== undefined) {
    const status = String(input.status).toUpperCase();
    if (!(STAFF_STATUSES as readonly string[]).includes(status)) {
      throw err(422, 'VALIDATION_ERROR', 'status must be ACTIVE or INACTIVE');
    }
    data.status = status;
  }
  if (input.businessUnitId !== undefined) {
    if (input.businessUnitId === null || input.businessUnitId === '') {
      data.businessUnitId = null;
    } else {
      const unitId = String(input.businessUnitId);
      const unit = await prisma.businessUnit.findUnique({ where: { id: unitId } }).catch(() => null);
      if (!unit || (unit as any).businessId !== (row as any).businessId) {
        throw err(422, 'INVALID_UNIT', 'businessUnitId must belong to this business');
      }
      data.businessUnitId = unitId;
    }
  }
  if (Object.keys(data).length === 0) throw err(422, 'VALIDATION_ERROR', 'Nothing to update');

  const before = { role: (row as any).role, status: (row as any).status, businessUnitId: (row as any).businessUnitId };
  const updated = await prisma.$transaction(async (tx: any) =>
    tx.businessStaff.update({ where: { id: staffId }, data: data as any }),
  );
  const unitChanged = data.businessUnitId !== undefined && data.businessUnitId !== before.businessUnitId;
  const action = data.status === 'INACTIVE' ? 'STAFF_REMOVED' : unitChanged ? 'STAFF_ASSIGNED' : 'STAFF_UPDATED';
  await audit(sessionUserId, action, 'business_staff', staffId, before, data, ctx);
  if (data.status === 'INACTIVE' || unitChanged) {
    const recipient = await providerUserId((row as any).providerId);
    if (recipient) {
      notify({
        recipientUserId: recipient,
        audience: 'PROVIDER',
        type: data.status === 'INACTIVE' ? 'STAFF_REMOVED' : 'STAFF_ASSIGNED',
        title: data.status === 'INACTIVE' ? 'Removed from business' : 'Assignment updated',
        message:
          data.status === 'INACTIVE'
            ? 'You were removed from a business. Past bookings and records are unchanged.'
            : 'Your business unit assignment was updated.',
        entityType: 'business',
        entityId: (row as any).businessId,
        eventKey: `staff:${staffId}:${action}:${Date.now()}`,
      });
    }
  }
  return serializeStaff(updated, await providerDisplayName((row as any).providerId));
}

export async function removeStaff(
  sessionUserId: string,
  staffId: string,
  ctx?: { ip?: string; userAgent?: string },
): Promise<any> {
  return updateStaff(sessionUserId, staffId, { status: 'INACTIVE' }, ctx);
}

// ── Service ↔ unit association ───────────────────────────────────────

export async function attachService(
  sessionUserId: string,
  unitId: string,
  serviceId: string,
  ctx?: { ip?: string; userAgent?: string },
): Promise<any> {
  const scope = await resolveBusinessScope(sessionUserId);
  requireT3(scope);
  const unit = await getUnitOrFail(scope, unitId);

  const service = await prisma.service.findUnique({ where: { id: serviceId } }).catch(() => null);
  if (!service) throw err(404, 'SERVICE_NOT_FOUND', 'Service not found');
  const s: any = service;
  const belongs = s.providerId === (scope.profile as any).id || (s.businessUnitId && ownsUnit(scope, s.businessUnitId));
  if (!belongs) throw err(404, 'SERVICE_NOT_FOUND', 'Service not found');
  if (s.businessUnitId === unitId) throw err(409, 'ALREADY_ATTACHED', 'Service is already associated with this unit');

  const updated = await prisma.service.update({ where: { id: serviceId }, data: { businessUnitId: unitId } as any });
  await audit(
    sessionUserId,
    'SERVICE_ASSIGNED',
    'service',
    serviceId,
    { businessUnitId: s.businessUnitId ?? null },
    { businessUnitId: unitId, unitName: (unit as any).name },
    ctx,
  );
  return { id: (updated as any).id, businessUnitId: (updated as any).businessUnitId };
}

export async function detachService(
  sessionUserId: string,
  unitId: string,
  serviceId: string,
  ctx?: { ip?: string; userAgent?: string },
): Promise<any> {
  const scope = await resolveBusinessScope(sessionUserId);
  requireT3(scope);
  await getUnitOrFail(scope, unitId);

  const service = await prisma.service.findUnique({ where: { id: serviceId } }).catch(() => null);
  if (!service || (service as any).businessUnitId !== unitId) {
    throw err(404, 'SERVICE_NOT_FOUND', 'Service not found for this unit');
  }
  // Detach returns the service to provider-level catalogue (history untouched).
  const updated = await prisma.service.update({ where: { id: serviceId }, data: { businessUnitId: null } as any });
  await audit(
    sessionUserId,
    'SERVICE_UNASSIGNED',
    'service',
    serviceId,
    { businessUnitId: unitId },
    { businessUnitId: null },
    ctx,
  );
  return { id: (updated as any).id, businessUnitId: null };
}

// ── Staff invitations ────────────────────────────────────────────────

function serializeStaffInvitation(inv: any): any {
  return {
    id: inv.id,
    businessId: inv.businessId,
    businessUnitId: inv.businessUnitId ?? null,
    invitedProviderId: inv.invitedProviderId ?? null,
    invitedEmail: inv.invitedEmail ?? null,
    role: inv.role,
    status: inv.status,
    expiresAt: inv.expiresAt,
    acceptedAt: inv.acceptedAt ?? null,
    createdAt: inv.createdAt,
  };
}

export async function createStaffInvitation(
  sessionUserId: string,
  businessId: string,
  input: Record<string, unknown>,
  ctx?: { ip?: string; userAgent?: string },
): Promise<any> {
  const scope = await resolveBusinessScope(sessionUserId);
  requireT3(scope);
  await getOwnedBusinessOrFail(scope, businessId);
  await assertCanManageStaff(scope, businessId);

  const role = String(input.role ?? 'STAFF').toUpperCase();
  if (!(STAFF_ROLES as readonly string[]).includes(role)) {
    throw err(422, 'VALIDATION_ERROR', 'role must be MANAGER or STAFF');
  }
  let businessUnitId: string | null = null;
  if (input.businessUnitId !== undefined && input.businessUnitId !== null && input.businessUnitId !== '') {
    businessUnitId = String(input.businessUnitId);
    const unit = await prisma.businessUnit.findUnique({ where: { id: businessUnitId } }).catch(() => null);
    if (!unit || (unit as any).businessId !== businessId) {
      throw err(422, 'INVALID_UNIT', 'businessUnitId must belong to this business');
    }
  }
  const invitedProviderId =
    typeof input.invitedProviderId === 'string' && input.invitedProviderId.trim().length > 0
      ? input.invitedProviderId.trim()
      : null;
  const invitedEmail =
    typeof input.invitedEmail === 'string' && input.invitedEmail.trim().length > 0
      ? input.invitedEmail.trim().toLowerCase()
      : null;
  if (!invitedProviderId && !invitedEmail) {
    throw err(422, 'VALIDATION_ERROR', 'invitedProviderId or invitedEmail is required');
  }
  if (invitedEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(invitedEmail)) {
    throw err(422, 'VALIDATION_ERROR', 'invitedEmail is invalid');
  }
  if (invitedProviderId) {
    if (invitedProviderId === (scope.profile as any).id) {
      throw err(422, 'VALIDATION_ERROR', 'You cannot invite yourself');
    }
    const target = await (prisma as any).providerProfile
      .findUnique({ where: { id: invitedProviderId }, select: { id: true, status: true } })
      .catch(() => null);
    if (!target) throw err(404, 'PROVIDER_NOT_FOUND', 'Provider not found');
    const existing = await prisma.businessStaff
      .findFirst({ where: { businessId, providerId: invitedProviderId } })
      .catch(() => null);
    if (existing && (existing as any).status === 'ACTIVE') {
      throw err(409, 'STAFF_EXISTS', 'Provider is already staff');
    }
  }

  const { raw, hash } = tokenPair();
  const invitation = await prisma.businessStaffInvitation.create({
    data: {
      businessId,
      businessUnitId,
      invitedProviderId,
      invitedEmail,
      role,
      tokenHash: hash,
      status: 'PENDING',
      expiresAt: new Date(Date.now() + INVITATION_TTL_MS),
      createdBy: sessionUserId,
    } as any,
  });
  await audit(sessionUserId, 'STAFF_INVITATION_CREATED', 'business_staff_invitation', (invitation as any).id, null, { businessId, businessUnitId, role }, ctx);
  if (invitedProviderId) {
    const recipient = await providerUserId(invitedProviderId);
    if (recipient) {
      notify({
        recipientUserId: recipient,
        audience: 'PROVIDER',
        type: 'STAFF_INVITATION',
        title: 'Business invitation',
        message: `You were invited to join a business as ${role}.`,
        entityType: 'business',
        entityId: businessId,
        eventKey: `staff-invite:${(invitation as any).id}`,
      });
    }
  }
  return { ...serializeStaffInvitation(invitation), token: raw };
}

export async function listStaffInvitations(sessionUserId: string, businessId: string): Promise<any[]> {
  const scope = await resolveBusinessScope(sessionUserId);
  requireT3(scope);
  const business = await prisma.business.findUnique({ where: { id: businessId } }).catch(() => null);
  const visible =
    business && (ownsBusiness(scope, businessId) || scope.staffRows.some((r) => r.businessId === businessId));
  if (!visible) throw err(404, 'BUSINESS_NOT_FOUND', 'Business not found');
  const rows = await prisma.businessStaffInvitation
    .findMany({ where: { businessId }, orderBy: { createdAt: 'desc' } })
    .catch(() => []);
  return ((rows as any[]) ?? []).map(serializeStaffInvitation);
}

export async function revokeStaffInvitation(
  sessionUserId: string,
  businessId: string,
  invitationId: string,
  ctx?: { ip?: string; userAgent?: string },
): Promise<any> {
  const scope = await resolveBusinessScope(sessionUserId);
  requireT3(scope);
  await getOwnedBusinessOrFail(scope, businessId);
  await assertCanManageStaff(scope, businessId);
  const inv = await prisma.businessStaffInvitation.findUnique({ where: { id: invitationId } }).catch(() => null);
  if (!inv || (inv as any).businessId !== businessId) {
    throw err(404, 'INVITATION_NOT_FOUND', 'Invitation not found');
  }
  if ((inv as any).status !== 'PENDING') throw err(422, 'INVITATION_NOT_PENDING', 'Invitation is no longer pending');
  const updated = await prisma.businessStaffInvitation.update({
    where: { id: invitationId },
    data: { status: 'REVOKED' } as any,
  });
  await audit(sessionUserId, 'STAFF_INVITATION_REVOKED', 'business_staff_invitation', invitationId, { status: 'PENDING' }, { status: 'REVOKED' }, ctx);
  return serializeStaffInvitation(updated);
}

export async function acceptStaffInvitation(
  sessionUserId: string,
  rawToken: string,
  ctx?: { ip?: string; userAgent?: string },
): Promise<any> {
  const scope = await resolveBusinessScope(sessionUserId);
  const hash = crypto.createHash('sha256').update(String(rawToken ?? '')).digest('hex');
  const inv = await prisma.businessStaffInvitation.findUnique({ where: { tokenHash: hash } }).catch(() => null);
  if (!inv) throw err(404, 'INVITATION_NOT_FOUND', 'Invitation not found or invalid');
  const invitation: any = inv;

  const result = await prisma.$transaction(async (tx: any) => {
    const current = await tx.businessStaffInvitation.findUnique({ where: { id: invitation.id } });
    if (!current || (current as any).status !== 'PENDING') {
      throw err(422, 'INVITATION_NOT_PENDING', 'Invitation is no longer pending');
    }
    if (new Date((current as any).expiresAt).getTime() < Date.now()) {
      await tx.businessStaffInvitation.update({ where: { id: invitation.id }, data: { status: 'EXPIRED' } });
      throw err(422, 'INVITATION_EXPIRED', 'Invitation has expired');
    }
    // Scoped acceptance: a provider-scoped invite binds to that provider only —
    // cross-business acceptance is impossible.
    if ((current as any).invitedProviderId && (current as any).invitedProviderId !== (scope.profile as any).id) {
      throw err(403, 'FORBIDDEN', 'This invitation was issued to a different provider');
    }
    const business = await tx.business.findUnique({ where: { id: (current as any).businessId } });
    if (!business || (business as any).status !== 'ACTIVE') {
      throw err(422, 'BUSINESS_INACTIVE', 'Business is no longer active');
    }
    if ((current as any).businessUnitId) {
      const unit = await tx.businessUnit.findUnique({ where: { id: (current as any).businessUnitId } });
      if (!unit || (unit as any).status !== 'ACTIVE') throw err(422, 'UNIT_INACTIVE', 'Business unit is no longer active');
    }
    const dup = await tx.businessStaff
      .findFirst({
        where: { businessId: (current as any).businessId, providerId: (scope.profile as any).id },
      })
      .catch(() => null);
    let staff: any;
    if (dup) {
      staff = await tx.businessStaff.update({
        where: { id: (dup as any).id },
        data: {
          status: 'ACTIVE',
          role: (current as any).role,
          businessUnitId: (current as any).businessUnitId,
        },
      });
    } else {
      staff = await tx.businessStaff.create({
        data: {
          businessId: (current as any).businessId,
          businessUnitId: (current as any).businessUnitId,
          providerId: (scope.profile as any).id,
          role: (current as any).role,
          status: 'ACTIVE',
        },
      });
    }
    const accepted = await tx.businessStaffInvitation.update({
      where: { id: invitation.id },
      data: { status: 'ACCEPTED', acceptedAt: new Date() },
    });
    return { staff, accepted };
  });

  await audit(sessionUserId, 'STAFF_INVITATION_ACCEPTED', 'business_staff_invitation', invitation.id, { status: 'PENDING' }, { status: 'ACCEPTED' }, ctx);
  return { staff: serializeStaff((result as any).staff), businessId: invitation.businessId };
}

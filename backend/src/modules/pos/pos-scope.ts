import { prisma } from '../../config/prisma';

/**
 * Slice 14 — POS/inventory tenant scope.
 *
 * Reuses the existing tenant model; no new role system is invented:
 *  - T1: provider manages their own POS/inventory.
 *  - T2: team membership grants access to the team owner's scope
 *    (existing Team/TeamMember model, ACTIVE rows only).
 *  - T3: owned businesses' units (ownerProviderId) plus units where the
 *    provider is ACTIVE BusinessStaff (existing BusinessStaff model).
 *
 * Provider identity always comes from the authenticated session userId.
 * Never accept providerId/businessId/unitId from the client as authority.
 */

function err(status: number, code: string, message: string, details?: unknown): Error {
  const e: any = new Error(message);
  e.status = status;
  e.code = code;
  if (details !== undefined) e.details = details;
  return e;
}

export interface PosScope {
  profile: any;
  /** Unit ids the session provider may transact under (owned + staff). */
  unitIds: string[];
  /** Provider profile ids whose inventory/sales this session may manage (own + team owners). */
  providerIds: string[];
}

export async function resolvePosScope(providerUserId: string): Promise<PosScope> {
  const profile = await (prisma as any).providerProfile.findUnique({
    where: { userId: providerUserId },
    include: { tier: true },
  });
  if (!profile) throw err(404, 'PROVIDER_NOT_FOUND', 'Provider profile not found');
  if (profile.status !== 'ACTIVE') throw err(403, 'PROVIDER_INACTIVE', 'Provider account is not active');

  const unitIdSet = new Set<string>();
  const providerIdSet = new Set<string>([profile.id]);

  // Owned businesses → units.
  try {
    const businesses =
      ((await (prisma as any).business?.findMany?.({
        where: { ownerProviderId: profile.userId },
        select: { id: true },
      })) as any[]) ?? [];
    if (Array.isArray(businesses) && businesses.length > 0) {
      const units =
        ((await (prisma as any).businessUnit?.findMany?.({
          where: { businessId: { in: businesses.map((b: any) => b.id) } },
          select: { id: true },
        })) as any[]) ?? [];
      for (const u of units as any[]) unitIdSet.add(u.id);
    }
  } catch {
    /* tenant infra unavailable — own scope only */
  }

  // Staff units (existing BusinessStaff model, ACTIVE only).
  try {
    const staffRows =
      ((await (prisma as any).businessStaff?.findMany?.({
        where: { providerId: profile.id, status: 'ACTIVE' },
        select: { businessUnitId: true },
      })) as any[]) ?? [];
    for (const r of staffRows as any[]) {
      if (r?.businessUnitId) unitIdSet.add(r.businessUnitId);
    }
  } catch {
    /* staff table unavailable — ignore */
  }

  // T2 teams: ACTIVE membership grants access to the team owner's scope.
  try {
    const memberships =
      ((await (prisma as any).teamMember?.findMany?.({
        where: { providerId: profile.id, status: 'ACTIVE' },
        select: { teamId: true },
      })) as any[]) ?? [];
    if (Array.isArray(memberships) && memberships.length > 0) {
      const teams =
        ((await (prisma as any).team?.findMany?.({
          where: { id: { in: memberships.map((m: any) => m.teamId) } },
          select: { ownerProviderId: true },
        })) as any[]) ?? [];
      for (const t of teams as any[]) {
        if (!t?.ownerProviderId) continue;
        const owner =
          ((await (prisma as any).providerProfile?.findUnique?.({
            where: { userId: t.ownerProviderId },
            select: { id: true, status: true },
          })) as any) ?? null;
        if (owner && owner.status === 'ACTIVE') providerIdSet.add(owner.id);
      }
    }
  } catch {
    /* team infra unavailable — own scope only */
  }

  return { profile, unitIds: [...unitIdSet], providerIds: [...providerIdSet] };
}

/** Tenant isolation for inventory items and POS sales. */
export function isInPosScope(
  row: { providerId?: string | null; businessUnitId?: string | null },
  scope: PosScope,
): boolean {
  const pid = (scope.profile as any).id;
  if (row.providerId && (row.providerId === pid || scope.providerIds.includes(row.providerId))) return true;
  if (row.businessUnitId && scope.unitIds.includes(row.businessUnitId)) return true;
  return false;
}

/**
 * Resolve the authoritative ownership for a new item/sale.
 * businessUnitId (T3/staff) must be in scope; otherwise the provider's own id is used.
 * Client-supplied providerId is NEVER trusted.
 */
export function resolveOwnership(scope: PosScope, businessUnitId?: string | null): { providerId: string; businessUnitId: string | null } {
  if (businessUnitId) {
    if (!scope.unitIds.includes(businessUnitId)) {
      throw err(403, 'FORBIDDEN', 'Business unit is not in your scope');
    }
    return { providerId: (scope.profile as any).id, businessUnitId };
  }
  return { providerId: (scope.profile as any).id, businessUnitId: null };
}

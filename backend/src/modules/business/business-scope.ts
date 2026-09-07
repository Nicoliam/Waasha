import { prisma } from '../../config/prisma';

/**
 * Slice 15 — T2/T3 business-management tenant scope.
 *
 * Reuses the existing tenant model; no second role system is invented:
 *  - T1: own provider resources only (no team/business management).
 *  - T2: own team (Team where ownerProviderId = session userId) only.
 *  - T3: own businesses + business units (Business.ownerProviderId) only.
 *  - Staff: only the operational unit resources of ACTIVE BusinessStaff rows.
 *
 * Every identity (providerId, businessId, unitId, teamId, staffId) is
 * derived from the authenticated session userId. Client-supplied ids are
 * selectors verified against this scope — never authority.
 */

export function err(status: number, code: string, message: string, details?: unknown): Error {
  const e: any = new Error(message);
  e.status = status;
  e.code = code;
  if (details !== undefined) e.details = details;
  return e;
}

export interface BusinessScope {
  profile: any;
  tierCode: string | null;
  /** Team owned by the session provider (T2). */
  team: any | null;
  /** Businesses owned by the session provider (T3). */
  ownedBusinessIds: string[];
  /** Units of owned businesses. */
  ownedUnitIds: string[];
  /** Units where the session provider is ACTIVE staff. */
  staffUnitIds: string[];
  /** ACTIVE staff rows of the session provider (unit + role). */
  staffRows: Array<{ businessId: string; businessUnitId: string | null; role: string }>;
  /** ACTIVE team memberships of the session provider. */
  teamMemberships: Array<{ teamId: string; role: string; status: string }>;
}

export async function resolveBusinessScope(sessionUserId: string): Promise<BusinessScope> {
  const profile = await (prisma as any).providerProfile.findUnique({
    where: { userId: sessionUserId },
    include: { tier: true },
  });
  if (!profile) throw err(404, 'PROVIDER_NOT_FOUND', 'Provider profile not found');
  if ((profile as any).status !== 'ACTIVE') {
    throw err(403, 'PROVIDER_INACTIVE', 'Provider account is not active');
  }
  const tierCode: string | null = (profile as any).tier?.code ?? null;

  let team: any | null = null;
  try {
    team =
      ((await (prisma as any).team?.findFirst?.({ where: { ownerProviderId: (profile as any).userId } })) as any) ??
      null;
  } catch {
    team = null;
  }

  let ownedBusinessIds: string[] = [];
  let ownedUnitIds: string[] = [];
  try {
    const businesses =
      ((await (prisma as any).business?.findMany?.({
        where: { ownerProviderId: (profile as any).userId },
        select: { id: true },
      })) as any[]) ?? [];
    if (Array.isArray(businesses) && businesses.length > 0) {
      ownedBusinessIds = businesses.map((b: any) => b.id);
      const units =
        ((await (prisma as any).businessUnit?.findMany?.({
          where: { businessId: { in: ownedBusinessIds } },
          select: { id: true },
        })) as any[]) ?? [];
      ownedUnitIds = (units as any[]).map((u: any) => u.id);
    }
  } catch {
    ownedBusinessIds = [];
    ownedUnitIds = [];
  }

  let staffRows: BusinessScope['staffRows'] = [];
  try {
    const rows =
      ((await (prisma as any).businessStaff?.findMany?.({
        where: { providerId: (profile as any).id, status: 'ACTIVE' },
        select: { businessId: true, businessUnitId: true, role: true },
      })) as any[]) ?? [];
    if (Array.isArray(rows)) {
      staffRows = rows.map((r: any) => ({
        businessId: r.businessId,
        businessUnitId: r.businessUnitId ?? null,
        role: String(r.role ?? 'STAFF'),
      }));
    }
  } catch {
    staffRows = [];
  }

  let teamMemberships: BusinessScope['teamMemberships'] = [];
  try {
    const rows =
      ((await (prisma as any).teamMember?.findMany?.({
        where: { providerId: (profile as any).id, status: 'ACTIVE' },
        select: { teamId: true, role: true, status: true },
      })) as any[]) ?? [];
    if (Array.isArray(rows)) {
      teamMemberships = rows.map((r: any) => ({
        teamId: r.teamId,
        role: String(r.role ?? 'PROVIDER'),
        status: String(r.status ?? 'ACTIVE'),
      }));
    }
  } catch {
    teamMemberships = [];
  }

  return {
    profile,
    tierCode,
    team,
    ownedBusinessIds,
    ownedUnitIds,
    staffUnitIds: staffRows.map((r) => r.businessUnitId).filter((v): v is string => !!v),
    staffRows,
    teamMemberships,
  };
}

/** T2 team endpoints require tier T2. T1 (and Student-as-T1) get 403. */
export function requireT2(scope: BusinessScope): void {
  if (scope.tierCode !== 'T2') {
    throw err(403, 'TIER_REQUIRED', 'Team management requires a T2 Teams provider account');
  }
}

/** T3 business endpoints require tier T3. */
export function requireT3(scope: BusinessScope): void {
  if (scope.tierCode !== 'T3') {
    throw err(403, 'TIER_REQUIRED', 'Business management requires a T3 Business provider account');
  }
}

/** True when the session owns the business. */
export function ownsBusiness(scope: BusinessScope, businessId: string): boolean {
  return scope.ownedBusinessIds.includes(businessId);
}

/** True when the session owns the unit (via owned business). */
export function ownsUnit(scope: BusinessScope, unitId: string): boolean {
  return scope.ownedUnitIds.includes(unitId);
}

/** True when the session may operate the unit (owner or ACTIVE staff of that unit). */
export function canOperateUnit(scope: BusinessScope, unitId: string): boolean {
  return scope.ownedUnitIds.includes(unitId) || scope.staffUnitIds.includes(unitId);
}

/** True when the session may manage staff for the business (owner or ACTIVE OWNER/MANAGER staff row). */
export function canManageBusiness(scope: BusinessScope, businessId: string): boolean {
  if (ownsBusiness(scope, businessId)) return true;
  return scope.staffRows.some(
    (r) => r.businessId === businessId && ['OWNER', 'MANAGER'].includes(r.role.toUpperCase()),
  );
}

export async function audit(
  actorUserId: string,
  action: string,
  entityType: string,
  entityId: string | null,
  beforeJson: unknown,
  afterJson: unknown,
  ctx?: { ip?: string; userAgent?: string },
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        actorUserId,
        action,
        entityType,
        entityId,
        beforeJson: (beforeJson as any) ?? undefined,
        afterJson: (afterJson as any) ?? undefined,
        ipAddress: ctx?.ip,
        userAgent: ctx?.userAgent,
      },
    });
  } catch {
    /* audit never rolls back domain writes */
  }
}

export function sanitizeText(value: string): string {
  return value.replace(/<[^>]*>/g, '').trim();
}

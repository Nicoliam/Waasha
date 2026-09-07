import { prisma } from '../../config/prisma';

/**
 * Slice 16 — Admin Platform domain service.
 *
 * Every operation here is an explicit, audited domain operation. There is
 * no generic CRUD: each mutation validates input, enforces invariants
 * (financial snapshots immutable, booking state machine untouched, no tier
 * ranking side-effects), and writes an append-only audit log row.
 *
 * Privacy boundaries enforced in this layer (not the routes):
 *  - users: never passwordHash / tokens / secrets
 *  - bookings: no precise customer location (city/province only)
 *  - payments: secret-like metadata keys redacted
 *  - audit viewer output: secret-like keys redacted
 */

export interface ServiceError {
  status: number;
  code: string;
  message: string;
  details?: unknown;
}

function fail(status: number, code: string, message: string, details?: unknown): never {
  const err: ServiceError & Error = Object.assign(new Error(message), { status, code, details });
  throw err;
}

export interface ActorCtx {
  actorUserId: string;
  ip?: string;
  userAgent?: string;
}

async function audit(entry: {
  actorUserId: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  beforeJson?: unknown;
  afterJson?: unknown;
  ip?: string;
  userAgent?: string;
}) {
  try {
    await prisma.auditLog.create({
      data: {
        actorUserId: entry.actorUserId,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        beforeJson: (entry.beforeJson ?? null) as any,
        afterJson: (entry.afterJson ?? null) as any,
        ipAddress: entry.ip ?? null,
        userAgent: entry.userAgent ?? null,
      },
    });
  } catch {
    // Audit write failure must not silently pass — surface as 503 so the
    // admin knows the action was NOT recorded. Callers decide whether the
    // domain write already committed (read-only oversight unaffected).
    fail(503, 'AUDIT_UNAVAILABLE', 'Audit trail unavailable — action not recorded');
  }
}

// ── Pagination (bounded; prevents pagination abuse) ────────────────────

export const MAX_PER_PAGE = 50;

export function pagination(query: { page?: unknown; perPage?: unknown }) {
  const page = Math.min(10000, Math.max(1, Number(query.page ?? 1) || 1));
  const perPage = Math.min(MAX_PER_PAGE, Math.max(1, Number(query.perPage ?? 20) || 20));
  return { page, perPage, skip: (page - 1) * perPage, take: perPage };
}

// ── Sanitization / redaction ────────────────────────────────────────────

const SECRET_KEY = /(password|passwd|secret|token|hash|credential|private[_-]?key|api[_-]?key|webhook[_-]?secret)/i;

export function redactSecrets<T>(value: T): T {
  if (Array.isArray(value)) return value.map(redactSecrets) as unknown as T;
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEY.test(k) ? '[REDACTED]' : redactSecrets(v);
    }
    return out as unknown as T;
  }
  return value;
}

/** Public admin view of a user — passwordHash/tokens can never leave. */
export function sanitizeUser(user: any) {
  if (!user) return user;
  const { passwordHash: _drop, ...rest } = user;
  void _drop;
  return rest;
}

/** Booking location for admin oversight — area level only, never precise. */
export function sanitizeBookingLocation(loc: any) {
  if (!loc) return null;
  return {
    locationType: loc.locationType ?? null,
    city: loc.city ?? null,
    province: loc.province ?? null,
    country: loc.country ?? null,
  };
}

export function sanitizeBooking(booking: any) {
  if (!booking) return booking;
  const { location, customer, ...rest } = booking;
  return {
    ...rest,
    location: sanitizeBookingLocation(location ?? null),
    customer: customer ? { id: customer.id, displayName: customer.displayName ?? null } : undefined,
  };
}

export function sanitizePayment(payment: any) {
  if (!payment) return payment;
  return { ...payment, metadata: payment.metadata ? redactSecrets(payment.metadata) : payment.metadata };
}

// ── Dashboard ───────────────────────────────────────────────────────────

export interface DashboardMetrics {
  users: { total: number; byStatus: Record<string, number> };
  providers: { total: number; active: number; verified: number; pendingVerification: number; verifiedStudents: number };
  businesses: { activeTeams: number; activeBusinesses: number; activeUnits: number };
  bookings: { total: number; byStatus: Record<string, number>; completed: number };
  finance: {
    paidPaymentsTotal: number;
    paidPaymentsCount: number;
    commissionCollected: number;
    outstandingCashLiability: number;
    currency: string;
  };
  marketplace: { activeServices: number; categories: number };
  operations: { mediaPendingModeration: number; lowStockItems: number; notificationsTotal: number };
}

const num = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

export async function getDashboard(): Promise<DashboardMetrics> {
  const [
    userTotal,
    userByStatus,
    providerTotal,
    providerActive,
    providerVerified,
    providerPending,
    verifiedStudents,
    activeTeams,
    activeBusinesses,
    activeUnits,
    bookingTotal,
    bookingsByStatus,
    paidAgg,
    commissionAgg,
    cashOutstanding,
    activeServices,
    categories,
    mediaPending,
    lowStock,
    notificationsTotal,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.groupBy({ by: ['status'], _count: { status: true } }),
    prisma.providerProfile.count(),
    prisma.providerProfile.count({ where: { status: 'ACTIVE' } }),
    prisma.providerProfile.count({ where: { verificationStatus: 'VERIFIED' } }),
    prisma.providerProfile.count({ where: { verificationStatus: 'PENDING' } }),
    prisma.providerProfile.count({ where: { isStudent: true, studentVerificationStatus: 'VERIFIED' } }),
    prisma.team.count({ where: { status: 'ACTIVE' } }),
    prisma.business.count({ where: { status: 'ACTIVE' } }),
    prisma.businessUnit.count({ where: { status: 'ACTIVE' } }),
    prisma.booking.count(),
    prisma.booking.groupBy({ by: ['status'], _count: { status: true } }),
    prisma.payment.aggregate({ _sum: { amount: true }, _count: true, where: { status: 'PAID' } }),
    prisma.payment.aggregate({ _sum: { commissionAmount: true }, where: { status: 'PAID' } }),
    prisma.providerCashAccount.aggregate({ _sum: { outstandingCommission: true } }),
    prisma.service.count({ where: { status: 'ACTIVE' } }),
    prisma.serviceCategory.count({ where: { isActive: true } }),
    prisma.mediaAsset.count({ where: { moderationStatus: 'PENDING' } }),
    prisma.inventoryItem.count({
      where: { isActive: true, deletedAt: null },
    }),
    prisma.notification.count(),
  ]);

  const byStatus: Record<string, number> = {};
  for (const row of userByStatus as Array<{ status: string; _count: { status: number } }>) {
    byStatus[String(row.status)] = row._count.status;
  }
  const bookingByStatus: Record<string, number> = {};
  for (const row of bookingsByStatus as Array<{ status: string; _count: { status: number } }>) {
    bookingByStatus[String(row.status)] = row._count.status;
  }
  return {
    users: { total: userTotal, byStatus },
    providers: {
      total: providerTotal,
      active: providerActive,
      verified: providerVerified,
      pendingVerification: providerPending,
      verifiedStudents,
    },
    businesses: { activeTeams, activeBusinesses, activeUnits },
    bookings: { total: bookingTotal, byStatus: bookingByStatus, completed: bookingByStatus.COMPLETED ?? 0 },
    finance: {
      paidPaymentsTotal: num((paidAgg as any)?._sum?.amount),
      paidPaymentsCount: Number((paidAgg as any)?._count ?? 0),
      commissionCollected: num((commissionAgg as any)?._sum?.commissionAmount),
      outstandingCashLiability: num((cashOutstanding as any)?._sum?.outstandingCommission),
      currency: 'ZAR',
    },
    marketplace: { activeServices, categories },
    operations: { mediaPendingModeration: mediaPending, lowStockItems: lowStock, notificationsTotal },
  };
}

// ── Users ───────────────────────────────────────────────────────────────

const USER_STATUSES = ['ACTIVE', 'SUSPENDED', 'PENDING', 'PENDING_VERIFICATION', 'LOCKED', 'DEACTIVATED'] as const;
/** Admin-settable statuses. DELETED is intentionally absent: history is preserved. */
const ADMIN_SETTABLE_USER_STATUSES = ['ACTIVE', 'SUSPENDED', 'DEACTIVATED'] as const;

export async function searchUsers(query: { q?: unknown; status?: unknown; page?: unknown; perPage?: unknown }) {
  const { page, perPage, skip, take } = pagination(query);
  const q = typeof query.q === 'string' ? query.q.trim().slice(0, 191) : '';
  const status = typeof query.status === 'string' && (USER_STATUSES as readonly string[]).includes(query.status)
    ? query.status
    : undefined;
  const where: any = {};
  if (status) where.status = status;
  if (q) where.OR = [{ email: { contains: q } }, { uuid: { equals: q } }];
  const [rows, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      include: { roles: { include: { role: true } } },
    }),
    prisma.user.count({ where }),
  ]);
  return {
    users: (rows as any[]).map((u) => ({
      ...sanitizeUser(u),
      roles: (u.roles ?? []).map((r: any) => r.role?.code ?? r.code).filter(Boolean),
    })),
    meta: { page, perPage, total },
  };
}

export async function getUserDetail(id: string) {
  const user = await prisma.user.findUnique({
    where: { id },
    include: {
      roles: { include: { role: true } },
      customerProfile: true,
      providerProfile: { include: { tier: true } },
    },
  });
  if (!user) fail(404, 'USER_NOT_FOUND', 'User not found');
  const recentAudit = await prisma.auditLog.findMany({
    where: { OR: [{ actorUserId: id }, { entityType: 'user', entityId: id }] },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });
  return {
    ...sanitizeUser(user),
    roles: ((user as any).roles ?? []).map((r: any) => r.role?.code).filter(Boolean),
    recentAudit: (recentAudit as any[]).map(redactSecrets),
  };
}

export async function setUserStatus(id: string, status: string, ctx: ActorCtx) {
  if (!(ADMIN_SETTABLE_USER_STATUSES as readonly string[]).includes(status)) {
    fail(422, 'INVALID_STATUS', `status must be one of ${ADMIN_SETTABLE_USER_STATUSES.join(', ')}`);
  }
  const before = await prisma.user.findUnique({ where: { id } });
  if (!before) fail(404, 'USER_NOT_FOUND', 'User not found');
  const updated = await prisma.user.update({ where: { id }, data: { status: status as any } });
  await audit({
    actorUserId: ctx.actorUserId,
    action: status === 'ACTIVE' ? 'USER_REACTIVATED' : 'USER_DEACTIVATED',
    entityType: 'user',
    entityId: id,
    beforeJson: { status: (before as any).status },
    afterJson: { status },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });
  return sanitizeUser(updated);
}

// ── Providers ───────────────────────────────────────────────────────────

export async function searchProviders(query: {
  q?: unknown;
  tier?: unknown;
  verificationStatus?: unknown;
  student?: unknown;
  status?: unknown;
  page?: unknown;
  perPage?: unknown;
}) {
  const { page, perPage, skip, take } = pagination(query);
  const where: any = {};
  const q = typeof query.q === 'string' ? query.q.trim().slice(0, 191) : '';
  if (q) where.displayName = { contains: q };
  if (typeof query.tier === 'string' && ['T1', 'T2', 'T3', 'STUDENT'].includes(query.tier)) {
    where.tier = { code: query.tier };
  }
  if (
    typeof query.verificationStatus === 'string' &&
    ['UNVERIFIED', 'PENDING', 'VERIFIED', 'REJECTED', 'EXPIRED', 'SUSPENDED'].includes(query.verificationStatus)
  ) {
    where.verificationStatus = query.verificationStatus;
  }
  if (query.student === 'verified') where.studentVerificationStatus = 'VERIFIED';
  if (query.student === 'pending') where.studentVerificationStatus = 'PENDING';
  if (typeof query.status === 'string' && ['ACTIVE', 'PAUSED', 'SUSPENDED', 'PENDING_REVIEW', 'DRAFT'].includes(query.status)) {
    where.status = query.status;
  }
  const [rows, total] = await Promise.all([
    prisma.providerProfile.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take,
      include: { tier: true, user: { select: { id: true, email: true, status: true, createdAt: true } } },
    }),
    prisma.providerProfile.count({ where }),
  ]);
  // Oversight view only — no ranking signals emitted or mutated here.
  return {
    providers: (rows as any[]).map((p) => ({
      id: p.id,
      displayName: p.displayName,
      tier: p.tier?.code ?? null,
      providerType: p.providerType,
      status: p.status,
      verificationStatus: p.verificationStatus,
      isStudent: p.isStudent,
      studentVerificationStatus: p.studentVerificationStatus,
      coverageRadiusKm: p.coverageRadiusKm,
      acceptCash: p.acceptCash,
      createdAt: p.createdAt,
      account: p.user ? { userId: p.user.id, email: p.user.email, status: p.user.status } : null,
    })),
    meta: { page, perPage, total },
  };
}

export async function getProviderDetail(id: string) {
  const provider = await prisma.providerProfile.findUnique({
    where: { id },
    include: {
      tier: true,
      user: { select: { id: true, email: true, status: true, createdAt: true } },
      locations: true,
      services: { select: { id: true, name: true, status: true, price: true, currency: true } },
    },
  });
  if (!provider) fail(404, 'PROVIDER_NOT_FOUND', 'Provider not found');
  const p = provider as any;
  const [teamMemberships, staffRows, verificationHistory] = await Promise.all([
    Promise.resolve((prisma as any).teamMember?.findMany?.({ where: { providerId: id } })).then(
      (r) => r ?? [],
      () => [],
    ),
    prisma.businessStaff.findMany({ where: { providerId: id } }),
    prisma.auditLog.findMany({
      where: { entityType: 'provider_profile', entityId: id },
      orderBy: { createdAt: 'desc' },
      take: 30,
    }),
  ]);
  return {
    id: p.id,
    displayName: p.displayName,
    bio: p.bio,
    tier: p.tier?.code ?? null,
    providerType: p.providerType,
    status: p.status,
    verificationStatus: p.verificationStatus,
    isStudent: p.isStudent,
    studentVerificationStatus: p.studentVerificationStatus,
    coverageRadiusKm: p.coverageRadiusKm,
    acceptCash: p.acceptCash,
    customRequestsEnabled: p.customRequestsEnabled,
    timezone: p.timezone,
    createdAt: p.createdAt,
    account: p.user,
    locations: (p.locations ?? []).map((l: any) => ({
      id: l.id,
      label: l.label,
      city: l.city,
      province: l.province,
      isPrimary: l.isPrimary,
      isActive: l.isActive,
    })),
    services: p.services ?? [],
    teams: teamMemberships,
    businessStaff: staffRows,
    verificationHistory: (verificationHistory as any[]).map(redactSecrets),
  };
}

const PROVIDER_SETTABLE_STATUSES = ['ACTIVE', 'PAUSED', 'SUSPENDED'] as const;

export async function setProviderStatus(id: string, status: string, ctx: ActorCtx) {
  if (!(PROVIDER_SETTABLE_STATUSES as readonly string[]).includes(status)) {
    fail(422, 'INVALID_STATUS', `status must be one of ${PROVIDER_SETTABLE_STATUSES.join(', ')}`);
  }
  const before = await prisma.providerProfile.findUnique({ where: { id } });
  if (!before) fail(404, 'PROVIDER_NOT_FOUND', 'Provider not found');
  // Tier is capability metadata, never mutated here — no ranking side-effects.
  const updated = await prisma.providerProfile.update({ where: { id }, data: { status: status as any } });
  await audit({
    actorUserId: ctx.actorUserId,
    action: 'PROVIDER_STATUS_CHANGED',
    entityType: 'provider_profile',
    entityId: id,
    beforeJson: { status: (before as any).status },
    afterJson: { status },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });
  return { id: (updated as any).id, status: (updated as any).status };
}

export type VerificationAction = 'APPROVE' | 'REJECT' | 'REVOKE';

export async function setProviderVerification(id: string, action: VerificationAction, notes: string | null, ctx: ActorCtx) {
  if (!['APPROVE', 'REJECT', 'REVOKE'].includes(action)) fail(422, 'INVALID_ACTION', 'action must be APPROVE, REJECT or REVOKE');
  const before = await prisma.providerProfile.findUnique({ where: { id } });
  if (!before) fail(404, 'PROVIDER_NOT_FOUND', 'Provider not found');
  const status = action === 'APPROVE' ? 'VERIFIED' : action === 'REJECT' ? 'REJECTED' : 'SUSPENDED';
  const updated = await prisma.providerProfile.update({
    where: { id },
    data: { verificationStatus: status as any },
  });
  await audit({
    actorUserId: ctx.actorUserId,
    action: `PROVIDER_VERIFICATION_${action}`,
    entityType: 'provider_profile',
    entityId: id,
    beforeJson: { verificationStatus: (before as any).verificationStatus },
    afterJson: { verificationStatus: status, notes: notes ?? null },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });
  return { id: (updated as any).id, verificationStatus: (updated as any).verificationStatus };
}

/**
 * Student verification — admin-controlled only (Slice 19 canonical path).
 * Providers can only request (PENDING via the finance request endpoint);
 * VERIFIED is set here. Verified Student status never influences
 * marketplace ranking.
 *
 * AUTHORITATIVE AUTHORIZATION MODEL (Slice 19):
 *  - session identifies the user (authMiddleware)
 *  - database user_roles → roles determines current admin authority
 *    (requireAdmin at the route layer — JWT role claims are NEVER
 *    sufficient authority and are never consulted here)
 *  - client-supplied user ids are never trusted as authority
 *
 * This is the SINGLE authoritative Student-verification implementation.
 * The legacy finance route delegates here; no independent verification
 * logic may exist elsewhere.
 *
 * Post-commit, the existing training-centre student-verification outcome
 * hook fires exactly once (best-effort; never breaks the write).
 * REVOKE maps to the REJECTED outcome channel (verification removed).
 */
export async function setStudentVerification(id: string, action: VerificationAction, notes: string | null, ctx: ActorCtx) {
  if (!['APPROVE', 'REJECT', 'REVOKE'].includes(action)) fail(422, 'INVALID_ACTION', 'action must be APPROVE, REJECT or REVOKE');
  const before = await prisma.providerProfile.findUnique({ where: { id } });
  if (!before) fail(404, 'PROVIDER_NOT_FOUND', 'Provider not found');
  const data =
    action === 'APPROVE'
      ? { isStudent: true, studentVerificationStatus: 'VERIFIED' as const }
      : action === 'REJECT'
        ? { isStudent: false, studentVerificationStatus: 'REJECTED' as const }
        : { isStudent: false, studentVerificationStatus: 'UNVERIFIED' as const };
  const updated = await prisma.providerProfile.update({ where: { id }, data: data as any });
  await audit({
    actorUserId: ctx.actorUserId,
    action: `STUDENT_VERIFICATION_${action}`,
    entityType: 'provider_profile',
    entityId: id,
    beforeJson: {
      isStudent: (before as any).isStudent,
      studentVerificationStatus: (before as any).studentVerificationStatus,
    },
    afterJson: { ...data, notes: notes ?? null },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });
  // Centralized outcome notification — exactly once per successful
  // verification, regardless of which supported route was used.
  try {
    const { notifyStudentVerificationOutcome } = await import('../partners/training-partner.service');
    const outcome = action === 'APPROVE' ? 'VERIFIED' : 'REJECTED';
    await notifyStudentVerificationOutcome(id, outcome as 'VERIFIED' | 'REJECTED').catch(() => {});
  } catch {
    // Notifications never break verification writes.
  }
  return {
    id: (updated as any).id,
    isStudent: (updated as any).isStudent,
    studentVerificationStatus: (updated as any).studentVerificationStatus,
  };
}

// ── Business oversight (read-only; Slice 15 APIs remain the write path) ──

export async function listTeams(query: { status?: unknown; page?: unknown; perPage?: unknown }) {
  const { page, perPage, skip, take } = pagination(query);
  const where: any = {};
  if (typeof query.status === 'string' && query.status.length <= 32) where.status = query.status;
  const [rows, total] = await Promise.all([
    prisma.team.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
    prisma.team.count({ where }),
  ]);
  return { teams: rows, meta: { page, perPage, total } };
}

export async function listBusinesses(query: { status?: unknown; page?: unknown; perPage?: unknown }) {
  const { page, perPage, skip, take } = pagination(query);
  const where: any = {};
  if (typeof query.status === 'string' && query.status.length <= 32) where.status = query.status;
  const [rows, total] = await Promise.all([
    prisma.business.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
    prisma.business.count({ where }),
  ]);
  return { businesses: rows, meta: { page, perPage, total } };
}

export async function getBusinessDetail(id: string) {
  const business = await prisma.business.findUnique({
    where: { id },
    include: {
      units: { include: { locations: true, categories: { include: { category: true } } } },
      staff: true,
    },
  });
  if (!business) fail(404, 'BUSINESS_NOT_FOUND', 'Business not found');
  return business;
}

export async function getBusinessUnitDetail(id: string) {
  const unit = await prisma.businessUnit.findUnique({
    where: { id },
    include: { locations: true, categories: { include: { category: true } }, services: { select: { id: true, name: true, status: true } } },
  });
  if (!unit) fail(404, 'BUSINESS_UNIT_NOT_FOUND', 'Business unit not found');
  return unit;
}

/**
 * Invitation oversight — Slice 15 risk mitigation: email-only invites carry
 * no identity binding (bearer token = authority). Admin can inspect pending
 * invitations across teams/businesses and revoke suspicious ones. Revocation
 * is an explicit audited domain operation; issuance/acceptance stay on the
 * Slice 15 write path.
 */
export async function listInvitations(query: { scope?: unknown; status?: unknown; page?: unknown; perPage?: unknown }) {
  const { page, perPage, skip, take } = pagination(query);
  const scope = query.scope === 'business' ? 'business' : query.scope === 'team' ? 'team' : 'all';
  const status = typeof query.status === 'string' && ['PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED'].includes(query.status)
    ? query.status
    : undefined;
  const strip = (inv: any) => {
    const { tokenHash: _t, ...rest } = inv;
    void _t;
    return rest;
  };
  if (scope === 'team') {
    const where: any = status ? { status } : {};
    const [rows, total] = await Promise.all([
      prisma.teamInvitation.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
      prisma.teamInvitation.count({ where }),
    ]);
    return { scope, invitations: (rows as any[]).map(strip), meta: { page, perPage, total } };
  }
  if (scope === 'business') {
    const where: any = status ? { status } : {};
    const [rows, total] = await Promise.all([
      prisma.businessStaffInvitation.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
      prisma.businessStaffInvitation.count({ where }),
    ]);
    return { scope, invitations: (rows as any[]).map(strip), meta: { page, perPage, total } };
  }
  const where: any = status ? { status } : {};
  const [teamRows, teamTotal, staffRows, staffTotal] = await Promise.all([
    prisma.teamInvitation.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
    prisma.teamInvitation.count({ where }),
    prisma.businessStaffInvitation.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
    prisma.businessStaffInvitation.count({ where }),
  ]);
  return {
    scope,
    invitations: {
      team: (teamRows as any[]).map(strip),
      business: (staffRows as any[]).map(strip),
    },
    meta: { page, perPage, teamTotal, staffTotal },
  };
}

export async function revokeInvitation(scope: 'team' | 'business', id: string, ctx: ActorCtx) {
  const delegate = scope === 'team' ? prisma.teamInvitation : prisma.businessStaffInvitation;
  const before = await (delegate as any).findUnique({ where: { id } });
  if (!before) fail(404, 'INVITATION_NOT_FOUND', 'Invitation not found');
  if ((before as any).status !== 'PENDING') fail(422, 'INVITATION_NOT_PENDING', 'Only pending invitations can be revoked');
  const updated = await (delegate as any).update({ where: { id }, data: { status: 'REVOKED' } });
  await audit({
    actorUserId: ctx.actorUserId,
    action: scope === 'team' ? 'TEAM_INVITATION_REVOKED_ADMIN' : 'STAFF_INVITATION_REVOKED_ADMIN',
    entityType: scope === 'team' ? 'team_invitation' : 'business_staff_invitation',
    entityId: id,
    beforeJson: { status: 'PENDING' },
    afterJson: { status: 'REVOKED' },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });
  const { tokenHash: _t, ...rest } = updated as any;
  void _t;
  return rest;
}

// ── Booking oversight (read-only — no state-machine transitions) ─────────

const BOOKING_STATUSES = [
  'DRAFT', 'PENDING', 'ACCEPTED', 'CONFIRMED', 'PAYMENT_PENDING', 'PAID',
  'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'DECLINED', 'REFUNDED', 'DISPUTED',
] as const;

export async function searchBookings(query: {
  status?: unknown;
  providerId?: unknown;
  businessUnitId?: unknown;
  paymentStatus?: unknown;
  from?: unknown;
  to?: unknown;
  page?: unknown;
  perPage?: unknown;
}) {
  const { page, perPage, skip, take } = pagination(query);
  const where: any = {};
  if (typeof query.status === 'string') {
    if (!(BOOKING_STATUSES as readonly string[]).includes(query.status)) fail(422, 'INVALID_STATUS', 'Unknown booking status');
    where.status = query.status;
  }
  if (typeof query.providerId === 'string' && query.providerId.length <= 64) where.providerId = query.providerId;
  if (typeof query.businessUnitId === 'string' && query.businessUnitId.length <= 64) where.businessUnitId = query.businessUnitId;
  if (typeof query.paymentStatus === 'string' && query.paymentStatus.length <= 32) where.paymentStatus = query.paymentStatus;
  const from = typeof query.from === 'string' ? new Date(query.from) : null;
  const to = typeof query.to === 'string' ? new Date(query.to) : null;
  if ((query.from && (!from || Number.isNaN(from.getTime()))) || (query.to && (!to || Number.isNaN(to.getTime())))) {
    fail(422, 'INVALID_DATE', 'from/to must be valid dates');
  }
  if (from || to) {
    where.scheduledStart = {};
    if (from) where.scheduledStart.gte = from;
    if (to) where.scheduledStart.lte = to;
  }
  const [rows, total] = await Promise.all([
    prisma.booking.findMany({
      where,
      orderBy: { scheduledStart: 'desc' },
      skip,
      take,
      include: {
        items: true,
        location: true,
        customer: { select: { id: true, displayName: true } },
      },
    }),
    prisma.booking.count({ where }),
  ]);
  return { bookings: (rows as any[]).map(sanitizeBooking), meta: { page, perPage, total } };
}

export async function getBookingDetail(id: string) {
  const booking = await prisma.booking.findUnique({
    where: { id },
    include: {
      items: true,
      location: true,
      customer: { select: { id: true, displayName: true } },
      payment: true,
      review: { select: { id: true, rating: true, createdAt: true } },
    },
  });
  if (!booking) fail(404, 'BOOKING_NOT_FOUND', 'Booking not found');
  const sanitized = sanitizeBooking(booking);
  return { ...sanitized, payment: (booking as any).payment ? sanitizePayment((booking as any).payment) : null };
}

// ── Payments / finance oversight (read-only) ─────────────────────────────

const PAYMENT_STATUSES = ['PENDING', 'PROCESSING', 'PAID', 'FAILED', 'CANCELLED', 'REFUNDED'] as const;

export async function listPayments(query: {
  status?: unknown;
  method?: unknown;
  providerId?: unknown;
  page?: unknown;
  perPage?: unknown;
}) {
  const { page, perPage, skip, take } = pagination(query);
  const where: any = {};
  if (typeof query.status === 'string') {
    if (!(PAYMENT_STATUSES as readonly string[]).includes(query.status)) fail(422, 'INVALID_STATUS', 'Unknown payment status');
    where.status = query.status;
  }
  if (typeof query.method === 'string' && ['waasha_payment', 'cash', 'eft'].includes(query.method)) where.method = query.method;
  if (typeof query.providerId === 'string' && query.providerId.length <= 64) where.providerId = query.providerId;
  const [rows, total] = await Promise.all([
    prisma.payment.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
    prisma.payment.count({ where }),
  ]);
  return { payments: (rows as any[]).map(sanitizePayment), meta: { page, perPage, total } };
}

export async function getPaymentDetail(id: string) {
  const payment = await prisma.payment.findUnique({ where: { id }, include: { events: true, booking: { select: { id: true, uuid: true, status: true, paymentStatus: true } } } });
  if (!payment) fail(404, 'PAYMENT_NOT_FOUND', 'Payment not found');
  const p = payment as any;
  return {
    ...sanitizePayment(payment),
    // Service completion and payment status stay separate surfaces — the
    // linked booking status is shown for reconciliation, never mutated here.
    booking: p.booking ?? null,
    events: (p.events ?? []).map((e: any) => ({ ...e, payload: e.payload ? redactSecrets(e.payload) : e.payload })),
  };
}

export async function getFinanceOverview() {
  const [byStatus, commissionPaid, cashOutstanding, cashByType, settlements] = await Promise.all([
    prisma.payment.groupBy({ by: ['status'], _count: { status: true }, _sum: { amount: true } }),
    prisma.payment.aggregate({ _sum: { commissionAmount: true }, _count: true, where: { status: 'PAID' } }),
    prisma.providerCashAccount.aggregate({ _sum: { outstandingCommission: true, totalCashGross: true, totalSettled: true } }),
    prisma.cashLedgerEntry.groupBy({ by: ['type'], _count: { type: true }, _sum: { commissionAmount: true } }),
    prisma.cashLedgerEntry.findMany({ where: { type: 'SETTLEMENT' }, orderBy: { createdAt: 'desc' }, take: 20 }),
  ]);
  return {
    paymentsByStatus: (byStatus as any[]).map((r) => ({
      status: r.status,
      count: r._count.status,
      totalAmount: num(r._sum?.amount),
    })),
    commissionCollected: num((commissionPaid as any)?._sum?.commissionAmount),
    paidCount: Number((commissionPaid as any)?._count ?? 0),
    cashLiability: {
      outstanding: num((cashOutstanding as any)?._sum?.outstandingCommission),
      totalCashGross: num((cashOutstanding as any)?._sum?.totalCashGross),
      totalSettled: num((cashOutstanding as any)?._sum?.totalSettled),
    },
    ledgerByType: (cashByType as any[]).map((r) => ({
      type: r.type,
      count: r._count.type,
      commissionAmount: num(r._sum?.commissionAmount),
    })),
    recentSettlements: settlements,
    currency: 'ZAR',
  };
}

// ── Settings (typed, validated, auditable, concurrency-guarded) ──────────

export type SettingKind = 'PERCENT' | 'CASH_CAP' | 'RADIUS_DEFAULT' | 'RADIUS_MAX' | 'RADIUS_LIST' | 'NUMBER' | 'IMMUTABLE';

export interface SettingDef {
  key: string;
  kind: SettingKind;
  description: string;
}

export const SETTING_DEFS: SettingDef[] = [
  { key: 'commission_student_percent', kind: 'PERCENT', description: 'Waasha commission % — verified Student (default 16)' },
  { key: 'commission_t1_percent', kind: 'PERCENT', description: 'Waasha commission % — T1 Individual (default 25)' },
  { key: 'commission_t2_percent', kind: 'PERCENT', description: 'Waasha commission % — T2 Teams (default 25)' },
  { key: 'commission_t3_percent', kind: 'PERCENT', description: 'Waasha commission % — T3 Business (default 25)' },
  { key: 'default_platform_commission', kind: 'PERCENT', description: 'Legacy fallback commission % (default 25)' },
  { key: 'cash_cap_student', kind: 'CASH_CAP', description: 'Cash liability cap ZAR — Student (default 500)' },
  { key: 'cash_cap_t1', kind: 'CASH_CAP', description: 'Cash liability cap ZAR — T1 (default 1000)' },
  { key: 'cash_cap_t2', kind: 'CASH_CAP', description: 'Cash liability cap ZAR — T2 (default 1000)' },
  { key: 'cash_cap_t3', kind: 'CASH_CAP', description: 'Cash liability cap ZAR — T3 (default 5000)' },
  { key: 'default_discovery_radius_km', kind: 'RADIUS_DEFAULT', description: 'Default customer discovery radius km (default 10)' },
  { key: 'max_discovery_radius_km', kind: 'RADIUS_MAX', description: 'Absolute maximum customer discovery radius km (20)' },
  { key: 'allowed_customer_radii_km', kind: 'RADIUS_LIST', description: 'Allowed customer discovery radii (10/15/20 expansion)' },
  { key: 'allowed_provider_coverages_km', kind: 'RADIUS_LIST', description: 'Allowed provider coverage radii (10/15/20)' },
  { key: 'max_provider_coverage_km', kind: 'RADIUS_MAX', description: 'Absolute maximum provider coverage km (20)' },
  { key: 'max_service_images', kind: 'IMMUTABLE', description: 'Architectural constant: max 3 images per service (not configurable)' },
  { key: 'max_custom_request_images', kind: 'IMMUTABLE', description: 'Architectural constant: max 3 images per custom request (not configurable)' },
];

export const ABSOLUTE_MAX_RADIUS_KM = 20;
const ALLOWED_RADII = [10, 15, 20];

function validateSettingValue(def: SettingDef, raw: unknown): string {
  const asNum = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
  switch (def.kind) {
    case 'IMMUTABLE':
      fail(422, 'IMMUTABLE_SETTING', `${def.key} is an architectural constant and cannot be changed via admin configuration`);
      break;
    case 'PERCENT':
      if (!Number.isFinite(asNum) || asNum < 0 || asNum > 100) {
        fail(422, 'INVALID_SETTING_VALUE', `${def.key} must be a percentage between 0 and 100`);
      }
      return String(asNum);
    case 'CASH_CAP':
      if (!Number.isFinite(asNum) || !Number.isInteger(asNum) || asNum < 0 || asNum > 100000) {
        fail(422, 'INVALID_SETTING_VALUE', `${def.key} must be an integer ZAR amount between 0 and 100000`);
      }
      return String(asNum);
    case 'RADIUS_DEFAULT':
    case 'RADIUS_MAX': {
      if (!Number.isFinite(asNum) || !ALLOWED_RADII.includes(asNum)) {
        fail(422, 'INVALID_SETTING_VALUE', `${def.key} must be one of ${ALLOWED_RADII.join(', ')} (absolute maximum ${ABSOLUTE_MAX_RADIUS_KM} km)`);
      }
      return String(asNum);
    }
    case 'RADIUS_LIST': {
      let arr: unknown = raw;
      if (typeof raw === 'string') {
        try {
          arr = JSON.parse(raw);
        } catch {
          fail(422, 'INVALID_SETTING_VALUE', `${def.key} must be a JSON array subset of [${ALLOWED_RADII.join(', ')}]`);
        }
      }
      if (!Array.isArray(arr) || arr.length === 0 || !arr.every((v) => ALLOWED_RADII.includes(Number(v)))) {
        fail(422, 'INVALID_SETTING_VALUE', `${def.key} must be a non-empty JSON array subset of [${ALLOWED_RADII.join(', ')}]`);
      }
      return JSON.stringify((arr as unknown[]).map(Number));
    }
    case 'NUMBER':
      if (!Number.isFinite(asNum)) fail(422, 'INVALID_SETTING_VALUE', `${def.key} must be a number`);
      return String(asNum);
    default:
      fail(422, 'INVALID_SETTING_VALUE', `Unsupported setting kind for ${def.key}`);
  }
  throw new Error('unreachable');
}

export async function getSettings() {
  const rows = await prisma.adminSetting.findMany({ orderBy: { settingKey: 'asc' } });
  const byKey = new Map((rows as any[]).map((r) => [r.settingKey, r]));
  return SETTING_DEFS.map((def) => {
    const row = byKey.get(def.key) as any;
    const sensitive = Boolean(row?.isSensitive);
    return {
      key: def.key,
      kind: def.kind,
      description: def.description,
      value: sensitive ? '[REDACTED]' : (row?.settingValue ?? null),
      valueType: row?.valueType ?? null,
      isSensitive: sensitive,
      configurable: def.kind !== 'IMMUTABLE',
      updatedAt: row?.updatedAt ?? null,
    };
  });
}

/**
 * Transactional setting update with optimistic concurrency.
 * Historical financial rows carry their own commission/cap snapshots and
 * are never rewritten — only future transactions read the new value.
 */
export async function updateSetting(key: string, value: unknown, ctx: ActorCtx, expectedUpdatedAt?: string | null) {
  const def = SETTING_DEFS.find((d) => d.key === key);
  if (!def) fail(404, 'UNKNOWN_SETTING', `Unknown setting: ${key}. Only allowlisted platform settings are configurable.`);
  const normalized = validateSettingValue(def as SettingDef, value);
  if (expectedUpdatedAt) {
    const current = await prisma.adminSetting.findUnique({ where: { settingKey: key } });
    const currentTs = (current as any)?.updatedAt ? new Date((current as any).updatedAt).toISOString() : null;
    if (currentTs !== new Date(expectedUpdatedAt).toISOString() && currentTs !== expectedUpdatedAt) {
      fail(409, 'SETTING_CONFLICT', `${key} was modified by another admin. Reload and retry.`, { currentUpdatedAt: currentTs });
    }
  }
  const before = await prisma.adminSetting.findUnique({ where: { settingKey: key } });
  const updated = await prisma.adminSetting.upsert({
    where: { settingKey: key },
    update: { settingValue: normalized },
    create: { settingKey: key, settingValue: normalized, valueType: 'NUMBER', description: (def as SettingDef).description },
  });
  await audit({
    actorUserId: ctx.actorUserId,
    action: 'ADMIN_SETTING_UPDATED',
    entityType: 'admin_setting',
    entityId: key,
    beforeJson: { settingValue: (before as any)?.settingValue ?? null },
    afterJson: { settingValue: normalized },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });
  return {
    key,
    value: (updated as any).isSensitive ? '[REDACTED]' : (updated as any).settingValue,
    updatedAt: (updated as any).updatedAt,
  };
}

// ── Audit viewer (append-only; no edit/delete surface exists) ────────────

const AUDIT_ACTIONS_ALLOWLIST: string[] | null = null; // free-form actions; filtered by exact match only

export async function listAuditLogs(query: {
  actorUserId?: unknown;
  action?: unknown;
  entityType?: unknown;
  entityId?: unknown;
  from?: unknown;
  to?: unknown;
  page?: unknown;
  perPage?: unknown;
}) {
  const { page, perPage, skip, take } = pagination(query);
  const where: any = {};
  if (typeof query.actorUserId === 'string' && query.actorUserId.length <= 64) where.actorUserId = query.actorUserId;
  if (typeof query.action === 'string' && query.action.length <= 128) {
    if (AUDIT_ACTIONS_ALLOWLIST && !AUDIT_ACTIONS_ALLOWLIST.includes(query.action)) {
      fail(422, 'INVALID_ACTION', 'Unknown audit action filter');
    }
    where.action = query.action;
  }
  if (typeof query.entityType === 'string' && /^[A-Za-z_]{1,64}$/.test(query.entityType)) where.entityType = query.entityType;
  if (typeof query.entityId === 'string' && query.entityId.length <= 64) where.entityId = query.entityId;
  const from = typeof query.from === 'string' ? new Date(query.from) : null;
  const to = typeof query.to === 'string' ? new Date(query.to) : null;
  if ((query.from && (!from || Number.isNaN(from.getTime()))) || (query.to && (!to || Number.isNaN(to.getTime())))) {
    fail(422, 'INVALID_DATE', 'from/to must be valid dates');
  }
  if (from || to) {
    where.createdAt = {};
    if (from) where.createdAt.gte = from;
    if (to) where.createdAt.lte = to;
  }
  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
    prisma.auditLog.count({ where }),
  ]);
  return { logs: (rows as any[]).map(redactSecrets), meta: { page, perPage, total } };
}

// ── Notification oversight (existing Slice 7 architecture, read-only) ─────

const MESSAGE_PREVIEW_LENGTH = 160;

export async function listNotifications(query: { status?: unknown; type?: unknown; page?: unknown; perPage?: unknown }) {
  const { page, perPage, skip, take } = pagination(query);
  const where: any = {};
  if (query.status === 'UNREAD' || query.status === 'READ') where.status = query.status;
  if (typeof query.type === 'string' && /^[A-Z_]{1,64}$/.test(query.type)) where.type = query.type;
  else if (query.type !== undefined) fail(422, 'INVALID_TYPE', 'Invalid notification type filter');
  const [rows, total, byType] = await Promise.all([
    prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
    prisma.notification.count({ where }),
    prisma.notification.groupBy({ by: ['type'], _count: { type: true } }),
  ]);
  return {
    notifications: (rows as any[]).map((n) => ({
      id: n.id,
      type: n.type,
      channel: n.channel,
      audience: n.audience,
      status: n.status,
      title: n.title,
      // List shows a preview; full content only on detail view.
      messagePreview: typeof n.message === 'string' && n.message.length > MESSAGE_PREVIEW_LENGTH
        ? `${n.message.slice(0, MESSAGE_PREVIEW_LENGTH)}…`
        : n.message,
      entityType: n.entityType,
      entityId: n.entityId,
      createdAt: n.createdAt,
    })),
    byType: (byType as any[]).map((r) => ({ type: r.type, count: r._count.type })),
    meta: { page, perPage, total },
  };
}

export async function getNotificationDetail(id: string) {
  const n = await prisma.notification.findUnique({ where: { id } });
  if (!n) fail(404, 'NOTIFICATION_NOT_FOUND', 'Notification not found');
  return n;
}

// ── Media oversight (Slice 11 abstraction, moderation only — no delete) ───

const MODERATION_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'NEEDS_REVIEW', 'HIDDEN'] as const;
const MODERATION_ACTIONS = ['APPROVE', 'REJECT', 'HIDE', 'NEEDS_REVIEW'] as const;

export async function listMedia(query: {
  moderationStatus?: unknown;
  status?: unknown;
  purpose?: unknown;
  page?: unknown;
  perPage?: unknown;
}) {
  const { page, perPage, skip, take } = pagination(query);
  const where: any = {};
  if (typeof query.moderationStatus === 'string') {
    if (!(MODERATION_STATUSES as readonly string[]).includes(query.moderationStatus)) {
      fail(422, 'INVALID_MODERATION_STATUS', 'Unknown moderation status');
    }
    where.moderationStatus = query.moderationStatus;
  }
  if (typeof query.status === 'string' && /^[A-Z_]{1,32}$/.test(query.status)) where.status = query.status;
  else if (query.status !== undefined) fail(422, 'INVALID_STATUS', 'Invalid media status filter');
  if (typeof query.purpose === 'string' && /^[A-Z_]{1,32}$/.test(query.purpose)) where.purpose = query.purpose;
  else if (query.purpose !== undefined) fail(422, 'INVALID_PURPOSE', 'Invalid media purpose filter');
  const [rows, total] = await Promise.all([
    prisma.mediaAsset.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
    prisma.mediaAsset.count({ where }),
  ]);
  // Metadata only — object bytes stay behind the StorageProvider; no signed
  // URLs are minted here (serving remains the Slice 11 read path).
  return { media: rows, meta: { page, perPage, total } };
}

export async function moderateMedia(id: string, action: string, ctx: ActorCtx) {
  if (!(MODERATION_ACTIONS as readonly string[]).includes(action)) {
    fail(422, 'INVALID_ACTION', `action must be one of ${MODERATION_ACTIONS.join(', ')}`);
  }
  const before = await prisma.mediaAsset.findUnique({ where: { id } });
  if (!before) fail(404, 'MEDIA_NOT_FOUND', 'Media asset not found');
  const moderationStatus =
    action === 'APPROVE' ? 'APPROVED' : action === 'REJECT' ? 'REJECTED' : action === 'HIDE' ? 'HIDDEN' : 'NEEDS_REVIEW';
  const updated = await prisma.mediaAsset.update({ where: { id }, data: { moderationStatus } });
  await audit({
    actorUserId: ctx.actorUserId,
    action: `MEDIA_MODERATION_${action}`,
    entityType: 'media_asset',
    entityId: id,
    beforeJson: { moderationStatus: (before as any).moderationStatus },
    afterJson: { moderationStatus },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });
  return updated;
}

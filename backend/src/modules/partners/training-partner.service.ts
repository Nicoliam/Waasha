import crypto from 'crypto';
import { prisma } from '../../config/prisma';

/**
 * Slice 17 — Training-Centre Ecosystem domain service.
 *
 * Blueprint: Documents 01/05/06 + Sections 30–31 (partners + attribution),
 * 36–38 (commission config, ledger, earnings), 42 (partner share).
 *
 * Model:
 *  - TrainingPartner: PENDING → ACTIVE ⇄ SUSPENDED → DEACTIVATED (admin-only
 *    transitions, audited; history retained on deactivation).
 *  - TrainingPartnerMember: session-derived partner access. A partner user
 *    sees ONLY their own partner organisation — never another partner,
 *    unrelated providers, customer PII, or finance administration.
 *  - TrainingReferral: secure single-use invitation codes. Only the SHA-256
 *    hash is persisted; the raw code is returned once and never logged.
 *  - TrainingAttribution: provider ↔ partner link. Self-assignment is
 *    impossible: attribution is created only via claimed-referral linking or
 *    explicit audited admin action. History is retained (ENDED rows stay).
 *  - TrainingEvidence: qualification/confirmation references behind the
 *    existing Slice 11 media abstraction (mediaAssetId reference only).
 *  - PartnerShareRule + admin_settings fallback: partner allocation is
 *    configurable (GLOBAL → PARTNER → PROGRAMME precedence), never hard-coded.
 *  - PartnerAccrual: ledger records (ACCRUED) created ONLY for eligible
 *    COMPLETED bookings. NOT payouts — paidAt stays null until real payout
 *    rails exist. Never implies money moved.
 *
 * Marketplace: no ranking coupling exists anywhere in this module.
 * Student: partner support/recommendation is advisory only; final
 * verification stays with the existing admin workflow, and the Student
 * commission rate is resolved from the existing finance configuration.
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

export const INSTITUTION_TYPES = ['COLLEGE', 'ACADEMY', 'TRAINING_CENTRE', 'UNIVERSITY', 'NGO', 'OTHER'] as const;
export const PARTNER_STATUSES = ['PENDING', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED'] as const;
export const MEMBER_ROLES = ['OWNER', 'MANAGER', 'STAFF'] as const;
export const LAUNCH_CATEGORY_CODES = [
  'BARBERS',
  'HAIR_SALONS_STYLISTS',
  'NAIL_TECHNICIANS',
  'BEAUTY_SERVICES',
  'CAR_WASH',
] as const;

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
        beforeJson: redactSecrets(entry.beforeJson ?? null) as any,
        afterJson: redactSecrets(entry.afterJson ?? null) as any,
        ipAddress: entry.ip ?? null,
        userAgent: entry.userAgent ?? null,
      },
    });
  } catch {
    fail(503, 'AUDIT_UNAVAILABLE', 'Audit trail unavailable — action not recorded');
  }
}

async function notify(intent: {
  recipientUserId: string;
  type: string;
  title: string;
  message: string;
  entityType?: string;
  entityId?: string;
  eventKey?: string;
}): Promise<void> {
  try {
    const { emitNotification } = await import('../notifications/notification.service');
    await emitNotification({
      recipientUserId: intent.recipientUserId,
      audience: 'PROVIDER',
      type: intent.type,
      title: intent.title,
      message: intent.message,
      entityType: intent.entityType,
      entityId: intent.entityId,
      eventKey: intent.eventKey,
    } as never).catch(() => {});
  } catch {
    // Notifications never break domain writes.
  }
}

/** Notify all ACTIVE members of a partner (best-effort, post-commit only). */
async function notifyPartnerMembers(
  partnerId: string,
  eventKey: string,
  build: (userId: string) => { type: string; title: string; message: string; entityType?: string; entityId?: string },
): Promise<void> {
  try {
    const members = (await (prisma as any).trainingPartnerMember.findMany({
      where: { partnerId, status: 'ACTIVE' },
      select: { userId: true },
    })) as Array<{ userId: string }>;
    for (const m of members ?? []) {
      const n = build(m.userId);
      await notify({
        recipientUserId: m.userId,
        type: n.type,
        title: n.title,
        message: n.message,
        entityType: n.entityType,
        entityId: n.entityId,
        eventKey: `${eventKey}:user:${m.userId}`,
      });
    }
  } catch {
    // Never breaks domain writes.
  }
}

/** Notify platform admins (best-effort, post-commit only). */
async function notifyAdmins(eventKey: string, type: string, title: string, message: string): Promise<void> {
  try {
    const memberships = (await prisma.userRole.findMany({
      where: { role: { code: 'ADMIN' } },
      select: { userId: true },
    } as never)) as unknown as Array<{ userId: string }>;
    for (const m of memberships ?? []) {
      await notify({ recipientUserId: m.userId, type, title, message, entityType: 'training_partner', eventKey: `${eventKey}:admin:${m.userId}` });
    }
  } catch {
    // Never breaks domain writes.
  }
}

// ── Session-derived partner access ──────────────────────────────────────

export interface PartnerMembership {
  membership: any;
  partner: any;
}

/** Resolve the caller's partner membership from the session user id. */
export async function resolveMembership(userId: string): Promise<PartnerMembership> {
  const membership = (await (prisma as any).trainingPartnerMember.findFirst({
    where: { userId, status: 'ACTIVE' },
    include: { partner: true },
  })) as any;
  if (!membership || !membership.partner) {
    fail(403, 'PARTNER_FORBIDDEN', 'Training-centre partner access required');
  }
  return { membership, partner: membership.partner };
}

/**
 * Authorize access to a specific partner id. The partner id is NEVER trusted
 * from the client: it must match the session-derived membership. Returns
 * the membership + partner on success (404 when the partner does not exist
 * or is not the caller's own — never reveals other partners' existence).
 */
export async function requirePartnerAccess(userId: string, partnerId: string): Promise<PartnerMembership> {
  const { membership, partner } = await resolveMembership(userId);
  if (partner.id !== partnerId) {
    fail(404, 'PARTNER_NOT_FOUND', 'Training partner not found');
  }
  return { membership, partner };
}

/** Owner/Manager gate for sensitive partner operations (invites, evidence review support). */
export function requireElevatedRole(membership: any): void {
  if (!['OWNER', 'MANAGER'].includes(String(membership?.role))) {
    fail(403, 'PARTNER_FORBIDDEN', 'Owner or Manager role required');
  }
}

// ── Sanitization (privacy boundaries) ───────────────────────────────────

export function sanitizePartner(partner: any) {
  if (!partner) return partner;
  return {
    id: partner.id,
    uuid: partner.uuid ?? null,
    legalName: partner.legalName ?? null,
    displayName: partner.displayName ?? null,
    description: partner.description ?? null,
    institutionType: partner.institutionType ?? null,
    contactEmail: partner.contactEmail ?? null,
    contactPhone: partner.contactPhone ?? null,
    website: partner.website ?? null,
    addressLine1: partner.addressLine1 ?? null,
    city: partner.city ?? null,
    province: partner.province ?? null,
    postalCode: partner.postalCode ?? null,
    country: partner.country ?? null,
    categoriesServed: partner.categoriesServed ?? null,
    logoUrl: partner.logoUrl ?? null,
    status: partner.status ?? null,
    verificationStatus: partner.verificationStatus ?? null,
    createdAt: partner.createdAt ?? null,
    updatedAt: partner.updatedAt ?? null,
  };
}

/** Attributed provider row for partner visibility — no customer PII, no secrets, area-level only. */
export function sanitizeAttributedProvider(row: {
  attribution: any;
  provider: any;
  serviceCount: number;
  completedCount: number;
}) {
  const p = row.provider ?? {};
  return {
    providerId: p.id ?? null,
    displayName: p.displayName ?? null,
    verificationStatus: p.verificationStatus ?? null,
    studentVerificationStatus: p.studentVerificationStatus ?? null,
    isStudent: p.isStudent ?? false,
    tierCode: p.tier?.code ?? p.tierCode ?? null,
    status: p.status ?? null,
    serviceCount: row.serviceCount,
    completedEligibleServices: row.completedCount,
    attributionStatus: row.attribution?.status ?? null,
    referredAt: row.attribution?.referredAt ?? null,
    approvedAt: row.attribution?.approvedAt ?? null,
    attributionSource: row.attribution?.source ?? null,
  };
}

export function sanitizeAccrual(accrual: any) {
  if (!accrual) return accrual;
  return {
    id: accrual.id,
    partnerId: accrual.partnerId,
    providerId: accrual.providerId,
    bookingId: accrual.bookingId,
    grossAmount: accrual.grossAmount != null ? Number(accrual.grossAmount) : null,
    commissionRate: accrual.commissionRate != null ? Number(accrual.commissionRate) : null,
    commissionAmount: accrual.commissionAmount != null ? Number(accrual.commissionAmount) : null,
    partnerPercent: accrual.partnerPercent != null ? Number(accrual.partnerPercent) : null,
    partnerAmount: accrual.partnerAmount != null ? Number(accrual.partnerAmount) : null,
    currency: accrual.currency,
    ruleId: accrual.ruleId ?? null,
    status: accrual.status,
    earnedAt: accrual.earnedAt,
    createdAt: accrual.createdAt,
  };
}

// ── Partner application / profile ───────────────────────────────────────

export interface ApplyPartnerInput {
  legalName: string;
  displayName: string;
  description?: string | null;
  institutionType: string;
  contactEmail?: string | null;
  contactPhone?: string | null;
  website?: string | null;
  addressLine1?: string | null;
  city?: string | null;
  province?: string | null;
  postalCode?: string | null;
  country?: string | null;
  categoriesServed?: string[] | null;
  logoUrl?: string | null;
}

function validatePartnerProfileInput(input: ApplyPartnerInput): void {
  if (!input.legalName || !input.displayName) fail(422, 'VALIDATION_ERROR', 'legalName and displayName are required');
  if (!INSTITUTION_TYPES.includes(input.institutionType as never)) {
    fail(422, 'VALIDATION_ERROR', `institutionType must be one of ${INSTITUTION_TYPES.join(', ')}`);
  }
  if (input.categoriesServed !== undefined && input.categoriesServed !== null) {
    if (!Array.isArray(input.categoriesServed)) fail(422, 'VALIDATION_ERROR', 'categoriesServed must be an array');
    for (const c of input.categoriesServed) {
      if (!LAUNCH_CATEGORY_CODES.includes(c as never)) {
        fail(422, 'VALIDATION_ERROR', `Unknown category code: ${c}. Launch categories only.`);
      }
    }
  }
}

/**
 * Register a training-centre partnership application. Creates a PENDING
 * partner + OWNER membership for the applicant. Never grants ADMIN.
 */
export async function applyPartner(userId: string, input: ApplyPartnerInput, ctx?: ActorCtx) {
  validatePartnerProfileInput(input);
  const existing = (await (prisma as any).trainingPartnerMember.findFirst({
    where: { userId, status: 'ACTIVE' },
  })) as any;
  if (existing) fail(422, 'PARTNER_ALREADY_MEMBER', 'You are already a member of a training-centre partner');

  const partner = (await (prisma as any).trainingPartner.create({
    data: {
      legalName: input.legalName,
      displayName: input.displayName,
      description: input.description ?? null,
      institutionType: input.institutionType,
      contactEmail: input.contactEmail ?? null,
      contactPhone: input.contactPhone ?? null,
      website: input.website ?? null,
      addressLine1: input.addressLine1 ?? null,
      city: input.city ?? null,
      province: input.province ?? null,
      postalCode: input.postalCode ?? null,
      country: input.country ?? 'ZA',
      categoriesServed: (input.categoriesServed ?? null) as any,
      logoUrl: input.logoUrl ?? null,
      status: 'PENDING',
      verificationStatus: 'UNVERIFIED',
    },
  })) as any;

  const membership = (await (prisma as any).trainingPartnerMember.create({
    data: { partnerId: partner.id, userId, role: 'OWNER', status: 'ACTIVE' },
  })) as any;

  // Grant TRAINING_CENTRE platform role (never ADMIN).
  try {
    const role = (await prisma.role.findUnique({ where: { code: 'TRAINING_CENTRE' } })) as any;
    if (role) {
      await prisma.userRole.upsert({
        where: { userId_roleId: { userId, roleId: role.id } },
        update: {},
        create: { userId, roleId: role.id },
      } as never);
    }
  } catch {
    // Role grant failure must not orphan the application; admin can reconcile.
  }

  await audit({
    actorUserId: ctx?.actorUserId ?? userId,
    action: 'PARTNER_APPLIED',
    entityType: 'training_partner',
    entityId: partner.id,
    afterJson: { legalName: input.legalName, displayName: input.displayName, institutionType: input.institutionType },
    ip: ctx?.ip,
    userAgent: ctx?.userAgent,
  });

  await notifyAdmins(`partner:applied:${partner.id}`, 'PARTNER_APPLICATION_RECEIVED', 'New training-centre application', `${input.displayName} applied for training-centre partnership and awaits review.`);

  return { partner: sanitizePartner(partner), membership: { id: membership.id, role: membership.role, status: membership.status } };
}

export async function getMyPartner(userId: string) {
  const { membership, partner } = await resolveMembership(userId);
  return { partner: sanitizePartner(partner), membership: { id: membership.id, role: membership.role, status: membership.status } };
}

export async function updatePartnerProfile(userId: string, input: Partial<ApplyPartnerInput>, ctx?: ActorCtx) {
  const { membership, partner } = await resolveMembership(userId);
  requireElevatedRole(membership);
  if (partner.status === 'DEACTIVATED') fail(422, 'PARTNER_INACTIVE', 'Deactivated partners cannot update their profile');
  const patch: Record<string, unknown> = {};
  for (const k of ['legalName', 'displayName', 'description', 'contactEmail', 'contactPhone', 'website', 'addressLine1', 'city', 'province', 'postalCode', 'country', 'logoUrl'] as const) {
    if (input[k] !== undefined) patch[k] = input[k] ?? null;
  }
  if (input.institutionType !== undefined) {
    if (!INSTITUTION_TYPES.includes(input.institutionType as never)) fail(422, 'VALIDATION_ERROR', 'Invalid institutionType');
    patch.institutionType = input.institutionType;
  }
  if (input.categoriesServed !== undefined) {
    const cats = input.categoriesServed ?? null;
    if (cats !== null) {
      if (!Array.isArray(cats)) fail(422, 'VALIDATION_ERROR', 'categoriesServed must be an array');
      for (const c of cats) {
        if (!LAUNCH_CATEGORY_CODES.includes(c as never)) fail(422, 'VALIDATION_ERROR', `Unknown category code: ${c}`);
      }
    }
    patch.categoriesServed = cats as any;
  }
  // Mass-assignment guard: status/verification can never be self-updated.
  const updated = (await (prisma as any).trainingPartner.update({ where: { id: partner.id }, data: patch })) as any;
  await audit({
    actorUserId: ctx?.actorUserId ?? userId,
    action: 'PARTNER_PROFILE_UPDATED',
    entityType: 'training_partner',
    entityId: partner.id,
    beforeJson: { displayName: partner.displayName },
    afterJson: patch,
    ip: ctx?.ip,
    userAgent: ctx?.userAgent,
  });
  return sanitizePartner(updated);
}

// ── Referrals ───────────────────────────────────────────────────────────

function hashCode(raw: string): string {
  return crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
}

async function getReferralTtlDays(): Promise<number> {
  try {
    const row = await prisma.adminSetting.findUnique({ where: { settingKey: 'training_referral_ttl_days' } });
    const n = Number((row as any)?.settingValue);
    if (Number.isFinite(n) && n >= 1 && n <= 365) return Math.floor(n);
  } catch {}
  return 30;
}

export async function createReferral(
  userId: string,
  input: { invitedEmail?: string | null; invitedPhone?: string | null; programme?: string | null; ttlDays?: number | null },
  ctx?: ActorCtx,
) {
  const { membership, partner } = await resolveMembership(userId);
  requireElevatedRole(membership);
  if (partner.status !== 'ACTIVE') fail(422, 'PARTNER_INACTIVE', 'Only ACTIVE partners can issue referrals');
  if (!input.invitedEmail && !input.invitedPhone) {
    fail(422, 'VALIDATION_ERROR', 'invitedEmail or invitedPhone is required');
  }
  const ttl = input.ttlDays ?? (await getReferralTtlDays());
  if (!Number.isFinite(ttl) || ttl < 1 || ttl > 365) fail(422, 'VALIDATION_ERROR', 'ttlDays must be between 1 and 365');
  const raw = `WAA-${crypto.randomBytes(24).toString('base64url')}`;
  const referral = (await (prisma as any).trainingReferral.create({
    data: {
      partnerId: partner.id,
      codeHash: hashCode(raw),
      codePrefix: raw.slice(0, 6),
      invitedEmail: input.invitedEmail ?? null,
      invitedPhone: input.invitedPhone ?? null,
      programme: input.programme ?? null,
      status: 'PENDING',
      expiresAt: new Date(Date.now() + Math.floor(ttl) * 24 * 3600 * 1000),
      createdBy: userId,
    },
  })) as any;
  await audit({
    actorUserId: ctx?.actorUserId ?? userId,
    action: 'REFERRAL_CREATED',
    entityType: 'training_referral',
    entityId: referral.id,
    afterJson: { partnerId: partner.id, codePrefix: referral.codePrefix, programme: input.programme ?? null },
    ip: ctx?.ip,
    userAgent: ctx?.userAgent,
  });
  // Raw code returned ONCE — never stored, never logged, never in audit.
  return {
    id: referral.id,
    code: raw,
    codePrefix: referral.codePrefix,
    status: referral.status,
    expiresAt: referral.expiresAt,
    programme: referral.programme ?? null,
  };
}

export async function listReferrals(userId: string, query: { status?: string; page?: number; perPage?: number }) {
  const { partner } = await resolveMembership(userId);
  const page = Math.min(10000, Math.max(1, Number(query.page ?? 1) || 1));
  const perPage = Math.min(50, Math.max(1, Number(query.perPage ?? 20) || 20));
  const where: Record<string, unknown> = { partnerId: partner.id };
  if (query.status) where.status = query.status;
  const [rows, total] = await Promise.all([
    (prisma as any).trainingReferral.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * perPage,
      take: perPage,
    }),
    (prisma as any).trainingReferral.count({ where }),
  ]);
  // Never expose code hashes.
  const data = (rows as any[]).map((r) => ({
    id: r.id,
    codePrefix: r.codePrefix,
    invitedEmail: r.invitedEmail ?? null,
    invitedPhone: r.invitedPhone ?? null,
    programme: r.programme ?? null,
    status: r.status,
    expiresAt: r.expiresAt,
    claimedByUserId: r.claimedByUserId ?? null,
    claimedAt: r.claimedAt ?? null,
    createdAt: r.createdAt,
  }));
  return { data, meta: { page, perPage, total } };
}

/**
 * Slice 19 — conditional revoke: the PENDING → REVOKED transition is a
 * single atomic conditional write. A concurrent redeem (or expiry) that
 * wins the race leaves count 0 and the loser receives a safe
 * business/conflict response — never a double state change.
 */
export async function revokeReferral(userId: string, referralId: string, ctx?: ActorCtx) {
  const { membership, partner } = await resolveMembership(userId);
  requireElevatedRole(membership);
  const referral = (await (prisma as any).trainingReferral.findUnique({ where: { id: referralId } })) as any;
  if (!referral || referral.partnerId !== partner.id) fail(404, 'REFERRAL_NOT_FOUND', 'Referral not found');
  if (referral.status !== 'PENDING') fail(422, 'REFERRAL_INVALID_STATE', 'Referral code has already been used');
  const claimed = (await (prisma as any).trainingReferral.updateMany({
    where: { id: referralId, partnerId: partner.id, status: 'PENDING' },
    data: { status: 'REVOKED' },
  })) as any;
  if (Number(claimed?.count) !== 1) {
    // Lost the race (redeemed/expired concurrently) — report current state safely.
    const current = (await (prisma as any).trainingReferral.findUnique({ where: { id: referralId } })) as any;
    if (!current || current.partnerId !== partner.id) fail(404, 'REFERRAL_NOT_FOUND', 'Referral not found');
    fail(422, 'REFERRAL_INVALID_STATE', 'Referral code has already been used');
  }
  await audit({
    actorUserId: ctx?.actorUserId ?? userId,
    action: 'REFERRAL_REVOKED',
    entityType: 'training_referral',
    entityId: referralId,
    beforeJson: { status: 'PENDING' },
    afterJson: { status: 'REVOKED' },
    ip: ctx?.ip,
    userAgent: ctx?.userAgent,
  });
  return { id: referralId, status: 'REVOKED' as const };
}

/**
 * Claim a referral invitation with its secret code. Anyone authenticated may
 * redeem, but redemption alone grants nothing: attribution is created only
 * via linkAttribution once the claimer holds a provider profile, and the
 * claimer's existing ACTIVE attribution blocks double attribution.
 *
 * Slice 19 — concurrency: the PENDING → CLAIMED transition is a single
 * atomic conditional write (status + not-expired predicate). Concurrent
 * valid requests resolve deterministically: exactly one succeeds, the rest
 * receive a safe 422 business/conflict response. No preliminary read is
 * trusted for the write. Expiry transitions are likewise conditional
 * (PENDING → EXPIRED), so revoke/expiry races cannot double-apply.
 */
export async function redeemReferral(userId: string, code: string, ctx?: ActorCtx) {
  const raw = String(code ?? '').trim();
  if (!raw || raw.length > 256) fail(422, 'VALIDATION_ERROR', 'Referral code is invalid');
  const referral = (await (prisma as any).trainingReferral.findUnique({ where: { codeHash: hashCode(raw) } })) as any;
  // Uniform 404: no oracle for code guessing (prefix is non-secret, hash is).
  if (!referral) fail(404, 'REFERRAL_NOT_FOUND', 'Referral code is invalid or expired');
  if (referral.status !== 'PENDING') fail(422, 'REFERRAL_INVALID_STATE', 'Referral code has already been used');
  if (new Date(referral.expiresAt).getTime() < Date.now()) {
    // Conditional expiry transition — a concurrent claim that already won
    // keeps its result; this request still reports expiry safely.
    try {
      await (prisma as any).trainingReferral.updateMany({
        where: { id: referral.id, status: 'PENDING' },
        data: { status: 'EXPIRED' },
      });
    } catch {}
    fail(422, 'REFERRAL_EXPIRED', 'Referral code has expired');
  }
  const partner = (await (prisma as any).trainingPartner.findUnique({ where: { id: referral.partnerId } })) as any;
  if (!partner || partner.status !== 'ACTIVE') fail(422, 'PARTNER_INACTIVE', 'This training partner is not currently active');

  // Advisory fast-path only: users who already hold an ACTIVE attribution
  // are rejected early. The authoritative guard is the transactional
  // attribution check in linkAttribution (never duplicate ACTIVE rows).
  const provider = (await prisma.providerProfile.findUnique({ where: { userId } } as never)) as any;
  if (provider) {
    const active = (await (prisma as any).trainingAttribution.findFirst({
      where: { providerId: provider.id, status: 'ACTIVE' },
    })) as any;
    if (active) fail(422, 'ATTRIBUTION_EXISTS', 'You are already attributed to a training partner');
  }

  // Atomic single-use claim: exactly one concurrent winner.
  const now = new Date();
  const claimed = (await (prisma as any).trainingReferral.updateMany({
    where: { id: referral.id, status: 'PENDING', expiresAt: { gte: now } },
    data: { status: 'CLAIMED', claimedByUserId: userId, claimedAt: now },
  })) as any;
  if (Number(claimed?.count) !== 1) {
    const current = (await (prisma as any).trainingReferral.findUnique({ where: { codeHash: hashCode(raw) } })) as any;
    if (!current) fail(404, 'REFERRAL_NOT_FOUND', 'Referral code is invalid or expired');
    if (current.status !== 'PENDING') fail(422, 'REFERRAL_INVALID_STATE', 'Referral code has already been used');
    if (new Date(current.expiresAt).getTime() < Date.now()) fail(422, 'REFERRAL_EXPIRED', 'Referral code has expired');
    fail(422, 'REFERRAL_INVALID_STATE', 'Referral code has already been used');
  }
  await audit({
    actorUserId: ctx?.actorUserId ?? userId,
    action: 'REFERRAL_CLAIMED',
    entityType: 'training_referral',
    entityId: referral.id,
    afterJson: { partnerId: referral.partnerId, codePrefix: referral.codePrefix },
    ip: ctx?.ip,
    userAgent: ctx?.userAgent,
  });
  await notifyPartnerMembers(
    referral.partnerId,
    `referral:claimed:${referral.id}`,
    () => ({
      type: 'REFERRAL_CLAIMED',
      title: 'Referral invitation claimed',
      message: `A prospective student claimed referral ${referral.codePrefix}…. Attribution completes after provider onboarding.`,
      entityType: 'training_referral',
      entityId: referral.id,
    }),
  );
  return { id: referral.id, partnerId: referral.partnerId, status: 'CLAIMED' as const, programme: referral.programme ?? null };
}

/**
 * Serialize concurrent attribution writers for one provider. Best-effort
 * row lock (MySQL InnoDB): concurrent transactions linking different
 * partners for the SAME provider block here instead of both passing the
 * ACTIVE check. No-op where raw locking is unavailable (unit-test doubles).
 */
async function lockProviderAttributions(tx: any, providerId: string): Promise<void> {
  try {
    if (tx && typeof tx.$queryRaw === 'function') {
      await tx.$queryRaw`SELECT id FROM training_centre_providers WHERE provider_id = ${providerId} FOR UPDATE`;
    }
  } catch {
    // Locking is hardening only — the checks + unique-constraint mapping
    // below remain the authoritative guards.
  }
}

function isUniqueViolation(e: any): boolean {
  return (e as any)?.code === 'P2002' || String((e as any)?.message ?? '').includes('training_centre_providers');
}

/**
 * Complete attribution after onboarding: links the session user's provider
 * profile to the partner whose referral they claimed. Transactional —
 * concurrent links cannot create duplicates.
 *
 * Slice 19 — concurrency: provider rows are row-locked inside the
 * transaction, the single-ACTIVE check runs under that lock, and unique
 * violations (pair key) map to a deterministic 422 conflict. Duplicate
 * ACTIVE rows are never created: a post-create ACTIVE count guard rolls
 * the transaction back with 409 if the invariant is ever violated.
 */
export async function linkAttribution(userId: string, ctx?: ActorCtx) {
  const provider = (await prisma.providerProfile.findUnique({ where: { userId } } as never)) as any;
  if (!provider) fail(404, 'PROVIDER_NOT_FOUND', 'Provider profile required — complete provider onboarding first');
  const claim = (await (prisma as any).trainingReferral.findFirst({
    where: { claimedByUserId: userId, status: 'CLAIMED' },
    orderBy: { claimedAt: 'desc' },
  })) as any;
  if (!claim) fail(422, 'REFERRAL_NOT_CLAIMED', 'No claimed referral found for this account');
  const partner = (await (prisma as any).trainingPartner.findUnique({ where: { id: claim.partnerId } })) as any;
  if (!partner || partner.status !== 'ACTIVE') fail(422, 'PARTNER_INACTIVE', 'This training partner is not currently active');

  let attribution: any;
  try {
    attribution = await (prisma as any).$transaction(async (tx: any) => {
      await lockProviderAttributions(tx, provider.id);
      const existingActive = await tx.trainingAttribution.findFirst({
        where: { providerId: provider.id, status: 'ACTIVE' },
      });
      if (existingActive) fail(422, 'ATTRIBUTION_EXISTS', 'This provider is already attributed to a training partner');
      const duplicate = await tx.trainingAttribution.findUnique({
        where: { partnerId_providerId: { partnerId: partner.id, providerId: provider.id } },
      });
      if (duplicate) fail(422, 'ATTRIBUTION_EXISTS', 'This provider is already attributed to this partner');
      const created = await tx.trainingAttribution.create({
        data: {
          partnerId: partner.id,
          providerId: provider.id,
          referredUserId: userId,
          referralId: claim.id,
          source: 'REFERRAL_CODE',
          status: 'ACTIVE',
          approvedAt: new Date(),
        },
      });
      // Defensive invariant guard — never persist duplicate ACTIVE rows.
      try {
        const actives = await tx.trainingAttribution.findMany?.({ where: { providerId: provider.id, status: 'ACTIVE' } });
        if (Array.isArray(actives) && actives.length > 1) {
          fail(409, 'ATTRIBUTION_CONFLICT', 'Concurrent attribution conflict — retry');
        }
      } catch (guardErr: any) {
        if (guardErr && typeof guardErr.status === 'number') throw guardErr;
        // findMany unavailable on the double — ignore; checks above hold.
      }
      return created;
    });
  } catch (e: any) {
    if (e && typeof e.status === 'number') throw e;
    if (isUniqueViolation(e)) fail(422, 'ATTRIBUTION_EXISTS', 'This provider is already attributed to a training partner');
    throw e;
  }

  await audit({
    actorUserId: ctx?.actorUserId ?? userId,
    action: 'ATTRIBUTION_LINKED',
    entityType: 'training_attribution',
    entityId: attribution.id,
    afterJson: { partnerId: partner.id, providerId: provider.id, source: 'REFERRAL_CODE' },
    ip: ctx?.ip,
    userAgent: ctx?.userAgent,
  });
  await notifyPartnerMembers(
    partner.id,
    `attribution:linked:${attribution.id}`,
    () => ({
      type: 'PARTNER_ATTRIBUTION_CREATED',
      title: 'New student attributed',
      message: `A referred student completed onboarding and is now attributed to your organisation.`,
      entityType: 'training_attribution',
      entityId: attribution.id,
    }),
  );
  return {
    id: attribution.id,
    partnerId: attribution.partnerId,
    providerId: attribution.providerId,
    source: attribution.source,
    status: attribution.status,
  };
}

// ── Dashboard / provider list / earnings ────────────────────────────────

export async function getDashboard(userId: string) {
  const { partner } = await resolveMembership(userId);
  const attributions = (await (prisma as any).trainingAttribution.findMany({ where: { partnerId: partner.id } })) as any[];
  let accrualRows: any[] = [];
  try {
    accrualRows = (await (prisma as any).partnerAccrual.findMany({ where: { partnerId: partner.id } })) as any[];
  } catch {
    accrualRows = [];
  }
  let evidencePending = 0;
  try {
    evidencePending = await (prisma as any).trainingEvidence.count({ where: { partnerId: partner.id, status: { in: ['SUBMITTED', 'UNDER_REVIEW'] } } });
  } catch {
    evidencePending = 0;
  }
  const providerIds = [...new Set((attributions as any[]).map((a) => a.providerId))];
  const providers = providerIds.length
    ? ((await prisma.providerProfile.findMany({ where: { id: { in: providerIds } }, include: { tier: true } } as never)) as any[])
    : [];
  const byId = new Map(providers.map((p) => [p.id, p]));
  const activeProviderIds = providers.filter((p) => p.status === 'ACTIVE').map((p) => p.id);
  const verifiedStudents = providers.filter((p) => p.isStudent && p.studentVerificationStatus === 'VERIFIED').length;
  let completedEligible = 0;
  if (activeProviderIds.length) {
    try {
      completedEligible = await prisma.booking.count({
        where: { providerId: { in: activeProviderIds }, status: 'COMPLETED' },
      } as never);
    } catch {
      completedEligible = 0;
    }
  }
  let servicesConfigured = 0;
  if (providerIds.length) {
    try {
      servicesConfigured = await (prisma as any).service.count({ where: { providerId: { in: providerIds } } });
    } catch {
      servicesConfigured = 0;
    }
  }
  const accruedTotal = accrualRows
    .filter((a) => a.status === 'ACCRUED')
    .reduce((sum, a) => sum + Number(a.partnerAmount ?? 0), 0);
  const onboarding = {
    total: (attributions as any[]).length,
    active: (attributions as any[]).filter((a) => a.status === 'ACTIVE').length,
    ended: (attributions as any[]).filter((a) => a.status === 'ENDED').length,
  };
  void byId;
  return {
    partner: sanitizePartner(partner),
    // Operational wording only — never guaranteed income/customers.
    metrics: {
      referredStudents: onboarding.total,
      activeAttributions: onboarding.active,
      endedAttributions: onboarding.ended,
      verifiedStudents,
      activeProviders: activeProviderIds.length,
      servicesConfigured,
      completedEligibleServices: completedEligible,
      accruedEarningsTotal: Math.round(accruedTotal * 100) / 100,
      accruedEarningsCurrency: 'ZAR',
      pendingReviewItems: evidencePending ?? 0,
    },
    disclaimer: 'Figures reflect attributable activity only. Waasha does not guarantee customers, bookings, income or employment.',
  };
}

export async function listAttributedProviders(
  userId: string,
  query: { status?: string; page?: number; perPage?: number },
) {
  const { partner } = await resolveMembership(userId);
  const page = Math.min(10000, Math.max(1, Number(query.page ?? 1) || 1));
  const perPage = Math.min(50, Math.max(1, Number(query.perPage ?? 20) || 20));
  const where: Record<string, unknown> = { partnerId: partner.id };
  if (query.status) where.status = query.status;
  const [rows, total] = await Promise.all([
    (prisma as any).trainingAttribution.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * perPage, take: perPage }),
    (prisma as any).trainingAttribution.count({ where }),
  ]);
  const providerIds = [...new Set((rows as any[]).map((a) => a.providerId))];
  const providers = providerIds.length
    ? ((await prisma.providerProfile.findMany({ where: { id: { in: providerIds } }, include: { tier: true } } as never)) as any[])
    : [];
  const byId = new Map(providers.map((p) => [p.id, p]));
  const data: unknown[] = [];
  for (const attr of rows as any[]) {
    const provider = byId.get(attr.providerId);
    if (!provider) {
      data.push({ attributionStatus: attr.status, referredAt: attr.referredAt, providerId: attr.providerId, providerMissing: true });
      continue;
    }
    let serviceCount = 0;
    let completedCount = 0;
    try {
      serviceCount = await (prisma as any).service.count({ where: { providerId: provider.id } });
    } catch {}
    try {
      completedCount = await prisma.booking.count({ where: { providerId: provider.id, status: 'COMPLETED' } } as never);
    } catch {}
    data.push(sanitizeAttributedProvider({ attribution: attr, provider, serviceCount, completedCount }));
  }
  return { data, meta: { page, perPage, total } };
}

export async function listEarnings(userId: string, query: { status?: string; page?: number; perPage?: number }) {
  const { partner } = await resolveMembership(userId);
  const page = Math.min(10000, Math.max(1, Number(query.page ?? 1) || 1));
  const perPage = Math.min(50, Math.max(1, Number(query.perPage ?? 20) || 20));
  const where: Record<string, unknown> = { partnerId: partner.id };
  if (query.status) where.status = query.status;
  const [rows, total] = await Promise.all([
    (prisma as any).partnerAccrual.findMany({ where, orderBy: { earnedAt: 'desc' }, skip: (page - 1) * perPage, take: perPage }),
    (prisma as any).partnerAccrual.count({ where }),
  ]);
  return {
    data: (rows as any[]).map(sanitizeAccrual),
    meta: { page, perPage, total },
    disclaimer: 'Accrued allocations awaiting the payout mechanism. Accrual is not payment.',
  };
}

// ── Training evidence ───────────────────────────────────────────────────

export async function submitEvidence(
  userId: string,
  input: {
    providerId: string;
    programme?: string | null;
    qualificationReference?: string | null;
    institutionConfirmation?: string | null;
    completionDate?: string | null;
    mediaAssetId?: string | null;
  },
  ctx?: ActorCtx,
) {
  const { partner } = await resolveMembership(userId);
  if (partner.status !== 'ACTIVE') fail(422, 'PARTNER_INACTIVE', 'Only ACTIVE partners can submit evidence');
  if (!input.providerId) fail(422, 'VALIDATION_ERROR', 'providerId is required');
  const attribution = (await (prisma as any).trainingAttribution.findFirst({
    where: { partnerId: partner.id, providerId: input.providerId, status: 'ACTIVE' },
  })) as any;
  if (!attribution) fail(404, 'ATTRIBUTION_NOT_FOUND', 'No active attribution for this provider at your organisation');
  if (!input.qualificationReference && !input.institutionConfirmation && !input.mediaAssetId && !input.programme) {
    fail(422, 'VALIDATION_ERROR', 'At least one evidence field is required');
  }
  if (input.mediaAssetId) {
    const asset = (await (prisma as any).mediaAsset.findUnique({ where: { id: input.mediaAssetId } })) as any;
    if (!asset) fail(404, 'MEDIA_NOT_FOUND', 'Referenced media asset not found');
    if (asset.status !== 'ACTIVE') fail(422, 'MEDIA_NOT_USABLE', 'Referenced media is not available');
    // Ownership: the asset must belong to the provider or have been uploaded by this member.
    if (asset.ownerId !== input.providerId && asset.createdBy !== userId) {
      fail(403, 'MEDIA_FORBIDDEN', 'Media asset does not belong to this training record');
    }
  }
  let completionDate: Date | null = null;
  if (input.completionDate) {
    completionDate = new Date(input.completionDate);
    if (Number.isNaN(completionDate.getTime())) fail(422, 'VALIDATION_ERROR', 'completionDate is invalid');
    if (completionDate.getTime() > Date.now()) fail(422, 'VALIDATION_ERROR', 'completionDate cannot be in the future');
  }
  const evidence = (await (prisma as any).trainingEvidence.create({
    data: {
      partnerId: partner.id,
      providerId: input.providerId,
      attributionId: attribution.id,
      programme: input.programme ?? null,
      qualificationReference: input.qualificationReference ?? null,
      institutionConfirmation: input.institutionConfirmation ?? null,
      completionDate,
      mediaAssetId: input.mediaAssetId ?? null,
      status: 'SUBMITTED',
      submittedBy: userId,
    },
  })) as any;
  await audit({
    actorUserId: ctx?.actorUserId ?? userId,
    action: 'TRAINING_EVIDENCE_SUBMITTED',
    entityType: 'training_evidence',
    entityId: evidence.id,
    afterJson: { partnerId: partner.id, providerId: input.providerId, programme: input.programme ?? null },
    ip: ctx?.ip,
    userAgent: ctx?.userAgent,
  });
  return {
    id: evidence.id,
    providerId: evidence.providerId,
    status: evidence.status,
    programme: evidence.programme ?? null,
    createdAt: evidence.createdAt,
  };
}

export async function listEvidence(userId: string, query: { status?: string; page?: number; perPage?: number }) {
  const { partner } = await resolveMembership(userId);
  const page = Math.min(10000, Math.max(1, Number(query.page ?? 1) || 1));
  const perPage = Math.min(50, Math.max(1, Number(query.perPage ?? 20) || 20));
  const where: Record<string, unknown> = { partnerId: partner.id };
  if (query.status) where.status = query.status;
  const [rows, total] = await Promise.all([
    (prisma as any).trainingEvidence.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * perPage, take: perPage }),
    (prisma as any).trainingEvidence.count({ where }),
  ]);
  // Never expose private media bytes/keys — reference + status only.
  const data = (rows as any[]).map((e) => ({
    id: e.id,
    providerId: e.providerId,
    attributionId: e.attributionId ?? null,
    programme: e.programme ?? null,
    qualificationReference: e.qualificationReference ?? null,
    hasInstitutionConfirmation: Boolean(e.institutionConfirmation),
    completionDate: e.completionDate ?? null,
    hasMediaReference: Boolean(e.mediaAssetId),
    status: e.status,
    reviewNote: e.reviewNote ?? null,
    createdAt: e.createdAt,
  }));
  return { data, meta: { page, perPage, total } };
}

/**
 * Advisory Student-verification support. Records that the partner confirms
 * training participation — it NEVER changes studentVerificationStatus and
 * NEVER grants the Student commission rate. Final verification stays with
 * the existing admin workflow.
 */
export async function supportStudentVerification(userId: string, providerId: string, ctx?: ActorCtx) {
  const { partner } = await resolveMembership(userId);
  if (partner.status !== 'ACTIVE') fail(422, 'PARTNER_INACTIVE', 'Only ACTIVE partners can support verification');
  const attribution = (await (prisma as any).trainingAttribution.findFirst({
    where: { partnerId: partner.id, providerId, status: 'ACTIVE' },
  })) as any;
  if (!attribution) fail(404, 'ATTRIBUTION_NOT_FOUND', 'No active attribution for this provider at your organisation');
  await audit({
    actorUserId: ctx?.actorUserId ?? userId,
    action: 'STUDENT_VERIFICATION_SUPPORTED',
    entityType: 'provider_profile',
    entityId: providerId,
    afterJson: { partnerId: partner.id, advisoryOnly: true },
    ip: ctx?.ip,
    userAgent: ctx?.userAgent,
  });
  try {
    const provider = (await prisma.providerProfile.findUnique({ where: { id: providerId } } as never)) as any;
    if (provider?.userId) {
      await notify({
        recipientUserId: provider.userId,
        type: 'STUDENT_VERIFICATION_SUPPORTED',
        title: 'Training participation confirmed',
        message: `${partner.displayName} confirmed your training participation. Final Student verification is completed by Waasha — this confirmation alone does not change your commission rate.`,
        entityType: 'provider_profile',
        entityId: providerId,
        eventKey: `student:supported:${providerId}:${partner.id}`,
      });
    }
  } catch {}
  await notifyAdmins(
    `student:supported:${providerId}:${partner.id}`,
    'STUDENT_VERIFICATION_SUPPORTED',
    'Partner supports Student verification',
    `${partner.displayName} supports Student verification for provider ${providerId}. Review remains with admin.`,
  );
  return { supported: true, advisoryOnly: true };
}

/** Post-commit hook for the admin Student-verification workflow (best-effort). */
export async function notifyStudentVerificationOutcome(providerId: string, outcome: 'VERIFIED' | 'REJECTED'): Promise<void> {
  try {
    const attribution = (await (prisma as any).trainingAttribution.findFirst({
      where: { providerId, status: 'ACTIVE' },
    })) as any;
    if (!attribution) return;
    const partner = (await (prisma as any).trainingPartner.findUnique({ where: { id: attribution.partnerId } })) as any;
    const provider = (await prisma.providerProfile.findUnique({ where: { id: providerId } } as never)) as any;
    if (provider?.userId) {
      await notify({
        recipientUserId: provider.userId,
        type: outcome === 'VERIFIED' ? 'STUDENT_VERIFICATION_APPROVED' : 'STUDENT_VERIFICATION_REJECTED',
        title: outcome === 'VERIFIED' ? 'Student verification approved' : 'Student verification outcome',
        message:
          outcome === 'VERIFIED'
            ? 'Your Student verification was approved. The verified Student commission rate now applies to eligible services.'
            : 'Your Student verification was not approved. Contact support for next steps.',
        entityType: 'provider_profile',
        entityId: providerId,
        eventKey: `student:outcome:${providerId}:${outcome}`,
      });
    }
    await notifyPartnerMembers(attribution.partnerId, `student:outcome:${providerId}:${outcome}`, () => ({
      type: outcome === 'VERIFIED' ? 'STUDENT_VERIFICATION_APPROVED' : 'STUDENT_VERIFICATION_REJECTED',
      title: 'Student verification result',
      message: `Student verification for an attributed provider was ${outcome === 'VERIFIED' ? 'approved' : 'not approved'} (${partner?.displayName ?? 'your organisation'} attribution retained).`,
      entityType: 'provider_profile',
      entityId: providerId,
    }));
  } catch {
    // Never breaks verification writes.
  }
}

// ── Partner share resolution + accruals ─────────────────────────────────

export interface ResolvedShare {
  percent: number;
  ruleId: string | null;
  source: 'PARTNER' | 'PROGRAMME' | 'GLOBAL' | 'DEFAULT_SETTING';
}

async function getDefaultSharePercent(): Promise<number> {
  try {
    const row = await prisma.adminSetting.findUnique({ where: { settingKey: 'partner_share_default_percent' } });
    const n = Number((row as any)?.settingValue);
    if (Number.isFinite(n) && n >= 0 && n <= 100) return n;
  } catch {}
  return 0;
}

/** Precedence: active PARTNER rule → active PROGRAMME rule → active GLOBAL rule → admin default. */
export async function resolvePartnerShare(partnerId: string, programme?: string | null): Promise<ResolvedShare> {
  const now = new Date();
  const usable = (r: any) =>
    r && r.isActive && new Date(r.effectiveFrom).getTime() <= now.getTime() && (!r.effectiveTo || new Date(r.effectiveTo).getTime() > now.getTime());
  try {
    const partnerRule = (await (prisma as any).partnerShareRule.findFirst({
      where: { scope: 'PARTNER', partnerId, isActive: true },
      orderBy: { effectiveFrom: 'desc' },
    })) as any;
    if (usable(partnerRule)) return { percent: Number(partnerRule.percent), ruleId: partnerRule.id, source: 'PARTNER' };
    if (programme) {
      const programmeRule = (await (prisma as any).partnerShareRule.findFirst({
        where: { scope: 'PROGRAMME', programme, isActive: true },
        orderBy: { effectiveFrom: 'desc' },
      })) as any;
      if (usable(programmeRule)) return { percent: Number(programmeRule.percent), ruleId: programmeRule.id, source: 'PROGRAMME' };
    }
    const globalRule = (await (prisma as any).partnerShareRule.findFirst({
      where: { scope: 'GLOBAL', isActive: true },
      orderBy: { effectiveFrom: 'desc' },
    })) as any;
    if (usable(globalRule)) return { percent: Number(globalRule.percent), ruleId: globalRule.id, source: 'GLOBAL' };
  } catch {
    // Fall through to default.
  }
  return { percent: await getDefaultSharePercent(), ruleId: null, source: 'DEFAULT_SETTING' };
}

function toNumber(d: unknown): number {
  if (d == null) return 0;
  if (typeof d === 'number') return d;
  const n = Number(d);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Create the partner accrual for an eligible COMPLETED booking. Idempotent
 * (unique bookingId + idempotencyKey). Returns null when there is no ACTIVE
 * attribution, no share configured, or the booking is not eligible.
 * Only COMPLETED bookings accrue — cancelled/declined/refunded/disputed
 * never accrue.
 */
export async function recordPartnerAccrualForBooking(bookingId: string): Promise<any | null> {
  const booking = (await prisma.booking.findUnique({ where: { id: bookingId } } as never)) as any;
  if (!booking) return null;
  if (String(booking.status) !== 'COMPLETED') return null;
  const providerId: string | null = booking.providerId ?? booking.assignedProviderId ?? null;
  if (!providerId) return null;
  const attribution = (await (prisma as any).trainingAttribution.findFirst({
    where: { providerId, status: 'ACTIVE' },
  })) as any;
  if (!attribution) return null;
  const partner = (await (prisma as any).trainingPartner.findUnique({ where: { id: attribution.partnerId } })) as any;
  if (!partner || partner.status !== 'ACTIVE') return null;

  let payment: any = null;
  try {
    payment = (await prisma.payment.findUnique({ where: { bookingId } } as never)) as any;
  } catch {
    payment = null;
  }
  if (payment && ['REFUNDED', 'CANCELLED', 'FAILED'].includes(String(payment.status))) return null;

  const gross = toNumber(booking.totalAmount ?? booking.subtotal ?? payment?.amount ?? 0);
  if (!(gross > 0)) return null;

  // Commission snapshot: prefer the payment record; else resolve the
  // provider's configured rate from the existing finance service.
  let commissionRate: number | null = payment?.commissionRate != null ? toNumber(payment.commissionRate) : null;
  let commissionAmount: number | null = payment?.commissionAmount != null ? toNumber(payment.commissionAmount) : null;
  if (commissionRate == null || commissionAmount == null) {
    try {
      const { getCommissionRateForProvider } = await import('../finance/commission.service');
      const provider = (await prisma.providerProfile.findUnique({
        where: { id: providerId },
        include: { tier: true },
      } as never)) as any;
      if (provider) {
        commissionRate = await getCommissionRateForProvider(provider);
        commissionAmount = Math.round(gross * (commissionRate / 100) * 100) / 100;
      }
    } catch {}
  }
  if (commissionRate == null || commissionAmount == null) return null;

  const share = await resolvePartnerShare(partner.id);
  if (!(share.percent > 0)) return null;
  const partnerAmount = Math.round(commissionAmount * (share.percent / 100) * 100) / 100;
  if (!(partnerAmount > 0)) return null;

  const idempotencyKey = `partner-accrual:${bookingId}`;
  try {
    const accrual = (await (prisma as any).partnerAccrual.create({
      data: {
        partnerId: partner.id,
        providerId,
        bookingId,
        paymentId: payment?.id ?? null,
        grossAmount: gross,
        commissionRate,
        commissionAmount,
        partnerPercent: share.percent,
        partnerAmount,
        currency: String(booking.currency ?? payment?.currency ?? 'ZAR'),
        ruleId: share.ruleId,
        status: 'ACCRUED',
        idempotencyKey,
      },
    })) as any;
    try {
      await prisma.auditLog.create({
        data: {
          actorUserId: null,
          action: 'PARTNER_ACCRUAL_CREATED',
          entityType: 'partner_accrual',
          entityId: accrual.id,
          afterJson: {
            partnerId: partner.id,
            providerId,
            bookingId,
            partnerPercent: share.percent,
            partnerAmount,
            ruleSource: share.source,
          } as any,
        },
      });
    } catch {}
    await notifyPartnerMembers(partner.id, `accrual:${bookingId}`, () => ({
      type: 'PARTNER_EARNING_ACCRUED',
      title: 'Partner earning accrued',
      message: `An eligible completed service accrued ${accrual.currency} ${partnerAmount} to your organisation (ledger accrual, not a payout).`,
      entityType: 'partner_accrual',
      entityId: accrual.id,
    }));
    return sanitizeAccrual(accrual);
  } catch (e: any) {
    // Duplicate (P2002 on bookingId/idempotencyKey) → return existing.
    const existing = (await (prisma as any).partnerAccrual
      .findUnique({ where: { bookingId } })
      .catch(() => null)) as any;
    if (existing) return sanitizeAccrual(existing);
    void e;
    return null;
  }
}

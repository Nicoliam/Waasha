import { prisma } from '../../config/prisma';
import { ActorCtx, INSTITUTION_TYPES, sanitizeAccrual, sanitizePartner } from './training-partner.service';

/**
 * Slice 17 — Admin partner oversight (extends the Slice 16 Admin Platform).
 * All functions assume requireAdmin already ran at the route layer.
 * Mutations are explicit, validated, audited domain operations. Financial
 * snapshots (accruals) are never mutated — only REVERSED via a new state
 * with reason. Historical attribution is never deleted.
 */

function fail(status: number, code: string, message: string, details?: unknown): never {
  const err = Object.assign(new Error(message), { status, code, details }) as Error & { status: number; code: string };
  throw err;
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
    await emitNotification({ audience: 'PROVIDER', ...intent } as never).catch(() => {});
  } catch {}
}

async function notifyPartnerMembers(partnerId: string, eventKey: string, type: string, title: string, message: string): Promise<void> {
  try {
    const members = (await (prisma as any).trainingPartnerMember.findMany({
      where: { partnerId, status: 'ACTIVE' },
      select: { userId: true },
    })) as Array<{ userId: string }>;
    for (const m of members ?? []) {
      await notify({ recipientUserId: m.userId, type, title, message, entityType: 'training_partner', entityId: partnerId, eventKey: `${eventKey}:user:${m.userId}` });
    }
  } catch {}
}

export const MAX_PER_PAGE = 50;

function pagination(query: { page?: unknown; perPage?: unknown }) {
  const page = Math.min(10000, Math.max(1, Number(query.page ?? 1) || 1));
  const perPage = Math.min(MAX_PER_PAGE, Math.max(1, Number(query.perPage ?? 20) || 20));
  return { page, perPage, skip: (page - 1) * perPage, take: perPage };
}

// ── Partner lifecycle ───────────────────────────────────────────────────

export async function searchPartners(query: { q?: unknown; status?: unknown; page?: unknown; perPage?: unknown }) {
  const { page, perPage, skip, take } = pagination(query);
  const where: Record<string, unknown> = {};
  if (typeof query.status === 'string' && query.status) where.status = query.status;
  if (typeof query.q === 'string' && query.q.trim()) {
    where.OR = [
      { displayName: { contains: query.q.trim() } },
      { legalName: { contains: query.q.trim() } },
      { contactEmail: { contains: query.q.trim() } },
      { city: { contains: query.q.trim() } },
    ];
  }
  const [rows, total] = await Promise.all([
    (prisma as any).trainingPartner.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
    (prisma as any).trainingPartner.count({ where }),
  ]);
  return { partners: (rows as any[]).map(sanitizePartner), meta: { page, perPage, total } };
}

export async function getPartnerDetail(id: string) {
  const partner = (await (prisma as any).trainingPartner.findUnique({ where: { id } })) as any;
  if (!partner) fail(404, 'PARTNER_NOT_FOUND', 'Training partner not found');
  const [members, attributions, rules, accruals, evidence] = await Promise.all([
    (prisma as any).trainingPartnerMember.findMany({ where: { partnerId: id }, orderBy: { createdAt: 'asc' } }),
    (prisma as any).trainingAttribution.findMany({ where: { partnerId: id }, orderBy: { createdAt: 'desc' }, take: 100 }),
    (prisma as any).partnerShareRule.findMany({ where: { partnerId: id }, orderBy: { createdAt: 'desc' }, take: 50 }),
    (prisma as any).partnerAccrual.findMany({ where: { partnerId: id }, orderBy: { earnedAt: 'desc' }, take: 100 }),
    (prisma as any).trainingEvidence.findMany({ where: { partnerId: id }, orderBy: { createdAt: 'desc' }, take: 100 }),
  ]);
  const memberRows = (members as any[]).map((m) => ({ id: m.id, userId: m.userId, role: m.role, status: m.status, createdAt: m.createdAt }));
  return {
    partner: sanitizePartner(partner),
    members: memberRows,
    attributions: (attributions as any[]).map((a) => ({
      id: a.id, providerId: a.providerId, source: a.source, status: a.status,
      referredAt: a.referredAt, approvedAt: a.approvedAt ?? null, endedAt: a.endedAt ?? null,
    })),
    shareRules: rules,
    accruals: (accruals as any[]).map(sanitizeAccrual),
    evidence: (evidence as any[]).map((e) => ({
      id: e.id, providerId: e.providerId, programme: e.programme ?? null,
      qualificationReference: e.qualificationReference ?? null, status: e.status, createdAt: e.createdAt,
    })),
  };
}

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  PENDING: ['ACTIVE', 'DEACTIVATED'],
  ACTIVE: ['SUSPENDED', 'DEACTIVATED'],
  SUSPENDED: ['ACTIVE', 'DEACTIVATED'],
  DEACTIVATED: [],
};

/** Approve / suspend / deactivate a partner. Audited. History retained — never deleted. */
export async function setPartnerStatus(id: string, status: string, ctx: ActorCtx) {
  if (!['PENDING', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED'].includes(status)) {
    fail(422, 'VALIDATION_ERROR', 'Invalid partner status');
  }
  const partner = (await (prisma as any).trainingPartner.findUnique({ where: { id } })) as any;
  if (!partner) fail(404, 'PARTNER_NOT_FOUND', 'Training partner not found');
  if (!(ALLOWED_TRANSITIONS[String(partner.status)] ?? []).includes(status)) {
    fail(422, 'PARTNER_INVALID_TRANSITION', `Cannot transition partner from ${partner.status} to ${status}`);
  }
  const updated = (await (prisma as any).trainingPartner.update({ where: { id }, data: { status } })) as any;
  await audit({
    actorUserId: ctx.actorUserId,
    action: status === 'ACTIVE' && partner.status === 'PENDING' ? 'PARTNER_APPROVED' : 'PARTNER_STATUS_CHANGED',
    entityType: 'training_partner',
    entityId: id,
    beforeJson: { status: partner.status },
    afterJson: { status },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });
  await notifyPartnerMembers(
    id,
    `partner:status:${id}:${status}`,
    status === 'ACTIVE' ? 'PARTNER_APPROVED' : 'PARTNER_STATUS_CHANGED',
    status === 'ACTIVE' ? 'Partnership approved' : 'Partnership status changed',
    status === 'ACTIVE'
      ? `${partner.displayName} is now an ACTIVE Waasha training-centre partner. Attribution history is unaffected.`
      : `Your organisation's partnership status changed to ${status}. Historical attribution and accruals are retained.`,
  );
  return sanitizePartner(updated);
}

export async function setPartnerVerification(id: string, action: 'APPROVE' | 'REJECT' | 'RESET', ctx: ActorCtx) {
  if (!['APPROVE', 'REJECT', 'RESET'].includes(action)) fail(422, 'VALIDATION_ERROR', 'action must be APPROVE, REJECT or RESET');
  const partner = (await (prisma as any).trainingPartner.findUnique({ where: { id } })) as any;
  if (!partner) fail(404, 'PARTNER_NOT_FOUND', 'Training partner not found');
  const status = action === 'APPROVE' ? 'VERIFIED' : action === 'REJECT' ? 'REJECTED' : 'UNVERIFIED';
  const updated = (await (prisma as any).trainingPartner.update({ where: { id }, data: { verificationStatus: status } })) as any;
  await audit({
    actorUserId: ctx.actorUserId,
    action: 'PARTNER_VERIFICATION_CHANGED',
    entityType: 'training_partner',
    entityId: id,
    beforeJson: { verificationStatus: partner.verificationStatus },
    afterJson: { verificationStatus: status },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });
  return sanitizePartner(updated);
}

// ── Attribution oversight ───────────────────────────────────────────────

function isUniqueViolation(e: any): boolean {
  return (e as any)?.code === 'P2002' || String((e as any)?.message ?? '').includes('training_centre_providers');
}

async function lockProviderAttributions(tx: any, providerId: string): Promise<void> {
  try {
    if (tx && typeof tx.$queryRaw === 'function') {
      await tx.$queryRaw`SELECT id FROM training_centre_providers WHERE provider_id = ${providerId} FOR UPDATE`;
    }
  } catch {
    // Hardening only — checks + constraint mapping below stay authoritative.
  }
}

/** Direct admin attribution (audited). Provider must not already be ACTIVE elsewhere. */
export async function adminAttributeProvider(partnerId: string, providerId: string, ctx: ActorCtx) {
  const partner = (await (prisma as any).trainingPartner.findUnique({ where: { id: partnerId } })) as any;
  if (!partner) fail(404, 'PARTNER_NOT_FOUND', 'Training partner not found');
  if (partner.status !== 'ACTIVE') fail(422, 'PARTNER_INACTIVE', 'Only ACTIVE partners can receive attribution');
  const provider = (await prisma.providerProfile.findUnique({ where: { id: providerId } } as never)) as any;
  if (!provider) fail(404, 'PROVIDER_NOT_FOUND', 'Provider not found');
  let attribution: any;
  try {
    attribution = await (prisma as any).$transaction(async (tx: any) => {
      await lockProviderAttributions(tx, providerId);
      const existingActive = await tx.trainingAttribution.findFirst({ where: { providerId, status: 'ACTIVE' } });
      if (existingActive) fail(422, 'ATTRIBUTION_EXISTS', 'Provider already has an active training-centre attribution');
      const duplicate = await tx.trainingAttribution.findUnique({ where: { partnerId_providerId: { partnerId, providerId } } });
      if (duplicate) fail(422, 'ATTRIBUTION_EXISTS', 'Provider already attributed to this partner');
      const created = await tx.trainingAttribution.create({
        data: { partnerId, providerId, referredUserId: provider.userId ?? null, source: 'ADMIN_ATTRIBUTION', status: 'ACTIVE', approvedAt: new Date() },
      });
      try {
        const actives = await tx.trainingAttribution.findMany?.({ where: { providerId, status: 'ACTIVE' } });
        if (Array.isArray(actives) && actives.length > 1) {
          fail(409, 'ATTRIBUTION_CONFLICT', 'Concurrent attribution conflict — retry');
        }
      } catch (guardErr: any) {
        if (guardErr && typeof guardErr.status === 'number') throw guardErr;
      }
      return created;
    });
  } catch (e: any) {
    if (e && typeof e.status === 'number') throw e;
    if (isUniqueViolation(e)) fail(422, 'ATTRIBUTION_EXISTS', 'Provider already has an active training-centre attribution');
    throw e;
  }
  await audit({
    actorUserId: ctx.actorUserId, action: 'ATTRIBUTION_CREATED_ADMIN', entityType: 'training_attribution',
    entityId: attribution.id, afterJson: { partnerId, providerId }, ip: ctx.ip, userAgent: ctx.userAgent,
  });
  return { id: attribution.id, partnerId, providerId, status: attribution.status };
}

/**
 * End an attribution (audited). Optionally reassign to another ACTIVE
 * partner in the same transaction (explicit audited reassignment — the
 * provider can never change partners by themselves).
 */
export async function adminEndAttribution(
  attributionId: string,
  input: { reason?: string | null; reassignToPartnerId?: string | null },
  ctx: ActorCtx,
) {
  const attribution = (await (prisma as any).trainingAttribution.findUnique({ where: { id: attributionId } })) as any;
  if (!attribution) fail(404, 'ATTRIBUTION_NOT_FOUND', 'Attribution not found');
  if (attribution.status !== 'ACTIVE') fail(422, 'ATTRIBUTION_INVALID_STATE', 'Only ACTIVE attributions can be ended');
  let newAttribution: any = null;
  if (input.reassignToPartnerId) {
    const target = (await (prisma as any).trainingPartner.findUnique({ where: { id: input.reassignToPartnerId } })) as any;
    if (!target) fail(404, 'PARTNER_NOT_FOUND', 'Target partner not found');
    if (target.status !== 'ACTIVE') fail(422, 'PARTNER_INACTIVE', 'Reassignment target must be ACTIVE');
    if (target.id === attribution.partnerId) fail(422, 'VALIDATION_ERROR', 'Reassignment target must differ from current partner');
  }
  // Slice 19 — conditional end + guarded reassignment in one transaction:
  // concurrent ends resolve deterministically (exactly one succeeds), and
  // reassignment never leaves duplicate ACTIVE rows (lock + post-check).
  try {
    await (prisma as any).$transaction(async (tx: any) => {
      await lockProviderAttributions(tx, attribution.providerId);
      const ended =
        typeof tx.trainingAttribution.updateMany === 'function'
          ? await tx.trainingAttribution.updateMany({
              where: { id: attributionId, status: 'ACTIVE' },
              data: { status: 'ENDED', endedAt: new Date(), endedReason: input.reason ?? null },
            })
          : await tx.trainingAttribution.update({
              where: { id: attributionId },
              data: { status: 'ENDED', endedAt: new Date(), endedReason: input.reason ?? null },
            }).then((r: any) => ({ count: r ? 1 : 0 }));
      if (Number((ended as any)?.count) !== 1) {
        fail(422, 'ATTRIBUTION_INVALID_STATE', 'Only ACTIVE attributions can be ended');
      }
      if (input.reassignToPartnerId) {
        newAttribution = await tx.trainingAttribution.create({
          data: {
            partnerId: input.reassignToPartnerId,
            providerId: attribution.providerId,
            referredUserId: attribution.referredUserId ?? null,
            source: 'ADMIN_ATTRIBUTION',
            status: 'ACTIVE',
            approvedAt: new Date(),
          },
        });
        try {
          const actives = await tx.trainingAttribution.findMany?.({
            where: { providerId: attribution.providerId, status: 'ACTIVE' },
          });
          if (Array.isArray(actives) && actives.length > 1) {
            fail(409, 'ATTRIBUTION_CONFLICT', 'Concurrent attribution conflict — retry');
          }
        } catch (guardErr: any) {
          if (guardErr && typeof guardErr.status === 'number') throw guardErr;
        }
      }
    });
  } catch (e: any) {
    if (e && typeof e.status === 'number') throw e;
    if (isUniqueViolation(e)) fail(422, 'ATTRIBUTION_EXISTS', 'Provider already has an active training-centre attribution');
    throw e;
  }
  await audit({
    actorUserId: ctx.actorUserId,
    action: input.reassignToPartnerId ? 'ATTRIBUTION_REASSIGNED' : 'ATTRIBUTION_ENDED',
    entityType: 'training_attribution',
    entityId: attributionId,
    beforeJson: { partnerId: attribution.partnerId, status: 'ACTIVE' },
    afterJson: { status: 'ENDED', reassignToPartnerId: input.reassignToPartnerId ?? null, newAttributionId: newAttribution?.id ?? null },
    ip: ctx.ip,
    userAgent: ctx.userAgent,
  });
  return { id: attributionId, status: 'ENDED' as const, reassignedTo: newAttribution ? { id: newAttribution.id, partnerId: newAttribution.partnerId } : null };
}

// ── Evidence review ─────────────────────────────────────────────────────

export async function reviewEvidence(evidenceId: string, action: 'APPROVE' | 'REJECT', note: string | null, ctx: ActorCtx) {
  if (!['APPROVE', 'REJECT'].includes(action)) fail(422, 'VALIDATION_ERROR', 'action must be APPROVE or REJECT');
  const evidence = (await (prisma as any).trainingEvidence.findUnique({ where: { id: evidenceId } })) as any;
  if (!evidence) fail(404, 'EVIDENCE_NOT_FOUND', 'Training evidence not found');
  if (!['SUBMITTED', 'UNDER_REVIEW'].includes(String(evidence.status))) {
    fail(422, 'EVIDENCE_INVALID_STATE', `Evidence is ${evidence.status} and cannot be reviewed`);
  }
  const status = action === 'APPROVE' ? 'APPROVED' : 'REJECTED';
  const updated = (await (prisma as any).trainingEvidence.update({
    where: { id: evidenceId },
    data: { status, reviewedBy: ctx.actorUserId, reviewedAt: new Date(), reviewNote: note ?? null },
  })) as any;
  await audit({
    actorUserId: ctx.actorUserId, action: 'TRAINING_EVIDENCE_REVIEWED', entityType: 'training_evidence',
    entityId: evidenceId, beforeJson: { status: evidence.status }, afterJson: { status },
    ip: ctx.ip, userAgent: ctx.userAgent,
  });
  return { id: updated.id, status: updated.status };
}

// ── Share rules ─────────────────────────────────────────────────────────

function validatePercent(percent: unknown): number {
  const n = Number(percent);
  if (!Number.isFinite(n) || n < 0 || n > 100) fail(422, 'VALIDATION_ERROR', 'percent must be a number between 0 and 100');
  return Math.round(n * 100) / 100;
}

export async function createShareRule(
  input: { scope: string; partnerId?: string | null; programme?: string | null; percent: number; effectiveFrom?: string | null; effectiveTo?: string | null },
  ctx: ActorCtx,
) {
  if (!['GLOBAL', 'PARTNER', 'PROGRAMME'].includes(input.scope)) fail(422, 'VALIDATION_ERROR', 'scope must be GLOBAL, PARTNER or PROGRAMME');
  const percent = validatePercent(input.percent);
  if (input.scope === 'PARTNER') {
    if (!input.partnerId) fail(422, 'VALIDATION_ERROR', 'partnerId is required for PARTNER scope');
    const partner = (await (prisma as any).trainingPartner.findUnique({ where: { id: input.partnerId } })) as any;
    if (!partner) fail(404, 'PARTNER_NOT_FOUND', 'Training partner not found');
  }
  if (input.scope === 'GLOBAL' && input.partnerId) fail(422, 'VALIDATION_ERROR', 'GLOBAL rules must not carry a partnerId');
  if (input.scope === 'PROGRAMME' && !input.programme) fail(422, 'VALIDATION_ERROR', 'programme is required for PROGRAMME scope');
  const rule = (await (prisma as any).partnerShareRule.create({
    data: {
      scope: input.scope,
      partnerId: input.partnerId ?? null,
      programme: input.programme ?? null,
      percent,
      currency: 'ZAR',
      isActive: true,
      effectiveFrom: input.effectiveFrom ? new Date(input.effectiveFrom) : new Date(),
      effectiveTo: input.effectiveTo ? new Date(input.effectiveTo) : null,
      createdBy: ctx.actorUserId,
    },
  })) as any;
  await audit({
    actorUserId: ctx.actorUserId, action: 'PARTNER_RULE_CREATED', entityType: 'partner_share_rule',
    entityId: rule.id, afterJson: { scope: rule.scope, partnerId: rule.partnerId ?? null, percent },
    ip: ctx.ip, userAgent: ctx.userAgent,
  });
  return rule;
}

export async function updateShareRule(
  id: string,
  input: { percent?: number; isActive?: boolean; effectiveTo?: string | null },
  ctx: ActorCtx,
) {
  const rule = (await (prisma as any).partnerShareRule.findUnique({ where: { id } })) as any;
  if (!rule) fail(404, 'RULE_NOT_FOUND', 'Share rule not found');
  const patch: Record<string, unknown> = {};
  if (input.percent !== undefined) patch.percent = validatePercent(input.percent);
  if (input.isActive !== undefined) patch.isActive = Boolean(input.isActive);
  if (input.effectiveTo !== undefined) patch.effectiveTo = input.effectiveTo ? new Date(input.effectiveTo) : null;
  const updated = (await (prisma as any).partnerShareRule.update({ where: { id }, data: patch })) as any;
  await audit({
    actorUserId: ctx.actorUserId, action: 'PARTNER_RULE_UPDATED', entityType: 'partner_share_rule',
    entityId: id, beforeJson: { percent: Number(rule.percent), isActive: rule.isActive }, afterJson: patch,
    ip: ctx.ip, userAgent: ctx.userAgent,
  });
  return updated;
}

export async function listShareRules(query: { scope?: unknown; partnerId?: unknown; page?: unknown; perPage?: unknown }) {
  const { page, perPage, skip, take } = pagination(query);
  const where: Record<string, unknown> = {};
  if (typeof query.scope === 'string' && query.scope) where.scope = query.scope;
  if (typeof query.partnerId === 'string' && query.partnerId) where.partnerId = query.partnerId;
  const [rows, total] = await Promise.all([
    (prisma as any).partnerShareRule.findMany({ where, orderBy: { createdAt: 'desc' }, skip, take }),
    (prisma as any).partnerShareRule.count({ where }),
  ]);
  return { rules: rows, meta: { page, perPage, total } };
}

// ── Accrual oversight ───────────────────────────────────────────────────

export async function listAccruals(query: { partnerId?: unknown; status?: unknown; page?: unknown; perPage?: unknown }) {
  const { page, perPage, skip, take } = pagination(query);
  const where: Record<string, unknown> = {};
  if (typeof query.partnerId === 'string' && query.partnerId) where.partnerId = query.partnerId;
  if (typeof query.status === 'string' && query.status) where.status = query.status;
  const [rows, total] = await Promise.all([
    (prisma as any).partnerAccrual.findMany({ where, orderBy: { earnedAt: 'desc' }, skip, take }),
    (prisma as any).partnerAccrual.count({ where }),
  ]);
  const totalAccrued = (rows as any[]).filter((r) => r.status === 'ACCRUED').reduce((s, r) => s + Number(r.partnerAmount ?? 0), 0);
  return {
    accruals: (rows as any[]).map(sanitizeAccrual),
    meta: { page, perPage, total },
    totals: { accruedAmount: Math.round(totalAccrued * 100) / 100, currency: 'ZAR' },
    disclaimer: 'Accruals are ledger records awaiting the payout mechanism. Accrual is not payment.',
  };
}

/** Reverse an accrual (e.g. refunded/disputed booking). Creates state, never edits history. */
export async function reverseAccrual(accrualId: string, reason: string | null, ctx: ActorCtx) {
  const accrual = (await (prisma as any).partnerAccrual.findUnique({ where: { id: accrualId } })) as any;
  if (!accrual) fail(404, 'ACCRUAL_NOT_FOUND', 'Accrual not found');
  if (accrual.status !== 'ACCRUED') fail(422, 'ACCRUAL_INVALID_STATE', `Accrual is ${accrual.status}`);
  const updated = (await (prisma as any).partnerAccrual.update({ where: { id: accrualId }, data: { status: 'REVERSED' } })) as any;
  await audit({
    actorUserId: ctx.actorUserId, action: 'PARTNER_ACCRUAL_REVERSED', entityType: 'partner_accrual',
    entityId: accrualId, beforeJson: { status: 'ACCRUED' }, afterJson: { status: 'REVERSED', reason: reason ?? null },
    ip: ctx.ip, userAgent: ctx.userAgent,
  });
  return sanitizeAccrual(updated);
}

export { INSTITUTION_TYPES };

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth';
import { requireAdmin } from '../admin/admin-auth';
import * as svc from './training-partner.service';
import * as adminSvc from './partner-admin.service';

/**
 * Slice 17 — Training-Centre Ecosystem API.
 *
 * Partner router  (/api/v1/partners): session-derived authorization only.
 * The partner id is NEVER taken from the client — every operation resolves
 * the caller's membership server-side. Partner users cannot touch admin,
 * finance configuration, Student verification outcomes, or other partners.
 *
 * Admin router (/api/v1/admin/partners): requireAdmin (DB-verified).
 *
 * All partner mutations are online-only; clients must block them offline
 * (never queue/fake) — see web/mobile partner services.
 */

function sendError(res: Response, err: any, fallback: string) {
  if (err && typeof err.status === 'number') {
    return res.status(err.status).json({
      success: false,
      error: { code: err.code ?? 'ERROR', message: err.message, ...(err.details !== undefined ? { details: err.details } : {}) },
    });
  }
  return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: fallback } });
}

function zodError(res: Response, error: z.ZodError) {
  return res.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid request', details: error.flatten() } });
}

function ctxOf(req: Request): svc.ActorCtx {
  return { actorUserId: req.authUser!.userId, ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined };
}

const pageQuery = z.object({
  page: z.coerce.number().int().min(1).max(10000).optional(),
  perPage: z.coerce.number().int().min(1).max(50).optional(),
  status: z.string().max(32).optional(),
});

// ── Partner router ──────────────────────────────────────────────────────

export const partnerRouter = Router();
partnerRouter.use(authMiddleware);

const applySchema = z.object({
  legalName: z.string().min(1).max(191),
  displayName: z.string().min(1).max(191),
  description: z.string().max(5000).nullable().optional(),
  institutionType: z.string().min(1).max(64),
  contactEmail: z.string().email().max(191).nullable().optional(),
  contactPhone: z.string().max(32).nullable().optional(),
  website: z.string().max(255).nullable().optional(),
  addressLine1: z.string().max(255).nullable().optional(),
  city: z.string().max(128).nullable().optional(),
  province: z.string().max(128).nullable().optional(),
  postalCode: z.string().max(16).nullable().optional(),
  country: z.string().max(8).nullable().optional(),
  categoriesServed: z.array(z.string().max(64)).max(5).nullable().optional(),
  logoUrl: z.string().max(1024).nullable().optional(),
}).strict();

partnerRouter.post('/apply', async (req: Request, res: Response) => {
  const parsed = applySchema.safeParse(req.body);
  if (!parsed.success) return zodError(res, parsed.error);
  try {
    const result = await svc.applyPartner(req.authUser!.userId, parsed.data as never, ctxOf(req));
    return res.status(201).json({ success: true, data: result });
  } catch (err: any) {
    return sendError(res, err, 'Failed to submit application');
  }
});

partnerRouter.get('/me', async (req: Request, res: Response) => {
  try {
    return res.json({ success: true, data: await svc.getMyPartner(req.authUser!.userId) });
  } catch (err: any) {
    return sendError(res, err, 'Failed to load partner');
  }
});

const profileSchema = z.object({
  legalName: z.string().min(1).max(191).optional(),
  displayName: z.string().min(1).max(191).optional(),
  description: z.string().max(5000).nullable().optional(),
  institutionType: z.string().min(1).max(64).optional(),
  contactEmail: z.string().email().max(191).nullable().optional(),
  contactPhone: z.string().max(32).nullable().optional(),
  website: z.string().max(255).nullable().optional(),
  addressLine1: z.string().max(255).nullable().optional(),
  city: z.string().max(128).nullable().optional(),
  province: z.string().max(128).nullable().optional(),
  postalCode: z.string().max(16).nullable().optional(),
  country: z.string().max(8).nullable().optional(),
  categoriesServed: z.array(z.string().max(64)).max(5).nullable().optional(),
  logoUrl: z.string().max(1024).nullable().optional(),
  // Explicitly rejected: status / verificationStatus can never be self-set.
  status: z.never().optional(),
  verificationStatus: z.never().optional(),
}).strict();

partnerRouter.patch('/me', async (req: Request, res: Response) => {
  const parsed = profileSchema.safeParse(req.body);
  if (!parsed.success) return zodError(res, parsed.error);
  try {
    return res.json({ success: true, data: { partner: await svc.updatePartnerProfile(req.authUser!.userId, parsed.data as never, ctxOf(req)) } });
  } catch (err: any) {
    return sendError(res, err, 'Failed to update profile');
  }
});

partnerRouter.get('/me/dashboard', async (req: Request, res: Response) => {
  try {
    return res.json({ success: true, data: await svc.getDashboard(req.authUser!.userId) });
  } catch (err: any) {
    return sendError(res, err, 'Failed to load dashboard');
  }
});

partnerRouter.get('/me/providers', async (req: Request, res: Response) => {
  const parsed = pageQuery.safeParse(req.query);
  if (!parsed.success) return zodError(res, parsed.error);
  try {
    const result = await svc.listAttributedProviders(req.authUser!.userId, parsed.data);
    return res.json({ success: true, data: result.data, meta: result.meta });
  } catch (err: any) {
    return sendError(res, err, 'Failed to list providers');
  }
});

partnerRouter.get('/me/earnings', async (req: Request, res: Response) => {
  const parsed = pageQuery.safeParse(req.query);
  if (!parsed.success) return zodError(res, parsed.error);
  try {
    const result = await svc.listEarnings(req.authUser!.userId, parsed.data);
    return res.json({ success: true, data: result.data, meta: { ...result.meta, disclaimer: result.disclaimer } });
  } catch (err: any) {
    return sendError(res, err, 'Failed to list earnings');
  }
});

// ── Referrals ──

const createReferralSchema = z.object({
  invitedEmail: z.string().email().max(191).nullable().optional(),
  invitedPhone: z.string().max(32).nullable().optional(),
  programme: z.string().max(191).nullable().optional(),
  ttlDays: z.number().int().min(1).max(365).nullable().optional(),
}).strict();

partnerRouter.post('/me/referrals', async (req: Request, res: Response) => {
  const parsed = createReferralSchema.safeParse(req.body);
  if (!parsed.success) return zodError(res, parsed.error);
  try {
    const result = await svc.createReferral(req.authUser!.userId, parsed.data, ctxOf(req));
    return res.status(201).json({ success: true, data: result });
  } catch (err: any) {
    return sendError(res, err, 'Failed to create referral');
  }
});

partnerRouter.get('/me/referrals', async (req: Request, res: Response) => {
  const parsed = pageQuery.safeParse(req.query);
  if (!parsed.success) return zodError(res, parsed.error);
  try {
    const result = await svc.listReferrals(req.authUser!.userId, parsed.data);
    return res.json({ success: true, data: result.data, meta: result.meta });
  } catch (err: any) {
    return sendError(res, err, 'Failed to list referrals');
  }
});

partnerRouter.post('/me/referrals/:id/revoke', async (req: Request, res: Response) => {
  try {
    return res.json({ success: true, data: await svc.revokeReferral(req.authUser!.userId, req.params.id, ctxOf(req)) });
  } catch (err: any) {
    return sendError(res, err, 'Failed to revoke referral');
  }
});

const redeemSchema = z.object({ code: z.string().min(1).max(256) }).strict();

partnerRouter.post('/referrals/redeem', async (req: Request, res: Response) => {
  const parsed = redeemSchema.safeParse(req.body);
  if (!parsed.success) return zodError(res, parsed.error);
  try {
    return res.json({ success: true, data: await svc.redeemReferral(req.authUser!.userId, parsed.data.code, ctxOf(req)) });
  } catch (err: any) {
    return sendError(res, err, 'Failed to redeem referral');
  }
});

partnerRouter.post('/me/attribution/link', async (req: Request, res: Response) => {
  try {
    return res.status(201).json({ success: true, data: await svc.linkAttribution(req.authUser!.userId, ctxOf(req)) });
  } catch (err: any) {
    return sendError(res, err, 'Failed to link attribution');
  }
});

// ── Evidence ──

const evidenceSchema = z.object({
  providerId: z.string().min(1).max(191),
  programme: z.string().max(191).nullable().optional(),
  qualificationReference: z.string().max(255).nullable().optional(),
  institutionConfirmation: z.string().max(5000).nullable().optional(),
  completionDate: z.string().max(32).nullable().optional(),
  mediaAssetId: z.string().max(191).nullable().optional(),
}).strict();

partnerRouter.post('/me/evidence', async (req: Request, res: Response) => {
  const parsed = evidenceSchema.safeParse(req.body);
  if (!parsed.success) return zodError(res, parsed.error);
  try {
    const result = await svc.submitEvidence(req.authUser!.userId, parsed.data as never, ctxOf(req));
    return res.status(201).json({ success: true, data: result });
  } catch (err: any) {
    return sendError(res, err, 'Failed to submit evidence');
  }
});

partnerRouter.get('/me/evidence', async (req: Request, res: Response) => {
  const parsed = pageQuery.safeParse(req.query);
  if (!parsed.success) return zodError(res, parsed.error);
  try {
    const result = await svc.listEvidence(req.authUser!.userId, parsed.data);
    return res.json({ success: true, data: result.data, meta: result.meta });
  } catch (err: any) {
    return sendError(res, err, 'Failed to list evidence');
  }
});

partnerRouter.post('/me/providers/:providerId/support-verification', async (req: Request, res: Response) => {
  try {
    return res.json({ success: true, data: await svc.supportStudentVerification(req.authUser!.userId, req.params.providerId, ctxOf(req)) });
  } catch (err: any) {
    return sendError(res, err, 'Failed to record verification support');
  }
});

// ── Admin router ────────────────────────────────────────────────────────

export const adminPartnerRouter = Router();
adminPartnerRouter.use(authMiddleware);
adminPartnerRouter.use(requireAdmin);

function adminCtx(req: Request): { actorUserId: string; ip?: string; userAgent?: string } {
  return { actorUserId: req.authUser!.userId, ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined };
}

const partnerSearchQuery = pageQuery.extend({
  q: z.string().max(191).optional(),
});

adminPartnerRouter.get('/', async (req: Request, res: Response) => {
  const parsed = partnerSearchQuery.safeParse(req.query);
  if (!parsed.success) return zodError(res, parsed.error);
  try {
    const result = await adminSvc.searchPartners(parsed.data);
    return res.json({ success: true, data: result.partners, meta: result.meta });
  } catch (err: any) {
    return sendError(res, err, 'Failed to search partners');
  }
});

adminPartnerRouter.get('/:id', async (req: Request, res: Response) => {
  try {
    return res.json({ success: true, data: await adminSvc.getPartnerDetail(req.params.id) });
  } catch (err: any) {
    return sendError(res, err, 'Failed to load partner');
  }
});

const statusBody = z.object({ status: z.enum(['PENDING', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED']) }).strict();

adminPartnerRouter.post('/:id/status', async (req: Request, res: Response) => {
  const parsed = statusBody.safeParse(req.body);
  if (!parsed.success) return zodError(res, parsed.error);
  try {
    return res.json({ success: true, data: await adminSvc.setPartnerStatus(req.params.id, parsed.data.status, adminCtx(req) as never) });
  } catch (err: any) {
    return sendError(res, err, 'Failed to update partner status');
  }
});

const verificationBody = z.object({ action: z.enum(['APPROVE', 'REJECT', 'RESET']) }).strict();

adminPartnerRouter.post('/:id/verification', async (req: Request, res: Response) => {
  const parsed = verificationBody.safeParse(req.body);
  if (!parsed.success) return zodError(res, parsed.error);
  try {
    return res.json({ success: true, data: await adminSvc.setPartnerVerification(req.params.id, parsed.data.action, adminCtx(req) as never) });
  } catch (err: any) {
    return sendError(res, err, 'Failed to update verification');
  }
});

const attributeBody = z.object({ providerId: z.string().min(1).max(191) }).strict();

adminPartnerRouter.post('/:id/attributions', async (req: Request, res: Response) => {
  const parsed = attributeBody.safeParse(req.body);
  if (!parsed.success) return zodError(res, parsed.error);
  try {
    const result = await adminSvc.adminAttributeProvider(req.params.id, parsed.data.providerId, adminCtx(req) as never);
    return res.status(201).json({ success: true, data: result });
  } catch (err: any) {
    return sendError(res, err, 'Failed to attribute provider');
  }
});

const endAttributionBody = z.object({
  reason: z.string().max(2000).nullable().optional(),
  reassignToPartnerId: z.string().max(191).nullable().optional(),
}).strict();

adminPartnerRouter.post('/attributions/:attributionId/end', async (req: Request, res: Response) => {
  const parsed = endAttributionBody.safeParse(req.body);
  if (!parsed.success) return zodError(res, parsed.error);
  try {
    return res.json({ success: true, data: await adminSvc.adminEndAttribution(req.params.attributionId, parsed.data, adminCtx(req) as never) });
  } catch (err: any) {
    return sendError(res, err, 'Failed to end attribution');
  }
});

const reviewBody = z.object({ action: z.enum(['APPROVE', 'REJECT']), note: z.string().max(2000).nullable().optional() }).strict();

adminPartnerRouter.post('/evidence/:evidenceId/review', async (req: Request, res: Response) => {
  const parsed = reviewBody.safeParse(req.body);
  if (!parsed.success) return zodError(res, parsed.error);
  try {
    return res.json({ success: true, data: await adminSvc.reviewEvidence(req.params.evidenceId, parsed.data.action, parsed.data.note ?? null, adminCtx(req) as never) });
  } catch (err: any) {
    return sendError(res, err, 'Failed to review evidence');
  }
});

const ruleBody = z.object({
  scope: z.enum(['GLOBAL', 'PARTNER', 'PROGRAMME']),
  partnerId: z.string().max(191).nullable().optional(),
  programme: z.string().max(191).nullable().optional(),
  percent: z.number().min(0).max(100),
  effectiveFrom: z.string().max(64).nullable().optional(),
  effectiveTo: z.string().max(64).nullable().optional(),
}).strict();

adminPartnerRouter.post('/share-rules', async (req: Request, res: Response) => {
  const parsed = ruleBody.safeParse(req.body);
  if (!parsed.success) return zodError(res, parsed.error);
  try {
    const result = await adminSvc.createShareRule(parsed.data as never, adminCtx(req) as never);
    return res.status(201).json({ success: true, data: result });
  } catch (err: any) {
    return sendError(res, err, 'Failed to create share rule');
  }
});

const ruleUpdateBody = z.object({
  percent: z.number().min(0).max(100).optional(),
  isActive: z.boolean().optional(),
  effectiveTo: z.string().max(64).nullable().optional(),
}).strict();

adminPartnerRouter.patch('/share-rules/:ruleId', async (req: Request, res: Response) => {
  const parsed = ruleUpdateBody.safeParse(req.body);
  if (!parsed.success) return zodError(res, parsed.error);
  try {
    return res.json({ success: true, data: await adminSvc.updateShareRule(req.params.ruleId, parsed.data, adminCtx(req) as never) });
  } catch (err: any) {
    return sendError(res, err, 'Failed to update share rule');
  }
});

adminPartnerRouter.get('/share-rules/list', async (req: Request, res: Response) => {
  try {
    const result = await adminSvc.listShareRules(req.query as never);
    return res.json({ success: true, data: result.rules, meta: result.meta });
  } catch (err: any) {
    return sendError(res, err, 'Failed to list share rules');
  }
});

adminPartnerRouter.get('/accruals/list', async (req: Request, res: Response) => {
  try {
    const result = await adminSvc.listAccruals(req.query as never);
    return res.json({ success: true, data: result.accruals, meta: { ...result.meta, totals: result.totals, disclaimer: result.disclaimer } });
  } catch (err: any) {
    return sendError(res, err, 'Failed to list accruals');
  }
});

const reverseBody = z.object({ reason: z.string().max(2000).nullable().optional() }).strict();

adminPartnerRouter.post('/accruals/:accrualId/reverse', async (req: Request, res: Response) => {
  const parsed = reverseBody.safeParse(req.body);
  if (!parsed.success) return zodError(res, parsed.error);
  try {
    return res.json({ success: true, data: await adminSvc.reverseAccrual(req.params.accrualId, parsed.data.reason ?? null, adminCtx(req) as never) });
  } catch (err: any) {
    return sendError(res, err, 'Failed to reverse accrual');
  }
});

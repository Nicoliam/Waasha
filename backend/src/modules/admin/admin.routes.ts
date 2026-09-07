import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth';
import { requireAdmin } from './admin-auth';
import * as svc from './admin.service';

/**
 * Slice 16 — Admin Platform API (/api/v1/admin).
 *
 * All endpoints require an authenticated ADMIN (session-derived,
 * DB-verified via requireAdmin). There is no generic CRUD: every route
 * maps to an explicit audited domain operation in admin.service.
 *
 * Read-only oversight is preferred; mutations are limited to:
 *  user/provider status, provider + Student verification, settings,
 *  media moderation, and invitation revocation. Bookings, payments and
 *  financial snapshots are never mutated here.
 */

const router = Router();

router.use(authMiddleware);
router.use(requireAdmin);

function ctxOf(req: Request): svc.ActorCtx {
  return {
    actorUserId: req.authUser!.userId,
    ip: req.ip,
    userAgent: req.headers['user-agent'] as string | undefined,
  };
}

function sendError(res: Response, err: any, fallback: string) {
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
  return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: fallback } });
}

function zodError(res: Response, error: z.ZodError) {
  return res.status(422).json({
    success: false,
    error: { code: 'VALIDATION_ERROR', message: 'Invalid request', details: error.flatten() },
  });
}

const pageQuery = z.object({
  page: z.coerce.number().int().min(1).max(10000).optional(),
  perPage: z.coerce.number().int().min(1).max(50).optional(),
});

const idParam = z.object({ id: z.string().min(1).max(191) });

// ── Dashboard ───────────────────────────────────────────────────────────

router.get('/dashboard', async (_req: Request, res: Response) => {
  try {
    return res.json({ success: true, data: await svc.getDashboard() });
  } catch (err: any) {
    return sendError(res, err, 'Failed to load dashboard');
  }
});

// ── Users ───────────────────────────────────────────────────────────────

const userSearchQuery = pageQuery.extend({
  q: z.string().max(191).optional(),
  status: z.string().max(32).optional(),
});

router.get('/users', async (req: Request, res: Response) => {
  const parsed = userSearchQuery.safeParse(req.query);
  if (!parsed.success) return zodError(res, parsed.error);
  try {
    const result = await svc.searchUsers(parsed.data);
    return res.json({ success: true, data: result.users, meta: result.meta });
  } catch (err: any) {
    return sendError(res, err, 'Failed to search users');
  }
});

router.get('/users/:id', async (req: Request, res: Response) => {
  const parsed = idParam.safeParse(req.params);
  if (!parsed.success) return zodError(res, parsed.error);
  try {
    return res.json({ success: true, data: await svc.getUserDetail(parsed.data.id) });
  } catch (err: any) {
    return sendError(res, err, 'Failed to load user');
  }
});

const userStatusBody = z.object({ status: z.string().min(1).max(32) }).strict();

router.patch('/users/:id/status', async (req: Request, res: Response) => {
  const p = idParam.safeParse(req.params);
  if (!p.success) return zodError(res, p.error);
  const b = userStatusBody.safeParse(req.body ?? {});
  if (!b.success) return zodError(res, b.error);
  try {
    return res.json({ success: true, data: await svc.setUserStatus(p.data.id, b.data.status, ctxOf(req)) });
  } catch (err: any) {
    return sendError(res, err, 'Failed to update user status');
  }
});

// ── Providers ───────────────────────────────────────────────────────────

const providerSearchQuery = pageQuery.extend({
  q: z.string().max(191).optional(),
  tier: z.string().max(16).optional(),
  verificationStatus: z.string().max(32).optional(),
  student: z.string().max(16).optional(),
  status: z.string().max(32).optional(),
});

router.get('/providers', async (req: Request, res: Response) => {
  const parsed = providerSearchQuery.safeParse(req.query);
  if (!parsed.success) return zodError(res, parsed.error);
  try {
    const result = await svc.searchProviders(parsed.data);
    return res.json({ success: true, data: result.providers, meta: result.meta });
  } catch (err: any) {
    return sendError(res, err, 'Failed to search providers');
  }
});

router.get('/providers/:id', async (req: Request, res: Response) => {
  const parsed = idParam.safeParse(req.params);
  if (!parsed.success) return zodError(res, parsed.error);
  try {
    return res.json({ success: true, data: await svc.getProviderDetail(parsed.data.id) });
  } catch (err: any) {
    return sendError(res, err, 'Failed to load provider');
  }
});

const providerStatusBody = z.object({ status: z.string().min(1).max(32) }).strict();

router.patch('/providers/:id/status', async (req: Request, res: Response) => {
  const p = idParam.safeParse(req.params);
  if (!p.success) return zodError(res, p.error);
  const b = providerStatusBody.safeParse(req.body ?? {});
  if (!b.success) return zodError(res, b.error);
  try {
    return res.json({ success: true, data: await svc.setProviderStatus(p.data.id, b.data.status, ctxOf(req)) });
  } catch (err: any) {
    return sendError(res, err, 'Failed to update provider status');
  }
});

const verificationBody = z
  .object({ action: z.string().min(1).max(16), notes: z.string().max(2000).optional().nullable() })
  .strict();

router.post('/providers/:id/verification', async (req: Request, res: Response) => {
  const p = idParam.safeParse(req.params);
  if (!p.success) return zodError(res, p.error);
  const b = verificationBody.safeParse(req.body ?? {});
  if (!b.success) return zodError(res, b.error);
  try {
    return res.json({
      success: true,
      data: await svc.setProviderVerification(p.data.id, b.data.action as svc.VerificationAction, b.data.notes ?? null, ctxOf(req)),
    });
  } catch (err: any) {
    return sendError(res, err, 'Failed to update verification');
  }
});

router.post('/providers/:id/student-verification', async (req: Request, res: Response) => {
  const p = idParam.safeParse(req.params);
  if (!p.success) return zodError(res, p.error);
  const b = verificationBody.safeParse(req.body ?? {});
  if (!b.success) return zodError(res, b.error);
  try {
    return res.json({
      success: true,
      data: await svc.setStudentVerification(p.data.id, b.data.action as svc.VerificationAction, b.data.notes ?? null, ctxOf(req)),
    });
  } catch (err: any) {
    return sendError(res, err, 'Failed to update student verification');
  }
});

// ── Business oversight (read-only + invitation revocation) ───────────────

router.get('/teams', async (req: Request, res: Response) => {
  const parsed = pageQuery.extend({ status: z.string().max(32).optional() }).safeParse(req.query);
  if (!parsed.success) return zodError(res, parsed.error);
  try {
    const result = await svc.listTeams(parsed.data);
    return res.json({ success: true, data: result.teams, meta: result.meta });
  } catch (err: any) {
    return sendError(res, err, 'Failed to list teams');
  }
});

router.get('/businesses', async (req: Request, res: Response) => {
  const parsed = pageQuery.extend({ status: z.string().max(32).optional() }).safeParse(req.query);
  if (!parsed.success) return zodError(res, parsed.error);
  try {
    const result = await svc.listBusinesses(parsed.data);
    return res.json({ success: true, data: result.businesses, meta: result.meta });
  } catch (err: any) {
    return sendError(res, err, 'Failed to list businesses');
  }
});

router.get('/businesses/:id', async (req: Request, res: Response) => {
  const parsed = idParam.safeParse(req.params);
  if (!parsed.success) return zodError(res, parsed.error);
  try {
    return res.json({ success: true, data: await svc.getBusinessDetail(parsed.data.id) });
  } catch (err: any) {
    return sendError(res, err, 'Failed to load business');
  }
});

router.get('/business-units/:id', async (req: Request, res: Response) => {
  const parsed = idParam.safeParse(req.params);
  if (!parsed.success) return zodError(res, parsed.error);
  try {
    return res.json({ success: true, data: await svc.getBusinessUnitDetail(parsed.data.id) });
  } catch (err: any) {
    return sendError(res, err, 'Failed to load business unit');
  }
});

const invitationQuery = pageQuery.extend({
  scope: z.string().max(16).optional(),
  status: z.string().max(16).optional(),
});

router.get('/invitations', async (req: Request, res: Response) => {
  const parsed = invitationQuery.safeParse(req.query);
  if (!parsed.success) return zodError(res, parsed.error);
  try {
    const result = await svc.listInvitations(parsed.data);
    return res.json({ success: true, data: result.invitations, meta: result.meta });
  } catch (err: any) {
    return sendError(res, err, 'Failed to list invitations');
  }
});

const revokeParam = z.object({ scope: z.enum(['team', 'business']), id: z.string().min(1).max(191) });

router.post('/invitations/:scope/:id/revoke', async (req: Request, res: Response) => {
  const parsed = revokeParam.safeParse(req.params);
  if (!parsed.success) return zodError(res, parsed.error);
  try {
    return res.json({ success: true, data: await svc.revokeInvitation(parsed.data.scope, parsed.data.id, ctxOf(req)) });
  } catch (err: any) {
    return sendError(res, err, 'Failed to revoke invitation');
  }
});

// ── Booking oversight (read-only) ───────────────────────────────────────

const bookingSearchQuery = pageQuery.extend({
  status: z.string().max(32).optional(),
  providerId: z.string().max(64).optional(),
  businessUnitId: z.string().max(64).optional(),
  paymentStatus: z.string().max(32).optional(),
  from: z.string().max(64).optional(),
  to: z.string().max(64).optional(),
});

router.get('/bookings', async (req: Request, res: Response) => {
  const parsed = bookingSearchQuery.safeParse(req.query);
  if (!parsed.success) return zodError(res, parsed.error);
  try {
    const result = await svc.searchBookings(parsed.data);
    return res.json({ success: true, data: result.bookings, meta: result.meta });
  } catch (err: any) {
    return sendError(res, err, 'Failed to search bookings');
  }
});

router.get('/bookings/:id', async (req: Request, res: Response) => {
  const parsed = idParam.safeParse(req.params);
  if (!parsed.success) return zodError(res, parsed.error);
  try {
    return res.json({ success: true, data: await svc.getBookingDetail(parsed.data.id) });
  } catch (err: any) {
    return sendError(res, err, 'Failed to load booking');
  }
});

// ── Payments / finance oversight (read-only) ─────────────────────────────

const paymentSearchQuery = pageQuery.extend({
  status: z.string().max(32).optional(),
  method: z.string().max(32).optional(),
  providerId: z.string().max(64).optional(),
});

router.get('/payments', async (req: Request, res: Response) => {
  const parsed = paymentSearchQuery.safeParse(req.query);
  if (!parsed.success) return zodError(res, parsed.error);
  try {
    const result = await svc.listPayments(parsed.data);
    return res.json({ success: true, data: result.payments, meta: result.meta });
  } catch (err: any) {
    return sendError(res, err, 'Failed to list payments');
  }
});

router.get('/payments/:id', async (req: Request, res: Response) => {
  const parsed = idParam.safeParse(req.params);
  if (!parsed.success) return zodError(res, parsed.error);
  try {
    return res.json({ success: true, data: await svc.getPaymentDetail(parsed.data.id) });
  } catch (err: any) {
    return sendError(res, err, 'Failed to load payment');
  }
});

router.get('/finance/overview', async (_req: Request, res: Response) => {
  try {
    return res.json({ success: true, data: await svc.getFinanceOverview() });
  } catch (err: any) {
    return sendError(res, err, 'Failed to load finance overview');
  }
});

// ── Settings ────────────────────────────────────────────────────────────

router.get('/settings', async (_req: Request, res: Response) => {
  try {
    return res.json({ success: true, data: await svc.getSettings() });
  } catch (err: any) {
    return sendError(res, err, 'Failed to load settings');
  }
});

const settingKeyParam = z.object({ key: z.string().min(1).max(191) });
const settingBody = z
  .object({ value: z.union([z.string(), z.number(), z.array(z.number())]), expectedUpdatedAt: z.string().max(64).optional().nullable() })
  .strict();

router.patch('/settings/:key', async (req: Request, res: Response) => {
  const p = settingKeyParam.safeParse(req.params);
  if (!p.success) return zodError(res, p.error);
  const b = settingBody.safeParse(req.body ?? {});
  if (!b.success) return zodError(res, b.error);
  try {
    return res.json({
      success: true,
      data: await svc.updateSetting(p.data.key, b.data.value, ctxOf(req), b.data.expectedUpdatedAt ?? null),
    });
  } catch (err: any) {
    return sendError(res, err, 'Failed to update setting');
  }
});

// ── Audit viewer (read-only) ─────────────────────────────────────────────

const auditQuery = pageQuery.extend({
  actorUserId: z.string().max(64).optional(),
  action: z.string().max(128).optional(),
  entityType: z.string().max(64).optional(),
  entityId: z.string().max(64).optional(),
  from: z.string().max(64).optional(),
  to: z.string().max(64).optional(),
});

router.get('/audit-logs', async (req: Request, res: Response) => {
  const parsed = auditQuery.safeParse(req.query);
  if (!parsed.success) return zodError(res, parsed.error);
  try {
    const result = await svc.listAuditLogs(parsed.data);
    return res.json({ success: true, data: result.logs, meta: result.meta });
  } catch (err: any) {
    return sendError(res, err, 'Failed to list audit logs');
  }
});

// ── Notification oversight (read-only) ───────────────────────────────────

const notificationQuery = pageQuery.extend({
  status: z.string().max(16).optional(),
  type: z.string().max(64).optional(),
});

router.get('/notifications', async (req: Request, res: Response) => {
  const parsed = notificationQuery.safeParse(req.query);
  if (!parsed.success) return zodError(res, parsed.error);
  try {
    const result = await svc.listNotifications(parsed.data);
    return res.json({ success: true, data: result.notifications, meta: { ...result.meta, byType: result.byType } });
  } catch (err: any) {
    return sendError(res, err, 'Failed to list notifications');
  }
});

router.get('/notifications/:id', async (req: Request, res: Response) => {
  const parsed = idParam.safeParse(req.params);
  if (!parsed.success) return zodError(res, parsed.error);
  try {
    return res.json({ success: true, data: await svc.getNotificationDetail(parsed.data.id) });
  } catch (err: any) {
    return sendError(res, err, 'Failed to load notification');
  }
});

// ── Media oversight (moderation only) ────────────────────────────────────

const mediaQuery = pageQuery.extend({
  moderationStatus: z.string().max(32).optional(),
  status: z.string().max(32).optional(),
  purpose: z.string().max(32).optional(),
});

router.get('/media', async (req: Request, res: Response) => {
  const parsed = mediaQuery.safeParse(req.query);
  if (!parsed.success) return zodError(res, parsed.error);
  try {
    const result = await svc.listMedia(parsed.data);
    return res.json({ success: true, data: result.media, meta: result.meta });
  } catch (err: any) {
    return sendError(res, err, 'Failed to list media');
  }
});

const moderationBody = z.object({ action: z.string().min(1).max(16) }).strict();

router.patch('/media/:id/moderation', async (req: Request, res: Response) => {
  const p = idParam.safeParse(req.params);
  if (!p.success) return zodError(res, p.error);
  const b = moderationBody.safeParse(req.body ?? {});
  if (!b.success) return zodError(res, b.error);
  try {
    return res.json({ success: true, data: await svc.moderateMedia(p.data.id, b.data.action, ctxOf(req)) });
  } catch (err: any) {
    return sendError(res, err, 'Failed to moderate media');
  }
});

export default router;

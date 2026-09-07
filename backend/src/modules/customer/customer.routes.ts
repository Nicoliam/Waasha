import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../config/prisma';
import { authMiddleware } from '../../middleware/auth';

const router = Router();

router.use(authMiddleware);

// GET /api/v1/customers/me — tenant isolation: only own profile
router.get('/me', async (req: Request, res: Response) => {
  const authUser = req.authUser!;
  const profile = await prisma.customerProfile.findUnique({
    where: { userId: authUser.userId },
    include: { user: { select: { id: true, uuid: true, email: true, status: true } } },
  });
  if (!profile) {
    return res.status(404).json({ success: false, error: { code: 'CUSTOMER_NOT_FOUND', message: 'Customer profile not found' } });
  }
  return res.json({ success: true, data: profile });
});

// PATCH /api/v1/customers/me — update own customer profile (mass-assignment safe)
const patchSchema = z.object({
  firstName: z.string().trim().min(1).max(80).optional(),
  lastName: z.string().trim().min(1).max(80).optional(),
  displayName: z.string().trim().min(1).max(120).optional(),
});

router.patch('/me', async (req: Request, res: Response) => {
  const parsed = patchSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Validation failed', details: parsed.error.flatten() } });
  }
  const authUser = req.authUser!;
  const existing = await prisma.customerProfile.findUnique({ where: { userId: authUser.userId } });
  if (!existing) return res.status(404).json({ success: false, error: { code: 'CUSTOMER_NOT_FOUND', message: 'Customer profile not found' } });

  const updated = await prisma.customerProfile.update({
    where: { userId: authUser.userId },
    data: parsed.data,
  });

  try {
    await prisma.auditLog.create({
      data: {
        actorUserId: authUser.userId,
        action: 'CUSTOMER_PROFILE_UPDATED',
        entityType: 'customer_profile',
        entityId: existing.id,
        beforeJson: existing as any,
        afterJson: updated as any,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });
  } catch {}

  return res.json({ success: true, data: updated });
});

// ── Customer booking management — Phase 2 Slice 6 (read-only) ─────────────
// Customer identity always comes from the authenticated session. No
// customerId/userId is accepted from the client. Customer state transitions
// (cancel/reschedule) live in the Slice 12 action endpoints below; the
// client must never force booking status directly.
router.get('/me/bookings', async (req: Request, res: Response) => {
  const authUser = req.authUser!;
  const schema = z.object({
    status: z.string().optional(),
    page: z.coerce.number().int().min(1).default(1),
    perPage: z.coerce.number().int().min(1).max(50).default(20),
  });
  const parsed = schema.safeParse(req.query as unknown);
  if (!parsed.success) {
    return res.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid query', details: parsed.error.flatten() } });
  }
  try {
    const { listCustomerBookings } = await import('../bookings/customer-bookings.service');
    const result = await listCustomerBookings(authUser.userId, {
      status: parsed.data.status,
      page: parsed.data.page,
      perPage: parsed.data.perPage,
    });
    return res.json({ success: true, data: result.bookings, meta: result.meta });
  } catch (err: unknown) {
    const e = err as { status?: number; code?: string; message?: string; details?: unknown };
    if (e.status) return res.status(e.status).json({ success: false, error: { code: e.code ?? 'ERROR', message: e.message, details: e.details } });
    return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to load bookings' } });
  }
});

router.get('/me/bookings/:id', async (req: Request, res: Response) => {
  const authUser = req.authUser!;
  const id = req.params.id as string;
  if (!id) return res.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Booking id required' } });
  try {
    const { getCustomerBookingDetail } = await import('../bookings/customer-bookings.service');
    const booking = await getCustomerBookingDetail(authUser.userId, id);
    return res.json({ success: true, data: booking });
  } catch (err: unknown) {
    const e = err as { status?: number; code?: string; message?: string; details?: unknown };
    if (e.status) return res.status(e.status).json({ success: false, error: { code: e.code ?? 'ERROR', message: e.message, details: e.details } });
    return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to load booking' } });
  }
});

// ── Customer booking actions — Phase 2 Slice 12 ────────────────────────────
// Customer identity always comes from the authenticated session. No
// customerId/userId/tenantId/providerId/serviceId/price/status/payment
// field is accepted from the client. Strict schemas reject mass assignment.
const cancelActionSchema = z
  .object({
    reason: z.string().trim().max(500).optional(),
  })
  .strict();

const rescheduleActionSchema = z
  .object({
    scheduledStart: z.string().min(1),
  })
  .strict();

function actionError(res: Response, err: unknown, fallback: string) {
  const e = err as { status?: number; code?: string; message?: string; details?: unknown };
  if (e && typeof e.status === 'number') {
    return res.status(e.status).json({ success: false, error: { code: e.code ?? 'ERROR', message: e.message, details: e.details } });
  }
  return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: fallback } });
}

router.post('/me/bookings/:id/cancel', async (req: Request, res: Response) => {
  const authUser = req.authUser!;
  const id = req.params.id as string;
  if (!id) return res.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Booking id required' } });
  const parsed = cancelActionSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid body', details: parsed.error.flatten() } });
  }
  try {
    const { cancelCustomerBooking } = await import('../bookings/customer-booking-actions.service');
    const result = await cancelCustomerBooking(authUser.userId, id, { reason: parsed.data.reason }, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return res.json({ success: true, data: result });
  } catch (err: unknown) {
    return actionError(res, err, 'Failed to cancel booking');
  }
});

async function handleReschedule(req: Request, res: Response) {
  const authUser = req.authUser!;
  const id = req.params.id as string;
  if (!id) return res.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Booking id required' } });
  const parsed = rescheduleActionSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid body', details: parsed.error.flatten() } });
  }
  try {
    const { rescheduleCustomerBooking } = await import('../bookings/customer-booking-actions.service');
    const result = await rescheduleCustomerBooking(authUser.userId, id, { scheduledStart: parsed.data.scheduledStart }, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return res.json({ success: true, data: result });
  } catch (err: unknown) {
    return actionError(res, err, 'Failed to reschedule booking');
  }
}

router.post('/me/bookings/:id/reschedule', handleReschedule);
router.patch('/me/bookings/:id/reschedule', handleReschedule);

// ── Customer reviews — Phase 2 Slice 13 ────────────────────────────────────
// Only customer-submittable fields (rating, comment) are accepted. Ownership
// fields (providerId, customerId, bookingId authority, serviceId, price,
// status, payment, commission) are never accepted — the server derives
// customer/provider/service from the authorized COMPLETED booking.
const reviewSchema = z
  .object({
    rating: z.number().int().min(1).max(5),
    comment: z.string().max(1000).optional(),
  })
  .strict();

router.post('/me/bookings/:id/review', async (req: Request, res: Response) => {
  const authUser = req.authUser!;
  const id = req.params.id as string;
  if (!id) return res.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Booking id required' } });
  const parsed = reviewSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid body', details: parsed.error.flatten() } });
  }
  try {
    const { createBookingReview } = await import('../bookings/booking-reviews.service');
    const result = await createBookingReview(authUser.userId, id, { rating: parsed.data.rating, comment: parsed.data.comment }, {
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return res.status(201).json({ success: true, data: result });
  } catch (err: unknown) {
    return actionError(res, err, 'Failed to submit review');
  }
});

router.get('/me/bookings/:id/review', async (req: Request, res: Response) => {
  const authUser = req.authUser!;
  const id = req.params.id as string;
  if (!id) return res.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Booking id required' } });
  try {
    const { getBookingReviewEligibility } = await import('../bookings/booking-reviews.service');
    const result = await getBookingReviewEligibility(authUser.userId, id);
    return res.json({ success: true, data: result });
  } catch (err: unknown) {
    return actionError(res, err, 'Failed to load review eligibility');
  }
});

export default router;

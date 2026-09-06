import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth';
import { createPaymentIntent, getPaymentByBookingForUser, getPaymentByIdForUser, processPaystackWebhook } from './payment.service';

const router = Router();

/**
 * All payment intents require auth. Webhook is public but signature-verified.
 * Endpoints follow /api/v1 naming per blueprint.
 */

// POST /api/v1/payments/intents — customer selects payment method for a booking (server-authoritative amount)
const intentSchema = z.object({
  bookingId: z.string().min(1),
  method: z.enum(['waasha_payment', 'cash', 'eft']),
  idempotencyKey: z.string().min(1).max(128).optional().nullable(),
  cashDetails: z
    .object({
      changeRequested: z.boolean().optional(),
      amountTendered: z.number().nonnegative().max(1000000).optional().nullable(),
    })
    .optional()
    .nullable(),
  // Explicitly forbid client-supplied amount/currency — must be ignored. We validate no such fields.
});

router.post('/intents', authMiddleware, async (req: Request, res: Response) => {
  const authUser = req.authUser!;
  // Reject if client tries to supply amount/currency/price — never trust
  const raw: any = req.body;
  if (raw.amount != null || raw.currency != null || raw.price != null || raw.commission != null) {
    return res.status(422).json({
      success: false,
      error: { code: 'CLIENT_CONTROLLED_AMOUNT_REJECTED', message: 'Amount/currency must not be supplied by client; server uses booking snapshot' },
    });
  }
  const parsed = intentSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid body', details: parsed.error.flatten() } });
  }
  try {
    const result = await createPaymentIntent({
      bookingId: parsed.data.bookingId,
      customerUserId: authUser.userId,
      method: parsed.data.method,
      idempotencyKey: parsed.data.idempotencyKey ?? null,
      cashDetails: parsed.data.cashDetails ?? null,
    });
    const statusCode = (result as any).idempotent ? 200 : 201;
    // Never expose gateway secrets, raw provider payloads with secrets, or internal errors
    const p: any = (result as any).payment;
    const safe = {
      id: p.id,
      uuid: p.uuid,
      bookingId: p.bookingId,
      method: p.method,
      gateway: p.gateway,
      status: p.status,
      amount: Number(p.amount),
      currency: p.currency,
      providerReference: p.providerReference ?? null,
      gatewayTransactionId: p.gatewayTransactionId ?? null,
      initiatedAt: p.initiatedAt,
      paidAt: p.paidAt,
      createdAt: p.createdAt,
    };
    return res.status(statusCode).json({ success: true, data: safe, meta: { idempotent: !!(result as any).idempotent } });
  } catch (err: any) {
    if (err.status) {
      return res.status(err.status).json({ success: false, error: { code: err.code ?? 'ERROR', message: err.message, details: err.details } });
    }
    return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to create payment' } });
  }
});

// GET /api/v1/payments/by-booking/:bookingId — fetch payment for a booking (customer or provider)
router.get('/by-booking/:bookingId', authMiddleware, async (req: Request, res: Response) => {
  const authUser = req.authUser!;
  const bookingId = req.params.bookingId as string;
  if (!bookingId) return res.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'bookingId required' } });
  try {
    const payment = await getPaymentByBookingForUser(bookingId, authUser.userId);
    return res.json({ success: true, data: payment });
  } catch (err: any) {
    if (err.status) return res.status(err.status).json({ success: false, error: { code: err.code ?? 'ERROR', message: err.message } });
    return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to load payment' } });
  }
});

// GET /api/v1/payments/:paymentId — fetch payment by id (owner check via booking)
router.get('/:paymentId', authMiddleware, async (req: Request, res: Response) => {
  const authUser = req.authUser!;
  const paymentId = req.params.paymentId as string;
  if (!paymentId || paymentId === 'by-booking') return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Not found' } });
  try {
    const payment = await getPaymentByIdForUser(paymentId, authUser.userId);
    return res.json({ success: true, data: payment });
  } catch (err: any) {
    if (err.status) return res.status(err.status).json({ success: false, error: { code: err.code ?? 'ERROR', message: err.message } });
    return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to load payment' } });
  }
});

// POST /api/v1/payments/webhooks/paystack — async callback, signature-verified, idempotent
// Raw body is captured at app level via express.raw({ type: 'application/json' }) isolated to this endpoint.
// Handler MUST use the exact raw Buffer bytes for HMAC verification and parse JSON only after verification.
router.post('/webhooks/paystack', async (req: Request, res: Response) => {
  const rawBody = req.body as unknown as Buffer;
  const signature = (req.headers['x-paystack-signature'] as string) ?? (req.headers['X-Paystack-Signature'] as string) ?? '';
  if (!signature) {
    return res.status(401).json({ success: false, error: { code: 'MISSING_WEBHOOK_SIGNATURE', message: 'Missing webhook signature' } });
  }
  if (!rawBody || !Buffer.isBuffer(rawBody) || rawBody.length === 0) {
    return res.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Empty webhook payload' } });
  }
  let payload: any;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return res.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid JSON payload' } });
  }
  if (!payload || typeof payload !== 'object' || Object.keys(payload).length === 0) {
    return res.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Empty webhook payload' } });
  }
  try {
    const result = await processPaystackWebhook({ rawBody, signature, payload });
    if ((result as any).duplicate) {
      return res.json({ success: true, data: { duplicate: true } });
    }
    return res.json({ success: true, data: { duplicate: false, status: (result as any).payment?.status ?? null } });
  } catch (err: any) {
    if (err.status === 401 || err.code === 'INVALID_WEBHOOK_SIGNATURE') {
      return res.status(401).json({ success: false, error: { code: 'INVALID_WEBHOOK_SIGNATURE', message: 'Webhook signature verification failed' } });
    }
    if (err.status) return res.status(err.status).json({ success: false, error: { code: err.code ?? 'ERROR', message: err.message } });
    return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Webhook processing failed' } });
  }
});

export default router;

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../config/prisma';
import { authMiddleware } from '../../middleware/auth';
import { requireAdmin } from '../admin/admin-auth';
import { getCommissionRates, getCommissionRateForProvider } from './commission.service';
import { getCashCaps, getCashCapForProvider } from './cash-caps.service';
import { createCashBooking, settleCashLiability, getCashAccount, CashCapExceededError, CashNotAcceptedError } from './cash-ledger.service';

const router = Router();

// GET /api/v1/finance/commission-rates — public, configurable rates (503 if config unavailable, not silent fallback)
router.get('/commission-rates', async (_req: Request, res: Response) => {
  try {
    const rates = await getCommissionRates();
    const caps = await getCashCaps();
    return res.json({ success: true, data: { rates, caps } });
  } catch (err: any) {
    if (err.code === 'CONFIG_UNAVAILABLE' || err.status === 503) {
      return res.status(503).json({ success: false, error: { code: 'CONFIG_UNAVAILABLE', message: 'Commission/cap configuration unavailable' } });
    }
    return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to load commission rates' } });
  }
});

// All following require auth
router.use(authMiddleware);

// POST /api/v1/finance/cash-bookings — customer creates cash booking for provider (cap enforced transactionally)
// Deterministic T3 rule: if businessUnitId → BusinessUnit.acceptCash; else if businessId → Business.acceptCash; else 422 BUSINESS_CONTEXT_REQUIRED for T3.
// IdempotencyKey prevents duplicate accrual on retry.
const cashBookingSchema = z.object({
  providerId: z.string().min(1),
  grossAmount: z.number().positive().max(100000),
  currency: z.string().optional().default('ZAR'),
  serviceId: z.string().optional().nullable(),
  businessId: z.string().optional().nullable(),
  businessUnitId: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  idempotencyKey: z.string().optional().nullable(),
});

router.post('/cash-bookings', async (req: Request, res: Response) => {
  const authUser = req.authUser!;
  const parsed = cashBookingSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid body', details: parsed.error.flatten() } });
  }
  const { providerId, grossAmount, currency, serviceId, businessId, businessUnitId, description, idempotencyKey } = parsed.data;

  // Customer must have customerProfile (or at least be CUSTOMER role)
  const customer = await prisma.customerProfile.findUnique({ where: { userId: authUser.userId } });
  if (!customer) {
    return res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Customer profile required for cash bookings' } });
  }

  try {
    const result = await createCashBooking({
      providerId,
      customerId: customer.id,
      grossAmount,
      currency,
      serviceId,
      businessId,
      businessUnitId,
      description,
      idempotencyKey,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return res.status(201).json({ success: true, data: result });
  } catch (err: any) {
    if (err instanceof CashCapExceededError) {
      return res.status(err.status).json({ success: false, error: { code: err.code, message: err.message, details: err.details } });
    }
    if (err instanceof CashNotAcceptedError) {
      return res.status(err.status).json({ success: false, error: { code: err.code, message: err.message } });
    }
    if (err.status) return res.status(err.status).json({ success: false, error: { code: err.code ?? 'ERROR', message: err.message } });
    return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to create cash booking' } });
  }
});

// GET /api/v1/finance/cash-account — provider's own cash account (outstanding liability)
router.get('/cash-account', async (req: Request, res: Response) => {
  const authUser = req.authUser!;
  const provider = await prisma.providerProfile.findUnique({ where: { userId: authUser.userId }, select: { id: true } });
  if (!provider) return res.status(404).json({ success: false, error: { code: 'PROVIDER_NOT_FOUND', message: 'Provider profile not found' } });
  const account = await getCashAccount(provider.id);
  const cap = await getCashCapForProvider(await prisma.providerProfile.findUnique({ where: { id: provider.id }, include: { tier: true } }) as any);
  const rates = await getCommissionRates();
  const providerFull = await prisma.providerProfile.findUnique({ where: { id: provider.id }, include: { tier: true } });
  const rate = await getCommissionRateForProvider(providerFull as any);
  return res.json({ success: true, data: { ...account, cap, commissionRate: rate, rates } });
});

// GET /api/v1/finance/cash-ledger — provider's ledger (paginated)
router.get('/cash-ledger', async (req: Request, res: Response) => {
  const authUser = req.authUser!;
  const provider = await prisma.providerProfile.findUnique({ where: { userId: authUser.userId }, select: { id: true } });
  if (!provider) return res.status(404).json({ success: false, error: { code: 'PROVIDER_NOT_FOUND', message: 'Provider profile not found' } });
  const page = Math.max(1, Number(req.query.page ?? 1));
  const perPage = Math.min(50, Math.max(1, Number(req.query.perPage ?? 20)));
  const entries = await prisma.cashLedgerEntry.findMany({
    where: { providerId: provider.id },
    orderBy: { createdAt: 'desc' },
    skip: (page - 1) * perPage,
    take: perPage,
  });
  const total = await prisma.cashLedgerEntry.count({ where: { providerId: provider.id } });
  return res.json({ success: true, data: entries, meta: { page, perPage, total } });
});

// POST /api/v1/finance/settlements — provider settles outstanding liability (idempotent via idempotencyKey)
const settleSchema = z.object({ amount: z.number().positive().max(100000), idempotencyKey: z.string().optional().nullable() });

router.post('/settlements', async (req: Request, res: Response) => {
  const authUser = req.authUser!;
  const parsed = settleSchema.safeParse(req.body);
  if (!parsed.success) return res.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid body', details: parsed.error.flatten() } });
  const provider = await prisma.providerProfile.findUnique({ where: { userId: authUser.userId }, select: { id: true } });
  if (!provider) return res.status(404).json({ success: false, error: { code: 'PROVIDER_NOT_FOUND', message: 'Provider profile not found' } });
  try {
    const result = await settleCashLiability({
      providerId: provider.id,
      amount: parsed.data.amount,
      idempotencyKey: parsed.data.idempotencyKey ?? null,
      actorUserId: authUser.userId,
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });
    return res.json({ success: true, data: result });
  } catch (err: any) {
    if (err.status) return res.status(err.status).json({ success: false, error: { code: err.code ?? 'ERROR', message: err.message } });
    return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to settle' } });
  }
});

// PUT /api/v1/finance/cash-acceptance — provider toggles acceptCash
const cashAcceptanceSchema = z.object({ acceptCash: z.boolean() });

router.put('/cash-acceptance', async (req: Request, res: Response) => {
  const authUser = req.authUser!;
  const parsed = cashAcceptanceSchema.safeParse(req.body);
  if (!parsed.success) return res.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid body', details: parsed.error.flatten() } });
  const provider = await prisma.providerProfile.findUnique({ where: { userId: authUser.userId }, select: { id: true } });
  if (!provider) return res.status(404).json({ success: false, error: { code: 'PROVIDER_NOT_FOUND', message: 'Provider profile not found' } });
  const updated = await prisma.providerProfile.update({ where: { id: provider.id }, data: { acceptCash: parsed.data.acceptCash } });
  try {
    await prisma.auditLog.create({
      data: {
        actorUserId: authUser.userId,
        action: 'PROVIDER_CASH_ACCEPTANCE_UPDATED',
        entityType: 'provider_profile',
        entityId: provider.id,
        afterJson: { acceptCash: updated.acceptCash } as any,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });
  } catch {}
  return res.json({ success: true, data: { acceptCash: updated.acceptCash } });
});

// PUT /api/v1/providers/me/student-request — provider requests student verification (requires auth)
router.put('/student-request', async (req: Request, res: Response) => {
  const authUser = req.authUser!;
  const provider = await prisma.providerProfile.findUnique({ where: { userId: authUser.userId } });
  if (!provider) return res.status(404).json({ success: false, error: { code: 'PROVIDER_NOT_FOUND', message: 'Provider profile not found' } });
  if (provider.isStudent && provider.studentVerificationStatus === 'VERIFIED') {
    return res.status(422).json({ success: false, error: { code: 'ALREADY_VERIFIED', message: 'Already verified as student' } });
  }
  const updated = await prisma.providerProfile.update({
    where: { id: provider.id },
    data: { studentVerificationStatus: 'PENDING' },
  });
  try {
    await prisma.auditLog.create({
      data: {
        actorUserId: authUser.userId,
        action: 'STUDENT_VERIFICATION_REQUESTED',
        entityType: 'provider_profile',
        entityId: provider.id,
        afterJson: { studentVerificationStatus: 'PENDING' } as any,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });
  } catch {}
  return res.json({ success: true, data: { studentVerificationStatus: updated.studentVerificationStatus } });
});

// Admin — verify student (Slice 19: legacy compatibility path).
// Authorization is DB-backed via requireAdmin (session user → user_roles →
// roles). JWT role claims are NEVER sufficient. The write itself delegates
// to the canonical admin.service.setStudentVerification — there is exactly
// one authoritative verification implementation, one audit path, and one
// (centralized, exactly-once) notification hook. APPROVE/REJECT preserved
// for compatibility; REVOKE accepted for parity with the canonical route.
router.post('/admin/verify-student/:providerId', requireAdmin, async (req: Request, res: Response) => {
  const providerId = req.params.providerId;
  const { action } = req.body as { action?: 'APPROVE' | 'REJECT' | 'REVOKE' };
  if (!['APPROVE', 'REJECT', 'REVOKE'].includes(action ?? '')) {
    return res.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'action must be APPROVE, REJECT or REVOKE' } });
  }
  try {
    const { setStudentVerification } = await import('../admin/admin.service');
    const result = await setStudentVerification(providerId, action as 'APPROVE' | 'REJECT' | 'REVOKE', null, {
      actorUserId: req.authUser!.userId,
      ip: req.ip,
      userAgent: req.headers['user-agent'] as string | undefined,
    });
    return res.json({ success: true, data: { isStudent: result.isStudent, studentVerificationStatus: result.studentVerificationStatus } });
  } catch (err: any) {
    if (err && typeof err.status === 'number') {
      return res.status(err.status).json({ success: false, error: { code: err.code ?? 'ERROR', message: err.message } });
    }
    return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to verify student' } });
  }
});

export default router;

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth';

/**
 * Slice 14 — POS & inventory REST API (all under /api/v1/pos).
 *
 * Every endpoint derives provider identity from the authenticated session.
 * providerId/businessUnitId from the client only select an already-owned
 * scope — they are never trusted as authority (see pos-scope.ts).
 * Pagination is bounded (perPage ≤ 50); errors are sanitized.
 */

const router = Router();
router.use(authMiddleware);

function serviceError(res: Response, err: any, fallback: string) {
  if (err && typeof err.status === 'number') {
    return res.status(err.status).json({
      success: false,
      error: { code: err.code ?? 'ERROR', message: err.message, ...(err.details !== undefined ? { details: err.details } : {}) },
    });
  }
  return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: fallback } });
}

function reqCtx(req: Request) {
  return { ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined };
}

const listQuerySchema = z.object({
  page: z.coerce.number().optional(),
  perPage: z.coerce.number().optional(),
});

const inventoryListSchema = listQuerySchema.extend({
  isActive: z.enum(['true', 'false']).optional(),
  lowStock: z.enum(['true', 'false']).optional(),
  search: z.string().max(64).optional(),
  businessUnitId: z.string().optional(),
});

const createItemSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(2000).nullable().optional(),
  unit: z.string().max(24).optional(),
  costPrice: z.number().optional(),
  sellingPrice: z.number(),
  quantityOnHand: z.number().optional(),
  lowStockThreshold: z.number().optional(),
  sku: z.string().max(64).nullable().optional(),
  imageUrl: z.string().max(500).nullable().optional(),
  businessUnitId: z.string().nullable().optional(),
}).strict();

const updateItemSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(2000).nullable().optional(),
  unit: z.string().max(24).optional(),
  costPrice: z.number().optional(),
  sellingPrice: z.number().optional(),
  lowStockThreshold: z.number().optional(),
  sku: z.string().max(64).nullable().optional(),
  imageUrl: z.string().max(500).nullable().optional(),
  businessUnitId: z.string().nullable().optional(),
}).strict();

const receiveSchema = z.object({
  quantity: z.number(),
  reason: z.string().max(2000).nullable().optional(),
}).strict();

const adjustSchema = z.object({
  delta: z.number(),
  reason: z.string().max(2000).nullable().optional(),
}).strict();

const movementsQuerySchema = listQuerySchema.extend({
  movementType: z.string().max(32).optional(),
});

const saleLineSchema = z.object({
  lineType: z.enum(['SERVICE', 'PRODUCT']),
  serviceId: z.string().optional(),
  inventoryItemId: z.string().optional(),
  quantity: z.number(),
  // Explicitly rejected below: client prices/totals are never trusted.
  unitPrice: z.number().optional(),
  lineTotal: z.number().optional(),
});

const createSaleSchema = z.object({
  paymentMethod: z.enum(['cash', 'eft', 'waasha_payment']),
  paymentStatus: z.enum(['PAID', 'PENDING']).optional(),
  businessUnitId: z.string().nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
  idempotencyKey: z.string().min(8).max(128).nullable().optional(),
  lines: z.array(saleLineSchema).min(1).max(50),
  // Rejected: subtotal/totalAmount/commission fields are server-computed.
  subtotal: z.number().optional(),
  totalAmount: z.number().optional(),
  commissionRate: z.number().optional(),
  commissionAmount: z.number().optional(),
}).strict();

const salesListSchema = listQuerySchema.extend({
  paymentMethod: z.string().optional(),
  paymentStatus: z.string().optional(),
  status: z.string().optional(),
  businessUnitId: z.string().optional(),
});

const reverseSchema = z.object({
  reason: z.string().max(2000).nullable().optional(),
}).strict();

// ── Inventory ─────────────────────────────────────────────────────

router.get('/inventory', async (req: Request, res: Response) => {
  const parsed = inventoryListSchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid query', details: parsed.error.flatten() } });
  }
  try {
    const svc = await import('./inventory.service');
    const result = await svc.listItems(req.authUser!.userId, parsed.data);
    return res.json({ success: true, data: result.items, meta: result.meta });
  } catch (err: any) {
    return serviceError(res, err, 'Failed to load inventory');
  }
});

router.post('/inventory', async (req: Request, res: Response) => {
  const parsed = createItemSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid body', details: parsed.error.flatten() } });
  }
  try {
    const svc = await import('./inventory.service');
    const data = await svc.createItem(req.authUser!.userId, parsed.data as Record<string, unknown>, reqCtx(req));
    return res.status(201).json({ success: true, data });
  } catch (err: any) {
    return serviceError(res, err, 'Failed to create inventory item');
  }
});

router.get('/inventory/:id', async (req: Request, res: Response) => {
  try {
    const svc = await import('./inventory.service');
    const data = await svc.getItem(req.authUser!.userId, req.params.id as string);
    return res.json({ success: true, data });
  } catch (err: any) {
    return serviceError(res, err, 'Failed to load inventory item');
  }
});

router.patch('/inventory/:id', async (req: Request, res: Response) => {
  const parsed = updateItemSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid body', details: parsed.error.flatten() } });
  }
  try {
    const svc = await import('./inventory.service');
    const data = await svc.updateItem(req.authUser!.userId, req.params.id as string, parsed.data as Record<string, unknown>, reqCtx(req));
    return res.json({ success: true, data });
  } catch (err: any) {
    return serviceError(res, err, 'Failed to update inventory item');
  }
});

router.post('/inventory/:id/activate', async (req: Request, res: Response) => {
  try {
    const svc = await import('./inventory.service');
    const data = await svc.setItemActive(req.authUser!.userId, req.params.id as string, true, reqCtx(req));
    return res.json({ success: true, data });
  } catch (err: any) {
    return serviceError(res, err, 'Failed to activate inventory item');
  }
});

router.post('/inventory/:id/deactivate', async (req: Request, res: Response) => {
  try {
    const svc = await import('./inventory.service');
    const data = await svc.setItemActive(req.authUser!.userId, req.params.id as string, false, reqCtx(req));
    return res.json({ success: true, data });
  } catch (err: any) {
    return serviceError(res, err, 'Failed to deactivate inventory item');
  }
});

router.post('/inventory/:id/receive', async (req: Request, res: Response) => {
  const parsed = receiveSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid body', details: parsed.error.flatten() } });
  }
  try {
    const svc = await import('./inventory.service');
    const qty = parsed.data.quantity;
    if (!Number.isInteger(qty) || qty < 1 || qty > 1000000) {
      return res.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'quantity must be an integer between 1 and 1000000' } });
    }
    const result = await svc.mutateStock(req.authUser!.userId, req.params.id as string, qty, 'RECEIVED', {
      reason: parsed.data.reason ?? null,
      ctx: reqCtx(req),
    });
    return res.json({ success: true, data: result });
  } catch (err: any) {
    return serviceError(res, err, 'Failed to receive stock');
  }
});

router.post('/inventory/:id/adjust', async (req: Request, res: Response) => {
  const parsed = adjustSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid body', details: parsed.error.flatten() } });
  }
  try {
    const svc = await import('./inventory.service');
    const delta = parsed.data.delta;
    // Integer/zero validation lives in the service — never floor here, a
    // fractional delta must be rejected, not silently truncated.
    const kind = delta > 0 ? 'ADJUST_INCREASE' : 'ADJUST_DECREASE';
    const result = await svc.mutateStock(req.authUser!.userId, req.params.id as string, delta, kind, {
      reason: parsed.data.reason ?? null,
      ctx: reqCtx(req),
    });
    return res.json({ success: true, data: result });
  } catch (err: any) {
    return serviceError(res, err, 'Failed to adjust stock');
  }
});

router.get('/inventory/:id/movements', async (req: Request, res: Response) => {
  const parsed = movementsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid query', details: parsed.error.flatten() } });
  }
  try {
    const svc = await import('./inventory.service');
    const result = await svc.listMovements(req.authUser!.userId, req.params.id as string, parsed.data);
    return res.json({ success: true, data: result.movements, meta: result.meta });
  } catch (err: any) {
    return serviceError(res, err, 'Failed to load movements');
  }
});

// ── POS sales ─────────────────────────────────────────────────────

router.post('/sales', async (req: Request, res: Response) => {
  const parsed = createSaleSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid body', details: parsed.error.flatten() } });
  }
  const body = parsed.data as Record<string, unknown>;
  // Client prices/totals/commission are never trusted — strip before the service.
  delete body.subtotal;
  delete body.totalAmount;
  delete body.commissionRate;
  delete body.commissionAmount;
  for (const l of body.lines as any[]) {
    delete l.unitPrice;
    delete l.lineTotal;
  }
  // Header idempotency wins when both are present; body key is the fallback.
  const headerKey = (req.headers['idempotency-key'] ?? req.headers['x-idempotency-key']) as string | undefined;
  if (headerKey && !body.idempotencyKey) body.idempotencyKey = headerKey.slice(0, 128);
  try {
    const svc = await import('./pos.service');
    const data = await svc.createSale(req.authUser!.userId, body, reqCtx(req));
    return res.status((data as any).idempotent ? 200 : 201).json({ success: true, data });
  } catch (err: any) {
    return serviceError(res, err, 'Failed to create POS sale');
  }
});

router.get('/sales', async (req: Request, res: Response) => {
  const parsed = salesListSchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid query', details: parsed.error.flatten() } });
  }
  try {
    const svc = await import('./pos.service');
    const result = await svc.listSales(req.authUser!.userId, parsed.data);
    return res.json({ success: true, data: result.sales, meta: result.meta });
  } catch (err: any) {
    return serviceError(res, err, 'Failed to load POS sales');
  }
});

router.get('/sales/:id', async (req: Request, res: Response) => {
  try {
    const svc = await import('./pos.service');
    const data = await svc.getSale(req.authUser!.userId, req.params.id as string);
    return res.json({ success: true, data });
  } catch (err: any) {
    return serviceError(res, err, 'Failed to load POS sale');
  }
});

router.post('/sales/:id/reverse', async (req: Request, res: Response) => {
  const parsed = reverseSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid body', details: parsed.error.flatten() } });
  }
  try {
    const svc = await import('./pos.service');
    const data = await svc.reverseSale(req.authUser!.userId, req.params.id as string, parsed.data as Record<string, unknown>, reqCtx(req));
    return res.json({ success: true, data });
  } catch (err: any) {
    return serviceError(res, err, 'Failed to reverse POS sale');
  }
});

export default router;

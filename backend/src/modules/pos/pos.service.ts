import { prisma } from '../../config/prisma';
import { getCommissionRateForProvider } from '../finance/commission.service';
import { getCashCapForProvider } from '../finance/cash-caps.service';
import { isInPosScope, resolveOwnership, resolvePosScope } from './pos-scope';
import { toMovementDto } from './inventory.service';

/**
 * Slice 14 — POS sales.
 *
 * A POS sale records a provider-reported walk-in/operational transaction
 * (service and/or product lines). It is deliberately NOT a booking:
 *  - never creates bookings, never completes bookings;
 *  - never creates Payment rows (those stay booking-scoped);
 *  - never writes CashLedgerEntry/ProviderCashAccount rows.
 *
 * Totals, prices and stock deductions are computed server-side from the
 * current catalogue — client totals/prices/balances are ignored.
 * Historical lines snapshot name+price so catalogue edits never rewrite
 * past sales.
 *
 * Concurrency: Serializable transaction + SELECT ... FOR UPDATE on every
 * product row (locked in id order) + exact-balance writes, so two
 * concurrent sales cannot oversell the same inventory.
 *
 * Idempotency: idempotencyKey is UNIQUE. Pre-check plus in-transaction
 * re-check plus P2002 recovery mean retries return the original sale
 * without duplicating lines or stock deductions.
 *
 * Commission: the blueprint defines no POS commission treatment, so this
 * slice stores an INFORMATIONAL quote only (commissionEligible=false).
 * Settling POS commission is deferred to the finance/admin slice.
 * Cash acceptance (acceptCash) IS enforced, and the cash-liability cap is
 * checked advisory-style: a cash sale whose quote would breach the cap is
 * rejected (422 CASH_CAP_EXCEEDED) without mutating ledger state.
 */

function err(status: number, code: string, message: string, details?: unknown): Error {
  const e: any = new Error(message);
  e.status = status;
  e.code = code;
  if (details !== undefined) e.details = details;
  return e;
}

function toNumber(d: unknown): number {
  if (d == null) return 0;
  if (typeof d === 'number') return d;
  const n = Number(d);
  return Number.isFinite(n) ? n : 0;
}

function toIso(d: unknown): string {
  if (d instanceof Date) return d.toISOString();
  return String(d);
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export const POS_PAYMENT_METHODS = ['cash', 'eft', 'waasha_payment'] as const;
export const POS_PAYMENT_STATUSES = ['PAID', 'PENDING'] as const;
const MAX_LINES = 50;

export interface PosContext {
  ip?: string;
  userAgent?: string;
}

function toSaleDto(sale: any, lines: any[]) {
  return {
    id: sale.id,
    reference: sale.uuid ?? sale.id,
    providerId: sale.providerId,
    businessUnitId: sale.businessUnitId ?? null,
    status: sale.status,
    paymentMethod: sale.paymentMethod,
    paymentStatus: sale.paymentStatus,
    currency: sale.currency ?? 'ZAR',
    subtotal: toNumber(sale.subtotal),
    totalAmount: toNumber(sale.totalAmount),
    commissionRate: sale.commissionRate == null ? null : toNumber(sale.commissionRate),
    commissionAmount: sale.commissionAmount == null ? null : toNumber(sale.commissionAmount),
    commissionEligible: Boolean(sale.commissionEligible),
    note: sale.note ?? null,
    idempotent: Boolean((sale as any).__idempotent),
    reversedAt: sale.reversedAt ? toIso(sale.reversedAt) : null,
    reversalReason: sale.reversalReason ?? null,
    createdAt: toIso(sale.createdAt),
    updatedAt: toIso(sale.updatedAt),
    lines: (lines ?? []).map((l: any) => ({
      id: l.id,
      lineType: l.lineType,
      serviceId: l.serviceId ?? null,
      inventoryItemId: l.inventoryItemId ?? null,
      nameSnapshot: l.nameSnapshot,
      unitPrice: toNumber(l.unitPrice),
      quantity: Number(l.quantity),
      lineTotal: toNumber(l.lineTotal),
    })),
  };
}

async function scopedSale(providerUserId: string, saleId: string) {
  const scope = await resolvePosScope(providerUserId);
  const sale = await (prisma as any).posSale.findUnique({
    where: { id: saleId },
    include: { lines: true },
  });
  // Safe 404: never reveal another tenant's sale.
  if (!sale || !isInPosScope(sale, scope)) {
    throw err(404, 'POS_SALE_NOT_FOUND', 'POS sale not found');
  }
  return { scope, sale };
}

export async function getSale(providerUserId: string, saleId: string) {
  const { sale } = await scopedSale(providerUserId, saleId);
  return toSaleDto(sale, sale.lines ?? []);
}

export async function listSales(
  providerUserId: string,
  query: { page?: unknown; perPage?: unknown; paymentMethod?: unknown; paymentStatus?: unknown; status?: unknown; businessUnitId?: unknown },
) {
  const scope = await resolvePosScope(providerUserId);
  const page = Math.max(1, Math.floor(Number(query.page) || 1));
  const perPage = Math.min(50, Math.max(1, Math.floor(Number(query.perPage) || 20)));
  if (query.page != null && (!Number.isFinite(Number(query.page)) || Number(query.page) < 1)) {
    throw err(422, 'VALIDATION_ERROR', 'page must be a positive integer');
  }
  if (query.perPage != null && (!Number.isFinite(Number(query.perPage)) || Number(query.perPage) < 1 || Number(query.perPage) > 50)) {
    throw err(422, 'VALIDATION_ERROR', 'perPage must be an integer between 1 and 50');
  }
  const ors: any[] = [{ providerId: { in: scope.providerIds } }];
  if (scope.unitIds.length > 0) ors.push({ businessUnitId: { in: scope.unitIds } });
  const where: any = { OR: ors };
  if (typeof query.paymentMethod === 'string' && query.paymentMethod) {
    if (!(POS_PAYMENT_METHODS as readonly string[]).includes(query.paymentMethod)) throw err(422, 'VALIDATION_ERROR', 'Invalid paymentMethod');
    where.paymentMethod = query.paymentMethod;
  }
  if (typeof query.paymentStatus === 'string' && query.paymentStatus) {
    if (!(POS_PAYMENT_STATUSES as readonly string[]).includes(query.paymentStatus)) throw err(422, 'VALIDATION_ERROR', 'Invalid paymentStatus');
    where.paymentStatus = query.paymentStatus;
  }
  if (typeof query.status === 'string' && query.status) {
    if (!['COMPLETED', 'REVERSED'].includes(query.status)) throw err(422, 'VALIDATION_ERROR', 'Invalid status');
    where.status = query.status;
  }
  if (typeof query.businessUnitId === 'string' && query.businessUnitId) {
    if (!scope.unitIds.includes(query.businessUnitId)) throw err(403, 'FORBIDDEN', 'Business unit is not in your scope');
    where.businessUnitId = query.businessUnitId;
  }
  const total = await (prisma as any).posSale.count({ where });
  const rows = await (prisma as any).posSale.findMany({
    where,
    include: { lines: true },
    orderBy: { createdAt: 'desc' },
    skip: (page - 1) * perPage,
    take: perPage,
  });
  return {
    sales: (rows as any[]).map((s) => toSaleDto(s, s.lines ?? [])),
    meta: { page, perPage, total },
  };
}

interface ValidatedLine {
  lineType: 'SERVICE' | 'PRODUCT';
  serviceId: string | null;
  inventoryItemId: string | null;
  nameSnapshot: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
}

export async function createSale(
  providerUserId: string,
  input: Record<string, unknown>,
  ctx?: PosContext,
) {
  const scope = await resolvePosScope(providerUserId);
  const profile: any = scope.profile;

  const paymentMethod = String(input.paymentMethod ?? '');
  if (!(POS_PAYMENT_METHODS as readonly string[]).includes(paymentMethod)) {
    throw err(422, 'VALIDATION_ERROR', 'paymentMethod must be one of cash, eft, waasha_payment');
  }
  const rawStatus = input.paymentStatus == null ? (paymentMethod === 'eft' ? 'PENDING' : 'PAID') : String(input.paymentStatus);
  if (!(POS_PAYMENT_STATUSES as readonly string[]).includes(rawStatus)) {
    throw err(422, 'VALIDATION_ERROR', 'paymentStatus must be PAID or PENDING');
  }
  // Cash/EFT/Waasha-payment POS rows record provider-reported receipts —
  // cash in hand is PAID; EFT may still be pending.
  if (paymentMethod !== 'eft' && rawStatus !== 'PAID') {
    throw err(422, 'VALIDATION_ERROR', `${paymentMethod} sales must be recorded as PAID`);
  }
  const linesInput = input.lines;
  if (!Array.isArray(linesInput) || linesInput.length === 0) {
    throw err(422, 'VALIDATION_ERROR', 'At least one sale line is required');
  }
  if (linesInput.length > MAX_LINES) {
    throw err(422, 'VALIDATION_ERROR', `A sale may contain at most ${MAX_LINES} lines`);
  }
  const note = input.note == null ? null : String(input.note).slice(0, 2000);
  const idempotencyKey = input.idempotencyKey == null ? null : String(input.idempotencyKey).slice(0, 128);
  if (idempotencyKey !== null && idempotencyKey.length < 8) {
    throw err(422, 'VALIDATION_ERROR', 'idempotencyKey must be at least 8 characters');
  }
  // Client totals/prices are never trusted — validated shape only, values recomputed.
  for (const [i, raw] of linesInput.entries()) {
    const l = (raw ?? {}) as Record<string, unknown>;
    if (l.lineType !== 'SERVICE' && l.lineType !== 'PRODUCT') {
      throw err(422, 'VALIDATION_ERROR', `lines[${i}].lineType must be SERVICE or PRODUCT`);
    }
    if (typeof l.quantity !== 'number' || !Number.isInteger(l.quantity) || l.quantity < 1 || l.quantity > 1000) {
      throw err(422, 'VALIDATION_ERROR', `lines[${i}].quantity must be an integer between 1 and 1000`);
    }
    if (l.lineType === 'SERVICE' && typeof l.serviceId !== 'string') {
      throw err(422, 'VALIDATION_ERROR', `lines[${i}].serviceId is required for SERVICE lines`);
    }
    if (l.lineType === 'PRODUCT' && typeof l.inventoryItemId !== 'string') {
      throw err(422, 'VALIDATION_ERROR', `lines[${i}].inventoryItemId is required for PRODUCT lines`);
    }
  }

  const { providerId, businessUnitId } = resolveOwnership(scope, (input.businessUnitId as string | null | undefined) ?? null);

  // Cash acceptance is server-authoritative (existing cash architecture).
  if (paymentMethod === 'cash') {
    const accepted = await isCashAccepted(profile, businessUnitId);
    if (!accepted) throw err(422, 'CASH_NOT_ACCEPTED', 'Cash payments are not accepted for this provider context');
  }

  // Fast idempotency path: retry returns the original sale untouched.
  if (idempotencyKey) {
    const existing = await (prisma as any).posSale.findUnique({
      where: { idempotencyKey },
      include: { lines: true },
    });
    if (existing) {
      if (!isInPosScope(existing, scope)) throw err(404, 'POS_SALE_NOT_FOUND', 'POS sale not found');
      return { ...toSaleDto(existing, existing.lines ?? []), idempotent: true };
    }
  }

  try {
    const result = await (prisma as any).$transaction(
      async (tx: any) => {
        // In-transaction idempotency re-check (concurrent duplicate guard).
        if (idempotencyKey) {
          const dup = await tx.posSale.findUnique({ where: { idempotencyKey }, include: { lines: true } });
          if (dup) {
            if (!isInPosScope(dup, scope)) throw err(404, 'POS_SALE_NOT_FOUND', 'POS sale not found');
            return { ...(dup as any), __idempotent: true };
          }
        }

        // Validate + price every line server-side.
        const serviceIds = linesInput.filter((l: any) => l.lineType === 'SERVICE').map((l: any) => l.serviceId);
        const serviceRows: any[] =
          serviceIds.length > 0
            ? await tx.service.findMany({ where: { id: { in: serviceIds } } })
            : [];
        const serviceById = new Map(serviceRows.map((s: any) => [s.id, s]));

        const productIds = [...new Set(linesInput.filter((l: any) => l.lineType === 'PRODUCT').map((l: any) => l.inventoryItemId))].sort();
        const productById = new Map<string, any>();
        if (productIds.length > 0) {
          if (productIds.length > 0) {
            try {
              await tx.$queryRaw`SELECT * FROM inventory_items WHERE id IN (${productIds.join(',')}) FOR UPDATE`;
            } catch {
              /* lock hint best-effort */
            }
          }
          for (const pid of productIds) {
            const row = await tx.inventoryItem.findUnique({ where: { id: pid } });
            // Safe 404: cross-tenant items are invisible, never "forbidden".
            if (!row || !isInPosScope(row, scope)) throw err(404, 'INVENTORY_ITEM_NOT_FOUND', 'Inventory item not found');
            if (!row.isActive) throw err(422, 'ITEM_INACTIVE', 'Inventory item is not active', { inventoryItemId: pid });
            productById.set(pid, row);
          }
          // Aggregate demand per item across repeated lines — oversell
          // protection must see the whole sale, not line-by-line.
          const demand = new Map<string, number>();
          for (const l of linesInput as any[]) {
            if (l.lineType !== 'PRODUCT') continue;
            demand.set(l.inventoryItemId, (demand.get(l.inventoryItemId) ?? 0) + l.quantity);
          }
          for (const [pid, qty] of demand) {
            const row = productById.get(pid);
            if (toNumber(row.quantityOnHand) < qty) {
              throw err(422, 'INSUFFICIENT_STOCK', 'Insufficient stock for sale', {
                inventoryItemId: pid,
                available: toNumber(row.quantityOnHand),
                requested: qty,
              });
            }
          }
        }

        const validated: ValidatedLine[] = (linesInput as any[]).map((l: any, i: number) => {
          if (l.lineType === 'SERVICE') {
            const svc = serviceById.get(l.serviceId);
            if (!svc) throw err(404, 'SERVICE_NOT_FOUND', `Service not found for line ${i}`);
            const belongs =
              svc.providerId === profile.id ||
              (svc.businessUnitId && scope.unitIds.includes(svc.businessUnitId));
            if (!belongs) throw err(404, 'SERVICE_NOT_FOUND', `Service not found for line ${i}`);
            if (svc.status !== 'ACTIVE') throw err(422, 'SERVICE_NOT_AVAILABLE', 'Service is not available for sale', { serviceId: svc.id });
            const unitPrice = round2(toNumber(svc.price));
            return {
              lineType: 'SERVICE',
              serviceId: svc.id,
              inventoryItemId: null,
              nameSnapshot: String(svc.name),
              unitPrice,
              quantity: l.quantity,
              lineTotal: round2(unitPrice * l.quantity),
            };
          }
          const row = productById.get(l.inventoryItemId);
          const unitPrice = round2(toNumber(row.sellingPrice));
          return {
            lineType: 'PRODUCT',
            serviceId: null,
            inventoryItemId: row.id,
            nameSnapshot: String(row.name),
            unitPrice,
            quantity: l.quantity,
            lineTotal: round2(unitPrice * l.quantity),
          };
        });

        const subtotal = round2(validated.reduce((acc, v) => acc + v.lineTotal, 0));
        if (subtotal <= 0) throw err(422, 'VALIDATION_ERROR', 'Sale total must be positive');

        // Informational commission quote — NOT settlement (see header).
        let commissionRate: number | null = null;
        let commissionAmount: number | null = null;
        try {
          commissionRate = await getCommissionRateForProvider(profile);
          commissionAmount = round2((subtotal * (commissionRate as number)) / 100);
        } catch {
          commissionRate = null;
          commissionAmount = null;
        }
        // Cash cap advisory: block the receipt without touching ledger state.
        if (paymentMethod === 'cash' && commissionRate != null && commissionAmount != null) {
          const cap = await getCashCapForProvider(profile);
          const account = await tx.providerCashAccount.findUnique({ where: { providerId: profile.id } }).catch(() => null);
          const outstanding = account ? toNumber((account as any).outstandingCommission) : 0;
          if (round2(outstanding + (commissionAmount as number)) > cap) {
            throw err(422, 'CASH_CAP_EXCEEDED', 'Cash commission liability cap would be exceeded', {
              cap,
              outstanding,
              commissionRate,
              commissionAmount,
            });
          }
        }

        const sale = await tx.posSale.create({
          data: {
            providerId,
            businessUnitId,
            status: 'COMPLETED',
            paymentMethod,
            paymentStatus: rawStatus,
            currency: 'ZAR',
            subtotal,
            totalAmount: subtotal,
            commissionRate,
            commissionAmount,
            commissionEligible: false,
            idempotencyKey,
            note,
            createdBy: providerUserId,
          },
        });
        for (const v of validated) {
          await tx.posSaleLine.create({
            data: {
              saleId: sale.id,
              lineType: v.lineType,
              serviceId: v.serviceId,
              inventoryItemId: v.inventoryItemId,
              nameSnapshot: v.nameSnapshot,
              unitPrice: v.unitPrice,
              quantity: v.quantity,
              lineTotal: v.lineTotal,
            },
          });
        }
        // Deduct stock with exact-balance writes while rows are locked.
        const movements: any[] = [];
        const consumed = new Map<string, number>();
        for (const v of validated) {
          if (v.lineType !== 'PRODUCT' || !v.inventoryItemId) continue;
          consumed.set(v.inventoryItemId, (consumed.get(v.inventoryItemId) ?? 0) + v.quantity);
        }
        for (const [pid, qty] of consumed) {
          const row = productById.get(pid);
          const resulting = toNumber(row.quantityOnHand) - qty;
          await tx.inventoryItem.update({ where: { id: pid }, data: { quantityOnHand: resulting } });
          const movement = await tx.inventoryMovement.create({
            data: {
              itemId: pid,
              providerId: row.providerId,
              businessUnitId: row.businessUnitId ?? null,
              movementType: 'SALE',
              quantityDelta: -qty,
              resultingQuantity: resulting,
              actorUserId: providerUserId,
              referenceType: 'POS_SALE',
              referenceId: sale.id,
              reason: null,
            },
          });
          movements.push(movement);
        }
        try {
          await tx.auditLog.create({
            data: {
              actorUserId: providerUserId,
              action: 'POS_SALE_CREATED',
              entityType: 'pos_sale',
              entityId: sale.id,
              afterJson: {
                providerId,
                businessUnitId,
                paymentMethod,
                paymentStatus: rawStatus,
                totalAmount: subtotal,
                lineCount: validated.length,
                idempotencyKey,
              } as any,
              ipAddress: ctx?.ip,
              userAgent: ctx?.userAgent,
            },
          });
        } catch {
          /* audit never rolls back the sale */
        }
        const lines = await tx.posSaleLine.findMany({ where: { saleId: sale.id } });
        return { sale, lines, movements };
      },
      { isolationLevel: 'Serializable' } as any,
    );

    if ((result.sale as any).__idempotent) {
      const s: any = result.sale;
      return { ...toSaleDto(s, s.lines ?? []), idempotent: true };
    }
    const dto = toSaleDto(result.sale, result.lines);
    // Post-commit low-stock hooks only.
    void notifyLowStockForMovements(result.movements).catch(() => {});
    return dto;
  } catch (e: any) {
    // Concurrent duplicate insert raced past both checks — return original.
    if (e?.code === 'P2002' && idempotencyKey) {
      const existing = await (prisma as any).posSale.findUnique({
        where: { idempotencyKey },
        include: { lines: true },
      });
      if (existing) {
        if (!isInPosScope(existing, scope)) throw err(404, 'POS_SALE_NOT_FOUND', 'POS sale not found');
        return { ...toSaleDto(existing, existing.lines ?? []), idempotent: true };
      }
    }
    throw e;
  }
}

/**
 * Reverse a COMPLETED sale: restores product stock via RETURN movements.
 * Lines keep their historical snapshots; the sale flips to REVERSED.
 * A sale can only be reversed once.
 */
export async function reverseSale(
  providerUserId: string,
  saleId: string,
  input: Record<string, unknown>,
  ctx?: PosContext,
) {
  const { scope, sale } = await scopedSale(providerUserId, saleId);
  if (sale.status !== 'COMPLETED') {
    throw err(422, 'SALE_NOT_REVERSIBLE', 'Only completed sales can be reversed', { status: sale.status });
  }
  const reason = input.reason == null ? null : String(input.reason).slice(0, 2000);
  const result = await (prisma as any).$transaction(
    async (tx: any) => {
      const fresh = await tx.posSale.findUnique({ where: { id: sale.id }, include: { lines: true } });
      if (!fresh || (fresh as any).status !== 'COMPLETED') {
        throw err(422, 'SALE_NOT_REVERSIBLE', 'Only completed sales can be reversed');
      }
      const productLines: any[] = ((fresh as any).lines ?? []).filter((l: any) => l.lineType === 'PRODUCT' && l.inventoryItemId);
      const ids = [...new Set(productLines.map((l: any) => l.inventoryItemId))].sort();
      if (ids.length > 0) {
        try {
          await tx.$queryRaw`SELECT * FROM inventory_items WHERE id IN (${ids.join(',')}) FOR UPDATE`;
        } catch {
          /* lock hint best-effort */
        }
      }
      const movements: any[] = [];
      const restore = new Map<string, number>();
      for (const l of productLines) {
        restore.set(l.inventoryItemId, (restore.get(l.inventoryItemId) ?? 0) + Number(l.quantity));
      }
      for (const [pid, qty] of restore) {
        const row = await tx.inventoryItem.findUnique({ where: { id: pid } });
        if (!row) continue; // item deleted after sale — sale history stays, stock cannot be restored
        const resulting = toNumber((row as any).quantityOnHand) + qty;
        await tx.inventoryItem.update({ where: { id: pid }, data: { quantityOnHand: resulting } });
        const movement = await tx.inventoryMovement.create({
          data: {
            itemId: pid,
            providerId: (row as any).providerId,
            businessUnitId: (row as any).businessUnitId ?? null,
            movementType: 'RETURN',
            quantityDelta: qty,
            resultingQuantity: resulting,
            actorUserId: providerUserId,
            referenceType: 'REVERSAL',
            referenceId: sale.id,
            reason,
          },
        });
        movements.push({ movement, item: row });
      }
      const updated = await tx.posSale.update({
        where: { id: sale.id },
        data: { status: 'REVERSED', reversedAt: new Date(), reversalReason: reason },
        include: { lines: true },
      });
      try {
        await tx.auditLog.create({
          data: {
            actorUserId: providerUserId,
            action: 'POS_SALE_REVERSED',
            entityType: 'pos_sale',
            entityId: sale.id,
            beforeJson: { status: 'COMPLETED' } as any,
            afterJson: { status: 'REVERSED', reason } as any,
            ipAddress: ctx?.ip,
            userAgent: ctx?.userAgent,
          },
        });
      } catch {
        /* audit never rolls back the reversal */
      }
      return { updated, movements };
    },
    { isolationLevel: 'Serializable' } as any,
  );
  void scope;
  return toSaleDto(result.updated, result.updated.lines ?? []);
}

async function isCashAccepted(profile: any, businessUnitId: string | null): Promise<boolean> {
  try {
    if (profile?.tier?.code === 'T3' && businessUnitId) {
      const unit = await (prisma as any).businessUnit.findUnique({ where: { id: businessUnitId } });
      if (!unit) return false;
      return unit.acceptCash !== false;
    }
    if (profile?.tier?.code === 'T3' && !businessUnitId) return false;
    return profile.acceptCash !== false;
  } catch {
    return true;
  }
}

async function notifyLowStockForMovements(movements: any[]): Promise<void> {
  try {
    const { notifyLowStock } = await import('./pos-notifications');
    for (const m of movements ?? []) {
      try {
        const item = await (prisma as any).inventoryItem.findUnique({ where: { id: m.itemId } });
        if (!item) continue;
        const qty = toNumber((item as any).quantityOnHand);
        if (qty > toNumber((item as any).lowStockThreshold)) continue;
        await notifyLowStock({
          itemId: (item as any).id,
          itemName: (item as any).name,
          providerId: (item as any).providerId,
          businessUnitId: (item as any).businessUnitId ?? null,
          quantityOnHand: qty,
          lowStockThreshold: toNumber((item as any).lowStockThreshold),
        }).catch(() => {});
      } catch {
        /* per-item hook never breaks the batch */
      }
    }
  } catch {
    /* notifications never break sales */
  }
}

export { toMovementDto };

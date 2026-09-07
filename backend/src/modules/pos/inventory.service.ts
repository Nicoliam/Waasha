import { prisma } from '../../config/prisma';
import { isInPosScope, resolveOwnership, resolvePosScope } from './pos-scope';

/**
 * Slice 14 — Inventory management.
 *
 * Server-authoritative quantities: quantityOnHand is never accepted from
 * the client (create sets the opening balance once; afterwards only
 * receive/adjust/sale/return movements change it inside transactions).
 * Every mutation writes an inventory_movements row with the resulting
 * balance, the actor, and the reference — history is auditable.
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

export const MOVEMENT_TYPES = ['RECEIVED', 'ADJUST_INCREASE', 'ADJUST_DECREASE', 'SALE', 'RETURN', 'REVERSAL'] as const;

export interface InventoryContext {
  ip?: string;
  userAgent?: string;
}

function isLowStock(item: { quantityOnHand: number; lowStockThreshold: number }): boolean {
  return item.quantityOnHand <= item.lowStockThreshold;
}

function toDto(item: any) {
  const quantityOnHand = toNumber(item.quantityOnHand);
  const lowStockThreshold = toNumber(item.lowStockThreshold);
  return {
    id: item.id,
    reference: item.uuid ?? item.id,
    providerId: item.providerId,
    businessUnitId: item.businessUnitId ?? null,
    sku: item.sku ?? null,
    name: item.name,
    description: item.description ?? null,
    unit: item.unit ?? 'unit',
    costPrice: toNumber(item.costPrice),
    sellingPrice: toNumber(item.sellingPrice),
    currency: item.currency ?? 'ZAR',
    quantityOnHand,
    lowStockThreshold,
    isLowStock: quantityOnHand <= lowStockThreshold,
    isActive: Boolean(item.isActive),
    imageUrl: item.imageUrl ?? null,
    createdAt: toIso(item.createdAt),
    updatedAt: toIso(item.updatedAt),
  };
}

async function audit(tx: any, entry: Record<string, unknown>): Promise<void> {
  try {
    await tx.auditLog.create({ data: entry });
  } catch {
    /* audit infra failure must not roll back operational writes */
  }
}

async function scopedItem(providerUserId: string, itemId: string) {
  const scope = await resolvePosScope(providerUserId);
  const item = await (prisma as any).inventoryItem.findUnique({ where: { id: itemId } });
  // Safe 404: never reveal another tenant's item.
  if (!item || !isInPosScope(item, scope)) {
    throw err(404, 'INVENTORY_ITEM_NOT_FOUND', 'Inventory item not found');
  }
  return { scope, item };
}

const moneySchema = { min: 0, max: 10000000 };

function assertMoney(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw err(422, 'VALIDATION_ERROR', `${field} must be a number`);
  }
  const rounded = Math.round(value * 100) / 100;
  if (rounded < moneySchema.min || rounded > moneySchema.max) {
    throw err(422, 'VALIDATION_ERROR', `${field} must be between ${moneySchema.min} and ${moneySchema.max}`);
  }
  return rounded;
}

function assertNonNegativeInt(value: unknown, field: string, max = 1000000): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > max) {
    throw err(422, 'VALIDATION_ERROR', `${field} must be an integer between 0 and ${max}`);
  }
  return value;
}

export async function createItem(
  providerUserId: string,
  input: Record<string, unknown>,
  ctx?: InventoryContext,
) {
  const scope = await resolvePosScope(providerUserId);
  const name = String(input.name ?? '').trim();
  if (!name || name.length > 120) throw err(422, 'VALIDATION_ERROR', 'name is required (max 120 characters)');
  const description = input.description == null ? null : String(input.description).slice(0, 2000);
  const unit = String(input.unit ?? 'unit').trim().slice(0, 24) || 'unit';
  const costPrice = input.costPrice == null ? 0 : assertMoney(input.costPrice, 'costPrice');
  const sellingPrice = assertMoney(input.sellingPrice, 'sellingPrice');
  const openingQuantity = input.quantityOnHand == null ? 0 : assertNonNegativeInt(input.quantityOnHand, 'quantityOnHand');
  const lowStockThreshold = input.lowStockThreshold == null ? 0 : assertNonNegativeInt(input.lowStockThreshold, 'lowStockThreshold');
  const skuRaw = input.sku == null ? null : String(input.sku).trim().slice(0, 64);
  const sku = skuRaw && skuRaw.length > 0 ? skuRaw : null;
  const imageUrl = input.imageUrl == null ? null : String(input.imageUrl).slice(0, 500);
  // quantityOnHand beyond the opening balance, isActive overrides, ids and
  // financial internals are never accepted here — unknown fields are ignored.
  const { providerId, businessUnitId } = resolveOwnership(scope, (input.businessUnitId as string | null | undefined) ?? null);

  // SKU uniqueness is per provider (nullable SKUs may repeat).
  if (sku) {
    const clash = await (prisma as any).inventoryItem.findFirst({ where: { providerId, sku } });
    if (clash) throw err(422, 'SKU_IN_USE', 'SKU is already in use for this provider');
  }

  const created = await (prisma as any).$transaction(async (tx: any) => {
    let item;
    try {
      item = await tx.inventoryItem.create({
        data: {
          providerId,
          businessUnitId,
          sku,
          name,
          description,
          unit,
          costPrice,
          sellingPrice,
          currency: 'ZAR',
          quantityOnHand: openingQuantity,
          lowStockThreshold,
          isActive: true,
          imageUrl,
        },
      });
    } catch (e: any) {
      if (e?.code === 'P2002') throw err(422, 'SKU_IN_USE', 'SKU is already in use for this provider');
      throw e;
    }
    if (openingQuantity > 0) {
      await tx.inventoryMovement.create({
        data: {
          itemId: item.id,
          providerId,
          businessUnitId,
          movementType: 'RECEIVED',
          quantityDelta: openingQuantity,
          resultingQuantity: openingQuantity,
          actorUserId: providerUserId,
          referenceType: 'MANUAL',
          referenceId: null,
          reason: 'Opening balance',
        },
      });
    }
    await audit(tx, {
      actorUserId: providerUserId,
      action: 'INVENTORY_ITEM_CREATED',
      entityType: 'inventory_item',
      entityId: item.id,
      afterJson: { name, sku, sellingPrice, openingQuantity, businessUnitId } as any,
      ipAddress: ctx?.ip,
      userAgent: ctx?.userAgent,
    });
    return item;
  });

  // Post-commit hook only — never blocks the write.
  void notifyLowStockIfNeeded(created).catch(() => {});
  return toDto(created);
}

export async function listItems(
  providerUserId: string,
  query: { page?: unknown; perPage?: unknown; isActive?: unknown; lowStock?: unknown; search?: unknown; businessUnitId?: unknown },
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
  if (query.isActive === 'true' || query.isActive === true) where.isActive = true;
  if (query.isActive === 'false' || query.isActive === false) where.isActive = false;
  if (typeof query.search === 'string' && query.search.trim()) {
    const s = query.search.trim().slice(0, 64);
    where.AND = [{ OR: [{ name: { contains: s } }, { sku: { contains: s } }] }];
  }
  if (typeof query.businessUnitId === 'string' && query.businessUnitId) {
    if (!scope.unitIds.includes(query.businessUnitId)) throw err(403, 'FORBIDDEN', 'Business unit is not in your scope');
    where.businessUnitId = query.businessUnitId;
  }

  const total = await (prisma as any).inventoryItem.count({ where });
  const rows = await (prisma as any).inventoryItem.findMany({
    where,
    orderBy: { updatedAt: 'desc' },
    skip: (page - 1) * perPage,
    take: perPage,
  });
  let items = (rows as any[]).map(toDto);
  if (query.lowStock === 'true' || query.lowStock === true) {
    items = items.filter((i) => i.isLowStock);
  }
  return { items, meta: { page, perPage, total } };
}

export async function getItem(providerUserId: string, itemId: string) {
  const { item } = await scopedItem(providerUserId, itemId);
  return toDto(item);
}

const UPDATABLE_FIELDS = ['name', 'description', 'unit', 'costPrice', 'sellingPrice', 'lowStockThreshold', 'sku', 'imageUrl', 'businessUnitId'] as const;

export async function updateItem(providerUserId: string, itemId: string, input: Record<string, unknown>, ctx?: InventoryContext) {
  const { scope, item } = await scopedItem(providerUserId, itemId);
  // quantityOnHand / isActive / ids are NOT updatable here — dedicated
  // stock and activate/deactivate endpoints own those transitions.
  if ('quantityOnHand' in input || 'isActive' in input || 'providerId' in input || 'id' in input) {
    throw err(422, 'VALIDATION_ERROR', 'quantityOnHand, isActive and ownership fields cannot be updated here');
  }
  const patch: any = {};
  if (input.name !== undefined) {
    const name = String(input.name).trim();
    if (!name || name.length > 120) throw err(422, 'VALIDATION_ERROR', 'name is required (max 120 characters)');
    patch.name = name;
  }
  if (input.description !== undefined) patch.description = input.description == null ? null : String(input.description).slice(0, 2000);
  if (input.unit !== undefined) patch.unit = String(input.unit).trim().slice(0, 24) || 'unit';
  if (input.costPrice !== undefined) patch.costPrice = assertMoney(input.costPrice, 'costPrice');
  if (input.sellingPrice !== undefined) patch.sellingPrice = assertMoney(input.sellingPrice, 'sellingPrice');
  if (input.lowStockThreshold !== undefined) patch.lowStockThreshold = assertNonNegativeInt(input.lowStockThreshold, 'lowStockThreshold');
  if (input.imageUrl !== undefined) patch.imageUrl = input.imageUrl == null ? null : String(input.imageUrl).slice(0, 500);
  if (input.sku !== undefined) {
    const skuRaw = input.sku == null ? null : String(input.sku).trim().slice(0, 64);
    const sku = skuRaw && skuRaw.length > 0 ? skuRaw : null;
    if (sku && sku !== item.sku) {
      const clash = await (prisma as any).inventoryItem.findFirst({ where: { providerId: item.providerId, sku, NOT: { id: item.id } } });
      if (clash) throw err(422, 'SKU_IN_USE', 'SKU is already in use for this provider');
    }
    patch.sku = sku;
  }
  if (input.businessUnitId !== undefined) {
    const target = (input.businessUnitId as string | null) ?? null;
    const resolved = resolveOwnership(scope, target);
    patch.businessUnitId = resolved.businessUnitId;
    // Moving across tenants is forbidden — provider ownership never changes.
    if (resolved.providerId !== item.providerId) {
      throw err(403, 'FORBIDDEN', 'Item ownership cannot be transferred');
    }
  }
  if (Object.keys(patch).length === 0) throw err(422, 'VALIDATION_ERROR', 'No updatable fields provided');

  const before = { ...item };
  const updated = await (prisma as any).$transaction(async (tx: any) => {
    const row = await tx.inventoryItem.update({ where: { id: item.id }, data: patch });
    await audit(tx, {
      actorUserId: providerUserId,
      action: 'INVENTORY_ITEM_UPDATED',
      entityType: 'inventory_item',
      entityId: item.id,
      beforeJson: { name: before.name, sellingPrice: toNumber(before.sellingPrice), sku: before.sku ?? null } as any,
      afterJson: { name: row.name, sellingPrice: toNumber(row.sellingPrice), sku: row.sku ?? null } as any,
      ipAddress: ctx?.ip,
      userAgent: ctx?.userAgent,
    });
    return row;
  });
  void notifyLowStockIfNeeded(updated).catch(() => {});
  return toDto(updated);
}

export async function setItemActive(providerUserId: string, itemId: string, isActive: boolean, ctx?: InventoryContext) {
  const { item } = await scopedItem(providerUserId, itemId);
  if (Boolean(item.isActive) === isActive) return toDto(item);
  const updated = await (prisma as any).$transaction(async (tx: any) => {
    const row = await tx.inventoryItem.update({ where: { id: item.id }, data: { isActive } });
    await audit(tx, {
      actorUserId: providerUserId,
      action: isActive ? 'INVENTORY_ITEM_ACTIVATED' : 'INVENTORY_ITEM_DEACTIVATED',
      entityType: 'inventory_item',
      entityId: item.id,
      beforeJson: { isActive: Boolean(item.isActive) } as any,
      afterJson: { isActive } as any,
      ipAddress: ctx?.ip,
      userAgent: ctx?.userAgent,
    });
    return row;
  });
  return toDto(updated);
}

/**
 * Core stock mutation — row-locked, transactional, audited.
 * Positive delta → RECEIVED/ADJUST_INCREASE, negative → ADJUST_DECREASE.
 * allowNegative=false blocks balances below zero (422 NEGATIVE_STOCK).
 */
export async function mutateStock(
  providerUserId: string,
  itemId: string,
  delta: number,
  kind: 'RECEIVED' | 'ADJUST_INCREASE' | 'ADJUST_DECREASE',
  opts?: { reason?: string | null; referenceType?: string | null; referenceId?: string | null; allowNegative?: boolean; ctx?: InventoryContext },
) {
  if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 1000000) {
    throw err(422, 'VALIDATION_ERROR', 'delta must be a non-zero integer within ±1000000');
  }
  const { item } = await scopedItem(providerUserId, itemId);
  const result = await (prisma as any).$transaction(
    async (tx: any) => {
      try {
        await tx.$queryRaw`SELECT * FROM inventory_items WHERE id = ${item.id} FOR UPDATE`;
      } catch {
        /* lock hint best-effort on non-MySQL harnesses */
      }
      const fresh = await tx.inventoryItem.findUnique({ where: { id: item.id } });
      if (!fresh) throw err(404, 'INVENTORY_ITEM_NOT_FOUND', 'Inventory item not found');
      const current = toNumber((fresh as any).quantityOnHand);
      const resulting = current + delta;
      if (resulting < 0 && opts?.allowNegative !== true) {
        throw err(422, 'NEGATIVE_STOCK', 'Stock adjustment would take quantity below zero', { current, delta });
      }
      const updated = await tx.inventoryItem.update({ where: { id: item.id }, data: { quantityOnHand: resulting } });
      const movement = await tx.inventoryMovement.create({
        data: {
          itemId: item.id,
          providerId: (fresh as any).providerId,
          businessUnitId: (fresh as any).businessUnitId ?? null,
          movementType: kind,
          quantityDelta: delta,
          resultingQuantity: resulting,
          actorUserId: providerUserId,
          referenceType: opts?.referenceType ?? 'MANUAL',
          referenceId: opts?.referenceId ?? null,
          reason: opts?.reason ? String(opts.reason).slice(0, 2000) : null,
        },
      });
      await audit(tx, {
        actorUserId: providerUserId,
        action: kind === 'RECEIVED' ? 'STOCK_RECEIVED' : 'STOCK_ADJUSTED',
        entityType: 'inventory_item',
        entityId: item.id,
        beforeJson: { quantityOnHand: current } as any,
        afterJson: { quantityOnHand: resulting, delta, movementId: movement.id } as any,
        ipAddress: opts?.ctx?.ip,
        userAgent: opts?.ctx?.userAgent,
      });
      return { updated, movement };
    },
    { isolationLevel: 'Serializable' } as any,
  );
  void notifyLowStockIfNeeded(result.updated, { crossedFrom: toNumber(item.quantityOnHand) }).catch(() => {});
  return { item: toDto(result.updated), movement: toMovementDto(result.movement) };
}

export function toMovementDto(m: any) {
  return {
    id: m.id,
    itemId: m.itemId,
    providerId: m.providerId,
    businessUnitId: m.businessUnitId ?? null,
    movementType: m.movementType,
    quantityDelta: Number(m.quantityDelta),
    resultingQuantity: Number(m.resultingQuantity),
    actorUserId: m.actorUserId,
    referenceType: m.referenceType ?? null,
    referenceId: m.referenceId ?? null,
    reason: m.reason ?? null,
    createdAt: toIso(m.createdAt),
  };
}

export async function listMovements(
  providerUserId: string,
  itemId: string,
  query: { page?: unknown; perPage?: unknown; movementType?: unknown },
) {
  const { scope, item } = await scopedItem(providerUserId, itemId);
  void scope;
  const page = Math.max(1, Math.floor(Number(query.page) || 1));
  const perPage = Math.min(50, Math.max(1, Math.floor(Number(query.perPage) || 20)));
  if (query.page != null && (!Number.isFinite(Number(query.page)) || Number(query.page) < 1)) {
    throw err(422, 'VALIDATION_ERROR', 'page must be a positive integer');
  }
  if (query.perPage != null && (!Number.isFinite(Number(query.perPage)) || Number(query.perPage) < 1 || Number(query.perPage) > 50)) {
    throw err(422, 'VALIDATION_ERROR', 'perPage must be an integer between 1 and 50');
  }
  const where: any = { itemId: item.id };
  if (typeof query.movementType === 'string' && query.movementType) {
    const t = query.movementType.toUpperCase();
    if (!(MOVEMENT_TYPES as readonly string[]).includes(t)) throw err(422, 'VALIDATION_ERROR', 'Invalid movementType');
    where.movementType = t;
  }
  const total = await (prisma as any).inventoryMovement.count({ where });
  const rows = await (prisma as any).inventoryMovement.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    skip: (page - 1) * perPage,
    take: perPage,
  });
  return { movements: (rows as any[]).map(toMovementDto), meta: { page, perPage, total } };
}

async function notifyLowStockIfNeeded(item: any, opts?: { crossedFrom?: number }): Promise<void> {
  try {
    const qty = toNumber(item.quantityOnHand);
    const threshold = toNumber(item.lowStockThreshold);
    if (qty > threshold) return;
    if (opts?.crossedFrom != null && opts.crossedFrom <= threshold) return; // already low — no repeat noise
    const { notifyLowStock } = await import('./pos-notifications');
    await notifyLowStock({
      itemId: item.id,
      itemName: item.name,
      providerId: item.providerId,
      businessUnitId: item.businessUnitId ?? null,
      quantityOnHand: qty,
      lowStockThreshold: threshold,
    }).catch(() => {});
  } catch {
    /* notifications never break inventory writes */
  }
}

export { isLowStock };

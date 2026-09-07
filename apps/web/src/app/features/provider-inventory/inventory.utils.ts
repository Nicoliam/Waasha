/**
 * Slice 14 — Inventory presentation helpers (web).
 *
 * Framework-free pure functions so stock display, status and offline
 * gating are unit testable without Angular TestBed. Balances shown are
 * read-only estimates — the server is authoritative for all quantities.
 */

export type StockStatus = 'OUT' | 'LOW' | 'OK';

export interface InventorySummary {
  id: string;
  name: string;
  sku: string | null;
  sellingPrice: number;
  quantityOnHand: number;
  lowStockThreshold: number;
  isLowStock: boolean;
  isActive: boolean;
}

export const OFFLINE_MUTATION_MESSAGE =
  'You are offline. Stock was NOT changed — nothing was recorded. Reconnect and try again.';

export function stockStatus(item: Pick<InventorySummary, 'quantityOnHand' | 'lowStockThreshold'>): StockStatus {
  if (item.quantityOnHand <= 0) return 'OUT';
  if (item.quantityOnHand <= item.lowStockThreshold) return 'LOW';
  return 'OK';
}

export function stockLabel(status: StockStatus): string {
  if (status === 'OUT') return 'Out of stock';
  if (status === 'LOW') return 'Low stock';
  return 'In stock';
}

export function validateItemInput(input: { name: string; sellingPrice: number; costPrice?: number; quantityOnHand?: number; lowStockThreshold?: number }): string | null {
  if (!input.name || !input.name.trim()) return 'Item name is required';
  if (input.name.trim().length > 120) return 'Item name must be 120 characters or fewer';
  if (!Number.isFinite(input.sellingPrice) || input.sellingPrice < 0) return 'Selling price must be zero or more';
  if (input.costPrice != null && (!Number.isFinite(input.costPrice) || input.costPrice < 0)) return 'Cost price must be zero or more';
  if (input.quantityOnHand != null && (!Number.isInteger(input.quantityOnHand) || input.quantityOnHand < 0)) {
    return 'Opening quantity must be a whole number of zero or more';
  }
  if (input.lowStockThreshold != null && (!Number.isInteger(input.lowStockThreshold) || input.lowStockThreshold < 0)) {
    return 'Low-stock threshold must be a whole number of zero or more';
  }
  return null;
}

export function validateStockDelta(delta: number, kind: 'receive' | 'adjust'): string | null {
  if (!Number.isInteger(delta)) return 'Quantity must be a whole number';
  if (kind === 'receive' && delta < 1) return 'Receive quantity must be at least 1';
  if (kind === 'adjust' && delta === 0) return 'Adjustment cannot be zero';
  if (Math.abs(delta) > 1000000) return 'Quantity is too large';
  return null;
}

/**
 * Offline gate for inventory mutations (Slice 18 owns full sync;
 * until then mutations are blocked, never queued or faked).
 */
export function requireOnline(isOnline: boolean): { ok: true } | { ok: false; message: string } {
  if (isOnline) return { ok: true };
  return { ok: false, message: OFFLINE_MUTATION_MESSAGE };
}

export function movementLabel(type: string): string {
  switch (type) {
    case 'RECEIVED':
      return 'Stock received';
    case 'ADJUST_INCREASE':
      return 'Adjustment +';
    case 'ADJUST_DECREASE':
      return 'Adjustment −';
    case 'SALE':
      return 'Sale';
    case 'RETURN':
      return 'Return';
    case 'REVERSAL':
      return 'Reversal';
    default:
      return type;
  }
}

export function inventoryErrorMessage(err: any): string {
  const code = err?.error?.error?.code ?? err?.error?.code;
  switch (code) {
    case 'SKU_IN_USE':
      return 'That SKU is already in use.';
    case 'NEGATIVE_STOCK':
      return 'Adjustment would take stock below zero.';
    case 'OFFLINE_MUTATION_BLOCKED':
      return OFFLINE_MUTATION_MESSAGE;
    default:
      return 'Could not save inventory changes. Check your connection and try again.';
  }
}

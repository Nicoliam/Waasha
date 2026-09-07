/**
 * Slice 14 — POS presentation helpers (web).
 *
 * Framework-free pure functions so sale-building, totals display and
 * offline gating are unit testable without Angular TestBed. No business
 * rules live here: totals shown are estimates only — the server recomputes
 * every price, total and stock deduction authoritatively.
 */

export type PosPaymentMethod = 'cash' | 'eft' | 'waasha_payment';

export interface SaleBuilderLine {
  lineType: 'SERVICE' | 'PRODUCT';
  refId: string;
  name: string;
  /** Catalogue price estimate for display only — never sent as authority. */
  estimateUnitPrice: number;
  quantity: number;
  /** Available stock estimate for PRODUCT lines (display only). */
  available?: number;
}

export const POS_PAYMENT_METHODS: Array<{ value: PosPaymentMethod; label: string; hint: string }> = [
  { value: 'cash', label: 'Cash', hint: 'Recorded as collected' },
  { value: 'eft', label: 'EFT', hint: 'May be pending' },
  { value: 'waasha_payment', label: 'Waasha Payment', hint: 'Recorded receipt' },
];

export const OFFLINE_MUTATION_MESSAGE =
  'You are offline. The sale was NOT recorded — nothing was changed. Reconnect and try again.';

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function estimateLineTotal(line: SaleBuilderLine): number {
  return round2(line.estimateUnitPrice * line.quantity);
}

export function estimateSaleTotal(lines: SaleBuilderLine[]): number {
  return round2(lines.reduce((acc, l) => acc + estimateLineTotal(l), 0));
}

export function priceLabel(amount: number, currency = 'ZAR'): string {
  const n = Number.isFinite(amount) ? amount : 0;
  return `R${n.toFixed(2)}`;
}

/** Client-side builder validation (server re-validates everything). */
export function validateBuilderLine(line: SaleBuilderLine): string | null {
  if (!line.refId) return 'Select an item or service';
  if (!Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 1000) {
    return 'Quantity must be between 1 and 1000';
  }
  if (line.lineType === 'PRODUCT' && line.available != null && line.quantity > line.available) {
    return `Only ${line.available} in stock`;
  }
  return null;
}

export function validateSale(lines: SaleBuilderLine[], paymentMethod: string): string | null {
  if (lines.length === 0) return 'Add at least one line to the sale';
  if (!['cash', 'eft', 'waasha_payment'].includes(paymentMethod)) return 'Select a payment method';
  for (const l of lines) {
    const e = validateBuilderLine(l);
    if (e) return e;
  }
  return null;
}

/**
 * Offline gate for POS/inventory mutations (Slice 18 owns full sync;
 * until then mutations are blocked, never queued or faked).
 */
export function requireOnline(isOnline: boolean): { ok: true } | { ok: false; message: string } {
  if (isOnline) return { ok: true };
  return { ok: false, message: OFFLINE_MUTATION_MESSAGE };
}

export function saleErrorMessage(err: any): string {
  const code = err?.error?.error?.code ?? err?.error?.code;
  switch (code) {
    case 'INSUFFICIENT_STOCK':
      return 'Not enough stock for one or more items. Refresh inventory and try again.';
    case 'ITEM_INACTIVE':
      return 'One or more items are inactive and cannot be sold.';
    case 'SERVICE_NOT_AVAILABLE':
      return 'One or more services are not available for sale.';
    case 'CASH_NOT_ACCEPTED':
      return 'Cash is not accepted for this provider context.';
    case 'CASH_CAP_EXCEEDED':
      return 'Cash liability cap would be exceeded. Settle outstanding commission first.';
    case 'OFFLINE_MUTATION_BLOCKED':
      return OFFLINE_MUTATION_MESSAGE;
    case 'SALE_NOT_REVERSIBLE':
      return 'Only completed sales can be reversed.';
    default:
      return 'Could not complete the sale. Check your connection and try again.';
  }
}

export function statusLabel(status: string): string {
  return status === 'REVERSED' ? 'Reversed' : 'Completed';
}

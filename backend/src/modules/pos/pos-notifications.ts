import { prisma } from '../../config/prisma';
import { emitNotification } from '../notifications/notification.service';

/**
 * Slice 14 — provider-agnostic POS/inventory notification hooks.
 *
 * Only IN_APP intents through the existing Slice 7 infrastructure; no
 * vendor SDK, no duplicated delivery mechanism. Low-stock alerts fire at
 * most once per crossing into the low-stock band (callers suppress
 * repeats) so providers are not spammed.
 */

interface LowStockRef {
  itemId: string;
  itemName: string;
  providerId: string;
  businessUnitId: string | null;
  quantityOnHand: number;
  lowStockThreshold: number;
}

async function providerUserIdFor(providerId: string): Promise<string | null> {
  try {
    const profile = (await (prisma as any).providerProfile.findUnique({
      where: { id: providerId },
      select: { userId: true },
    })) as unknown as { userId: string } | null;
    return profile?.userId ?? null;
  } catch {
    return null;
  }
}

/** Emit a low-stock IN_APP alert to the owning provider user. Best-effort: never throws. */
export async function notifyLowStock(ref: LowStockRef): Promise<{ notified: boolean; duplicate: boolean }> {
  try {
    const recipientUserId = await providerUserIdFor(ref.providerId);
    if (!recipientUserId) return { notified: false, duplicate: false };
    const outOfStock = ref.quantityOnHand <= 0;
    const result = await emitNotification({
      recipientUserId,
      audience: 'PROVIDER',
      type: 'LOW_STOCK' as never,
      title: outOfStock ? 'Item out of stock' : 'Low stock warning',
      message: outOfStock
        ? `${ref.itemName} is out of stock.`
        : `${ref.itemName} is low on stock (${ref.quantityOnHand} left, threshold ${ref.lowStockThreshold}).`,
      entityType: 'inventory_item',
      entityId: ref.itemId,
      eventKey: `pos:low-stock:${ref.itemId}:${ref.quantityOnHand}`,
      metadata: {
        itemId: ref.itemId,
        quantityOnHand: ref.quantityOnHand,
        lowStockThreshold: ref.lowStockThreshold,
        businessUnitId: ref.businessUnitId,
      },
    });
    return { notified: result.notification != null, duplicate: result.duplicate };
  } catch {
    return { notified: false, duplicate: false };
  }
}

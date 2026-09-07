import { prisma } from '../../config/prisma';
import { isBookingInScope, isBookingManageable, resolveProviderScope } from './provider-bookings.service';

/**
 * Slice 13 — Provider service completion.
 *
 * Canonical transition (blueprint §Completing a Service):
 *   IN_PROGRESS → COMPLETED
 *
 * No second state machine is invented: the BookingStatus enum owned by the
 * Prisma schema remains canonical and only this explicit transition is
 * permitted here. PENDING / ACCEPTED / DECLINED / CANCELLED can never
 * complete directly (→ 422 BOOKING_INVALID_STATE).
 *
 * Payment status and service completion stay separate: completion never
 * mutates payment records, never fabricates commission/settlement entries,
 * and never claims money moved. The existing payment snapshot
 * (commissionRate/commissionAmount) is preserved untouched; completion only
 * marks the booking financially *eligible* for the existing completed-service
 * settlement workflow. Historical snapshots (items/location/price) are never
 * rewritten.
 *
 * Ownership always derives from the authenticated session via the existing
 * provider scope (direct provider, assigned provider, owned T3 units).
 */

export const PROVIDER_COMPLETE_FROM: string[] = ['IN_PROGRESS'];
export const PROVIDER_COMPLETE_TARGET = 'COMPLETED';

function err(status: number, code: string, message: string, details?: unknown): Error {
  const e: Error & { status?: number; code?: string; details?: unknown } = new Error(message);
  e.status = status;
  e.code = code;
  if (details !== undefined) e.details = details;
  return e;
}

function toNumber(d: unknown): number {
  if (d == null) return 0;
  if (typeof d === 'number') return d;
  return Number(d);
}

function toIso(d: unknown): string {
  if (d instanceof Date) return d.toISOString();
  return String(d);
}

export interface CompletionContext {
  ip?: string;
  userAgent?: string;
}

async function notifyCompleted(updated: unknown): Promise<void> {
  // Post-commit only. Never breaks the transition.
  try {
    const { notifyBookingCompleted } = await import('../notifications/booking-notifications');
    const b = updated as any;
    void notifyBookingCompleted({
      id: b.id,
      customerId: b.customerId,
      providerId: b.providerId ?? null,
      businessUnitId: b.businessUnitId ?? null,
      scheduledStart: b.scheduledStart,
      timezone: b.timezone ?? null,
      items: (b.items ?? []).map((i: any) => ({ serviceNameSnapshot: i.serviceNameSnapshot ?? null })),
    }).catch(() => {});
  } catch {}
}

/**
 * Mark an IN_PROGRESS booking COMPLETED.
 * Transactionally safe: re-reads committed state under Serializable
 * isolation so a concurrent cancel/transition surfaces as a conflict
 * instead of silently overwriting a newer state.
 */
export async function completeProviderBooking(
  providerUserId: string,
  bookingId: string,
  ctx?: CompletionContext,
) {
  const scope = await resolveProviderScope(providerUserId);

  const result = await prisma.$transaction(
    async (tx) => {
      const booking = await tx.booking.findUnique({
        where: { id: bookingId },
        include: { items: true },
      } as never);
      const b = booking as unknown as Record<string, unknown> | null;
      // Safe 404: never reveal existence of another provider's booking.
      if (!b || !isBookingInScope(b as any, scope)) {
        throw err(404, 'BOOKING_NOT_FOUND', 'Booking not found');
      }
      // Slice 15 — staff visibility does not confer completion authority.
      if (!isBookingManageable(b as any, scope)) {
        throw err(403, 'FORBIDDEN', 'Only the booking owner or assignee may complete this booking');
      }

      const previousStatus = String(b.status);
      if (!PROVIDER_COMPLETE_FROM.includes(previousStatus)) {
        throw err(
          422,
          'BOOKING_INVALID_STATE',
          `Booking cannot transition from ${previousStatus} to ${PROVIDER_COMPLETE_TARGET}`,
          { previousStatus, target: PROVIDER_COMPLETE_TARGET },
        );
      }

      // Provider must still be active (re-read inside transaction).
      const freshProvider = await tx.providerProfile.findUnique({
        where: { id: (scope.profile as any).id },
      } as never);
      if (!freshProvider || (freshProvider as Record<string, unknown>).status !== 'ACTIVE') {
        throw err(403, 'PROVIDER_INACTIVE', 'Provider account is not active');
      }

      // Snapshot the existing financial records for the audit trail — the
      // transition must preserve them byte-for-byte, never recalculate.
      let paymentSnapshot: Record<string, unknown> | null = null;
      try {
        paymentSnapshot = (await tx.payment.findUnique({
          where: { bookingId: String(b.id) },
        } as never)) as unknown as Record<string, unknown> | null;
      } catch {
        paymentSnapshot = null;
      }

      // State transition only — snapshots (items/location/price) and payment
      // records are never modified here.
      const updated = (await tx.booking.update({
        where: { id: String(b.id) },
        data: { status: PROVIDER_COMPLETE_TARGET },
        include: { items: true },
      } as never)) as unknown as Record<string, unknown>;

      try {
        await tx.auditLog.create({
          data: {
            actorUserId: providerUserId,
            action: 'BOOKING_COMPLETED',
            entityType: 'booking',
            entityId: String(b.id),
            beforeJson: {
              status: previousStatus,
              paymentStatus: String(b.paymentStatus),
              totalAmount: toNumber(b.totalAmount),
              subtotal: toNumber(b.subtotal),
            } as never,
            afterJson: {
              status: PROVIDER_COMPLETE_TARGET,
              paymentStatus: String(updated.paymentStatus),
              totalAmount: toNumber(updated.totalAmount),
              // Financial eligibility marker only: the preserved commission
              // snapshot (if any) stays authoritative for settlement.
              commissionRate:
                paymentSnapshot != null && (paymentSnapshot as any).commissionRate != null
                  ? toNumber((paymentSnapshot as any).commissionRate)
                  : null,
              commissionAmount:
                paymentSnapshot != null && (paymentSnapshot as any).commissionAmount != null
                  ? toNumber((paymentSnapshot as any).commissionAmount)
                  : null,
            } as never,
            ipAddress: ctx?.ip,
            userAgent: ctx?.userAgent,
          },
        });
      } catch {
        // Audit infra failure must not roll back the transition (existing
        // provider-booking policy); the transition itself remains truthful.
      }

      return { updated, previousStatus };
    },
    { isolationLevel: 'Serializable' } as never,
  );

  // Post-commit only: never notify for an uncommitted event.
  await notifyCompleted(result.updated);

  // Slice 17 — partner accrual hook (post-commit, best-effort, idempotent).
  // Only eligible COMPLETED bookings accrue; absence of attribution, share
  // config, or commission snapshot yields no accrual (null). Failures here
  // never roll back the completion transition.
  try {
    const { recordPartnerAccrualForBooking } = await import('../partners/training-partner.service');
    await recordPartnerAccrualForBooking(String((result.updated as any).id)).catch(() => null);
  } catch {}

  const u = result.updated;
  return {
    id: String(u.id),
    reference: String((u.uuid as string | undefined) ?? u.id),
    previousStatus: result.previousStatus,
    status: String(u.status),
    paymentStatus: String(u.paymentStatus),
    scheduledStart: toIso(u.scheduledStart),
    scheduledEnd: toIso(u.scheduledEnd),
    timezone: String(u.timezone),
    totalAmount: toNumber(u.totalAmount),
    subtotal: toNumber(u.subtotal),
    currency: String(u.currency),
  };
}

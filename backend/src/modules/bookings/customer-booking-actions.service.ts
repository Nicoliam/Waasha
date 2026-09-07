import { prisma } from '../../config/prisma';
import { BLOCKING_BOOKING_STATUSES, getAvailabilitySlots } from './availability.service';
import { getLocalDateStr, resolveTimezone } from '../../utils/timezone';

/**
 * Slice 12 — Customer booking actions (cancel / reschedule).
 *
 * Server-authoritative transitions on top of the canonical booking engine.
 * No second state machine is invented: the BookingStatus enum owned by the
 * Prisma schema remains canonical, and cancellation/rescheduling only move
 * through explicitly permitted transitions.
 *
 * Ownership always derives from the authenticated session. No customerId,
 * userId, tenantId, providerId, serviceId, price, duration, status, payment
 * or location field is ever accepted from the client as authority.
 *
 * Payment status and service completion stay separate: cancellation never
 * refunds, captures, or mutates gateway payments. Historical snapshots
 * (items, location, price, duration) are never rewritten.
 */

export const CUSTOMER_CANCEL_FROM: string[] = [
  'PENDING',
  'ACCEPTED',
  'CONFIRMED',
  'PAYMENT_PENDING',
  'PAID',
];
export const CUSTOMER_CANCEL_TARGET = 'CANCELLED';

/** Rescheduling preserves status; only the schedule moves. Same eligibility set. */
export const CUSTOMER_RESCHEDULE_FROM: string[] = [...CUSTOMER_CANCEL_FROM];

export const CANCELLATION_REASON_MAX_LENGTH = 500;

export interface CustomerBookingActionConfig {
  /** Minutes before scheduledStart after which customer cancellation is closed. Default 0 (up to start). */
  cancellationCutoffMinutes: number;
  /** Minutes before scheduledStart after which rescheduling is closed. Default 60. */
  rescheduleCutoffMinutes: number;
}

const ACTION_CONFIG_DEFAULTS: CustomerBookingActionConfig = {
  cancellationCutoffMinutes: 0,
  rescheduleCutoffMinutes: 60,
};

function parseNonNegativeInt(raw: unknown, fallback: number): number {
  const n = typeof raw === 'string' ? Number(raw) : typeof raw === 'number' ? raw : NaN;
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n);
}

/**
 * Cancellation/reschedule windows are configuration, never hard-coded
 * business rules. Reads admin_settings with safe blueprint defaults when
 * the platform has not seeded explicit values yet.
 */
export async function getCustomerBookingActionConfig(): Promise<CustomerBookingActionConfig> {
  try {
    const rows = await prisma.adminSetting.findMany({
      where: { settingKey: { in: ['customer_cancellation_cutoff_minutes', 'customer_reschedule_cutoff_minutes'] } },
    });
    if (!rows || rows.length === 0) return { ...ACTION_CONFIG_DEFAULTS };
    const map = new Map((rows as Array<{ settingKey: string; settingValue: string }>).map((r) => [r.settingKey, r.settingValue]));
    return {
      cancellationCutoffMinutes: parseNonNegativeInt(
        map.get('customer_cancellation_cutoff_minutes'),
        ACTION_CONFIG_DEFAULTS.cancellationCutoffMinutes,
      ),
      rescheduleCutoffMinutes: parseNonNegativeInt(
        map.get('customer_reschedule_cutoff_minutes'),
        ACTION_CONFIG_DEFAULTS.rescheduleCutoffMinutes,
      ),
    };
  } catch {
    return { ...ACTION_CONFIG_DEFAULTS };
  }
}

function err(status: number, code: string, message: string, details?: unknown): Error {
  const e: Error & { status?: number; code?: string; details?: unknown } = new Error(message);
  e.status = status;
  e.code = code;
  if (details !== undefined) e.details = details;
  return e;
}

/** Trim + strip control characters; never store more than the limit; never log the value. */
export function sanitizeCancellationReason(raw: unknown): string | null {
  if (raw == null) return null;
  if (typeof raw !== 'string') throw err(422, 'VALIDATION_ERROR', 'Cancellation reason must be a string');
  const cleaned = raw.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
  if (cleaned.length === 0) return null;
  if (cleaned.length > CANCELLATION_REASON_MAX_LENGTH) {
    throw err(422, 'VALIDATION_ERROR', `Cancellation reason must be at most ${CANCELLATION_REASON_MAX_LENGTH} characters`, {
      maxLength: CANCELLATION_REASON_MAX_LENGTH,
    });
  }
  return cleaned;
}

async function resolveCustomerProfile(customerUserId: string): Promise<{ id: string }> {
  const profile = await prisma.customerProfile.findUnique({ where: { userId: customerUserId } });
  // Safe 404 surface: never reveal whether a booking exists for non-owners.
  if (!profile) throw err(404, 'BOOKING_NOT_FOUND', 'Booking not found');
  return profile as { id: string };
}

function toNumber(d: unknown): number {
  if (d == null) return 0;
  if (typeof d === 'number') return d;
  return Number(d);
}

function summarizeActionResult(b: Record<string, unknown>, previousStatus: string) {
  return {
    id: String(b.id),
    reference: String((b.uuid as string | undefined) ?? b.id),
    previousStatus,
    status: String(b.status),
    paymentStatus: String(b.paymentStatus),
    paymentMethod: (b.paymentMethod as string | null) ?? null,
    scheduledStart: b.scheduledStart instanceof Date ? b.scheduledStart.toISOString() : String(b.scheduledStart),
    scheduledEnd: b.scheduledEnd instanceof Date ? b.scheduledEnd.toISOString() : String(b.scheduledEnd),
    timezone: String(b.timezone),
    totalAmount: toNumber(b.totalAmount),
    subtotal: toNumber(b.subtotal),
    currency: String(b.currency),
  };
}

async function notifyCancelled(updated: unknown): Promise<void> {
  try {
    const { notifyBookingCancelled } = await import('../notifications/booking-notifications');
    const b = updated as any;
    void notifyBookingCancelled({
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

async function notifyRescheduled(updated: unknown): Promise<void> {
  try {
    const { notifyBookingRescheduled } = await import('../notifications/booking-notifications');
    const b = updated as any;
    void notifyBookingRescheduled({
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
 * Customer cancellation: PENDING/ACCEPTED/CONFIRMED/PAYMENT_PENDING/PAID → CANCELLED.
 * Transaction re-reads committed state so a concurrent provider accept or
 * payment finalization invalidates the transition with a safe conflict
 * instead of silently overwriting a newer state.
 */
export async function cancelCustomerBooking(
  customerUserId: string,
  bookingId: string,
  input: { reason?: unknown },
  ctx?: { ip?: string; userAgent?: string },
) {
  const profile = await resolveCustomerProfile(customerUserId);
  const reason = sanitizeCancellationReason(input?.reason ?? null);
  const config = await getCustomerBookingActionConfig();

  const result = await prisma.$transaction(
    async (tx) => {
      const booking = await tx.booking.findUnique({
        where: { id: bookingId },
        include: { items: true },
      } as never);
      const b = booking as unknown as Record<string, unknown> | null;
      // Safe 404: never reveal whether another customer's booking exists.
      if (!b || (b.customerId as string) !== profile.id) {
        throw err(404, 'BOOKING_NOT_FOUND', 'Booking not found');
      }

      const previousStatus = String(b.status);
      if (!CUSTOMER_CANCEL_FROM.includes(previousStatus)) {
        throw err(422, 'BOOKING_INVALID_STATE', `Booking cannot be cancelled from ${previousStatus}`, {
          previousStatus,
          target: CUSTOMER_CANCEL_TARGET,
        });
      }

      // Timing window: cancellation closes `cancellationCutoffMinutes` before start.
      const scheduledStart = new Date(b.scheduledStart as string);
      const cutoffMs = config.cancellationCutoffMinutes * 60 * 1000;
      if (Date.now() > scheduledStart.getTime() - cutoffMs) {
        throw err(422, 'BOOKING_CANCELLATION_WINDOW_CLOSED', 'Cancellation is no longer available for this booking', {
          previousStatus,
        });
      }

      // State transition only — snapshots (items/location/price) and payment
      // records are never modified here. No refund is issued; cancellation
      // and refund remain separate events per the blueprint.
      const updated = (await tx.booking.update({
        where: { id: String(b.id) },
        data: { status: CUSTOMER_CANCEL_TARGET },
        include: { items: true },
      } as never)) as unknown as Record<string, unknown>;

      try {
        await tx.auditLog.create({
          data: {
            actorUserId: customerUserId,
            action: 'CUSTOMER_BOOKING_CANCELLED',
            entityType: 'booking',
            entityId: String(b.id),
            beforeJson: {
              status: previousStatus,
              scheduledStart: scheduledStart.toISOString(),
              totalAmount: toNumber(b.totalAmount),
            } as never,
            afterJson: {
              status: CUSTOMER_CANCEL_TARGET,
              ...(reason ? { cancellationReason: reason } : {}),
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
  await notifyCancelled(result.updated);

  return summarizeActionResult(result.updated, result.previousStatus);
}

export interface RescheduleInput {
  scheduledStart: unknown;
}

/**
 * Customer rescheduling: same eligibility states; the booking keeps its
 * identity, status, snapshots, location and payment. Only the schedule
 * moves, recomputed server-side from the snapshot duration and the
 * provider-authoritative timezone.
 */
export async function rescheduleCustomerBooking(
  customerUserId: string,
  bookingId: string,
  input: RescheduleInput,
  ctx?: { ip?: string; userAgent?: string },
) {
  const profile = await resolveCustomerProfile(customerUserId);

  if (!input || typeof input.scheduledStart !== 'string' || input.scheduledStart.trim() === '') {
    throw err(422, 'VALIDATION_ERROR', 'scheduledStart (ISO datetime) is required');
  }
  const newStart = new Date(input.scheduledStart);
  if (Number.isNaN(newStart.getTime())) {
    throw err(422, 'VALIDATION_ERROR', 'scheduledStart must be a valid ISO datetime');
  }
  if (newStart.getTime() < Date.now() - 60 * 1000) {
    throw err(422, 'INVALID_DATE', 'New scheduled time must be in the future');
  }

  const config = await getCustomerBookingActionConfig();

  // Pre-transaction availability fast-fail (authoritative re-check happens
  // inside the transaction). Reads outside the write transaction only.
  const precheck = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { items: true },
  } as never);
  const pre = precheck as unknown as Record<string, unknown> | null;
  if (!pre || (pre.customerId as string) !== profile.id) {
    throw err(404, 'BOOKING_NOT_FOUND', 'Booking not found');
  }
  const preStatus = String(pre.status);
  if (!CUSTOMER_RESCHEDULE_FROM.includes(preStatus)) {
    throw err(422, 'BOOKING_INVALID_STATE', `Booking cannot be rescheduled from ${preStatus}`, {
      previousStatus: preStatus,
    });
  }

  // Server-authoritative duration from the booking snapshot (never client input).
  const preItems = ((pre.items as Array<Record<string, unknown>>) ?? []).map((i) => ({
    durationMinutes: toNumber(i.durationMinutes),
    quantity: toNumber(i.quantity) || 1,
  }));
  const durationMinutes = preItems.reduce((acc, i) => acc + i.durationMinutes * i.quantity, 0);
  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
    throw err(422, 'INVALID_SERVICE_DURATION', 'Booking duration snapshot is invalid');
  }
  const providerTimezone = resolveTimezone((pre.timezone as string | undefined) ?? undefined);
  const newEnd = new Date(newStart.getTime() + durationMinutes * 60 * 1000);

  // Reschedule window applies to the CURRENT booking start (cutoff before start).
  const currentStart = new Date(pre.scheduledStart as string);
  if (Date.now() > currentStart.getTime() - config.rescheduleCutoffMinutes * 60 * 1000) {
    throw err(422, 'BOOKING_RESCHEDULE_WINDOW_CLOSED', 'Rescheduling is no longer available for this booking', {
      previousStatus: preStatus,
    });
  }
  // New slot must also respect the cutoff relative to now.
  if (newStart.getTime() - Date.now() < config.rescheduleCutoffMinutes * 60 * 1000) {
    throw err(422, 'BOOKING_RESCHEDULE_WINDOW_CLOSED', 'New time must be further in the future', {
      previousStatus: preStatus,
    });
  }

  // Availability fast-fail via the canonical engine (provider-authoritative timezone).
  if (pre.providerId && pre.serviceId) {
    try {
      const dateStr = getLocalDateStr(newStart, providerTimezone);
      const availability = await getAvailabilitySlots({
        providerId: String(pre.providerId),
        serviceId: String(pre.serviceId),
        date: dateStr,
      });
      const match = availability.slots.find((s) => new Date(s.start).getTime() === newStart.getTime());
      if (!match) {
        throw err(409, 'SLOT_UNAVAILABLE', 'Requested time is no longer available');
      }
    } catch (e: unknown) {
      const ce = e as { status?: number };
      if (ce && typeof ce.status === 'number') throw e;
      // Availability infra hiccup: fall through to the transactional overlap
      // check below, which remains the authoritative guard.
    }
  }

  const result = await prisma.$transaction(
    async (tx) => {
      const booking = await tx.booking.findUnique({
        where: { id: bookingId },
        include: { items: true },
      } as never);
      const b = booking as unknown as Record<string, unknown> | null;
      if (!b || (b.customerId as string) !== profile.id) {
        throw err(404, 'BOOKING_NOT_FOUND', 'Booking not found');
      }
      const previousStatus = String(b.status);
      if (!CUSTOMER_RESCHEDULE_FROM.includes(previousStatus)) {
        throw err(422, 'BOOKING_INVALID_STATE', `Booking cannot be rescheduled from ${previousStatus}`, {
          previousStatus,
        });
      }

      // Re-derive duration inside the transaction from committed snapshots.
      const items = ((b.items as Array<Record<string, unknown>>) ?? []).map((i) => ({
        durationMinutes: toNumber(i.durationMinutes),
        quantity: toNumber(i.quantity) || 1,
      }));
      const txDuration = items.reduce((acc, i) => acc + i.durationMinutes * i.quantity, 0);
      if (!Number.isFinite(txDuration) || txDuration <= 0) {
        throw err(422, 'INVALID_SERVICE_DURATION', 'Booking duration snapshot is invalid');
      }
      const txEnd = new Date(newStart.getTime() + txDuration * 60 * 1000);

      // Current-start window re-check against committed state (race safety:
      // a concurrent transition does not bypass the window).
      const committedStart = new Date(b.scheduledStart as string);
      if (Date.now() > committedStart.getTime() - config.rescheduleCutoffMinutes * 60 * 1000) {
        throw err(422, 'BOOKING_RESCHEDULE_WINDOW_CLOSED', 'Rescheduling is no longer available for this booking', {
          previousStatus,
        });
      }

      // Authoritative conflict re-check inside the transaction (excluding self).
      const conflict = await tx.booking.findFirst({
        where: {
          providerId: b.providerId as string,
          status: { in: [...BLOCKING_BOOKING_STATUSES] },
          scheduledStart: { lt: txEnd },
          scheduledEnd: { gt: newStart },
          NOT: { id: String(b.id) },
        },
      } as never);
      if (conflict) {
        const e: Error & { status?: number; code?: string } = new Error('Requested time is no longer available');
        e.status = 409;
        e.code = 'SLOT_UNAVAILABLE';
        throw e;
      }

      // Move the schedule only. Status, items, location snapshot, price and
      // payment records are preserved — identity/history stay intact.
      const updated = (await tx.booking.update({
        where: { id: String(b.id) },
        data: { scheduledStart: newStart, scheduledEnd: txEnd },
        include: { items: true },
      } as never)) as unknown as Record<string, unknown>;

      try {
        await tx.auditLog.create({
          data: {
            actorUserId: customerUserId,
            action: 'CUSTOMER_BOOKING_RESCHEDULED',
            entityType: 'booking',
            entityId: String(b.id),
            beforeJson: {
              status: previousStatus,
              scheduledStart: committedStart.toISOString(),
              scheduledEnd: new Date(b.scheduledEnd as string).toISOString(),
            } as never,
            afterJson: {
              status: previousStatus,
              scheduledStart: newStart.toISOString(),
              scheduledEnd: txEnd.toISOString(),
            } as never,
            ipAddress: ctx?.ip,
            userAgent: ctx?.userAgent,
          },
        });
      } catch {
        // Same audit policy as cancellation above.
      }

      return { updated, previousStatus };
    },
    { isolationLevel: 'Serializable' } as never,
  );

  await notifyRescheduled(result.updated);

  return summarizeActionResult(result.updated, result.previousStatus);
}

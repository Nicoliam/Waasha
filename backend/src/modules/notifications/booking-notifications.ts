import { prisma } from '../../config/prisma';
import { emitNotification } from './notification.service';
import { NotificationIntent } from './notification-provider.interface';

/**
 * Slice 7 — Booking/payment event → notification intent builders.
 *
 * Recipients are always derived server-side from booking relationships;
 * never from client input. Content uses booking snapshots (service name,
 * schedule), never mutable service data and never precise location data.
 */

interface BookingRef {
  id: string;
  customerId: string;
  providerId: string | null;
  businessUnitId: string | null;
  scheduledStart: Date | string;
  timezone?: string | null;
  items?: Array<{ serviceNameSnapshot?: string | null }> | null;
  paymentMethod?: string | null;
}

function serviceNameOf(booking: BookingRef): string {
  return booking.items?.[0]?.serviceNameSnapshot ?? 'your service';
}

function whenOf(booking: BookingRef): string {
  try {
    const d = booking.scheduledStart instanceof Date ? booking.scheduledStart : new Date(booking.scheduledStart);
    const tz = booking.timezone ?? 'Africa/Johannesburg';
    return new Intl.DateTimeFormat('en-ZA', {
      timeZone: tz,
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).format(d);
  } catch {
    return String(booking.scheduledStart);
  }
}

async function customerUserId(customerId: string): Promise<string | null> {
  try {
    const profile = (await prisma.customerProfile.findUnique({
      where: { id: customerId },
      select: { userId: true },
    } as never)) as unknown as { userId: string } | null;
    return profile?.userId ?? null;
  } catch {
    return null;
  }
}

/**
 * Provider recipient: direct provider user, or T3 business owner for
 * business-unit bookings. No delegated staff rules are invented.
 */
async function providerUserId(providerId: string | null, businessUnitId: string | null): Promise<string | null> {
  try {
    if (businessUnitId) {
      const unit = (await (prisma as unknown as {
        businessUnit: { findUnique: (args: unknown) => Promise<{ businessId: string } | null> };
      }).businessUnit.findUnique({ where: { id: businessUnitId } })) as { businessId: string } | null;
      if (unit?.businessId) {
        const business = (await (prisma as unknown as {
          business: { findUnique: (args: unknown) => Promise<{ ownerProviderId: string } | null> };
        }).business.findUnique({ where: { id: unit.businessId } })) as { ownerProviderId: string } | null;
        if (business?.ownerProviderId) return business.ownerProviderId;
      }
    }
    if (!providerId) return null;
    const profile = (await prisma.providerProfile.findUnique({
      where: { id: providerId },
      select: { userId: true },
    } as never)) as unknown as { userId: string } | null;
    return profile?.userId ?? null;
  } catch {
    return null;
  }
}

async function providerDisplayName(providerId: string | null): Promise<string> {
  try {
    if (!providerId) return 'Your provider';
    const profile = (await prisma.providerProfile.findUnique({
      where: { id: providerId },
      select: { displayName: true },
    } as never)) as unknown as { displayName: string | null } | null;
    return profile?.displayName ?? 'Your provider';
  } catch {
    return 'Your provider';
  }
}

async function customerDisplayName(customerId: string): Promise<string> {
  try {
    const profile = (await prisma.customerProfile.findUnique({
      where: { id: customerId },
      select: { displayName: true, firstName: true },
    } as never)) as unknown as { displayName: string | null; firstName: string | null } | null;
    return profile?.displayName ?? profile?.firstName ?? 'A customer';
  } catch {
    return 'A customer';
  }
}

async function safeEmit(intent: NotificationIntent): Promise<void> {
  try {
    await emitNotification(intent);
  } catch {
    // Notification failures must never break booking/payment flows.
  }
}

/** Booking created → customer confirmation + provider new-request. */
export async function notifyBookingCreated(booking: BookingRef): Promise<void> {
  const service = serviceNameOf(booking);
  const when = whenOf(booking);
  const [custUserId, provUserId, custName, provName] = await Promise.all([
    customerUserId(booking.customerId),
    providerUserId(booking.providerId, booking.businessUnitId),
    customerDisplayName(booking.customerId),
    providerDisplayName(booking.providerId),
  ]);
  if (custUserId) {
    await safeEmit({
      recipientUserId: custUserId,
      audience: 'CUSTOMER',
      type: 'BOOKING_CREATED',
      title: 'Booking submitted',
      message: `Your booking for ${service} with ${provName} (${when}) was submitted and is awaiting provider review.`,
      entityType: 'booking',
      entityId: booking.id,
      eventKey: `booking:${booking.id}:status:PENDING:customer`,
    });
  }
  if (provUserId) {
    await safeEmit({
      recipientUserId: provUserId,
      audience: 'PROVIDER',
      type: 'NEW_BOOKING_REQUEST',
      title: 'New booking request',
      message: `New booking request from ${custName} for ${service} (${when}). Review it in your inbox.`,
      entityType: 'booking',
      entityId: booking.id,
      eventKey: `booking:${booking.id}:status:PENDING:provider`,
    });
  }
}

/** Provider PENDING → ACCEPTED/DECLINED → customer notification. */
export async function notifyBookingReviewed(
  booking: BookingRef,
  decision: 'ACCEPTED' | 'DECLINED',
): Promise<void> {
  const custUserId = await customerUserId(booking.customerId);
  if (!custUserId) return;
  const service = serviceNameOf(booking);
  const provName = await providerDisplayName(booking.providerId);
  if (decision === 'ACCEPTED') {
    await safeEmit({
      recipientUserId: custUserId,
      audience: 'CUSTOMER',
      type: 'BOOKING_ACCEPTED',
      title: 'Booking accepted',
      message: `${provName} accepted your booking for ${service}.`,
      entityType: 'booking',
      entityId: booking.id,
      eventKey: `booking:${booking.id}:status:ACCEPTED`,
    });
  } else {
    await safeEmit({
      recipientUserId: custUserId,
      audience: 'CUSTOMER',
      type: 'BOOKING_DECLINED',
      title: 'Booking declined',
      message: `${provName} declined your booking for ${service}. No payment was taken for the service itself.`,
      entityType: 'booking',
      entityId: booking.id,
      eventKey: `booking:${booking.id}:status:DECLINED`,
    });
  }
}

/** Customer-initiated cancellation → customer confirmation + provider notice. */
export async function notifyBookingCancelled(booking: BookingRef): Promise<void> {
  const service = serviceNameOf(booking);
  const when = whenOf(booking);
  const [custUserId, provUserId, provName, custName] = await Promise.all([
    customerUserId(booking.customerId),
    providerUserId(booking.providerId, booking.businessUnitId),
    providerDisplayName(booking.providerId),
    customerDisplayName(booking.customerId),
  ]);
  if (custUserId) {
    await safeEmit({
      recipientUserId: custUserId,
      audience: 'CUSTOMER',
      type: 'BOOKING_CANCELLED',
      title: 'Booking cancelled',
      message: `Your booking for ${service} with ${provName} (${when}) was cancelled. No refund was processed automatically; payment status is unchanged.`,
      entityType: 'booking',
      entityId: booking.id,
      eventKey: `booking:${booking.id}:cancelled:customer`,
    });
  }
  if (provUserId) {
    await safeEmit({
      recipientUserId: provUserId,
      audience: 'PROVIDER',
      type: 'BOOKING_CANCELLED',
      title: 'Booking cancelled by customer',
      message: `${custName} cancelled the booking for ${service} (${when}).`,
      entityType: 'booking',
      entityId: booking.id,
      eventKey: `booking:${booking.id}:cancelled:provider`,
    });
  }
}

/** Customer rescheduling → customer confirmation + provider notice. */
export async function notifyBookingRescheduled(booking: BookingRef): Promise<void> {
  const service = serviceNameOf(booking);
  const when = whenOf(booking);
  const [custUserId, provUserId, provName, custName] = await Promise.all([
    customerUserId(booking.customerId),
    providerUserId(booking.providerId, booking.businessUnitId),
    providerDisplayName(booking.providerId),
    customerDisplayName(booking.customerId),
  ]);
  const startMs =
    booking.scheduledStart instanceof Date ? booking.scheduledStart.getTime() : new Date(booking.scheduledStart).getTime();
  const slotKey = Number.isFinite(startMs) ? String(startMs) : 'unknown';
  if (custUserId) {
    await safeEmit({
      recipientUserId: custUserId,
      audience: 'CUSTOMER',
      type: 'BOOKING_RESCHEDULED',
      title: 'Booking rescheduled',
      message: `Your booking for ${service} with ${provName} moved to ${when}.`,
      entityType: 'booking',
      entityId: booking.id,
      eventKey: `booking:${booking.id}:rescheduled:${slotKey}:customer`,
    });
  }
  if (provUserId) {
    await safeEmit({
      recipientUserId: provUserId,
      audience: 'PROVIDER',
      type: 'BOOKING_RESCHEDULED',
      title: 'Booking rescheduled by customer',
      message: `${custName} moved the booking for ${service} to ${when}.`,
      entityType: 'booking',
      entityId: booking.id,
      eventKey: `booking:${booking.id}:rescheduled:${slotKey}:provider`,
    });
  }
}

/** Provider IN_PROGRESS → COMPLETED → customer notification. */
export async function notifyBookingCompleted(booking: BookingRef): Promise<void> {
  const custUserId = await customerUserId(booking.customerId);
  if (!custUserId) return;
  const service = serviceNameOf(booking);
  const provName = await providerDisplayName(booking.providerId);
  await safeEmit({
    recipientUserId: custUserId,
    audience: 'CUSTOMER',
    type: 'BOOKING_COMPLETED',
    title: 'Service completed',
    message: `${provName} marked your service for ${service} as complete. You can now leave a review.`,
    entityType: 'booking',
    entityId: booking.id,
    eventKey: `booking:${booking.id}:status:COMPLETED`,
  });
}

/** Customer review submitted → provider notification. */
export async function notifyReviewSubmitted(booking: BookingRef, rating: number): Promise<void> {
  const provUserId = await providerUserId(booking.providerId, booking.businessUnitId);
  if (!provUserId) return;
  const service = serviceNameOf(booking);
  const custName = await customerDisplayName(booking.customerId);
  await safeEmit({
    recipientUserId: provUserId,
    audience: 'PROVIDER',
    type: 'REVIEW_SUBMITTED',
    title: 'New review received',
    message: `${custName} left a ${rating}-star review for ${service}.`,
    entityType: 'booking',
    entityId: booking.id,
    eventKey: `booking:${booking.id}:review-submitted`,
  });
}

export interface PaymentRef {
  id: string;
  bookingId: string;
  method: string;
  status: string;
  amount: number | string;
  currency: string;
}

async function bookingParties(bookingId: string): Promise<{ custUserId: string | null; provUserId: string | null; service: string }> {
  try {
    const booking = (await prisma.booking.findUnique({
      where: { id: bookingId },
      include: { items: true },
    } as never)) as unknown as (BookingRef & { items: Array<{ serviceNameSnapshot: string }> }) | null;
    if (!booking) return { custUserId: null, provUserId: null, service: 'your service' };
    const [custUserId, provUserId] = await Promise.all([
      customerUserId(booking.customerId),
      providerUserId(booking.providerId, booking.businessUnitId),
    ]);
    return { custUserId, provUserId, service: serviceNameOf(booking) };
  } catch {
    return { custUserId: null, provUserId: null, service: 'your service' };
  }
}

function amountText(amount: number | string, currency: string): string {
  const n = typeof amount === 'number' ? amount : Number(amount);
  return `R${Number.isFinite(n) ? n : amount} ${currency}`;
}

/** Cash intent recorded → provider notification (change info preserved as text). */
export async function notifyCashRecorded(
  payment: PaymentRef,
  cash: { changeRequested: boolean; changeAmount: number | null } | null,
): Promise<void> {
  const parties = await bookingParties(payment.bookingId);
  if (!parties.provUserId) return;
  const change =
    cash?.changeRequested && cash.changeAmount != null
      ? ` Cash change requested — customer asked for R${cash.changeAmount} change.`
      : cash?.changeRequested
        ? ' Cash change requested.'
        : '';
  await safeEmit({
    recipientUserId: parties.provUserId,
    audience: 'PROVIDER',
    type: 'CASH_RECORDED',
    title: 'Cash booking recorded',
    message: `Cash payment of ${amountText(payment.amount, payment.currency)} recorded for ${parties.service}.${change}`,
    entityType: 'booking',
    entityId: payment.bookingId,
    eventKey: `payment:${payment.id}:cash-recorded`,
  });
}

/** EFT intent created (PENDING, never auto-PAID) → customer notification. */
export async function notifyEftPending(payment: PaymentRef): Promise<void> {
  const parties = await bookingParties(payment.bookingId);
  if (!parties.custUserId) return;
  await safeEmit({
    recipientUserId: parties.custUserId,
    audience: 'CUSTOMER',
    type: 'PAYMENT_EFT_PENDING',
    title: 'EFT payment pending',
    message: `Your EFT payment of ${amountText(payment.amount, payment.currency)} for ${parties.service} was recorded and is awaiting confirmation. This does not complete the service.`,
    entityType: 'booking',
    entityId: payment.bookingId,
    eventKey: `payment:${payment.id}:eft-pending`,
  });
}

/** Webhook-resolved PAID/FAILED → both parties, idempotent per gateway event. */
export async function notifyPaymentResolved(
  payment: PaymentRef,
  gatewayEventId: string | null,
  outcome: 'PAID' | 'FAILED',
): Promise<void> {
  const parties = await bookingParties(payment.bookingId);
  const keySuffix = gatewayEventId ?? payment.id;
  if (outcome === 'PAID') {
    if (parties.custUserId) {
      await safeEmit({
        recipientUserId: parties.custUserId,
        audience: 'CUSTOMER',
        type: 'PAYMENT_PAID',
        title: 'Payment received',
        message: `Your payment of ${amountText(payment.amount, payment.currency)} for ${parties.service} was received. Payment is separate from service completion.`,
        entityType: 'booking',
        entityId: payment.bookingId,
        eventKey: `payment:${payment.id}:paid:${keySuffix}:customer`,
      });
    }
    if (parties.provUserId) {
      await safeEmit({
        recipientUserId: parties.provUserId,
        audience: 'PROVIDER',
        type: 'PAYMENT_PAID',
        title: 'Payment received',
        message: `Payment of ${amountText(payment.amount, payment.currency)} received for ${parties.service}.`,
        entityType: 'booking',
        entityId: payment.bookingId,
        eventKey: `payment:${payment.id}:paid:${keySuffix}:provider`,
      });
    }
  } else {
    if (parties.custUserId) {
      await safeEmit({
        recipientUserId: parties.custUserId,
        audience: 'CUSTOMER',
        type: 'PAYMENT_FAILED',
        title: 'Payment failed',
        message: `Your payment of ${amountText(payment.amount, payment.currency)} for ${parties.service} failed. Please retry or choose another method.`,
        entityType: 'booking',
        entityId: payment.bookingId,
        eventKey: `payment:${payment.id}:failed:${keySuffix}:customer`,
      });
    }
    if (parties.provUserId) {
      await safeEmit({
        recipientUserId: parties.provUserId,
        audience: 'PROVIDER',
        type: 'PAYMENT_FAILED',
        title: 'Payment failed',
        message: `Payment of ${amountText(payment.amount, payment.currency)} for ${parties.service} failed.`,
        entityType: 'booking',
        entityId: payment.bookingId,
        eventKey: `payment:${payment.id}:failed:${keySuffix}:provider`,
      });
    }
  }
}

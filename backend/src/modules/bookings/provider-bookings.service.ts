import { prisma } from '../../config/prisma';
import { BLOCKING_BOOKING_STATUSES } from './availability.service';

/**
 * Slice 5 — Provider booking management.
 *
 * Lifecycle (blueprint §Booking State Machine, §Provider Acceptance):
 *   PENDING → ACCEPTED   (provider accept)
 *   PENDING → DECLINED   (provider reject/decline)
 * Any other provider-driven transition → 422 BOOKING_INVALID_STATE.
 *
 * Payment status and service completion stay separate: accepting never
 * marks payment PAID and never marks the service COMPLETED.
 *
 * Location privacy: precise coordinates/address are only exposed once the
 * booking lifecycle authorizes it (ACCEPTED or later). PENDING bookings
 * return a redacted location.
 */

export const PROVIDER_ACCEPT_FROM: string[] = ['PENDING'];
export const PROVIDER_ACCEPT_TARGET = 'ACCEPTED';
export const PROVIDER_REJECT_TARGET = 'DECLINED';

/** Booking statuses for which precise client location is authorized. */
export const LOCATION_AUTHORIZED_STATUSES: string[] = [
  'ACCEPTED',
  'CONFIRMED',
  'PAID',
  'IN_PROGRESS',
  'COMPLETED',
];

export const INBOX_GROUPS: Record<string, string[]> = {
  incoming: ['PENDING'],
  accepted: ['ACCEPTED', 'CONFIRMED'],
  rejected: ['DECLINED', 'CANCELLED'],
  completed: ['COMPLETED'],
};

function toNumber(d: unknown): number {
  if (d == null) return 0;
  if (typeof d === 'number') return d;
  return Number(d);
}

function err(status: number, code: string, message: string, details?: unknown): Error {
  const e: any = new Error(message);
  e.status = status;
  e.code = code;
  if (details !== undefined) e.details = details;
  return e;
}

export interface ProviderScope {
  profile: any;
  ownedUnitIds: string[];
}

export async function resolveProviderScope(providerUserId: string): Promise<ProviderScope> {
  const profile = await prisma.providerProfile.findUnique({
    where: { userId: providerUserId },
    include: { tier: true },
  } as any);
  if (!profile) throw err(404, 'PROVIDER_NOT_FOUND', 'Provider profile not found');
  if ((profile as any).status !== 'ACTIVE') {
    throw err(403, 'PROVIDER_INACTIVE', 'Provider account is not active');
  }
  let ownedUnitIds: string[] = [];
  try {
    const businesses =
      ((await (prisma as any).business?.findMany?.({
        where: { ownerProviderId: (profile as any).userId },
        select: { id: true },
      })) as any[]) ?? [];
    if (Array.isArray(businesses) && businesses.length > 0) {
      const units =
        ((await (prisma as any).businessUnit?.findMany?.({
          where: { businessId: { in: businesses.map((b: any) => b.id) } },
          select: { id: true },
        })) as any[]) ?? [];
      ownedUnitIds = (units as any[]).map((u) => u.id);
    }
  } catch {
    ownedUnitIds = [];
  }
  return { profile, ownedUnitIds };
}

/** Tenant isolation: booking is visible to this provider scope only. */
export function isBookingInScope(booking: any, scope: ProviderScope): boolean {
  const pid = (scope.profile as any).id;
  if (booking.providerId && booking.providerId === pid) return true;
  if (booking.assignedProviderId && booking.assignedProviderId === pid) return true;
  if (booking.businessUnitId && scope.ownedUnitIds.includes(booking.businessUnitId)) return true;
  return false;
}

function bookingWhereForScope(scope: ProviderScope): any {
  const pid = (scope.profile as any).id;
  const ors: any[] = [{ providerId: pid }, { assignedProviderId: pid }];
  if (scope.ownedUnitIds.length > 0) ors.push({ businessUnitId: { in: scope.ownedUnitIds } });
  return { OR: ors };
}

function summarizeBooking(b: any) {
  const items = b.items ?? [];
  const first = items[0] ?? null;
  const durationMinutes =
    items.length > 0
      ? items.reduce((acc: number, i: any) => acc + (i.durationMinutes ?? 0) * (i.quantity ?? 1), 0)
      : null;
  return {
    id: b.id,
    reference: b.uuid ?? b.id,
    status: b.status,
    paymentStatus: b.paymentStatus,
    paymentMethod: b.paymentMethod ?? null,
    serviceId: b.serviceId ?? null,
    serviceName: first?.serviceNameSnapshot ?? null,
    serviceLocationType: b.serviceLocationType,
    scheduledStart: b.scheduledStart,
    scheduledEnd: b.scheduledEnd,
    timezone: b.timezone,
    durationMinutes,
    totalAmount: toNumber(b.totalAmount),
    subtotal: toNumber(b.subtotal),
    currency: b.currency,
    customer: b.customer
      ? {
          id: b.customer.id,
          displayName: b.customer.displayName ?? null,
          firstName: b.customer.firstName ?? null,
        }
      : null,
    createdAt: b.createdAt,
    updatedAt: b.updatedAt,
  };
}

function redactLocation(location: any | null) {
  if (!location) return null;
  return {
    id: location.id,
    locationType: location.locationType,
    addressLine1: null,
    city: location.city ?? null,
    province: location.province ?? null,
    postalCode: null,
    country: location.country ?? null,
    latitude: null,
    longitude: null,
    redacted: true,
  };
}

function fullLocation(location: any | null) {
  if (!location) return null;
  return {
    id: location.id,
    locationType: location.locationType,
    addressLine1: location.addressLine1 ?? null,
    city: location.city ?? null,
    province: location.province ?? null,
    postalCode: location.postalCode ?? null,
    country: location.country ?? null,
    latitude: location.latitude,
    longitude: location.longitude,
    redacted: false,
  };
}

export function isLocationAuthorized(status: string): boolean {
  return LOCATION_AUTHORIZED_STATUSES.includes(status);
}

async function fetchScopedBooking(bookingId: string, scope: ProviderScope): Promise<any> {
  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      items: true,
      location: true,
      customer: { select: { id: true, displayName: true, firstName: true, lastName: true } },
      payment: true,
      cashPaymentDetail: true,
    },
  } as any);
  // Safe 404: never reveal existence of another provider's booking.
  if (!booking || !isBookingInScope(booking as any, scope)) {
    throw err(404, 'BOOKING_NOT_FOUND', 'Booking not found');
  }
  return booking;
}

export async function listProviderBookings(
  providerUserId: string,
  query: { status?: string; page?: number; perPage?: number },
) {
  const scope = await resolveProviderScope(providerUserId);
  const page = Math.max(1, query.page ?? 1);
  const perPage = Math.min(50, Math.max(1, query.perPage ?? 20));
  const rawStatus = (query.status ?? 'all').toLowerCase();

  let statusFilter: string[] | null = null;
  if (rawStatus && rawStatus !== 'all') {
    if (INBOX_GROUPS[rawStatus]) {
      statusFilter = INBOX_GROUPS[rawStatus];
    } else {
      // Allow a direct BookingStatus value (case-insensitive).
      statusFilter = [rawStatus.toUpperCase()];
    }
  }

  const where: any = {
    ...bookingWhereForScope(scope),
    ...(statusFilter ? { status: { in: statusFilter } } : {}),
  };

  const [total, bookings] = await Promise.all([
    prisma.booking.count({ where } as any),
    prisma.booking.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * perPage,
      take: perPage,
      include: {
        items: true,
        customer: { select: { id: true, displayName: true, firstName: true } },
      },
    } as any),
  ]);

  return {
    bookings: (bookings as any[]).map(summarizeBooking),
    meta: { page, perPage, total },
  };
}

export async function getProviderBookingDetail(providerUserId: string, bookingId: string) {
  const scope = await resolveProviderScope(providerUserId);
  const booking = await fetchScopedBooking(bookingId, scope);
  const b: any = booking;

  const authorized = isLocationAuthorized(b.status);
  const payment: any = b.payment ?? null;
  const cash: any = b.cashPaymentDetail ?? null;

  return {
    ...summarizeBooking(b),
    items: (b.items ?? []).map((i: any) => ({
      id: i.id,
      serviceId: i.serviceId,
      serviceNameSnapshot: i.serviceNameSnapshot,
      serviceDescriptionSnapshot: i.serviceDescriptionSnapshot ?? null,
      unitPrice: toNumber(i.unitPrice),
      quantity: i.quantity,
      durationMinutes: i.durationMinutes,
      lineTotal: toNumber(i.lineTotal),
    })),
    customer: b.customer
      ? {
          id: b.customer.id,
          displayName: b.customer.displayName ?? null,
          firstName: b.customer.firstName ?? null,
          lastName: b.customer.lastName ?? null,
        }
      : null,
    location: authorized ? fullLocation(b.location) : redactLocation(b.location),
    locationAuthorized: authorized,
    navigationAvailable: authorized,
    payment: payment
      ? {
          id: payment.id,
          method: payment.method,
          gateway: payment.gateway,
          status: payment.status,
          amount: toNumber(payment.amount),
          currency: payment.currency,
          commissionRate: payment.commissionRate != null ? toNumber(payment.commissionRate) : null,
          commissionAmount:
            payment.commissionAmount != null ? toNumber(payment.commissionAmount) : null,
          providerReference: payment.providerReference ?? null,
          paidAt: payment.paidAt ?? null,
        }
      : null,
    cash: cash
      ? {
          changeRequested: !!cash.changeRequested,
          amountTendered: cash.amountTendered != null ? toNumber(cash.amountTendered) : null,
          changeAmount: cash.changeAmount != null ? toNumber(cash.changeAmount) : null,
        }
      : null,
  };
}

async function transitionBooking(
  providerUserId: string,
  bookingId: string,
  target: string,
  auditAction: string,
) {
  const scope = await resolveProviderScope(providerUserId);

  const result = await prisma.$transaction(
    async (tx) => {
      const booking = await tx.booking.findUnique({
        where: { id: bookingId },
        include: { items: true },
      } as any);
      if (!booking || !isBookingInScope(booking as any, scope)) {
        throw err(404, 'BOOKING_NOT_FOUND', 'Booking not found');
      }
      const b: any = booking;
      const previousStatus = b.status as string;

      // Valid current-state check — no backwards/arbitrary transitions.
      if (!PROVIDER_ACCEPT_FROM.includes(previousStatus)) {
        throw err(422, 'BOOKING_INVALID_STATE', `Booking cannot transition from ${previousStatus} to ${target}`, {
          previousStatus,
          target,
        });
      }

      // Provider must still be active (re-read inside transaction).
      const freshProvider = await tx.providerProfile.findUnique({
        where: { id: (scope.profile as any).id },
      } as any);
      if (!freshProvider || (freshProvider as any).status !== 'ACTIVE') {
        throw err(403, 'PROVIDER_INACTIVE', 'Provider account is not active');
      }

      // Service relationship validation.
      if (b.serviceId) {
        const service = await tx.service.findUnique({ where: { id: b.serviceId } } as any);
        if (!service) throw err(404, 'PROVIDER_SERVICE_MISMATCH', 'Service not found for provider');
        const s: any = service;
        const pid = (scope.profile as any).id;
        const belongs =
          s.providerId === pid ||
          (s.businessUnitId && scope.ownedUnitIds.includes(s.businessUnitId));
        if (!belongs) throw err(404, 'PROVIDER_SERVICE_MISMATCH', 'Service not found for provider');
      }

      // Conflict re-check for acceptance: overlapping blocking bookings (excluding self).
      if (target === PROVIDER_ACCEPT_TARGET) {
        const conflict = await tx.booking.findFirst({
          where: {
            providerId: b.providerId,
            status: { in: [...BLOCKING_BOOKING_STATUSES] as any },
            scheduledStart: { lt: new Date(b.scheduledEnd) },
            scheduledEnd: { gt: new Date(b.scheduledStart) },
            NOT: { id: b.id },
          } as any,
        });
        if (conflict) {
          const e: any = new Error('Booking conflicts with another accepted booking');
          e.status = 409;
          e.code = 'BOOKING_CONFLICT';
          throw e;
        }
      }

      // State transition — snapshots (items/location/price) are never modified here.
      const updated = await tx.booking.update({
        where: { id: b.id },
        data: { status: target },
        include: { items: true, location: true } as any,
      } as any);

      try {
        await tx.auditLog.create({
          data: {
            actorUserId: providerUserId,
            action: auditAction,
            entityType: 'booking',
            entityId: b.id,
            beforeJson: { status: previousStatus, providerId: (scope.profile as any).id } as any,
            afterJson: { status: target, providerId: (scope.profile as any).id } as any,
          },
        });
      } catch {
        // Audit failure must not roll back the booking transition.
      }

      return { updated, previousStatus };
    },
    { isolationLevel: 'Serializable' } as any,
  );

  return result;
}

export async function acceptProviderBooking(providerUserId: string, bookingId: string) {
  const { updated, previousStatus } = await transitionBooking(
    providerUserId,
    bookingId,
    PROVIDER_ACCEPT_TARGET,
    'BOOKING_ACCEPTED',
  );
  const b: any = updated;
  return {
    id: b.id,
    reference: b.uuid ?? b.id,
    previousStatus,
    status: b.status,
    paymentStatus: b.paymentStatus,
    scheduledStart: b.scheduledStart,
    scheduledEnd: b.scheduledEnd,
  };
}

export async function rejectProviderBooking(providerUserId: string, bookingId: string) {
  const { updated, previousStatus } = await transitionBooking(
    providerUserId,
    bookingId,
    PROVIDER_REJECT_TARGET,
    'BOOKING_DECLINED',
  );
  const b: any = updated;
  return {
    id: b.id,
    reference: b.uuid ?? b.id,
    previousStatus,
    status: b.status,
    paymentStatus: b.paymentStatus,
    scheduledStart: b.scheduledStart,
    scheduledEnd: b.scheduledEnd,
  };
}

/**
 * Authorized navigation data — precise location only when the booking
 * lifecycle authorizes it. No new public location endpoint: provider
 * identity comes from the authenticated session and ownership is enforced.
 * Distance/travel-time is not computed server-side (no routing provider);
 * the client opens the installed navigation app via deep link.
 */
export async function getProviderBookingNavigation(providerUserId: string, bookingId: string) {
  const scope = await resolveProviderScope(providerUserId);
  const booking = await fetchScopedBooking(bookingId, scope);
  const b: any = booking;

  if (!isLocationAuthorized(b.status)) {
    throw err(403, 'LOCATION_NOT_AUTHORIZED', 'Client location is not available for this booking yet', {
      status: b.status,
    });
  }
  const loc: any = b.location;
  if (!loc || !Number.isFinite(loc.latitude) || !Number.isFinite(loc.longitude)) {
    throw err(404, 'BOOKING_LOCATION_NOT_FOUND', 'Booking location not available');
  }

  const dest = `${loc.latitude},${loc.longitude}`;
  const label = [loc.addressLine1, loc.city, loc.province].filter(Boolean).join(', ') || 'Client location';
  return {
    bookingId: b.id,
    reference: b.uuid ?? b.id,
    status: b.status,
    latitude: loc.latitude,
    longitude: loc.longitude,
    addressLine1: loc.addressLine1 ?? null,
    city: loc.city ?? null,
    province: loc.province ?? null,
    postalCode: loc.postalCode ?? null,
    country: loc.country ?? null,
    label,
    distanceKm: null,
    travelTimeMinutes: null,
    googleMapsUrl: `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}`,
    appleMapsUrl: `http://maps.apple.com/?daddr=${encodeURIComponent(dest)}`,
  };
}

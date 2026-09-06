import { prisma } from '../../config/prisma';

/**
 * Slice 6 — Customer booking management (read-only).
 *
 * The canonical lifecycle (PENDING → ACCEPTED → CONFIRMED → IN_PROGRESS →
 * COMPLETED, with DECLINED / CANCELLED terminals) is owned by the booking
 * engine + provider actions. No customer state-transition endpoint exists in
 * this slice: customer cancellation/completion/dispute are blueprint concepts
 * not yet implemented server-side, and the frontend must never manufacture
 * transitions. This module therefore exposes scoped reads only.
 *
 * Ownership always derives from the authenticated session. Location exposure
 * mirrors the Slice 5 provider boundary: precise snapshot coordinates are
 * only returned once the lifecycle authorizes them.
 */

// ── Explicit DTOs (never leak Prisma models) ─────────────────────────

export interface CustomerBookingItemDto {
  serviceId: string;
  serviceNameSnapshot: string;
  serviceDescriptionSnapshot: string | null;
  unitPrice: number;
  quantity: number;
  durationMinutes: number;
  lineTotal: number;
}

export interface CustomerBookingLocationDto {
  locationType: string;
  addressLine1: string | null;
  city: string | null;
  province: string | null;
  postalCode: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
  redacted: boolean;
}

export interface CustomerBookingPaymentDto {
  method: string;
  gateway: string;
  status: string;
  amount: number;
  currency: string;
  providerReference: string | null;
  paidAt: string | null;
}

export interface CustomerBookingSummaryDto {
  id: string;
  reference: string;
  status: string;
  serviceName: string | null;
  providerName: string | null;
  businessName: string | null;
  serviceLocationType: string;
  scheduledStart: string;
  scheduledEnd: string;
  timezone: string;
  durationMinutes: number | null;
  totalAmount: number;
  subtotal: number;
  currency: string;
  paymentMethod: string | null;
  paymentStatus: string;
  locationSummary: string | null;
  createdAt: string;
}

export interface CustomerBookingDetailDto extends CustomerBookingSummaryDto {
  items: CustomerBookingItemDto[];
  location: CustomerBookingLocationDto | null;
  locationAuthorized: boolean;
  payment: CustomerBookingPaymentDto | null;
  cash: {
    changeRequested: boolean;
    amountTendered: number | null;
    changeAmount: number | null;
  } | null;
  updatedAt: string;
}

// ── Canonical customer-facing filter groups (no invented statuses) ────

export const CUSTOMER_INBOX_GROUPS: Record<string, string[]> = {
  upcoming: ['PENDING'],
  accepted: ['ACCEPTED', 'CONFIRMED'],
  active: ['IN_PROGRESS'],
  completed: ['COMPLETED'],
  declined: ['DECLINED'],
  cancelled: ['CANCELLED'],
};

/** Lifecycle states whose precise snapshot location is visible to the customer. */
export const CUSTOMER_LOCATION_AUTHORIZED_STATUSES: string[] = [
  'ACCEPTED',
  'CONFIRMED',
  'PAID',
  'IN_PROGRESS',
  'COMPLETED',
];

const MAX_PER_PAGE = 50;

function toNumber(d: unknown): number {
  if (d == null) return 0;
  if (typeof d === 'number') return d;
  return Number(d);
}

function toIso(d: unknown): string {
  if (d instanceof Date) return d.toISOString();
  return String(d);
}

function err(status: number, code: string, message: string, details?: unknown): Error {
  const e: Error & { status?: number; code?: string; details?: unknown } = new Error(message);
  e.status = status;
  e.code = code;
  if (details !== undefined) e.details = details;
  return e;
}

async function resolveCustomerProfile(customerUserId: string): Promise<{ id: string }> {
  const profile = await prisma.customerProfile.findUnique({ where: { userId: customerUserId } });
  if (!profile) throw err(404, 'CUSTOMER_NOT_FOUND', 'Customer profile not found');
  return profile as { id: string };
}

function summarizeLocation(location: {
  city?: string | null;
  province?: string | null;
} | null): string | null {
  if (!location) return null;
  const parts = [location.city, location.province].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : null;
}

/** Batched business-name lookup — avoids N+1 for T3 business-unit bookings. */
async function resolveBusinessNames(businessUnitIds: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const distinct = [...new Set(businessUnitIds.filter(Boolean))];
  if (distinct.length === 0) return names;
  try {
    const units = (await (prisma as unknown as {
      businessUnit: { findMany: (args: unknown) => Promise<Array<{ id: string; name: string }>> };
    }).businessUnit.findMany({ where: { id: { in: distinct } } })) as Array<{ id: string; name: string }>;
    for (const u of units ?? []) names.set(u.id, u.name);
  } catch {
    // Business names are enrichment only — never fail the inbox over them.
  }
  return names;
}

function toSummary(
  b: Record<string, unknown>,
  items: Array<Record<string, unknown>>,
  providerName: string | null,
  businessName: string | null,
  location: { city?: string | null; province?: string | null } | null,
): CustomerBookingSummaryDto {
  const durationMinutes =
    items.length > 0
      ? items.reduce((acc, i) => acc + toNumber(i.durationMinutes) * (toNumber(i.quantity) || 1), 0)
      : null;
  const first = items[0] ?? null;
  return {
    id: String(b.id),
    reference: String((b.uuid as string | undefined) ?? b.id),
    status: String(b.status),
    serviceName: first ? String(first.serviceNameSnapshot) : null,
    providerName,
    businessName,
    serviceLocationType: String(b.serviceLocationType),
    scheduledStart: toIso(b.scheduledStart),
    scheduledEnd: toIso(b.scheduledEnd),
    timezone: String(b.timezone),
    durationMinutes,
    totalAmount: toNumber(b.totalAmount),
    subtotal: toNumber(b.subtotal),
    currency: String(b.currency),
    paymentMethod: (b.paymentMethod as string | null) ?? null,
    paymentStatus: String(b.paymentStatus),
    locationSummary: summarizeLocation(location),
    createdAt: toIso(b.createdAt),
  };
}

export async function listCustomerBookings(
  customerUserId: string,
  query: { status?: string; page?: number; perPage?: number },
): Promise<{ bookings: CustomerBookingSummaryDto[]; meta: { page: number; perPage: number; total: number } }> {
  const profile = await resolveCustomerProfile(customerUserId);
  const page = Math.max(1, Math.floor(query.page ?? 1));
  const perPage = Math.min(MAX_PER_PAGE, Math.max(1, Math.floor(query.perPage ?? 20)));
  const rawStatus = (query.status ?? 'all').toLowerCase();

  let statusFilter: string[] | null = null;
  if (rawStatus && rawStatus !== 'all') {
    statusFilter = CUSTOMER_INBOX_GROUPS[rawStatus] ?? [rawStatus.toUpperCase()];
  }

  const where: Record<string, unknown> = {
    customerId: profile.id,
    ...(statusFilter ? { status: { in: statusFilter } } : {}),
  };

  const [total, bookings] = await Promise.all([
    prisma.booking.count({ where } as never),
    prisma.booking.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * perPage,
      take: perPage,
      // Indexed, narrow includes: no media, no unrelated relations.
      include: {
        items: true,
        location: { select: { city: true, province: true } },
        provider: { select: { displayName: true } },
      },
    } as never),
  ]);

  const rows = (bookings as unknown as Array<Record<string, unknown>>) ?? [];
  const businessNames = await resolveBusinessNames(
    rows.map((r) => r.businessUnitId as string).filter(Boolean),
  );

  return {
    bookings: rows.map((r) =>
      toSummary(
        r,
        (r.items as Array<Record<string, unknown>>) ?? [],
        ((r.provider as { displayName?: string | null } | null)?.displayName as string | null) ?? null,
        (r.businessUnitId as string | null) ? (businessNames.get(r.businessUnitId as string) ?? null) : null,
        (r.location as { city?: string | null; province?: string | null } | null) ?? null,
      ),
    ),
    meta: { page, perPage, total: typeof total === 'number' ? total : rows.length },
  };
}

export async function getCustomerBookingDetail(
  customerUserId: string,
  bookingId: string,
): Promise<CustomerBookingDetailDto> {
  const profile = await resolveCustomerProfile(customerUserId);
  const booking = (await prisma.booking.findUnique({
    where: { id: bookingId },
    include: {
      items: true,
      location: true,
      provider: { select: { displayName: true } },
      payment: true,
      cashPaymentDetail: true,
    },
  } as never)) as unknown as Record<string, unknown> | null;

  // Safe 404: never reveal whether another customer's booking exists.
  if (!booking || (booking.customerId as string) !== profile.id) {
    throw err(404, 'BOOKING_NOT_FOUND', 'Booking not found');
  }

  const status = String(booking.status);
  const authorized = CUSTOMER_LOCATION_AUTHORIZED_STATUSES.includes(status);
  const rawLocation = (booking.location as Record<string, unknown> | null) ?? null;
  const location: CustomerBookingLocationDto | null = rawLocation
    ? authorized
      ? {
          locationType: String(rawLocation.locationType),
          addressLine1: (rawLocation.addressLine1 as string | null) ?? null,
          city: (rawLocation.city as string | null) ?? null,
          province: (rawLocation.province as string | null) ?? null,
          postalCode: (rawLocation.postalCode as string | null) ?? null,
          country: (rawLocation.country as string | null) ?? null,
          latitude: toNumber(rawLocation.latitude),
          longitude: toNumber(rawLocation.longitude),
          redacted: false,
        }
      : {
          locationType: String(rawLocation.locationType),
          addressLine1: null,
          city: (rawLocation.city as string | null) ?? null,
          province: (rawLocation.province as string | null) ?? null,
          postalCode: null,
          country: (rawLocation.country as string | null) ?? null,
          latitude: null,
          longitude: null,
          redacted: true,
        }
    : null;

  const items = ((booking.items as Array<Record<string, unknown>>) ?? []).map((i) => ({
    serviceId: String(i.serviceId),
    serviceNameSnapshot: String(i.serviceNameSnapshot),
    serviceDescriptionSnapshot: (i.serviceDescriptionSnapshot as string | null) ?? null,
    unitPrice: toNumber(i.unitPrice),
    quantity: toNumber(i.quantity) || 1,
    durationMinutes: toNumber(i.durationMinutes),
    lineTotal: toNumber(i.lineTotal),
  }));

  const payment = (booking.payment as Record<string, unknown> | null) ?? null;
  const cash = (booking.cashPaymentDetail as Record<string, unknown> | null) ?? null;

  let businessName: string | null = null;
  if (booking.businessUnitId) {
    const names = await resolveBusinessNames([booking.businessUnitId as string]);
    businessName = names.get(booking.businessUnitId as string) ?? null;
  }

  return {
    ...toSummary(
      booking,
      items,
      ((booking.provider as { displayName?: string | null } | null)?.displayName as string | null) ?? null,
      businessName,
      rawLocation,
    ),
    items,
    location,
    locationAuthorized: authorized,
    // No provider navigation is exposed through the customer endpoint.
    payment: payment
      ? {
          method: String(payment.method),
          gateway: String(payment.gateway),
          status: String(payment.status),
          amount: toNumber(payment.amount),
          currency: String(payment.currency),
          providerReference: (payment.providerReference as string | null) ?? null,
          paidAt: payment.paidAt ? toIso(payment.paidAt) : null,
        }
      : null,
    cash: cash
      ? {
          changeRequested: Boolean(cash.changeRequested),
          amountTendered: cash.amountTendered != null ? toNumber(cash.amountTendered) : null,
          changeAmount: cash.changeAmount != null ? toNumber(cash.changeAmount) : null,
        }
      : null,
    updatedAt: toIso(booking.updatedAt),
  };
}

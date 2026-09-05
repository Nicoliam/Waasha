import { prisma } from '../../config/prisma';
import { getAvailabilitySlots, BLOCKING_BOOKING_STATUSES } from './availability.service';
import { resolveTimezone, DEFAULT_TIMEZONE, getLocalDateStr } from '../../utils/timezone';

export class BookingConflictError extends Error {
  status = 409;
  code = 'BOOKING_CONFLICT';
  constructor(msg = 'Requested time is no longer available') {
    super(msg);
  }
}

export async function createBooking(input: {
  customerUserId: string;
  providerId: string;
  serviceId: string;
  scheduledStart: string; // ISO
  serviceLocationType?: string; // PROVIDER | CUSTOMER
  customerLocation: {
    addressLine1?: string | null;
    city?: string | null;
    province?: string | null;
    postalCode?: string | null;
    country?: string | null;
    latitude: number;
    longitude: number;
    locationType?: string;
  };
}) {
  const customerProfile = await prisma.customerProfile.findUnique({
    where: { userId: input.customerUserId },
  });
  if (!customerProfile) {
    const err: any = new Error('Customer profile required');
    err.status = 403;
    err.code = 'FORBIDDEN';
    throw err;
  }

  const provider = await prisma.providerProfile.findUnique({
    where: { id: input.providerId },
    include: { tier: true },
  } as any);
  if (!provider || (provider as any).status !== 'ACTIVE') {
    const err: any = new Error('Provider not found');
    err.status = 404;
    err.code = 'PROVIDER_NOT_FOUND';
    throw err;
  }

  const service = await prisma.service.findUnique({
    where: { id: input.serviceId },
  } as any);
  if (!service || (service as any).status !== 'ACTIVE') {
    const err: any = new Error('Service not found');
    err.status = 404;
    err.code = 'SERVICE_NOT_FOUND';
    throw err;
  }

  const s: any = service;
  // Ownership check
  let belongs = false;
  let ownedUnitIds: string[] = [];
  if (s.providerId === input.providerId) belongs = true;
  else if (s.businessUnitId) {
    try {
      const businesses = await (prisma as any).business?.findMany?.({ where: { ownerProviderId: provider.userId }, select: { id: true } }) ?? [];
      if (Array.isArray(businesses) && businesses.length > 0) {
        const units = await (prisma as any).businessUnit?.findMany?.({ where: { businessId: { in: businesses.map((b: any) => b.id) } }, select: { id: true } }) ?? [];
        ownedUnitIds = (units as any[]).map((u) => u.id);
        if (ownedUnitIds.includes(s.businessUnitId)) belongs = true;
      }
    } catch {
      belongs = false;
    }
  }
  if (!belongs) {
    const err: any = new Error('Service not found for provider');
    err.status = 404;
    err.code = 'PROVIDER_SERVICE_MISMATCH';
    throw err;
  }

  // Validate scheduledStart
  const startDate = new Date(input.scheduledStart);
  if (Number.isNaN(startDate.getTime())) {
    const err: any = new Error('Invalid scheduledStart');
    err.status = 422;
    err.code = 'VALIDATION_ERROR';
    throw err;
  }
  // Must be future (allow 1 min clock skew)
  if (startDate.getTime() < Date.now() - 60 * 1000) {
    const err: any = new Error('Scheduled time must be in the future');
    err.status = 422;
    err.code = 'INVALID_DATE';
    throw err;
  }

  const durationMinutes = s.durationMinutes as number;
  const endDate = new Date(startDate.getTime() + durationMinutes * 60 * 1000);

  // Validate location
  const loc = input.customerLocation;
  if (!loc || !Number.isFinite(loc.latitude) || !Number.isFinite(loc.longitude) || loc.latitude < -90 || loc.latitude > 90 || loc.longitude < -180 || loc.longitude > 180) {
    const err: any = new Error('Valid customer location with latitude/longitude required');
    err.status = 422;
    err.code = 'LOCATION_REQUIRED';
    throw err;
  }

  // Resolve serviceLocationType authoritative
  let resolvedLocationType: string;
  const serviceMode = s.serviceMode as string; // PROVIDER_LOCATION, CUSTOMER_LOCATION, BOTH
  const requestedType = (input.serviceLocationType ?? '').toUpperCase();
  if (serviceMode === 'PROVIDER_LOCATION') {
    resolvedLocationType = 'PROVIDER';
  } else if (serviceMode === 'CUSTOMER_LOCATION') {
    resolvedLocationType = 'CUSTOMER';
  } else {
    // BOTH
    if (requestedType === 'CUSTOMER' || requestedType === 'PROVIDER') resolvedLocationType = requestedType;
    else resolvedLocationType = 'PROVIDER'; // default
  }

  // Validate availability — must be an available slot
  // Derive date string from scheduledStart in provider's local timezone (calendar date, not UTC instant)
  const providerTz = resolveTimezone((provider as any).timezone ?? DEFAULT_TIMEZONE);
  const dateStr = getLocalDateStr(startDate, providerTz);
  const availability = await getAvailabilitySlots({
    providerId: input.providerId,
    serviceId: input.serviceId,
    date: dateStr,
  });
  const match = availability.slots.find((slot) => new Date(slot.start).getTime() === startDate.getTime());
  if (!match) {
    // Also allow check where slot end matches? Strict start
    const err: any = new BookingConflictError('Requested slot is not available');
    err.code = 'SLOT_UNAVAILABLE';
    throw err;
  }

  // Additional blocking booking overlap check (outside transaction, fast-fail)
  const overlap = await prisma.booking.findFirst({
    where: {
      providerId: input.providerId,
      status: { in: [...BLOCKING_BOOKING_STATUSES] as any },
      scheduledStart: { lt: endDate },
      scheduledEnd: { gt: startDate },
    } as any,
  });
  if (overlap) {
    throw new BookingConflictError();
  }

  // Determine snapshot values
  const serviceNameSnapshot = s.name as string;
  const serviceDescriptionSnapshot = (s.description as string | null) ?? null;
  const unitPrice = Number(s.price);
  const currency = (s.currency as string) ?? 'ZAR';
  const lineTotal = unitPrice; // quantity 1

  // Location snapshot — provider or customer
  let snapshotLocation: {
    addressLine1: string | null;
    city: string | null;
    province: string | null;
    postalCode: string | null;
    country: string | null;
    latitude: number;
    longitude: number;
    locationType: string;
  };

  if (resolvedLocationType === 'PROVIDER') {
    // Fetch provider primary location
    const pLoc = await prisma.providerLocation.findFirst({
      where: { providerId: input.providerId, isActive: true },
      orderBy: [{ isPrimary: 'desc' }, { createdAt: 'desc' }],
    });
    if (pLoc) {
      snapshotLocation = {
        addressLine1: pLoc.addressLine1 ?? null,
        city: pLoc.city ?? null,
        province: pLoc.province ?? null,
        postalCode: pLoc.postalCode ?? null,
        country: pLoc.country ?? 'ZA',
        latitude: pLoc.latitude,
        longitude: pLoc.longitude,
        locationType: 'PROVIDER',
      };
    } else {
      // Fallback to customer location if provider location missing (should not happen for provider_location mode)
      // Use provider's service location? Still snapshot customer for safety but mark as PROVIDER
      snapshotLocation = {
        addressLine1: loc.addressLine1 ?? null,
        city: loc.city ?? null,
        province: loc.province ?? null,
        postalCode: loc.postalCode ?? null,
        country: loc.country ?? 'ZA',
        latitude: loc.latitude,
        longitude: loc.longitude,
        locationType: 'PROVIDER',
      };
    }
  } else {
    snapshotLocation = {
      addressLine1: loc.addressLine1 ?? null,
      city: loc.city ?? null,
      province: loc.province ?? null,
      postalCode: loc.postalCode ?? null,
      country: loc.country ?? 'ZA',
      latitude: loc.latitude,
      longitude: loc.longitude,
      locationType: 'CUSTOMER',
    };
  }

  // Transactional creation with serializable isolation — prevents double booking race
  const result = await prisma.$transaction(
    async (tx) => {
      // Re-check conflict inside transaction (phantom protection)
      const conflictInside = await tx.booking.findFirst({
        where: {
          providerId: input.providerId,
          status: { in: [...BLOCKING_BOOKING_STATUSES] as any },
          scheduledStart: { lt: endDate },
          scheduledEnd: { gt: startDate },
        } as any,
      });
      if (conflictInside) {
        throw new BookingConflictError();
      }

      // For Serializable, also lock via raw if MySQL
      try {
        await tx.$queryRaw`SELECT 1`;
      } catch {}

      const booking = await tx.booking.create({
        data: {
          customerId: customerProfile.id,
          providerId: input.providerId,
          serviceId: input.serviceId,
          businessUnitId: s.businessUnitId ?? null,
          bookingType: 'STANDARD',
          serviceLocationType: resolvedLocationType,
          scheduledStart: startDate,
          scheduledEnd: endDate,
          timezone: providerTz,
          status: 'PENDING',
          currency,
          subtotal: unitPrice,
          totalAmount: lineTotal,
          paymentMethod: null,
          paymentStatus: 'PENDING',
        } as any,
      });

      const item = await tx.bookingItem.create({
        data: {
          bookingId: booking.id,
          serviceId: input.serviceId,
          serviceNameSnapshot,
          serviceDescriptionSnapshot,
          unitPrice,
          quantity: 1,
          durationMinutes,
          lineTotal,
        },
      });

      const bookingLoc = await tx.bookingLocation.create({
        data: {
          bookingId: booking.id,
          locationType: snapshotLocation.locationType,
          addressLine1: snapshotLocation.addressLine1,
          city: snapshotLocation.city,
          province: snapshotLocation.province,
          postalCode: snapshotLocation.postalCode,
          country: snapshotLocation.country,
          latitude: snapshotLocation.latitude,
          longitude: snapshotLocation.longitude,
        },
      });

      try {
        await tx.auditLog.create({
          data: {
            actorUserId: input.customerUserId,
            action: 'BOOKING_CREATED',
            entityType: 'booking',
            entityId: booking.id,
            afterJson: {
              bookingId: booking.id,
              providerId: input.providerId,
              serviceId: input.serviceId,
              scheduledStart: startDate.toISOString(),
              scheduledEnd: endDate.toISOString(),
              serviceNameSnapshot,
              unitPrice,
              currency,
            } as any,
          },
        });
      } catch {}

      return { booking, item, bookingLocation: bookingLoc };
    },
    { isolationLevel: 'Serializable' } as any,
  );

  // Return enriched booking
  const full = await prisma.booking.findUnique({
    where: { id: result.booking.id },
    include: { items: true, location: true, customer: { select: { id: true, userId: true } }, provider: { select: { id: true, displayName: true } } },
  } as any);

  return full ?? result.booking;
}

export async function getBookingByIdForUser(bookingId: string, requestingUserId: string) {
  const customerProfile = await prisma.customerProfile.findUnique({ where: { userId: requestingUserId } });
  const providerProfile = await prisma.providerProfile.findUnique({ where: { userId: requestingUserId } });

  const booking = await prisma.booking.findUnique({
    where: { id: bookingId },
    include: { items: true, location: true },
  } as any);
  if (!booking) {
    const err: any = new Error('Booking not found');
    err.status = 404;
    err.code = 'BOOKING_NOT_FOUND';
    throw err;
  }

  const b: any = booking;
  const isOwnerCustomer = customerProfile && b.customerId === customerProfile.id;
  const isOwnerProvider = providerProfile && b.providerId === providerProfile.id;

  // Tenant isolation — only involved parties can view; provider business staff not yet in scope
  if (!isOwnerCustomer && !isOwnerProvider) {
    // Also check businessUnit staff? For now forbid
    const err: any = new Error('Forbidden');
    err.status = 403;
    err.code = 'FORBIDDEN';
    throw err;
  }

  // Do not expose unnecessary precise location publicly — booking location is private to participants, which we've already authorized
  return booking;
}

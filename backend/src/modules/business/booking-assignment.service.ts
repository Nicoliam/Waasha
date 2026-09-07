import { prisma } from '../../config/prisma';
import { audit, err, resolveBusinessScope } from './business-scope';
import { emitNotification } from '../notifications/notification.service';

/**
 * Slice 15 — T2/T3 booking assignment.
 *
 * A valid business/team operator may designate the operational
 * provider/staff responsible for a booking via assignedProviderId.
 *
 * Hard boundaries (never crossed here):
 * - No new completion states; status/payment/completion untouched.
 * - Provider acceptance lifecycle unchanged (assign ≠ accept).
 * - Location privacy unchanged — detail endpoints still redact PENDING
 *   locations; assignment grants no extra location access.
 * - Assignees gain operational visibility only through the existing
 *   assignedProviderId scope (read-only elsewhere).
 */

const ASSIGNABLE_STATUSES = ['PENDING', 'ACCEPTED', 'CONFIRMED'];

function notify(intent: Parameters<typeof emitNotification>[0]): void {
  try {
    void (emitNotification(intent) as Promise<unknown>).catch(() => {});
  } catch {
    /* notifications never fail domain writes */
  }
}

interface AssignmentAuthority {
  scope: Awaited<ReturnType<typeof resolveBusinessScope>>;
  booking: any;
  /** Provider ids eligible as assignees for this booking. */
  eligibleProviderIds: string[];
}

async function resolveAuthority(sessionUserId: string, bookingId: string): Promise<AssignmentAuthority> {
  const scope = await resolveBusinessScope(sessionUserId);
  // Assignment is a T2/T3 operating capability; T1 has no team/staff to assign to.
  if (scope.tierCode !== 'T2' && scope.tierCode !== 'T3') {
    throw err(403, 'TIER_REQUIRED', 'Booking assignment requires a T2 Teams or T3 Business account');
  }
  const booking = await prisma.booking.findUnique({ where: { id: bookingId } }).catch(() => null);
  if (!booking) throw err(404, 'BOOKING_NOT_FOUND', 'Booking not found');

  const b: any = booking;
  const ownProfileId = (scope.profile as any).id;
  const isOwnBooking = b.providerId === ownProfileId;
  const isOwnedUnitBooking = b.businessUnitId && scope.ownedUnitIds.includes(b.businessUnitId);

  if (!isOwnBooking && !isOwnedUnitBooking) {
    // Staff operators see unit bookings but only owner/manager assigns.
    const staffRow = scope.staffRows.find(
      (r) => r.businessUnitId && r.businessUnitId === b.businessUnitId && ['OWNER', 'MANAGER'].includes(r.role.toUpperCase()),
    );
    if (!staffRow) throw err(404, 'BOOKING_NOT_FOUND', 'Booking not found');
  }

  // Assignment authority: T2 owner (or ACTIVE MANAGER member of own team)
  // for provider-owned bookings; T3 owner (or ACTIVE OWNER/MANAGER staff)
  // for unit bookings.
  let authorized = false;
  let eligibleProviderIds: string[] = [ownProfileId];

  if (isOwnBooking && scope.tierCode === 'T2' && scope.team) {
    const teamId = (scope.team as any).id;
    const isOwner = (scope.team as any).ownerProviderId === (scope.profile as any).userId;
    let members: any[] = [];
    try {
      members = ((await (prisma as any).teamMember?.findMany?.({
        where: { teamId, status: 'ACTIVE' },
        select: { providerId: true, role: true },
      })) as any[]) ?? [];
    } catch {
      members = [];
    }
    const myMembership = members.find((m: any) => m.providerId === ownProfileId);
    if (isOwner || (myMembership && ['OWNER', 'MANAGER'].includes(String(myMembership.role).toUpperCase()))) {
      authorized = true;
    }
    eligibleProviderIds = [ownProfileId, ...members.map((m: any) => m.providerId)];
  } else if (isOwnBooking) {
    // T1/owner self-assignment only.
    authorized = true;
  }

  if (isOwnedUnitBooking || b.businessUnitId) {
    // Resolve the owning business for unit bookings.
    try {
      const unit = await (prisma as any).businessUnit?.findUnique?.({
        where: { id: b.businessUnitId },
        select: { businessId: true },
      });
      const businessId = (unit as any)?.businessId;
      if (businessId) {
        const isOwner = scope.ownedBusinessIds.includes(businessId);
        const myStaff = scope.staffRows.find(
          (r) => r.businessId === businessId && ['OWNER', 'MANAGER'].includes(r.role.toUpperCase()),
        );
        if (isOwner || myStaff) authorized = true;
        const staff = ((await (prisma as any).businessStaff?.findMany?.({
          where: { businessId, status: 'ACTIVE' },
          select: { providerId: true },
        })) as any[]) ?? [];
        eligibleProviderIds = [...new Set([ownProfileId, ...staff.map((s: any) => s.providerId)])];
      }
    } catch {
      /* eligibility stays owner-only */
    }
    if (isOwnedUnitBooking && scope.ownedBusinessIds.length > 0 && !authorized) {
      authorized = true; // owning business operator
    }
  }

  if (!authorized) throw err(403, 'FORBIDDEN', 'You may not assign this booking');
  return { scope, booking: b, eligibleProviderIds };
}

export async function assignBooking(
  sessionUserId: string,
  bookingId: string,
  input: Record<string, unknown>,
  ctx?: { ip?: string; userAgent?: string },
): Promise<any> {
  if (input.bookingId !== undefined || input.providerId !== undefined || input.businessUnitId !== undefined) {
    throw err(422, 'VALIDATION_ERROR', 'bookingId/providerId/businessUnitId must not be supplied');
  }
  const assignedProviderId = typeof input.assignedProviderId === 'string' ? input.assignedProviderId.trim() : '';
  if (!assignedProviderId) throw err(422, 'VALIDATION_ERROR', 'assignedProviderId is required');

  const { scope, booking, eligibleProviderIds } = await resolveAuthority(sessionUserId, bookingId);

  if (!ASSIGNABLE_STATUSES.includes(String(booking.status))) {
    throw err(422, 'BOOKING_INVALID_STATE', `Booking in status ${booking.status} cannot be assigned`);
  }
  if (!eligibleProviderIds.includes(assignedProviderId)) {
    throw err(422, 'INVALID_ASSIGNEE', 'Assignee must be an active team member or business staff operator');
  }
  const target = await (prisma as any).providerProfile
    .findUnique({ where: { id: assignedProviderId }, select: { id: true, userId: true, status: true } })
    .catch(() => null);
  if (!target) throw err(404, 'PROVIDER_NOT_FOUND', 'Assignee provider not found');
  if ((target as any).status !== 'ACTIVE') throw err(422, 'PROVIDER_INACTIVE', 'Assignee account is not active');
  if (booking.assignedProviderId === assignedProviderId) {
    throw err(409, 'ALREADY_ASSIGNED', 'Booking is already assigned to this provider');
  }

  const before = { assignedProviderId: booking.assignedProviderId ?? null };
  const updated = await prisma.$transaction(async (tx: any) =>
    tx.booking.update({ where: { id: bookingId }, data: { assignedProviderId } }),
  );
  await audit(
    (scope.profile as any).userId,
    'BOOKING_ASSIGNED',
    'booking',
    bookingId,
    before,
    { assignedProviderId },
    ctx,
  );
  if ((target as any).userId && (target as any).userId !== (scope.profile as any).userId) {
    notify({
      recipientUserId: (target as any).userId,
      audience: 'PROVIDER',
      type: 'BOOKING_ASSIGNED',
      title: 'Booking assigned to you',
      message: 'A booking was assigned to you. Open your provider inbox for details.',
      entityType: 'booking',
      entityId: bookingId,
      eventKey: `booking:${bookingId}:assigned:${assignedProviderId}`,
    });
  }
  return { id: bookingId, assignedProviderId: (updated as any).assignedProviderId };
}

export async function unassignBooking(
  sessionUserId: string,
  bookingId: string,
  ctx?: { ip?: string; userAgent?: string },
): Promise<any> {
  const { scope, booking } = await resolveAuthority(sessionUserId, bookingId);
  if (!ASSIGNABLE_STATUSES.includes(String(booking.status))) {
    throw err(422, 'BOOKING_INVALID_STATE', `Booking in status ${booking.status} cannot be unassigned`);
  }
  if (!booking.assignedProviderId) throw err(409, 'NOT_ASSIGNED', 'Booking has no assignee');
  const before = { assignedProviderId: booking.assignedProviderId };
  const updated = await prisma.$transaction(async (tx: any) =>
    tx.booking.update({ where: { id: bookingId }, data: { assignedProviderId: null } }),
  );
  await audit((scope.profile as any).userId, 'BOOKING_UNASSIGNED', 'booking', bookingId, before, { assignedProviderId: null }, ctx);
  return { id: bookingId, assignedProviderId: (updated as any).assignedProviderId ?? null };
}

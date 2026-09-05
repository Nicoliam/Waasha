import { prisma } from '../../config/prisma';
import {
  DEFAULT_TIMEZONE,
  resolveTimezone,
  isValidDateStr,
  getDayOfWeekForProviderDate,
  localToUtcIso,
  getProviderDayRange,
  parseDateStr,
} from '../../utils/timezone';

export const BLOCKING_BOOKING_STATUSES = [
  'PENDING',
  'ACCEPTED',
  'CONFIRMED',
  'PAYMENT_PENDING',
  'PAID',
  'IN_PROGRESS',
] as const;

export interface Slot {
  start: string; // ISO (UTC instant representing provider-local wall time)
  end: string; // ISO
  displayStart: string; // HH:mm (provider-local)
  displayEnd: string; // HH:mm
}

function parseTimeToMinutes(t: string): number | null {
  const m = t.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return null;
  return h * 60 + min;
}

function formatMinutes(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export async function getAvailabilitySlots(input: {
  providerId: string;
  serviceId: string;
  date: string; // YYYY-MM-DD — provider-local calendar date
}): Promise<{ slots: Slot[]; providerId: string; serviceId: string; date: string; timezone: string }> {
  const { providerId, serviceId, date } = input;

  if (!isValidDateStr(date)) {
    const err: any = new Error('Invalid date, expected YYYY-MM-DD');
    err.status = 422;
    err.code = 'VALIDATION_ERROR';
    throw err;
  }

  const provider = await prisma.providerProfile.findUnique({
    where: { id: providerId },
    select: { id: true, status: true, userId: true, timezone: true },
  } as any);
  if (!provider || provider.status !== 'ACTIVE') {
    const err: any = new Error('Provider not found');
    err.status = 404;
    err.code = 'PROVIDER_NOT_FOUND';
    throw err;
  }

  // Resolve provider timezone — stored on profile, fallback to default for backward compat
  const rawTz = (provider as any).timezone as string | undefined;
  const timezone = resolveTimezone(rawTz ?? DEFAULT_TIMEZONE);

  const service = await prisma.service.findUnique({
    where: { id: serviceId },
    include: { category: { select: { id: true, code: true, name: true } } },
  } as any);
  if (!service || (service as any).status !== 'ACTIVE') {
    const err: any = new Error('Service not found');
    err.status = 404;
    err.code = 'SERVICE_NOT_FOUND';
    throw err;
  }

  // Ownership validation — provider must own service directly or via business unit owned by provider.userId
  const s = service as any;
  let belongs = false;
  if (s.providerId === providerId) belongs = true;
  else if (s.businessUnitId) {
    try {
      const businesses = await (prisma as any).business?.findMany?.({ where: { ownerProviderId: provider.userId }, select: { id: true } }) ?? [];
      const unitIds = Array.isArray(businesses) && businesses.length > 0
        ? ((await (prisma as any).businessUnit?.findMany?.({ where: { businessId: { in: businesses.map((b: any) => b.id) } }, select: { id: true } }) ?? []) as any[]).map((u) => u.id)
        : [];
      if (unitIds.includes(s.businessUnitId)) belongs = true;
    } catch {
      belongs = false;
    }
  }
  if (!belongs) {
    const err: any = new Error('Service not found for provider');
    err.status = 404;
    err.code = 'SERVICE_NOT_FOUND';
    throw err;
  }

  const durationMinutes = s.durationMinutes as number;
  if (!durationMinutes || durationMinutes <= 0) {
    const err: any = new Error('Service duration invalid');
    err.status = 422;
    err.code = 'INVALID_SERVICE_DURATION';
    throw err;
  }

  // Determine dayOfWeek for rules — using provider-local calendar date, not UTC instant
  const dayOfWeek = getDayOfWeekForProviderDate(date, timezone);

  // Fetch rules: prefer businessUnit rules if service is business-unit owned, else provider rules
  let rules: any[] = [];
  if (s.businessUnitId) {
    rules = await prisma.availabilityRule.findMany({
      where: { businessUnitId: s.businessUnitId, dayOfWeek, isActive: true },
    });
    // fallback to provider if no businessUnit rules
    if (rules.length === 0) {
      rules = await prisma.availabilityRule.findMany({
        where: { providerId, dayOfWeek, isActive: true },
      });
    }
  } else {
    rules = await prisma.availabilityRule.findMany({
      where: { providerId, dayOfWeek, isActive: true },
    });
  }

  // Fetch exceptions for that date — date is calendar date in provider TZ, stored as DATE
  // Prisma DATE stores without timezone; we construct UTC midnight of calendar date components
  const parsed = parseDateStr(date)!;
  const exceptionDate = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day));
  // Prisma Date handling: query by date field (db.Date)
  let exceptions: any[] = [];
  try {
    exceptions = await prisma.availabilityException.findMany({
      where: {
        date: exceptionDate as any,
        OR: [{ providerId }, { businessUnitId: s.businessUnitId ?? undefined }],
      },
    });
    // Filter to relevant owner manually if ORM OR not precise for nulls
    exceptions = exceptions.filter((e: any) => {
      if (s.businessUnitId && e.businessUnitId === s.businessUnitId) return true;
      if (e.providerId === providerId) return true;
      return false;
    });
  } catch {
    exceptions = [];
  }

  // Exception handling
  const unavailableAllDay = exceptions.some((e: any) => e.type === 'UNAVAILABLE' && !e.startTime && !e.endTime);
  if (unavailableAllDay) {
    return { slots: [], providerId, serviceId, date, timezone };
  }

  // If any CUSTOM_HOURS exception exists for that date, it overrides rules
  const customHours = exceptions.find((e: any) => e.type === 'CUSTOM_HOURS' && e.startTime && e.endTime);
  if (customHours) {
    const startMin = parseTimeToMinutes(customHours.startTime);
    const endMin = parseTimeToMinutes(customHours.endTime);
    if (startMin != null && endMin != null && endMin > startMin) {
      rules = [
        {
          dayOfWeek,
          startTime: customHours.startTime,
          endTime: customHours.endTime,
          timezone,
          isActive: true,
        },
      ];
    } else {
      return { slots: [], providerId, serviceId, date, timezone };
    }
  } else {
    // If any UNAVAILABLE with partial times, we will exclude overlapping slots later
    // Keep rules as is
    if (rules.length === 0) {
      return { slots: [], providerId, serviceId, date, timezone };
    }
  }

  // Generate candidate slots — provider-local wall times converted to UTC instants
  const candidates: Slot[] = [];
  for (const rule of rules) {
    const startMin = parseTimeToMinutes(rule.startTime);
    const endMin = parseTimeToMinutes(rule.endTime);
    if (startMin == null || endMin == null || endMin <= startMin) continue;
    for (let t = startMin; t + durationMinutes <= endMin; t += durationMinutes) {
      const startStr = formatMinutes(t);
      const endStr = formatMinutes(t + durationMinutes);
      const startIso = localToUtcIso(date, startStr, timezone);
      const endIso = localToUtcIso(date, endStr, timezone);
      // Exclude if overlaps a partial UNAVAILABLE exception (times are wall minutes)
      let excluded = false;
      for (const ex of exceptions) {
        if (ex.type === 'UNAVAILABLE' && ex.startTime && ex.endTime) {
          const exStart = parseTimeToMinutes(ex.startTime);
          const exEnd = parseTimeToMinutes(ex.endTime);
          if (exStart != null && exEnd != null) {
            const slotStart = t;
            const slotEnd = t + durationMinutes;
            // overlap if slotStart < exEnd && slotEnd > exStart
            if (slotStart < exEnd && slotEnd > exStart) {
              excluded = true;
              break;
            }
          }
        }
      }
      if (excluded) continue;
      candidates.push({
        start: startIso,
        end: endIso,
        displayStart: startStr,
        displayEnd: endStr,
      });
    }
  }

  // Remove slots overlapping existing bookings
  // Query bookings whose scheduledStart falls within provider-local day boundaries (converted to UTC)
  const { start: dayStart, nextDayStart } = getProviderDayRange(date, timezone);

  let bookings: any[] = [];
  try {
    bookings = await prisma.booking.findMany({
      where: {
        providerId,
        scheduledStart: { gte: dayStart, lt: nextDayStart },
        status: { in: [...BLOCKING_BOOKING_STATUSES] as any },
      } as any,
      select: { scheduledStart: true, scheduledEnd: true, status: true },
    });
  } catch {
    bookings = [];
  }

  const filtered = candidates.filter((slot) => {
    const sStart = new Date(slot.start).getTime();
    const sEnd = new Date(slot.end).getTime();
    for (const b of bookings) {
      const bStart = new Date(b.scheduledStart).getTime();
      const bEnd = new Date(b.scheduledEnd).getTime();
      if (sStart < bEnd && sEnd > bStart) return false;
    }
    return true;
  });

  return { slots: filtered, providerId, serviceId, date, timezone };
}

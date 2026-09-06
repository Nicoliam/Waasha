/**
 * Slice 8 — Provider scheduling presentation helpers.
 *
 * Framework-free pure functions so schedule mapping, validation, and
 * conflict messaging are unit testable without Angular TestBed.
 * No business rules live here: the backend is authoritative for
 * validation, overlap, timezone, and slot generation.
 */

export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

export interface AvailabilityRuleDto {
  id: string;
  dayOfWeek: number;
  dayName: string;
  startTime: string;
  endTime: string;
  timezone: string;
  isActive: boolean;
  businessUnitId: string | null;
}

export interface AvailabilityExceptionDto {
  id: string;
  date: string;
  startTime: string | null;
  endTime: string | null;
  kind: 'FULL_DAY' | 'BLOCKED' | 'CUSTOM_HOURS';
  type: string;
  reason: string | null;
}

export interface ScheduleConflictDto {
  bookingId: string;
  scheduledStart: string;
  scheduledEnd: string;
  date: string;
  reason: string;
}

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function isValidTime(value: string): boolean {
  return TIME_RE.test(value ?? '');
}

export function timeToMinutes(value: string): number | null {
  if (!isValidTime(value)) return null;
  const [h, m] = value.split(':').map(Number);
  return h * 60 + m;
}

export function dayName(dayOfWeek: number): string {
  return DAY_NAMES[dayOfWeek] ?? 'Unknown';
}

/** Group active rules by day 0–6, sorted by start time. Days with no rules yield []. */
export function groupRulesByDay(rules: AvailabilityRuleDto[]): AvailabilityRuleDto[][] {
  const groups: AvailabilityRuleDto[][] = Array.from({ length: 7 }, () => []);
  for (const r of rules ?? []) {
    if (!r || r.dayOfWeek < 0 || r.dayOfWeek > 6) continue;
    groups[r.dayOfWeek].push(r);
  }
  for (const g of groups) g.sort((a, b) => (a.startTime < b.startTime ? -1 : a.startTime > b.startTime ? 1 : 0));
  return groups;
}

/** Client-side pre-check for a single window. Backend remains authoritative. */
export function validateWindow(dayOfWeek: number, startTime: string, endTime: string): string | null {
  if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) return 'Choose a valid day of the week.';
  if (!isValidTime(startTime) || !isValidTime(endTime)) return 'Times must use HH:mm (00:00–23:59).';
  const s = timeToMinutes(startTime)!;
  const e = timeToMinutes(endTime)!;
  if (e <= s) return 'End time must be after start time.';
  return null;
}

/** Client-side overlap pre-check against sibling windows. Backend remains authoritative. */
export function findOverlap(
  windows: Array<{ startTime: string; endTime: string; id?: string }>,
  candidate: { startTime: string; endTime: string; id?: string },
): boolean {
  const cs = timeToMinutes(candidate.startTime);
  const ce = timeToMinutes(candidate.endTime);
  if (cs == null || ce == null) return false;
  return (windows ?? []).some((w) => {
    if (w.id != null && candidate.id != null && w.id === candidate.id) return false;
    const s = timeToMinutes(w.startTime);
    const e = timeToMinutes(w.endTime);
    if (s == null || e == null) return false;
    return cs < e && s < ce;
  });
}

export function validateExceptionDate(date: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) return 'Date must be YYYY-MM-DD.';
  const [y, m, d] = date.split('-').map(Number);
  const utc = Date.UTC(y, m - 1, d);
  const check = new Date(utc);
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) {
    return 'Date is not a real calendar date.';
  }
  return null;
}

export function exceptionLabel(e: AvailabilityExceptionDto): string {
  if (e.kind === 'FULL_DAY') return `${e.date} — closed all day`;
  if (e.kind === 'CUSTOM_HOURS') return `${e.date} — open ${e.startTime}–${e.endTime} only`;
  return `${e.date} — blocked ${e.startTime}–${e.endTime}`;
}

export function conflictMessage(c: ScheduleConflictDto): string {
  return `Booking ${c.bookingId} on ${c.date}: ${c.reason}. The booking is kept as-is — adjust the schedule or manage the booking separately.`;
}

/** Server-confirmed vs offline messaging. Offline mutations are blocked, never faked. */
export function offlineBlockedMessage(): string {
  return 'You appear to be offline. Availability changes affect future bookings, so they can only be saved when online. Your last server-confirmed schedule is shown.';
}

export function apiErrorMessage(err: any): { message: string; unauthorized: boolean } {
  const code = err?.error?.code ?? err?.code;
  const message = err?.error?.message ?? err?.message ?? 'Something went wrong. Please try again.';
  return { message: `${code ? `[${code}] ` : ''}${message}`, unauthorized: code === 'UNAUTHORIZED' || err?.status === 401 };
}

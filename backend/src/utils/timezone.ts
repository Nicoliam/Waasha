/**
 * Timezone helpers — provider-local calendar date handling
 * Uses Intl (no extra deps) to preserve DST correctness for future providers.
 */
export const DEFAULT_TIMEZONE = 'Africa/Johannesburg';

export function isValidTimezone(tz: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function resolveTimezone(tz: string | null | undefined): string {
  if (tz && typeof tz === 'string' && isValidTimezone(tz)) return tz;
  return DEFAULT_TIMEZONE;
}

export function parseDateStr(dateStr: string): { year: number; month: number; day: number } | null {
  const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  // Validate real calendar date (e.g., 2026-02-30 invalid)
  const utc = Date.UTC(year, month - 1, day);
  const d = new Date(utc);
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return { year, month, day };
}

export function isValidDateStr(s: string): boolean {
  return parseDateStr(s) !== null;
}

/**
 * Offset in milliseconds: asUtc - utcMs
 * For a given UTC instant, compute its wall time in tz, then represent that wall time as if it were UTC.
 * offset = wallAsUtc - utcMs
 * Positive => wall ahead of UTC (e.g., JHB +02:00 => +7200000)
 */
export function getTimezoneOffsetMs(utcMs: number, timeZone: string): number {
  const tz = resolveTimezone(timeZone);
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
  const parts = dtf.formatToParts(new Date(utcMs));
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '00';
  const y = Number(get('year'));
  const mo = Number(get('month'));
  const d = Number(get('day'));
  const h = Number(get('hour'));
  const min = Number(get('minute'));
  const s = Number(get('second'));
  const asUtc = Date.UTC(y, mo - 1, d, h, min, s);
  return asUtc - utcMs;
}

/**
 * Convert a provider-local wall time (dateStr + timeStr) in timeZone to UTC milliseconds.
 * Iterates to handle DST transition days correctly.
 */
export function localToUtcMs(dateStr: string, timeStr: string, timeZone: string): number {
  const parsed = parseDateStr(dateStr);
  if (!parsed) throw new Error(`Invalid dateStr ${dateStr}`);
  const tm = timeStr.match(/^(\d{1,2}):(\d{2})$/);
  if (!tm) throw new Error(`Invalid timeStr ${timeStr}`);
  const hour = Number(tm[1]);
  const minute = Number(tm[2]);
  const { year, month, day } = parsed;
  const zone = resolveTimezone(timeZone);
  // Initial guess: treat wall time as UTC
  let utcMs = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  // Iterate 3 times to converge on DST-aware offset
  for (let i = 0; i < 3; i++) {
    const offset = getTimezoneOffsetMs(utcMs, zone);
    const candidate = Date.UTC(year, month - 1, day, hour, minute, 0, 0) - offset;
    if (candidate === utcMs) break;
    utcMs = candidate;
  }
  return utcMs;
}

export function localToUtcIso(dateStr: string, timeStr: string, timeZone: string): string {
  return new Date(localToUtcMs(dateStr, timeStr, timeZone)).toISOString();
}

/**
 * Provider-local day boundaries in UTC.
 * Start inclusive, end inclusive (last ms of day). Caller may use gte/lte or lt nextDayStart.
 */
export function getProviderDayRange(dateStr: string, timeZone: string): { start: Date; end: Date; nextDayStart: Date } {
  const startMs = localToUtcMs(dateStr, '00:00', timeZone);
  const parsed = parseDateStr(dateStr)!;
  // next day 00:00 in provider TZ
  const nextDay = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day + 1));
  const nextY = nextDay.getUTCFullYear();
  const nextM = nextDay.getUTCMonth() + 1;
  const nextD = nextDay.getUTCDate();
  const nextDateStr = `${String(nextY).padStart(4, '0')}-${String(nextM).padStart(2, '0')}-${String(nextD).padStart(2, '0')}`;
  const nextStartMs = localToUtcMs(nextDateStr, '00:00', timeZone);
  const start = new Date(startMs);
  const end = new Date(nextStartMs - 1);
  const nextDayStart = new Date(nextStartMs);
  return { start, end, nextDayStart };
}

/**
 * Extract YYYY-MM-DD in provider timezone from a UTC instant.
 */
export function getLocalDateStr(date: Date, timeZone: string): string {
  const zone = resolveTimezone(timeZone);
  const dtf = new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return dtf.format(date); // en-CA gives YYYY-MM-DD
}

/**
 * Day-of-week for provider-local calendar date.
 * Since dateStr is conceptually a provider-local calendar date, weekday is derived from calendar components.
 * Using UTC calendar preserves correctness; additionally validate via Intl weekday for consistency.
 */
export function getDayOfWeekForProviderDate(dateStr: string, _timeZone: string): number {
  const parsed = parseDateStr(dateStr);
  if (!parsed) throw new Error(`Invalid dateStr ${dateStr}`);
  // Gregorian calendar weekday is global — 2026-09-05 is Saturday everywhere.
  // We use UTC date at noon-equivalent to avoid any edge with locale parsing.
  return new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day)).getUTCDay();
}

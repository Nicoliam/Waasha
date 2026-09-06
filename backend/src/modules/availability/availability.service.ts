/**
 * Slice 8 — Provider availability & scheduling management.
 *
 * Provider identity ALWAYS comes from the authenticated session (userId).
 * Client-controlled providerId/userId/tenantId are never accepted.
 *
 * Weekly rules + date exceptions feed the existing booking engine
 * (getAvailabilitySlots); this module never duplicates slot generation.
 * Availability changes never delete, move, or mutate existing bookings —
 * they only report conflicts as warnings.
 */
import { prisma } from '../../config/prisma';
import {
  DEFAULT_TIMEZONE,
  resolveTimezone,
  isValidTimezone,
  isValidDateStr,
  parseDateStr,
  getLocalDateStr,
} from '../../utils/timezone';
import { BLOCKING_BOOKING_STATUSES } from '../bookings/availability.service';

export const MAX_WINDOWS_PER_DAY = 4;
export const MAX_RULES_TOTAL = 28;
export const MAX_EXCEPTIONS_PAGE = 50;
export const MAX_UPCOMING_EXCEPTIONS = 200;
export const MAX_CONFLICT_SCAN = 200;

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

export function err(status: number, code: string, message: string, details?: unknown): Error & { status: number; code: string; details?: unknown } {
  const e = new Error(message) as Error & { status: number; code: string; details?: unknown };
  e.status = status;
  e.code = code;
  if (details !== undefined) e.details = details;
  return e;
}

export function parseTimeToMinutes(t: string): number | null {
  if (!TIME_RE.test(t)) return null;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export interface OwnerScope {
  providerId: string;
  businessUnitId: string | null;
  timezone: string;
  tierCode: string | null;
  providerType: string | null;
}

function toRuleDTO(r: any) {
  return {
    id: r.id as string,
    dayOfWeek: r.dayOfWeek as number,
    dayName: DAY_NAMES[r.dayOfWeek as number] ?? 'Unknown',
    startTime: r.startTime as string,
    endTime: r.endTime as string,
    timezone: (r.timezone as string) ?? DEFAULT_TIMEZONE,
    isActive: r.isActive as boolean,
    businessUnitId: (r.businessUnitId as string | null) ?? null,
    createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
    updatedAt: r.updatedAt instanceof Date ? r.updatedAt.toISOString() : String(r.updatedAt),
  };
}

function toExceptionDTO(e: any) {
  const d: Date = e.date instanceof Date ? e.date : new Date(e.date);
  const yyyy = d.getUTCFullYear();
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const fullDay = !e.startTime && !e.endTime;
  return {
    id: e.id as string,
    date: `${yyyy}-${mm}-${dd}`,
    startTime: (e.startTime as string | null) ?? null,
    endTime: (e.endTime as string | null) ?? null,
    kind: fullDay ? 'FULL_DAY' : e.type === 'CUSTOM_HOURS' ? 'CUSTOM_HOURS' : 'BLOCKED',
    type: e.type as string,
    reason: (e.reason as string | null) ?? null,
    businessUnitId: (e.businessUnitId as string | null) ?? null,
    createdAt: e.createdAt instanceof Date ? e.createdAt.toISOString() : String(e.createdAt),
    updatedAt: e.updatedAt instanceof Date ? e.updatedAt.toISOString() : String(e.updatedAt),
  };
}

/** Resolve the authenticated provider's own profile. Never trusts client ids. */
async function resolveOwnProfile(authUserId: string): Promise<any> {
  const profile = await prisma.providerProfile.findUnique({
    where: { userId: authUserId },
    include: { tier: true },
  } as any);
  if (!profile) throw err(404, 'PROVIDER_NOT_FOUND', 'Provider profile not found');
  return profile;
}

/**
 * Resolve ownership scope. Optional businessUnitId must be owned by the
 * authenticated provider's business (T3 unit isolation); otherwise 403/404.
 */
export async function resolveScope(authUserId: string, businessUnitId?: string | null): Promise<OwnerScope> {
  const profile = await resolveOwnProfile(authUserId);
  const timezone = resolveTimezone((profile as any).timezone ?? DEFAULT_TIMEZONE);
  if (!businessUnitId) {
    return {
      providerId: (profile as any).id as string,
      businessUnitId: null,
      timezone,
      tierCode: ((profile as any).tier?.code as string) ?? null,
      providerType: ((profile as any).providerType as string) ?? null,
    };
  }
  // Verify the unit belongs to a business owned by this provider user.
  const unit = await (prisma as any).businessUnit?.findUnique?.({ where: { id: businessUnitId } });
  if (!unit) throw err(404, 'AVAILABILITY_NOT_FOUND', 'Business unit not found');
  const business = await (prisma as any).business?.findUnique?.({ where: { id: (unit as any).businessId } });
  if (!business || (business as any).ownerProviderId !== authUserId) {
    throw err(403, 'FORBIDDEN', 'Not authorized for this business unit');
  }
  return {
    providerId: (profile as any).id as string,
    businessUnitId: (unit as any).id as string,
    timezone,
    tierCode: ((profile as any).tier?.code as string) ?? null,
    providerType: ((profile as any).providerType as string) ?? null,
  };
}

function ownerWhere(scope: OwnerScope): any {
  if (scope.businessUnitId) return { businessUnitId: scope.businessUnitId };
  return { providerId: scope.providerId };
}

async function writeAudit(opts: { actorUserId: string; action: string; entityType: string; entityId: string; before?: unknown; after?: unknown; ip?: string; userAgent?: string }) {
  try {
    await prisma.auditLog.create({
      data: {
        actorUserId: opts.actorUserId,
        action: opts.action,
        entityType: opts.entityType,
        entityId: opts.entityId,
        beforeJson: (opts.before ?? null) as any,
        afterJson: (opts.after ?? null) as any,
        ipAddress: opts.ip,
        userAgent: opts.userAgent,
      },
    });
  } catch {
    // Audit failure must not roll back availability mutations.
  }
}

function validateRuleWindow(dayOfWeek: unknown, startTime: unknown, endTime: unknown): { dayOfWeek: number; startMin: number; endMin: number } {
  if (typeof dayOfWeek !== 'number' || !Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
    throw err(422, 'AVAILABILITY_INVALID', 'dayOfWeek must be an integer 0 (Sunday) to 6 (Saturday)');
  }
  if (typeof startTime !== 'string' || typeof endTime !== 'string') {
    throw err(422, 'AVAILABILITY_INVALID', 'startTime and endTime must be HH:mm strings');
  }
  const startMin = parseTimeToMinutes(startTime);
  const endMin = parseTimeToMinutes(endTime);
  if (startMin == null || endMin == null) {
    throw err(422, 'AVAILABILITY_INVALID', 'startTime and endTime must use HH:mm (00:00–23:59)');
  }
  if (endMin <= startMin) {
    throw err(422, 'AVAILABILITY_INVALID', 'endTime must be after startTime');
  }
  return { dayOfWeek, startMin, endMin };
}

function checkRuleOverlap(windows: Array<{ startMin: number; endMin: number }>, label: string): void {
  const sorted = [...windows].sort((a, b) => a.startMin - b.startMin);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].startMin < sorted[i - 1].endMin) {
      throw err(409, 'AVAILABILITY_CONFLICT', `Overlapping windows on ${label} are not allowed`);
    }
  }
}

// ── Rules ─────────────────────────────────────────────────────────

export async function listRules(authUserId: string, businessUnitId?: string | null) {
  const scope = await resolveScope(authUserId, businessUnitId);
  const rules = await prisma.availabilityRule.findMany({
    where: ownerWhere(scope),
    orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
  } as any);
  return { timezone: scope.timezone, tierCode: scope.tierCode, providerType: scope.providerType, businessUnitId: scope.businessUnitId, rules: (rules as any[]).map(toRuleDTO) };
}

export async function createRule(authUserId: string, input: { dayOfWeek: unknown; startTime: unknown; endTime: unknown; isActive?: unknown; businessUnitId?: string | null }, ctx?: { ip?: string; userAgent?: string }) {
  const scope = await resolveScope(authUserId, input.businessUnitId ?? null);
  const { dayOfWeek } = validateRuleWindow(input.dayOfWeek, input.startTime, input.endTime);
  const isActive = input.isActive === undefined ? true : input.isActive === true;

  const existing = (await prisma.availabilityRule.findMany({ where: { ...ownerWhere(scope), dayOfWeek, isActive: true } } as any)) as any[];
  if (existing.length >= MAX_WINDOWS_PER_DAY) {
    throw err(422, 'AVAILABILITY_INVALID', `Maximum ${MAX_WINDOWS_PER_DAY} windows per day`);
  }
  const startMin = parseTimeToMinutes(input.startTime as string)!;
  const endMin = parseTimeToMinutes(input.endTime as string)!;
  for (const r of existing) {
    const s = parseTimeToMinutes(r.startTime);
    const e = parseTimeToMinutes(r.endTime);
    if (s != null && e != null && rangesOverlap(startMin, endMin, s, e)) {
      throw err(409, 'AVAILABILITY_CONFLICT', 'New window overlaps an existing window for this day');
    }
  }
  const total = (await prisma.availabilityRule.count({ where: ownerWhere(scope) } as any).catch(() => existing.length)) as number;
  if (total >= MAX_RULES_TOTAL) throw err(422, 'AVAILABILITY_INVALID', `Maximum ${MAX_RULES_TOTAL} availability rules`);

  const created = await prisma.availabilityRule.create({
    data: {
      ...ownerWhere(scope),
      dayOfWeek,
      startTime: input.startTime as string,
      endTime: input.endTime as string,
      timezone: scope.timezone,
      isActive,
    },
  } as any);
  await writeAudit({ actorUserId: authUserId, action: 'AVAILABILITY_RULE_CREATED', entityType: 'availability_rule', entityId: (created as any).id, after: toRuleDTO(created), ip: ctx?.ip, userAgent: ctx?.userAgent });
  const conflicts = await findConflicts(authUserId, scope);
  return { rule: toRuleDTO(created), timezone: scope.timezone, conflicts };
}

export async function updateRule(authUserId: string, ruleId: string, input: { dayOfWeek?: unknown; startTime?: unknown; endTime?: unknown; isActive?: unknown; businessUnitId?: string | null }, ctx?: { ip?: string; userAgent?: string }) {
  if (!ruleId) throw err(422, 'VALIDATION_ERROR', 'Rule id required');
  const scope = await resolveScope(authUserId, input.businessUnitId ?? null);
  const existing = await prisma.availabilityRule.findUnique({ where: { id: ruleId } } as any);
  if (!existing) throw err(404, 'AVAILABILITY_NOT_FOUND', 'Availability rule not found');
  assertOwnership(existing, scope);

  // Allowlist: only dayOfWeek/startTime/endTime/isActive are mutable.
  const next = {
    dayOfWeek: input.dayOfWeek === undefined ? (existing as any).dayOfWeek : input.dayOfWeek,
    startTime: input.startTime === undefined ? (existing as any).startTime : input.startTime,
    endTime: input.endTime === undefined ? (existing as any).endTime : input.endTime,
    isActive: input.isActive === undefined ? (existing as any).isActive : input.isActive === true,
  };
  validateRuleWindow(next.dayOfWeek, next.startTime, next.endTime);

  const siblings = ((await prisma.availabilityRule.findMany({ where: { ...ownerWhere(scope), dayOfWeek: next.dayOfWeek as number, isActive: true } } as any)) as any[]).filter((r) => r.id !== ruleId);
  if ((next.isActive as boolean) === true) {
    if (siblings.length >= MAX_WINDOWS_PER_DAY) throw err(422, 'AVAILABILITY_INVALID', `Maximum ${MAX_WINDOWS_PER_DAY} windows per day`);
    const startMin = parseTimeToMinutes(next.startTime as string)!;
    const endMin = parseTimeToMinutes(next.endTime as string)!;
    for (const r of siblings) {
      const s = parseTimeToMinutes(r.startTime);
      const e = parseTimeToMinutes(r.endTime);
      if (s != null && e != null && rangesOverlap(startMin, endMin, s, e)) {
        throw err(409, 'AVAILABILITY_CONFLICT', 'Updated window overlaps an existing window for this day');
      }
    }
  }

  const before = toRuleDTO(existing);
  const updated = await prisma.availabilityRule.update({
    where: { id: ruleId },
    data: { dayOfWeek: next.dayOfWeek as number, startTime: next.startTime as string, endTime: next.endTime as string, timezone: scope.timezone, isActive: next.isActive as boolean },
  } as any);
  await writeAudit({ actorUserId: authUserId, action: 'AVAILABILITY_RULE_UPDATED', entityType: 'availability_rule', entityId: ruleId, before, after: toRuleDTO(updated), ip: ctx?.ip, userAgent: ctx?.userAgent });
  const conflicts = await findConflicts(authUserId, scope);
  return { rule: toRuleDTO(updated), timezone: scope.timezone, conflicts };
}

export async function deleteRule(authUserId: string, ruleId: string, businessUnitId?: string | null, ctx?: { ip?: string; userAgent?: string }) {
  if (!ruleId) throw err(422, 'VALIDATION_ERROR', 'Rule id required');
  const scope = await resolveScope(authUserId, businessUnitId);
  const existing = await prisma.availabilityRule.findUnique({ where: { id: ruleId } } as any);
  if (!existing) throw err(404, 'AVAILABILITY_NOT_FOUND', 'Availability rule not found');
  assertOwnership(existing, scope);
  const before = toRuleDTO(existing);
  await prisma.availabilityRule.delete({ where: { id: ruleId } } as any);
  await writeAudit({ actorUserId: authUserId, action: 'AVAILABILITY_RULE_REMOVED', entityType: 'availability_rule', entityId: ruleId, before, ip: ctx?.ip, userAgent: ctx?.userAgent });
  const conflicts = await findConflicts(authUserId, scope);
  return { removed: ruleId, timezone: scope.timezone, conflicts };
}

/** Bulk replace the owner's weekly schedule. Validated as a set, applied transactionally. */
export async function replaceRules(authUserId: string, input: { rules: unknown; businessUnitId?: string | null }, ctx?: { ip?: string; userAgent?: string }) {
  const scope = await resolveScope(authUserId, input.businessUnitId ?? null);
  if (!Array.isArray(input.rules)) throw err(422, 'AVAILABILITY_INVALID', 'rules must be an array');
  if (input.rules.length > MAX_RULES_TOTAL) throw err(422, 'AVAILABILITY_INVALID', `Maximum ${MAX_RULES_TOTAL} availability rules`);
  const normalized = (input.rules as any[]).map((r, i) => {
    if (!r || typeof r !== 'object') throw err(422, 'AVAILABILITY_INVALID', `rules[${i}] must be an object`);
    const { dayOfWeek } = validateRuleWindow((r as any).dayOfWeek, (r as any).startTime, (r as any).endTime);
    return { dayOfWeek, startTime: (r as any).startTime as string, endTime: (r as any).endTime as string, isActive: (r as any).isActive === undefined ? true : (r as any).isActive === true };
  });
  // Per-day overlap + per-day count across the whole replacement set (active only).
  const byDay = new Map<number, Array<{ startMin: number; endMin: number }>>();
  for (const r of normalized) {
    if (!r.isActive) continue;
    const arr = byDay.get(r.dayOfWeek) ?? [];
    arr.push({ startMin: parseTimeToMinutes(r.startTime)!, endMin: parseTimeToMinutes(r.endTime)! });
    byDay.set(r.dayOfWeek, arr);
  }
  for (const [day, windows] of byDay) {
    if (windows.length > MAX_WINDOWS_PER_DAY) throw err(422, 'AVAILABILITY_INVALID', `Maximum ${MAX_WINDOWS_PER_DAY} windows per day`);
    checkRuleOverlap(windows, DAY_NAMES[day]);
  }

  const result = await prisma.$transaction(async (tx: any) => {
    await tx.availabilityRule.deleteMany({ where: ownerWhere(scope) });
    for (const r of normalized) {
      await tx.availabilityRule.create({ data: { ...ownerWhere(scope), ...r, timezone: scope.timezone } });
    }
    return tx.availabilityRule.findMany({ where: ownerWhere(scope), orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }] });
  });
  await writeAudit({ actorUserId: authUserId, action: 'AVAILABILITY_RULES_REPLACED', entityType: 'availability_rule', entityId: scope.businessUnitId ?? scope.providerId, after: { count: (result as any[]).length }, ip: ctx?.ip, userAgent: ctx?.userAgent });
  const conflicts = await findConflicts(authUserId, scope);
  return { timezone: scope.timezone, businessUnitId: scope.businessUnitId, rules: (result as any[]).map(toRuleDTO), conflicts };
}

function assertOwnership(record: any, scope: OwnerScope): void {
  if (scope.businessUnitId) {
    if (record.businessUnitId !== scope.businessUnitId) throw err(404, 'AVAILABILITY_NOT_FOUND', 'Availability record not found');
  } else {
    if (record.providerId !== scope.providerId) throw err(404, 'AVAILABILITY_NOT_FOUND', 'Availability record not found');
  }
}

// ── Exceptions ────────────────────────────────────────────────────

export type ExceptionKind = 'FULL_DAY' | 'BLOCKED' | 'CUSTOM_HOURS';

function validateExceptionInput(input: { date: unknown; startTime?: unknown; endTime?: unknown; kind?: unknown; reason?: unknown }): { date: string; startTime: string | null; endTime: string | null; type: 'UNAVAILABLE' | 'CUSTOM_HOURS' } {
  if (typeof input.date !== 'string' || !isValidDateStr(input.date)) {
    throw err(422, 'AVAILABILITY_INVALID', 'date must be a valid YYYY-MM-DD calendar date');
  }
  const kind = (input.kind as string | undefined) ?? (input.startTime || input.endTime ? undefined : 'FULL_DAY');
  const hasTimes = input.startTime != null || input.endTime != null;
  if (!hasTimes) {
    if (kind !== undefined && kind !== 'FULL_DAY') throw err(422, 'AVAILABILITY_INVALID', 'kind must be FULL_DAY when no times are provided');
    return { date: input.date, startTime: null, endTime: null, type: 'UNAVAILABLE' };
  }
  if (typeof input.startTime !== 'string' || typeof input.endTime !== 'string') {
    throw err(422, 'AVAILABILITY_INVALID', 'startTime and endTime must both be provided as HH:mm for partial exceptions');
  }
  const s = parseTimeToMinutes(input.startTime);
  const e = parseTimeToMinutes(input.endTime);
  if (s == null || e == null) throw err(422, 'AVAILABILITY_INVALID', 'startTime and endTime must use HH:mm (00:00–23:59)');
  if (e <= s) throw err(422, 'AVAILABILITY_INVALID', 'endTime must be after startTime');
  if (kind !== undefined && kind !== 'BLOCKED' && kind !== 'CUSTOM_HOURS') {
    throw err(422, 'AVAILABILITY_INVALID', 'kind must be BLOCKED or CUSTOM_HOURS when times are provided');
  }
  const resolvedKind: ExceptionKind = (kind as ExceptionKind) ?? 'BLOCKED';
  return { date: input.date, startTime: input.startTime, endTime: input.endTime, type: resolvedKind === 'CUSTOM_HOURS' ? 'CUSTOM_HOURS' : 'UNAVAILABLE' };
}

function exceptionDateUtc(dateStr: string): Date {
  const parsed = parseDateStr(dateStr)!;
  return new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day));
}

/** Guard against duplicate/conflicting exceptions on the same date. */
function checkExceptionDateConflicts(newExc: { startTime: string | null; endTime: string | null; type: string }, siblings: any[]): void {
  const fullDay = siblings.some((s) => s.type === 'UNAVAILABLE' && !s.startTime && !s.endTime);
  if (fullDay) throw err(409, 'AVAILABILITY_CONFLICT', 'Date already has a full-day closure');
  if (!newExc.startTime || !newExc.endTime) {
    if (siblings.length > 0) throw err(409, 'AVAILABILITY_CONFLICT', 'Date already has exceptions; remove them before adding a full-day closure');
    return;
  }
  if (newExc.type === 'CUSTOM_HOURS' && siblings.some((s) => s.type === 'CUSTOM_HOURS')) {
    throw err(409, 'AVAILABILITY_CONFLICT', 'Date already has special hours');
  }
  const s = parseTimeToMinutes(newExc.startTime)!;
  const e = parseTimeToMinutes(newExc.endTime)!;
  for (const sib of siblings) {
    if (sib.startTime && sib.endTime) {
      const ss = parseTimeToMinutes(sib.startTime);
      const ee = parseTimeToMinutes(sib.endTime);
      if (ss != null && ee != null && rangesOverlap(s, e, ss, ee)) {
        throw err(409, 'AVAILABILITY_CONFLICT', 'Exception overlaps an existing exception on this date');
      }
    }
  }
}

export async function listExceptions(authUserId: string, opts: { page?: unknown; perPage?: unknown; businessUnitId?: string | null; upcomingOnly?: boolean }) {
  const scope = await resolveScope(authUserId, opts.businessUnitId ?? null);
  const page = opts.page === undefined ? 1 : Number(opts.page);
  const perPage = opts.perPage === undefined ? 20 : Number(opts.perPage);
  if (!Number.isInteger(page) || page < 1) throw err(422, 'VALIDATION_ERROR', 'page must be a positive integer');
  if (!Number.isInteger(perPage) || perPage < 1 || perPage > MAX_EXCEPTIONS_PAGE) {
    throw err(422, 'VALIDATION_ERROR', `perPage must be 1–${MAX_EXCEPTIONS_PAGE}`);
  }
  const where: any = { ...ownerWhere(scope) };
  if (opts.upcomingOnly) {
    const now = new Date();
    const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    where.date = { gte: todayUtc };
  }
  const total = await prisma.availabilityException.count({ where } as any).catch(() => 0);
  const rows = (await prisma.availabilityException.findMany({ where, orderBy: { date: 'asc' }, skip: (page - 1) * perPage, take: perPage } as any)) as any[];
  return { timezone: scope.timezone, businessUnitId: scope.businessUnitId, exceptions: rows.map(toExceptionDTO), meta: { page, perPage, total } };
}

export async function createException(authUserId: string, input: { date: unknown; startTime?: unknown; endTime?: unknown; kind?: unknown; reason?: unknown; businessUnitId?: string | null }, ctx?: { ip?: string; userAgent?: string }) {
  const scope = await resolveScope(authUserId, input.businessUnitId ?? null);
  const v = validateExceptionInput(input);
  let reason: string | null = null;
  if (input.reason !== undefined && input.reason !== null) {
    if (typeof input.reason !== 'string') throw err(422, 'AVAILABILITY_INVALID', 'reason must be a string');
    if (input.reason.length > 500) throw err(422, 'AVAILABILITY_INVALID', 'reason must be at most 500 characters');
    reason = input.reason;
  }
  const siblings = ((await prisma.availabilityException.findMany({ where: { ...ownerWhere(scope), date: exceptionDateUtc(v.date) } } as any)) as any[]).filter(() => true);
  checkExceptionDateConflicts({ startTime: v.startTime, endTime: v.endTime, type: v.type }, siblings);
  const created = await prisma.availabilityException.create({
    data: { ...ownerWhere(scope), date: exceptionDateUtc(v.date), startTime: v.startTime, endTime: v.endTime, type: v.type, reason },
  } as any);
  await writeAudit({ actorUserId: authUserId, action: 'AVAILABILITY_EXCEPTION_CREATED', entityType: 'availability_exception', entityId: (created as any).id, after: toExceptionDTO(created), ip: ctx?.ip, userAgent: ctx?.userAgent });
  const conflicts = await findConflictsForDate(authUserId, scope, v.date);
  return { exception: toExceptionDTO(created), timezone: scope.timezone, conflicts };
}

export async function updateException(authUserId: string, exceptionId: string, input: { date?: unknown; startTime?: unknown; endTime?: unknown; kind?: unknown; reason?: unknown; businessUnitId?: string | null }, ctx?: { ip?: string; userAgent?: string }) {
  if (!exceptionId) throw err(422, 'VALIDATION_ERROR', 'Exception id required');
  const scope = await resolveScope(authUserId, input.businessUnitId ?? null);
  const existing = await prisma.availabilityException.findUnique({ where: { id: exceptionId } } as any);
  if (!existing) throw err(404, 'AVAILABILITY_NOT_FOUND', 'Availability exception not found');
  assertOwnership(existing, scope);

  // Allowlist: date/startTime/endTime/kind/reason only.
  const cur = toExceptionDTO(existing);
  const merged: any = {
    date: input.date === undefined ? cur.date : input.date,
    kind: input.kind === undefined ? cur.kind : input.kind,
    reason: input.reason === undefined ? cur.reason : input.reason,
  };
  // Times: explicit null clears to full-day; undefined keeps current.
  if (input.startTime === undefined && input.endTime === undefined) {
    if (cur.kind !== 'FULL_DAY') {
      merged.startTime = cur.startTime;
      merged.endTime = cur.endTime;
    }
  } else {
    merged.startTime = input.startTime === undefined ? cur.startTime : input.startTime;
    merged.endTime = input.endTime === undefined ? cur.endTime : input.endTime;
    if (merged.startTime == null && merged.endTime == null && merged.kind !== 'FULL_DAY' && cur.kind !== 'FULL_DAY') merged.kind = 'FULL_DAY';
  }
  const v = validateExceptionInput(merged);
  let reason: string | null = null;
  if (merged.reason !== undefined && merged.reason !== null) {
    if (typeof merged.reason !== 'string') throw err(422, 'AVAILABILITY_INVALID', 'reason must be a string');
    if (merged.reason.length > 500) throw err(422, 'AVAILABILITY_INVALID', 'reason must be at most 500 characters');
    reason = merged.reason;
  }
  const siblings = ((await prisma.availabilityException.findMany({ where: { ...ownerWhere(scope), date: exceptionDateUtc(v.date) } } as any)) as any[]).filter((s) => s.id !== exceptionId);
  checkExceptionDateConflicts({ startTime: v.startTime, endTime: v.endTime, type: v.type }, siblings);

  const before = toExceptionDTO(existing);
  const updated = await prisma.availabilityException.update({
    where: { id: exceptionId },
    data: { date: exceptionDateUtc(v.date), startTime: v.startTime, endTime: v.endTime, type: v.type, reason },
  } as any);
  await writeAudit({ actorUserId: authUserId, action: 'AVAILABILITY_EXCEPTION_UPDATED', entityType: 'availability_exception', entityId: exceptionId, before, after: toExceptionDTO(updated), ip: ctx?.ip, userAgent: ctx?.userAgent });
  const conflicts = await findConflictsForDate(authUserId, scope, v.date);
  return { exception: toExceptionDTO(updated), timezone: scope.timezone, conflicts };
}

export async function deleteException(authUserId: string, exceptionId: string, businessUnitId?: string | null, ctx?: { ip?: string; userAgent?: string }) {
  if (!exceptionId) throw err(422, 'VALIDATION_ERROR', 'Exception id required');
  const scope = await resolveScope(authUserId, businessUnitId);
  const existing = await prisma.availabilityException.findUnique({ where: { id: exceptionId } } as any);
  if (!existing) throw err(404, 'AVAILABILITY_NOT_FOUND', 'Availability exception not found');
  assertOwnership(existing, scope);
  const before = toExceptionDTO(existing);
  await prisma.availabilityException.delete({ where: { id: exceptionId } } as any);
  await writeAudit({ actorUserId: authUserId, action: 'AVAILABILITY_EXCEPTION_REMOVED', entityType: 'availability_exception', entityId: exceptionId, before, ip: ctx?.ip, userAgent: ctx?.userAgent });
  return { removed: exceptionId, timezone: scope.timezone, conflicts: [] as unknown[] };
}

// ── Timezone ──────────────────────────────────────────────────────

export async function getTimezone(authUserId: string) {
  const profile = await resolveOwnProfile(authUserId);
  return { timezone: resolveTimezone((profile as any).timezone ?? DEFAULT_TIMEZONE) };
}

export async function updateTimezone(authUserId: string, timezone: unknown, ctx?: { ip?: string; userAgent?: string }) {
  if (typeof timezone !== 'string' || !isValidTimezone(timezone)) {
    throw err(422, 'AVAILABILITY_INVALID', 'timezone must be a valid IANA timezone (e.g. Africa/Johannesburg)');
  }
  const profile = await resolveOwnProfile(authUserId);
  const before = { timezone: (profile as any).timezone };
  const updated = await prisma.providerProfile.update({ where: { id: (profile as any).id }, data: { timezone } } as any);
  // Keep stored rule timezones consistent with the authoritative profile timezone.
  try {
    await prisma.availabilityRule.updateMany({ where: { providerId: (profile as any).id }, data: { timezone } } as any);
  } catch {
    // Non-fatal: the engine resolves the profile timezone authoritatively.
  }
  await writeAudit({ actorUserId: authUserId, action: 'AVAILABILITY_TIMEZONE_UPDATED', entityType: 'provider_profile', entityId: (profile as any).id, before, after: { timezone }, ip: ctx?.ip, userAgent: ctx?.userAgent });
  return { timezone: (updated as any).timezone as string };
}

// ── Combined view ─────────────────────────────────────────────────

export async function getSchedule(authUserId: string, businessUnitId?: string | null) {
  const scope = await resolveScope(authUserId, businessUnitId);
  const rules = (await prisma.availabilityRule.findMany({ where: ownerWhere(scope), orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }] } as any)) as any[];
  const now = new Date();
  const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  let exceptions: any[] = [];
  try {
    exceptions = (await prisma.availabilityException.findMany({ where: { ...ownerWhere(scope), date: { gte: todayUtc } }, orderBy: { date: 'asc' }, take: MAX_UPCOMING_EXCEPTIONS } as any)) as any[];
  } catch {
    exceptions = [];
  }
  return {
    timezone: scope.timezone,
    tierCode: scope.tierCode,
    providerType: scope.providerType,
    businessUnitId: scope.businessUnitId,
    rules: rules.map(toRuleDTO),
    exceptions: exceptions.map(toExceptionDTO),
  };
}

// ── Conflict detection (warnings only — never mutates bookings) ───

export interface ScheduleConflict {
  bookingId: string;
  scheduledStart: string;
  scheduledEnd: string;
  date: string;
  reason: string;
}

function bookingWallMinutes(scheduledStart: Date, scheduledEnd: Date, timezone: string): { date: string; startMin: number; endMin: number } {
  const date = getLocalDateStr(scheduledStart, timezone);
  const dtf = new Intl.DateTimeFormat('en-GB', { timeZone: resolveTimezone(timezone), hour: '2-digit', minute: '2-digit', hour12: false });
  const toMin = (d: Date): number => {
    const parts = dtf.formatToParts(d);
    const get = (t: string): string => parts.find((p) => p.type === t)?.value ?? '00';
    return Number(get('hour')) * 60 + Number(get('minute'));
  };
  return { date, startMin: toMin(scheduledStart), endMin: toMin(scheduledEnd) };
}

function bookingViolatesSchedule(
  wall: { date: string; startMin: number; endMin: number },
  dayRules: Array<{ startMin: number; endMin: number }>,
  exceptionsForDate: any[],
): string | null {
  const fullDayClosed = exceptionsForDate.some((e) => e.type === 'UNAVAILABLE' && !e.startTime && !e.endTime);
  if (fullDayClosed) return 'Date is now fully closed';
  const custom = exceptionsForDate.find((e) => e.type === 'CUSTOM_HOURS' && e.startTime && e.endTime);
  const windows = custom
    ? [{ startMin: parseTimeToMinutes(custom.startTime)!, endMin: parseTimeToMinutes(custom.endTime)! }]
    : dayRules;
  if (windows.length === 0) return 'No working hours cover this booking anymore';
  const contained = windows.some((w) => wall.startMin >= w.startMin && wall.endMin <= w.endMin);
  if (!contained) return custom ? 'Booking falls outside special hours' : 'Booking falls outside working hours';
  for (const e of exceptionsForDate) {
    if (e.type === 'UNAVAILABLE' && e.startTime && e.endTime) {
      const s = parseTimeToMinutes(e.startTime);
      const en = parseTimeToMinutes(e.endTime);
      if (s != null && en != null && rangesOverlap(wall.startMin, wall.endMin, s, en)) {
        return 'Booking overlaps a blocked period';
      }
    }
  }
  return null;
}

async function loadUpcomingBookings(scope: OwnerScope): Promise<any[]> {
  try {
    return (await prisma.booking.findMany({
      where: { providerId: scope.providerId, businessUnitId: scope.businessUnitId ?? undefined, status: { in: [...BLOCKING_BOOKING_STATUSES] as any }, scheduledStart: { gte: new Date() } },
      orderBy: { scheduledStart: 'asc' },
      take: MAX_CONFLICT_SCAN,
      select: { id: true, scheduledStart: true, scheduledEnd: true, status: true },
    } as any)) as any[];
  } catch {
    return [];
  }
}

async function loadScheduleState(scope: OwnerScope): Promise<{ rulesByDay: Map<number, Array<{ startMin: number; endMin: number }>>; exceptionsByDate: Map<string, any[]> }> {
  const rules = ((await prisma.availabilityRule.findMany({ where: { ...ownerWhere(scope), isActive: true } } as any)) as any[]) ?? [];
  const rulesByDay = new Map<number, Array<{ startMin: number; endMin: number }>>();
  for (const r of rules) {
    const s = parseTimeToMinutes(r.startTime);
    const e = parseTimeToMinutes(r.endTime);
    if (s == null || e == null || e <= s) continue;
    const arr = rulesByDay.get(r.dayOfWeek) ?? [];
    arr.push({ startMin: s, endMin: e });
    rulesByDay.set(r.dayOfWeek, arr);
  }
  let exceptions: any[] = [];
  try {
    const now = new Date();
    const todayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    exceptions = ((await prisma.availabilityException.findMany({ where: { ...ownerWhere(scope), date: { gte: todayUtc } }, take: MAX_UPCOMING_EXCEPTIONS } as any)) as any[]) ?? [];
  } catch {
    exceptions = [];
  }
  const exceptionsByDate = new Map<string, any[]>();
  for (const e of exceptions) {
    const key = toExceptionDTO(e).date;
    const arr = exceptionsByDate.get(key) ?? [];
    arr.push(e);
    exceptionsByDate.set(key, arr);
  }
  return { rulesByDay, exceptionsByDate };
}

export async function findConflicts(authUserId: string, scope?: OwnerScope): Promise<ScheduleConflict[]> {
  const resolved = scope ?? (await resolveScope(authUserId));
  const { rulesByDay, exceptionsByDate } = await loadScheduleState(resolved);
  const bookings = await loadUpcomingBookings(resolved);
  const out: ScheduleConflict[] = [];
  for (const b of bookings) {
    const start = new Date(b.scheduledStart);
    const end = new Date(b.scheduledEnd);
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) continue;
    const wall = bookingWallMinutes(start, end, resolved.timezone);
    const dow = new Date(`${wall.date}T12:00:00Z`).getUTCDay();
    const reason = bookingViolatesSchedule(wall, rulesByDay.get(dow) ?? [], exceptionsByDate.get(wall.date) ?? []);
    if (reason) {
      out.push({ bookingId: b.id as string, scheduledStart: start.toISOString(), scheduledEnd: end.toISOString(), date: wall.date, reason });
    }
  }
  return out;
}

export async function findConflictsForDate(authUserId: string, scope: OwnerScope, date: string): Promise<ScheduleConflict[]> {
  const all = await findConflicts(authUserId, scope);
  return all.filter((c) => c.date === date);
}

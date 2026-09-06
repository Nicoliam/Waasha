import { describe, it, expect } from 'vitest';
import {
  groupRulesByDay,
  validateWindow,
  findOverlap,
  validateExceptionDate,
  exceptionLabel,
  conflictMessage,
  offlineBlockedMessage,
  apiErrorMessage,
  isValidTime,
  dayName,
} from './provider-availability.utils';

function rule(over: any = {}) {
  return {
    id: 'r1',
    dayOfWeek: 1,
    dayName: 'Monday',
    startTime: '08:00',
    endTime: '12:00',
    timezone: 'Africa/Johannesburg',
    isActive: true,
    businessUnitId: null,
    ...over,
  };
}

describe('provider-availability utils', () => {
  it('maps rules into seven day groups sorted by start', () => {
    const groups = groupRulesByDay([rule({ startTime: '13:00', endTime: '17:00', id: 'b' }), rule({ startTime: '08:00', endTime: '12:00', id: 'a' })]);
    expect(groups).toHaveLength(7);
    expect(groups[1].map((r) => r.id)).toEqual(['a', 'b']);
    expect(groups[0]).toEqual([]);
  });

  it('ignores out-of-range days when grouping', () => {
    const groups = groupRulesByDay([rule({ dayOfWeek: 9 })]);
    expect(groups.flat()).toHaveLength(0);
  });

  it('validates windows: day, format, and range', () => {
    expect(validateWindow(1, '08:00', '12:00')).toBeNull();
    expect(validateWindow(7, '08:00', '12:00')).toContain('day');
    expect(validateWindow(1, '8am', '12:00')).toContain('HH:mm');
    expect(validateWindow(1, '12:00', '08:00')).toContain('after start');
    expect(validateWindow(1, '08:00', '08:00')).toContain('after start');
  });

  it('detects overlapping windows but ignores self', () => {
    const siblings = [{ id: 'a', startTime: '08:00', endTime: '12:00' }];
    expect(findOverlap(siblings, { startTime: '11:00', endTime: '14:00' })).toBe(true);
    expect(findOverlap(siblings, { startTime: '12:00', endTime: '14:00' })).toBe(false);
    expect(findOverlap(siblings, { id: 'a', startTime: '09:00', endTime: '10:00' })).toBe(false);
  });

  it('validates exception dates as real calendar dates', () => {
    expect(validateExceptionDate('2026-12-25')).toBeNull();
    expect(validateExceptionDate('25-12-2026')).not.toBeNull();
    expect(validateExceptionDate('2026-02-30')).not.toBeNull();
  });

  it('labels full-day, blocked, and special-hours exceptions', () => {
    expect(exceptionLabel({ id: 'e', date: '2026-12-25', startTime: null, endTime: null, kind: 'FULL_DAY', type: 'UNAVAILABLE', reason: null })).toContain('closed all day');
    expect(exceptionLabel({ id: 'e', date: '2026-12-24', startTime: '14:00', endTime: '17:00', kind: 'BLOCKED', type: 'UNAVAILABLE', reason: null })).toContain('blocked');
    expect(exceptionLabel({ id: 'e', date: '2026-12-24', startTime: '08:00', endTime: '12:00', kind: 'CUSTOM_HOURS', type: 'CUSTOM_HOURS', reason: null })).toContain('only');
  });

  it('explains conflicts without implying automatic cancellation', () => {
    const msg = conflictMessage({ bookingId: 'bk-1', scheduledStart: 'x', scheduledEnd: 'y', date: '2026-12-25', reason: 'Date is now fully closed' });
    expect(msg).toContain('bk-1');
    expect(msg).toContain('kept as-is');
    expect(msg).not.toMatch(/cancel/i);
  });

  it('offline message never claims the mutation succeeded', () => {
    const msg = offlineBlockedMessage();
    expect(msg).toMatch(/offline/i);
    expect(msg).not.toMatch(/has been saved|was saved|saved successfully|confirmed\./i);
  });

  it('parses API errors with code and unauthorized flag', () => {
    const { message, unauthorized } = apiErrorMessage({ error: { code: 'AVAILABILITY_CONFLICT', message: 'Overlap' } });
    expect(message).toContain('AVAILABILITY_CONFLICT');
    expect(unauthorized).toBe(false);
    expect(apiErrorMessage({ status: 401 }).unauthorized).toBe(true);
  });

  it('validates HH:mm strictly and names days', () => {
    expect(isValidTime('08:00')).toBe(true);
    expect(isValidTime('24:00')).toBe(false);
    expect(isValidTime('8:00')).toBe(false);
    expect(dayName(1)).toBe('Monday');
    expect(dayName(0)).toBe('Sunday');
  });
});

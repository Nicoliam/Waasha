import { describe, it, expect } from 'vitest';
import {
  groupOf,
  filterByGroup,
  isLocationAuthorized,
  statusLabel,
  paymentLabel,
  navigationUrls,
  cashChangeText,
  ProviderBookingSummary,
} from './provider-bookings.utils';

function summary(over: Partial<ProviderBookingSummary> = {}): ProviderBookingSummary {
  return {
    id: 'b1',
    reference: 'ref-1',
    status: 'PENDING',
    paymentStatus: 'PENDING',
    paymentMethod: null,
    serviceName: 'Fade',
    scheduledStart: new Date().toISOString(),
    scheduledEnd: new Date().toISOString(),
    durationMinutes: 30,
    totalAmount: 200,
    currency: 'ZAR',
    createdAt: new Date().toISOString(),
    ...over,
  };
}

describe('provider booking inbox grouping', () => {
  it('maps lifecycle statuses to inbox groups without inventing statuses', () => {
    expect(groupOf('PENDING')).toBe('incoming');
    expect(groupOf('ACCEPTED')).toBe('accepted');
    expect(groupOf('CONFIRMED')).toBe('accepted');
    expect(groupOf('DECLINED')).toBe('rejected');
    expect(groupOf('CANCELLED')).toBe('rejected');
    expect(groupOf('COMPLETED')).toBe('completed');
  });

  it('filters bookings per group and passes all through untouched', () => {
    const all = [summary({ id: 'p', status: 'PENDING' }), summary({ id: 'a', status: 'ACCEPTED' }), summary({ id: 'd', status: 'DECLINED' })];
    expect(filterByGroup(all, 'incoming').map((b) => b.id)).toEqual(['p']);
    expect(filterByGroup(all, 'accepted').map((b) => b.id)).toEqual(['a']);
    expect(filterByGroup(all, 'rejected').map((b) => b.id)).toEqual(['d']);
    expect(filterByGroup(all, 'all')).toHaveLength(3);
  });
});

describe('location authorization boundary', () => {
  it('hides precise location while PENDING, reveals once ACCEPTED or later', () => {
    expect(isLocationAuthorized('PENDING')).toBe(false);
    expect(isLocationAuthorized('ACCEPTED')).toBe(true);
    expect(isLocationAuthorized('CONFIRMED')).toBe(true);
    expect(isLocationAuthorized('COMPLETED')).toBe(true);
    expect(isLocationAuthorized('DECLINED')).toBe(false);
  });
});

describe('labels', () => {
  it('renders human status and payment labels', () => {
    expect(statusLabel('PENDING')).toBe('Pending review');
    expect(statusLabel('DECLINED')).toBe('Declined');
    expect(paymentLabel('cash', 'PAID')).toBe('Cash • PAID');
    expect(paymentLabel('waasha_payment', 'PROCESSING')).toBe('Waasha Payment • PROCESSING');
    expect(paymentLabel(null, 'PENDING')).toBe('Not set • PENDING');
  });
});

describe('navigation deep links', () => {
  it('opens the installed navigation app without a new location endpoint', () => {
    const links = navigationUrls(-26.2, 28.0);
    expect(links.googleMapsUrl).toContain('google.com/maps');
    expect(links.googleMapsUrl).toContain(encodeURIComponent('-26.2,28'));
    expect(links.appleMapsUrl).toContain('maps.apple.com');
  });
});

describe('cash messaging', () => {
  it('never claims Waasha guarantees physical change', () => {
    expect(cashChangeText(false, null)).toBeNull();
    const text = cashChangeText(true, 50);
    expect(text).toContain('R50');
    expect(text).not.toMatch(/guarantee/i);
  });
});

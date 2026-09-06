import { describe, it, expect } from 'vitest';
import {
  groupOf,
  filterByGroup,
  isLocationAuthorized,
  providerDisplayName,
  statusLabel,
  paymentMethodLabel,
  bookingVsPaymentText,
  cashChangeText,
  locationSummaryText,
  CustomerBookingSummary,
} from './customer-bookings.utils';

function summary(over: Partial<CustomerBookingSummary> = {}): CustomerBookingSummary {
  return {
    id: 'b1',
    reference: 'ref-1',
    status: 'PENDING',
    serviceName: 'Fade',
    providerName: 'Sharp Cuts',
    businessName: null,
    scheduledStart: new Date().toISOString(),
    scheduledEnd: new Date().toISOString(),
    totalAmount: 200,
    currency: 'ZAR',
    paymentMethod: null,
    paymentStatus: 'PENDING',
    locationSummary: 'Johannesburg, Gauteng',
    createdAt: new Date().toISOString(),
    ...over,
  };
}

describe('customer inbox grouping (canonical lifecycle only)', () => {
  it('maps every canonical status to its group without inventing states', () => {
    expect(groupOf('PENDING')).toBe('upcoming');
    expect(groupOf('ACCEPTED')).toBe('accepted');
    expect(groupOf('CONFIRMED')).toBe('accepted');
    expect(groupOf('IN_PROGRESS')).toBe('active');
    expect(groupOf('COMPLETED')).toBe('completed');
    expect(groupOf('DECLINED')).toBe('declined');
    expect(groupOf('CANCELLED')).toBe('cancelled');
  });

  it('filters per group and passes all through untouched', () => {
    const all = [summary({ id: 'u', status: 'PENDING' }), summary({ id: 'a', status: 'ACCEPTED' })];
    expect(filterByGroup(all, 'upcoming').map((b) => b.id)).toEqual(['u']);
    expect(filterByGroup(all, 'all')).toHaveLength(2);
  });

  it('prefers the business name for T3 bookings', () => {
    expect(providerDisplayName({ providerName: 'Sam', businessName: 'Sandton Branch' })).toBe('Sandton Branch');
    expect(providerDisplayName({ providerName: 'Sam', businessName: null })).toBe('Sam');
  });
});

describe('booking vs payment separation', () => {
  it('always renders both states as separate facts', () => {
    expect(bookingVsPaymentText('PENDING', null, 'PENDING')).toBe('Pending provider review • Not set PENDING');
    expect(bookingVsPaymentText('ACCEPTED', 'cash', 'PAID')).toBe('Accepted • Cash PAID');
    expect(statusLabel('IN_PROGRESS')).toBe('In progress');
    expect(paymentMethodLabel('waasha_payment')).toBe('Waasha Payment');
  });
});

describe('location boundary + cash messaging', () => {
  it('protects precise location until the lifecycle authorizes it', () => {
    expect(isLocationAuthorized('PENDING')).toBe(false);
    expect(isLocationAuthorized('ACCEPTED')).toBe(true);
    expect(isLocationAuthorized('COMPLETED')).toBe(true);
    expect(locationSummaryText('Johannesburg, Gauteng', false)).toContain('once accepted');
    expect(locationSummaryText('Johannesburg, Gauteng', true)).toBe('Johannesburg, Gauteng');
  });

  it('never claims Waasha guarantees physical change', () => {
    expect(cashChangeText(false, null)).toBeNull();
    const text = cashChangeText(true, 50);
    expect(text).toContain('R50');
    expect(text).toContain('provider has been notified');
    expect(text).not.toMatch(/guarantee/i);
  });
});

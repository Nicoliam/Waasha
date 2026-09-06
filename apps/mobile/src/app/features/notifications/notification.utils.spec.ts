import { describe, it, expect } from 'vitest';
import {
  isUnread,
  routeFor,
  typeLabel,
  categoryOf,
  unreadCountOf,
  applyMarkRead,
  applyMarkAllRead,
  NotificationItem,
} from './notification.utils';

function item(over: Partial<NotificationItem> = {}): NotificationItem {
  return {
    id: 'n1',
    type: 'BOOKING_ACCEPTED',
    audience: 'CUSTOMER',
    channel: 'IN_APP',
    status: 'UNREAD',
    title: 'Booking accepted',
    message: 'Sharp Cuts accepted your booking for Fade.',
    entityType: 'booking',
    entityId: 'bk-1',
    deepLink: '/bookings/bk-1',
    readAt: null,
    createdAt: new Date().toISOString(),
    ...over,
  };
}

describe('notification read state', () => {
  it('detects unread and counts badges', () => {
    expect(isUnread(item())).toBe(true);
    expect(isUnread(item({ status: 'READ' }))).toBe(false);
    expect(unreadCountOf([item(), item({ id: 'n2', status: 'READ' })])).toBe(1);
  });

  it('applies mark-read transitions locally only after server confirmation', () => {
    const list = [item(), item({ id: 'n2' })];
    const one = applyMarkRead(list, 'n1');
    expect(one[0].status).toBe('READ');
    expect(one[0].readAt).not.toBeNull();
    expect(one[1].status).toBe('UNREAD');
    const all = applyMarkAllRead(list);
    expect(all.every((n) => n.status === 'READ')).toBe(true);
  });
});

describe('booking deep links', () => {
  it('routes customers and providers to their own authorized detail screens', () => {
    expect(routeFor(item())).toEqual(['/', 'bookings', 'bk-1']);
    expect(routeFor(item({ deepLink: '/provider/bookings/bk-1' }))).toEqual(['/', 'provider', 'bookings', 'bk-1']);
    expect(routeFor(item({ deepLink: null }))).toBeNull();
  });
});

describe('labels and categories', () => {
  it('renders human labels without inventing types', () => {
    expect(typeLabel('BOOKING_ACCEPTED')).toBe('Accepted');
    expect(typeLabel('PAYMENT_EFT_PENDING')).toBe('EFT pending');
    expect(categoryOf('BOOKING_ACCEPTED')).toBe('booking');
    expect(categoryOf('PAYMENT_FAILED')).toBe('payment');
  });
});

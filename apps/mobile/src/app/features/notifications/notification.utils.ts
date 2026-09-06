/**
 * Slice 7 — Notification presentation helpers (framework-free, TestBed-free).
 * Bodies are plain text; clients must render them as text, never HTML.
 */

export interface NotificationItem {
  id: string;
  type: string;
  audience: string;
  channel: string;
  status: string;
  title: string;
  message: string;
  entityType: string | null;
  entityId: string | null;
  deepLink: string | null;
  readAt: string | null;
  createdAt: string;
}

export function isUnread(n: { status: string }): boolean {
  return (n.status ?? '').toUpperCase() === 'UNREAD';
}

/** Route array for click-through; null when there is no authorized target. */
export function routeFor(n: { deepLink: string | null }): string[] | null {
  if (!n.deepLink) return null;
  const parts = n.deepLink.split('/').filter(Boolean);
  return parts.length > 0 ? ['/', ...parts] : null;
}

export function typeLabel(type: string): string {
  const labels: Record<string, string> = {
    BOOKING_CREATED: 'Booking submitted',
    NEW_BOOKING_REQUEST: 'New request',
    BOOKING_ACCEPTED: 'Accepted',
    BOOKING_DECLINED: 'Declined',
    PAYMENT_PAID: 'Payment received',
    PAYMENT_FAILED: 'Payment failed',
    PAYMENT_EFT_PENDING: 'EFT pending',
    CASH_RECORDED: 'Cash recorded',
  };
  return labels[(type ?? '').toUpperCase()] ?? type;
}

/** Short category badge for grouping in the list. */
export function categoryOf(type: string): 'booking' | 'payment' | 'other' {
  const t = (type ?? '').toUpperCase();
  if (t.startsWith('BOOKING_') || t === 'NEW_BOOKING_REQUEST' || t === 'CASH_RECORDED') return 'booking';
  if (t.startsWith('PAYMENT_')) return 'payment';
  return 'other';
}

export function unreadCountOf(notifications: Array<{ status: string }>): number {
  return notifications.filter(isUnread).length;
}

export function applyMarkRead(notifications: NotificationItem[], id: string): NotificationItem[] {
  return notifications.map((n) => (n.id === id ? { ...n, status: 'READ', readAt: new Date().toISOString() } : n));
}

export function applyMarkAllRead(notifications: NotificationItem[]): NotificationItem[] {
  return notifications.map((n) => (isUnread(n) ? { ...n, status: 'READ', readAt: new Date().toISOString() } : n));
}

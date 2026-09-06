/**
 * Slice 6 — Customer booking presentation helpers.
 *
 * Framework-free pure functions, unit testable without Angular TestBed.
 * Grouping mirrors CUSTOMER_INBOX_GROUPS in customer-bookings.service.ts;
 * no lifecycle state is invented for UI convenience. All data shown here is
 * server-authoritative (`source: 'server'`); there is no offline write path,
 * so the UI must never claim a transition succeeded without a server reply.
 */

export type CustomerInboxFilter = 'upcoming' | 'accepted' | 'active' | 'completed' | 'declined' | 'cancelled' | 'all';

export const CUSTOMER_GROUP_STATUSES: Record<Exclude<CustomerInboxFilter, 'all'>, string[]> = {
  upcoming: ['PENDING'],
  accepted: ['ACCEPTED', 'CONFIRMED'],
  active: ['IN_PROGRESS'],
  completed: ['COMPLETED'],
  declined: ['DECLINED'],
  cancelled: ['CANCELLED'],
};

export const CUSTOMER_LOCATION_AUTHORIZED_STATUSES = ['ACCEPTED', 'CONFIRMED', 'PAID', 'IN_PROGRESS', 'COMPLETED'];

export interface CustomerBookingSummary {
  id: string;
  reference: string;
  status: string;
  serviceName: string | null;
  providerName: string | null;
  businessName: string | null;
  scheduledStart: string;
  scheduledEnd: string;
  totalAmount: number;
  currency: string;
  paymentMethod: string | null;
  paymentStatus: string;
  locationSummary: string | null;
  createdAt: string;
}

/** Display name for the provider side: business unit wins over individual. */
export function providerDisplayName(b: { providerName: string | null; businessName: string | null }): string {
  return b.businessName ?? b.providerName ?? 'Provider';
}

export function groupOf(status: string): Exclude<CustomerInboxFilter, 'all'> | 'other' {
  const upper = (status ?? '').toUpperCase();
  for (const [group, statuses] of Object.entries(CUSTOMER_GROUP_STATUSES)) {
    if (statuses.includes(upper)) return group as Exclude<CustomerInboxFilter, 'all'>;
  }
  return 'other';
}

export function filterByGroup(bookings: CustomerBookingSummary[], group: CustomerInboxFilter): CustomerBookingSummary[] {
  if (group === 'all') return bookings;
  const statuses = CUSTOMER_GROUP_STATUSES[group];
  return bookings.filter((b) => statuses.includes((b.status ?? '').toUpperCase()));
}

export function isLocationAuthorized(status: string): boolean {
  return CUSTOMER_LOCATION_AUTHORIZED_STATUSES.includes((status ?? '').toUpperCase());
}

export function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    PENDING: 'Pending provider review',
    ACCEPTED: 'Accepted',
    CONFIRMED: 'Confirmed',
    IN_PROGRESS: 'In progress',
    COMPLETED: 'Completed',
    DECLINED: 'Declined',
    CANCELLED: 'Cancelled',
  };
  return labels[(status ?? '').toUpperCase()] ?? status;
}

export function paymentMethodLabel(method: string | null): string {
  const m = (method ?? '').toLowerCase();
  if (m === 'cash') return 'Cash';
  if (m === 'eft') return 'EFT';
  if (m === 'waasha_payment') return 'Waasha Payment';
  return 'Not set';
}

/** Booking status and payment status are always rendered as separate facts. */
export function bookingVsPaymentText(status: string, method: string | null, paymentStatus: string): string {
  return `${statusLabel(status)} • ${paymentMethodLabel(method)} ${paymentStatus}`;
}

/** Cash-change helper text. Waasha never claims to guarantee physical change. */
export function cashChangeText(changeRequested: boolean, changeAmount: number | null): string | null {
  if (!changeRequested) return null;
  if (changeAmount == null) return 'Cash change requested — provider has been notified.';
  return `Cash change requested — provider has been notified to bring R${changeAmount} change.`;
}

/** City-level summary while precise location is still protected. */
export function locationSummaryText(locationSummary: string | null, authorized: boolean): string {
  if (authorized) return locationSummary ?? '—';
  return locationSummary ? `${locationSummary} (exact address available once accepted)` : 'Location protected until accepted';
}

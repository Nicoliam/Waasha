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

/**
 * Slice 12 — Client-side eligibility hints for customer booking actions.
 * These mirror the server's cancellable/reschedulable states for display
 * only. The server remains authoritative: actions are shown only as hints
 * and every mutation result comes from the backend.
 */
export const CUSTOMER_CANCELLABLE_STATUSES = ['PENDING', 'ACCEPTED', 'CONFIRMED', 'PAYMENT_PENDING', 'PAID'];

export const CUSTOMER_RESCHEDULABLE_STATUSES = ['PENDING', 'ACCEPTED', 'CONFIRMED', 'PAYMENT_PENDING', 'PAID'];

/** Display hint only — the server decides. Hides actions for terminal/passed bookings. */
export function canCancelBooking(status: string): boolean {
  return CUSTOMER_CANCELLABLE_STATUSES.includes((status ?? '').toUpperCase());
}

/** Display hint only — the server decides. */
export function canRescheduleBooking(status: string): boolean {
  return CUSTOMER_RESCHEDULABLE_STATUSES.includes((status ?? '').toUpperCase());
}

/**
 * Slice 13 — Client-side review hint. Only COMPLETED bookings expose
 * "Leave a Review". Display only — the server derives eligibility and
 * rejects reviews for pending/accepted/declined/cancelled bookings.
 */
export function canReviewBooking(status: string): boolean {
  return (status ?? '').toUpperCase() === 'COMPLETED';
}

/** Allowed star ratings (1–5). The server validates; this is display only. */
export const REVIEW_RATINGS = [1, 2, 3, 4, 5];

/** Client-side rating check for immediate feedback; the server re-validates. */
export function isValidRating(rating: unknown): boolean {
  return typeof rating === 'number' && Number.isInteger(rating) && rating >= 1 && rating <= 5;
}

export type CustomerBookingActionError =
  | 'unauthorized'
  | 'not-found'
  | 'invalid-state'
  | 'window-closed'
  | 'conflict'
  | 'validation'
  | 'offline'
  | 'server';

/** Maps server error codes/status to UI-safe messages (never leaks internals). */
export function interpretActionError(err: any): { kind: CustomerBookingActionError; message: string } {
  const status = err?.status;
  const code = err?.error?.error?.code ?? err?.error?.code;
  if (status === 0 || err?.message === 'OFFLINE') {
    return { kind: 'offline', message: 'You appear to be offline. This action needs a connection — nothing was changed. Please reconnect and retry.' };
  }
  if (status === 401 || status === 403) {
    return { kind: 'unauthorized', message: 'Please log in to manage your booking.' };
  }
  if (status === 404) {
    return { kind: 'not-found', message: 'This booking does not exist or does not belong to your account.' };
  }
  if (code === 'REVIEW_ALREADY_EXISTS') {
    return { kind: 'conflict', message: 'You have already reviewed this booking. Each completed service can be reviewed once.' };
  }
  if (code === 'REVIEW_NOT_ELIGIBLE') {
    return { kind: 'invalid-state', message: 'Only completed services can be reviewed.' };
  }
  if (status === 409 || code === 'SLOT_UNAVAILABLE' || code === 'BOOKING_CONFLICT') {
    return { kind: 'conflict', message: 'That time just became unavailable. Please choose another slot.' };
  }
  if (code === 'BOOKING_INVALID_STATE') {
    return { kind: 'invalid-state', message: 'This booking can no longer be changed in its current state.' };
  }
  if (code === 'BOOKING_CANCELLATION_WINDOW_CLOSED' || code === 'BOOKING_RESCHEDULE_WINDOW_CLOSED') {
    return { kind: 'window-closed', message: 'The change window for this booking has closed.' };
  }
  if (status === 422) {
    return { kind: 'validation', message: 'Please check your input and try again.' };
  }
  return { kind: 'server', message: 'Something went wrong. Nothing was changed — please try again.' };
}

/** Offline guard — mutations must never be queued as if confirmed. */
export function isOnline(): boolean {
  try {
    return typeof navigator === 'undefined' ? true : navigator.onLine !== false;
  } catch {
    return true;
  }
}

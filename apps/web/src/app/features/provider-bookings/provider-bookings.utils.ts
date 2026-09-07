/**
 * Slice 5 — Provider booking presentation helpers.
 *
 * Framework-free pure functions so booking inbox/detail logic is unit
 * testable without Angular TestBed. No business rules live here: grouping
 * mirrors the backend inbox groups, and location gating mirrors
 * LOCATION_AUTHORIZED_STATUSES in provider-bookings.service.ts.
 */

export type InboxGroup = 'incoming' | 'accepted' | 'rejected' | 'completed' | 'all';

export const INBOX_GROUP_STATUSES: Record<Exclude<InboxGroup, 'all'>, string[]> = {
  incoming: ['PENDING'],
  accepted: ['ACCEPTED', 'CONFIRMED'],
  rejected: ['DECLINED', 'CANCELLED'],
  completed: ['COMPLETED'],
};

export const LOCATION_AUTHORIZED_STATUSES = ['ACCEPTED', 'CONFIRMED', 'PAID', 'IN_PROGRESS', 'COMPLETED'];

export interface ProviderBookingSummary {
  id: string;
  reference: string;
  status: string;
  paymentStatus: string;
  paymentMethod: string | null;
  serviceName: string | null;
  scheduledStart: string;
  scheduledEnd: string;
  durationMinutes: number | null;
  totalAmount: number;
  currency: string;
  customer?: { displayName: string | null } | null;
  createdAt: string;
}

export function groupOf(status: string): Exclude<InboxGroup, 'all'> | 'other' {
  const upper = (status ?? '').toUpperCase();
  for (const [group, statuses] of Object.entries(INBOX_GROUP_STATUSES)) {
    if (statuses.includes(upper)) return group as Exclude<InboxGroup, 'all'>;
  }
  return 'other';
}

export function filterByGroup(bookings: ProviderBookingSummary[], group: InboxGroup): ProviderBookingSummary[] {
  if (group === 'all') return bookings;
  const statuses = INBOX_GROUP_STATUSES[group];
  return bookings.filter((b) => statuses.includes((b.status ?? '').toUpperCase()));
}

export function isLocationAuthorized(status: string): boolean {
  return LOCATION_AUTHORIZED_STATUSES.includes((status ?? '').toUpperCase());
}

export function statusLabel(status: string): string {
  const upper = (status ?? '').toUpperCase();
  const labels: Record<string, string> = {
    PENDING: 'Pending review',
    ACCEPTED: 'Accepted',
    CONFIRMED: 'Confirmed',
    DECLINED: 'Declined',
    CANCELLED: 'Cancelled',
    COMPLETED: 'Completed',
    IN_PROGRESS: 'In progress',
  };
  return labels[upper] ?? status;
}

export function paymentLabel(method: string | null, status: string): string {
  const m = (method ?? '').toLowerCase();
  const methodLabel = m === 'cash' ? 'Cash' : m === 'eft' ? 'EFT' : m === 'waasha_payment' ? 'Waasha Payment' : 'Not set';
  return `${methodLabel} • ${status}`;
}

export interface NavigationLinks {
  googleMapsUrl: string;
  appleMapsUrl: string;
}

/** Client-side deep links to the installed navigation app. No routing provider; no distance computation. */
export function navigationUrls(latitude: number, longitude: number): NavigationLinks {
  const dest = `${latitude},${longitude}`;
  return {
    googleMapsUrl: `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(dest)}`,
    appleMapsUrl: `http://maps.apple.com/?daddr=${encodeURIComponent(dest)}`,
  };
}

/** Cash-change helper text. Waasha never claims to guarantee physical change. */
export function cashChangeText(changeRequested: boolean, changeAmount: number | null): string | null {
  if (!changeRequested) return null;
  if (changeAmount == null) return 'Cash change requested — customer asked for change.';
  return `Cash change requested — customer asked for R${changeAmount} change.`;
}

/**
 * Slice 13 — Client-side completion hint. Only IN_PROGRESS bookings expose
 * "Mark Service Complete". Display only — the server remains authoritative
 * and rejects PENDING/ACCEPTED/DECLINED/CANCELLED completions.
 */
export function canCompleteBooking(status: string): boolean {
  return (status ?? '').toUpperCase() === 'IN_PROGRESS';
}

/** Offline guard — completion must never be queued as if confirmed. */
export function isOnline(): boolean {
  try {
    return typeof navigator === 'undefined' ? true : navigator.onLine !== false;
  } catch {
    return true;
  }
}

/**
 * Slice 15 — T2/T3 business-management view helpers (web).
 * Pure functions only: safe to unit-test without TestBed.
 * No business logic here — the server is authoritative for tiers,
 * ownership, finance and availability.
 */

export type TierCode = 'T1' | 'T2' | 'T3' | null;

export function tierLabel(tier: string | null | undefined): string {
  switch ((tier ?? '').toUpperCase()) {
    case 'T2':
      return 'T2 · Teams';
    case 'T3':
      return 'T3 · Business';
    case 'T1':
      return 'T1 · Individual';
    default:
      return 'Provider';
  }
}

export function canManageTeam(tier: string | null | undefined): boolean {
  return (tier ?? '').toUpperCase() === 'T2';
}

export function canManageBusiness(tier: string | null | undefined): boolean {
  return (tier ?? '').toUpperCase() === 'T3';
}

export function statusLabel(status: string | null | undefined): string {
  switch ((status ?? '').toUpperCase()) {
    case 'ACTIVE':
      return 'Active';
    case 'INACTIVE':
      return 'Inactive';
    case 'PENDING':
      return 'Pending';
    case 'ACCEPTED':
      return 'Accepted';
    case 'REVOKED':
      return 'Revoked';
    case 'EXPIRED':
      return 'Expired';
    default:
      return status || '—';
  }
}

export function roleLabel(role: string | null | undefined): string {
  switch ((role ?? '').toUpperCase()) {
    case 'OWNER':
      return 'Owner';
    case 'MANAGER':
      return 'Manager';
    case 'PROVIDER':
      return 'Provider';
    case 'STAFF':
      return 'Staff';
    default:
      return role || '—';
  }
}

export function isOfflineError(err: unknown): boolean {
  const msg = String((err as { message?: unknown })?.message ?? err ?? '');
  return msg === 'OFFLINE' || msg.toLowerCase().includes('offline');
}

export function offlineMessage(): string {
  return 'You are offline. Changes cannot be saved right now — nothing was changed and nothing was queued.';
}

export function mutationErrorMessage(err: unknown, fallback: string): string {
  if (isOfflineError(err)) return offlineMessage();
  const body = (err as { error?: { error?: { message?: string }; message?: string } })?.error;
  const msg = body?.error?.message ?? body?.message ?? (err as { message?: string })?.message;
  if (typeof msg === 'string' && msg.length > 0 && msg !== 'OFFLINE') return msg;
  return fallback;
}

export function invitationExpiryLabel(expiresAt: string | null | undefined): string {
  if (!expiresAt) return '—';
  const t = new Date(expiresAt).getTime();
  if (!Number.isFinite(t)) return '—';
  const days = Math.max(0, Math.ceil((t - Date.now()) / (24 * 60 * 60 * 1000)));
  if (days <= 0) return 'Expired';
  return `Expires in ${days} day${days === 1 ? '' : 's'}`;
}

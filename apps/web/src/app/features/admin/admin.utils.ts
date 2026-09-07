/**
 * Slice 16 — shared admin UI helpers (web).
 * Operational formatting only; all authorization stays server-side.
 */

export function adminErrorMessage(err: any): string {
  const code = err?.error?.error?.code ?? err?.error?.code;
  const msg = err?.error?.error?.message ?? err?.error?.message ?? err?.message;
  if (code === 'FORBIDDEN') return 'Admin privileges required. This action was denied by the server.';
  if (code === 'UNAUTHORIZED') return 'Session expired. Please log in again.';
  if (code === 'SETTING_CONFLICT') return 'Another admin changed this setting. Reload and retry.';
  if (typeof msg === 'string' && msg.length > 0 && msg.length < 300) return msg;
  return "Couldn't complete the admin action. Please retry.";
}

export function pageList<T>(total: number, perPage: number): number[] {
  const pages = Math.max(1, Math.ceil(total / Math.max(1, perPage)));
  return Array.from({ length: Math.min(pages, 20) }, (_, i) => i + 1);
}

export function money(value: unknown): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return 'R0.00';
  return `R${n.toFixed(2)}`;
}

export function shortDate(value: unknown): string {
  if (!value) return '—';
  const d = new Date(String(value));
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString();
}

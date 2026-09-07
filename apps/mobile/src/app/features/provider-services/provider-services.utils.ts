/**
 * Slice 9 — Provider service catalogue presentation helpers.
 *
 * Framework-free pure functions so list mapping, editor validation, and
 * state messaging are unit testable without Angular TestBed. No business
 * rules live here: limits (max 3 images, ZAR, duration bounds) mirror the
 * backend catalogue service, which remains authoritative.
 */

export const MAX_SERVICE_IMAGES = 3;
export const SUPPORTED_CURRENCIES = ['ZAR'];
export const SERVICE_MODES = ['PROVIDER_LOCATION', 'CUSTOMER_LOCATION', 'BOTH'];
export const MAX_NAME_LENGTH = 120;
export const MAX_DESCRIPTION_LENGTH = 2000;
export const MAX_PRICE = 1000000;
export const MIN_DURATION_MINUTES = 5;
export const MAX_DURATION_MINUTES = 1440;

export type ServiceFilter = 'all' | 'active' | 'inactive';

export interface ServiceSummary {
  id: string;
  name: string;
  description: string | null;
  price: number;
  currency: string;
  durationMinutes: number;
  serviceMode: string;
  status: string;
  isActive: boolean;
  category: { id: string; code: string; name: string } | null;
  images: Array<{ id: string; imageUrl: string; sortOrder: number }>;
}

export interface ServiceEditorModel {
  name: string;
  description: string;
  serviceCategoryId: string;
  price: string;
  currency: string;
  durationMinutes: string;
  serviceMode: string;
  isActive: boolean;
  images: string[];
  expectedUpdatedAt?: string;
}

export function emptyEditor(): ServiceEditorModel {
  return {
    name: '',
    description: '',
    serviceCategoryId: '',
    price: '',
    currency: 'ZAR',
    durationMinutes: '30',
    serviceMode: 'BOTH',
    isActive: true,
    images: [],
  };
}

export function toSummary(raw: any): ServiceSummary {
  const status = String(raw?.status ?? 'DRAFT').toUpperCase();
  return {
    id: String(raw?.id ?? ''),
    name: String(raw?.name ?? 'Untitled service'),
    description: raw?.description ?? null,
    price: Number(raw?.price ?? 0),
    currency: String(raw?.currency ?? 'ZAR'),
    durationMinutes: Number(raw?.durationMinutes ?? 0),
    serviceMode: String(raw?.serviceMode ?? 'BOTH'),
    status,
    isActive: status === 'ACTIVE',
    category: raw?.category ?? null,
    images: Array.isArray(raw?.images) ? raw.images.slice(0, MAX_SERVICE_IMAGES) : [],
  };
}

export function filterServices(services: ServiceSummary[], filter: ServiceFilter): ServiceSummary[] {
  if (filter === 'active') return services.filter((s) => s.isActive);
  if (filter === 'inactive') return services.filter((s) => !s.isActive);
  return services;
}

export function statusLabel(status: string): string {
  const upper = (status ?? '').toUpperCase();
  const labels: Record<string, string> = {
    ACTIVE: 'Active',
    PAUSED: 'Inactive',
    DRAFT: 'Draft',
    SUSPENDED: 'Suspended',
  };
  return labels[upper] ?? status;
}

export function priceLabel(price: number, currency: string): string {
  const code = (currency ?? 'ZAR').toUpperCase();
  const symbol = code === 'ZAR' ? 'R' : `${code} `;
  const n = Number(price);
  return `${symbol}${Number.isFinite(n) ? n.toFixed(2) : '0.00'}`;
}

export function durationLabel(minutes: number): string {
  const n = Number(minutes);
  if (!Number.isFinite(n) || n <= 0) return '—';
  if (n < 60) return `${n} min`;
  const h = Math.floor(n / 60);
  const m = n % 60;
  return m === 0 ? `${h} hr` : `${h} hr ${m} min`;
}

export function serviceModeLabel(mode: string): string {
  const labels: Record<string, string> = {
    PROVIDER_LOCATION: 'At provider',
    CUSTOMER_LOCATION: 'At customer',
    BOTH: 'Provider or customer',
  };
  return labels[(mode ?? '').toUpperCase()] ?? mode;
}

/** Client-side mirror of backend validation. Backend remains authoritative. */
export function validateEditor(model: ServiceEditorModel): string[] {
  const errors: string[] = [];
  if (!model.name || model.name.trim().length === 0) errors.push('Service name is required.');
  else if (model.name.trim().length > MAX_NAME_LENGTH) errors.push(`Service name must be at most ${MAX_NAME_LENGTH} characters.`);
  if (model.description && model.description.length > MAX_DESCRIPTION_LENGTH) {
    errors.push(`Description must be at most ${MAX_DESCRIPTION_LENGTH} characters.`);
  }
  if (!model.serviceCategoryId) errors.push('Choose a service category.');
  const price = Number(model.price);
  if (model.price === '' || !Number.isFinite(price)) errors.push('Enter a valid price.');
  else {
    if (price < 0) errors.push('Price must not be negative.');
    if (price > MAX_PRICE) errors.push(`Price must not exceed ${MAX_PRICE}.`);
    if (Math.abs(price - Math.round(price * 100) / 100) > 1e-9) errors.push('Price supports at most 2 decimal places.');
  }
  if (!SUPPORTED_CURRENCIES.includes((model.currency ?? '').toUpperCase())) errors.push('Currency must be ZAR.');
  const duration = Number(model.durationMinutes);
  if (!Number.isInteger(duration)) errors.push('Duration must be a whole number of minutes.');
  else if (duration < MIN_DURATION_MINUTES || duration > MAX_DURATION_MINUTES) {
    errors.push(`Duration must be between ${MIN_DURATION_MINUTES} and ${MAX_DURATION_MINUTES} minutes.`);
  }
  if (!SERVICE_MODES.includes((model.serviceMode ?? '').toUpperCase())) {
    errors.push('Choose a valid service mode.');
  }
  if (model.images.length > MAX_SERVICE_IMAGES) errors.push(`A service may have at most ${MAX_SERVICE_IMAGES} images.`);
  for (const url of model.images) {
    if (typeof url !== 'string' || url.trim().length === 0) errors.push('Image references must not be empty.');
    else if (/^data:/i.test(url.trim())) errors.push('Images must be storage references — inline uploads are not supported here.');
    else if (/^(javascript|vbscript|file|blob):/i.test(url.trim())) errors.push('Image URL uses a forbidden scheme.');
  }
  return errors;
}

export function toPayload(model: ServiceEditorModel): Record<string, unknown> {
  return {
    name: model.name.trim(),
    description: model.description.trim().length === 0 ? null : model.description.trim(),
    serviceCategoryId: model.serviceCategoryId,
    price: Number(model.price),
    currency: (model.currency || 'ZAR').toUpperCase(),
    durationMinutes: Number(model.durationMinutes),
    serviceMode: (model.serviceMode || 'BOTH').toUpperCase(),
    isActive: model.isActive,
    images: model.images.map((url, i) => ({ imageUrl: url.trim(), sortOrder: i })),
    ...(model.expectedUpdatedAt ? { expectedUpdatedAt: model.expectedUpdatedAt } : {}),
  };
}

export function fromDetail(detail: any): ServiceEditorModel {
  return {
    name: detail?.name ?? '',
    description: detail?.description ?? '',
    serviceCategoryId: detail?.serviceCategoryId ?? detail?.category?.id ?? '',
    price: detail?.price != null ? String(detail.price) : '',
    currency: detail?.currency ?? 'ZAR',
    durationMinutes: detail?.durationMinutes != null ? String(detail.durationMinutes) : '30',
    serviceMode: detail?.serviceMode ?? 'BOTH',
    isActive: String(detail?.status ?? 'ACTIVE').toUpperCase() === 'ACTIVE',
    images: Array.isArray(detail?.images) ? detail.images.map((i: any) => (typeof i === 'string' ? i : i.imageUrl)) : [],
    expectedUpdatedAt: detail?.updatedAt,
  };
}

/** Maps backend error codes to provider-safe messages. Never leaks internals. */
export function serviceErrorMessage(code: string | undefined, fallback: string): string {
  switch ((code ?? '').toUpperCase()) {
    case 'SERVICE_NOT_FOUND':
      return 'Service not found. It may have been removed.';
    case 'CATEGORY_NOT_FOUND':
      return 'Choose a valid Waasha category.';
    case 'SERVICE_LIMIT_REACHED':
      return 'Service limit reached for this account.';
    case 'SERVICE_CONFLICT':
      return 'This service changed elsewhere. Reload and try again.';
    case 'SERVICE_HAS_BOOKINGS':
      return 'This service has existing bookings and cannot be deleted. Deactivate it instead.';
    case 'UPLOAD_NOT_SUPPORTED':
      return 'Images must be storage references — inline uploads are not supported here.';
    case 'MEDIA_NOT_READY':
      return 'The image is still being processed. Wait for confirmation before using it.';
    case 'MEDIA_NOT_FOUND':
      return 'Image not found. It may have been removed.';
    case 'SERVICE_IMAGE_LIMIT':
      return 'A service may have at most 3 images.';
    case 'MEDIA_PURPOSE_MISMATCH':
      return 'This image cannot be used for a service.';
    case 'SERVICE_INVALID':
    case 'VALIDATION_ERROR':
      return 'Some fields need attention. Check the form and try again.';
    case 'UNAUTHORIZED':
      return 'Log in to manage services.';
    case 'FORBIDDEN':
      return 'You are not allowed to manage this service.';
    default:
      return fallback;
  }
}

/**
 * Slice 10 — Provider profile presentation helpers (mobile).
 *
 * Same backend API and business rules as web. No mobile-only business
 * logic. Touch-friendly controls live in the page component; only pure
 * validation/payload/error helpers live here (unit testable, no TestBed).
 * All data comes from the real backend API.
 */

export const MAX_DISPLAY_NAME_LENGTH = 80;
export const MIN_DISPLAY_NAME_LENGTH = 2;
export const MAX_BIO_LENGTH = 2000;
export const MAX_EXPERIENCE_LENGTH = 2000;

export interface ProviderProfileForm {
  displayName: string;
  bio: string;
  experienceSummary: string;
  customRequestsEnabled: boolean;
  profileImageUrl: string;
}

export function emptyProfileForm(): ProviderProfileForm {
  return {
    displayName: '',
    bio: '',
    experienceSummary: '',
    customRequestsEnabled: false,
    profileImageUrl: '',
  };
}

export function fromProfile(detail: any): ProviderProfileForm {
  return {
    displayName: detail?.displayName ?? '',
    bio: detail?.bio ?? '',
    experienceSummary: detail?.experienceSummary ?? '',
    customRequestsEnabled: Boolean(detail?.customRequestsEnabled),
    profileImageUrl: detail?.profileImageUrl ?? '',
  };
}

/** Client-side mirror of backend validation. Backend remains authoritative. */
export function validateProfileForm(model: ProviderProfileForm): string[] {
  const errors: string[] = [];
  const name = (model.displayName ?? '').trim();
  if (name.length === 0) errors.push('Display name is required.');
  else {
    if (name.length < MIN_DISPLAY_NAME_LENGTH) {
      errors.push(`Display name must be at least ${MIN_DISPLAY_NAME_LENGTH} characters.`);
    }
    if (name.length > MAX_DISPLAY_NAME_LENGTH) {
      errors.push(`Display name must be at most ${MAX_DISPLAY_NAME_LENGTH} characters.`);
    }
  }
  if ((model.bio ?? '').length > MAX_BIO_LENGTH) {
    errors.push(`Bio must be at most ${MAX_BIO_LENGTH} characters.`);
  }
  if ((model.experienceSummary ?? '').length > MAX_EXPERIENCE_LENGTH) {
    errors.push(`Experience summary must be at most ${MAX_EXPERIENCE_LENGTH} characters.`);
  }
  const img = (model.profileImageUrl ?? '').trim();
  if (img.length > 0) {
    if (/^data:/i.test(img)) errors.push('Profile image must be a storage reference — inline uploads are not supported here.');
    else if (/^(javascript|vbscript|file|blob):/i.test(img)) errors.push('Profile image URL uses a forbidden scheme.');
    else if (!/^https?:\/\//i.test(img) && !img.startsWith('/')) {
      errors.push('Profile image must be an https URL or app storage reference.');
    }
  }
  return errors;
}

/**
 * Build the PATCH payload with only editable fields. Empty optional text
 * maps to null (clear the field). No providerId/userId/tier/verification
 * fields are ever included — session identity is authoritative.
 */
export function toProfilePayload(
  model: ProviderProfileForm,
  original: ProviderProfileForm,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (model.displayName.trim() !== (original.displayName ?? '')) {
    payload["displayName"] = model.displayName.trim();
  }
  const bio = model.bio.trim().length === 0 ? null : model.bio.trim();
  const origBio = (original.bio ?? '').trim().length === 0 ? null : original.bio.trim();
  if (bio !== origBio) payload["bio"] = bio;
  const exp = model.experienceSummary.trim().length === 0 ? null : model.experienceSummary.trim();
  const origExp = (original.experienceSummary ?? '').trim().length === 0 ? null : original.experienceSummary.trim();
  if (exp !== origExp) payload["experienceSummary"] = exp;
  if (model.customRequestsEnabled !== original.customRequestsEnabled) {
    payload["customRequestsEnabled"] = model.customRequestsEnabled;
  }
  const img = model.profileImageUrl.trim().length === 0 ? null : model.profileImageUrl.trim();
  const origImg = (original.profileImageUrl ?? '').trim().length === 0 ? null : original.profileImageUrl.trim();
  if (img !== origImg) payload["profileImageUrl"] = img;
  return payload;
}

/** Maps backend error codes to provider-safe messages. Never leaks internals. */
export function profileErrorMessage(code: string | undefined, fallback: string): string {
  switch ((code ?? '').toUpperCase()) {
    case 'PROVIDER_NOT_FOUND':
      return 'No provider profile was found for this account.';
    case 'UPLOAD_NOT_SUPPORTED':
      return 'Profile image must be a storage reference — inline uploads are not supported here.';
    case 'VALIDATION_ERROR':
      return 'Some fields need attention. Check the form and try again.';
    case 'UNAUTHORIZED':
      return 'Log in to manage your profile.';
    case 'FORBIDDEN':
      return 'You are not allowed to perform this action.';
    default:
      return fallback;
  }
}

export function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

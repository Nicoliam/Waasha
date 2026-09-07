/**
 * Slice 11 — Media configuration (environment-driven, no hard-coded
 * financial/storage-vendor values).
 *
 * Blueprint Document 12 §5/§6: supported types and size limits are
 * configuration rather than application constants.
 */

import { env } from '../../config/env';

export const MEDIA_PURPOSES = ['PROFILE', 'SERVICE', 'PORTFOLIO', 'CUSTOM_REQUEST', 'BUSINESS', 'VERIFICATION'] as const;
export type MediaPurpose = (typeof MEDIA_PURPOSES)[number];

/** Allowed image content types → canonical extension. Never trust extension alone. */
export const ALLOWED_IMAGE_MIME_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
};

export const ALLOWED_IMAGE_MIMES = Object.keys(ALLOWED_IMAGE_MIME_TYPES);

/** Executable / active-content types are never accepted as ordinary uploads. */
export const FORBIDDEN_MIME_PREFIXES = [
  'application/x-',
  'application/javascript',
  'application/ecmascript',
  'text/html',
  'text/javascript',
];

export const MAX_FILENAME_LENGTH = 255;
export const MAX_SERVICE_IMAGES = 3;
export const MAX_CUSTOM_REQUEST_IMAGES = 3;

export function maxBytesForPurpose(purpose: MediaPurpose): number {
  switch (purpose) {
    case 'PROFILE':
      return env.MEDIA_PROFILE_MAX_BYTES;
    case 'SERVICE':
      return env.MEDIA_SERVICE_MAX_BYTES;
    case 'PORTFOLIO':
      return env.MEDIA_PORTFOLIO_MAX_BYTES;
    case 'CUSTOM_REQUEST':
      return env.MEDIA_CUSTOM_REQUEST_MAX_BYTES;
    case 'BUSINESS':
      return env.MEDIA_SERVICE_MAX_BYTES;
    case 'VERIFICATION':
      return 20 * 1024 * 1024;
    default:
      return env.MEDIA_SERVICE_MAX_BYTES;
  }
}

/** Private purposes are never served as general marketplace content. */
export function visibilityForPurpose(purpose: MediaPurpose): 'PUBLIC' | 'PRIVATE' {
  switch (purpose) {
    case 'CUSTOM_REQUEST':
    case 'VERIFICATION':
      return 'PRIVATE';
    default:
      return 'PUBLIC';
  }
}

/** Storage namespace segment per purpose (mirrors blueprint §10). */
export function namespaceForPurpose(purpose: MediaPurpose): string {
  switch (purpose) {
    case 'PROFILE':
    case 'SERVICE':
    case 'PORTFOLIO':
      return 'providers';
    case 'BUSINESS':
      return 'businesses';
    case 'CUSTOM_REQUEST':
      return 'custom-requests';
    case 'VERIFICATION':
      return 'verification';
    default:
      return 'providers';
  }
}

/** Storage visibility root per purpose. */
export function storageVisibilityForPurpose(purpose: MediaPurpose): 'public' | 'private' {
  return visibilityForPurpose(purpose) === 'PRIVATE' ? 'private' : 'public';
}

/**
 * Slice 11 — Client-side media upload helpers (framework-free).
 *
 * Mirrors backend validation for fast feedback only. The backend remains
 * authoritative: a file passing here can still be rejected server-side,
 * and a file is NEVER treated as uploaded until the backend finalizes it.
 */

export type MediaUploadPurpose = 'PROFILE' | 'SERVICE' | 'PORTFOLIO' | 'CUSTOM_REQUEST' | 'BUSINESS' | 'VERIFICATION';

export const ALLOWED_UPLOAD_MIMES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/heic': 'heic',
  'image/heif': 'heif',
};

export const MAX_UPLOAD_BYTES: Record<MediaUploadPurpose, number> = {
  PROFILE: 10 * 1024 * 1024,
  SERVICE: 15 * 1024 * 1024,
  PORTFOLIO: 15 * 1024 * 1024,
  CUSTOM_REQUEST: 15 * 1024 * 1024,
  BUSINESS: 15 * 1024 * 1024,
  VERIFICATION: 20 * 1024 * 1024,
};

export const MAX_SERVICE_IMAGES = 3;
export const MAX_CUSTOM_REQUEST_IMAGES = 3;

export interface UploadFileMeta {
  name: string;
  type: string;
  size: number;
}

export function isOffline(): boolean {
  try {
    return typeof navigator !== 'undefined' && navigator.onLine === false;
  } catch {
    return false;
  }
}

function extensionOf(name: string): string {
  const match = /\.([a-zA-Z0-9]{2,5})$/.exec(name ?? '');
  return (match?.[1] ?? '').toLowerCase();
}

/**
 * Fast client-side checks. Returns user-safe error strings (empty = pass).
 * Never claims backend acceptance.
 */
export function validateFileForUpload(file: UploadFileMeta | null | undefined, purpose: MediaUploadPurpose): string[] {
  const errors: string[] = [];
  if (!file) {
    errors.push('Choose a file to upload.');
    return errors;
  }
  const mime = String(file.type ?? '').toLowerCase().split(';')[0].trim();
  if (!mime || !ALLOWED_UPLOAD_MIMES[mime]) {
    errors.push('Unsupported file type. Use JPEG, PNG, WebP or HEIC.');
  }
  const max = MAX_UPLOAD_BYTES[purpose] ?? MAX_UPLOAD_BYTES.SERVICE;
  if (!Number.isFinite(file.size) || file.size <= 0) {
    errors.push('File appears to be empty.');
  } else if (file.size > max) {
    errors.push(`File is too large. Maximum is ${Math.round(max / 1024 / 1024)} MB.`);
  }
  const name = String(file.name ?? '');
  if (!name || name.length > 255 || name.includes('..') || name.includes('/') || name.includes('\\')) {
    errors.push('File name is not valid.');
  } else if (mime && ALLOWED_UPLOAD_MIMES[mime]) {
    const ext = extensionOf(name);
    const canonical = ALLOWED_UPLOAD_MIMES[mime];
    const accepted = canonical === 'jpg' ? ['jpg', 'jpeg'] : [canonical];
    if (!accepted.includes(ext)) {
      errors.push('File extension does not match the file type.');
    }
  }
  return errors;
}

/** Maps backend/media error codes to user-safe messages. Never leaks internals. */
export function uploadErrorMessage(code: string | undefined, fallback: string): string {
  switch ((code ?? '').toUpperCase()) {
    case 'OFFLINE':
      return 'You are offline. Reconnect before uploading — nothing has been uploaded.';
    case 'UNSUPPORTED_FILE':
    case 'INVALID_MIME_TYPE':
      return 'Unsupported file type. Use JPEG, PNG, WebP or HEIC.';
    case 'FILE_TOO_LARGE':
    case 'INVALID_FILE_SIZE':
      return 'File is too large. Choose a smaller image.';
    case 'CONTENT_MISMATCH':
      return 'File extension does not match the file type.';
    case 'INVALID_FILENAME':
      return 'File name is not valid.';
    case 'UPLOAD_FAILED':
      return 'Upload failed before reaching the server. Retry — nothing has been saved.';
    case 'FINALIZE_FAILED':
    case 'MEDIA_FINALIZE_FAILED':
    case 'INTEGRITY_MISMATCH':
      return 'The upload could not be confirmed. Retry — the image is not live.';
    case 'MEDIA_NOT_READY':
      return 'The image is still being processed. Wait for confirmation before using it.';
    case 'MEDIA_NOT_FOUND':
      return 'Upload session not found. Start a new upload.';
    case 'SERVICE_IMAGE_LIMIT':
      return 'A service may have at most 3 images.';
    case 'CUSTOM_REQUEST_IMAGE_LIMIT':
      return 'A custom request may have at most 3 images.';
    case 'MEDIA_PURPOSE_MISMATCH':
      return 'This image cannot be used here.';
    case 'INVALID_PURPOSE':
    case 'INVALID_TARGET':
    case 'VALIDATION_ERROR':
      return 'Some details need attention. Check the file and try again.';
    case 'FORBIDDEN':
      return 'You are not allowed to use this image.';
    case 'UNAUTHORIZED':
      return 'Log in before uploading.';
    default:
      return fallback;
  }
}

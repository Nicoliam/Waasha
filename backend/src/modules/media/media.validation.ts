/**
 * Slice 11 — Server-side file/media validation (pure functions).
 *
 * Blueprint Document 12 §17: never trust filename extension, client MIME
 * type, or browser-provided file type. Every check here runs on the
 * backend; frontend validation is convenience only.
 */

import {
  ALLOWED_IMAGE_MIME_TYPES,
  ALLOWED_IMAGE_MIMES,
  FORBIDDEN_MIME_PREFIXES,
  MAX_FILENAME_LENGTH,
} from './media.config';

export interface FileValidationError {
  code: string;
  message: string;
  details?: unknown;
}

export function validationError(code: string, message: string, details?: unknown): FileValidationError {
  return { code, message, details };
}

/** Declared content type must be an explicitly allowed image MIME. */
export function validateMimeType(mimeType: unknown): { mime: string } | FileValidationError {
  if (typeof mimeType !== 'string' || mimeType.trim().length === 0) {
    return validationError('INVALID_MIME_TYPE', 'contentType is required');
  }
  const normalized = mimeType.trim().toLowerCase().split(';')[0].trim();
  if (FORBIDDEN_MIME_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
    return validationError('INVALID_MIME_TYPE', `contentType ${normalized} is not permitted`, { received: normalized });
  }
  if (!ALLOWED_IMAGE_MIMES.includes(normalized)) {
    return validationError('INVALID_MIME_TYPE', `contentType ${normalized} is not supported`, { received: normalized });
  }
  return { mime: normalized };
}

/** Filenames are metadata only — never storage paths. Reject traversal and unsafe names. */
export function validateFilename(filename: unknown): { filename: string } | FileValidationError {
  if (filename === undefined || filename === null) return { filename: 'upload' };
  if (typeof filename !== 'string') {
    return validationError('INVALID_FILENAME', 'filename must be a string');
  }
  const name = filename.trim();
  if (name.length === 0) return { filename: 'upload' };
  if (name.length > MAX_FILENAME_LENGTH) {
    return validationError('INVALID_FILENAME', `filename must be at most ${MAX_FILENAME_LENGTH} characters`);
  }
  if (name.includes('\0') || /[\r\n]/.test(name)) {
    return validationError('INVALID_FILENAME', 'filename contains forbidden characters');
  }
  // Path traversal / absolute paths / drive letters / URL schemes are never filenames.
  if (
    name.includes('..') ||
    name.includes('/') ||
    name.includes('\\') ||
    /^[a-zA-Z]:/.test(name) ||
    /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(name)
  ) {
    return validationError('INVALID_FILENAME', 'filename must be a plain file name without paths', { received: name.slice(0, 80) });
  }
  // Control characters and shell-sensitive characters.
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f$`!|&;*?~<>^()[\]{}]/.test(name)) {
    return validationError('INVALID_FILENAME', 'filename contains forbidden characters');
  }
  // Must look like a file with an extension (extension itself is validated separately).
  if (!/\.[a-zA-Z0-9]{2,5}$/.test(name)) {
    return validationError('INVALID_FILENAME', 'filename must include a supported file extension');
  }
  return { filename: name };
}

export function extensionOf(filename: string): string {
  const match = /\.([a-zA-Z0-9]{2,5})$/.exec(filename);
  return (match?.[1] ?? '').toLowerCase();
}

/**
 * Extension must be consistent with the declared MIME type. Extension alone
 * never authenticates a file (blueprint §17), but a mismatch is a hard
 * reject — e.g. `evil.exe` renamed to `.jpg`, or `photo.png` declared as
 * image/jpeg.
 */
export function validateExtensionMatchesMime(
  filename: string,
  mime: string,
): { extension: string } | FileValidationError {
  const ext = extensionOf(filename);
  const canonical = ALLOWED_IMAGE_MIME_TYPES[mime];
  if (!canonical) {
    return validationError('INVALID_MIME_TYPE', `contentType ${mime} is not supported`);
  }
  // jpeg/jpg alias.
  const aliases: Record<string, string[]> = {
    jpg: ['jpg', 'jpeg'],
  };
  const accepted = aliases[canonical] ?? [canonical];
  if (!accepted.includes(ext)) {
    return validationError('CONTENT_MISMATCH', `filename extension .${ext || '(none)'} does not match contentType ${mime}`, {
      extension: ext,
      contentType: mime,
    });
  }
  return { extension: canonical };
}

/** Size must be a positive integer within the purpose limit. */
export function validateSizeBytes(sizeBytes: unknown, maxBytes: number): { size: number } | FileValidationError {
  const n = typeof sizeBytes === 'string' ? Number(sizeBytes) : (sizeBytes as number);
  if (typeof n !== 'number' || !Number.isFinite(n) || !Number.isInteger(n)) {
    return validationError('INVALID_FILE_SIZE', 'sizeBytes must be an integer number of bytes');
  }
  if (n <= 0) {
    return validationError('INVALID_FILE_SIZE', 'sizeBytes must be greater than zero');
  }
  if (n > maxBytes) {
    return validationError('FILE_TOO_LARGE', `File exceeds the maximum size of ${maxBytes} bytes`, {
      maxBytes,
      received: n,
    });
  }
  return { size: n };
}

/**
 * Client-supplied storage keys/buckets are never accepted. Any request field
 * resembling one (storageKey, bucket, objectKey, key, path, url carrying a
 * key) with traversal or bucket-selection content is rejected outright.
 */
export function assertNoClientStorageKey(body: Record<string, unknown>): FileValidationError | null {
  const suspectFields = ['storageKey', 'bucket', 'objectKey', 'object_key', 'container', 'storagePath', 'storage_path'];
  const present = suspectFields.filter((k) => k in body && body[k] !== undefined && body[k] !== null && body[k] !== '');
  if (present.length > 0) {
    return validationError('INVALID_STORAGE_KEY', `Storage location is server-assigned; fields not allowed: ${present.join(', ')}`, {
      forbidden: present,
    });
  }
  for (const [key, value] of Object.entries(body)) {
    if (typeof value !== 'string') continue;
    // Fields with dedicated validators produce their own precise codes —
    // the generic guard must not shadow them.
    if (
      [
        'imageUrl', 'profileImageUrl', 'viewUrl', 'uploadUrl',
        'filename', 'originalFilename', 'contentType', 'detectedMimeType', 'mimeType',
        'purpose', 'targetId', 'checksum', 'serviceId', 'mediaId',
      ].includes(key)
    ) {
      continue;
    }
      // Allow plain https reference URLs elsewhere? No — traversal-looking
      // strings in media session/finalize payloads are rejected.
      if (value.includes('..') || value.includes('%2e') || value.includes('%2f')) {
        return validationError('INVALID_STORAGE_KEY', `Field ${key} contains an unsafe path`, { field: key });
      }
  }
  return null;
}

/** Optional checksum: hex sha (64/40/32 chars) or base64 (<=128 chars). Anything else rejected. */
export function validateChecksum(checksum: unknown): { checksum: string | null } | FileValidationError {
  if (checksum === undefined || checksum === null || checksum === '') return { checksum: null };
  if (typeof checksum !== 'string') {
    return validationError('INVALID_CHECKSUM', 'checksum must be a string');
  }
  const value = checksum.trim();
  if (/^[a-fA-F0-9]{32,128}$/.test(value)) return { checksum: value.toLowerCase() };
  if (/^[A-Za-z0-9+/=]{8,128}$/.test(value) && value.length >= 8) return { checksum: value };
  return validationError('INVALID_CHECKSUM', 'checksum format is not recognized');
}

export function isValidationError(value: unknown): value is FileValidationError {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as FileValidationError).code === 'string' &&
    typeof (value as FileValidationError).message === 'string'
  );
}

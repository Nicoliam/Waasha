/**
 * Slice 11 — Provider-agnostic media storage abstraction.
 *
 * Blueprint Document 12 (Media & File Storage Architecture).
 * The application depends ONLY on this interface. Business/domain services
 * must never import vendor SDKs or read storage credentials. Concrete
 * adapters live under infrastructure/storage and are selected by
 * configuration (WAASHA_STORAGE_PROVIDER) — never hard-coded.
 */

export type StorageVisibility = 'public' | 'private';

export interface StorageKeyScope {
  /** public | private namespace root (server-decided from purpose). */
  visibility: StorageVisibility;
  /** Second-level namespace, e.g. providers / services / custom-requests. */
  namespace: string;
  /** Owner-scoped segment, e.g. the provider id or customer user id. */
  ownerSegment: string;
  /** File extension without dot, lower-cased, server-validated. */
  extension: string;
  /** Unique suffix supplied by the caller (uuid recommended). */
  uniqueId: string;
}

export interface ControlledUploadTarget {
  /** Server-generated namespaced object key. Never client-supplied. */
  storageKey: string;
  /** Bucket/container logical name from configuration (no credentials). */
  bucket: string;
  /** Opaque controlled upload URL — contains no credentials or secrets. */
  uploadUrl: string;
  /** HTTP method the client must use for the byte upload. */
  uploadMethod: 'PUT';
  /** Expiry of the controlled upload target (ISO timestamp). */
  expiresAt: string;
  /** Maximum accepted bytes for this upload session. */
  maxSizeBytes: number;
}

export interface ViewUrlOptions {
  storageKey: string;
  visibility: StorageVisibility;
}

export interface StorageProvider {
  /** Stable adapter name from configuration (e.g. "test-adapter"). */
  readonly name: string;
  /** Build a safe namespaced object key. Must never embed raw filenames. */
  buildObjectKey(scope: StorageKeyScope): string;
  /** Create a controlled upload target for a server-validated session. */
  buildUploadTarget(storageKey: string, maxSizeBytes: number): ControlledUploadTarget;
  /** Build a credential-free view/download URL for an asset. */
  buildViewUrl(options: ViewUrlOptions): string;
  /**
   * Best-effort object removal. Adapters must treat missing objects as
   * success (idempotent). Must never throw for cleanup paths — the media
   * lifecycle record remains the source of truth.
   */
  deleteObject(storageKey: string): Promise<void>;
  /** Public configuration snapshot — never includes credentials/secrets. */
  publicConfig(): { provider: string; bucket: string; region: string; cdnBaseUrl: string };
}

/**
 * Slice 11 — Deterministic test/local storage adapter.
 *
 * Production-ready contract, local-safe behaviour: object keys are
 * namespaced and server-generated; upload targets and view URLs are
 * deterministic and credential-free. No vendor SDK, no network calls, no
 * secrets. A future S3/Afrihost/CDN adapter implements the same
 * StorageProvider interface without touching domain services.
 *
 * Key layout (mirrors blueprint namespaces):
 *   waasha/public/providers/{owner}/…      profile / service / portfolio
 *   waasha/public/businesses/{owner}/…     business media
 *   waasha/private/custom-requests/{id}/…  customer custom-request media
 *   waasha/private/verification/{owner}/…  verification documents
 */

import { createHash, randomUUID } from 'crypto';
import { env } from '../../config/env';
import {
  ControlledUploadTarget,
  StorageKeyScope,
  StorageProvider,
  StorageVisibility,
  ViewUrlOptions,
} from './storage.interface';

const KEY_ROOT = 'waasha';

function sanitizeSegment(segment: string): string {
  const cleaned = (segment || 'unscoped').toLowerCase().replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '');
  return cleaned.slice(0, 64) || 'unscoped';
}

function sanitizeExtension(extension: string): string {
  const cleaned = (extension || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8);
  return cleaned || 'bin';
}

export class TestAdapterStorageProvider implements StorageProvider {
  readonly name = 'test-adapter';

  buildObjectKey(scope: StorageKeyScope): string {
    const visibility: StorageVisibility = scope.visibility === 'private' ? 'private' : 'public';
    const namespace = sanitizeSegment(scope.namespace);
    const owner = sanitizeSegment(scope.ownerSegment);
    const ext = sanitizeExtension(scope.extension);
    const unique = sanitizeSegment(scope.uniqueId || randomUUID());
    return `${KEY_ROOT}/${visibility}/${namespace}/${owner}/${unique}.${ext}`;
  }

  buildUploadTarget(storageKey: string, maxSizeBytes: number): ControlledUploadTarget {
    const digest = createHash('sha256').update(storageKey).digest('hex').slice(0, 16);
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    return {
      storageKey,
      bucket: env.STORAGE_BUCKET,
      // Deterministic controlled-upload reference. Credential-free by
      // construction: integrity digest only, no signatures or access keys.
      uploadUrl: `https://upload.local/${storageKey}?op=put&ctx=${digest}`,
      uploadMethod: 'PUT',
      expiresAt,
      maxSizeBytes,
    };
  }

  buildViewUrl(options: ViewUrlOptions): string {
    void options.visibility;
    return `${env.CDN_BASE_URL}/${options.storageKey}`;
  }

  async deleteObject(_storageKey: string): Promise<void> {
    // Local/test adapter holds no bytes outside the DB record — the media
    // lifecycle row is the source of truth. Missing objects are success.
    return Promise.resolve();
  }

  publicConfig(): { provider: string; bucket: string; region: string; cdnBaseUrl: string } {
    return {
      provider: this.name,
      bucket: env.STORAGE_BUCKET,
      region: env.STORAGE_REGION,
      cdnBaseUrl: env.CDN_BASE_URL,
    };
  }
}

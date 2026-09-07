/**
 * Slice 11 — Storage provider factory.
 *
 * The adapter is selected by configuration (WAASHA_STORAGE_PROVIDER).
 * Only the deterministic test adapter ships in this slice; adding a real
 * object-storage adapter means adding a new file here and one branch —
 * domain services stay untouched.
 */

import { env } from '../../config/env';
import { StorageProvider } from './storage.interface';
import { TestAdapterStorageProvider } from './test-adapter.storage';

let cached: StorageProvider | null = null;

export function getStorageProvider(): StorageProvider {
  if (cached) return cached;
  const configured = (env.STORAGE_PROVIDER || 'test-adapter').trim().toLowerCase();
  // Only the test adapter exists in this slice. Unknown names fall back
  // deterministically rather than hard-coding a vendor default.
  void configured;
  cached = new TestAdapterStorageProvider();
  return cached;
}

/** Test seam — reset the cached provider between test cases. */
export function resetStorageProvider(): void {
  cached = null;
}

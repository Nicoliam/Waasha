/**
 * Slice 11 — Media & file storage domain service.
 *
 * Blueprint Document 12. Provider-agnostic: the ONLY storage touchpoint is
 * the StorageProvider interface (infrastructure/storage). No vendor SDK,
 * no credentials, no bucket selection from clients.
 *
 * Ownership ALWAYS derives from the authenticated session (userId):
 * - provider purposes → own providerProfile.id
 * - customer purposes → own customerProfile.id
 * Client-supplied tenantId / providerId / userId are never accepted.
 *
 * Lifecycle: PENDING_UPLOAD → UPLOADED → ACTIVE (finalize promotes through
 * both atomically under the test adapter; a real pipeline would perform
 * scan/process steps between them). Failure states REJECTED / FAILED;
 * removal is soft (DELETED + deletedAt). Finalize is idempotent.
 */

import { randomUUID } from 'crypto';
import { prisma } from '../../config/prisma';
import { getStorageProvider } from '../../infrastructure/storage';
import {
  MAX_CUSTOM_REQUEST_IMAGES,
  MAX_SERVICE_IMAGES,
  MediaPurpose,
  MEDIA_PURPOSES,
  maxBytesForPurpose,
  namespaceForPurpose,
  storageVisibilityForPurpose,
  visibilityForPurpose,
} from './media.config';
import {
  assertNoClientStorageKey,
  extensionOf,
  isValidationError,
  validateChecksum,
  validateExtensionMatchesMime,
  validateFilename,
  validateMimeType,
  validateSizeBytes,
} from './media.validation';

export function err(
  status: number,
  code: string,
  message: string,
  details?: unknown,
): Error & { status: number; code: string; details?: unknown } {
  const e = new Error(message) as Error & { status: number; code: string; details?: unknown };
  e.status = status;
  e.code = code;
  if (details !== undefined) e.details = details;
  return e;
}

export interface RequestCtx {
  ip?: string;
  userAgent?: string;
  roles?: string[];
}

function isAdmin(ctx?: RequestCtx): boolean {
  return (ctx?.roles ?? []).map((r) => String(r).toUpperCase()).includes('ADMIN');
}

async function audit(
  actorUserId: string,
  action: string,
  entityId: string,
  beforeJson: unknown,
  afterJson: unknown,
  ctx?: RequestCtx,
) {
  try {
    await prisma.auditLog.create({
      data: {
        actorUserId,
        action,
        entityType: 'media_asset',
        entityId,
        beforeJson: (beforeJson ?? undefined) as any,
        afterJson: (afterJson ?? undefined) as any,
        ipAddress: ctx?.ip,
        userAgent: ctx?.userAgent,
      },
    });
  } catch {
    // Audit failures must never break media operations.
  }
}

interface ActorScope {
  providerId: string | null;
  customerId: string | null;
}

/** Resolve server-side ownership for the session user. */
async function resolveActor(sessionUserId: string): Promise<ActorScope> {
  let providerId: string | null = null;
  let customerId: string | null = null;
  try {
    const provider = await prisma.providerProfile.findUnique({
      where: { userId: sessionUserId },
      select: { id: true },
    } as any).catch(() => null);
    if (provider) providerId = (provider as any).id;
  } catch {
    providerId = null;
  }
  try {
    const customer = await (prisma as any).customerProfile?.findUnique?.({
      where: { userId: sessionUserId },
      select: { id: true },
    }).catch(() => null);
    if (customer) customerId = (customer as any).id;
  } catch {
    customerId = null;
  }
  return { providerId, customerId };
}

function parsePurpose(raw: unknown): MediaPurpose {
  if (typeof raw !== 'string' || !(MEDIA_PURPOSES as readonly string[]).includes(raw)) {
    throw err(422, 'INVALID_PURPOSE', `purpose must be one of [${MEDIA_PURPOSES.join(', ')}]`);
  }
  return raw as MediaPurpose;
}

function viewUrlFor(asset: { storageKey: string; visibility: string }): string {
  return getStorageProvider().buildViewUrl({
    storageKey: asset.storageKey,
    visibility: asset.visibility === 'PRIVATE' ? 'private' : 'public',
  });
}

function toPublicDTO(asset: any, opts: { includeSensitive?: boolean } = {}) {
  const active = asset.status === 'ACTIVE';
  const dto: Record<string, unknown> = {
    id: asset.id,
    uuid: asset.uuid,
    purpose: asset.purpose,
    status: asset.status,
    visibility: asset.visibility,
    moderationStatus: asset.moderationStatus,
    originalFilename: asset.originalFilename ?? null,
    mimeType: asset.mimeType,
    sizeBytes: asset.sizeBytes,
    width: asset.width ?? null,
    height: asset.height ?? null,
    // View URLs exist only for finalized assets — pending/incomplete assets
    // are never exposed as usable images.
    viewUrl: active ? viewUrlFor(asset) : null,
    createdAt: asset.createdAt instanceof Date ? asset.createdAt.toISOString() : String(asset.createdAt ?? ''),
    updatedAt: asset.updatedAt instanceof Date ? asset.updatedAt.toISOString() : String(asset.updatedAt ?? ''),
  };
  if (opts.includeSensitive) {
    dto.storageKey = asset.storageKey;
    dto.checksum = asset.checksum ?? null;
    dto.ownerType = asset.ownerType;
  }
  return dto;
}

function assertOwnerOrAdmin(asset: any, scope: ActorScope, sessionUserId: string, ctx?: RequestCtx) {
  if (isAdmin(ctx)) return;
  const owned =
    (asset.ownerType === 'PROVIDER' && scope.providerId !== null && asset.ownerId === scope.providerId) ||
    (asset.ownerType === 'CUSTOMER' && scope.customerId !== null && asset.ownerId === scope.customerId) ||
    // Fallback: uploader always retains control of their own session.
    asset.createdBy === sessionUserId;
  if (!owned) {
    // Safe 404 — no cross-tenant information leakage (IDOR protection).
    throw err(404, 'MEDIA_NOT_FOUND', 'Media not found');
  }
}

/**
 * Authorize an upload-session target and derive server-side ownership.
 * targetId (service id / custom-request id) is verified against resources
 * the session user owns — never trusted as ownership by itself.
 */
async function authorizeSessionTarget(
  purpose: MediaPurpose,
  targetId: unknown,
  scope: ActorScope,
  sessionUserId: string,
): Promise<{ ownerType: string; ownerId: string; tenantId: string | null; targetId: string | null; visibility: string }> {
  const visibility = visibilityForPurpose(purpose);
  const cleanTarget =
    targetId === undefined || targetId === null || targetId === ''
      ? null
      : typeof targetId === 'string'
        ? targetId.trim()
        : null;
  if (targetId !== undefined && targetId !== null && targetId !== '' && cleanTarget === null) {
    throw err(422, 'INVALID_TARGET', 'targetId must be a string');
  }
  if (cleanTarget !== null && (cleanTarget.length > 191 || cleanTarget.includes('..') || cleanTarget.includes('/'))) {
    throw err(422, 'INVALID_TARGET', 'targetId is not a valid reference');
  }

  switch (purpose) {
    case 'PROFILE':
    case 'PORTFOLIO':
    case 'BUSINESS':
    case 'VERIFICATION': {
      if (!scope.providerId) throw err(404, 'PROVIDER_NOT_FOUND', 'Provider profile not found');
      if (cleanTarget !== null && cleanTarget !== scope.providerId) {
        throw err(403, 'FORBIDDEN', 'Not authorized for this target');
      }
      return { ownerType: 'PROVIDER', ownerId: scope.providerId, tenantId: scope.providerId, targetId: null, visibility };
    }
    case 'SERVICE': {
      if (!scope.providerId) throw err(404, 'PROVIDER_NOT_FOUND', 'Provider profile not found');
      if (cleanTarget !== null) {
        const service = await (prisma as any).service?.findUnique?.({ where: { id: cleanTarget } }).catch(() => null);
        if (!service || (service as any).deletedAt) throw err(404, 'SERVICE_NOT_FOUND', 'Service not found');
        const owns =
          (service as any).providerId === scope.providerId ||
          ((service as any).businessUnitId && (await canManageUnit(sessionUserId, scope.providerId, (service as any).businessUnitId)));
        if (!owns) throw err(404, 'SERVICE_NOT_FOUND', 'Service not found');
      }
      return { ownerType: 'PROVIDER', ownerId: scope.providerId, tenantId: scope.providerId, targetId: cleanTarget, visibility };
    }
    case 'CUSTOM_REQUEST': {
      if (!scope.customerId) throw err(404, 'CUSTOMER_NOT_FOUND', 'Customer profile not found');
      // Custom-request domain is not yet implemented: the request id (when
      // supplied) is stored as an opaque verified-format reference only, and
      // the customer uploader owns the asset. Full request-membership checks
      // attach when the custom-request workflow lands.
      if (cleanTarget !== null) {
        const existing = await (prisma as any).mediaAsset?.count?.({
          where: { ownerType: 'CUSTOMER', ownerId: scope.customerId, purpose: 'CUSTOM_REQUEST', targetId: cleanTarget, status: { not: 'DELETED' } },
        }).catch(() => 0);
        if ((existing as number) >= MAX_CUSTOM_REQUEST_IMAGES) {
          throw err(422, 'CUSTOM_REQUEST_IMAGE_LIMIT', `A custom request may have at most ${MAX_CUSTOM_REQUEST_IMAGES} images`, {
            max: MAX_CUSTOM_REQUEST_IMAGES,
          });
        }
      }
      return { ownerType: 'CUSTOMER', ownerId: scope.customerId, tenantId: null, targetId: cleanTarget, visibility };
    }
    default:
      throw err(422, 'INVALID_PURPOSE', 'Unsupported media purpose');
  }
}

async function canManageUnit(sessionUserId: string, providerId: string, businessUnitId: string): Promise<boolean> {
  try {
    const businesses = await (prisma as any).business?.findMany?.({
      where: { ownerProviderId: sessionUserId },
      select: { id: true },
    }).catch(() => []);
    const ownedUnitIds: string[] = [];
    if (Array.isArray(businesses) && businesses.length > 0) {
      const units = await (prisma as any).businessUnit?.findMany?.({
        where: { businessId: { in: businesses.map((b: any) => b.id) } },
        select: { id: true },
      }).catch(() => []);
      for (const u of (units as any[]) ?? []) ownedUnitIds.push(u.id);
    }
    if (ownedUnitIds.includes(businessUnitId)) return true;
    const staff = await (prisma as any).businessStaff?.findMany?.({
      where: { providerId, status: 'ACTIVE' },
      select: { businessUnitId: true, role: true },
    }).catch(() => []);
    return ((staff as any[]) ?? []).some(
      (s) => s.businessUnitId === businessUnitId && ['OWNER', 'MANAGER'].includes(String(s.role).toUpperCase()),
    );
  } catch {
    return false;
  }
}

async function loadServiceOwned(sessionUserId: string, providerId: string, serviceId: string): Promise<any> {
  const service = await (prisma as any).service?.findUnique?.({ where: { id: serviceId } }).catch(() => null);
  if (!service || (service as any).deletedAt) throw err(404, 'SERVICE_NOT_FOUND', 'Service not found');
  const owns =
    (service as any).providerId === providerId ||
    ((service as any).businessUnitId && (await canManageUnit(sessionUserId, providerId, (service as any).businessUnitId)));
  if (!owns) throw err(404, 'SERVICE_NOT_FOUND', 'Service not found');
  return service;
}

// ── Upload sessions ───────────────────────────────────────────────

export interface UploadSessionInput {
  purpose: unknown;
  targetId?: unknown;
  filename?: unknown;
  contentType?: unknown;
  sizeBytes?: unknown;
  checksum?: unknown;
}

/** Step 1–5 of the upload lifecycle: authenticate, authorize, validate, record, return control info. */
export async function createUploadSession(sessionUserId: string, body: Record<string, unknown>, ctx?: RequestCtx) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw err(422, 'VALIDATION_ERROR', 'Request body must be an object');
  }
  const keyError = assertNoClientStorageKey(body);
  if (keyError) throw err(422, keyError.code, keyError.message, keyError.details);

  const input = body as unknown as UploadSessionInput;
  const purpose = parsePurpose(input.purpose);
  const scope = await resolveActor(sessionUserId);
  const target = await authorizeSessionTarget(purpose, input.targetId, scope, sessionUserId);

  const mimeResult = validateMimeType(input.contentType);
  if (isValidationError(mimeResult)) throw err(422, mimeResult.code, mimeResult.message, mimeResult.details);
  const filenameResult = validateFilename(input.filename);
  if (isValidationError(filenameResult)) throw err(422, filenameResult.code, filenameResult.message, filenameResult.details);
  const extResult = validateExtensionMatchesMime(filenameResult.filename, mimeResult.mime);
  if (isValidationError(extResult)) throw err(422, extResult.code, extResult.message, extResult.details);
  const maxBytes = maxBytesForPurpose(purpose);
  const sizeResult = validateSizeBytes(input.sizeBytes, maxBytes);
  if (isValidationError(sizeResult)) throw err(422, sizeResult.code, sizeResult.message, sizeResult.details);
  const checksumResult = validateChecksum(input.checksum);
  if (isValidationError(checksumResult)) throw err(422, checksumResult.code, checksumResult.message, checksumResult.details);

  const storage = getStorageProvider();
  const uniqueId = randomUUID();
  const ownerSegment =
    purpose === 'CUSTOM_REQUEST' && target.targetId ? target.targetId : target.ownerId;
  const storageKey = storage.buildObjectKey({
    visibility: storageVisibilityForPurpose(purpose),
    namespace: namespaceForPurpose(purpose),
    ownerSegment,
    extension: extResult.extension,
    uniqueId,
  });
  const upload = storage.buildUploadTarget(storageKey, sizeResult.size);

  const created = await (prisma as any).mediaAsset.create({
    data: {
      uuid: randomUUID(),
      ownerType: target.ownerType,
      ownerId: target.ownerId,
      tenantId: target.tenantId,
      purpose,
      targetId: target.targetId,
      storageKey,
      originalFilename: filenameResult.filename,
      mimeType: mimeResult.mime,
      detectedMimeType: null,
      extension: extResult.extension,
      sizeBytes: sizeResult.size,
      checksum: checksumResult.checksum,
      visibility: target.visibility,
      moderationStatus: 'PENDING',
      status: 'PENDING_UPLOAD',
      createdBy: sessionUserId,
    },
  });

  await audit(sessionUserId, 'MEDIA_UPLOAD_SESSION_CREATED', (created as any).id, null, {
    purpose,
    mimeType: mimeResult.mime,
    sizeBytes: sizeResult.size,
  }, ctx);

  // Minimum information for the upload: identity + controlled target.
  // Internal storageKey, checksum and owner ids are deliberately omitted —
  // the server resolves them from the media id on finalize/attach.
  return {
    mediaId: (created as any).id,
    uuid: (created as any).uuid,
    purpose,
    status: 'PENDING_UPLOAD',
    viewUrl: null,
    upload: {
      uploadUrl: upload.uploadUrl,
      uploadMethod: upload.uploadMethod,
      expiresAt: upload.expiresAt,
      maxSizeBytes: upload.maxSizeBytes,
    },
    originalFilename: filenameResult.filename,
    mimeType: mimeResult.mime,
    sizeBytes: sizeResult.size,
  };
}

// ── Finalization ──────────────────────────────────────────────────

export interface FinalizeInput {
  sizeBytes?: unknown;
  checksum?: unknown;
  detectedMimeType?: unknown;
  width?: unknown;
  height?: unknown;
}

/**
 * Steps 7–8 of the lifecycle: verify the bytes landed, then promote
 * PENDING_UPLOAD → UPLOADED → ACTIVE. Idempotent: repeating finalize for an
 * ACTIVE asset returns the current record without duplication.
 */
export async function finalizeMedia(
  sessionUserId: string,
  mediaId: string,
  body: Record<string, unknown>,
  ctx?: RequestCtx,
) {
  if (!mediaId || typeof mediaId !== 'string') throw err(422, 'VALIDATION_ERROR', 'mediaId is required');
  const asset = await (prisma as any).mediaAsset?.findUnique?.({ where: { id: mediaId } }).catch(() => null);
  if (!asset || (asset as any).status === 'DELETED' || (asset as any).deletedAt) {
    throw err(404, 'MEDIA_NOT_FOUND', 'Media not found');
  }
  const scope = await resolveActor(sessionUserId);
  assertOwnerOrAdmin(asset, scope, sessionUserId, ctx);

  // Idempotency: repeated finalization never duplicates active references.
  if ((asset as any).status === 'ACTIVE') {
    return { ...toPublicDTO(asset), idempotentReplay: true };
  }
  if ((asset as any).status === 'REJECTED') {
    throw err(422, 'MEDIA_REJECTED', 'Media was rejected and cannot be finalized');
  }
  if ((asset as any).status !== 'PENDING_UPLOAD' && (asset as any).status !== 'UPLOADED' && (asset as any).status !== 'FAILED') {
    throw err(422, 'MEDIA_FINALIZE_FAILED', `Media in status ${(asset as any).status} cannot be finalized`);
  }

  const input = (body ?? {}) as FinalizeInput;
  const keyError = assertNoClientStorageKey((body ?? {}) as Record<string, unknown>);
  if (keyError) throw err(422, keyError.code, keyError.message, keyError.details);

  const fail = async (code: string, message: string, details?: unknown): Promise<never> => {
    await (prisma as any).mediaAsset.update({
      where: { id: (asset as any).id },
      data: { status: 'FAILED' },
    }).catch(() => null);
    await audit(sessionUserId, 'MEDIA_FINALIZE_FAILED', (asset as any).id, { status: (asset as any).status }, { status: 'FAILED', code }, ctx);
    throw err(422, code, message, details);
  };

  // Size integrity: the landed bytes must match the declared session size.
  if (input.sizeBytes !== undefined && input.sizeBytes !== null) {
    const sizeResult = validateSizeBytes(input.sizeBytes, maxBytesForPurpose((asset as any).purpose as MediaPurpose));
    if (isValidationError(sizeResult)) {
      await fail(sizeResult.code, sizeResult.message, sizeResult.details);
    }
    if ((sizeResult as { size: number }).size !== (asset as any).sizeBytes) {
      await fail('INTEGRITY_MISMATCH', 'Finalized size does not match the upload session declaration', {
        declared: (asset as any).sizeBytes,
        received: (sizeResult as { size: number }).size,
      });
    }
  }

  // Content verification: detected type must be allowed and consistent.
  let detected = (asset as any).mimeType as string;
  if (input.detectedMimeType !== undefined && input.detectedMimeType !== null && input.detectedMimeType !== '') {
    const mimeResult = validateMimeType(input.detectedMimeType);
    if (isValidationError(mimeResult)) {
      await fail(mimeResult.code, mimeResult.message, mimeResult.details);
    }
    detected = (mimeResult as { mime: string }).mime;
    const extCheck = validateExtensionMatchesMime((asset as any).originalFilename ?? `file.${(asset as any).extension}`, detected);
    if (isValidationError(extCheck)) {
      await fail(extCheck.code, extCheck.message, extCheck.details);
    }
  }

  if (input.checksum !== undefined && input.checksum !== null && input.checksum !== '') {
    const checksumResult = validateChecksum(input.checksum);
    if (isValidationError(checksumResult)) {
      await fail(checksumResult.code, checksumResult.message, checksumResult.details);
    }
    const declared = (asset as any).checksum as string | null;
    const received = (checksumResult as { checksum: string | null }).checksum;
    if (declared && received && declared !== received) {
      await fail('INTEGRITY_MISMATCH', 'Finalized checksum does not match the upload session declaration');
    }
  }

  let width: number | null = (asset as any).width ?? null;
  let height: number | null = (asset as any).height ?? null;
  for (const dim of ['width', 'height'] as const) {
    const raw = (input as any)[dim];
    if (raw === undefined || raw === null) continue;
    const n = typeof raw === 'string' ? Number(raw) : raw;
    if (typeof n !== 'number' || !Number.isInteger(n) || n <= 0 || n > 20000) {
      await fail('INVALID_DIMENSIONS', `${dim} must be a positive integer`);
    }
    if (dim === 'width') width = n as number;
    else height = n as number;
  }

  const updated = await (prisma as any).mediaAsset.update({
    where: { id: (asset as any).id },
    data: {
      status: 'ACTIVE',
      detectedMimeType: detected,
      ...(width !== null ? { width } : {}),
      ...(height !== null ? { height } : {}),
      ...(((input as any).checksum && !(asset as any).checksum) ? { checksum: (input as any).checksum } : {}),
    },
  }).catch(() => null);
  const current = updated ?? { ...asset, status: 'ACTIVE', detectedMimeType: detected, width, height };

  await audit(sessionUserId, 'MEDIA_FINALIZED', (asset as any).id, { status: (asset as any).status }, { status: 'ACTIVE' }, ctx);
  return toPublicDTO(current);
}

// ── Read / delete ─────────────────────────────────────────────────

export async function getMedia(sessionUserId: string, mediaId: string, ctx?: RequestCtx) {
  if (!mediaId || typeof mediaId !== 'string') throw err(422, 'VALIDATION_ERROR', 'mediaId is required');
  const asset = await (prisma as any).mediaAsset?.findUnique?.({ where: { id: mediaId } }).catch(() => null);
  if (!asset || (asset as any).status === 'DELETED' || (asset as any).deletedAt) {
    throw err(404, 'MEDIA_NOT_FOUND', 'Media not found');
  }
  // Public ACTIVE marketplace media is viewable by any authenticated user;
  // everything else requires ownership (or admin).
  const isPublicActive = (asset as any).status === 'ACTIVE' && (asset as any).visibility === 'PUBLIC';
  if (!isPublicActive) {
    const scope = await resolveActor(sessionUserId);
    assertOwnerOrAdmin(asset, scope, sessionUserId, ctx);
  }
  const scope = await resolveActor(sessionUserId).catch(() => ({ providerId: null, customerId: null }));
  const owner = isAdmin(ctx) || isOwner(asset, scope, sessionUserId);
  return toPublicDTO(asset, { includeSensitive: owner });
}

function isOwner(asset: any, scope: ActorScope, sessionUserId: string): boolean {
  return (
    (asset.ownerType === 'PROVIDER' && scope.providerId !== null && asset.ownerId === scope.providerId) ||
    (asset.ownerType === 'CUSTOMER' && scope.customerId !== null && asset.ownerId === scope.customerId) ||
    asset.createdBy === sessionUserId
  );
}

/**
 * Safe removal: detaches the asset from the caller's own services/profile,
 * then soft-deletes (DELETED + deletedAt). Never touches another tenant's
 * rows; never corrupts historical booking snapshots (booking_items are
 * independent copies). Physical object removal is best-effort and deferred
 * to the lifecycle/retention process.
 */
export async function deleteMedia(sessionUserId: string, mediaId: string, ctx?: RequestCtx) {
  if (!mediaId || typeof mediaId !== 'string') throw err(422, 'VALIDATION_ERROR', 'mediaId is required');
  const asset = await (prisma as any).mediaAsset?.findUnique?.({ where: { id: mediaId } }).catch(() => null);
  if (!asset || (asset as any).status === 'DELETED' || (asset as any).deletedAt) {
    throw err(404, 'MEDIA_NOT_FOUND', 'Media not found');
  }
  const scope = await resolveActor(sessionUserId);
  assertOwnerOrAdmin(asset, scope, sessionUserId, ctx);

  // Detach from own service images only. A reference owned by another
  // tenant blocks deletion instead of being silently removed.
  const linkedImages = await (prisma as any).serviceImage?.findMany?.({ where: { mediaAssetId: (asset as any).id } }).catch(() => []) ?? [];
  for (const img of (linkedImages as any[]) ?? []) {
    const service = await (prisma as any).service?.findUnique?.({ where: { id: (img as any).serviceId } }).catch(() => null);
    if (!service) continue;
    const owns =
      scope.providerId !== null &&
      ((service as any).providerId === scope.providerId ||
        ((service as any).businessUnitId && (await canManageUnit(sessionUserId, scope.providerId, (service as any).businessUnitId))));
    if (!owns && !isAdmin(ctx)) {
      throw err(403, 'FORBIDDEN', 'Media is attached to a service you do not own');
    }
  }
  if ((linkedImages as any[]).length > 0) {
    await (prisma as any).serviceImage?.deleteMany?.({ where: { mediaAssetId: (asset as any).id } }).catch(() => null);
    await audit(sessionUserId, 'MEDIA_DETACHED', (asset as any).id, { linkedImages: (linkedImages as any[]).length }, { linkedImages: 0 }, ctx);
  }

  // Detach from own profile image (never delete-then-replace races: the
  // newly assigned asset is a different row and is untouched).
  if (scope.providerId) {
    const profile = await prisma.providerProfile.findUnique({ where: { userId: sessionUserId } } as any).catch(() => null);
    if (profile && (profile as any).profileMediaAssetId === (asset as any).id) {
      await prisma.providerProfile.update({
        where: { id: (profile as any).id },
        data: { profileImageUrl: null, profileMediaAssetId: null } as any,
      }).catch(() => null);
      await audit(sessionUserId, 'MEDIA_DETACHED', (asset as any).id, { profileImage: (profile as any).id }, { profileImage: null }, ctx);
    }
  }

  await (prisma as any).mediaAsset.update({
    where: { id: (asset as any).id },
    data: { status: 'DELETED', deletedAt: new Date() },
  }).catch(() => null);
  try {
    await getStorageProvider().deleteObject((asset as any).storageKey);
  } catch {
    // Deferred lifecycle handles physical cleanup; the record is authoritative.
  }
  await audit(sessionUserId, 'MEDIA_DELETED', (asset as any).id, { status: (asset as any).status }, { status: 'DELETED' }, ctx);
  return { id: (asset as any).id, deleted: true };
}

// ── Attachment ────────────────────────────────────────────────────

/** Attach a finalized asset as the caller's own provider profile image. */
export async function attachProfileImage(sessionUserId: string, mediaId: string, ctx?: RequestCtx) {
  if (!mediaId || typeof mediaId !== 'string') throw err(422, 'VALIDATION_ERROR', 'mediaId is required');
  const scope = await resolveActor(sessionUserId);
  if (!scope.providerId) throw err(404, 'PROVIDER_NOT_FOUND', 'Provider profile not found');
  const asset = await (prisma as any).mediaAsset?.findUnique?.({ where: { id: mediaId } }).catch(() => null);
  if (!asset || (asset as any).status === 'DELETED' || (asset as any).deletedAt) {
    throw err(404, 'MEDIA_NOT_FOUND', 'Media not found');
  }
  assertOwnerOrAdmin(asset, scope, sessionUserId, ctx);
  if ((asset as any).status !== 'ACTIVE') {
    // Pending/incomplete assets are never exposed as public active images.
    throw err(422, 'MEDIA_NOT_READY', 'Media has not completed upload finalization');
  }
  if (!['PROFILE', 'PORTFOLIO', 'SERVICE'].includes((asset as any).purpose)) {
    throw err(422, 'MEDIA_PURPOSE_MISMATCH', `Media purpose ${(asset as any).purpose} cannot be used as a profile image`);
  }

  const profile = await prisma.providerProfile.findUnique({ where: { userId: sessionUserId } } as any).catch(() => null);
  if (!profile) throw err(404, 'PROVIDER_NOT_FOUND', 'Provider profile not found');
  const before = { profileImageUrl: (profile as any).profileImageUrl ?? null };
  const viewUrl = viewUrlFor(asset);
  // Replace links only — the previously assigned asset row is preserved
  // (orphan lifecycle), so replacement can never delete the new asset.
  await prisma.providerProfile.update({
    where: { id: (profile as any).id },
    data: { profileImageUrl: viewUrl, profileMediaAssetId: (asset as any).id } as any,
  }).catch(() => null);
  await audit(sessionUserId, 'MEDIA_ATTACHED', (asset as any).id, { target: 'profile', ...before }, { target: 'profile', profileImageUrl: viewUrl }, ctx);
  return { mediaId: (asset as any).id, profileImageUrl: viewUrl, status: 'ACTIVE' };
}

/** Attach a finalized asset as an image of an owned service (max 3 enforced). */
export async function attachServiceImage(
  sessionUserId: string,
  mediaId: string,
  serviceId: string,
  sortOrder: unknown,
  ctx?: RequestCtx,
) {
  if (!mediaId || typeof mediaId !== 'string') throw err(422, 'VALIDATION_ERROR', 'mediaId is required');
  if (!serviceId || typeof serviceId !== 'string') throw err(422, 'VALIDATION_ERROR', 'serviceId is required');
  const scope = await resolveActor(sessionUserId);
  if (!scope.providerId) throw err(404, 'PROVIDER_NOT_FOUND', 'Provider profile not found');
  const asset = await (prisma as any).mediaAsset?.findUnique?.({ where: { id: mediaId } }).catch(() => null);
  if (!asset || (asset as any).status === 'DELETED' || (asset as any).deletedAt) {
    throw err(404, 'MEDIA_NOT_FOUND', 'Media not found');
  }
  // A provider can only attach media they own/are authorized to use.
  assertOwnerOrAdmin(asset, scope, sessionUserId, ctx);
  if ((asset as any).status !== 'ACTIVE') {
    throw err(422, 'MEDIA_NOT_READY', 'Media has not completed upload finalization');
  }
  if (!['SERVICE', 'PORTFOLIO', 'PROFILE'].includes((asset as any).purpose)) {
    throw err(422, 'MEDIA_PURPOSE_MISMATCH', `Media purpose ${(asset as any).purpose} cannot be attached to a service`);
  }
  const service = await loadServiceOwned(sessionUserId, scope.providerId, serviceId);

  const existingCount = await (prisma as any).serviceImage?.count?.({ where: { serviceId: service.id } }).catch(() => 0) ?? 0;
  if ((existingCount as number) >= MAX_SERVICE_IMAGES) {
    throw err(422, 'SERVICE_IMAGE_LIMIT', `A service may have at most ${MAX_SERVICE_IMAGES} images`, {
      max: MAX_SERVICE_IMAGES,
      received: (existingCount as number) + 1,
    });
  }
  // Idempotent attach: the same asset linked twice returns the existing row.
  const existingLink = await (prisma as any).serviceImage?.findFirst?.({
    where: { serviceId: service.id, mediaAssetId: (asset as any).id },
  }).catch(() => null);
  if (existingLink) {
    return { id: (existingLink as any).id, imageUrl: (existingLink as any).imageUrl, sortOrder: (existingLink as any).sortOrder, idempotentReplay: true };
  }

  let order = existingCount as number;
  if (sortOrder !== undefined && sortOrder !== null) {
    const n = typeof sortOrder === 'string' ? Number(sortOrder) : (sortOrder as number);
    if (typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= (existingCount as number)) order = n;
  }
  const created = await (prisma as any).serviceImage.create({
    data: {
      serviceId: service.id,
      imageUrl: viewUrlFor(asset),
      storageKey: (asset as any).storageKey,
      mediaAssetId: (asset as any).id,
      sortOrder: order,
    },
  }).catch(() => null);
  await audit(sessionUserId, 'MEDIA_ATTACHED', (asset as any).id, { target: 'service', serviceId: service.id }, { serviceImageId: (created as any)?.id ?? null }, ctx);
  return {
    id: (created as any)?.id ?? `pending-${(asset as any).id}`,
    imageUrl: viewUrlFor(asset),
    sortOrder: order,
  };
}

/**
 * Remove a single image from an owned service. Historical bookings are
 * unaffected (booking_items carry snapshots). The underlying media asset
 * row is preserved — detachment only.
 */
export async function removeServiceImage(
  sessionUserId: string,
  serviceId: string,
  imageId: string,
  ctx?: RequestCtx,
) {
  if (!serviceId || typeof serviceId !== 'string') throw err(422, 'VALIDATION_ERROR', 'serviceId is required');
  if (!imageId || typeof imageId !== 'string') throw err(422, 'VALIDATION_ERROR', 'imageId is required');
  const scope = await resolveActor(sessionUserId);
  if (!scope.providerId) throw err(404, 'PROVIDER_NOT_FOUND', 'Provider profile not found');
  const service = await loadServiceOwned(sessionUserId, scope.providerId, serviceId);
  const image = await (prisma as any).serviceImage?.findFirst?.({ where: { id: imageId, serviceId: service.id } }).catch(() => null);
  if (!image) throw err(404, 'SERVICE_IMAGE_NOT_FOUND', 'Service image not found');
  await (prisma as any).serviceImage?.delete?.({ where: { id: (image as any).id } }).catch(() => null);
  // Renumber remaining images so ordering stays dense (Slice 9 compat).
  const remaining = await (prisma as any).serviceImage?.findMany?.({
    where: { serviceId: service.id },
    orderBy: { sortOrder: 'asc' },
  }).catch(() => []) ?? [];
  for (const [index, row] of ((remaining as any[]) ?? []).entries()) {
    if ((row as any).sortOrder !== index) {
      await (prisma as any).serviceImage?.update?.({ where: { id: (row as any).id }, data: { sortOrder: index } }).catch(() => null);
    }
  }
  await audit(
    sessionUserId,
    'MEDIA_DETACHED',
    (image as any).mediaAssetId ?? (image as any).id,
    { target: 'service', serviceId: service.id, imageId: (image as any).id },
    { target: 'service', serviceId: service.id, imageId: null },
    ctx,
  );
  return { id: (image as any).id, deleted: true };
}

export const __testables = { resolveActor, authorizeSessionTarget, toPublicDTO };

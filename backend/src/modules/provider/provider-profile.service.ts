/**
 * Slice 10 — Provider profile management.
 *
 * Authenticated providers view and safely update their OWN profile via
 * GET/PATCH /api/v1/providers/me. Ownership ALWAYS comes from the
 * authenticated session (userId). Client-supplied providerId / userId are
 * never accepted as ownership selectors.
 *
 * Editable (explicit allowlist):
 * - displayName, bio, experienceSummary, customRequestsEnabled,
 *   profileImageUrl (reference-only; existing media/storage abstraction
 *   remains the source of truth — no new storage system here).
 *
 * Protected (presence in body => 422 VALIDATION_ERROR):
 * id, userId, tierId, providerType, verificationStatus, isStudent,
 * studentVerificationStatus, status, coverageRadiusKm, acceptCash,
 * commission/rate/cap fields, role escalation fields, timestamps.
 *
 * Dedicated endpoints remain authoritative for their domains:
 * - coverage ......... PUT /providers/me/coverage
 * - cash acceptance .. PUT /finance/cash-acceptance
 * - student verify ... finance/student-request
 * - tier ............. server/admin controlled
 *
 * Blueprint notes: tiers are capability tiers (no ranking preference),
 * Student is a verified status (never a selectable tier), commission values
 * are configurable (never hard-coded here).
 */

import { prisma } from '../../config/prisma';
import { getStorageProvider } from '../../infrastructure/storage';

export const MAX_DISPLAY_NAME_LENGTH = 80;
export const MIN_DISPLAY_NAME_LENGTH = 2;
export const MAX_BIO_LENGTH = 2000;
export const MAX_EXPERIENCE_LENGTH = 2000;
export const MAX_IMAGE_URL_LENGTH = 2048;

/** Client-mutable fields. Anything outside this set is rejected. */
export const EDITABLE_FIELDS = new Set([
  'displayName',
  'bio',
  'experienceSummary',
  'customRequestsEnabled',
  'profileImageUrl',
  // Slice 11 — link a finalized media asset the caller owns. The asset id
  // is verified server-side (ACTIVE + owned) and resolved to a
  // credential-free view URL; raw keys never travel through this endpoint.
  'profileMediaAssetId',
]);

/** Fields a client must never set through this endpoint. Presence => 422. */
export const FORBIDDEN_PROFILE_FIELDS = [
  'id',
  'userId',
  'providerId',
  'tenantId',
  'tierId',
  'tier',
  'providerType',
  'verificationStatus',
  'isStudent',
  'studentVerificationStatus',
  'status',
  'coverageRadiusKm',
  'acceptCash',
  'commission',
  'commissionRate',
  'commissionAmount',
  'cashCap',
  'cashLimit',
  'outstandingCommission',
  'role',
  'roles',
  'email',
  'password',
  'passwordHash',
  'createdAt',
  'updatedAt',
  'deletedAt',
];

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

/** Strip HTML tags so stored text can never carry executable markup. */
export function sanitizeText(value: string): string {
  return value.replace(/<[^>]*>/g, '').trim();
}

/** Reject forbidden/unknown keys before any other validation. */
export function assertNoMassAssignment(body: Record<string, unknown>): void {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw err(422, 'VALIDATION_ERROR', 'Request body must be an object');
  }
  const forbidden = FORBIDDEN_PROFILE_FIELDS.filter((k) => k in body);
  if (forbidden.length > 0) {
    throw err(422, 'VALIDATION_ERROR', `Fields not allowed: ${forbidden.join(', ')}`, { forbidden });
  }
  const unknown = Object.keys(body).filter((k) => !EDITABLE_FIELDS.has(k));
  if (unknown.length > 0) {
    throw err(422, 'VALIDATION_ERROR', `Unknown fields: ${unknown.join(', ')}`, { unknown });
  }
}

function validateDisplayName(raw: unknown): string {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw err(422, 'VALIDATION_ERROR', 'displayName is required');
  }
  const clean = sanitizeText(raw);
  if (clean.length < MIN_DISPLAY_NAME_LENGTH) {
    throw err(422, 'VALIDATION_ERROR', `displayName must be at least ${MIN_DISPLAY_NAME_LENGTH} characters`);
  }
  if (clean.length > MAX_DISPLAY_NAME_LENGTH) {
    throw err(422, 'VALIDATION_ERROR', `displayName must be at most ${MAX_DISPLAY_NAME_LENGTH} characters`);
  }
  return clean;
}

function validateOptionalText(raw: unknown, field: 'bio' | 'experienceSummary', max: number): string | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== 'string') {
    throw err(422, 'VALIDATION_ERROR', `${field} must be a string`);
  }
  if (raw.length > max) {
    throw err(422, 'VALIDATION_ERROR', `${field} must be at most ${max} characters`);
  }
  const clean = sanitizeText(raw);
  return clean.length === 0 ? null : clean;
}

function validateCustomRequestsEnabled(raw: unknown): boolean {
  if (typeof raw !== 'boolean') {
    throw err(422, 'VALIDATION_ERROR', 'customRequestsEnabled must be a boolean');
  }
  return raw;
}

/**
 * Reference-only image handling. The existing media/storage abstraction
 * remains the source of truth: this endpoint stores a reference string only.
 * Raw binary (data: URIs), credential-bearing URLs, and non-http schemes are
 * rejected. Upload wiring is deferred — see deferred docs in route file.
 */
function validateProfileImageUrl(raw: unknown): string | null {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw !== 'string') {
    throw err(422, 'VALIDATION_ERROR', 'profileImageUrl must be a string');
  }
  const url = raw.trim();
  if (url.length === 0) return null;
  if (url.length > MAX_IMAGE_URL_LENGTH) {
    throw err(422, 'VALIDATION_ERROR', `profileImageUrl must be at most ${MAX_IMAGE_URL_LENGTH} characters`);
  }
  if (/^data:/i.test(url)) {
    throw err(422, 'UPLOAD_NOT_SUPPORTED', 'profileImageUrl must be a storage reference, not inline binary');
  }
  if (/^(javascript|vbscript|file|blob):/i.test(url)) {
    throw err(422, 'VALIDATION_ERROR', 'profileImageUrl uses a forbidden scheme');
  }
  const absolute = /^https?:\/\//i.test(url);
  const appRelative = url.startsWith('/');
  if (!absolute && !appRelative) {
    throw err(422, 'VALIDATION_ERROR', 'profileImageUrl must be an https URL or app storage reference');
  }
  if (absolute) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw err(422, 'VALIDATION_ERROR', 'profileImageUrl is not a valid URL');
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw err(422, 'VALIDATION_ERROR', 'profileImageUrl uses a forbidden scheme');
    }
    if (parsed.username || parsed.password) {
      throw err(422, 'VALIDATION_ERROR', 'profileImageUrl must not embed credentials');
    }
  }
  return url;
}

export interface ProfilePatch {
  displayName?: string;
  bio?: string | null;
  experienceSummary?: string | null;
  customRequestsEnabled?: boolean;
  profileImageUrl?: string | null;
  profileMediaAssetId?: string | null;
}

/**
 * Slice 11 — resolve a finalized media asset to a profile image reference.
 * The asset must be ACTIVE and owned by the session provider; otherwise a
 * safe 404 (foreign) or 422 (incomplete) results. Pending uploads are never
 * exposed as profile images.
 */
async function resolveProfileMediaAsset(
  raw: unknown,
  sessionUserId: string,
  providerId: string,
): Promise<{ profileImageUrl: string | null; profileMediaAssetId: string | null }> {
  if (raw === null || raw === undefined || raw === '') {
    return { profileImageUrl: null, profileMediaAssetId: null };
  }
  if (typeof raw !== 'string' || raw.trim().length === 0 || raw.trim().length > 191) {
    throw err(422, 'VALIDATION_ERROR', 'profileMediaAssetId must be a media reference');
  }
  const mediaId = raw.trim();
  const asset = await (prisma as any).mediaAsset?.findUnique?.({ where: { id: mediaId } }).catch(() => null);
  if (!asset || (asset as any).status === 'DELETED' || (asset as any).deletedAt) {
    throw err(404, 'MEDIA_NOT_FOUND', 'Media not found');
  }
  const owned =
    ((asset as any).ownerType === 'PROVIDER' && (asset as any).ownerId === providerId) ||
    (asset as any).createdBy === sessionUserId;
  if (!owned) {
    throw err(404, 'MEDIA_NOT_FOUND', 'Media not found');
  }
  if ((asset as any).status !== 'ACTIVE') {
    throw err(422, 'MEDIA_NOT_READY', 'Media has not completed upload finalization');
  }
  if (!['PROFILE', 'PORTFOLIO', 'SERVICE'].includes((asset as any).purpose)) {
    throw err(422, 'MEDIA_PURPOSE_MISMATCH', `Media purpose ${(asset as any).purpose} cannot be used as a profile image`);
  }
  const viewUrl = getStorageProvider().buildViewUrl({
    storageKey: (asset as any).storageKey,
    visibility: (asset as any).visibility === 'PRIVATE' ? 'private' : 'public',
  });
  return { profileImageUrl: viewUrl, profileMediaAssetId: (asset as any).id };
}

/** Validate the PATCH body against the allowlist. PATCH semantics: supplied fields only. */
export async function validateProfilePatch(body: Record<string, unknown>, sessionUserId?: string): Promise<ProfilePatch> {
  assertNoMassAssignment(body);
  if (Object.keys(body).length === 0) {
    throw err(422, 'VALIDATION_ERROR', 'At least one editable field is required');
  }
  const out: ProfilePatch = {};
  if ('displayName' in body) out.displayName = validateDisplayName(body.displayName);
  if ('bio' in body) out.bio = validateOptionalText(body.bio, 'bio', MAX_BIO_LENGTH);
  if ('experienceSummary' in body) {
    out.experienceSummary = validateOptionalText(body.experienceSummary, 'experienceSummary', MAX_EXPERIENCE_LENGTH);
  }
  if ('customRequestsEnabled' in body) out.customRequestsEnabled = validateCustomRequestsEnabled(body.customRequestsEnabled);
  if ('profileImageUrl' in body) out.profileImageUrl = validateProfileImageUrl(body.profileImageUrl);
  if ('profileMediaAssetId' in body) {
    // Media-linked assignment requires an authenticated session so ownership
    // can be derived server-side — never from client-supplied ids.
    if (!sessionUserId) {
      throw err(401, 'UNAUTHORIZED', 'Authentication required');
    }
    const owner = await prisma.providerProfile.findUnique({ where: { userId: sessionUserId } } as any).catch(() => null);
    if (!owner) throw err(404, 'PROVIDER_NOT_FOUND', 'Provider profile not found');
    const resolved = await resolveProfileMediaAsset(body.profileMediaAssetId, sessionUserId, (owner as any).id);
    out.profileImageUrl = resolved.profileImageUrl;
    out.profileMediaAssetId = resolved.profileMediaAssetId;
  }
  return out;
}

/**
 * Public DTO. Returns read-only operational fields (tier, verification,
 * status, coverage, cash acceptance display) for the UI but never exposes
 * commission internals, secrets, or auth material.
 */
export function toProfileDTO(p: any) {
  return {
    id: p.id as string,
    userId: p.userId as string,
    displayName: (p.displayName as string | null) ?? null,
    bio: (p.bio as string | null) ?? null,
    profileImageUrl: (p.profileImageUrl as string | null) ?? null,
    profileMediaAssetId: (p.profileMediaAssetId as string | null) ?? null,
    experienceSummary: (p.experienceSummary as string | null) ?? null,
    customRequestsEnabled: Boolean(p.customRequestsEnabled),
    // Read-only operational context (editable only via dedicated endpoints / admin)
    providerType: (p.providerType as string) ?? null,
    verificationStatus: (p.verificationStatus as string) ?? null,
    isStudent: Boolean(p.isStudent),
    studentVerificationStatus: (p.studentVerificationStatus as string) ?? null,
    status: (p.status as string) ?? null,
    coverageRadiusKm: (p.coverageRadiusKm as number) ?? null,
    acceptCash: p.acceptCash === undefined ? undefined : Boolean(p.acceptCash),
    timezone: (p.timezone as string) ?? null,
    tier: p.tier
      ? { id: p.tier.id as string, code: p.tier.code as string, name: p.tier.name as string }
      : null,
    createdAt: p.createdAt instanceof Date ? p.createdAt.toISOString() : String(p.createdAt ?? ''),
    updatedAt: p.updatedAt instanceof Date ? p.updatedAt.toISOString() : String(p.updatedAt ?? ''),
  };
}

async function audit(
  actorUserId: string,
  action: string,
  entityId: string,
  beforeJson: unknown,
  afterJson: unknown,
  ctx?: { ip?: string; userAgent?: string },
) {
  try {
    await prisma.auditLog.create({
      data: {
        actorUserId,
        action,
        entityType: 'provider_profile',
        entityId,
        beforeJson: (beforeJson ?? undefined) as any,
        afterJson: (afterJson ?? undefined) as any,
        ipAddress: ctx?.ip,
        userAgent: ctx?.userAgent,
      },
    });
  } catch {
    // Audit failures must never break profile reads/writes.
  }
}

/** Load the session user's own profile. Throws 404 PROVIDER_NOT_FOUND when absent. */
export async function getOwnProfile(sessionUserId: string) {
  const profile = await prisma.providerProfile.findUnique({
    where: { userId: sessionUserId },
    include: { tier: true },
  } as any).catch(() => null);
  if (!profile) throw err(404, 'PROVIDER_NOT_FOUND', 'Provider profile not found');
  return toProfileDTO(profile);
}

/** Validate + apply a profile patch for the session user only. */
export async function patchOwnProfile(
  sessionUserId: string,
  body: Record<string, unknown>,
  ctx?: { ip?: string; userAgent?: string },
) {
  const patch = await validateProfilePatch(body, sessionUserId);
  const existing = await prisma.providerProfile.findUnique({
    where: { userId: sessionUserId },
    include: { tier: true },
  } as any).catch(() => null);
  if (!existing) throw err(404, 'PROVIDER_NOT_FOUND', 'Provider profile not found');

  const before = toProfileDTO(existing);
  const updated = await prisma.providerProfile.update({
    where: { id: (existing as any).id },
    data: patch as any,
    include: { tier: true },
  } as any).catch(() => null);
  if (!updated) throw err(404, 'PROVIDER_NOT_FOUND', 'Provider profile not found');
  const after = toProfileDTO(updated);

  await audit(
    sessionUserId,
    'PROVIDER_PROFILE_UPDATED',
    (existing as any).id,
    {
      displayName: before.displayName,
      bio: before.bio,
      experienceSummary: before.experienceSummary,
      customRequestsEnabled: before.customRequestsEnabled,
      profileImageUrl: before.profileImageUrl,
    },
    {
      displayName: after.displayName,
      bio: after.bio,
      experienceSummary: after.experienceSummary,
      customRequestsEnabled: after.customRequestsEnabled,
      profileImageUrl: after.profileImageUrl,
    },
    ctx,
  );
  return after;
}

/**
 * Slice 11 — Media API (/api/v1/media).
 *
 * Blueprint Document 12 §37 (subset implemented for launch):
 *   POST   /api/v1/media/upload-sessions
 *   POST   /api/v1/media/:mediaId/finalize
 *   GET    /api/v1/media/:mediaId
 *   DELETE /api/v1/media/:mediaId
 *   POST   /api/v1/media/:mediaId/attach-profile
 *   POST   /api/v1/media/:mediaId/attach-service
 *
 * All endpoints require authentication. Ownership derives from the
 * session; responses use the standard { success, data, error, meta }
 * envelope and never expose internal errors, credentials, or secrets.
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth';

const router = Router();

// All /media/* require authentication.
router.use(authMiddleware);

function mediaError(res: Response, err: any, fallback: string) {
  if (err && typeof err.status === 'number') {
    return res.status(err.status).json({
      success: false,
      error: {
        code: err.code ?? 'ERROR',
        message: err.message,
        ...(err.details !== undefined ? { details: err.details } : {}),
      },
    });
  }
  return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: fallback } });
}

/**
 * Request context for media operations: request metadata only.
 *
 * ADMIN authority is NEVER derived here. The service resolves current
 * ADMIN authority from the database (user_roles → roles) using the
 * authenticated session user id on every protected call, so revocation
 * takes effect on the next request even when the JWT still carries a
 * stale `roles` claim. JWT `roles` claims are identity metadata only —
 * never authorization.
 */
function mediaCtx(req: Request) {
  return { ip: req.ip, userAgent: req.headers['user-agent'] as string | undefined };
}

const uploadSessionSchema = z.object({
  purpose: z.string(),
  targetId: z.string().max(191).optional().nullable(),
  filename: z.string().max(255).optional().nullable(),
  contentType: z.string().max(191),
  sizeBytes: z.union([z.number(), z.string()]),
  checksum: z.string().max(128).optional().nullable(),
}).strict();

const finalizeSchema = z.object({
  sizeBytes: z.union([z.number(), z.string()]).optional().nullable(),
  checksum: z.string().max(128).optional().nullable(),
  detectedMimeType: z.string().max(191).optional().nullable(),
  width: z.union([z.number(), z.string()]).optional().nullable(),
  height: z.union([z.number(), z.string()]).optional().nullable(),
}).strict();

const attachServiceSchema = z.object({
  serviceId: z.string().min(1).max(191),
  sortOrder: z.union([z.number(), z.string()]).optional().nullable(),
}).strict();

function zodError(res: Response, error: z.ZodError, fallbackCode = 'VALIDATION_ERROR') {
  return res.status(422).json({
    success: false,
    error: { code: fallbackCode, message: 'Invalid request', details: error.flatten() },
  });
}

// POST /api/v1/media/upload-sessions — controlled upload session.
router.post('/upload-sessions', async (req: Request, res: Response) => {
  const parsed = uploadSessionSchema.safeParse(req.body ?? {});
  if (!parsed.success) return zodError(res, parsed.error);
  try {
    const svc = await import('./media.service');
    const data = await svc.createUploadSession(
      req.authUser!.userId,
      parsed.data as unknown as Record<string, unknown>,
      mediaCtx(req),
    );
    return res.status(201).json({ success: true, data });
  } catch (err: any) {
    return mediaError(res, err, 'Failed to create upload session');
  }
});

// POST /api/v1/media/:mediaId/attach-profile — link finalized media to own profile.
router.post('/:mediaId/attach-profile', async (req: Request, res: Response) => {
  const mediaId = req.params.mediaId as string;
  if (!mediaId) {
    return res.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'mediaId is required' } });
  }
  try {
    const svc = await import('./media.service');
    const data = await svc.attachProfileImage(req.authUser!.userId, mediaId, mediaCtx(req));
    return res.json({ success: true, data });
  } catch (err: any) {
    return mediaError(res, err, 'Failed to attach profile image');
  }
});

// POST /api/v1/media/:mediaId/attach-service — link finalized media to an owned service.
router.post('/:mediaId/attach-service', async (req: Request, res: Response) => {
  const mediaId = req.params.mediaId as string;
  if (!mediaId) {
    return res.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'mediaId is required' } });
  }
  const parsed = attachServiceSchema.safeParse(req.body ?? {});
  if (!parsed.success) return zodError(res, parsed.error);
  try {
    const svc = await import('./media.service');
    const data = await svc.attachServiceImage(
      req.authUser!.userId,
      mediaId,
      parsed.data.serviceId,
      parsed.data.sortOrder ?? undefined,
      mediaCtx(req),
    );
    return res.status(201).json({ success: true, data });
  } catch (err: any) {
    return mediaError(res, err, 'Failed to attach service image');
  }
});

// POST /api/v1/media/:mediaId/finalize — verify + promote to ACTIVE (idempotent).
router.post('/:mediaId/finalize', async (req: Request, res: Response) => {
  const mediaId = req.params.mediaId as string;
  if (!mediaId) {
    return res.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'mediaId is required' } });
  }
  const parsed = finalizeSchema.safeParse((req.body ?? {}) as unknown);
  if (!parsed.success) return zodError(res, parsed.error);
  try {
    const svc = await import('./media.service');
    const data = await svc.finalizeMedia(
      req.authUser!.userId,
      mediaId,
      parsed.data as unknown as Record<string, unknown>,
      mediaCtx(req),
    );
    return res.json({ success: true, data });
  } catch (err: any) {
    return mediaError(res, err, 'Failed to finalize upload');
  }
});

// GET /api/v1/media/:mediaId — authorized metadata + view URL.
router.get('/:mediaId', async (req: Request, res: Response) => {
  const mediaId = req.params.mediaId as string;
  if (!mediaId) {
    return res.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'mediaId is required' } });
  }
  try {
    const svc = await import('./media.service');
    const data = await svc.getMedia(req.authUser!.userId, mediaId, mediaCtx(req));
    return res.json({ success: true, data });
  } catch (err: any) {
    return mediaError(res, err, 'Failed to load media');
  }
});

// DELETE /api/v1/media/:mediaId — authorized soft-delete with safe detach.
router.delete('/:mediaId', async (req: Request, res: Response) => {
  const mediaId = req.params.mediaId as string;
  if (!mediaId) {
    return res.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'mediaId is required' } });
  }
  try {
    const svc = await import('./media.service');
    const data = await svc.deleteMedia(req.authUser!.userId, mediaId, mediaCtx(req));
    return res.json({ success: true, data });
  } catch (err: any) {
    return mediaError(res, err, 'Failed to delete media');
  }
});

export default router;

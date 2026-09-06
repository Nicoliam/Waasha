import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authMiddleware } from '../../middleware/auth';
import './inapp.provider'; // self-registers the IN_APP delivery adapter
import {
  listNotifications,
  unreadCount,
  markNotificationRead,
  markAllNotificationsRead,
  getPreferences,
  setPreference,
} from './notification.service';

const router = Router();

// All notification endpoints require auth; recipient always comes from session.
router.use(authMiddleware);

function safeError(err: unknown, fallback: string) {
  const e = err as { status?: number; code?: string; message?: string; details?: unknown };
  if (e?.status) {
    return { status: e.status, body: { success: false, error: { code: e.code ?? 'ERROR', message: e.message, details: e.details } } };
  }
  return { status: 500, body: { success: false, error: { code: 'INTERNAL_ERROR', message: fallback } } };
}

// GET /api/v1/notifications?page&perPage&unreadOnly
router.get('/', async (req: Request, res: Response) => {
  const authUser = req.authUser!;
  const schema = z.object({
    page: z.coerce.number().int().min(1).default(1),
    perPage: z.coerce.number().int().min(1).max(50).default(20),
    unreadOnly: z.coerce.boolean().optional().default(false),
  });
  const parsed = schema.safeParse(req.query as unknown);
  if (!parsed.success) {
    return res.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid query', details: parsed.error.flatten() } });
  }
  try {
    const result = await listNotifications(authUser.userId, parsed.data);
    return res.json({ success: true, data: result.notifications, meta: result.meta });
  } catch (err: unknown) {
    const { status, body } = safeError(err, 'Failed to load notifications');
    return res.status(status).json(body);
  }
});

// GET /api/v1/notifications/unread-count — before /:id so it is never shadowed
router.get('/unread-count', async (req: Request, res: Response) => {
  const authUser = req.authUser!;
  try {
    return res.json({ success: true, data: await unreadCount(authUser.userId) });
  } catch (err: unknown) {
    const { status, body } = safeError(err, 'Failed to load unread count');
    return res.status(status).json(body);
  }
});

// GET /api/v1/notifications/preferences — before /:id so it is never shadowed
router.get('/preferences', async (req: Request, res: Response) => {
  const authUser = req.authUser!;
  try {
    return res.json({ success: true, data: await getPreferences(authUser.userId) });
  } catch (err: unknown) {
    const { status, body } = safeError(err, 'Failed to load preferences');
    return res.status(status).json(body);
  }
});

// PUT /api/v1/notifications/preferences
router.put('/preferences', async (req: Request, res: Response) => {
  const authUser = req.authUser!;
  const schema = z.object({
    channel: z.string().min(1).max(32),
    notificationType: z.string().min(1).max(32),
    isEnabled: z.boolean(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Invalid body', details: parsed.error.flatten() } });
  }
  try {
    const result = await setPreference(authUser.userId, parsed.data);
    return res.json({ success: true, data: result });
  } catch (err: unknown) {
    const { status, body } = safeError(err, 'Failed to save preference');
    return res.status(status).json(body);
  }
});

// POST /api/v1/notifications/read-all
router.post('/read-all', async (req: Request, res: Response) => {
  const authUser = req.authUser!;
  try {
    return res.json({ success: true, data: await markAllNotificationsRead(authUser.userId) });
  } catch (err: unknown) {
    const { status, body } = safeError(err, 'Failed to mark notifications read');
    return res.status(status).json(body);
  }
});

async function handleMarkRead(req: Request, res: Response) {
  const authUser = req.authUser!;
  const id = req.params.id as string;
  if (!id) return res.status(422).json({ success: false, error: { code: 'VALIDATION_ERROR', message: 'Notification id required' } });
  try {
    return res.json({ success: true, data: await markNotificationRead(authUser.userId, id) });
  } catch (err: unknown) {
    const { status, body } = safeError(err, 'Failed to mark notification read');
    return res.status(status).json(body);
  }
}

// PATCH is canonical per blueprint; POST is accepted for client compatibility.
router.patch('/:id/read', handleMarkRead);
router.post('/:id/read', handleMarkRead);

export default router;

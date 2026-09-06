import { prisma } from '../../config/prisma';
import {
  NotificationChannel,
  NotificationCategory,
  NotificationIntent,
  DeliveryReceipt,
  TRANSACTIONAL_CATEGORIES,
  categoryForType,
  getNotificationProvider,
} from './notification-provider.interface';

// ── Explicit DTOs (never leak Prisma models) ──────────────────────────

export interface NotificationDto {
  id: string;
  type: string;
  audience: string;
  channel: string;
  status: string;
  title: string;
  message: string;
  entityType: string | null;
  entityId: string | null;
  deepLink: string | null;
  readAt: string | null;
  createdAt: string;
}

export interface PreferenceDto {
  channel: string;
  notificationType: string;
  isEnabled: boolean;
  locked: boolean;
}

function err(status: number, code: string, message: string, details?: unknown): Error {
  const e: Error & { status?: number; code?: string; details?: unknown } = new Error(message);
  e.status = status;
  e.code = code;
  if (details !== undefined) e.details = details;
  return e;
}

/** Client deep link per audience — only to resources the recipient owns. */
export function deepLinkFor(audience: string, entityType: string | null, entityId: string | null): string | null {
  if (!entityType || !entityId || entityType !== 'booking') return null;
  if (audience === 'PROVIDER') return `/provider/bookings/${entityId}`;
  return `/bookings/${entityId}`;
}

function toDto(n: Record<string, unknown>): NotificationDto {
  const audience = String(n.audience ?? 'CUSTOMER');
  const entityType = (n.entityType as string | null) ?? null;
  const entityId = (n.entityId as string | null) ?? null;
  return {
    id: String(n.id),
    type: String(n.type),
    audience,
    channel: String(n.channel ?? 'IN_APP'),
    status: String(n.status ?? 'UNREAD'),
    title: String(n.title),
    message: String(n.message),
    entityType,
    entityId,
    deepLink: deepLinkFor(audience, entityType, entityId),
    readAt: n.readAt ? new Date(n.readAt as string).toISOString() : null,
    createdAt: new Date(n.createdAt as string).toISOString(),
  };
}

async function preferenceEnabled(userId: string, intent: NotificationIntent): Promise<boolean> {
  const category = categoryForType(intent.type);
  try {
    const row = (await prisma.notificationPreference.findUnique({
      where: { userId_channel_notificationType: { userId, channel: 'IN_APP', notificationType: category } },
    } as never)) as unknown as { isEnabled: boolean } | null;
    if (!row) return true; // default: enabled
    // Transactional categories cannot be disabled — a stale/disabled row never suppresses them.
    if (!row.isEnabled && (TRANSACTIONAL_CATEGORIES as string[]).includes(category)) return true;
    return row.isEnabled;
  } catch {
    return true; // fail-open for reads of preference infra; emission itself remains safe
  }
}

/**
 * Emit an IN_APP notification idempotently. Retried/concurrent emission with
 * the same eventKey returns the existing row (UNIQUE constraint) instead of
 * duplicating. Never throws for preference/infra issues — callers wrap in
 * try/catch regardless so domain writes never fail over notifications.
 */
export async function emitNotification(
  intent: NotificationIntent,
): Promise<{ notification: NotificationDto | null; duplicate: boolean; suppressed: boolean }> {
  if (!intent.recipientUserId || !intent.type || !intent.title || !intent.message) {
    throw err(422, 'VALIDATION_ERROR', 'Notification intent requires recipient, type, title and message');
  }
  const enabled = await preferenceEnabled(intent.recipientUserId, intent);
  if (!enabled) return { notification: null, duplicate: false, suppressed: true };

  try {
    const created = (await prisma.notification.create({
      data: {
        recipientUserId: intent.recipientUserId,
        audience: intent.audience,
        type: intent.type,
        channel: 'IN_APP',
        status: 'UNREAD',
        title: intent.title,
        message: intent.message,
        entityType: intent.entityType ?? null,
        entityId: intent.entityId ?? null,
        eventKey: intent.eventKey ?? null,
        metadata: (intent.metadata as never) ?? undefined,
      } as never,
    } as never)) as unknown as Record<string, unknown>;
    return { notification: toDto(created), duplicate: false, suppressed: false };
  } catch (e: unknown) {
    const code = (e as { code?: string })?.code;
    if ((code === 'P2002' || String((e as Error)?.message ?? '').includes('event_key')) && intent.eventKey) {
      const existing = (await prisma.notification.findUnique({
        where: { eventKey: intent.eventKey },
      } as never)) as unknown as Record<string, unknown> | null;
      if (existing) return { notification: toDto(existing), duplicate: true, suppressed: false };
    }
    throw e;
  }
}

/**
 * Deliver an intent through a registered channel adapter (PUSH/EMAIL/…).
 * Architecturally ready but provider-independent: with no adapter registered
 * the intent is skipped, never faked as delivered.
 */
export async function deliverViaChannel(
  channel: NotificationChannel,
  intent: NotificationIntent,
): Promise<DeliveryReceipt> {
  const adapter = getNotificationProvider(channel);
  if (!adapter) return { channel, delivered: false, reason: 'NO_ADAPTER_REGISTERED' };
  return adapter.deliver(intent);
}

async function scopedNotification(id: string, userId: string): Promise<Record<string, unknown>> {
  const row = (await prisma.notification.findUnique({ where: { id } } as never)) as unknown as Record<
    string,
    unknown
  > | null;
  // Safe 404: never reveal another user's notification.
  if (!row || (row.recipientUserId as string) !== userId) {
    throw err(404, 'NOTIFICATION_NOT_FOUND', 'Notification not found');
  }
  return row;
}

export async function listNotifications(
  userId: string,
  query: { page?: number; perPage?: number; unreadOnly?: boolean },
): Promise<{ notifications: NotificationDto[]; meta: { page: number; perPage: number; total: number; unreadCount: number } }> {
  const page = Math.max(1, Math.floor(query.page ?? 1));
  const perPage = Math.min(50, Math.max(1, Math.floor(query.perPage ?? 20)));
  const where: Record<string, unknown> = {
    recipientUserId: userId,
    ...(query.unreadOnly ? { status: 'UNREAD' } : {}),
  };
  const [total, unreadCount, rows] = await Promise.all([
    prisma.notification.count({ where } as never),
    prisma.notification.count({ where: { recipientUserId: userId, status: 'UNREAD' } } as never),
    prisma.notification.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * perPage,
      take: perPage,
    } as never),
  ]);
  return {
    notifications: ((rows as unknown as Array<Record<string, unknown>>) ?? []).map(toDto),
    meta: {
      page,
      perPage,
      total: typeof total === 'number' ? total : 0,
      unreadCount: typeof unreadCount === 'number' ? unreadCount : 0,
    },
  };
}

export async function unreadCount(userId: string): Promise<{ unreadCount: number }> {
  const count = (await prisma.notification.count({
    where: { recipientUserId: userId, status: 'UNREAD' },
  } as never)) as unknown as number;
  return { unreadCount: typeof count === 'number' ? count : 0 };
}

export async function markNotificationRead(userId: string, id: string): Promise<{ notification: NotificationDto }> {
  await scopedNotification(id, userId);
  const updated = (await prisma.notification.update({
    where: { id },
    data: { status: 'READ', readAt: new Date() },
  } as never)) as unknown as Record<string, unknown>;
  return { notification: toDto(updated) };
}

export async function markAllNotificationsRead(userId: string): Promise<{ updated: number }> {
  const result = (await prisma.notification.updateMany({
    where: { recipientUserId: userId, status: 'UNREAD' },
    data: { status: 'READ', readAt: new Date() },
  } as never)) as unknown as { count: number };
  return { updated: result?.count ?? 0 };
}

const ALLOWED_PREFERENCE_TYPES: string[] = ['BOOKING_UPDATES', 'PAYMENT_UPDATES', 'MARKETING'];
const ALLOWED_CHANNELS: string[] = ['IN_APP', 'PUSH', 'EMAIL', 'SMS', 'WHATSAPP'];

export async function getPreferences(userId: string): Promise<{ preferences: PreferenceDto[] }> {
  const rows = (await prisma.notificationPreference.findMany({ where: { userId } } as never)) as unknown as Array<
    Record<string, unknown>
  >;
  const byKey = new Map((rows ?? []).map((r) => [`${String(r.channel)}:${String(r.notificationType)}`, r]));
  const preferences: PreferenceDto[] = [];
  for (const notificationType of ALLOWED_PREFERENCE_TYPES) {
    for (const channel of ['IN_APP', 'PUSH']) {
      const row = byKey.get(`${channel}:${notificationType}`);
      const locked = channel === 'IN_APP' && (TRANSACTIONAL_CATEGORIES as string[]).includes(notificationType);
      preferences.push({
        channel,
        notificationType,
        isEnabled: row ? Boolean(row.isEnabled) || locked : true,
        locked,
      });
    }
  }
  return { preferences };
}

export async function setPreference(
  userId: string,
  input: { channel: string; notificationType: string; isEnabled: boolean },
): Promise<{ preference: PreferenceDto }> {
  const channel = String(input.channel ?? '').toUpperCase();
  const notificationType = String(input.notificationType ?? '').toUpperCase();
  if (!ALLOWED_CHANNELS.includes(channel) || !ALLOWED_PREFERENCE_TYPES.includes(notificationType)) {
    throw err(422, 'VALIDATION_ERROR', 'Invalid channel or notification type');
  }
  // Transactional IN_APP notifications cannot be disabled.
  if (channel === 'IN_APP' && (TRANSACTIONAL_CATEGORIES as string[]).includes(notificationType) && !input.isEnabled) {
    throw err(422, 'PREFERENCE_LOCKED', 'Transactional booking and payment notifications cannot be disabled', {
      channel,
      notificationType,
    });
  }
  const saved = (await prisma.notificationPreference.upsert({
    where: { userId_channel_notificationType: { userId, channel, notificationType } },
    create: { userId, channel, notificationType, isEnabled: input.isEnabled },
    update: { isEnabled: input.isEnabled },
  } as never)) as unknown as Record<string, unknown>;
  return {
    preference: {
      channel: String(saved.channel),
      notificationType: String(saved.notificationType),
      isEnabled: Boolean(saved.isEnabled),
      locked: false,
    },
  };
}

export type { NotificationCategory };

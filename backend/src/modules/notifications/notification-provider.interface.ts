/**
 * Slice 7 — Provider-agnostic notification abstraction.
 *
 * The business domain emits notification INTENTS. Delivery adapters plug in
 * per channel. No third-party notification SDK (Firebase, OneSignal, Twilio,
 * SendGrid, WhatsApp) may be referenced from the domain — only through an
 * adapter implementing NotificationProvider.
 */

export type NotificationChannel = 'IN_APP' | 'PUSH' | 'EMAIL' | 'SMS' | 'WHATSAPP';

/** Canonical notification types. Only events that actually exist server-side. */
export type NotificationType =
  | 'BOOKING_CREATED'
  | 'NEW_BOOKING_REQUEST'
  | 'BOOKING_ACCEPTED'
  | 'BOOKING_DECLINED'
  | 'PAYMENT_PAID'
  | 'PAYMENT_FAILED'
  | 'PAYMENT_EFT_PENDING'
  | 'CASH_RECORDED';

/** Preference categories. Transactional categories cannot be disabled. */
export type NotificationCategory = 'BOOKING_UPDATES' | 'PAYMENT_UPDATES' | 'MARKETING';

export const TRANSACTIONAL_CATEGORIES: NotificationCategory[] = ['BOOKING_UPDATES', 'PAYMENT_UPDATES'];

export function categoryForType(type: NotificationType): NotificationCategory {
  if (type === 'PAYMENT_PAID' || type === 'PAYMENT_FAILED' || type === 'PAYMENT_EFT_PENDING' || type === 'CASH_RECORDED') {
    return 'PAYMENT_UPDATES';
  }
  return 'BOOKING_UPDATES';
}

export interface NotificationIntent {
  recipientUserId: string;
  audience: 'CUSTOMER' | 'PROVIDER';
  type: NotificationType;
  title: string;
  /** Plain text only — clients must render as text, never HTML. */
  message: string;
  entityType?: string | null;
  entityId?: string | null;
  /** Deterministic idempotency key, e.g. booking:<id>:status:ACCEPTED. */
  eventKey?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface DeliveryReceipt {
  channel: NotificationChannel;
  delivered: boolean;
  providerNotificationId?: string | null;
  reason?: string | null;
}

export interface NotificationProvider {
  readonly channel: NotificationChannel;
  deliver(intent: NotificationIntent): Promise<DeliveryReceipt>;
}

/** Adapter registry — future FCM/APNs/Email/SMS adapters register here. */
const registry = new Map<NotificationChannel, NotificationProvider>();

export function registerNotificationProvider(provider: NotificationProvider): void {
  registry.set(provider.channel, provider);
}

export function getNotificationProvider(channel: NotificationChannel): NotificationProvider | null {
  return registry.get(channel) ?? null;
}

export function registeredChannels(): NotificationChannel[] {
  return [...registry.keys()];
}

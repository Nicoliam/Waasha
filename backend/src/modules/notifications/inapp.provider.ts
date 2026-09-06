import {
  NotificationProvider,
  NotificationChannel,
  NotificationIntent,
  DeliveryReceipt,
  registerNotificationProvider,
} from './notification-provider.interface';

/**
 * IN_APP delivery adapter. For the in-app channel, delivery IS durable
 * persistence — the client retrieves it via the notifications API.
 * Vendor adapters (FCM/APNs/Email/SMS) will implement NotificationProvider
 * for their channel and register here; the domain never imports them.
 */
export class InAppNotificationProvider implements NotificationProvider {
  readonly channel: NotificationChannel = 'IN_APP';

  async deliver(intent: NotificationIntent): Promise<DeliveryReceipt> {
    const { emitNotification } = await import('./notification.service');
    const { notification } = await emitNotification(intent);
    return { channel: this.channel, delivered: !!notification, providerNotificationId: notification?.id ?? null };
  }
}

registerNotificationProvider(new InAppNotificationProvider());

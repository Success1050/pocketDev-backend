import { Injectable, Logger } from '@nestjs/common';
import Expo, { ExpoPushMessage, ExpoPushTicket } from 'expo-server-sdk';
import { PrismaService } from '../../core/prisma/prisma.service';

export interface PushPayload {
  userId: string;
  title: string;
  body: string;
  data?: Record<string, any>;
}

@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);
  private expo: Expo;

  constructor(private readonly prisma: PrismaService) {
    this.expo = new Expo();
  }

  /**
   * Send a push notification to a specific user using their stored Expo push token.
   * This is the core mechanism that allows notifications even when the user has exited the app.
   */
  async sendPushToUser(payload: PushPayload): Promise<boolean> {
    try {
      // 1. Look up the user's push token
      const user = await this.prisma.user.findUnique({
        where: { id: payload.userId },
        select: { pushToken: true, username: true },
      });

      if (!user?.pushToken) {
        this.logger.warn(`No push token found for user ${payload.userId}. Skipping push.`);
        return false;
      }

      // 2. Validate the token
      if (!Expo.isExpoPushToken(user.pushToken)) {
        this.logger.error(`Invalid Expo push token for user ${payload.userId}: ${user.pushToken}`);
        return false;
      }

      // 3. Build the push message
      const message: ExpoPushMessage = {
        to: user.pushToken,
        sound: 'default',
        title: payload.title,
        body: payload.body,
        data: payload.data || {},
        priority: 'high',
        channelId: 'task-updates', // Android notification channel
      };

      // 4. Send via Expo's push service
      const chunks = this.expo.chunkPushNotifications([message]);
      const tickets: ExpoPushTicket[] = [];

      for (const chunk of chunks) {
        try {
          const ticketChunk = await this.expo.sendPushNotificationsAsync(chunk);
          tickets.push(...ticketChunk);
        } catch (error) {
          this.logger.error(`Error sending push notification chunk: ${error.message}`);
        }
      }

      // 5. Check for errors in tickets
      for (const ticket of tickets) {
        if (ticket.status === 'error') {
          this.logger.error(`Push notification error: ${ticket.message}`);
          if (ticket.details?.error === 'DeviceNotRegistered') {
            // Token is invalid, clear it
            await this.prisma.user.update({
              where: { id: payload.userId },
              data: { pushToken: null },
            });
            this.logger.warn(`Cleared invalid push token for user ${payload.userId}`);
          }
          return false;
        }
      }

      this.logger.log(`✅ Push notification sent to ${user.username} (${payload.userId}): "${payload.title}"`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to send push notification: ${error.message}`);
      return false;
    }
  }

  /**
   * Send push notifications to multiple users at once (batch).
   */
  async sendPushToUsers(userIds: string[], title: string, body: string, data?: Record<string, any>) {
    const results = await Promise.allSettled(
      userIds.map((userId) => this.sendPushToUser({ userId, title, body, data })),
    );

    const succeeded = results.filter((r) => r.status === 'fulfilled' && r.value === true).length;
    const failed = results.length - succeeded;

    this.logger.log(`Batch push: ${succeeded} sent, ${failed} failed out of ${results.length}`);
    return { succeeded, failed, total: results.length };
  }
}

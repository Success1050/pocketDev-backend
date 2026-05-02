import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

export interface CreateNotificationDto {
  userId: string;
  taskId?: string;
  type?: string;    // info | success | error | warning
  title: string;
  body: string;
  data?: Record<string, any>;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a new in-app notification record.
   */
  async create(dto: CreateNotificationDto) {
    const notification = await this.prisma.notification.create({
      data: {
        userId: dto.userId,
        taskId: dto.taskId || null,
        type: dto.type || 'info',
        title: dto.title,
        body: dto.body,
        data: dto.data ? JSON.stringify(dto.data) : null,
      },
    });
    this.logger.log(`Notification created: [${notification.type}] ${notification.title} -> user ${dto.userId}`);
    return notification;
  }

  /**
   * Get all notifications for a user, newest first.
   */
  async getUserNotifications(userId: string, limit = 50) {
    return this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { task: { select: { id: true, description: true, status: true } } },
    });
  }

  /**
   * Get unread notification count.
   */
  async getUnreadCount(userId: string) {
    return this.prisma.notification.count({
      where: { userId, read: false },
    });
  }

  /**
   * Mark a single notification as read.
   */
  async markAsRead(notificationId: string, userId: string) {
    return this.prisma.notification.updateMany({
      where: { id: notificationId, userId },
      data: { read: true },
    });
  }

  /**
   * Mark all notifications as read for a user.
   */
  async markAllAsRead(userId: string) {
    return this.prisma.notification.updateMany({
      where: { userId, read: false },
      data: { read: true },
    });
  }

  /**
   * Delete a specific notification.
   */
  async delete(notificationId: string, userId: string) {
    return this.prisma.notification.deleteMany({
      where: { id: notificationId, userId },
    });
  }

  /**
   * Delete all notifications for a user.
   */
  async deleteAll(userId: string) {
    return this.prisma.notification.deleteMany({
      where: { userId },
    });
  }

  /**
   * Flag notification as push-sent.
   */
  async markAsPushed(notificationId: string) {
    return this.prisma.notification.update({
      where: { id: notificationId },
      data: { pushed: true },
    });
  }
}

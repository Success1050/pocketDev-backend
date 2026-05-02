import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Req,
  UseInterceptors,
} from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { AuthInterceptor } from '../auth/auth.interceptor';

@Controller('notifications')
@UseInterceptors(AuthInterceptor)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  /**
   * GET /notifications
   * List all notifications for the authenticated user.
   */
  @Get()
  async getAll(@Req() req: any) {
    const userId = req.user?.id;
    const notifications = await this.notificationsService.getUserNotifications(userId);
    const unreadCount = await this.notificationsService.getUnreadCount(userId);
    return {
      status: 'success',
      data: { notifications, unreadCount },
    };
  }

  /**
   * GET /notifications/unread-count
   * Get the count of unread notifications.
   */
  @Get('unread-count')
  async getUnreadCount(@Req() req: any) {
    const userId = req.user?.id;
    const count = await this.notificationsService.getUnreadCount(userId);
    return { status: 'success', data: { unreadCount: count } };
  }

  /**
   * PATCH /notifications/:id/read
   * Mark a single notification as read.
   */
  @Patch(':id/read')
  async markAsRead(@Param('id') id: string, @Req() req: any) {
    const userId = req.user?.id;
    await this.notificationsService.markAsRead(id, userId);
    return { status: 'success', message: 'Notification marked as read' };
  }

  /**
   * POST /notifications/read-all
   * Mark all notifications as read.
   */
  @Post('read-all')
  async markAllAsRead(@Req() req: any) {
    const userId = req.user?.id;
    await this.notificationsService.markAllAsRead(userId);
    return { status: 'success', message: 'All notifications marked as read' };
  }

  /**
   * DELETE /notifications/:id
   * Delete a specific notification.
   */
  @Delete(':id')
  async deleteOne(@Param('id') id: string, @Req() req: any) {
    const userId = req.user?.id;
    await this.notificationsService.delete(id, userId);
    return { status: 'success', message: 'Notification deleted' };
  }

  /**
   * DELETE /notifications
   * Delete all notifications for the user.
   */
  @Delete()
  async deleteAll(@Req() req: any) {
    const userId = req.user?.id;
    await this.notificationsService.deleteAll(userId);
    return { status: 'success', message: 'All notifications deleted' };
  }
}

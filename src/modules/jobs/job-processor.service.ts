import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AgentService } from '../agent/agent.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PushService } from '../notifications/push.service';
import { TASK_QUEUE, JobType, JobStatus } from './job.constants';

@Injectable()
@Processor(TASK_QUEUE, {
  concurrency: 3,  // Process up to 3 jobs concurrently
})
export class JobProcessorService extends WorkerHost {
  private readonly logger = new Logger(JobProcessorService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly agentService: AgentService,
    private readonly notificationsService: NotificationsService,
    private readonly pushService: PushService,
  ) {
    super();
  }

  /**
   * Main job processor — dispatches to the correct handler based on job type.
   * Jobs processed here keep running on the server even after the user exits the app.
   */
  async process(job: Job): Promise<any> {
    this.logger.log(`Processing job ${job.id} [${job.name}] — attempt ${job.attemptsMade + 1}`);

    switch (job.name) {
      case JobType.PROCESS_TASK:
        return this.handleProcessTask(job);
      case JobType.SEND_NOTIFICATION:
        return this.handleSendNotification(job);
      default:
        this.logger.warn(`Unknown job type: ${job.name}`);
    }
  }

  /**
   * Handle task processing — the core AI agent pipeline.
   * This runs entirely server-side so the user can close the app and come back later.
   */
  private async handleProcessTask(job: Job) {
    const { taskId, userId, payload, backgroundJobId } = job.data;

    try {
      // Mark background job as processing
      if (backgroundJobId) {
        await this.prisma.backgroundJob.update({
          where: { id: backgroundJobId },
          data: { status: JobStatus.PROCESSING, attempts: job.attemptsMade + 1 },
        });
      }

      // Execute the actual agent pipeline
      await this.agentService.processTask(taskId, payload);

      // Fetch final task status
      const task = await this.prisma.task.findUnique({ where: { id: taskId } });
      const isSuccess = task?.status === 'completed';

      // Mark background job as completed
      if (backgroundJobId) {
        await this.prisma.backgroundJob.update({
          where: { id: backgroundJobId },
          data: {
            status: isSuccess ? JobStatus.COMPLETED : JobStatus.FAILED,
            result: JSON.stringify({ taskStatus: task?.status, previewUrl: task?.previewUrl }),
          },
        });
      }

      // Create in-app notification
      const notification = await this.notificationsService.create({
        userId,
        taskId,
        type: isSuccess ? 'success' : 'error',
        title: isSuccess ? '✅ Task Completed!' : '❌ Task Failed',
        body: isSuccess
          ? `Your task "${task?.description?.slice(0, 60)}..." has been completed successfully.`
          : `Your task "${task?.description?.slice(0, 60)}..." has failed. Check the logs for details.`,
        data: {
          taskId,
          status: task?.status,
          previewUrl: task?.previewUrl,
        },
      });

      // Send push notification (works even if app is closed)
      const pushed = await this.pushService.sendPushToUser({
        userId,
        title: isSuccess ? '✅ Task Completed!' : '❌ Task Failed',
        body: isSuccess
          ? `Your task has been completed successfully.`
          : `Your task failed. Tap to view details.`,
        data: { taskId, notificationId: notification.id, screen: 'TaskDetail' },
      });

      // Mark notification as pushed if successful
      if (pushed) {
        await this.notificationsService.markAsPushed(notification.id);
      }

      this.logger.log(`Task ${taskId} processed — status: ${task?.status}`);
      return { taskId, status: task?.status };

    } catch (error) {
      this.logger.error(`Task ${taskId} processing failed: ${error.message}`);

      // Update background job on failure
      if (backgroundJobId) {
        await this.prisma.backgroundJob.update({
          where: { id: backgroundJobId },
          data: {
            status: JobStatus.FAILED,
            error: error.message,
            attempts: job.attemptsMade + 1,
          },
        });
      }

      // Notify user of failure
      const notification = await this.notificationsService.create({
        userId,
        taskId,
        type: 'error',
        title: '❌ Task Failed',
        body: `An error occurred while processing your task: ${error.message?.slice(0, 100)}`,
        data: { taskId, error: error.message },
      });

      await this.pushService.sendPushToUser({
        userId,
        title: '❌ Task Failed',
        body: 'An error occurred while processing your task. Tap to view details.',
        data: { taskId, notificationId: notification.id, screen: 'TaskDetail' },
      });

      // Re-throw so BullMQ can retry if attempts remain
      throw error;
    }
  }

  /**
   * Handle sending a standalone notification.
   */
  private async handleSendNotification(job: Job) {
    const { userId, taskId, type, title, body, data } = job.data;

    const notification = await this.notificationsService.create({
      userId,
      taskId,
      type,
      title,
      body,
      data,
    });

    const pushed = await this.pushService.sendPushToUser({
      userId,
      title,
      body,
      data: { ...data, notificationId: notification.id },
    });

    if (pushed) {
      await this.notificationsService.markAsPushed(notification.id);
    }

    return { notificationId: notification.id, pushed };
  }
}

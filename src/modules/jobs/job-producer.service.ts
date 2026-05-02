import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../../core/prisma/prisma.service';
import { TASK_QUEUE, JobType, JobStatus } from './job.constants';

export interface TaskJobPayload {
  taskId: string;
  userId: string;
  payload: any;
}

export interface NotificationJobPayload {
  userId: string;
  taskId?: string;
  type: string;
  title: string;
  body: string;
  data?: Record<string, any>;
}

@Injectable()
export class JobProducerService {
  private readonly logger = new Logger(JobProducerService.name);

  constructor(
    @InjectQueue(TASK_QUEUE) private readonly taskQueue: Queue,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Enqueue a task for background processing.
   * The task continues running on the server even if the user closes the app.
   */
  async enqueueTask(data: TaskJobPayload) {
    // 1. Log the background job in the database for auditing
    const bgJob = await this.prisma.backgroundJob.create({
      data: {
        queueName: TASK_QUEUE,
        jobType: JobType.PROCESS_TASK,
        payload: JSON.stringify(data.payload),
        status: JobStatus.QUEUED,
        userId: data.userId,
        taskId: data.taskId,
      },
    });

    // 2. Add to BullMQ queue
    const job = await this.taskQueue.add(JobType.PROCESS_TASK, {
      ...data,
      backgroundJobId: bgJob.id,
    }, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: false,
      removeOnFail: false,
    });

    this.logger.log(`Task ${data.taskId} enqueued as job ${job.id} (bg: ${bgJob.id})`);
    return { jobId: job.id, backgroundJobId: bgJob.id };
  }

  /**
   * Enqueue a notification to be sent asynchronously.
   */
  async enqueueNotification(data: NotificationJobPayload) {
    const job = await this.taskQueue.add(JobType.SEND_NOTIFICATION, data, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: true,
    });

    this.logger.log(`Notification job ${job.id} enqueued for user ${data.userId}`);
    return { jobId: job.id };
  }

  /**
   * Get all background jobs for a user.
   */
  async getUserJobs(userId: string) {
    return this.prisma.backgroundJob.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Get a specific background job.
   */
  async getJob(jobId: string) {
    return this.prisma.backgroundJob.findUnique({
      where: { id: jobId },
    });
  }
}

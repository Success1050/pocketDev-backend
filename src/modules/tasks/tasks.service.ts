import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AgentService } from '../agent/agent.service';
import { JobProducerService } from '../jobs/job-producer.service';

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly agentService: AgentService,
    private readonly jobProducer: JobProducerService,
  ) {}

  async createTask(userId: string, payload: any) {
    // 1. Create task in DB
    const task = await this.prisma.task.create({
      data: {
        userId,
        description: payload.instruction,
        repoName: payload.repo?.name,
        repoOwner: payload.repo?.owner,
        repoUrl: payload.repo?.url,
        branchName: payload.branch?.name,
        baseBranch: payload.branch?.baseBranch,
        projectId: payload.meta?.projectId,
        llmProvider: payload.llm?.provider,
        llmModel: payload.llm?.model,
        status: 'pending',
      },
    });

    // 2. Enqueue task for background processing via BullMQ.
    //    This ensures the task continues processing even if the user exits the app.
    //    On completion/failure, a push notification will be sent automatically.
    try {
      const { jobId, backgroundJobId } = await this.jobProducer.enqueueTask({
        taskId: task.id,
        userId,
        payload,
      });

      this.logger.log(`Task ${task.id} enqueued — job: ${jobId}, bgJob: ${backgroundJobId}`);
    } catch (error) {
      // If Redis/queue is unavailable, fall back to direct processing
      this.logger.warn(`Queue unavailable, falling back to direct processing: ${error.message}`);
      this.agentService.processTask(task.id, payload).catch(err => {
        this.logger.error('Direct task processing failed', err);
      });
    }

    return task;
  }

  async savePushToken(userId: string, pushToken: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { pushToken },
    });
  }

  async getTask(taskId: string) {
    return this.prisma.task.findUnique({
      where: { id: taskId },
      include: {
        taskLogs: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });
  }

  async clearLogs(taskId: string) {
    return this.prisma.taskLog.deleteMany({
      where: { taskId },
    });
  }

  async getUserTasks(userId: string) {
    return this.prisma.task.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        taskLogs: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });
  }

  async getLatestTask(userId: string) {
    return this.prisma.task.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        taskLogs: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });
  }
}

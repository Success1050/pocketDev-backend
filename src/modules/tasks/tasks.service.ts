import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AgentService } from '../agent/agent.service';
import { JobProducerService } from '../jobs/job-producer.service';
import { TasksGateway } from './tasks.gateway';

@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly agentService: AgentService,
    private readonly jobProducer: JobProducerService,
    private readonly tasksGateway: TasksGateway,
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
        secondaryRepoName: payload.secondaryRepo?.name,
        secondaryRepoOwner: payload.secondaryRepo?.owner,
        secondaryRepoUrl: payload.secondaryRepo?.url,
        secondaryBranchName: payload.secondaryBranch?.name,
        secondaryBaseBranch: payload.secondaryBranch?.baseBranch,
        secondaryProjectId: payload.meta?.secondaryProjectId,
        llmProvider: payload.llm?.provider,
        llmModel: payload.llm?.model,
        status: 'pending',
        previewUrl: payload.repo?.homepage,
        attachments: payload.attachments ? JSON.stringify(payload.attachments) : null,
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

  async approvePlan(taskId: string) {
    const task = await this.prisma.task.update({
      where: { id: taskId },
      data: { status: 'plan-approved' },
    });
    this.tasksGateway.emitTaskUpdated(taskId, task);
    return task;
  }

  async cancelTask(taskId: string) {
    const task = await this.prisma.task.update({
      where: { id: taskId },
      data: { status: 'cancelled' },
    });
    this.tasksGateway.emitTaskUpdated(taskId, task);
    // Hard kill the underlying docker container immediately if it's currently executing
    this.agentService.cancelTaskExecution(taskId).catch(err => 
      this.logger.error(`Failed to cancel agent execution for ${taskId}`, err)
    );
    return task;
  }

  async provideFeedback(taskId: string, feedback: string) {
    const task = await this.prisma.task.findUnique({ where: { id: taskId } });
    if (!task) throw new Error('Task not found');
    const updatedTask = await this.prisma.task.update({
      where: { id: taskId },
      data: { 
        status: 'plan-rejected', 
        description: `${task.description}\n\n[USER FEEDBACK ON PLAN]: ${feedback}`
      },
    });
    this.tasksGateway.emitTaskUpdated(taskId, updatedTask);
    return updatedTask;
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

  async commitTask(taskId: string) {
    // This runs asynchronously so the API returns quickly
    this.agentService.commitAndPushTask(taskId).catch(err => {
      this.logger.error(`Failed to commit task ${taskId}`, err);
    });
    return { success: true, message: 'Pushing changes...' };
  }

  async discardTask(taskId: string) {
    // This also runs asynchronously
    this.agentService.discardTask(taskId).catch(err => {
      this.logger.error(`Failed to discard task ${taskId}`, err);
    });
    return { success: true, message: 'Discarding changes...' };
  }

  async refineTask(taskId: string, instruction: string, attachments?: string[]) {
    // This runs asynchronously
    this.agentService.refineTask(taskId, instruction, attachments).catch(err => {
      this.logger.error(`Failed to refine task ${taskId}`, err);
    });
    return { success: true, message: 'Refining changes...' };
  }

  async mergeTask(taskId: string, targetBranch: string) {
    // This runs asynchronously
    this.agentService.mergeTask(taskId, targetBranch).catch(err => {
      this.logger.error(`Failed to merge task ${taskId}`, err);
    });
    return { success: true, message: `Merging into ${targetBranch}...` };
  }
}

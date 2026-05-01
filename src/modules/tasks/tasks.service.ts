import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AgentService } from '../agent/agent.service';

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly agentService: AgentService,
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

    // 2. Queue or execute task async
    this.agentService.processTask(task.id, payload).catch(err => {
      console.error('Task processing failed', err);
    });

    return task;
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

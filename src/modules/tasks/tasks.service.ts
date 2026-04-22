import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import { AgentService } from '../agent/agent.service';

@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly agentService: AgentService,
  ) {}

  async createTask(userId: string, description: string, repoName: string) {
    // 1. Create task in DB
    const task = await this.prisma.task.create({
      data: {
        userId,
        description,
        repoName,
        status: 'pending',
      },
    });

    // 2. Queue or execute task async
    this.agentService.processTask(task.id, description).catch(err => {
      console.error('Task processing failed', err);
    });

    return task;
  }
}

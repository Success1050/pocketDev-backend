import { Module } from '@nestjs/common';
import { AgentModule } from '../agent/agent.module';
import { JobsModule } from '../jobs/jobs.module';
import { TasksService } from './tasks.service';
import { TasksController } from './tasks.controller';

@Module({
  imports: [AgentModule, JobsModule],
  providers: [TasksService],
  controllers: [TasksController],
})
export class TasksModule {}

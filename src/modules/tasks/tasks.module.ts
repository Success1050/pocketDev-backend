import { Module } from '@nestjs/common';
import { AgentModule } from '../agent/agent.module';
import { TasksService } from './tasks.service';
import { TasksController } from './tasks.controller';

@Module({
  imports: [AgentModule],
  providers: [TasksService],
  controllers: [TasksController],
})
export class TasksModule {}

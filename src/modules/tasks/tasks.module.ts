import { Module } from '@nestjs/common';
import { TasksService } from './tasks.service';
import { TasksController } from './tasks.controller';
import { PrismaClient } from '@prisma/client';
import { JobsModule } from '../jobs/jobs.module';
import { AgentModule } from '../agent/agent.module';
import { UploadController } from './upload.controller';
import { DownloadController } from './download.controller';
import { PublishGithubController } from './publish-github.controller';
import { DockerModule } from '../docker/docker.module';
import { UsageModule } from '../usage/usage.module';

@Module({
  imports: [JobsModule, AgentModule, DockerModule, UsageModule],
  controllers: [TasksController, UploadController, DownloadController, PublishGithubController],
  providers: [TasksService, PrismaClient],
  exports: [TasksService],
})
export class TasksModule {}

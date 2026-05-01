import { Module } from '@nestjs/common';
import { AgentService } from './agent.service';
import { AgentController } from './agent.controller';
import { DockerModule } from '../docker/docker.module';
import { PrismaModule } from '../../core/prisma/prisma.module';

@Module({
  imports: [DockerModule, PrismaModule],
  providers: [AgentService],
  controllers: [AgentController],
  exports: [AgentService],
})
export class AgentModule {}

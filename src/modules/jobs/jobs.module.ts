import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { JobProducerService } from './job-producer.service';
import { JobProcessorService } from './job-processor.service';
import { JobsController } from './jobs.controller';
import { PrismaModule } from '../../core/prisma/prisma.module';
import { AgentModule } from '../agent/agent.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { TASK_QUEUE } from './job.constants';

@Module({
  imports: [
    BullModule.registerQueue({ name: TASK_QUEUE }),
    PrismaModule,
    AgentModule,
    NotificationsModule,
  ],
  controllers: [JobsController],
  providers: [JobProducerService, JobProcessorService],
  exports: [JobProducerService],
})
export class JobsModule {}

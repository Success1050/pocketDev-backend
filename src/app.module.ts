import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './core/prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { AgentModule } from './modules/agent/agent.module';
import { DockerModule } from './modules/docker/docker.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { GithubModule } from './modules/github/github.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { JobsModule } from './modules/jobs/jobs.module';

@Module({
  imports: [
    // Global BullMQ configuration (Redis-backed job queue)
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
        password: process.env.REDIS_PASSWORD || undefined,
        maxRetriesPerRequest: null,
        ...(process.env.REDIS_HOST && process.env.REDIS_HOST !== 'localhost' ? { tls: {} } : {}),
      },
    }),
    // Scheduled tasks support (cron jobs, intervals, timeouts)
    ScheduleModule.forRoot(),
    PrismaModule,
    AuthModule,
    UsersModule,
    AgentModule,
    DockerModule,
    TasksModule,
    GithubModule,
    NotificationsModule,
    JobsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}

import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
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
import { RevenueCatModule } from './modules/revenuecat/revenuecat.module';
import { GatewayModule } from './modules/gateway/gateway.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    // Global BullMQ configuration (Redis-backed job queue)
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: async (configService: ConfigService) => {
        const host = configService.get<string>('REDIS_HOST') || 'localhost';
        const port = parseInt(configService.get<string>('REDIS_PORT') || '6379', 10);
        const password = configService.get<string>('REDIS_PASSWORD') || undefined;
        return {
          connection: {
            host,
            port,
            password,
            maxRetriesPerRequest: null,
            ...(host && host !== 'localhost' ? { tls: {} } : {}),
          },
        };
      },
    }),
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
    RevenueCatModule,
    GatewayModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }

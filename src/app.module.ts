import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './core/prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { AgentModule } from './modules/agent/agent.module';
import { DockerModule } from './modules/docker/docker.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { GithubModule } from './modules/github/github.module';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    UsersModule,
    AgentModule,
    DockerModule,
    TasksModule,
    GithubModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}

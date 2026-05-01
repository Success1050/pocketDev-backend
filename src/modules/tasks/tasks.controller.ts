import { Controller, Post, Body, Req, UseInterceptors } from '@nestjs/common';
import { TasksService } from './tasks.service';
import { AuthInterceptor } from '../auth/auth.interceptor';

@Controller('tasks')
@UseInterceptors(AuthInterceptor)
export class TasksController {
  constructor(private readonly tasksService: TasksService) { }

  @Post()
  async create(@Body() body: any, @Req() req: any) {
    const userId = req.user?.id;
    return this.tasksService.createTask(userId, body);
  }
}

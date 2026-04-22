import { Controller, Post, Body, Req, UseGuards } from '@nestjs/common';
import { TasksService } from './tasks.service';

@Controller('tasks')
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Post()
  async create(@Body() body: any, @Req() req: any) {
    // Note: Add JWT auth guard in production to extract req.user
    const userId = req.user?.id || 'default-user-id';
    return this.tasksService.createTask(userId, body.description, body.repoName);
  }
}

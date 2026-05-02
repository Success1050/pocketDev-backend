import { Controller, Post, Get, Body, Req, Param, UseInterceptors, Delete } from '@nestjs/common';
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

  @Post('push-token')
  async savePushToken(@Req() req: any, @Body() body: { token: string }) {
    const userId = req.user?.id;
    return this.tasksService.savePushToken(userId, body.token);
  }

  @Get('latest')
  async getLatest(@Req() req: any) {
    const userId = req.user?.id;
    return this.tasksService.getLatestTask(userId);
  }

  @Delete(':id/logs')
  async clearLogs(@Param('id') id: string) {
    return this.tasksService.clearLogs(id);
  }

  @Get(':id')
  async getOne(@Param('id') id: string) {
    return this.tasksService.getTask(id);
  }

  @Get()
  async getAll(@Req() req: any) {
    const userId = req.user?.id;
    return this.tasksService.getUserTasks(userId);
  }
}

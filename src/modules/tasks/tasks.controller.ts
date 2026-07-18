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

  @Post(':id/approve-plan')
  async approvePlan(@Param('id') id: string) {
    return this.tasksService.approvePlan(id);
  }

  @Post(':id/feedback')
  async provideFeedback(@Param('id') id: string, @Body() body: { feedback: string }) {
    return this.tasksService.provideFeedback(id, body.feedback);
  }

  @Post(':id/cancel')
  async cancelTask(@Param('id') id: string) {
    return this.tasksService.cancelTask(id);
  }

  @Post(':id/commit')
  async commitTask(@Param('id') id: string) {
    return this.tasksService.commitTask(id);
  }

  @Post(':id/discard')
  async discardTask(@Param('id') id: string) {
    return this.tasksService.discardTask(id);
  }

  @Post(':id/refine')
  async refineTask(@Param('id') id: string, @Body() body: { instruction: string; attachments?: string[] }) {
    return this.tasksService.refineTask(id, body.instruction, body.attachments);
  }

  @Post(':id/merge')
  async mergeTask(@Param('id') id: string, @Body() body: { targetBranch: string }) {
    return this.tasksService.mergeTask(id, body.targetBranch);
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

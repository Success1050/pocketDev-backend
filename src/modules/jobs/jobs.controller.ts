import {
  Controller,
  Get,
  Param,
  Req,
  UseInterceptors,
} from '@nestjs/common';
import { JobProducerService } from './job-producer.service';
import { AuthInterceptor } from '../auth/auth.interceptor';

@Controller('jobs')
@UseInterceptors(AuthInterceptor)
export class JobsController {
  constructor(private readonly jobProducerService: JobProducerService) {}

  /**
   * GET /jobs
   * List all background jobs for the authenticated user.
   */
  @Get()
  async getAll(@Req() req: any) {
    const userId = req.user?.id;
    const jobs = await this.jobProducerService.getUserJobs(userId);
    return { status: 'success', data: jobs };
  }

  /**
   * GET /jobs/:id
   * Get a specific background job status.
   */
  @Get(':id')
  async getOne(@Param('id') id: string) {
    const job = await this.jobProducerService.getJob(id);
    return { status: 'success', data: job };
  }
}

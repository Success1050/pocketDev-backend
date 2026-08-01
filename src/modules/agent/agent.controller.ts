import { Controller, Post, Body, Get, Req, UseInterceptors } from '@nestjs/common';
import { AgentService } from './agent.service';
import { AuthInterceptor } from '../auth/auth.interceptor';
import { PrismaService } from '../../core/prisma/prisma.service';

@Controller('agent')
export class AgentController {
  constructor(
    private readonly agentService: AgentService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('models')
  @UseInterceptors(AuthInterceptor)
  async getModels(@Req() req: any) {
    let userTier = 'free';
    if (req.user?.id) {
      const user = await this.prisma.user.findUnique({ where: { id: req.user.id } });
      if (user) {
        userTier = user.tier;
      }
    }

    return {
      status: 'success',
      data: await this.agentService.getAvailableModels(userTier as any),
    };
  }

  @Post('webhook')
  async handleTask(@Body() body: any) {
    // Webhook for receiving task events
    return { status: 'received' };
  }
}

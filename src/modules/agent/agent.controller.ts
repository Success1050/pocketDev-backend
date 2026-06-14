import { Controller, Post, Body, Get } from '@nestjs/common';
import { AgentService } from './agent.service';

@Controller('agent')
export class AgentController {
  constructor(private readonly agentService: AgentService) {}

  @Get('models')
  async getModels() {
    return {
      status: 'success',
      data: await this.agentService.getAvailableModels(),
    };
  }

  @Post('webhook')
  async handleTask(@Body() body: any) {
    // Webhook for receiving task events
    return { status: 'received' };
  }
}

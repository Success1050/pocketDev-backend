import { Controller, Post, Body } from '@nestjs/common';
import { AgentService } from './agent.service';

@Controller('agent')
export class AgentController {
  constructor(private readonly agentService: AgentService) {}

  @Post('webhook')
  async handleTask(@Body() body: any) {
    // Webhook for receiving task events
    return { status: 'received' };
  }
}

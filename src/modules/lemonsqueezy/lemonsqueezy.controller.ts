import { Controller, Post, Body, Headers, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LemonSqueezyService } from './lemonsqueezy.service';

@Controller('webhooks/lemonsqueezy')
export class LemonSqueezyController {
  private readonly logger = new Logger(LemonSqueezyController.name);

  constructor(
    private readonly lemonSqueezyService: LemonSqueezyService,
    private readonly configService: ConfigService,
  ) {}

  @Post()
  async handleWebhook(
    @Headers('x-signature') signature: string,
    @Body() body: any,
  ) {
    // Basic verification logging and processing
    const secret = this.configService.get<string>('LEMONSQUEEZY_WEBHOOK_SECRET');
    this.logger.log(`Received Lemon Squeezy webhook: ${body?.meta?.event_name}`);

    try {
      await this.lemonSqueezyService.handleEvent(body);
      return { status: 'success' };
    } catch (error: any) {
      this.logger.error(`Error handling webhook: ${error?.message}`);
      return { status: 'error', message: error?.message };
    }
  }
}

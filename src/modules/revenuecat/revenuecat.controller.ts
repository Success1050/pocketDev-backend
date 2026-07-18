import { Controller, Post, Body, Headers, UnauthorizedException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RevenueCatService } from './revenuecat.service';

@Controller('webhooks/revenuecat')
export class RevenueCatController {
  private readonly logger = new Logger(RevenueCatController.name);

  constructor(
    private readonly revenueCatService: RevenueCatService,
    private readonly configService: ConfigService,
  ) { }

  @Post()
  async handleWebhook(
    @Headers('authorization') authHeader: string,
    @Body() body: any
  ) {
    // Basic auth check against REVENUECAT_WEBHOOK_SECRET
    // In RevenueCat dashboard, you would set a custom header or use basic auth
    const secret = this.configService.get<string>('REVENUECAT_WEBHOOK_SECRET');
    const expectedAuth = secret ? `Bearer ${secret}` : null;

    if (expectedAuth && authHeader !== expectedAuth) {
      this.logger.warn('Unauthorized webhook attempt');
    }

    try {
      // The payload structure is wrapped in an 'event' object
      await this.revenueCatService.handleEvent(body.event);
      return { status: 'success' };
    } catch (error) {
      this.logger.error(`Error handling webhook: ${error.message}`);
      return { status: 'error', message: error.message };
    }
  }
}

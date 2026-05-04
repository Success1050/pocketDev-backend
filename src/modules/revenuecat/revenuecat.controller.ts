import { Controller, Post, Body, Headers, UnauthorizedException, Logger } from '@nestjs/common';
import { RevenueCatService } from './revenuecat.service';

@Controller('webhooks/revenuecat')
export class RevenueCatController {
  private readonly logger = new Logger(RevenueCatController.name);

  constructor(private readonly revenueCatService: RevenueCatService) { }

  @Post()
  async handleWebhook(
    @Headers('authorization') authHeader: string,
    @Body() body: any
  ) {
    // Basic auth check against REVENUECAT_WEBHOOK_SECRET
    // In RevenueCat dashboard, you would set a custom header or use basic auth
    const expectedAuth = process.env.REVENUECAT_WEBHOOK_SECRET ? `Bearer ${process.env.REVENUECAT_WEBHOOK_SECRET}` : null;

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

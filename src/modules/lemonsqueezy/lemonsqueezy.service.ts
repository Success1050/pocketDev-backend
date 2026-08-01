import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

@Injectable()
export class LemonSqueezyService {
  private readonly logger = new Logger(LemonSqueezyService.name);

  constructor(private readonly prisma: PrismaService) {}

  // Map Lemon Squeezy product variant names to tiers
  private getTierFromProduct(productName: string): 'premium' | 'pro' | null {
    const lower = (productName || '').toLowerCase();
    if (lower.includes('pro')) return 'pro';
    if (lower.includes('premium')) return 'premium';
    return null;
  }

  async handleEvent(body: any) {
    const eventName = body?.meta?.event_name;
    const customData = body?.meta?.custom_data;
    const userId = customData?.user_id || customData?.userId;
    const attributes = body?.data?.attributes;

    if (!userId) {
      this.logger.warn('No user_id in custom_data');
      return;
    }

    this.logger.log(`Processing ${eventName} for user ${userId}`);

    const productName = attributes?.product_name || attributes?.variant_name || '';

    switch (eventName) {
      case 'subscription_created':
      case 'subscription_resumed':
      case 'subscription_unpaused': {
        const tier = this.getTierFromProduct(productName) || 'premium';
        await this.prisma.user.update({
          where: { id: userId },
          data: { tier, isPremium: true, subscriptionId: String(body?.data?.id || '') },
        });
        this.logger.log(`User ${userId} upgraded to ${tier}`);
        break;
      }

      case 'subscription_updated': {
        const status = attributes?.status;
        if (status === 'active' || status === 'on_trial') {
          const tier = this.getTierFromProduct(productName) || 'premium';
          await this.prisma.user.update({
            where: { id: userId },
            data: { tier, isPremium: true },
          });
          this.logger.log(`User ${userId} plan changed to ${tier}`);
        }
        break;
      }

      case 'subscription_cancelled':
      case 'subscription_expired':
      case 'subscription_paused': {
        await this.prisma.user.update({
          where: { id: userId },
          data: { tier: 'free', isPremium: false },
        });
        this.logger.log(`User ${userId} downgraded to free`);
        break;
      }

      default:
        this.logger.log(`Unhandled event: ${eventName}`);
    }
  }
}

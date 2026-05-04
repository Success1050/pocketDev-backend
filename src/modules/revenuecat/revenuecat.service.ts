import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';

@Injectable()
export class RevenueCatService {
  private readonly logger = new Logger(RevenueCatService.name);

  constructor(private readonly prisma: PrismaService) { }

  async handleEvent(event: any) {
    if (!event) return;

    const { type, app_user_id } = event;

    this.logger.log(`Received RevenueCat event: ${type} for user: ${app_user_id}`);

    // Assuming app_user_id is the user's ID in our database
    const userId = app_user_id;

    if (!userId) {
      this.logger.warn('No app_user_id provided in event');
      return;
    }

    switch (type) {
      case 'INITIAL_PURCHASE':
      case 'RENEWAL':
      case 'UNCANCELLATION':
      case 'TRIAL_STARTED':
        await this.prisma.user.update({
          where: { id: userId },
          data: {
            isPremium: true,
            subscriptionId: event.original_app_user_id || app_user_id
          },
        });
        this.logger.log(`User ${userId} upgraded to premium`);
        break;

      case 'CANCELLATION':
      case 'EXPIRATION':
        await this.prisma.user.update({
          where: { id: userId },
          data: { isPremium: false },
        });
        this.logger.log(`User ${userId} downgraded to free`);
        break;

      default:
        this.logger.log(`Event ${type} handled (no status change)`);
    }
  }
}

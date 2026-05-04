import { Module } from '@nestjs/common';
import { RevenueCatController } from './revenuecat.controller';
import { RevenueCatService } from './revenuecat.service';
import { PrismaModule } from '../../core/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [RevenueCatController],
  providers: [RevenueCatService],
  exports: [RevenueCatService],
})
export class RevenueCatModule {}

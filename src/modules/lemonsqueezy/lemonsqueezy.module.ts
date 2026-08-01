import { Module } from '@nestjs/common';
import { LemonSqueezyController } from './lemonsqueezy.controller';
import { LemonSqueezyService } from './lemonsqueezy.service';
import { PrismaModule } from '../../core/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [LemonSqueezyController],
  providers: [LemonSqueezyService],
  exports: [LemonSqueezyService],
})
export class LemonSqueezyModule {}

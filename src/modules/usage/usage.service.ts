import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../core/prisma/prisma.service';

// Tier limits configuration
export const TIER_LIMITS = {
  free: { tasksPerMonth: 5, tokensPerMonth: 500_000, refinementsPerTask: 0, previewMinutes: 0, maxAttachments: 1, concurrentTasks: 1 },
  premium: { tasksPerMonth: 50, tokensPerMonth: 5_000_000, refinementsPerTask: 3, previewMinutes: 15, maxAttachments: 5, concurrentTasks: 2 },
  pro: { tasksPerMonth: -1, tokensPerMonth: 20_000_000, refinementsPerTask: 10, previewMinutes: 30, maxAttachments: 10, concurrentTasks: 3 }, // -1 = unlimited
};

export type UserTier = 'free' | 'premium' | 'pro';

@Injectable()
export class UsageService {
  private readonly logger = new Logger(UsageService.name);

  constructor(private readonly prisma: PrismaService) {}

  private getCurrentMonth(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  async getOrCreateUsage(userId: string) {
    const month = this.getCurrentMonth();
    return this.prisma.usage.upsert({
      where: { userId_month: { userId, month } },
      update: {},
      create: { userId, month, tasksUsed: 0, tokensUsed: 0 },
    });
  }

  async canCreateTask(userId: string, tier: UserTier): Promise<{ allowed: boolean; reason?: string }> {
    const limits = TIER_LIMITS[tier];
    const usage = await this.getOrCreateUsage(userId);

    // Check task limit (-1 means unlimited)
    if (limits.tasksPerMonth !== -1 && usage.tasksUsed >= limits.tasksPerMonth) {
      return { allowed: false, reason: `Monthly task limit reached (${limits.tasksPerMonth} tasks). Upgrade your plan for more.` };
    }

    // Check token budget
    if (usage.tokensUsed >= limits.tokensPerMonth) {
      return { allowed: false, reason: `Monthly token budget exhausted. Upgrade your plan for more tokens.` };
    }

    return { allowed: true };
  }

  async incrementTaskCount(userId: string) {
    const month = this.getCurrentMonth();
    await this.prisma.usage.upsert({
      where: { userId_month: { userId, month } },
      update: { tasksUsed: { increment: 1 } },
      create: { userId, month, tasksUsed: 1, tokensUsed: 0 },
    });
  }

  async addTokenUsage(userId: string, tokens: number) {
    const month = this.getCurrentMonth();
    await this.prisma.usage.upsert({
      where: { userId_month: { userId, month } },
      update: { tokensUsed: { increment: tokens } },
      create: { userId, month, tasksUsed: 0, tokensUsed: tokens },
    });
  }

  async getUsage(userId: string) {
    return this.getOrCreateUsage(userId);
  }

  isModelAllowedForTier(modelId: string, tier: UserTier): boolean {
    const modelTierMap: Record<string, UserTier[]> = {
      'claude-haiku-4-5-20251001': ['free', 'premium', 'pro'],
      'claude-haiku-4-5': ['free', 'premium', 'pro'],
      'claude-sonnet-5': ['premium', 'pro'],
      'claude-opus-5': ['pro'],
      'claude-fable-5': ['pro'],
      // Legacy fallback mapping support
      'claude-sonnet-4-5-20250929': ['premium', 'pro'],
      'claude-opus-4-6': ['pro'],
      'claude-opus-4-5-20251101': ['pro'],
    };
    const allowedTiers = modelTierMap[modelId];
    if (!allowedTiers) return false; // Model not in whitelist
    return allowedTiers.includes(tier);
  }

  isFeatureAllowed(feature: string, tier: UserTier): boolean {
    const featureAccess: Record<string, UserTier[]> = {
      'live-preview': ['premium', 'pro'],
      'refine': ['premium', 'pro'],
      'merge': ['premium', 'pro'],
      'publish-github': ['premium', 'pro'],
      'download': ['premium', 'pro'],
      'multi-repo': ['pro'],
    };
    const allowedTiers = featureAccess[feature];
    if (!allowedTiers) return true; // Feature not gated
    return allowedTiers.includes(tier);
  }

  getLimitsForTier(tier: UserTier) {
    return TIER_LIMITS[tier];
  }
}

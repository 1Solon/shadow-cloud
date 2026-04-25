import { Injectable } from '@nestjs/common';
import { prisma } from '../database';
import type { SyncDiscordIdentityDto } from './dto/sync-discord-identity.dto';

type ShadowOverrideCacheEntry = {
  expiresAt: number;
  value: boolean;
};

@Injectable()
export class AuthService {
  private readonly shadowOverrideCache = new Map<
    string,
    ShadowOverrideCacheEntry
  >();

  async syncDiscordIdentity(input: SyncDiscordIdentityDto) {
    const isShadowOverride = await this.isDiscordMemberShadowOverride(
      input.providerId,
    );
    const existingIdentity = await prisma.authIdentity.findUnique({
      where: {
        provider_providerId: {
          provider: input.provider,
          providerId: input.providerId,
        },
      },
      include: {
        user: true,
      },
    });

    if (existingIdentity) {
      const user = await prisma.user.update({
        where: { id: existingIdentity.userId },
        data: {
          email: input.email,
          displayName: input.displayName,
        },
        select: {
          id: true,
          email: true,
          displayName: true,
        },
      });

      return {
        ...user,
        isShadowOverride,
      };
    }

    const user = await prisma.$transaction(async (transaction) => {
      const user = await transaction.user.upsert({
        where: { email: input.email },
        update: {
          displayName: input.displayName,
        },
        create: {
          email: input.email,
          displayName: input.displayName,
        },
        select: {
          id: true,
          email: true,
          displayName: true,
        },
      });

      await transaction.authIdentity.create({
        data: {
          provider: input.provider,
          providerId: input.providerId,
          userId: user.id,
        },
      });

      return user;
    });

    return {
      ...user,
      isShadowOverride,
    };
  }

  async isUserShadowOverride(userId: string) {
    const identity = await prisma.authIdentity.findFirst({
      where: {
        provider: 'discord',
        userId,
      },
      select: {
        providerId: true,
      },
    });

    if (!identity?.providerId) {
      return false;
    }

    return this.isDiscordMemberShadowOverride(identity.providerId);
  }

  private async isDiscordMemberShadowOverride(discordId: string) {
    const roleId = process.env.SHADOW_OVERRIDE_DISCORD_ROLE_ID;
    const botToken = process.env.DISCORD_BOT_TOKEN;

    if (!roleId || !botToken || !discordId) {
      return false;
    }

    const cacheKey = `${roleId}:${discordId}`;
    const cached = this.shadowOverrideCache.get(cacheKey);

    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    const guildIds = [
      ...new Set(
        (
          await prisma.game.findMany({
            where: {
              discordGuildId: {
                not: null,
              },
            },
            select: {
              discordGuildId: true,
            },
          })
        )
          .map((game) => game.discordGuildId)
          .filter((guildId): guildId is string => Boolean(guildId)),
      ),
    ];

    if (guildIds.length === 0) {
      return false;
    }

    const cacheTtlMs = Number(
      process.env.SHADOW_OVERRIDE_CACHE_TTL_MS ?? 60_000,
    );

    try {
      for (const guildId of guildIds) {
        const response = await fetch(
          `https://discord.com/api/v10/guilds/${encodeURIComponent(guildId)}/members/${encodeURIComponent(discordId)}`,
          {
            headers: {
              authorization: `Bot ${botToken}`,
            },
            cache: 'no-store',
          },
        );

        if (!response.ok) {
          continue;
        }

        const payload = (await response.json().catch(() => null)) as {
          roles?: string[];
        } | null;
        const value = payload?.roles?.includes(roleId) ?? false;

        if (value) {
          this.shadowOverrideCache.set(cacheKey, {
            expiresAt: Date.now() + cacheTtlMs,
            value: true,
          });

          return true;
        }
      }

      this.shadowOverrideCache.set(cacheKey, {
        expiresAt: Date.now() + cacheTtlMs,
        value: false,
      });

      return false;
    } catch {
      return false;
    }
  }
}

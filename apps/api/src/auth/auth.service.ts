import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { SignJWT } from 'jose';
import { prisma } from '../database';
import type { SyncDiscordIdentityDto } from './dto/sync-discord-identity.dto';

const desktopHandoffTtlMs = 10 * 60 * 1_000;
const desktopHandoffPollIntervalMs = 1_500;
const desktopHandoffPruneAgeMs = 24 * 60 * 60 * 1_000;

type ShadowOverrideCacheEntry = {
  expiresAt: number;
  value: boolean;
};

type PollDesktopAuthHandoffInput = {
  handoffId: string;
  pollSecret?: string | null;
};

type ApproveDesktopAuthHandoffInput = {
  userId: string;
  email?: string | null;
  displayName?: string | null;
  avatarUrl?: string | null;
};

@Injectable()
export class AuthService {
  private readonly encoder = new TextEncoder();
  private readonly shadowOverrideCache = new Map<
    string,
    ShadowOverrideCacheEntry
  >();

  async createDesktopAuthHandoff() {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + desktopHandoffTtlMs);
    const pruneBefore = new Date(now.getTime() - desktopHandoffPruneAgeMs);
    const handoffId = randomToken();
    const pollSecret = randomToken();

    await prisma.desktopAuthHandoff.deleteMany({
      where: {
        OR: [
          { expiresAt: { lt: pruneBefore } },
          { consumedAt: { lt: pruneBefore } },
        ],
      },
    });

    await prisma.desktopAuthHandoff.create({
      data: {
        id: handoffId,
        pollSecretHash: hashPollSecret(pollSecret),
        expiresAt,
      },
    });

    return {
      handoffId,
      pollSecret,
      expiresAt: expiresAt.toISOString(),
      pollIntervalMs: desktopHandoffPollIntervalMs,
    };
  }

  async pollDesktopAuthHandoff(input: PollDesktopAuthHandoffInput) {
    const handoff = await prisma.desktopAuthHandoff.findUnique({
      where: { id: input.handoffId },
    });

    if (
      !handoff ||
      typeof input.pollSecret !== 'string' ||
      handoff.expiresAt <= new Date() ||
      handoff.consumedAt ||
      !isMatchingPollSecret(input.pollSecret, handoff.pollSecretHash)
    ) {
      return { status: 'expired' as const };
    }

    if (!handoff.approvedAt) {
      return {
        status: 'pending' as const,
        expiresAt: handoff.expiresAt.toISOString(),
      };
    }

    if (!handoff.approvedUserId) {
      return { status: 'expired' as const };
    }

    const consumed = await prisma.desktopAuthHandoff.updateMany({
      where: {
        id: handoff.id,
        pollSecretHash: handoff.pollSecretHash,
        expiresAt: { gt: new Date() },
        approvedAt: { not: null },
        consumedAt: null,
      },
      data: {
        consumedAt: new Date(),
      },
    });

    if (consumed.count !== 1) {
      return { status: 'expired' as const };
    }

    return {
      status: 'approved' as const,
      token: await this.createDesktopApiAccessToken({
        userId: handoff.approvedUserId,
        email: handoff.approvedUserEmail,
        displayName: handoff.approvedUserDisplayName,
        avatarUrl: handoff.approvedUserAvatarUrl,
      }),
    };
  }

  async approveDesktopAuthHandoff(
    handoffId: string,
    input: ApproveDesktopAuthHandoffInput,
  ) {
    const approved = await prisma.desktopAuthHandoff.updateMany({
      where: {
        id: handoffId,
        expiresAt: { gt: new Date() },
        approvedAt: null,
        consumedAt: null,
      },
      data: {
        approvedAt: new Date(),
        approvedUserId: input.userId,
        approvedUserEmail: input.email ?? null,
        approvedUserDisplayName: input.displayName ?? null,
        approvedUserAvatarUrl: input.avatarUrl ?? null,
      },
    });

    if (approved.count !== 1) {
      throw new UnauthorizedException('Desktop auth handoff is unavailable.');
    }

    return { status: 'approved' as const };
  }

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

  private async createDesktopApiAccessToken(input: {
    userId: string;
    email?: string | null;
    displayName?: string | null;
    avatarUrl?: string | null;
  }) {
    const authSecret = process.env.NEXTAUTH_SECRET ?? process.env.AUTH_SECRET;

    if (!authSecret) {
      throw new UnauthorizedException('NEXTAUTH_SECRET is not configured.');
    }

    return new SignJWT({
      email: input.email ?? undefined,
      picture: input.avatarUrl ?? undefined,
      name: input.displayName ?? undefined,
      tokenUse: 'desktop-sync',
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt()
      .setExpirationTime('180d')
      .setSubject(input.userId)
      .sign(this.encoder.encode(authSecret));
  }
}

function randomToken() {
  return randomBytes(32).toString('base64url');
}

function hashPollSecret(pollSecret: string) {
  return createHash('sha256').update(pollSecret).digest('hex');
}

function isMatchingPollSecret(pollSecret: string, expectedHash: string) {
  const actual = Buffer.from(hashPollSecret(pollSecret), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');

  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

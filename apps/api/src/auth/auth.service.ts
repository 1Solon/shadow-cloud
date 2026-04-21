import { Injectable } from '@nestjs/common';
import { prisma } from '../database';
import type { SyncDiscordIdentityDto } from './dto/sync-discord-identity.dto';

@Injectable()
export class AuthService {
  async syncDiscordIdentity(input: SyncDiscordIdentityDto) {
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
      return prisma.user.update({
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
    }

    return prisma.$transaction(async (transaction) => {
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
  }
}

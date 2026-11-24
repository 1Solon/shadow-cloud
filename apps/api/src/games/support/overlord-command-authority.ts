import { ForbiddenException } from '@nestjs/common';
import type { Prisma, User } from '@prisma/client';
import type { AuthService } from '../../auth/auth.service';

export type OverlordCommandName =
  'replace' | 'skip' | 'pin' | 'unpin' | 'winner' | 'unwinner';

export type OverlordCommandCaller = {
  discordId: string;
  user: User;
  isShadowLord: boolean;
} | null;

/** Shadow Lord status comes from Discord, so resolve it before any transaction. */
export async function resolveOverlordCommandCaller(
  database: Prisma.TransactionClient,
  authService: Pick<AuthService, 'isUserShadowOverride'> | undefined,
  overlordId: string,
  callerDiscordId: string,
): Promise<OverlordCommandCaller> {
  const identity = await database.authIdentity.findUnique({
    where: {
      provider_providerId: { provider: 'discord', providerId: callerDiscordId },
    },
    include: { user: true },
  });
  if (!identity) return null;
  return {
    discordId: callerDiscordId,
    user: identity.user,
    isShadowLord:
      identity.userId !== overlordId &&
      (await authService?.isUserShadowOverride(identity.userId)) === true,
  };
}

/** Rechecks the caller's Discord identity so a remapped identity is refused. */
export async function authorizeOverlordCommand(
  database: Prisma.TransactionClient,
  overlordId: string,
  caller: OverlordCommandCaller,
  commandName: OverlordCommandName,
): Promise<User> {
  const identity =
    caller &&
    (await database.authIdentity.findUnique({
      where: {
        provider_providerId: {
          provider: 'discord',
          providerId: caller.discordId,
        },
      },
      select: { userId: true },
    }));
  if (
    !caller ||
    identity?.userId !== caller.user.id ||
    (caller.user.id !== overlordId && !caller.isShadowLord)
  ) {
    throw new ForbiddenException(
      `Only the Overlord or a Shadow Lord can use /${commandName}.`,
    );
  }
  return caller.user;
}

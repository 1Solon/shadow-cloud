import type { Prisma } from '../../database';

export function getDiscordIdentity(user: {
  identities?: Array<{ provider: string; providerId: string }>;
}) {
  return (
    user.identities?.find((identity) => identity.provider === 'discord')
      ?.providerId ?? null
  );
}

export async function upsertDiscordUser(
  transaction: Prisma.TransactionClient,
  input: {
    discordId: string;
    displayName: string;
  },
) {
  const email = `${input.discordId}@discord.shadow-cloud.local`;
  const identity = await transaction.authIdentity.findUnique({
    where: {
      provider_providerId: {
        provider: 'discord',
        providerId: input.discordId,
      },
    },
  });

  if (identity) {
    return transaction.user.update({
      where: { id: identity.userId },
      data: {
        displayName: input.displayName,
      },
    });
  }

  const user = await transaction.user.upsert({
    where: { email },
    update: {
      displayName: input.displayName,
    },
    create: {
      email,
      displayName: input.displayName,
    },
  });

  await transaction.authIdentity.create({
    data: {
      provider: 'discord',
      providerId: input.discordId,
      userId: user.id,
    },
  });

  return user;
}

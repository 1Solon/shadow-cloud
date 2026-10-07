import { ConflictException } from '@nestjs/common';
import type { Prisma } from '../../database';

/** How long a concluded campaign keeps its saves downloadable before deletion. */
export const VICTORY_GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;

export function victoryDeletionDueAt(designatedAt: Date) {
  return new Date(designatedAt.getTime() + VICTORY_GRACE_PERIOD_MS);
}

export const campaignConcludedMessage =
  'This campaign has concluded. Only save downloads are available until it is deleted.';

/**
 * Call inside a mutation's transaction, after its first write, so a victory
 * committed concurrently is either visible here or fences the mutation out.
 */
export async function assertCampaignInPlay(
  transaction: Prisma.TransactionClient,
  gameId: string,
) {
  const victory = await transaction.victoryRecord.findUnique({
    where: { gameId },
    select: { id: true },
  });
  if (victory) throw new ConflictException(campaignConcludedMessage);
}

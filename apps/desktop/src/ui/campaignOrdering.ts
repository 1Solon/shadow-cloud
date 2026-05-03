import type { CampaignSyncState } from "@/sync/sync-engine";

export type CampaignEntry = [string, CampaignSyncState];

export function sortCampaignEntries(
  campaigns: Record<string, CampaignSyncState>,
  currentUserId: string | null,
) {
  const isUsersTurn = (campaign: CampaignSyncState) =>
    Boolean(currentUserId && campaign.activePlayerUserId === currentUserId);

  return Object.entries(campaigns).sort(
    ([_leftId, left], [_rightId, right]) => {
      const leftTurnPriority = isUsersTurn(left) ? 0 : 1;
      const rightTurnPriority = isUsersTurn(right) ? 0 : 1;

      if (leftTurnPriority !== rightTurnPriority) {
        return leftTurnPriority - rightTurnPriority;
      }

      return (left.gameNumber ?? 0) - (right.gameNumber ?? 0);
    },
  );
}

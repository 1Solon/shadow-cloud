import { describe, expect, it } from "vitest";
import {
  sortAndFilterCampaigns,
  type CampaignSortOption,
  type CampaignTurnFilter,
} from "@/components/campaign-list";
import type { GameListItem } from "@/lib/shadow-cloud-api";

function createGame(
  id: string,
  name: string,
  updatedAt: string,
  activePlayerUserId: string,
  gameNumber: number,
): GameListItem {
  return {
    id,
    slug: id,
    gameNumber,
    name,
    organizerDisplayName: "Overlord",
    updatedAt,
    roundNumber: 1,
    activePlayerUserId,
    activePlayerDisplayName: "Active lord",
    playerCount: 3,
    filledSeatCount: 3,
    participantUserIds: ["user-1"],
    turnTargetHours: 24,
    turnReminderGraceHours: 12,
    turnReminderRepeatHours: 6,
    turnRemindersEnabled: true,
    currentTurnStartedAt: updatedAt,
    latestSave: null,
  };
}

const campaigns = [
  createGame("zulu", "Zulu", "2026-01-01T00:00:00.000Z", "user-1", 3),
  createGame("alpha", "Alpha", "2026-03-01T00:00:00.000Z", "user-2", 1),
  createGame("bravo", "Bravo", "2026-02-01T00:00:00.000Z", "user-1", 2),
];

function campaignIds(
  sortOption: CampaignSortOption,
  turnFilter: CampaignTurnFilter = "all",
) {
  return sortAndFilterCampaigns(
    campaigns,
    "user-1",
    sortOption,
    turnFilter,
  ).map((campaign) => campaign.id);
}

describe("campaign list sorting and filtering", () => {
  it("sorts campaigns by newest or oldest update time", () => {
    expect(campaignIds("updated-desc")).toEqual(["alpha", "bravo", "zulu"]);
    expect(campaignIds("updated-asc")).toEqual(["zulu", "bravo", "alpha"]);
  });

  it("sorts campaigns by name in either direction", () => {
    expect(campaignIds("name-asc")).toEqual(["alpha", "bravo", "zulu"]);
    expect(campaignIds("name-desc")).toEqual(["zulu", "bravo", "alpha"]);
  });

  it("filters campaigns by whether it is the current user's turn", () => {
    expect(campaignIds("updated-desc", "your-turn")).toEqual(["bravo", "zulu"]);
    expect(campaignIds("updated-desc", "waiting")).toEqual(["alpha"]);
  });
});

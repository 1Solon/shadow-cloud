import { describe, expect, it } from "vitest";
import { sortCampaignEntries } from "./campaignOrdering";

describe("campaign ordering", () => {
  it("places current-user-turn campaigns before other campaigns", () => {
    expect(
      sortCampaignEntries(
        {
          laterTurn: {
            gameNumber: 1,
            activePlayerUserId: "other-user",
          },
          usersTurn: {
            gameNumber: 9,
            activePlayerUserId: "user-1",
          },
          alsoWaiting: {
            gameNumber: 2,
            activePlayerUserId: "other-user",
          },
        },
        "user-1",
      ).map(([campaignId]) => campaignId),
    ).toEqual(["usersTurn", "laterTurn", "alsoWaiting"]);
  });
});

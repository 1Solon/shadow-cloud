// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CampaignList,
  sortAndFilterCampaigns,
  type CampaignSortOption,
  type CampaignTurnFilter,
} from "@/components/campaign-list";
import type { GameListItem } from "@/lib/shadow-cloud-api";

vi.mock("@/components/campaign-card", () => ({
  CampaignCard: ({ game }: { game: { name: string } }) =>
    createElement("div", null, game.name),
}));

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
  searchQuery = "",
) {
  return sortAndFilterCampaigns(
    campaigns,
    "user-1",
    sortOption,
    turnFilter,
    searchQuery,
  ).map((campaign) => campaign.id);
}

afterEach(() => {
  cleanup();
});

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

  it("searches by campaign number or name without case sensitivity", () => {
    expect(campaignIds("updated-desc", "all", "2")).toEqual(["bravo"]);
    expect(campaignIds("updated-desc", "all", "ALP")).toEqual(["alpha"]);
  });

  it("exposes a labeled search field and filters cards as it changes", async () => {
    const user = userEvent.setup();
    render(
      createElement(CampaignList, {
        campaigns,
        title: "YOUR CAMPAIGNS",
        emptyTitle: "No campaigns",
        emptyDescription: "No campaigns are available.",
        currentUserId: "user-1",
        hasSortingOptions: true,
      }),
    );

    const search = screen.getByRole("searchbox", {
      name: "Search your campaigns by campaign number or name",
    });
    expect(search).toHaveAttribute("placeholder", "Number or name");

    await user.type(search, "ALP");

    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.queryByText("Bravo")).not.toBeInTheDocument();
    expect(screen.queryByText("Zulu")).not.toBeInTheDocument();
  });

  it("does not offer an open seats checkbox on your campaigns", () => {
    const campaignsWithOpenSeats = campaigns.map((campaign) =>
      campaign.id === "alpha" ? { ...campaign, filledSeatCount: 2 } : campaign,
    );
    render(
      createElement(CampaignList, {
        campaigns: campaignsWithOpenSeats,
        title: "YOUR CAMPAIGNS",
        emptyTitle: "No campaigns",
        emptyDescription: "No campaigns are available.",
        currentUserId: "user-1",
        hasSortingOptions: true,
      }),
    );

    expect(
      screen.queryByRole("checkbox", {
        name: "Filter your campaigns by seat availability",
      }),
    ).not.toBeInTheDocument();
  });

  it("does not offer the seat filter when seat counts are unreliable", () => {
    render(
      createElement(CampaignList, {
        campaigns: [{ ...campaigns[0], filledSeatCount: 4 }],
        title: "YOUR CAMPAIGNS",
        emptyTitle: "No campaigns",
        emptyDescription: "No campaigns are available.",
        currentUserId: "user-1",
        hasSortingOptions: true,
      }),
    );

    expect(
      screen.queryByRole("checkbox", {
        name: "Filter your campaigns by seat availability",
      }),
    ).not.toBeInTheDocument();
  });

  it("preserves active campaign search without an open seats checkbox", async () => {
    const user = userEvent.setup();
    const campaignsWithOpenSeats = campaigns.map((campaign) =>
      campaign.id === "alpha" ? { ...campaign, filledSeatCount: 2 } : campaign,
    );
    render(
      createElement(CampaignList, {
        campaigns: campaignsWithOpenSeats,
        title: "ACTIVE CAMPAIGNS",
        emptyTitle: "No campaigns",
        emptyDescription: "No campaigns are available.",
        currentUserId: "user-1",
      }),
    );

    const search = screen.getByRole("searchbox", {
      name: "Search active campaigns by campaign number or name",
    });
    expect(
      screen.queryByRole("checkbox", {
        name: "Filter active campaigns by seat availability",
      }),
    ).not.toBeInTheDocument();

    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();

    await user.type(search, "ALP");
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.queryByText("Bravo")).not.toBeInTheDocument();
    expect(screen.queryByText("Zulu")).not.toBeInTheDocument();

    await user.clear(search);
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Bravo")).toBeInTheDocument();
    expect(screen.getByText("Zulu")).toBeInTheDocument();
  });
});

"use client";

import { useState, type ReactNode } from "react";
import { CampaignCard } from "@/components/campaign-card";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { GameListItem } from "@/lib/shadow-cloud-api";

export type CampaignSortOption =
  "updated-desc" | "updated-asc" | "name-asc" | "name-desc";

export type CampaignTurnFilter = "all" | "your-turn" | "waiting";

const campaignNameCollator = new Intl.Collator("en", {
  numeric: true,
  sensitivity: "base",
});

function compareCampaignNames(left: GameListItem, right: GameListItem) {
  const nameComparison = campaignNameCollator.compare(left.name, right.name);
  return nameComparison || left.gameNumber - right.gameNumber;
}

export function sortAndFilterCampaigns(
  campaigns: GameListItem[],
  currentUserId: string | undefined,
  sortOption: CampaignSortOption,
  turnFilter: CampaignTurnFilter,
) {
  const filteredCampaigns = campaigns.filter((campaign) => {
    if (turnFilter === "all") {
      return true;
    }

    const isUsersTurn = Boolean(
      currentUserId && campaign.activePlayerUserId === currentUserId,
    );
    return turnFilter === "your-turn" ? isUsersTurn : !isUsersTurn;
  });

  return filteredCampaigns.sort((left, right) => {
    if (sortOption === "name-asc") {
      return compareCampaignNames(left, right);
    }

    if (sortOption === "name-desc") {
      return compareCampaignNames(right, left);
    }

    const leftUpdatedAt = Date.parse(left.updatedAt) || 0;
    const rightUpdatedAt = Date.parse(right.updatedAt) || 0;
    const updatedAtComparison = leftUpdatedAt - rightUpdatedAt;

    if (updatedAtComparison === 0) {
      return compareCampaignNames(left, right);
    }

    return sortOption === "updated-asc"
      ? updatedAtComparison
      : -updatedAtComparison;
  });
}

type CampaignListProps = {
  campaigns: GameListItem[];
  title: string;
  emptyTitle: string;
  emptyDescription: ReactNode;
  currentUserId?: string;
  hasSortingOptions?: boolean;
};

export function CampaignList({
  campaigns,
  title,
  emptyTitle,
  emptyDescription,
  currentUserId,
  hasSortingOptions = false,
}: CampaignListProps) {
  const [sortOption, setSortOption] =
    useState<CampaignSortOption>("updated-desc");
  const [turnFilter, setTurnFilter] = useState<CampaignTurnFilter>("all");
  const visibleCampaigns = hasSortingOptions
    ? sortAndFilterCampaigns(campaigns, currentUserId, sortOption, turnFilter)
    : campaigns;
  const hasActiveFilter = hasSortingOptions && turnFilter !== "all";
  const campaignCount = hasActiveFilter
    ? `${visibleCampaigns.length} / ${campaigns.length}`
    : String(visibleCampaigns.length);

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="font-mono text-lg text-orange-300">{`> ${title} (${campaignCount})`}</div>
        {hasSortingOptions && campaigns.length > 0 ? (
          <div className="flex flex-col gap-3 sm:flex-row">
            <label className="flex flex-col gap-1 text-xs uppercase tracking-[0.16em] text-orange-300/70">
              Sort by
              <Select
                value={sortOption}
                onValueChange={(value) => {
                  setSortOption(value as CampaignSortOption);
                }}
              >
                <SelectTrigger
                  className="w-full sm:w-56"
                  aria-label="Sort your campaigns"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper">
                  <SelectGroup>
                    <SelectItem value="updated-desc">Newest first</SelectItem>
                    <SelectItem value="updated-asc">Oldest first</SelectItem>
                    <SelectItem value="name-asc">A–Z</SelectItem>
                    <SelectItem value="name-desc">Z–A</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </label>
            <label className="flex flex-col gap-1 text-xs uppercase tracking-[0.16em] text-orange-300/70">
              Turn status
              <Select
                value={turnFilter}
                onValueChange={(value) => {
                  setTurnFilter(value as CampaignTurnFilter);
                }}
              >
                <SelectTrigger
                  className="w-full sm:w-52"
                  aria-label="Filter your campaigns by turn status"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper">
                  <SelectGroup>
                    <SelectItem value="all">All campaigns</SelectItem>
                    <SelectItem value="your-turn">Your turn only</SelectItem>
                    <SelectItem value="waiting">Waiting on others</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </label>
          </div>
        ) : null}
      </div>
      <div className="flex flex-col gap-3">
        {visibleCampaigns.length === 0 ? (
          <Card className="md:col-span-2 xl:col-span-3">
            <CardHeader>
              <CardTitle>
                {hasActiveFilter
                  ? "No campaigns match this turn filter"
                  : emptyTitle}
              </CardTitle>
              <CardDescription>
                {hasActiveFilter
                  ? "Choose another turn status to see more campaigns."
                  : emptyDescription}
              </CardDescription>
            </CardHeader>
          </Card>
        ) : (
          visibleCampaigns.map((game) => (
            <CampaignCard
              key={game.id}
              currentUserId={currentUserId}
              game={game}
            />
          ))
        )}
      </div>
    </section>
  );
}

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

function filterCampaigns(
  campaigns: GameListItem[],
  currentUserId: string | undefined,
  turnFilter: CampaignTurnFilter,
  searchQuery: string,
) {
  const normalizedSearchQuery = searchQuery.trim().toLowerCase();
  return campaigns.filter((campaign) => {
    if (
      normalizedSearchQuery &&
      !String(campaign.gameNumber).includes(normalizedSearchQuery) &&
      !campaign.name.toLowerCase().includes(normalizedSearchQuery)
    ) {
      return false;
    }

    const isUsersTurn = Boolean(
      currentUserId && campaign.activePlayerUserId === currentUserId,
    );
    if (
      turnFilter !== "all" &&
      (turnFilter === "your-turn" ? !isUsersTurn : isUsersTurn)
    ) {
      return false;
    }

    return true;
  });
}

export function sortAndFilterCampaigns(
  campaigns: GameListItem[],
  currentUserId: string | undefined,
  sortOption: CampaignSortOption,
  turnFilter: CampaignTurnFilter,
  searchQuery = "",
) {
  const filteredCampaigns = filterCampaigns(
    campaigns,
    currentUserId,
    turnFilter,
    searchQuery,
  );

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
  const [searchQuery, setSearchQuery] = useState("");
  const visibleCampaigns = hasSortingOptions
    ? sortAndFilterCampaigns(
        campaigns,
        currentUserId,
        sortOption,
        turnFilter,
        searchQuery,
      )
    : filterCampaigns(campaigns, currentUserId, "all", searchQuery);
  const hasActiveFilter =
    searchQuery.trim() !== "" || (hasSortingOptions && turnFilter !== "all");
  const campaignCount = hasActiveFilter
    ? `${visibleCampaigns.length} / ${campaigns.length}`
    : String(visibleCampaigns.length);
  const noMatchTitle =
    searchQuery.trim() !== ""
      ? "No campaigns match your search"
      : "No campaigns match this turn filter";
  const noMatchDescription =
    searchQuery.trim() !== ""
      ? "Try a different search or filter."
      : "Choose another turn status to see more campaigns.";
  const campaignListName = title.toLowerCase();

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
        <div className="font-mono text-lg text-orange-300">{`> ${title} (${campaignCount})`}</div>
        {campaigns.length > 0 ? (
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-end sm:gap-3 xl:justify-end">
            <label className="col-span-2 flex min-w-0 flex-col gap-1 text-xs uppercase tracking-[0.16em] text-orange-300/70 sm:w-56">
              Search
              <input
                type="search"
                value={searchQuery}
                onChange={(event) => {
                  setSearchQuery(event.target.value);
                }}
                placeholder="Number or name"
                aria-label={`Search ${campaignListName} by campaign number or name`}
                className="h-9 w-full rounded-md border border-orange-400 bg-black px-3 text-sm normal-case tracking-normal text-orange-300 shadow-xs outline-none placeholder:text-orange-300/40 focus-visible:ring-2 focus-visible:ring-orange-300"
              />
            </label>
            {hasSortingOptions ? (
              <>
                <label className="flex min-w-0 flex-col gap-1 text-xs uppercase tracking-[0.16em] text-orange-300/70 sm:w-56">
                  Sort by
                  <Select
                    value={sortOption}
                    onValueChange={(value) => {
                      setSortOption(value as CampaignSortOption);
                    }}
                  >
                    <SelectTrigger
                      className="w-full"
                      aria-label={`Sort ${campaignListName}`}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent position="popper">
                      <SelectGroup>
                        <SelectItem value="updated-desc">
                          Newest first
                        </SelectItem>
                        <SelectItem value="updated-asc">
                          Oldest first
                        </SelectItem>
                        <SelectItem value="name-asc">A–Z</SelectItem>
                        <SelectItem value="name-desc">Z–A</SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </label>
                <label className="flex min-w-0 flex-col gap-1 text-xs uppercase tracking-[0.16em] text-orange-300/70 sm:w-52">
                  Turn status
                  <Select
                    value={turnFilter}
                    onValueChange={(value) => {
                      setTurnFilter(value as CampaignTurnFilter);
                    }}
                  >
                    <SelectTrigger
                      className="w-full"
                      aria-label={`Filter ${campaignListName} by turn status`}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent position="popper">
                      <SelectGroup>
                        <SelectItem value="all">All campaigns</SelectItem>
                        <SelectItem value="your-turn">
                          Your turn only
                        </SelectItem>
                        <SelectItem value="waiting">
                          Waiting on others
                        </SelectItem>
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </label>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="flex flex-col gap-3">
        {visibleCampaigns.length === 0 ? (
          <Card className="md:col-span-2 xl:col-span-3">
            <CardHeader>
              <CardTitle>
                {hasActiveFilter ? noMatchTitle : emptyTitle}
              </CardTitle>
              <CardDescription>
                {hasActiveFilter ? noMatchDescription : emptyDescription}
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

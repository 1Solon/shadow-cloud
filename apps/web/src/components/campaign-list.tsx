"use client";

import { useState, type ReactNode } from "react";
import { CampaignCard } from "@/components/campaign-card";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { GameListItem } from "@/lib/shadow-cloud-api";
import { barLabel, segmentLines } from "@/lib/terminal-styles";
import { cn } from "@/lib/utils";

export type CampaignSortOption =
  "name-asc" | "number-asc" | "turn-oldest" | "turn-newest";

export type CampaignTurnFilter = "all" | "your-turn" | "waiting";

const campaignNameCollator = new Intl.Collator("en", {
  numeric: true,
  sensitivity: "base",
});

function compareCampaignNames(left: GameListItem, right: GameListItem) {
  const nameComparison = campaignNameCollator.compare(left.name, right.name);
  return nameComparison || left.gameNumber - right.gameNumber;
}

function isUsersTurn(
  campaign: GameListItem,
  currentUserId: string | undefined,
) {
  return Boolean(
    currentUserId && campaign.activePlayerUserId === currentUserId,
  );
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

    const usersTurn = isUsersTurn(campaign, currentUserId);
    if (
      turnFilter !== "all" &&
      (turnFilter === "your-turn" ? !usersTurn : usersTurn)
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
    const usersTurnComparison =
      Number(isUsersTurn(right, currentUserId)) -
      Number(isUsersTurn(left, currentUserId));
    if (usersTurnComparison !== 0) {
      return usersTurnComparison;
    }

    if (sortOption === "name-asc") {
      return compareCampaignNames(left, right);
    }

    if (sortOption === "number-asc") {
      return left.gameNumber - right.gameNumber;
    }

    const leftStart = Date.parse(left.currentTurnStartedAt ?? "");
    const rightStart = Date.parse(right.currentTurnStartedAt ?? "");
    if (Number.isNaN(leftStart) || Number.isNaN(rightStart)) {
      return Number.isNaN(leftStart) === Number.isNaN(rightStart)
        ? compareCampaignNames(left, right)
        : Number.isNaN(leftStart)
          ? 1
          : -1;
    }

    const comparison = leftStart - rightStart;
    return (
      (sortOption === "turn-oldest" ? comparison : -comparison) ||
      compareCampaignNames(left, right)
    );
  });
}

type CampaignListProps = {
  campaigns: GameListItem[];
  title: string;
  emptyTitle: string;
  emptyDescription: ReactNode;
  currentUserId?: string;
  hasExtendedControls?: boolean;
};

const sortOptions: [CampaignSortOption, string][] = [
  ["name-asc", "Name"],
  ["number-asc", "Number"],
  ["turn-oldest", "Turn (Oldest)"],
  ["turn-newest", "Turn (Newest)"],
];

const turnFilterOptions: [CampaignTurnFilter, string][] = [
  ["all", "All campaigns"],
  ["your-turn", "Your turn only"],
  ["waiting", "Waiting on others"],
];

function SegmentSelect<T extends string>({
  value,
  onValueChange,
  options,
  ariaLabel,
}: {
  value: T;
  onValueChange: (value: T) => void;
  options: [T, string][];
  ariaLabel: string;
}) {
  return (
    <Select
      value={value}
      onValueChange={(next) => {
        onValueChange(next as T);
      }}
    >
      <SelectTrigger
        aria-label={ariaLabel}
        className="h-auto min-h-8 rounded-none border-0 bg-transparent px-2 py-1 text-terminal-200 shadow-none hover:bg-terminal-400/10 focus-visible:ring-inset focus-visible:ring-offset-0"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper">
        <SelectGroup>
          {options.map(([option, label]) => (
            <SelectItem key={option} value={option}>
              {label}
            </SelectItem>
          ))}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

export function CampaignList({
  campaigns,
  title,
  emptyTitle,
  emptyDescription,
  currentUserId,
  hasExtendedControls = false,
}: CampaignListProps) {
  const [sortOption, setSortOption] =
    useState<CampaignSortOption>("turn-newest");
  const [turnFilter, setTurnFilter] = useState<CampaignTurnFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const visibleCampaigns = sortAndFilterCampaigns(
    campaigns,
    currentUserId,
    sortOption,
    hasExtendedControls ? turnFilter : "all",
    searchQuery,
  );
  const hasActiveFilter =
    searchQuery.trim() !== "" || (hasExtendedControls && turnFilter !== "all");
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
    <section className="flex flex-col gap-5">
      <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <h2 className="font-mono text-lg font-normal text-terminal-300">{`> ${title} (${campaignCount})`}</h2>
        {campaigns.length > 0 ? (
          <div
            className={cn(
              "flex min-w-0 flex-wrap items-stretch divide-x overflow-hidden rounded-lg border text-sm sm:flex-nowrap",
              segmentLines,
            )}
          >
            <label className="flex min-w-0 flex-1 items-center sm:w-56 sm:flex-none">
              <span aria-hidden="true" className="pl-2 text-terminal-300/60">
                /
              </span>
              <input
                type="search"
                value={searchQuery}
                onChange={(event) => {
                  setSearchQuery(event.target.value);
                }}
                placeholder="number or name"
                aria-label={`Search ${campaignListName} by campaign number or name`}
                className="w-full min-w-0 bg-transparent px-2 py-1 text-terminal-200 outline-none placeholder:text-terminal-300/40"
              />
            </label>
            <span className={barLabel}>Sort</span>
            <SegmentSelect
              value={sortOption}
              onValueChange={setSortOption}
              options={sortOptions}
              ariaLabel={`Sort ${campaignListName}`}
            />
            {hasExtendedControls ? (
              <>
                <span className={barLabel}>Status</span>
                <SegmentSelect
                  value={turnFilter}
                  onValueChange={setTurnFilter}
                  options={turnFilterOptions}
                  ariaLabel={`Filter ${campaignListName} by turn status`}
                />
              </>
            ) : null}
          </div>
        ) : null}
      </div>
      <div className="flex flex-col gap-4">
        {visibleCampaigns.length === 0 ? (
          <Card className="gap-1 border-terminal-400/20 bg-transparent px-4 py-6 text-sm text-terminal-300/70">
            <div className="text-terminal-300">
              {hasActiveFilter ? noMatchTitle : emptyTitle}
            </div>
            <div>{hasActiveFilter ? noMatchDescription : emptyDescription}</div>
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

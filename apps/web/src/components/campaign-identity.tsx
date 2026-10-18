import type { GameListItem } from "@/lib/shadow-cloud-api";
import { fieldLabel, padNumber, segment } from "@/lib/terminal-styles";
import { cn } from "@/lib/utils";

export function CampaignIdentity({
  game,
  className,
}: {
  game: Pick<GameListItem, "name" | "tagline">;
  className?: string;
}) {
  return (
    <span
      className={cn(
        segment,
        "min-w-0 flex-1 text-base font-semibold text-terminal-300",
        className,
      )}
    >
      <span className="min-w-0 truncate">{game.name}</span>
      {game.tagline ? (
        <span className="ml-3 min-w-0 shrink-[4] truncate text-sm font-normal text-terminal-300/50">
          {game.tagline}
        </span>
      ) : null}
    </span>
  );
}

export function RoundSegment({ roundNumber }: { roundNumber: number }) {
  return (
    <span className={cn(segment, "gap-2 px-3")}>
      <span className={fieldLabel}>Round</span>
      <span className="min-w-[2ch] text-base font-bold tabular-nums text-terminal-200">
        {padNumber(roundNumber)}
      </span>
    </span>
  );
}

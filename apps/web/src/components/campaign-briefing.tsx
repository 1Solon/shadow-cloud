"use client";

import { useId } from "react";
import { GameNotesMarkdown } from "@/components/game-notes-markdown";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { fieldLabel, fieldValue } from "@/lib/terminal-styles";
import { cn } from "@/lib/utils";

export type CampaignBriefingPlayer = {
  id: string;
  userId: string | null;
  displayName: string | null;
  turnOrder: number;
  isOrganizer: boolean;
};

export type CampaignBriefingProps = {
  activePlayerEntryId: string | null;
  headerAction?: React.ReactNode;
  name: string;
  organizerDisplayName: string;
  playerCount: number | null;
  players: CampaignBriefingPlayer[];
  hasAiPlayers: boolean | null;
  dlcMode: string | null;
  gameMode: string | null;
  techLevel: number | null;
  zoneCount: string | null;
  armyCount: string | null;
  notes: string;
  turnTargetHours: number | null;
  turnReminderGraceHours: number | null;
  turnReminderRepeatHours: number | null;
  turnRemindersEnabled: boolean;
};

const dlcLabels: Record<string, string> = {
  NONE: "None",
  OCEANIA: "Oceania",
  REPUBLICA: "Republica",
  BOTH: "Both",
};

const gameModeLabels: Record<string, string> = {
  TEAMS: "Teams",
  TEAMS_AI: "Teams+AI",
  FFA: "FFA",
  FFA_AI: "FFA+AI",
};

const zoneCountLabels: Record<string, string> = {
  CITY_STATE: "City State",
  TWO_ZONE_START: "2 Zone Start",
  THREE_ZONE_START: "3 Zone Start",
};

const armyCountLabels: Record<string, string> = {
  MILITIA_ONLY: "Militia Only",
  ONE_PER_ZONE: "1 Army per Zone",
  TWO_PER_ZONE: "2 Armies per Zone",
};

function enumLabel(value: string | null, labels: Record<string, string>) {
  return value == null ? "Unknown" : (labels[value] ?? "Unknown");
}

function wholePositiveNumber(value: number | null): value is number {
  return value != null && Number.isSafeInteger(value) && value > 0;
}

function configuredNumber(value: number | null, knownValues?: number[]) {
  if (!wholePositiveNumber(value)) {
    return "Unknown";
  }
  if (knownValues && !knownValues.includes(value)) {
    return "Unknown";
  }
  return String(value);
}

function duration(value: number | null) {
  return wholePositiveNumber(value) ? `${value} hours` : "Unknown";
}

function DefinitionValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 py-3">
      <dt className={fieldLabel}>{label}</dt>
      <dd className={cn("mt-1 break-words", fieldValue)}>{value}</dd>
    </div>
  );
}

export function CampaignBriefing({
  activePlayerEntryId,
  headerAction,
  name,
  organizerDisplayName,
  playerCount,
  players,
  hasAiPlayers,
  dlcMode,
  gameMode,
  techLevel,
  zoneCount,
  armyCount,
  notes,
  turnTargetHours,
  turnReminderGraceHours,
  turnReminderRepeatHours,
  turnRemindersEnabled,
}: CampaignBriefingProps) {
  const headingId = useId();
  const orderedPlayers = [...players].sort(
    (left, right) => left.turnOrder - right.turnOrder,
  );
  const occupiedSeats = players.filter(
    (player) => player.userId != null,
  ).length;
  const hasNotes = notes.trim().length > 0;
  const hasKnownTarget = wholePositiveNumber(turnTargetHours);

  return (
    <Card
      aria-labelledby={headingId}
      className="min-w-0 overflow-hidden font-mono text-terminal-300"
      role="region"
    >
      <CardHeader>
        <div className="flex items-stretch justify-between gap-4">
          <div className="min-w-0">
            <CardTitle id={headingId}>Campaign briefing</CardTitle>
            <CardDescription>
              Review campaign settings, seat order, notes, and turn reminders.
            </CardDescription>
          </div>
          {headerAction ? <div className="shrink-0">{headerAction}</div> : null}
        </div>
      </CardHeader>

      <div
        className="border-t border-terminal-400/20 px-4 py-4 sm:px-6"
        data-testid="campaign-briefing-identity"
      >
        <p className="break-words text-lg font-medium text-terminal-200">
          {name}
        </p>
        <p className={cn("mt-1", fieldLabel)}>
          Overlord · {organizerDisplayName}
        </p>
      </div>

      <dl
        data-testid="campaign-briefing-values"
        className="grid min-w-0 divide-y divide-terminal-400/20 px-4 sm:grid-cols-2 sm:gap-x-6 sm:divide-y-0 sm:px-6"
      >
        <DefinitionValue
          label="Players"
          value={configuredNumber(playerCount)}
        />
        <DefinitionValue
          label="AI Players"
          value={
            hasAiPlayers == null
              ? "Unknown"
              : hasAiPlayers
                ? "Included"
                : "None"
          }
        />
        <DefinitionValue label="DLC" value={enumLabel(dlcMode, dlcLabels)} />
        <DefinitionValue
          label="Game Mode"
          value={enumLabel(gameMode, gameModeLabels)}
        />
        <DefinitionValue
          label="Tech Level"
          value={configuredNumber(techLevel, [3, 4, 5])}
        />
        <DefinitionValue
          label="Starting Zones"
          value={enumLabel(zoneCount, zoneCountLabels)}
        />
        <DefinitionValue
          label="Starting Armies"
          value={enumLabel(armyCount, armyCountLabels)}
        />
      </dl>

      <Accordion collapsible type="single">
        <AccordionItem
          className="border-t border-terminal-400/20 px-4 sm:px-6"
          value="seats"
        >
          <AccordionTrigger>
            SEAT ORDER · {occupiedSeats}/{players.length} SEATS
          </AccordionTrigger>
          <AccordionContent>
            <ol className="divide-y divide-terminal-400/20 border-y border-terminal-400/20">
              {orderedPlayers.map((player) => {
                const occupied = player.userId != null;
                const isActive = occupied && player.id === activePlayerEntryId;
                return (
                  <li
                    key={player.id}
                    aria-current={isActive ? "true" : undefined}
                    className="grid min-w-0 grid-cols-[6.5rem_minmax(0,1fr)] items-start gap-x-4 py-2 sm:grid-cols-[7.5rem_minmax(0,1fr)]"
                  >
                    <span
                      className={cn(
                        "w-fit shrink-0 rounded-sm px-2 py-0.5",
                        isActive
                          ? "bg-terminal-400 text-xs font-bold uppercase tracking-[0.16em] text-primary-foreground"
                          : fieldLabel,
                      )}
                    >
                      SEAT {player.turnOrder}
                      {isActive ? (
                        <span className="sr-only"> (active seat)</span>
                      ) : null}
                    </span>
                    <span className="min-w-0 text-left">
                      <span
                        className={cn(
                          "block min-w-0 break-words",
                          occupied
                            ? fieldValue
                            : "text-sm font-medium text-terminal-300/50",
                        )}
                      >
                        {occupied
                          ? (player.displayName ?? "Occupied")
                          : "Empty"}
                      </span>
                      {player.isOrganizer ? (
                        <span className={cn("block", fieldLabel)}>
                          Overlord
                        </span>
                      ) : null}
                    </span>
                  </li>
                );
              })}
            </ol>
          </AccordionContent>
        </AccordionItem>

        <AccordionItem
          className="border-t border-terminal-400/20 px-4 sm:px-6"
          value="notes"
        >
          <AccordionTrigger>CAMPAIGN NOTES</AccordionTrigger>
          <AccordionContent>
            {hasNotes ? (
              <GameNotesMarkdown
                content={notes}
                className="rounded-none border-0 bg-transparent px-0 py-0"
              />
            ) : (
              <p className="text-xs text-terminal-300/70">
                No campaign notes recorded.
              </p>
            )}
          </AccordionContent>
        </AccordionItem>

        <AccordionItem
          className="border-t border-terminal-400/20 px-4 sm:px-6"
          value="protocol"
        >
          <AccordionTrigger>
            TURN REMINDERS ·{" "}
            {hasKnownTarget ? `${turnTargetHours}H` : "UNKNOWN"} TARGET
          </AccordionTrigger>
          <AccordionContent>
            <dl className="grid min-w-0 divide-y divide-terminal-400/20 sm:grid-cols-2 sm:gap-x-6 sm:divide-y-0">
              <DefinitionValue
                label="Target turn"
                value={duration(turnTargetHours)}
              />
              <DefinitionValue
                label="Reminders"
                value={turnRemindersEnabled ? "Enabled" : "Disabled"}
              />
              <DefinitionValue
                label="Reminder grace"
                value={duration(turnReminderGraceHours)}
              />
              <DefinitionValue
                label="Repeat interval"
                value={duration(turnReminderRepeatHours)}
              />
            </dl>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </Card>
  );
}

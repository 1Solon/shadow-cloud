"use client";

import { useId, useState } from "react";
import { GameNotesMarkdown } from "@/components/game-notes-markdown";

export type CampaignBriefingPlayer = {
  id: string;
  userId: string | null;
  displayName: string | null;
  turnOrder: number;
  isOrganizer: boolean;
};

export type CampaignBriefingProps = {
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

type Disclosure = "seats" | "notes" | "protocol";

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
      <dt className="text-[11px] uppercase tracking-[0.2em] text-orange-300/60">
        {label}
      </dt>
      <dd className="mt-1 break-words text-sm text-orange-100">{value}</dd>
    </div>
  );
}

function DisclosureButton({
  children,
  controls,
  expanded,
  onClick,
}: {
  children: React.ReactNode;
  controls: string;
  expanded: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-controls={controls}
      aria-expanded={expanded}
      className="flex w-full items-center justify-between gap-4 py-4 text-left text-xs font-semibold uppercase tracking-[0.18em] text-orange-300 transition-colors hover:text-orange-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      onClick={onClick}
    >
      <span>{children}</span>
      <span aria-hidden="true" className="text-orange-300/60">
        {expanded ? "[-]" : "[+]"}
      </span>
    </button>
  );
}

export function CampaignBriefing({
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
  const panelIdBase = useId();
  const [openDisclosure, setOpenDisclosure] = useState<Disclosure | null>(null);
  const seatPanelId = `${panelIdBase}-seats`;
  const notesPanelId = `${panelIdBase}-notes`;
  const protocolPanelId = `${panelIdBase}-protocol`;
  const orderedPlayers = [...players].sort(
    (left, right) => left.turnOrder - right.turnOrder,
  );
  const occupiedSeats = players.filter(
    (player) => player.userId != null,
  ).length;
  const hasNotes = notes.trim().length > 0;
  const hasKnownTarget = wholePositiveNumber(turnTargetHours);

  function toggleDisclosure(disclosure: Disclosure) {
    setOpenDisclosure((current) =>
      current === disclosure ? null : disclosure,
    );
  }

  return (
    <section
      aria-labelledby={headingId}
      className="min-w-0 border border-orange-400/30 bg-black/50 font-mono text-orange-200"
    >
      <header className="border-b border-orange-400/25 px-4 py-4 sm:px-6">
        <h2
          id={headingId}
          className="text-sm font-semibold uppercase tracking-[0.24em] text-orange-300"
        >
          CAMPAIGN // BRIEFING
        </h2>
        <div className="mt-4 flex min-w-0 flex-col gap-1">
          <p className="break-words text-xl font-semibold text-orange-100">
            {name}
          </p>
          <p className="text-xs uppercase tracking-[0.16em] text-orange-300/60">
            Overlord · {organizerDisplayName}
          </p>
        </div>
      </header>

      <dl
        data-testid="campaign-briefing-values"
        className="grid min-w-0 divide-y divide-orange-400/20 px-4 sm:grid-cols-2 sm:gap-x-6 sm:divide-y-0 sm:px-6"
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

      <div className="border-t border-orange-400/25 px-4 sm:px-6">
        <DisclosureButton
          controls={seatPanelId}
          expanded={openDisclosure === "seats"}
          onClick={() => toggleDisclosure("seats")}
        >
          SEAT ORDER · {occupiedSeats}/{players.length} SEATS
        </DisclosureButton>
        {openDisclosure === "seats" ? (
          <div id={seatPanelId} className="pb-4">
            <ol className="flex flex-col gap-2">
              {orderedPlayers.map((player) => {
                const occupied = player.userId != null;
                return (
                  <li
                    key={player.id}
                    className="flex min-w-0 items-start justify-between gap-4 border-t border-orange-400/15 pt-2 text-sm"
                  >
                    <span className="shrink-0 text-orange-300/60">
                      SEAT {String(player.turnOrder).padStart(2, "0")}
                    </span>
                    <span className="min-w-0 break-words text-right text-orange-100">
                      {occupied ? (player.displayName ?? "Occupied") : "Empty"}
                      <span className="block text-xs uppercase tracking-[0.12em] text-orange-300/60">
                        {occupied ? "Occupied" : "Empty"}
                        {player.isOrganizer ? " · Overlord" : ""}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>
        ) : null}
      </div>

      <div className="border-t border-orange-400/25 px-4 sm:px-6">
        <DisclosureButton
          controls={notesPanelId}
          expanded={openDisclosure === "notes"}
          onClick={() => toggleDisclosure("notes")}
        >
          CAMPAIGN NOTES · {hasNotes ? "RECORDED" : "EMPTY"}
        </DisclosureButton>
        {openDisclosure === "notes" ? (
          <div id={notesPanelId} className="pb-4">
            {hasNotes ? (
              <GameNotesMarkdown
                content={notes}
                className="rounded-none border-0 bg-transparent px-0 py-0"
              />
            ) : (
              <p className="text-sm text-orange-300/60">
                No campaign notes recorded.
              </p>
            )}
          </div>
        ) : null}
      </div>

      <div className="border-t border-orange-400/25 px-4 sm:px-6">
        <DisclosureButton
          controls={protocolPanelId}
          expanded={openDisclosure === "protocol"}
          onClick={() => toggleDisclosure("protocol")}
        >
          TURN PROTOCOL · {hasKnownTarget ? `${turnTargetHours}H` : "UNKNOWN"}{" "}
          TARGET
        </DisclosureButton>
        {openDisclosure === "protocol" ? (
          <dl
            id={protocolPanelId}
            className="grid min-w-0 divide-y divide-orange-400/15 pb-4 sm:grid-cols-2 sm:gap-x-6 sm:divide-y-0"
          >
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
        ) : null}
      </div>
    </section>
  );
}

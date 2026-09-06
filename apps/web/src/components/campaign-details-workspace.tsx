"use client";

import { useState } from "react";
import {
  CampaignBriefing,
  type CampaignBriefingProps,
} from "@/components/campaign-briefing";
import {
  CampaignConfigurationShell,
  type CampaignConfigurationSection,
  type CampaignEditorStateProps,
} from "@/components/campaign-configuration-shell";
import { CampaignNotesEditor } from "@/components/campaign-notes-editor";
import { CampaignSettingsEditor } from "@/components/campaign-settings-editor";
import { SeatOrderEditor } from "@/components/seat-order-editor";
import type { SeatOrderBaseline } from "@/lib/shadow-cloud-api";

type CampaignDetailsWorkspaceProps = Omit<CampaignBriefingProps, "notes"> & {
  canEdit: boolean;
  seatOrderBaseline: SeatOrderBaseline;
  gameNumber: number;
  notes: string | null;
  roundNumber: number;
  turnTargetHours: number;
  turnReminderGraceHours: number;
  turnReminderRepeatHours: number;
};

export function CampaignDetailsWorkspace(props: CampaignDetailsWorkspaceProps) {
  return (
    <CampaignDetailsWorkspaceContent
      key={props.seatOrderBaseline.campaignId}
      {...props}
    />
  );
}

function CampaignDetailsWorkspaceContent(props: CampaignDetailsWorkspaceProps) {
  const [mode, setMode] = useState<"briefing" | "configuration">("briefing");
  const [seatOrder, setSeatOrder] = useState({
    players: props.players,
    activePlayerEntryId: props.activePlayerEntryId,
    seatOrderBaseline: props.seatOrderBaseline,
  });
  const [previousPlayers, setPreviousPlayers] = useState(props.players);
  const incomingPlayersChanged = previousPlayers !== props.players;
  if (incomingPlayersChanged) setPreviousPlayers(props.players);

  if (
    props.seatOrderBaseline.campaignId ===
      seatOrder.seatOrderBaseline.campaignId &&
    props.seatOrderBaseline.revision >= seatOrder.seatOrderBaseline.revision &&
    (incomingPlayersChanged ||
      props.seatOrderBaseline.revision !== seatOrder.seatOrderBaseline.revision)
  ) {
    setSeatOrder({
      players: props.players,
      activePlayerEntryId: props.activePlayerEntryId,
      seatOrderBaseline: props.seatOrderBaseline,
    });
  }

  if (!props.canEdit && mode === "configuration") {
    setMode("briefing");
  }

  const isConfiguring = mode === "configuration" && props.canEdit;

  function renderSection(
    section: CampaignConfigurationSection,
    editorStateProps: CampaignEditorStateProps,
  ) {
    if (section === "seat-order") {
      return (
        <SeatOrderEditor
          activePlayerEntryId={seatOrder.activePlayerEntryId}
          canEdit={props.canEdit}
          gameNumber={props.gameNumber}
          players={seatOrder.players}
          seatOrderBaseline={seatOrder.seatOrderBaseline}
          onSnapshotAccepted={(snapshot) => {
            setSeatOrder((current) =>
              snapshot.gameId === current.seatOrderBaseline.campaignId &&
              snapshot.seatOrderBaseline.revision >=
                current.seatOrderBaseline.revision
                ? snapshot
                : current,
            );
          }}
          presentation="configuration"
          {...editorStateProps}
        />
      );
    }

    if (section === "notes") {
      return (
        <CampaignNotesEditor
          gameNumber={props.gameNumber}
          notes={props.notes}
          {...editorStateProps}
        />
      );
    }

    return (
      <CampaignSettingsEditor
        armyCount={props.armyCount}
        dlcMode={props.dlcMode}
        gameMode={props.gameMode}
        gameNumber={props.gameNumber}
        hasAiPlayers={props.hasAiPlayers}
        name={props.name}
        organizerDisplayName={props.organizerDisplayName}
        playerCount={props.playerCount}
        players={props.players}
        roundNumber={props.roundNumber}
        section={section}
        techLevel={props.techLevel}
        turnReminderGraceHours={props.turnReminderGraceHours}
        turnReminderRepeatHours={props.turnReminderRepeatHours}
        turnRemindersEnabled={props.turnRemindersEnabled}
        turnTargetHours={props.turnTargetHours}
        zoneCount={props.zoneCount}
        {...editorStateProps}
      />
    );
  }

  if (isConfiguring) {
    return (
      <CampaignConfigurationShell
        onExit={() => setMode("briefing")}
        renderSection={renderSection}
      />
    );
  }

  return (
    <div className="min-w-0 font-mono" data-testid="campaign-details-workspace">
      <CampaignBriefing
        activePlayerEntryId={props.activePlayerEntryId}
        headerAction={
          props.canEdit ? (
            <button
              className="h-full border border-orange-400/40 px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-orange-300 transition-colors hover:bg-orange-400/10 hover:text-orange-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              type="button"
              onClick={() => setMode("configuration")}
            >
              Configure campaign
            </button>
          ) : undefined
        }
        armyCount={props.armyCount}
        dlcMode={props.dlcMode}
        gameMode={props.gameMode}
        hasAiPlayers={props.hasAiPlayers}
        name={props.name}
        notes={props.notes ?? ""}
        organizerDisplayName={props.organizerDisplayName}
        playerCount={props.playerCount}
        players={props.players}
        techLevel={props.techLevel}
        turnReminderGraceHours={props.turnReminderGraceHours}
        turnReminderRepeatHours={props.turnReminderRepeatHours}
        turnRemindersEnabled={props.turnRemindersEnabled}
        turnTargetHours={props.turnTargetHours}
        zoneCount={props.zoneCount}
      />
    </div>
  );
}

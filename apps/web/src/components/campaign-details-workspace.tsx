"use client";

import { useEffect, useRef, useState } from "react";
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
import { Button } from "@/components/ui/button";
import { useAcceptedRoster } from "@/components/accepted-roster";
import type { SeatOrderBaseline } from "@/lib/shadow-cloud-api";

type CampaignDetailsWorkspaceProps = Omit<CampaignBriefingProps, "notes"> & {
  identityReadId: string;
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
  const configurationEntryRef = useRef<HTMLDivElement>(null);
  const roster = useAcceptedRoster({
    players: props.players,
    activePlayerEntryId: props.activePlayerEntryId,
    seatOrderBaseline: props.seatOrderBaseline,
  });
  if (!props.canEdit && mode === "configuration") {
    setMode("briefing");
  }

  const isConfiguring = mode === "configuration" && props.canEdit;

  useEffect(() => {
    if (!isConfiguring) {
      return;
    }

    configurationEntryRef.current?.scrollIntoView?.({ block: "start" });
  }, [isConfiguring]);

  function renderSection(
    section: CampaignConfigurationSection,
    editorStateProps: CampaignEditorStateProps,
  ) {
    if (section === "seat-order") {
      return (
        <SeatOrderEditor
          roster={roster}
          canEdit={props.canEdit}
          gameNumber={props.gameNumber}
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
        campaignId={props.seatOrderBaseline.campaignId}
        identityReadId={props.identityReadId}
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
      <div
        ref={configurationEntryRef}
        className="min-w-0 scroll-mt-4 md:flex md:min-h-128 md:grow md:basis-0 md:flex-col"
        data-testid="campaign-configuration-entry"
      >
        <CampaignConfigurationShell
          onExit={() => setMode("briefing")}
          renderSection={renderSection}
        />
      </div>
    );
  }

  return (
    <div className="min-w-0 font-mono" data-testid="campaign-details-workspace">
      <CampaignBriefing
        activePlayerEntryId={props.activePlayerEntryId}
        headerAction={
          props.canEdit ? (
            <Button
              className="h-full px-3"
              type="button"
              variant="command"
              onClick={() => setMode("configuration")}
            >
              Configure campaign
            </Button>
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

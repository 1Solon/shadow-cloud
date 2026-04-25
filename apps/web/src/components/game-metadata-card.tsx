"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  TerminalConfirmationModal,
  type TerminalConfirmationSpec,
} from "@/components/terminal-confirmation-modal";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type GameMetadataCardProps = {
  gameNumber: number;
  canEdit: boolean;
  name: string;
  organizerDisplayName: string;
  activePlayerDisplayName: string;
  roundNumber: number;
  playerCount: number | null;
  hasAiPlayers: boolean | null;
  dlcMode: string | null;
  gameMode: string | null;
  techLevel: number | null;
  zoneCount: string | null;
  armyCount: string | null;
  players: Array<{
    id: string;
    userId: string | null;
    displayName: string | null;
    turnOrder: number;
    isOrganizer: boolean;
  }>;
};

type PendingHostTransfer = {
  seatEntryId: string;
  seatNumber: number;
  displayName: string;
  metadataPayload: ReturnType<typeof buildMetadataPayload>;
  gameNumber: number;
};

const dlcOptions = [
  { label: "None", value: "NONE" },
  { label: "Oceania", value: "OCEANIA" },
  { label: "Republica", value: "REPUBLICA" },
  { label: "Both", value: "BOTH" },
] as const;

const gameModeOptions = [
  { label: "Teams", value: "TEAMS" },
  { label: "Teams+AI", value: "TEAMS_AI" },
  { label: "FFA", value: "FFA" },
  { label: "FFA+AI", value: "FFA_AI" },
] as const;

const zoneCountOptions = [
  { label: "City State", value: "CITY_STATE" },
  { label: "2 Zone Start", value: "TWO_ZONE_START" },
  { label: "3 Zone Start", value: "THREE_ZONE_START" },
] as const;

const armyCountOptions = [
  { label: "Militia Only", value: "MILITIA_ONLY" },
  { label: "1 Army per Zone", value: "ONE_PER_ZONE" },
  { label: "2 Armies per Zone", value: "TWO_PER_ZONE" },
] as const;

const techLevelOptions = [3, 4, 5] as const;

type MetadataDraft = {
  gameNumber: string;
  name: string;
  roundNumber: string;
  playerCount: string;
  hasAiPlayers: string;
  dlcMode: string;
  gameMode: string;
  techLevel: string;
  zoneCount: string;
  armyCount: string;
};

function createDraft({
  gameNumber,
  name,
  roundNumber,
  playerCount,
  hasAiPlayers,
  dlcMode,
  gameMode,
  techLevel,
  zoneCount,
  armyCount,
}: Omit<
  GameMetadataCardProps,
  "canEdit" | "organizerDisplayName" | "activePlayerDisplayName"
>) {
  return {
    gameNumber: String(gameNumber),
    name,
    roundNumber: String(roundNumber),
    playerCount: playerCount == null ? "" : String(playerCount),
    hasAiPlayers: hasAiPlayers == null ? "" : hasAiPlayers ? "true" : "false",
    dlcMode: dlcMode ?? "",
    gameMode: gameMode ?? "",
    techLevel: techLevel == null ? "" : String(techLevel),
    zoneCount: zoneCount ?? "",
    armyCount: armyCount ?? "",
  };
}

function getOptionLabel(
  value: string | null,
  options: ReadonlyArray<{ label: string; value: string }>,
) {
  return options.find((option) => option.value === value)?.label ?? "Unknown";
}

function formatAiPlayers(value: boolean | null) {
  if (value == null) {
    return "Unknown";
  }

  return value ? "Included" : "None";
}

function buildMetadataPayload(
  draft: MetadataDraft,
  initialDraft: MetadataDraft,
) {
  const payload: {
    gameNumber?: number;
    name?: string;
    roundNumber?: number;
    playerCount?: number;
    hasAiPlayers?: boolean;
    dlcMode?: string;
    gameMode?: string;
    techLevel?: number;
    zoneCount?: string;
    armyCount?: string;
  } = {};

  if (draft.gameNumber !== initialDraft.gameNumber && draft.gameNumber !== "") {
    payload.gameNumber = Number(draft.gameNumber);
  }

  const normalizedName = draft.name.trim();
  const initialName = initialDraft.name.trim();

  if (normalizedName !== initialName) {
    payload.name = normalizedName;
  }

  if (
    draft.roundNumber !== initialDraft.roundNumber &&
    draft.roundNumber !== ""
  ) {
    payload.roundNumber = Number(draft.roundNumber);
  }

  if (
    draft.playerCount !== initialDraft.playerCount &&
    draft.playerCount !== ""
  ) {
    payload.playerCount = Number(draft.playerCount);
  }

  if (
    draft.hasAiPlayers !== initialDraft.hasAiPlayers &&
    draft.hasAiPlayers !== ""
  ) {
    payload.hasAiPlayers = draft.hasAiPlayers === "true";
  }

  if (draft.dlcMode !== initialDraft.dlcMode && draft.dlcMode !== "") {
    payload.dlcMode = draft.dlcMode;
  }

  if (draft.gameMode !== initialDraft.gameMode && draft.gameMode !== "") {
    payload.gameMode = draft.gameMode;
  }

  if (draft.techLevel !== initialDraft.techLevel && draft.techLevel !== "") {
    payload.techLevel = Number(draft.techLevel);
  }

  if (draft.zoneCount !== initialDraft.zoneCount && draft.zoneCount !== "") {
    payload.zoneCount = draft.zoneCount;
  }

  if (draft.armyCount !== initialDraft.armyCount && draft.armyCount !== "") {
    payload.armyCount = draft.armyCount;
  }

  return payload;
}

function DetailTile({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="rounded-lg border border-orange-400/20 bg-orange-400/5 px-4 py-4">
      <div className="text-xs uppercase tracking-[0.24em] text-orange-300/70">
        {label}
      </div>
      <div className="mt-2 text-lg font-medium text-orange-300">{value}</div>
    </div>
  );
}

function EditField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="rounded-lg border border-orange-400/20 bg-orange-400/5 px-4 py-4 text-sm font-mono text-orange-200">
      <div className="text-xs uppercase tracking-[0.24em] text-orange-300/70">
        {label}
      </div>
      <div className="mt-3">{children}</div>
    </label>
  );
}

const controlClassName =
  "h-11 w-full rounded-md border border-orange-400/30 bg-black px-3 text-sm font-mono text-orange-200 outline-none transition focus:border-orange-300";

function HostTransferConfirmationDialog({
  target,
  isPending,
  onCancel,
  onConfirm,
}: {
  target: PendingHostTransfer | null;
  isPending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  if (!target) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-6">
      <div className="relative w-full max-w-md overflow-hidden rounded-2xl border border-orange-400/30 bg-[#0a0711] shadow-2xl shadow-orange-950/40">
        <div className="flex items-center justify-between border-b border-orange-400/20 bg-orange-400/10 px-4 py-3 font-mono text-[11px] uppercase tracking-[0.28em] text-orange-200">
          <span>Confirm Overlord Transfer</span>
          <button
            aria-label="Close confirmation"
            className="text-orange-300/70 transition-colors hover:text-orange-200"
            type="button"
            onClick={onCancel}
          >
            X
          </button>
        </div>
        <div className="space-y-4 bg-black/70 px-4 py-4 font-mono text-sm text-orange-300">
          <div className="space-y-1 text-orange-200/85">
            <div>&gt; overlord --transfer seat-{target.seatNumber}</div>
            <div className="whitespace-pre-wrap break-words leading-6">
              {target.displayName} will receive campaign control and become the
              new Overlord.
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              disabled={isPending}
              type="button"
              variant="secondary"
              onClick={onCancel}
            >
              Cancel
            </Button>
            <Button disabled={isPending} type="button" onClick={onConfirm}>
              Confirm
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function GameMetadataCard(props: GameMetadataCardProps) {
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(() => createDraft(props));
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [confirmation, setConfirmation] =
    useState<TerminalConfirmationSpec | null>(null);
  const [isPending, startTransition] = useTransition();
  const [pendingTransfer, setPendingTransfer] =
    useState<PendingHostTransfer | null>(null);
  const organizerOptions = props.players.filter(
    (player) => player.userId != null,
  );
  const currentOrganizerEntry =
    organizerOptions.find((player) => player.isOrganizer) ?? null;
  const [organizerEntryId, setOrganizerEntryId] = useState(
    currentOrganizerEntry?.id ?? "",
  );
  const [isTransferPending, startTransferTransition] = useTransition();
  const isMutating = isPending || isTransferPending;

  async function applyMetadataUpdate(
    payload: ReturnType<typeof buildMetadataPayload>,
  ) {
    if (Object.keys(payload).length === 0) {
      return props.gameNumber;
    }

    const response = await fetch(
      `/api/games/${encodeURIComponent(String(props.gameNumber))}/metadata`,
      {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
      },
    );

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      setErrorMessage(body?.error ?? "The game metadata update failed.");
      return null;
    }

    const body = (await response.json().catch(() => null)) as {
      gameNumber?: number;
    } | null;

    return body?.gameNumber ?? props.gameNumber;
  }

  function cancelEditing() {
    setDraft(createDraft(props));
    setOrganizerEntryId(currentOrganizerEntry?.id ?? "");
    setIsEditing(false);
    setErrorMessage(null);
    setConfirmation(null);
    setPendingTransfer(null);
  }

  function saveMetadata() {
    const initialDraft = createDraft(props);
    const payload = buildMetadataPayload(draft, initialDraft);
    const selectedOrganizer = organizerOptions.find(
      (player) => player.id === organizerEntryId,
    );
    const organizerChanged =
      organizerEntryId.length > 0 &&
      organizerEntryId !== (currentOrganizerEntry?.id ?? "");

    if (Object.keys(payload).length === 0 && !organizerChanged) {
      setErrorMessage("Change at least one detail before saving.");
      return;
    }

    if (organizerChanged) {
      if (!selectedOrganizer?.userId || selectedOrganizer.isOrganizer) {
        setErrorMessage("Select an occupied non-Overlord seat.");
        return;
      }

      setErrorMessage(null);
      setConfirmation(null);
      setPendingTransfer({
        seatEntryId: selectedOrganizer.id,
        seatNumber: selectedOrganizer.turnOrder,
        displayName:
          selectedOrganizer.displayName ??
          `Seat ${selectedOrganizer.turnOrder}`,
        metadataPayload: payload,
        gameNumber: props.gameNumber,
      });
      return;
    }

    setErrorMessage(null);
    setConfirmation(null);
    setPendingTransfer(null);

    startTransition(async () => {
      const nextGameNumber = await applyMetadataUpdate(payload);

      if (nextGameNumber == null) {
        return;
      }

      setIsEditing(false);
      setOrganizerEntryId(organizerEntryId);

      if (nextGameNumber !== props.gameNumber) {
        router.push(`/games/${nextGameNumber}?metadata=success`);
        return;
      }

      setConfirmation({
        command: "game-metadata --commit",
        lines: [
          "[ok] campaign metadata written to the command archive",
          "[ok] world configuration refreshed for connected operators",
          "<CAMPAIGN DETAILS UPDATED>",
        ],
      });
      router.refresh();
    });
  }

  function confirmTransfer() {
    if (!pendingTransfer) {
      return;
    }

    startTransferTransition(async () => {
      const nextGameNumber = await applyMetadataUpdate(
        pendingTransfer.metadataPayload,
      );

      if (nextGameNumber == null) {
        return;
      }

      const response = await fetch(
        `/api/games/${encodeURIComponent(String(nextGameNumber))}/transfer-host`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            targetPlayerEntryId: pendingTransfer.seatEntryId,
          }),
        },
      );

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        setErrorMessage(body?.error ?? "The Overlord transfer failed.");
        return;
      }

      setOrganizerEntryId(pendingTransfer.seatEntryId);
      setIsEditing(false);
      setPendingTransfer(null);

      if (nextGameNumber !== props.gameNumber) {
        router.push(`/games/${nextGameNumber}`);
        return;
      }

      setConfirmation({
        command: `overlord --transfer seat-${pendingTransfer.seatNumber}`,
        lines: [
          `[ok] campaign control reassigned to ${pendingTransfer.displayName}`,
          "[ok] organizer-only controls refreshed for the active campaign view",
          "<OVERLORD TRANSFERRED>",
        ],
      });
      router.refresh();
    });
  }

  const detailTiles = [
    { label: "Campagin number", value: props.gameNumber },
    { label: "Campaign", value: props.name },
    { label: "Overlord", value: props.organizerDisplayName },
    { label: "Active lord", value: props.activePlayerDisplayName },
    { label: "Turn", value: props.roundNumber },
    { label: "Seats", value: props.playerCount ?? "Not set" },
    { label: "AI players", value: formatAiPlayers(props.hasAiPlayers) },
    {
      label: "DLC",
      value: getOptionLabel(props.dlcMode, dlcOptions),
    },
    {
      label: "Game mode",
      value: getOptionLabel(props.gameMode, gameModeOptions),
    },
    {
      label: "Tech level",
      value: props.techLevel ?? "Unknown",
    },
    {
      label: "Zone count",
      value: getOptionLabel(props.zoneCount, zoneCountOptions),
    },
    {
      label: "Army count",
      value: getOptionLabel(props.armyCount, armyCountOptions),
    },
  ];

  return (
    <Card className="overflow-hidden">
      <TerminalConfirmationModal
        confirmation={confirmation}
        onClose={() => {
          setConfirmation(null);
        }}
      />
      <HostTransferConfirmationDialog
        target={pendingTransfer}
        isPending={isTransferPending}
        onCancel={() => {
          setPendingTransfer(null);
        }}
        onConfirm={confirmTransfer}
      />
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle>Campaign details:</CardTitle>
          <CardDescription>
            View and edit details of the current campaign.
          </CardDescription>
        </div>
        {props.canEdit ? (
          isEditing ? (
            <div className="flex gap-2">
              <Button
                disabled={isMutating}
                type="button"
                variant="secondary"
                onClick={cancelEditing}
              >
                Cancel
              </Button>
              <Button
                disabled={isMutating}
                type="button"
                onClick={saveMetadata}
              >
                {isPending ? "Saving..." : "Save details"}
              </Button>
            </div>
          ) : (
            <div className="flex gap-2">
              <Button
                disabled={isMutating}
                type="button"
                variant="secondary"
                onClick={() => {
                  setDraft(createDraft(props));
                  setOrganizerEntryId(currentOrganizerEntry?.id ?? "");
                  setErrorMessage(null);
                  setConfirmation(null);
                  setPendingTransfer(null);
                  setIsEditing(true);
                }}
              >
                Edit
              </Button>
            </div>
          )
        ) : null}
      </CardHeader>
      <CardContent className="space-y-4">
        {errorMessage ? (
          <div className="rounded-lg border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm font-mono text-red-300">
            {errorMessage}
          </div>
        ) : null}

        {isEditing ? (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <EditField label="Campagin number">
              <input
                className={controlClassName}
                min={1}
                step={1}
                type="number"
                value={draft.gameNumber}
                onChange={(event) => {
                  setDraft((currentDraft) => ({
                    ...currentDraft,
                    gameNumber: event.target.value,
                  }));
                }}
              />
            </EditField>
            <EditField label="Campaign">
              <input
                className={controlClassName}
                maxLength={100}
                type="text"
                value={draft.name}
                onChange={(event) => {
                  setDraft((currentDraft) => ({
                    ...currentDraft,
                    name: event.target.value,
                  }));
                }}
              />
            </EditField>
            <EditField label="Overlord">
              <select
                className={controlClassName}
                disabled={isMutating || organizerOptions.length === 0}
                value={organizerEntryId}
                onChange={(event) => {
                  setOrganizerEntryId(event.target.value);
                  setErrorMessage(null);
                  setConfirmation(null);
                  setPendingTransfer(null);
                }}
              >
                {organizerOptions.map((player) => (
                  <option key={player.id} value={player.id}>
                    {`Seat ${player.turnOrder}: ${player.displayName ?? "Unknown player"}`}
                  </option>
                ))}
              </select>
            </EditField>
            <DetailTile
              label="Active lord"
              value={props.activePlayerDisplayName}
            />
            <EditField label="Turn">
              <input
                className={controlClassName}
                min={1}
                step={1}
                type="number"
                value={draft.roundNumber}
                onChange={(event) => {
                  setDraft((currentDraft) => ({
                    ...currentDraft,
                    roundNumber: event.target.value,
                  }));
                }}
              />
            </EditField>
            <EditField label="Seats">
              <input
                className={controlClassName}
                max={100}
                min={1}
                step={1}
                type="number"
                value={draft.playerCount}
                onChange={(event) => {
                  setDraft((currentDraft) => ({
                    ...currentDraft,
                    playerCount: event.target.value,
                  }));
                }}
              />
            </EditField>
            <EditField label="AI players">
              <select
                className={controlClassName}
                value={draft.hasAiPlayers}
                onChange={(event) => {
                  setDraft((currentDraft) => ({
                    ...currentDraft,
                    hasAiPlayers: event.target.value,
                  }));
                }}
              >
                <option value="">Select...</option>
                <option value="false">None</option>
                <option value="true">Included</option>
              </select>
            </EditField>
            <EditField label="DLC">
              <select
                className={controlClassName}
                value={draft.dlcMode}
                onChange={(event) => {
                  setDraft((currentDraft) => ({
                    ...currentDraft,
                    dlcMode: event.target.value,
                  }));
                }}
              >
                <option value="">Select...</option>
                {dlcOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </EditField>
            <EditField label="Game mode">
              <select
                className={controlClassName}
                value={draft.gameMode}
                onChange={(event) => {
                  setDraft((currentDraft) => ({
                    ...currentDraft,
                    gameMode: event.target.value,
                  }));
                }}
              >
                <option value="">Select...</option>
                {gameModeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </EditField>
            <EditField label="Tech level">
              <select
                className={controlClassName}
                value={draft.techLevel}
                onChange={(event) => {
                  setDraft((currentDraft) => ({
                    ...currentDraft,
                    techLevel: event.target.value,
                  }));
                }}
              >
                <option value="">Select...</option>
                {techLevelOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </EditField>
            <EditField label="Zone count">
              <select
                className={controlClassName}
                value={draft.zoneCount}
                onChange={(event) => {
                  setDraft((currentDraft) => ({
                    ...currentDraft,
                    zoneCount: event.target.value,
                  }));
                }}
              >
                <option value="">Select...</option>
                {zoneCountOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </EditField>
            <EditField label="Army count">
              <select
                className={controlClassName}
                value={draft.armyCount}
                onChange={(event) => {
                  setDraft((currentDraft) => ({
                    ...currentDraft,
                    armyCount: event.target.value,
                  }));
                }}
              >
                <option value="">Select...</option>
                {armyCountOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </EditField>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {detailTiles.map((tile) => (
              <DetailTile
                key={tile.label}
                label={tile.label}
                value={tile.value}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

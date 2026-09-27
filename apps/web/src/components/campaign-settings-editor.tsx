"use client";

import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  useTransition,
  type RefObject,
} from "react";
import { useRouter } from "next/navigation";
import type {
  CampaignConfigurationSection,
  CampaignEditorStateProps,
} from "@/components/campaign-configuration-shell";
import {
  TerminalConfirmationModal,
  type TerminalConfirmationSpec,
} from "@/components/terminal-confirmation-modal";
import {
  AlertDialog,
  AlertDialogBody,
  AlertDialogCancel,
  AlertDialogCloseButton,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import {
  transferOutcomeMessage,
  isKnownRejectionStatus,
  type TransferOutcome,
} from "@/lib/transfer-outcome";

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
const MAX_TURN_TIMING_HOURS = 1_000_000_000;

type CampaignSettingsSection = Extract<
  CampaignConfigurationSection,
  "identity" | "world" | "turn-protocol"
>;

type CampaignPlayer = {
  id: string;
  userId: string | null;
  displayName: string | null;
  turnOrder: number;
  isOrganizer: boolean;
};

type CampaignSettingsEditorProps = CampaignEditorStateProps & {
  campaignId: string;
  identityReadId: string;
  section: CampaignSettingsSection;
  gameNumber: number;
  name: string;
  organizerDisplayName: string;
  roundNumber: number;
  playerCount: number | null;
  hasAiPlayers: boolean | null;
  dlcMode: string | null;
  gameMode: string | null;
  techLevel: number | null;
  zoneCount: string | null;
  armyCount: string | null;
  turnTargetHours: number;
  turnReminderGraceHours: number;
  turnReminderRepeatHours: number;
  turnRemindersEnabled: boolean;
  players: CampaignPlayer[];
};

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
  turnTargetHours: string;
  turnReminderGraceHours: string;
  turnReminderRepeatHours: string;
  turnRemindersEnabled: boolean;
};

type MetadataPayload = {
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
  turnTargetHours?: number;
  turnReminderGraceHours?: number;
  turnReminderRepeatHours?: number;
  turnRemindersEnabled?: boolean;
};

type AuthoritativeSnapshot = {
  draft: MetadataDraft;
  organizerEntryId: string;
};

type PendingHostTransfer = {
  userId: string;
  metadataCommitted: boolean;
  seatEntryId: string;
  seatNumber: number;
  displayName: string;
  metadataPayload: MetadataPayload;
  gameNumber: number;
};

function createDraft(props: CampaignSettingsEditorProps): MetadataDraft {
  return {
    gameNumber: String(props.gameNumber),
    name: props.name,
    roundNumber: String(props.roundNumber),
    playerCount: props.playerCount == null ? "" : String(props.playerCount),
    hasAiPlayers:
      props.hasAiPlayers == null ? "" : props.hasAiPlayers ? "true" : "false",
    dlcMode: props.dlcMode ?? "",
    gameMode: props.gameMode ?? "",
    techLevel: props.techLevel == null ? "" : String(props.techLevel),
    zoneCount: props.zoneCount ?? "",
    armyCount: props.armyCount ?? "",
    turnTargetHours: String(props.turnTargetHours),
    turnReminderGraceHours: String(props.turnReminderGraceHours),
    turnReminderRepeatHours: String(props.turnReminderRepeatHours),
    turnRemindersEnabled: props.turnRemindersEnabled,
  };
}

function createAuthoritativeSnapshot(
  props: CampaignSettingsEditorProps,
): AuthoritativeSnapshot {
  return {
    draft: createDraft(props),
    organizerEntryId:
      props.players.find(
        (player) => player.userId != null && player.isOrganizer,
      )?.id ?? "",
  };
}

export function parsePositiveSafeWholeHours(value: string, label: string) {
  if (!/^\d+$/.test(value)) {
    return {
      ok: false as const,
      message: `${label} must be a positive whole number of hours.`,
    };
  }

  const parsed = Number(value);
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < 1 ||
    parsed > MAX_TURN_TIMING_HOURS
  ) {
    return {
      ok: false as const,
      message: `${label} must be a whole number of hours between 1 and ${MAX_TURN_TIMING_HOURS}.`,
    };
  }

  return { ok: true as const, value: parsed };
}

function normalizeNumber(value: string) {
  if (value === "" || !/^\d+$/.test(value)) {
    return value;
  }

  return String(Number(value));
}

function isSectionDirty(
  section: CampaignSettingsSection,
  draft: MetadataDraft,
  initialDraft: MetadataDraft,
  organizerEntryId: string,
  initialOrganizerEntryId: string,
) {
  if (section === "identity") {
    return (
      normalizeNumber(draft.gameNumber) !==
        normalizeNumber(initialDraft.gameNumber) ||
      draft.name.trim() !== initialDraft.name.trim() ||
      normalizeNumber(draft.roundNumber) !==
        normalizeNumber(initialDraft.roundNumber) ||
      normalizeNumber(draft.playerCount) !==
        normalizeNumber(initialDraft.playerCount) ||
      organizerEntryId !== initialOrganizerEntryId
    );
  }

  if (section === "world") {
    return (
      draft.hasAiPlayers !== initialDraft.hasAiPlayers ||
      draft.dlcMode !== initialDraft.dlcMode ||
      draft.gameMode !== initialDraft.gameMode ||
      draft.techLevel !== initialDraft.techLevel ||
      draft.zoneCount !== initialDraft.zoneCount ||
      draft.armyCount !== initialDraft.armyCount
    );
  }

  return (
    normalizeNumber(draft.turnTargetHours) !==
      normalizeNumber(initialDraft.turnTargetHours) ||
    normalizeNumber(draft.turnReminderGraceHours) !==
      normalizeNumber(initialDraft.turnReminderGraceHours) ||
    normalizeNumber(draft.turnReminderRepeatHours) !==
      normalizeNumber(initialDraft.turnReminderRepeatHours) ||
    draft.turnRemindersEnabled !== initialDraft.turnRemindersEnabled
  );
}

function buildMetadataPayload(
  section: CampaignSettingsSection,
  draft: MetadataDraft,
  initialDraft: MetadataDraft,
) {
  const payload: MetadataPayload = {};

  if (section === "identity") {
    if (
      normalizeNumber(draft.gameNumber) !==
        normalizeNumber(initialDraft.gameNumber) &&
      draft.gameNumber !== ""
    ) {
      payload.gameNumber = Number(draft.gameNumber);
    }

    const normalizedName = draft.name.trim();
    if (normalizedName !== initialDraft.name.trim()) {
      payload.name = normalizedName;
    }

    if (
      normalizeNumber(draft.roundNumber) !==
        normalizeNumber(initialDraft.roundNumber) &&
      draft.roundNumber !== ""
    ) {
      payload.roundNumber = Number(draft.roundNumber);
    }

    if (
      normalizeNumber(draft.playerCount) !==
        normalizeNumber(initialDraft.playerCount) &&
      draft.playerCount !== ""
    ) {
      payload.playerCount = Number(draft.playerCount);
    }
  }

  if (section === "world") {
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
  }

  if (section === "turn-protocol") {
    const durationFields = [
      {
        draftValue: draft.turnTargetHours,
        initialValue: initialDraft.turnTargetHours,
        label: "Target turn",
        key: "turnTargetHours" as const,
      },
      {
        draftValue: draft.turnReminderGraceHours,
        initialValue: initialDraft.turnReminderGraceHours,
        label: "Reminder grace",
        key: "turnReminderGraceHours" as const,
      },
      {
        draftValue: draft.turnReminderRepeatHours,
        initialValue: initialDraft.turnReminderRepeatHours,
        label: "Reminder repeat",
        key: "turnReminderRepeatHours" as const,
      },
    ];

    for (const field of durationFields) {
      if (
        normalizeNumber(field.draftValue) ===
        normalizeNumber(field.initialValue)
      ) {
        continue;
      }

      const result = parsePositiveSafeWholeHours(field.draftValue, field.label);
      if (!result.ok) {
        return result;
      }
      payload[field.key] = result.value;
    }

    if (draft.turnRemindersEnabled !== initialDraft.turnRemindersEnabled) {
      payload.turnRemindersEnabled = draft.turnRemindersEnabled;
    }
  }

  return { ok: true as const, payload };
}

function FieldRow({
  label,
  description,
  descriptionId,
  children,
}: {
  label: string;
  description?: string;
  descriptionId?: string;
  children: React.ReactNode;
}) {
  return (
    <Label className="grid min-w-0 gap-2 border-b border-terminal-400/20 py-3 text-sm font-mono text-terminal-200 sm:grid-cols-[minmax(10rem,0.45fr)_minmax(0,1fr)] sm:items-center">
      <span className="min-w-0">
        <span className="block text-xs uppercase tracking-[0.16em] text-terminal-300/70">
          {label}
        </span>
        {description ? (
          <span
            className="mt-1 block min-w-0 text-xs leading-relaxed text-terminal-200/70"
            id={descriptionId}
          >
            {description}
          </span>
        ) : null}
      </span>
      {children}
    </Label>
  );
}

function SelectOptions({
  options,
}: {
  options: ReadonlyArray<{ label: string; value: string }>;
}) {
  return (
    <>
      <option value="">Select...</option>
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </>
  );
}

function HostTransferConfirmationDialog({
  target,
  errorMessage,
  isPending,
  onCancel,
  onConfirm,
  returnFocusRef,
}: {
  target: PendingHostTransfer | null;
  errorMessage: string | null;
  isPending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  returnFocusRef: RefObject<HTMLElement | null>;
}) {
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Disabled buttons lose focus in real browsers while the request is pending.
    if (isPending) contentRef.current?.focus();
  }, [isPending]);

  if (!target) {
    return null;
  }

  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <AlertDialogContent
        ref={contentRef}
        onEscapeKeyDown={(event) => {
          if (isPending) event.preventDefault();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocusRef.current?.focus();
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>Confirm Overlord Transfer</AlertDialogTitle>
          <AlertDialogCloseButton
            aria-label="Close confirmation"
            disabled={isPending}
            onClick={onCancel}
          />
        </AlertDialogHeader>
        <AlertDialogBody className="text-sm">
          <AlertDialogDescription asChild>
            <div className="text-terminal-200">
              <div>&gt; overlord --transfer seat-{target.seatNumber}</div>
              <div className="mt-1 whitespace-pre-wrap break-words leading-6">
                {target.displayName} will receive campaign control and become
                the new Overlord.
              </div>
            </div>
          </AlertDialogDescription>
          {errorMessage ? (
            <div
              role="alert"
              className="border border-destructive/30 bg-destructive/10 px-3 py-2 text-destructive"
            >
              {errorMessage}
            </div>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
            <Button disabled={isPending} type="button" onClick={onConfirm}>
              {isPending ? "Transferring..." : "Confirm"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogBody>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export function CampaignSettingsEditor(props: CampaignSettingsEditorProps) {
  const router = useRouter();
  const operationGenerationRef = useRef(0);
  useLayoutEffect(() => {
    operationGenerationRef.current += 1;
    // The workspace unmounts this editor on permission loss or campaign change.
    // Invalidate synchronously at commit, before an awaited response can resume.
    return () => {
      operationGenerationRef.current += 1;
    };
  }, [props.campaignId]);

  function isCurrentOperation(generation: number) {
    return generation === operationGenerationRef.current;
  }
  const turnDescriptionIdPrefix = useId();
  const turnTargetHoursDescriptionId = `${turnDescriptionIdPrefix}-turn-target-hours-description`;
  const turnReminderGraceHoursDescriptionId = `${turnDescriptionIdPrefix}-turn-reminder-grace-hours-description`;
  const turnReminderRepeatHoursDescriptionId = `${turnDescriptionIdPrefix}-turn-reminder-repeat-hours-description`;
  const turnRemindersEnabledDescriptionId = `${turnDescriptionIdPrefix}-turn-reminders-enabled-description`;
  const transferDescriptionId = `${turnDescriptionIdPrefix}-overlord-transfer-description`;
  const identityMetadataHeadingId = `${turnDescriptionIdPrefix}-identity-metadata-heading`;
  const transferHeadingId = `${turnDescriptionIdPrefix}-overlord-transfer-heading`;
  const { onDirtyChange } = props;
  const [draft, setDraft] = useState(() => createDraft(props));
  const [initialDraft, setInitialDraft] = useState(() => createDraft(props));
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [transferErrorMessage, setTransferErrorMessage] = useState<
    string | null
  >(null);
  const [confirmation, setConfirmation] =
    useState<TerminalConfirmationSpec | null>(null);
  const [pendingTransfer, setPendingTransfer] =
    useState<PendingHostTransfer | null>(null);
  const [recovery, setRecovery] = useState<{
    readId: string;
    campaignId: string;
    gameNumber: number;
    outcome: TransferOutcome;
  } | null>(null);
  const [metadataUnconfirmed, setMetadataUnconfirmed] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [isTransferPending, startTransferTransition] = useTransition();
  const organizerOptions = props.players.filter(
    (player) => player.userId != null,
  );
  const currentOrganizerEntry =
    organizerOptions.find((player) => player.isOrganizer) ?? null;
  const currentOrganizerEntryId = currentOrganizerEntry?.id ?? "";
  const [organizerEntryId, setOrganizerEntryId] = useState(
    currentOrganizerEntryId,
  );
  const [initialOrganizerEntryId, setInitialOrganizerEntryId] = useState(
    currentOrganizerEntryId,
  );
  const organizerSelectRef = useRef<HTMLSelectElement>(null);
  const recoveryMessageRef = useRef<HTMLParagraphElement>(null);
  const recoveredFocusRef = useRef(false);
  const latestAuthoritativeDraftRef = useRef(initialDraft);
  const latestAuthoritativeOrganizerRef = useRef(initialOrganizerEntryId);
  const authoritativeSnapshotJson = JSON.stringify(
    createAuthoritativeSnapshot(props),
  );
  const lastAuthoritativeSnapshotJsonRef = useRef(authoritativeSnapshotJson);
  const needsAuthoritativeSyncRef = useRef(false);

  function acceptSnapshot(snapshot: AuthoritativeSnapshot) {
    latestAuthoritativeDraftRef.current = snapshot.draft;
    latestAuthoritativeOrganizerRef.current = snapshot.organizerEntryId;
    needsAuthoritativeSyncRef.current = false;
    setInitialDraft(snapshot.draft);
    setDraft(snapshot.draft);
    setInitialOrganizerEntryId(snapshot.organizerEntryId);
    setOrganizerEntryId(snapshot.organizerEntryId);
  }
  const isDirty = isSectionDirty(
    props.section,
    draft,
    initialDraft,
    organizerEntryId,
    initialOrganizerEntryId,
  );
  const isMutating = isPending || isTransferPending;
  const isEditorDisabled =
    isMutating ||
    pendingTransfer != null ||
    recovery != null ||
    metadataUnconfirmed;

  useEffect(() => {
    onDirtyChange(isDirty || recovery != null || metadataUnconfirmed);
  }, [isDirty, recovery, metadataUnconfirmed, onDirtyChange]);

  useEffect(() => {
    if (recovery || metadataUnconfirmed) recoveryMessageRef.current?.focus();
    else if (recoveredFocusRef.current && !isMutating) {
      recoveredFocusRef.current = false;
      organizerSelectRef.current?.focus();
    }
  }, [recovery, metadataUnconfirmed, isMutating]);

  useEffect(() => {
    // Only the read requested for this recovery can unlock the editor. An
    // unrelated or older in-flight read may contain pre-transfer ownership.
    if (
      recovery &&
      props.identityReadId === recovery.readId &&
      props.campaignId === recovery.campaignId &&
      props.gameNumber === recovery.gameNumber
    ) {
      const snapshot = JSON.parse(
        authoritativeSnapshotJson,
      ) as AuthoritativeSnapshot;
      lastAuthoritativeSnapshotJsonRef.current = authoritativeSnapshotJson;
      recoveredFocusRef.current = true;
      // Accept the completed server read before unlocking the existing editor.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      acceptSnapshot(snapshot);
      setRecovery(null);
      return;
    }
    if (
      authoritativeSnapshotJson !== lastAuthoritativeSnapshotJsonRef.current
    ) {
      const snapshot = JSON.parse(
        authoritativeSnapshotJson,
      ) as AuthoritativeSnapshot;
      lastAuthoritativeSnapshotJsonRef.current = authoritativeSnapshotJson;
      latestAuthoritativeDraftRef.current = snapshot.draft;
      latestAuthoritativeOrganizerRef.current = snapshot.organizerEntryId;
      needsAuthoritativeSyncRef.current = true;
    }

    if (
      !needsAuthoritativeSyncRef.current ||
      recovery ||
      metadataUnconfirmed ||
      isDirty ||
      pendingTransfer ||
      isMutating
    ) {
      return;
    }

    acceptSnapshot({
      draft: latestAuthoritativeDraftRef.current,
      organizerEntryId: latestAuthoritativeOrganizerRef.current,
    });
    setErrorMessage(null);
  }, [
    authoritativeSnapshotJson,
    isDirty,
    isMutating,
    pendingTransfer,
    recovery,
    metadataUnconfirmed,
    props.identityReadId,
    props.campaignId,
    props.gameNumber,
  ]);

  function updateDraft<Key extends keyof MetadataDraft>(
    key: Key,
    value: MetadataDraft[Key],
  ) {
    setDraft((currentDraft) => ({ ...currentDraft, [key]: value }));
  }

  async function applyMetadataUpdate(
    payload: MetadataPayload,
    generation: number,
    gameNumber = props.gameNumber,
    onError: (message: string) => void = setErrorMessage,
  ) {
    if (!isCurrentOperation(generation)) return null;
    if (Object.keys(payload).length === 0) {
      return gameNumber;
    }

    const response = await fetch(
      `/api/games/${encodeURIComponent(String(gameNumber))}/metadata`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      },
    ).catch(() => null);
    if (!isCurrentOperation(generation)) return null;
    const body = await response?.json().catch(() => null);
    if (!isCurrentOperation(generation)) return null;
    if (
      response &&
      isKnownRejectionStatus(response.status) &&
      typeof body?.error === "string"
    ) {
      onError(body.error);
      return null;
    }
    if (
      response?.ok &&
      typeof body?.gameNumber === "number" &&
      Number.isSafeInteger(body?.gameNumber) &&
      body.gameNumber > 0
    )
      return body.gameNumber;
    // Without a valid committed number, neither transfer nor metadata replay
    // is safe. A deliberate document reload is required (the old URL may 404).
    setMetadataUnconfirmed(true);
    setPendingTransfer(null);
    setOrganizerEntryId(initialOrganizerEntryId);
    return null;
  }

  function cancelEditing() {
    acceptSnapshot({
      draft: latestAuthoritativeDraftRef.current,
      organizerEntryId: latestAuthoritativeOrganizerRef.current,
    });
    setErrorMessage(null);
    setTransferErrorMessage(null);
    setConfirmation(null);
    setPendingTransfer(null);
  }

  function saveMetadata() {
    if (recovery || metadataUnconfirmed) return;
    const result = buildMetadataPayload(props.section, draft, initialDraft);
    if (!result.ok) {
      setErrorMessage(result.message);
      return;
    }

    const payload = result.payload;
    const organizerChanged =
      props.section === "identity" &&
      organizerEntryId !== initialOrganizerEntryId;
    const selectedOrganizer = organizerOptions.find(
      (player) => player.id === organizerEntryId,
    );

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
      setTransferErrorMessage(null);
      setConfirmation(null);
      setPendingTransfer({
        userId: selectedOrganizer.userId,
        metadataCommitted: false,
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
    const generation = operationGenerationRef.current;
    startTransition(async () => {
      const nextGameNumber = await applyMetadataUpdate(payload, generation);
      if (!isCurrentOperation(generation)) return;
      if (nextGameNumber == null) {
        return;
      }

      onDirtyChange(false);
      const savedDraft = createDraft({
        ...props,
        ...payload,
        gameNumber: nextGameNumber,
      });
      latestAuthoritativeDraftRef.current = savedDraft;
      setInitialDraft(savedDraft);
      setDraft(savedDraft);

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
    if (!pendingTransfer || recovery || metadataUnconfirmed) {
      return;
    }

    const transfer = pendingTransfer;
    const generation = operationGenerationRef.current;
    setTransferErrorMessage(null);
    startTransferTransition(async () => {
      const nextGameNumber = await applyMetadataUpdate(
        transfer.metadataPayload,
        generation,
        transfer.gameNumber,
        setTransferErrorMessage,
      );
      if (!isCurrentOperation(generation)) return;
      if (nextGameNumber == null) {
        return;
      }

      if (Object.keys(transfer.metadataPayload).length > 0) {
        const savedDraft = createDraft({
          ...props,
          ...transfer.metadataPayload,
          gameNumber: nextGameNumber,
        });
        latestAuthoritativeDraftRef.current = savedDraft;
        needsAuthoritativeSyncRef.current = false;
        setInitialDraft(savedDraft);
        setDraft(savedDraft);
        setPendingTransfer((currentTransfer) =>
          currentTransfer
            ? {
                ...currentTransfer,
                metadataCommitted: true,
                metadataPayload: {},
                gameNumber: nextGameNumber,
              }
            : null,
        );
      }

      const response = await fetch(
        `/api/games/${encodeURIComponent(String(nextGameNumber))}/transfer-host`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            targetPlayerEntryId: transfer.seatEntryId,
          }),
        },
      ).catch(() => null);
      if (!isCurrentOperation(generation)) return;

      const body = await response?.json().catch(() => null);
      if (!isCurrentOperation(generation)) return;
      const metadataCommitted =
        transfer.metadataCommitted ||
        Object.keys(transfer.metadataPayload).length > 0;
      const rejected =
        response &&
        isKnownRejectionStatus(response.status) &&
        body?.outcome === "rejected" &&
        typeof body.error === "string";
      if (rejected && nextGameNumber === props.gameNumber) {
        setTransferErrorMessage(
          `${metadataCommitted ? "Campaign details saved; Overlord transfer failed. " : ""}${body.error}`,
        );
        // Publish committed metadata to future section mounts, without retrying
        // it or destroying the active dialog's transfer-only retry.
        router.refresh();
        return;
      }
      const succeeded =
        response?.ok &&
        body?.gameNumber === nextGameNumber &&
        body.gameId === props.campaignId &&
        body.organizerId === transfer.userId;
      if (!succeeded) {
        const outcome: TransferOutcome = rejected
          ? "metadata-saved-transfer-failed"
          : metadataCommitted
            ? "metadata-saved-transfer-unconfirmed"
            : "transfer-unconfirmed";
        setPendingTransfer(null);
        setOrganizerEntryId(initialOrganizerEntryId);
        setTransferErrorMessage(null);
        reconcileTransfer({ gameNumber: nextGameNumber, outcome });
        return;
      }

      onDirtyChange(false);
      setPendingTransfer(null);
      setTransferErrorMessage(null);
      latestAuthoritativeOrganizerRef.current = transfer.seatEntryId;
      setInitialOrganizerEntryId(transfer.seatEntryId);
      setOrganizerEntryId(transfer.seatEntryId);

      if (nextGameNumber !== props.gameNumber) {
        router.push(`/games/${nextGameNumber}`);
        return;
      }

      setConfirmation({
        command: `overlord --transfer seat-${transfer.seatNumber}`,
        lines: [
          `[ok] campaign control reassigned to ${transfer.displayName}`,
          "[ok] organizer-only controls refreshed for the active campaign view",
          "<OVERLORD TRANSFERRED>",
        ],
      });
      router.refresh();
    });
  }

  function reconcileTransfer(
    input: Pick<NonNullable<typeof recovery>, "gameNumber" | "outcome">,
  ) {
    const nextRecovery = {
      ...input,
      campaignId: props.campaignId,
      readId: crypto.randomUUID(),
    };
    setRecovery(nextRecovery);
    router.replace(
      `/games/${nextRecovery.gameNumber}?transferOutcome=${nextRecovery.outcome}&transferRecovery=${nextRecovery.readId}`,
    );
  }

  return (
    <div data-testid="campaign-settings-editor">
      {metadataUnconfirmed ? (
        <div className="mb-4 border border-orange-400/30 px-4 py-3 text-sm font-mono text-orange-200">
          <p ref={recoveryMessageRef} role="alert" tabIndex={-1}>
            Campaign details could not be confirmed. Transfer was not attempted.
            Reload the campaign before editing again; its number may have
            changed.
          </p>
          <a href={`/games/${props.gameNumber}`} className="underline">
            Reload campaign
          </a>
        </div>
      ) : null}
      {recovery ? (
        <div className="mb-4 border border-orange-400/30 px-4 py-3 text-sm font-mono text-orange-200">
          <p ref={recoveryMessageRef} role="alert" tabIndex={-1}>
            {transferOutcomeMessage(recovery.outcome, "unavailable")} Reload
            current ownership before another attempt. Editing remains
            unavailable until the campaign is reloaded.
          </p>
          <Button
            disabled={isMutating}
            onClick={() =>
              startTransferTransition(() => reconcileTransfer(recovery))
            }
          >
            Reload campaign
          </Button>
        </div>
      ) : null}
      <TerminalConfirmationModal
        confirmation={confirmation}
        onClose={() => setConfirmation(null)}
      />
      <HostTransferConfirmationDialog
        target={pendingTransfer}
        errorMessage={transferErrorMessage}
        isPending={isTransferPending}
        returnFocusRef={organizerSelectRef}
        onCancel={() => {
          setTransferErrorMessage(null);
          setPendingTransfer(null);
        }}
        onConfirm={confirmTransfer}
      />

      <fieldset className="min-w-0 border-0 p-0" disabled={isEditorDisabled}>
        {errorMessage ? (
          <div
            role="alert"
            className="mb-4 border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm font-mono text-red-300"
          >
            {errorMessage}
          </div>
        ) : null}

        {props.section === "identity" ? (
          <div>
            <section
              aria-labelledby={identityMetadataHeadingId}
              className="border-t border-orange-400/15"
            >
              <h4
                id={identityMetadataHeadingId}
                className="pt-3 text-xs font-semibold uppercase tracking-[0.16em] text-orange-300"
              >
                Campaign metadata
              </h4>
              <p className="mt-1 text-sm leading-relaxed text-orange-200/60">
                Routine details that identify the campaign and its current
                progress.
              </p>
              <FieldRow label="Campaign number">
                <Input
                  disabled={isEditorDisabled}
                  min={1}
                  step={1}
                  type="number"
                  value={draft.gameNumber}
                  onChange={(event) =>
                    updateDraft("gameNumber", event.target.value)
                  }
                />
              </FieldRow>
              <FieldRow label="Campaign name">
                <Input
                  disabled={isEditorDisabled}
                  maxLength={100}
                  type="text"
                  value={draft.name}
                  onChange={(event) => updateDraft("name", event.target.value)}
                />
              </FieldRow>
              <FieldRow label="Round">
                <Input
                  disabled={isEditorDisabled}
                  min={1}
                  step={1}
                  type="number"
                  value={draft.roundNumber}
                  onChange={(event) =>
                    updateDraft("roundNumber", event.target.value)
                  }
                />
              </FieldRow>
              <FieldRow label="Player count">
                <Input
                  disabled={isEditorDisabled}
                  max={100}
                  min={1}
                  step={1}
                  type="number"
                  value={draft.playerCount}
                  onChange={(event) =>
                    updateDraft("playerCount", event.target.value)
                  }
                />
              </FieldRow>
            </section>

            <section
              aria-labelledby={transferHeadingId}
              className="mt-6 border border-orange-300/50 bg-orange-400/5 px-4 py-3"
            >
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-orange-300">
                Consequential action
              </p>
              <h4
                id={transferHeadingId}
                className="mt-1 text-sm font-semibold uppercase tracking-[0.16em] text-orange-100"
              >
                Overlord transfer
              </h4>
              <p
                id={transferDescriptionId}
                className="mt-2 text-sm leading-relaxed text-orange-200/75"
              >
                This changes campaign control, not just campaign metadata. The
                selected occupied seat becomes the new Overlord and receives
                organizer-only controls. A confirmation is required before the
                transfer is sent.
              </p>
              <div className="mt-2">
                <p className="text-xs uppercase tracking-[0.14em] text-orange-300/60">
                  Current Overlord: {props.organizerDisplayName}
                </p>
                <FieldRow label="Overlord">
                  <NativeSelect
                    ref={organizerSelectRef}
                    aria-describedby={transferDescriptionId}
                    disabled={isEditorDisabled || organizerOptions.length === 0}
                    value={organizerEntryId}
                    onChange={(event) => {
                      setOrganizerEntryId(event.target.value);
                      setErrorMessage(null);
                      setTransferErrorMessage(null);
                      setConfirmation(null);
                      setPendingTransfer(null);
                    }}
                  >
                    {organizerOptions.map((player) => (
                      <option key={player.id} value={player.id}>
                        {`Seat ${player.turnOrder}: ${player.displayName ?? "Unknown player"}`}
                      </option>
                    ))}
                  </NativeSelect>
                </FieldRow>
              </div>
            </section>
          </div>
        ) : null}

        {props.section === "world" ? (
          <div className="border-t border-orange-400/15">
            <FieldRow label="AI players">
              <NativeSelect
                disabled={isEditorDisabled}
                value={draft.hasAiPlayers}
                onChange={(event) =>
                  updateDraft("hasAiPlayers", event.target.value)
                }
              >
                <option value="">Select...</option>
                <option value="false">None</option>
                <option value="true">Included</option>
              </NativeSelect>
            </FieldRow>
            <FieldRow label="DLC">
              <NativeSelect
                disabled={isEditorDisabled}
                value={draft.dlcMode}
                onChange={(event) => updateDraft("dlcMode", event.target.value)}
              >
                <SelectOptions options={dlcOptions} />
              </NativeSelect>
            </FieldRow>
            <FieldRow label="Game mode">
              <NativeSelect
                disabled={isEditorDisabled}
                value={draft.gameMode}
                onChange={(event) =>
                  updateDraft("gameMode", event.target.value)
                }
              >
                <SelectOptions options={gameModeOptions} />
              </NativeSelect>
            </FieldRow>
            <FieldRow label="Tech level">
              <NativeSelect
                disabled={isEditorDisabled}
                value={draft.techLevel}
                onChange={(event) =>
                  updateDraft("techLevel", event.target.value)
                }
              >
                <option value="">Select...</option>
                {techLevelOptions.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </NativeSelect>
            </FieldRow>
            <FieldRow label="Zone count">
              <NativeSelect
                disabled={isEditorDisabled}
                value={draft.zoneCount}
                onChange={(event) =>
                  updateDraft("zoneCount", event.target.value)
                }
              >
                <SelectOptions options={zoneCountOptions} />
              </NativeSelect>
            </FieldRow>
            <FieldRow label="Army count">
              <NativeSelect
                disabled={isEditorDisabled}
                value={draft.armyCount}
                onChange={(event) =>
                  updateDraft("armyCount", event.target.value)
                }
              >
                <SelectOptions options={armyCountOptions} />
              </NativeSelect>
            </FieldRow>
          </div>
        ) : null}

        {props.section === "turn-protocol" ? (
          <div className="min-w-0 border-t border-orange-400/15">
            <div className="min-w-0 py-3 font-mono text-orange-200">
              <p className="text-xs uppercase tracking-[0.16em] text-orange-300/75">
                REMINDER SCHEDULE
              </p>
              <p className="mt-1 text-sm leading-relaxed text-orange-200/70">
                Sets the expected turn pace and controls when automated reminder
                messages are sent.
              </p>
            </div>
            <FieldRow
              description="The expected time allowed for each player's turn."
              descriptionId={turnTargetHoursDescriptionId}
              label="Target turn hours"
            >
              <Input
                aria-describedby={turnTargetHoursDescriptionId}
                aria-label="Target turn hours"
                disabled={isEditorDisabled}
                max={MAX_TURN_TIMING_HOURS}
                min={1}
                step={1}
                type="number"
                value={draft.turnTargetHours}
                onChange={(event) =>
                  updateDraft("turnTargetHours", event.target.value)
                }
              />
            </FieldRow>
            <FieldRow
              description="Extra time after the target before the first reminder."
              descriptionId={turnReminderGraceHoursDescriptionId}
              label="Reminder grace hours"
            >
              <Input
                aria-describedby={turnReminderGraceHoursDescriptionId}
                aria-label="Reminder grace hours"
                disabled={isEditorDisabled}
                max={MAX_TURN_TIMING_HOURS}
                min={1}
                step={1}
                type="number"
                value={draft.turnReminderGraceHours}
                onChange={(event) =>
                  updateDraft("turnReminderGraceHours", event.target.value)
                }
              />
            </FieldRow>
            <FieldRow
              description="Time between later reminders while the turn remains open."
              descriptionId={turnReminderRepeatHoursDescriptionId}
              label="Reminder repeat hours"
            >
              <Input
                aria-describedby={turnReminderRepeatHoursDescriptionId}
                aria-label="Reminder repeat hours"
                disabled={isEditorDisabled}
                max={MAX_TURN_TIMING_HOURS}
                min={1}
                step={1}
                type="number"
                value={draft.turnReminderRepeatHours}
                onChange={(event) =>
                  updateDraft("turnReminderRepeatHours", event.target.value)
                }
              />
            </FieldRow>
            <FieldRow
              description="Send automated reminder messages using this schedule."
              descriptionId={turnRemindersEnabledDescriptionId}
              label="Turn reminders enabled"
            >
              <Checkbox
                aria-describedby={turnRemindersEnabledDescriptionId}
                aria-label="Turn reminders enabled"
                checked={draft.turnRemindersEnabled}
                disabled={isEditorDisabled}
                onCheckedChange={(checked) =>
                  updateDraft("turnRemindersEnabled", checked === true)
                }
              />
            </FieldRow>
          </div>
        ) : null}

        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <Button
            disabled={isEditorDisabled}
            type="button"
            variant="secondary"
            onClick={cancelEditing}
          >
            Cancel
          </Button>
          <Button
            disabled={isEditorDisabled}
            type="button"
            onClick={saveMetadata}
          >
            {isPending ? "Saving..." : "Save"}
          </Button>
        </div>
      </fieldset>
    </div>
  );
}

"use client";

import {
  useEffect,
  useId,
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
import { Button } from "@/components/ui/button";

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

const controlClassName =
  "h-10 w-full rounded-md border border-orange-400/30 bg-black px-3 text-sm font-mono text-orange-200 outline-none transition focus:border-orange-300 disabled:cursor-not-allowed disabled:opacity-50";

function FieldRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label className="grid gap-2 border-b border-orange-400/15 py-3 text-sm font-mono text-orange-200 sm:grid-cols-[minmax(10rem,0.45fr)_minmax(0,1fr)] sm:items-center">
      <span className="text-xs uppercase tracking-[0.16em] text-orange-300/75">
        {label}
      </span>
      {children}
    </label>
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
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!target) {
      return;
    }

    function containFocus(event: FocusEvent) {
      if (
        event.target instanceof Node &&
        !dialogRef.current?.contains(event.target)
      ) {
        cancelButtonRef.current?.focus();
      }
    }

    const returnFocusElement = returnFocusRef.current;
    cancelButtonRef.current?.focus();
    document.addEventListener("focusin", containFocus);
    return () => {
      document.removeEventListener("focusin", containFocus);
      returnFocusElement?.focus();
    };
  }, [returnFocusRef, target]);

  if (!target) {
    return null;
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape" && !isPending) {
      event.preventDefault();
      onCancel();
      return;
    }

    if (event.key !== "Tab") {
      return;
    }

    const focusableElements = Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    );
    if (focusableElements.length === 0) {
      event.preventDefault();
      return;
    }

    const first = focusableElements[0];
    const last = focusableElements.at(-1);
    if (
      (event.shiftKey && document.activeElement === first) ||
      (!event.shiftKey && document.activeElement === last) ||
      !dialogRef.current?.contains(document.activeElement)
    ) {
      event.preventDefault();
      (event.shiftKey ? last : first)?.focus();
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-6">
      <div
        ref={dialogRef}
        role="dialog"
        aria-labelledby={titleId}
        aria-modal="true"
        className="relative w-full max-w-md overflow-hidden rounded-2xl border border-orange-400/30 bg-[#0a0711] shadow-2xl shadow-orange-950/40"
        onKeyDown={handleKeyDown}
      >
        <div className="flex items-center justify-between border-b border-orange-400/20 bg-orange-400/10 px-4 py-3 font-mono text-[11px] uppercase tracking-[0.28em] text-orange-200">
          <span id={titleId}>Confirm Overlord Transfer</span>
          <button
            aria-label="Close confirmation"
            className="text-orange-300/70 transition-colors hover:text-orange-200"
            disabled={isPending}
            type="button"
            onClick={onCancel}
          >
            X
          </button>
        </div>
        <div className="bg-black/70 px-4 py-4 font-mono text-sm text-orange-300">
          <div className="text-orange-200/85">
            <div>&gt; overlord --transfer seat-{target.seatNumber}</div>
            <div className="mt-1 whitespace-pre-wrap break-words leading-6">
              {target.displayName} will receive campaign control and become the
              new Overlord.
            </div>
          </div>
          {errorMessage ? (
            <div
              role="alert"
              className="mt-4 border border-red-400/30 bg-red-400/10 px-3 py-2 text-red-300"
            >
              {errorMessage}
            </div>
          ) : null}
          <div className="mt-6 flex justify-end gap-2">
            <Button
              ref={cancelButtonRef}
              disabled={isPending}
              type="button"
              variant="secondary"
              onClick={onCancel}
            >
              Cancel
            </Button>
            <Button disabled={isPending} type="button" onClick={onConfirm}>
              {isPending ? "Transferring..." : "Confirm"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function CampaignSettingsEditor(props: CampaignSettingsEditorProps) {
  const router = useRouter();
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
  const latestAuthoritativeDraftRef = useRef(initialDraft);
  const latestAuthoritativeOrganizerRef = useRef(initialOrganizerEntryId);
  const authoritativeSnapshotJson = JSON.stringify(
    createAuthoritativeSnapshot(props),
  );
  const lastAuthoritativeSnapshotJsonRef = useRef(authoritativeSnapshotJson);
  const needsAuthoritativeSyncRef = useRef(false);
  const isDirty = isSectionDirty(
    props.section,
    draft,
    initialDraft,
    organizerEntryId,
    initialOrganizerEntryId,
  );
  const isMutating = isPending || isTransferPending;
  const isEditorDisabled = isMutating || pendingTransfer != null;

  useEffect(() => {
    onDirtyChange(isDirty);
  }, [isDirty, onDirtyChange]);

  useEffect(() => {
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
      isDirty ||
      pendingTransfer ||
      isMutating
    ) {
      return;
    }

    needsAuthoritativeSyncRef.current = false;
    const nextDraft = latestAuthoritativeDraftRef.current;
    const nextOrganizerEntryId = latestAuthoritativeOrganizerRef.current;
    setInitialDraft(nextDraft);
    setDraft(nextDraft);
    setInitialOrganizerEntryId(nextOrganizerEntryId);
    setOrganizerEntryId(nextOrganizerEntryId);
    setErrorMessage(null);
  }, [authoritativeSnapshotJson, isDirty, isMutating, pendingTransfer]);

  function updateDraft<Key extends keyof MetadataDraft>(
    key: Key,
    value: MetadataDraft[Key],
  ) {
    setDraft((currentDraft) => ({ ...currentDraft, [key]: value }));
  }

  async function applyMetadataUpdate(
    payload: MetadataPayload,
    gameNumber = props.gameNumber,
    onError: (message: string) => void = setErrorMessage,
  ) {
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
    );

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;
      onError(body?.error ?? "The game metadata update failed.");
      return null;
    }

    const body = (await response.json().catch(() => null)) as {
      gameNumber?: number;
    } | null;
    return body?.gameNumber ?? gameNumber;
  }

  function cancelEditing() {
    const nextInitialDraft = latestAuthoritativeDraftRef.current;
    const nextOrganizerEntryId = latestAuthoritativeOrganizerRef.current;
    needsAuthoritativeSyncRef.current = false;
    setInitialDraft(nextInitialDraft);
    setDraft(nextInitialDraft);
    setInitialOrganizerEntryId(nextOrganizerEntryId);
    setOrganizerEntryId(nextOrganizerEntryId);
    setErrorMessage(null);
    setTransferErrorMessage(null);
    setConfirmation(null);
    setPendingTransfer(null);
  }

  function saveMetadata() {
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
    if (!pendingTransfer) {
      return;
    }

    const transfer = pendingTransfer;
    setTransferErrorMessage(null);
    startTransferTransition(async () => {
      const nextGameNumber = await applyMetadataUpdate(
        transfer.metadataPayload,
        transfer.gameNumber,
        setTransferErrorMessage,
      );
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
      );

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        setTransferErrorMessage(body?.error ?? "The Overlord transfer failed.");
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

  return (
    <div data-testid="campaign-settings-editor">
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
          <div className="border-t border-orange-400/15">
            <FieldRow label="Campaign number">
              <input
                className={controlClassName}
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
              <input
                className={controlClassName}
                disabled={isEditorDisabled}
                maxLength={100}
                type="text"
                value={draft.name}
                onChange={(event) => updateDraft("name", event.target.value)}
              />
            </FieldRow>
            <FieldRow label="Overlord">
              <select
                ref={organizerSelectRef}
                className={controlClassName}
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
              </select>
            </FieldRow>
            <FieldRow label="Round">
              <input
                className={controlClassName}
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
              <input
                className={controlClassName}
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
          </div>
        ) : null}

        {props.section === "world" ? (
          <div className="border-t border-orange-400/15">
            <FieldRow label="AI players">
              <select
                className={controlClassName}
                disabled={isEditorDisabled}
                value={draft.hasAiPlayers}
                onChange={(event) =>
                  updateDraft("hasAiPlayers", event.target.value)
                }
              >
                <option value="">Select...</option>
                <option value="false">None</option>
                <option value="true">Included</option>
              </select>
            </FieldRow>
            <FieldRow label="DLC">
              <select
                className={controlClassName}
                disabled={isEditorDisabled}
                value={draft.dlcMode}
                onChange={(event) => updateDraft("dlcMode", event.target.value)}
              >
                <SelectOptions options={dlcOptions} />
              </select>
            </FieldRow>
            <FieldRow label="Game mode">
              <select
                className={controlClassName}
                disabled={isEditorDisabled}
                value={draft.gameMode}
                onChange={(event) =>
                  updateDraft("gameMode", event.target.value)
                }
              >
                <SelectOptions options={gameModeOptions} />
              </select>
            </FieldRow>
            <FieldRow label="Tech level">
              <select
                className={controlClassName}
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
              </select>
            </FieldRow>
            <FieldRow label="Zone count">
              <select
                className={controlClassName}
                disabled={isEditorDisabled}
                value={draft.zoneCount}
                onChange={(event) =>
                  updateDraft("zoneCount", event.target.value)
                }
              >
                <SelectOptions options={zoneCountOptions} />
              </select>
            </FieldRow>
            <FieldRow label="Army count">
              <select
                className={controlClassName}
                disabled={isEditorDisabled}
                value={draft.armyCount}
                onChange={(event) =>
                  updateDraft("armyCount", event.target.value)
                }
              >
                <SelectOptions options={armyCountOptions} />
              </select>
            </FieldRow>
          </div>
        ) : null}

        {props.section === "turn-protocol" ? (
          <div className="border-t border-orange-400/15">
            <FieldRow label="Target turn hours">
              <input
                className={controlClassName}
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
            <FieldRow label="Reminder grace hours">
              <input
                className={controlClassName}
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
            <FieldRow label="Reminder repeat hours">
              <input
                className={controlClassName}
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
            <FieldRow label="Turn reminders enabled">
              <input
                checked={draft.turnRemindersEnabled}
                className="size-4 accent-orange-400 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={isEditorDisabled}
                type="checkbox"
                onChange={(event) =>
                  updateDraft("turnRemindersEnabled", event.target.checked)
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

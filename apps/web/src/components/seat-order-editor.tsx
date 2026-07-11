"use client";

import { useEffect, useState, useTransition } from "react";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  TerminalConfirmationModal,
  type TerminalConfirmationSpec,
} from "@/components/terminal-confirmation-modal";
import {
  TerminalActionConfirmationDialog,
  type TerminalActionConfirmationSpec,
} from "@/components/terminal-action-confirmation-dialog";
import { cn } from "@/lib/utils";

type SeatOrderPlayer = {
  id: string;
  userId: string | null;
  displayName: string | null;
  turnOrder: number;
  isOrganizer: boolean;
};

type SeatOrderEditorProps = {
  gameNumber: number;
  players: SeatOrderPlayer[];
  activePlayerEntryId: string | null;
  canEdit: boolean;
  presentation?: "card" | "configuration";
  onDirtyChange?: (isDirty: boolean) => void;
};

type PendingSeatAction = {
  type: "clear" | "remove";
  seatEntryId: string;
  seatNumber: number;
  displayName: string;
};

function isNoDragTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    target.closest('[data-no-drag="true"]') !== null
  );
}

class NoDragPointerSensor extends PointerSensor {
  static activators = [
    {
      eventName: "onPointerDown" as const,
      handler: ({ nativeEvent }: React.PointerEvent) => {
        if (isNoDragTarget(nativeEvent.target)) {
          return false;
        }

        return nativeEvent.isPrimary && nativeEvent.button === 0;
      },
    },
  ];
}

class NoDragTouchSensor extends TouchSensor {
  static activators = [
    {
      eventName: "onTouchStart" as const,
      handler: ({ nativeEvent }: React.TouchEvent) =>
        !isNoDragTarget(nativeEvent.target),
    },
  ];
}

function normalizeSeatOrder(players: SeatOrderPlayer[]) {
  return players.map((player, index) => ({
    ...player,
    turnOrder: index + 1,
  }));
}

function movePlayerToSeat(
  players: SeatOrderPlayer[],
  fromIndex: number,
  toIndex: number,
) {
  return normalizeSeatOrder(arrayMove(players, fromIndex, toIndex));
}

function seatDraftsMatch(
  draftPlayers: SeatOrderPlayer[],
  draftActivePlayerEntryId: string | null,
  players: SeatOrderPlayer[],
  activePlayerEntryId: string | null,
) {
  return (
    draftActivePlayerEntryId === activePlayerEntryId &&
    draftPlayers.length === players.length &&
    draftPlayers.every(
      (draftPlayer, index) =>
        draftPlayer.id === players[index]?.id &&
        draftPlayer.userId === players[index]?.userId,
    )
  );
}

function getNextOccupiedSeatEntryId(
  players: SeatOrderPlayer[],
  activePlayerEntryId: string | null,
  removedSeatEntryId: string,
) {
  const remainingOccupiedPlayers = players.filter(
    (player) => player.userId != null && player.id !== removedSeatEntryId,
  );

  if (remainingOccupiedPlayers.length === 0) {
    return null;
  }

  if (
    activePlayerEntryId != null &&
    activePlayerEntryId !== removedSeatEntryId
  ) {
    return activePlayerEntryId;
  }

  const removedSeatIndex = players.findIndex(
    (player) => player.id === removedSeatEntryId,
  );

  if (removedSeatIndex === -1) {
    return remainingOccupiedPlayers[0]?.id ?? null;
  }

  return (
    remainingOccupiedPlayers[removedSeatIndex % remainingOccupiedPlayers.length]
      ?.id ??
    remainingOccupiedPlayers[0]?.id ??
    null
  );
}

type SortableSeatRowProps = {
  player: SeatOrderPlayer;
  index: number;
  canClearPlayer: boolean;
  canRemoveSeat: boolean;
  activePlayerEntryId: string | null;
  isEditing: boolean;
  isPending: boolean;
  isSelectedForManagement: boolean;
  presentation: "card" | "configuration";
  onSelectForManagement: (seatEntryId: string) => void;
  onMakeActive: (index: number) => void;
  onClearPlayer: (index: number) => void;
  onRemoveSeat: (index: number) => void;
};

function SortableSeatRow({
  player,
  index,
  canClearPlayer,
  canRemoveSeat,
  activePlayerEntryId,
  isEditing,
  isPending,
  isSelectedForManagement,
  presentation,
  onSelectForManagement,
  onMakeActive,
  onClearPlayer,
  onRemoveSeat,
}: SortableSeatRowProps) {
  const isActive = player.id === activePlayerEntryId;
  const isEmptySeat = player.userId == null;
  const playerLabel = isEmptySeat
    ? player.displayName != null
      ? `${player.displayName} (Resigned)`
      : "[Open]"
    : player.displayName;
  const showActiveRowHighlight = isActive && !isEditing;
  const isConfiguration = presentation === "configuration";
  const showSeatActions =
    isEditing && (!isConfiguration || isSelectedForManagement);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: player.id,
    disabled: !isEditing || isPending,
  });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      {...(isEditing ? attributes : {})}
      {...(isEditing ? listeners : {})}
      className={cn(
        "relative flex items-center justify-between gap-4 rounded-lg border px-4 py-4",
        isConfiguration ? "min-w-0 flex-wrap" : null,
        showActiveRowHighlight
          ? "border-orange-400 bg-orange-400 text-black"
          : "border-orange-400/20 bg-orange-400/5",
        isEditing && !isPending
          ? "cursor-grab touch-none active:cursor-grabbing"
          : null,
        isDragging ? "opacity-70 shadow-2xl shadow-orange-400/30" : null,
      )}
    >
      {isEmptySeat ? (
        <div
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute inset-0 rounded-lg opacity-60",
            showActiveRowHighlight ? "opacity-30" : "opacity-60",
          )}
          style={{
            backgroundImage:
              "repeating-linear-gradient(315deg, transparent 0, transparent 10px, rgba(251, 146, 60, 0.22) 10px, rgba(251, 146, 60, 0.22) 16px)",
          }}
        />
      ) : null}
      <div className="relative z-10">
        <div
          className={cn(
            "font-medium",
            showActiveRowHighlight
              ? "text-black"
              : isEmptySeat
                ? "text-orange-200"
                : "text-orange-300",
          )}
        >
          {playerLabel}
        </div>
        <div
          className={cn(
            "mt-1 text-xs uppercase tracking-[0.2em]",
            showActiveRowHighlight ? "text-black/60" : "text-orange-300/70",
          )}
        >
          Seat {index + 1}
          {player.isOrganizer ? " · Overlord" : ""}
          {isActive && !isEditing ? " · Active" : ""}
        </div>
      </div>
      {isEditing ? (
        <div
          className={cn(
            "relative z-10 flex items-center justify-end gap-2",
            isConfiguration ? "min-w-0 flex-wrap" : "flex-nowrap",
          )}
        >
          {isConfiguration ? (
            <Button
              data-no-drag="true"
              aria-current={isSelectedForManagement ? "true" : undefined}
              type="button"
              variant={isSelectedForManagement ? "default" : "secondary"}
              onClick={() => {
                onSelectForManagement(player.id);
              }}
            >
              Manage seat {index + 1}
              {isSelectedForManagement ? (
                <span aria-hidden="true" className="ml-2 text-xs uppercase">
                  Selected
                </span>
              ) : null}
            </Button>
          ) : null}
          {showSeatActions ? (
            <>
              <Button
                data-no-drag="true"
                aria-pressed={isActive}
                className="w-28 shrink-0 transition-none"
                disabled={isPending || player.userId == null || isActive}
                type="button"
                variant={isActive ? "default" : "secondary"}
                onClick={() => {
                  onMakeActive(index);
                }}
              >
                {isActive ? "Active seat" : "Make active"}
              </Button>
              <span className="group relative inline-flex" data-no-drag="true">
                <Button
                  data-no-drag="true"
                  className="w-28 shrink-0"
                  disabled={
                    isPending || player.userId == null || !canClearPlayer
                  }
                  type="button"
                  variant="outline"
                  onClick={() => {
                    onClearPlayer(index);
                  }}
                >
                  Clear seat
                </Button>
              </span>
              <span className="group relative inline-flex" data-no-drag="true">
                <Button
                  data-no-drag="true"
                  className="w-28 shrink-0"
                  disabled={isPending || !canRemoveSeat}
                  type="button"
                  variant="outline"
                  onClick={() => {
                    onRemoveSeat(index);
                  }}
                >
                  Remove seat
                </Button>
              </span>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function SeatOrderEditor({
  gameNumber,
  players,
  activePlayerEntryId,
  canEdit,
  presentation = "card",
  onDirtyChange,
}: SeatOrderEditorProps) {
  const router = useRouter();
  const isConfiguration = presentation === "configuration";
  const [isCardEditing, setIsCardEditing] = useState(false);
  const isEditing = isConfiguration ? canEdit : isCardEditing;
  const [draftPlayers, setDraftPlayers] = useState(players);
  const [draftActivePlayerEntryId, setDraftActivePlayerEntryId] =
    useState(activePlayerEntryId);
  const [draftBaselinePlayers, setDraftBaselinePlayers] = useState(players);
  const [
    draftBaselineActivePlayerEntryId,
    setDraftBaselineActivePlayerEntryId,
  ] = useState(activePlayerEntryId);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [confirmation, setConfirmation] =
    useState<TerminalConfirmationSpec | null>(null);
  const [pendingSeatAction, setPendingSeatAction] =
    useState<PendingSeatAction | null>(null);
  const [selectedSeatEntryId, setSelectedSeatEntryId] = useState<string | null>(
    null,
  );
  const [isPending, startTransition] = useTransition();
  const sensors = useSensors(
    useSensor(NoDragPointerSensor, {
      activationConstraint: {
        distance: 6,
      },
    }),
    useSensor(NoDragTouchSensor, {
      activationConstraint: {
        delay: 120,
        tolerance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  const isMutating = isPending;
  const draftHasLocalChanges = !seatDraftsMatch(
    draftPlayers,
    draftActivePlayerEntryId,
    draftBaselinePlayers,
    draftBaselineActivePlayerEntryId,
  );
  const workingPlayers = draftHasLocalChanges ? draftPlayers : players;
  const workingActivePlayerEntryId = draftHasLocalChanges
    ? draftActivePlayerEntryId
    : activePlayerEntryId;
  const isDirty = !seatDraftsMatch(
    workingPlayers,
    workingActivePlayerEntryId,
    players,
    activePlayerEntryId,
  );

  useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  function updateDraft(
    nextPlayers: SeatOrderPlayer[],
    nextActivePlayerEntryId: string | null,
  ) {
    setDraftPlayers(nextPlayers);
    setDraftActivePlayerEntryId(nextActivePlayerEntryId);
    setDraftBaselinePlayers(players);
    setDraftBaselineActivePlayerEntryId(activePlayerEntryId);
  }
  const pendingSeatConfirmation: TerminalActionConfirmationSpec | null =
    pendingSeatAction
      ? {
          title: "Confirm seat change",
          command:
            pendingSeatAction.type === "clear"
              ? `seat-order --clear seat-${pendingSeatAction.seatNumber}`
              : `seat-order --remove seat-${pendingSeatAction.seatNumber}`,
          lines: [
            pendingSeatAction.type === "clear"
              ? `${pendingSeatAction.displayName} will be removed from seat ${pendingSeatAction.seatNumber}, but the seat will remain in the turn order.`
              : `Seat ${pendingSeatAction.seatNumber} will be deleted from the game and the remaining seats will be renumbered.`,
          ],
        }
      : null;

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;

    if (!over || active.id === over.id) {
      return;
    }

    const oldIndex = workingPlayers.findIndex(
      (player) => player.id === active.id,
    );
    const newIndex = workingPlayers.findIndex(
      (player) => player.id === over.id,
    );

    if (oldIndex === -1 || newIndex === -1) {
      return;
    }

    updateDraft(
      movePlayerToSeat(workingPlayers, oldIndex, newIndex),
      workingActivePlayerEntryId,
    );
    setErrorMessage(null);
    setConfirmation(null);
    setPendingSeatAction(null);
  }

  function makeSeatActive(index: number) {
    const selectedPlayer = workingPlayers[index];

    if (
      !selectedPlayer?.userId ||
      selectedPlayer.id === workingActivePlayerEntryId
    ) {
      return;
    }

    updateDraft(workingPlayers, selectedPlayer.id);
    setErrorMessage(null);
    setConfirmation(null);
    setPendingSeatAction(null);
  }

  function getSeatAction(index: number, type: PendingSeatAction["type"]) {
    const selectedPlayer = workingPlayers[index];

    if (!selectedPlayer) {
      return null;
    }

    return {
      type,
      seatEntryId: selectedPlayer.id,
      seatNumber: index + 1,
      displayName: selectedPlayer.displayName ?? `Player ${index + 1}`,
    } satisfies PendingSeatAction;
  }

  function applyClearPlayerFromSeat(seatEntryId: string) {
    const selectedPlayer = workingPlayers.find(
      (player) => player.id === seatEntryId,
    );

    if (!selectedPlayer?.userId) {
      return;
    }

    const occupiedSeatCount = workingPlayers.filter(
      (player) => player.userId != null,
    ).length;

    if (occupiedSeatCount <= 1) {
      return;
    }

    updateDraft(
      workingPlayers.map((player) => {
        if (player.id !== seatEntryId) {
          return player;
        }

        return {
          ...player,
          userId: null,
          displayName: null,
        };
      }),
      getNextOccupiedSeatEntryId(
        workingPlayers,
        workingActivePlayerEntryId,
        seatEntryId,
      ),
    );
    setErrorMessage(null);
    setConfirmation(null);
    setPendingSeatAction(null);
    setSelectedSeatEntryId(null);
  }

  function applyRemoveSeatFromGame(seatEntryId: string) {
    const selectedPlayer = workingPlayers.find(
      (player) => player.id === seatEntryId,
    );

    if (!selectedPlayer) {
      return;
    }

    const occupiedSeatCount = workingPlayers.filter(
      (player) => player.userId != null,
    ).length;

    if (selectedPlayer.userId != null && occupiedSeatCount <= 1) {
      return;
    }

    updateDraft(
      normalizeSeatOrder(
        workingPlayers.filter((player) => player.id !== seatEntryId),
      ),
      getNextOccupiedSeatEntryId(
        workingPlayers,
        workingActivePlayerEntryId,
        seatEntryId,
      ),
    );
    setErrorMessage(null);
    setConfirmation(null);
    setPendingSeatAction(null);
    setSelectedSeatEntryId(null);
  }

  function clearPlayerFromSeat(index: number) {
    const seatAction = getSeatAction(index, "clear");

    if (!seatAction) {
      return;
    }

    const selectedPlayer = workingPlayers[index];

    if (!selectedPlayer?.userId) {
      return;
    }

    const occupiedSeatCount = workingPlayers.filter(
      (player) => player.userId != null,
    ).length;

    if (occupiedSeatCount <= 1) {
      return;
    }

    setPendingSeatAction(seatAction);
    setErrorMessage(null);
    setConfirmation(null);
  }

  function removeSeatFromGame(index: number) {
    const seatAction = getSeatAction(index, "remove");

    if (!seatAction) {
      return;
    }

    const selectedPlayer = workingPlayers[index];

    if (!selectedPlayer) {
      return;
    }

    const occupiedSeatCount = workingPlayers.filter(
      (player) => player.userId != null,
    ).length;

    if (selectedPlayer.userId != null && occupiedSeatCount <= 1) {
      return;
    }

    setPendingSeatAction(seatAction);
    setErrorMessage(null);
    setConfirmation(null);
  }

  function confirmPendingSeatAction() {
    if (!pendingSeatAction) {
      return;
    }

    if (pendingSeatAction.type === "clear") {
      applyClearPlayerFromSeat(pendingSeatAction.seatEntryId);
      return;
    }

    applyRemoveSeatFromGame(pendingSeatAction.seatEntryId);
  }

  function cancelEdit() {
    updateDraft(players, activePlayerEntryId);
    setIsCardEditing(false);
    setErrorMessage(null);
    setConfirmation(null);
    setPendingSeatAction(null);
    setSelectedSeatEntryId(null);
  }

  function saveSeatOrder() {
    setErrorMessage(null);
    setConfirmation(null);
    setPendingSeatAction(null);

    startTransition(async () => {
      const response = await fetch(
        `/api/games/${encodeURIComponent(String(gameNumber))}/seat-order`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify({
            seatEntryIds: workingPlayers.map((player) => player.id),
            clearedSeatEntryIds: players
              .filter((player) => player.userId != null)
              .filter(
                (player) =>
                  workingPlayers.find(
                    (draftPlayer) => draftPlayer.id === player.id,
                  )?.userId == null,
              )
              .map((player) => player.id),
            removedSeatEntryIds: players
              .filter(
                (player) =>
                  !workingPlayers.some(
                    (draftPlayer) => draftPlayer.id === player.id,
                  ),
              )
              .map((player) => player.id),
            activePlayerEntryId: workingActivePlayerEntryId,
          }),
        },
      );

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          error?: string;
        } | null;
        setErrorMessage(payload?.error ?? "The seat order update failed.");
        return;
      }

      updateDraft(players, activePlayerEntryId);
      setSelectedSeatEntryId(null);
      onDirtyChange?.(false);
      setIsCardEditing(false);
      setConfirmation({
        command: "seat-order --commit",
        lines: [
          "[ok] seat map persisted to the current campaign ledger",
          "[ok] active lord pointer updated for the next upload cycle",
          "[done] confirmation broadcast queued for local operator review",
          "<SEAT ORDED CHANGED>",
        ],
      });
      router.refresh();
    });
  }

  const visiblePlayers = isEditing ? workingPlayers : players;

  const overlays = (
    <>
      <TerminalConfirmationModal
        confirmation={confirmation}
        onClose={() => {
          setConfirmation(null);
        }}
      />
      <TerminalActionConfirmationDialog
        confirmation={pendingSeatConfirmation}
        isPending={isMutating}
        onCancel={() => {
          setPendingSeatAction(null);
        }}
        onConfirm={confirmPendingSeatAction}
      />
    </>
  );

  const seatRows = (
    <>
      {errorMessage ? (
        <div
          className="rounded-lg border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm font-mono text-red-300"
          role="alert"
        >
          {errorMessage}
        </div>
      ) : null}
      <DndContext
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
        sensors={sensors}
      >
        <SortableContext
          items={visiblePlayers.map((player) => player.id)}
          strategy={verticalListSortingStrategy}
        >
          {visiblePlayers.map((player, index) => (
            <SortableSeatRow
              key={player.id}
              activePlayerEntryId={
                isEditing ? workingActivePlayerEntryId : activePlayerEntryId
              }
              canClearPlayer={
                visiblePlayers.filter(
                  (visiblePlayer) => visiblePlayer.userId != null,
                ).length > 1
              }
              canRemoveSeat={
                player.userId == null ||
                visiblePlayers.filter(
                  (visiblePlayer) => visiblePlayer.userId != null,
                ).length > 1
              }
              index={index}
              isEditing={isEditing}
              isPending={isMutating}
              isSelectedForManagement={selectedSeatEntryId === player.id}
              onClearPlayer={clearPlayerFromSeat}
              onMakeActive={makeSeatActive}
              onRemoveSeat={removeSeatFromGame}
              onSelectForManagement={setSelectedSeatEntryId}
              player={player}
              presentation={presentation}
            />
          ))}
        </SortableContext>
      </DndContext>
    </>
  );

  if (isConfiguration) {
    return (
      <div
        className="flex min-w-0 flex-col gap-3 overflow-hidden [overflow-wrap:anywhere]"
        data-testid="seat-order-configuration"
      >
        {overlays}
        {canEdit ? (
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              disabled={isMutating}
              type="button"
              variant="secondary"
              onClick={cancelEdit}
            >
              Cancel
            </Button>
            <Button disabled={isMutating} type="button" onClick={saveSeatOrder}>
              {isPending ? "Saving..." : "Save order"}
            </Button>
          </div>
        ) : null}
        {seatRows}
      </div>
    );
  }

  return (
    <Card>
      {overlays}
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle>Seat order:</CardTitle>
          <CardDescription>
            {isEditing
              ? "Drag a seat card to reorder turns, clear or remove seats, or choose which player is active."
              : "The current lords and the active seat."}
          </CardDescription>
        </div>
        {canEdit ? (
          isEditing ? (
            <div className="flex gap-2">
              <Button
                disabled={isMutating}
                type="button"
                variant="secondary"
                onClick={cancelEdit}
              >
                Cancel
              </Button>
              <Button
                disabled={isMutating}
                type="button"
                onClick={saveSeatOrder}
              >
                {isPending ? "Saving..." : "Save order"}
              </Button>
            </div>
          ) : (
            <Button
              disabled={isMutating}
              type="button"
              variant="secondary"
              onClick={() => {
                updateDraft(players, activePlayerEntryId);
                setIsCardEditing(true);
                setErrorMessage(null);
                setConfirmation(null);
                setSelectedSeatEntryId(null);
              }}
            >
              Edit
            </Button>
          )
        ) : null}
      </CardHeader>
      <CardContent className="space-y-3">{seatRows}</CardContent>
    </Card>
  );
}

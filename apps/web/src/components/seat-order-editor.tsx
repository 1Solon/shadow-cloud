"use client";

import { useState, useTransition } from "react";
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
        <div className="relative z-10 flex flex-nowrap items-center justify-end gap-2">
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
                isPending ||
                player.userId == null ||
                player.isOrganizer ||
                !canClearPlayer
              }
              type="button"
              variant="outline"
              onClick={() => {
                onClearPlayer(index);
              }}
            >
              Clear seat
            </Button>
            {player.isOrganizer ? (
              <span className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 hidden w-56 -translate-x-1/2 rounded-md border border-orange-400/30 bg-black px-3 py-2 text-[10px] normal-case tracking-normal text-orange-200 shadow-lg group-hover:block group-focus-within:block">
                Transfer the Overlord to another occupied seat before removing
                this seat.
              </span>
            ) : null}
          </span>
          <span className="group relative inline-flex" data-no-drag="true">
            <Button
              data-no-drag="true"
              className="w-28 shrink-0"
              disabled={isPending || player.isOrganizer || !canRemoveSeat}
              type="button"
              variant="outline"
              onClick={() => {
                onRemoveSeat(index);
              }}
            >
              Remove seat
            </Button>
            {player.isOrganizer ? (
              <span className="pointer-events-none absolute bottom-full left-1/2 z-20 mb-2 hidden w-56 -translate-x-1/2 rounded-md border border-orange-400/30 bg-black px-3 py-2 text-[10px] normal-case tracking-normal text-orange-200 shadow-lg group-hover:block group-focus-within:block">
                Transfer the Overlord to another occupied seat before removing
                this seat.
              </span>
            ) : null}
          </span>
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
}: SeatOrderEditorProps) {
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);
  const [draftPlayers, setDraftPlayers] = useState(players);
  const [draftActivePlayerEntryId, setDraftActivePlayerEntryId] =
    useState(activePlayerEntryId);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [confirmation, setConfirmation] =
    useState<TerminalConfirmationSpec | null>(null);
  const [pendingSeatAction, setPendingSeatAction] =
    useState<PendingSeatAction | null>(null);
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

    setDraftPlayers((currentPlayers) => {
      const oldIndex = currentPlayers.findIndex(
        (player) => player.id === active.id,
      );
      const newIndex = currentPlayers.findIndex(
        (player) => player.id === over.id,
      );

      if (oldIndex === -1 || newIndex === -1) {
        return currentPlayers;
      }

      return movePlayerToSeat(currentPlayers, oldIndex, newIndex);
    });
    setErrorMessage(null);
    setConfirmation(null);
    setPendingSeatAction(null);
  }

  function makeSeatActive(index: number) {
    const selectedPlayer = draftPlayers[index];

    if (
      !selectedPlayer?.userId ||
      selectedPlayer.id === draftActivePlayerEntryId
    ) {
      return;
    }

    setDraftActivePlayerEntryId(selectedPlayer.id);
    setErrorMessage(null);
    setConfirmation(null);
    setPendingSeatAction(null);
  }

  function getSeatAction(index: number, type: PendingSeatAction["type"]) {
    const selectedPlayer = draftPlayers[index];

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
    const selectedPlayer = draftPlayers.find(
      (player) => player.id === seatEntryId,
    );

    if (!selectedPlayer?.userId || selectedPlayer.isOrganizer) {
      return;
    }

    const occupiedSeatCount = draftPlayers.filter(
      (player) => player.userId != null,
    ).length;

    if (occupiedSeatCount <= 1) {
      return;
    }

    setDraftPlayers((currentPlayers) =>
      currentPlayers.map((player) => {
        if (player.id !== seatEntryId) {
          return player;
        }

        return {
          ...player,
          userId: null,
          displayName: null,
        };
      }),
    );
    setDraftActivePlayerEntryId(
      getNextOccupiedSeatEntryId(
        draftPlayers,
        draftActivePlayerEntryId,
        seatEntryId,
      ),
    );
    setErrorMessage(null);
    setConfirmation(null);
    setPendingSeatAction(null);
  }

  function applyRemoveSeatFromGame(seatEntryId: string) {
    const selectedPlayer = draftPlayers.find(
      (player) => player.id === seatEntryId,
    );

    if (!selectedPlayer || selectedPlayer.isOrganizer) {
      return;
    }

    const occupiedSeatCount = draftPlayers.filter(
      (player) => player.userId != null,
    ).length;

    if (selectedPlayer.userId != null && occupiedSeatCount <= 1) {
      return;
    }

    setDraftPlayers((currentPlayers) =>
      normalizeSeatOrder(
        currentPlayers.filter((player) => player.id !== seatEntryId),
      ),
    );
    setDraftActivePlayerEntryId(
      getNextOccupiedSeatEntryId(
        draftPlayers,
        draftActivePlayerEntryId,
        seatEntryId,
      ),
    );
    setErrorMessage(null);
    setConfirmation(null);
    setPendingSeatAction(null);
  }

  function clearPlayerFromSeat(index: number) {
    const seatAction = getSeatAction(index, "clear");

    if (!seatAction) {
      return;
    }

    const selectedPlayer = draftPlayers[index];

    if (!selectedPlayer?.userId || selectedPlayer.isOrganizer) {
      return;
    }

    const occupiedSeatCount = draftPlayers.filter(
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

    const selectedPlayer = draftPlayers[index];

    if (!selectedPlayer || selectedPlayer.isOrganizer) {
      return;
    }

    const occupiedSeatCount = draftPlayers.filter(
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
    setDraftPlayers(players);
    setDraftActivePlayerEntryId(activePlayerEntryId);
    setIsEditing(false);
    setErrorMessage(null);
    setConfirmation(null);
    setPendingSeatAction(null);
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
            seatEntryIds: draftPlayers.map((player) => player.id),
            clearedSeatEntryIds: players
              .filter((player) => player.userId != null)
              .filter(
                (player) =>
                  draftPlayers.find(
                    (draftPlayer) => draftPlayer.id === player.id,
                  )?.userId == null,
              )
              .map((player) => player.id),
            removedSeatEntryIds: players
              .filter(
                (player) =>
                  !draftPlayers.some(
                    (draftPlayer) => draftPlayer.id === player.id,
                  ),
              )
              .map((player) => player.id),
            activePlayerEntryId: draftActivePlayerEntryId,
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

      setIsEditing(false);
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

  const visiblePlayers = isEditing ? draftPlayers : players;

  return (
    <Card>
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
                setDraftPlayers(players);
                setDraftActivePlayerEntryId(activePlayerEntryId);
                setIsEditing(true);
                setErrorMessage(null);
                setConfirmation(null);
              }}
            >
              Edit
            </Button>
          )
        ) : null}
      </CardHeader>
      <CardContent className="space-y-3">
        {errorMessage ? (
          <div className="rounded-lg border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm font-mono text-red-300">
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
                  isEditing ? draftActivePlayerEntryId : activePlayerEntryId
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
                onClearPlayer={clearPlayerFromSeat}
                onMakeActive={makeSeatActive}
                onRemoveSeat={removeSeatFromGame}
                player={player}
              />
            ))}
          </SortableContext>
        </DndContext>
      </CardContent>
    </Card>
  );
}

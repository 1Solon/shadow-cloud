# Manage Seat Modal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace campaign configuration’s inline seat-management controls with an accessible, seat-centric modal that contains no status-label UI elements.

**Architecture:** Add a focused `ManageSeatModal` presentation component that owns modal rendering, initial focus, focus containment, Escape handling, and backdrop dismissal. Keep draft state and all seat business rules in `SeatOrderEditor`; it derives the selected seat’s current draft state, coordinates destructive confirmation transitions, and restores focus after each flow.

**Tech Stack:** React 19, TypeScript 6, Next.js 16 client components, Tailwind CSS, Vitest, Testing Library, `user-event`.

---

## File Structure

- Create `apps/web/src/components/manage-seat-modal.tsx` — render the modal, action descriptions, disabled reasons, responsive styling, and keyboard/focus behavior.
- Create `apps/web/src/components/manage-seat-modal.test.tsx` — test the presentation component independently, including the absence of status badges/chips.
- Modify `apps/web/src/components/seat-order-editor.tsx` — open the modal from configuration rows, derive modal props from the draft, coordinate action/confirmation transitions, and restore focus.
- Modify `apps/web/src/components/seat-order-editor.test.tsx` — replace inline-management expectations with modal integration, transition, focus, eligibility, and regression coverage.

### Task 1: Build the Accessible Manage Seat Modal

**Files:**
- Create: `apps/web/src/components/manage-seat-modal.test.tsx`
- Create: `apps/web/src/components/manage-seat-modal.tsx`

- [ ] **Step 1: Write the failing presentation tests**

Create `apps/web/src/components/manage-seat-modal.test.tsx`:

```tsx
// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ManageSeatModal,
  type ManageSeatModalSeat,
} from "@/components/manage-seat-modal";

const occupiedSeat: ManageSeatModalSeat = {
  id: "seat-2",
  seatNumber: 2,
  playerLabel: "Rhea",
  isActive: false,
  isEmpty: false,
  canClear: true,
  canRemove: false,
  requiresSavedClearBeforeRemove: false,
};

function renderModal(
  seat: ManageSeatModalSeat | null = occupiedSeat,
  overrides: Partial<ComponentProps<typeof ManageSeatModal>> = {},
) {
  const callbacks = {
    onClear: vi.fn(),
    onClose: vi.fn(),
    onMakeActive: vi.fn(),
    onRemove: vi.fn(),
  };

  render(
    <ManageSeatModal
      isPending={false}
      seat={seat}
      {...callbacks}
      {...overrides}
    />,
  );

  return callbacks;
}

describe("ManageSeatModal", () => {
  afterEach(cleanup);

  it("identifies the seat and player without status-label elements", () => {
    renderModal();

    const dialog = screen.getByRole("dialog", { name: "Manage seat 2" });
    expect(within(dialog).getByText("Rhea")).toBeVisible();
    expect(within(dialog).queryByText("Occupied")).not.toBeInTheDocument();
    expect(within(dialog).queryByText("Not active")).not.toBeInTheDocument();
    expect(within(dialog).queryByText("Active")).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Make active" })).toBeEnabled();
    expect(within(dialog).getByRole("button", { name: "Clear seat" })).toBeEnabled();
    expect(within(dialog).getByRole("button", { name: "Remove seat" })).toBeDisabled();
    expect(within(dialog).getByText("Only empty seats can be removed.")).toBeVisible();
  });

  it("shows an open seat without adding an open-status label", () => {
    renderModal({
      ...occupiedSeat,
      id: "seat-3",
      seatNumber: 3,
      playerLabel: "[Open]",
      isEmpty: true,
      canClear: false,
      canRemove: true,
    });

    const dialog = screen.getByRole("dialog", { name: "Manage seat 3" });
    expect(within(dialog).getByText("[Open]")).toBeVisible();
    expect(within(dialog).queryByText("Open", { exact: true })).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Make active" })).toBeDisabled();
    expect(within(dialog).getByText("An empty seat cannot be made active.")).toBeVisible();
    expect(within(dialog).getByRole("button", { name: "Clear seat" })).toBeDisabled();
    expect(within(dialog).getByText("This seat is already empty.")).toBeVisible();
    expect(within(dialog).getByRole("button", { name: "Remove seat" })).toBeEnabled();
  });

  it("renders each unavailable reason from explicit seat state", () => {
    const { rerender } = render(
      <ManageSeatModal
        isPending={false}
        onClear={vi.fn()}
        onClose={vi.fn()}
        onMakeActive={vi.fn()}
        onRemove={vi.fn()}
        seat={{ ...occupiedSeat, isActive: true, canClear: false }}
      />,
    );

    expect(screen.getByText("This seat is already active.")).toBeVisible();
    expect(screen.getByText("At least one occupied seat must remain.")).toBeVisible();

    rerender(
      <ManageSeatModal
        isPending={false}
        onClear={vi.fn()}
        onClose={vi.fn()}
        onMakeActive={vi.fn()}
        onRemove={vi.fn()}
        seat={{
          ...occupiedSeat,
          playerLabel: "[Open]",
          isEmpty: true,
          canClear: false,
          requiresSavedClearBeforeRemove: true,
        }}
      />,
    );

    expect(
      screen.getByText("Save the cleared seat before removing it."),
    ).toBeVisible();
  });

  it("invokes each enabled action", async () => {
    const user = userEvent.setup();
    const callbacks = renderModal({ ...occupiedSeat, canRemove: true });
    const dialog = screen.getByRole("dialog");

    await user.click(within(dialog).getByRole("button", { name: "Make active" }));
    await user.click(within(dialog).getByRole("button", { name: "Clear seat" }));
    await user.click(within(dialog).getByRole("button", { name: "Remove seat" }));

    expect(callbacks.onMakeActive).toHaveBeenCalledOnce();
    expect(callbacks.onClear).toHaveBeenCalledOnce();
    expect(callbacks.onRemove).toHaveBeenCalledOnce();
  });

  it("contains focus and closes through Escape, the backdrop, and visible controls", async () => {
    const user = userEvent.setup();
    const callbacks = renderModal();
    const dialog = screen.getByRole("dialog");
    const makeActive = within(dialog).getByRole("button", { name: "Make active" });
    const headerClose = within(dialog).getByRole("button", {
      name: "Close manage seat",
    });
    const footerClose = within(dialog).getByRole("button", { name: "Close" });

    await waitFor(() => expect(makeActive).toHaveFocus());
    footerClose.focus();
    await user.tab();
    expect(headerClose).toHaveFocus();
    await user.tab({ shift: true });
    expect(footerClose).toHaveFocus();

    fireEvent.click(dialog);
    expect(callbacks.onClose).not.toHaveBeenCalled();
    fireEvent.click(dialog.parentElement!);
    expect(callbacks.onClose).toHaveBeenCalledOnce();

    callbacks.onClose.mockClear();
    await user.keyboard("{Escape}");
    expect(callbacks.onClose).toHaveBeenCalledOnce();

    callbacks.onClose.mockClear();
    await user.click(footerClose);
    expect(callbacks.onClose).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run the test and verify the component is missing**

Run:

```bash
pnpm --filter @shadow-cloud/web test -- src/components/manage-seat-modal.test.tsx
```

Expected: FAIL because `@/components/manage-seat-modal` cannot be resolved.

- [ ] **Step 3: Implement the modal presentation component**

Create `apps/web/src/components/manage-seat-modal.tsx`:

```tsx
"use client";

import { useEffect, useId, useRef } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ManageSeatModalSeat = {
  id: string;
  seatNumber: number;
  playerLabel: string;
  isActive: boolean;
  isEmpty: boolean;
  canClear: boolean;
  canRemove: boolean;
  requiresSavedClearBeforeRemove: boolean;
};

type ManageSeatModalProps = {
  seat: ManageSeatModalSeat | null;
  isPending: boolean;
  onClose: () => void;
  onMakeActive: () => void;
  onClear: () => void;
  onRemove: () => void;
};

type SeatActionProps = {
  title: string;
  description: string;
  disabled: boolean;
  destructive?: boolean;
  onClick: () => void;
};

function SeatAction({
  title,
  description,
  disabled,
  destructive = false,
  onClick,
}: SeatActionProps) {
  const descriptionId = useId();

  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-3 rounded-xl border p-4 sm:flex-row sm:items-center sm:justify-between",
        destructive
          ? "border-red-400/20 bg-red-400/5"
          : "border-orange-400/20 bg-orange-400/5",
      )}
    >
      <div className="min-w-0">
        <div
          className={cn(
            "font-mono font-semibold",
            destructive ? "text-red-200" : "text-orange-200",
          )}
        >
          {title}
        </div>
        <p
          className={cn(
            "mt-1 break-words text-sm leading-6",
            destructive ? "text-red-200/70" : "text-orange-200/70",
          )}
          id={descriptionId}
        >
          {description}
        </p>
      </div>
      <Button
        aria-describedby={descriptionId}
        className={cn(
          "w-full shrink-0 sm:w-32",
          destructive
            ? "border-red-400 text-red-300 hover:bg-red-400 hover:text-black"
            : null,
        )}
        data-seat-action="true"
        disabled={disabled}
        type="button"
        variant={destructive ? "outline" : "secondary"}
        onClick={onClick}
      >
        {title}
      </Button>
    </div>
  );
}

export function ManageSeatModal({
  seat,
  isPending,
  onClose,
  onMakeActive,
  onClear,
  onRemove,
}: ManageSeatModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const seatId = seat?.id;

  useEffect(() => {
    if (!seatId) {
      return;
    }

    function containFocus(event: FocusEvent) {
      if (
        event.target instanceof Node &&
        !dialogRef.current?.contains(event.target)
      ) {
        closeButtonRef.current?.focus();
      }
    }

    const firstAction = dialogRef.current?.querySelector<HTMLButtonElement>(
      'button[data-seat-action="true"]:not([disabled])',
    );
    (firstAction ?? closeButtonRef.current)?.focus();
    document.addEventListener("focusin", containFocus);

    return () => {
      document.removeEventListener("focusin", containFocus);
    };
  }, [seatId]);

  if (!seat) {
    return null;
  }

  const makeActiveDescription = seat.isEmpty
    ? "An empty seat cannot be made active."
    : seat.isActive
      ? "This seat is already active."
      : `Set seat ${seat.seatNumber} as the current turn.`;
  const clearDescription = seat.isEmpty
    ? "This seat is already empty."
    : !seat.canClear
      ? "At least one occupied seat must remain."
      : `Remove ${seat.playerLabel} but keep seat ${seat.seatNumber} in the turn order.`;
  const removeDescription = seat.requiresSavedClearBeforeRemove
    ? "Save the cleared seat before removing it."
    : !seat.isEmpty
      ? "Only empty seats can be removed."
      : !seat.canRemove
        ? "This seat cannot be removed."
        : "Delete this empty seat and renumber the remaining seats.";

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape" && !isPending) {
      event.preventDefault();
      onClose();
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
    const first = focusableElements[0];
    const last = focusableElements.at(-1);

    if (!first || !last) {
      event.preventDefault();
      return;
    }

    if (
      (event.shiftKey && document.activeElement === first) ||
      (!event.shiftKey && document.activeElement === last) ||
      !dialogRef.current?.contains(document.activeElement)
    ) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4 py-6 backdrop-blur-sm"
      onClick={(event) => {
        if (event.target === event.currentTarget && !isPending) {
          onClose();
        }
      }}
    >
      <div
        aria-labelledby={titleId}
        aria-modal="true"
        className="relative max-h-[calc(100vh-3rem)] w-full max-w-xl overflow-y-auto rounded-2xl border border-orange-400/30 bg-[#0a0711] shadow-2xl shadow-orange-950/40"
        ref={dialogRef}
        role="dialog"
        onKeyDown={handleKeyDown}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-orange-400/20 bg-[#1f1110] px-4 py-3 font-mono text-[11px] uppercase tracking-[0.28em] text-orange-200">
          <span id={titleId}>Manage seat {seat.seatNumber}</span>
          <button
            aria-label="Close manage seat"
            className="text-orange-300/70 transition-colors hover:text-orange-200 disabled:opacity-50"
            disabled={isPending}
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
          >
            X
          </button>
        </div>
        <div className="space-y-4 bg-black/70 px-4 py-4 font-mono text-orange-300 sm:px-5 sm:py-5">
          <div className="min-w-0 border-b border-orange-400/15 px-1 pb-4 text-xl font-semibold text-orange-300 [overflow-wrap:anywhere]">
            {seat.playerLabel}
          </div>
          <div className="space-y-3">
            <SeatAction
              description={makeActiveDescription}
              disabled={isPending || seat.isEmpty || seat.isActive}
              title="Make active"
              onClick={onMakeActive}
            />
            <SeatAction
              description={clearDescription}
              disabled={isPending || !seat.canClear}
              title="Clear seat"
              onClick={onClear}
            />
            <SeatAction
              destructive
              description={removeDescription}
              disabled={isPending || !seat.canRemove}
              title="Remove seat"
              onClick={onRemove}
            />
          </div>
          <div className="flex justify-end pt-1">
            <Button
              disabled={isPending}
              type="button"
              variant="secondary"
              onClick={onClose}
            >
              Close
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run the focused component test**

Run:

```bash
pnpm --filter @shadow-cloud/web test -- src/components/manage-seat-modal.test.tsx
```

Expected: PASS, 5 tests passed.

- [ ] **Step 5: Commit the presentation component**

```bash
git add apps/web/src/components/manage-seat-modal.tsx apps/web/src/components/manage-seat-modal.test.tsx
git commit -m "feat(web): add manage seat modal"
```

### Task 2: Replace Configuration’s Inline Expansion With the Modal

**Files:**
- Modify: `apps/web/src/components/seat-order-editor.test.tsx:72-122,181-214,389-425`
- Modify: `apps/web/src/components/seat-order-editor.tsx:3,125-382,393-413,786-874`

- [ ] **Step 1: Rewrite the configuration opening and keyboard tests**

In `apps/web/src/components/seat-order-editor.test.tsx`, replace the test named `focuses configuration management actions on one selected seat` with:

```tsx
  it("opens one management modal for the selected configuration seat", async () => {
    const user = userEvent.setup();
    renderEditor();

    expect(screen.queryByRole("dialog", { name: /manage seat/i })).toBeNull();
    expect(screen.queryByRole("button", { name: "Clear seat" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Manage seat 2" }));

    const occupiedDialog = screen.getByRole("dialog", {
      name: "Manage seat 2",
    });
    expect(within(occupiedDialog).getByText("Rhea")).toBeVisible();
    expect(within(occupiedDialog).getByRole("button", { name: "Make active" })).toBeVisible();
    expect(within(occupiedDialog).getByRole("button", { name: "Clear seat" })).toBeVisible();
    expect(within(occupiedDialog).getByRole("button", { name: "Remove seat" })).toBeVisible();
    expect(within(occupiedDialog).queryByText("Occupied")).toBeNull();
    expect(within(occupiedDialog).queryByText("Not active")).toBeNull();

    await user.click(within(occupiedDialog).getByRole("button", { name: "Close" }));
    await user.click(screen.getByRole("button", { name: "Manage seat 3" }));

    const openDialog = screen.getByRole("dialog", { name: "Manage seat 3" });
    expect(within(openDialog).getByText("[Open]")).toBeVisible();
    expect(within(openDialog).queryByText("Open", { exact: true })).toBeNull();
  });
```

Replace the test named `keeps management controls independently keyboard activatable` with:

```tsx
  it("opens seat management from the keyboard", async () => {
    const user = userEvent.setup();
    renderEditor();
    const manageSeat = screen.getByRole("button", { name: "Manage seat 2" });

    manageSeat.focus();
    await user.keyboard("{Enter}");

    expect(
      screen.getByRole("dialog", { name: "Manage seat 2" }),
    ).toBeVisible();
  });
```

Keep the default card editing test unchanged; it must continue to find three inline `Clear seat` and `Remove seat` buttons after clicking `Edit`.

- [ ] **Step 2: Run the integration test and verify inline behavior fails the new expectations**

Run:

```bash
pnpm --filter @shadow-cloud/web test -- src/components/seat-order-editor.test.tsx
```

Expected: FAIL because `Manage seat N` still expands controls inline and no `Manage seat N` dialog exists.

- [ ] **Step 3: Simplify configuration rows to triggers plus drag handles**

In `apps/web/src/components/seat-order-editor.tsx`:

1. Add `useRef` to the React import and import the modal:

```tsx
import { useEffect, useRef, useState, useTransition } from "react";
import {
  ManageSeatModal,
  type ManageSeatModalSeat,
} from "@/components/manage-seat-modal";
```

2. Add this helper immediately after `normalizeSeatOrder`:

```tsx
function getSeatPlayerLabel(player: SeatOrderPlayer, index: number) {
  if (player.userId != null) {
    return player.displayName ?? `Player ${index + 1}`;
  }

  return player.displayName != null
    ? `${player.displayName} (Resigned)`
    : "[Open]";
}
```

3. In `SortableSeatRowProps`, remove `isSelectedForManagement` and `requiresSavedClearBeforeRemove`. Change the management callback to:

```tsx
  onSelectForManagement: (
    seatEntryId: string,
    trigger: HTMLButtonElement,
  ) => void;
```

4. Remove those two properties from `SortableSeatRow`’s destructuring. Replace the local `playerLabel` expression and `showSeatActions` expression with:

```tsx
  const playerLabel = getSeatPlayerLabel(player, index);
  const showSeatActions = isEditing && !isConfiguration;
```

5. Replace the configuration management button with:

```tsx
          {isConfiguration ? (
            <Button
              data-no-drag="true"
              type="button"
              variant="secondary"
              onClick={(event) => {
                onSelectForManagement(player.id, event.currentTarget);
              }}
            >
              Manage seat {index + 1}
            </Button>
          ) : null}
```

6. Delete the configuration-only `requiresSavedClearBeforeRemove` text block at the end of the row action group. Card presentation retains its current inline action buttons.

- [ ] **Step 4: Derive and render the selected draft seat**

In `SeatOrderEditor`, add these refs after `selectedSeatEntryId` state:

```tsx
  const managementTriggerRef = useRef<HTMLButtonElement | null>(null);
```

Add this opener near the other event handlers:

```tsx
  function openSeatManagement(
    seatEntryId: string,
    trigger: HTMLButtonElement,
  ) {
    managementTriggerRef.current = trigger;
    setSelectedSeatEntryId(seatEntryId);
    setPendingSeatAction(null);
    setErrorMessage(null);
    setConfirmation(null);
  }
```

After `const visiblePlayers = isEditing ? workingPlayers : players;`, derive the modal model:

```tsx
  const selectedSeatIndex = workingPlayers.findIndex(
    (player) => player.id === selectedSeatEntryId,
  );
  const selectedSeat =
    selectedSeatIndex >= 0 ? workingPlayers[selectedSeatIndex] : null;
  const occupiedSeatCount = workingPlayers.filter(
    (player) => player.userId != null,
  ).length;
  const managedSeat: ManageSeatModalSeat | null =
    isConfiguration &&
    isEditing &&
    !pendingSeatAction &&
    selectedSeat != null
      ? {
          id: selectedSeat.id,
          seatNumber: selectedSeatIndex + 1,
          playerLabel: getSeatPlayerLabel(selectedSeat, selectedSeatIndex),
          isActive: selectedSeat.id === workingActivePlayerEntryId,
          isEmpty: selectedSeat.userId == null,
          canClear: selectedSeat.userId != null && occupiedSeatCount > 1,
          canRemove:
            selectedSeat.userId == null &&
            players.find((player) => player.id === selectedSeat.id)?.userId ==
              null,
          requiresSavedClearBeforeRemove:
            selectedSeat.userId == null &&
            players.find((player) => player.id === selectedSeat.id)?.userId !=
              null,
        }
      : null;
```

Add the modal before `TerminalActionConfirmationDialog` in `overlays`:

```tsx
      <ManageSeatModal
        isPending={isMutating}
        seat={managedSeat}
        onClear={() => {
          if (selectedSeatIndex >= 0) {
            clearPlayerFromSeat(selectedSeatIndex);
          }
        }}
        onClose={() => {
          setSelectedSeatEntryId(null);
        }}
        onMakeActive={() => {
          if (selectedSeatIndex >= 0) {
            makeSeatActive(selectedSeatIndex);
            setSelectedSeatEntryId(null);
          }
        }}
        onRemove={() => {
          if (selectedSeatIndex >= 0) {
            removeSeatFromGame(selectedSeatIndex);
          }
        }}
      />
```

Pass `openSeatManagement` to each row and remove the deleted row props:

```tsx
              onSelectForManagement={openSeatManagement}
```

- [ ] **Step 5: Run modal and editor tests**

Run:

```bash
pnpm --filter @shadow-cloud/web test -- src/components/manage-seat-modal.test.tsx src/components/seat-order-editor.test.tsx
```

Expected: the new modal tests and opening/keyboard tests PASS. Existing tests that still expect `Active seat`, `aria-current`, or inline configuration selection may FAIL and will be updated in Task 3.

Continue directly to Phase B without committing the intentionally incomplete integration state.

#### Phase B: Complete Action Transitions and Focus Restoration

**Files:**
- Modify: `apps/web/src/components/seat-order-editor.test.tsx:246-340,389-425,490-520`
- Modify: `apps/web/src/components/seat-order-editor.tsx:393-430,545-675,786-874`

- [ ] **Step 1: Update eligibility and destructive-transition tests**

Replace `preserves active, empty, and last-occupied eligibility rules` with:

```tsx
  it("explains active, empty, last-occupied, and unsaved-clear rules", async () => {
    const user = userEvent.setup();
    const { rerender } = renderEditor();

    await user.click(screen.getByRole("button", { name: "Manage seat 1" }));
    let dialog = screen.getByRole("dialog", { name: "Manage seat 1" });
    expect(within(dialog).getByRole("button", { name: "Make active" })).toBeDisabled();
    expect(within(dialog).getByText("This seat is already active.")).toBeVisible();
    expect(within(dialog).getByRole("button", { name: "Remove seat" })).toBeDisabled();
    expect(within(dialog).getByText("Only empty seats can be removed.")).toBeVisible();

    await user.click(within(dialog).getByRole("button", { name: "Close" }));
    await user.click(screen.getByRole("button", { name: "Manage seat 3" }));
    dialog = screen.getByRole("dialog", { name: "Manage seat 3" });
    expect(within(dialog).getByRole("button", { name: "Make active" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Clear seat" })).toBeDisabled();
    expect(within(dialog).getByRole("button", { name: "Remove seat" })).toBeEnabled();

    await user.click(within(dialog).getByRole("button", { name: "Close" }));
    rerender(
      <SeatOrderEditor
        activePlayerEntryId="seat-1"
        canEdit
        gameNumber={42}
        players={[players[0]!, players[2]!]}
        presentation="configuration"
      />,
    );
    await user.click(screen.getByRole("button", { name: "Manage seat 1" }));
    dialog = screen.getByRole("dialog", { name: "Manage seat 1" });
    expect(within(dialog).getByRole("button", { name: "Clear seat" })).toBeDisabled();
    expect(
      within(dialog).getByText("At least one occupied seat must remain."),
    ).toBeVisible();
  });
```

Replace `retains selection when confirmation is cancelled and clears it after clear or remove` with:

```tsx
  it("transitions to destructive confirmation without stacking overlays", async () => {
    const user = userEvent.setup();
    const onDirtyChange = vi.fn();
    renderEditor({ onDirtyChange });

    await user.click(screen.getByRole("button", { name: "Manage seat 2" }));
    await user.click(
      within(screen.getByRole("dialog", { name: "Manage seat 2" })).getByRole(
        "button",
        { name: "Clear seat" },
      ),
    );

    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByRole("dialog", { name: "Confirm seat change" })).toBeVisible();
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }),
    );
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.getByRole("dialog", { name: "Manage seat 2" })).toBeVisible();

    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Clear seat",
      }),
    );
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Confirm",
      }),
    );
    expect(screen.queryByRole("dialog", { name: /manage seat/i })).toBeNull();
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(true));

    await user.click(screen.getByRole("button", { name: "Manage seat 2" }));
    expect(
      within(screen.getByRole("dialog")).getByText(
        "Save the cleared seat before removing it.",
      ),
    ).toBeVisible();
  });
```

Add this draft-index test immediately after it:

```tsx
  it("uses the reordered draft index in the modal title and copy", async () => {
    const user = userEvent.setup();
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        const seatMatch = this.textContent?.match(/Seat (\d)/);
        const seatIndex = Number(seatMatch?.[1] ?? 1) - 1;
        const top = seatIndex * 100;

        return {
          bottom: top + 80,
          height: 80,
          left: 0,
          right: 600,
          top,
          width: 600,
          x: 0,
          y: top,
          toJSON: () => ({}),
        };
      },
    );
    renderEditor();
    const firstHandle = screen.getByRole("button", { name: "Move seat 1" });

    firstHandle.focus();
    await user.keyboard(" ");
    await user.keyboard("{ArrowDown}");
    await user.keyboard(" ");
    await user.click(screen.getByRole("button", { name: "Manage seat 1" }));

    const dialog = screen.getByRole("dialog", { name: "Manage seat 1" });
    expect(within(dialog).getByText("Rhea")).toBeVisible();
    expect(
      within(dialog).getByText("Set seat 1 as the current turn."),
    ).toBeVisible();
  });
```

Add this focus test after the draft-index test:

```tsx
  it("restores focus to the trigger or Save order after the trigger is removed", async () => {
    const user = userEvent.setup();
    renderEditor();
    const manageSeat2 = screen.getByRole("button", { name: "Manage seat 2" });

    await user.click(manageSeat2);
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Close" }),
    );
    await waitFor(() => expect(manageSeat2).toHaveFocus());

    await user.click(screen.getByRole("button", { name: "Manage seat 3" }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Remove seat",
      }),
    );
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Confirm",
      }),
    );

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Save order" })).toHaveFocus(),
    );
    expect(screen.queryByRole("button", { name: "Manage seat 3" })).toBeNull();
  });
```

- [ ] **Step 2: Update assertions that depended on inline selected state**

Make these exact assertion changes in `apps/web/src/components/seat-order-editor.test.tsx`:

1. In `reports active changes dirty and Cancel resets the draft and selection`, replace the final `aria-current` assertion with:

```tsx
    expect(screen.queryByRole("dialog", { name: /manage seat/i })).toBeNull();
```

2. In `keeps dirty drafts across prop updates and cancels to the latest props`, replace each configuration-modal assertion for `Active seat` with:

```tsx
    expect(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Make active",
      }),
    ).toBeDisabled();
    expect(
      within(screen.getByRole("dialog")).getByText(
        "This seat is already active.",
      ),
    ).toBeVisible();
```

Close the first modal before clicking another management trigger:

```tsx
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", { name: "Close" }),
    );
```

3. Wherever a test initiates `Clear seat` or `Remove seat` after opening management, scope the action to the management dialog with `within(screen.getByRole("dialog", { name: /Manage seat/ }))`. Once destructive confirmation opens, continue scoping `Cancel` and `Confirm` to the only current dialog.

4. Add this permission-loss regression test:

```tsx
  it("closes management and removes configuration controls when permission is lost", async () => {
    const user = userEvent.setup();
    const onDirtyChange = vi.fn();
    const { rerender } = renderEditor({ onDirtyChange });

    await user.click(screen.getByRole("button", { name: "Manage seat 2" }));
    expect(screen.getByRole("dialog", { name: "Manage seat 2" })).toBeVisible();

    rerender(
      <SeatOrderEditor
        activePlayerEntryId="seat-1"
        canEdit={false}
        gameNumber={42}
        onDirtyChange={onDirtyChange}
        players={players}
        presentation="configuration"
      />,
    );

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("button", { name: /manage seat/i })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save order" })).toBeNull();
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));
  });
```

- [ ] **Step 3: Run the tests and observe missing focus restoration**

Run:

```bash
pnpm --filter @shadow-cloud/web test -- src/components/seat-order-editor.test.tsx
```

Expected: transition and business-rule assertions PASS; focus restoration FAILS because closing or removing a seat does not yet select a stable focus target.

- [ ] **Step 4: Add editor-owned focus coordination**

In `SeatOrderEditor`, add two refs next to `managementTriggerRef`:

```tsx
  const saveOrderButtonRef = useRef<HTMLButtonElement | null>(null);
  const pendingFocusTargetRef = useRef<HTMLElement | null>(null);
```

Add this effect after the existing dirty-state reporting effect:

```tsx
  useEffect(() => {
    const focusTarget = pendingFocusTargetRef.current;

    if (focusTarget && document.contains(focusTarget)) {
      focusTarget.focus();
    }

    pendingFocusTargetRef.current = null;
  });
```

Add this effect to clear stale management state after permission or presentation loss:

```tsx
  useEffect(() => {
    if (!canEdit || !isConfiguration) {
      // Permission or presentation changes invalidate overlay-only state.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedSeatEntryId(null);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPendingSeatAction(null);
    }
  }, [canEdit, isConfiguration]);
```

Replace the modal `onClose` and `onMakeActive` callbacks with:

```tsx
        onClose={() => {
          pendingFocusTargetRef.current = managementTriggerRef.current;
          setSelectedSeatEntryId(null);
        }}
        onMakeActive={() => {
          if (selectedSeatIndex >= 0) {
            makeSeatActive(selectedSeatIndex);
            pendingFocusTargetRef.current = managementTriggerRef.current;
            setSelectedSeatEntryId(null);
          }
        }}
```

In `applyClearPlayerFromSeat`, immediately before `setSelectedSeatEntryId(null)`, add:

```tsx
    pendingFocusTargetRef.current = managementTriggerRef.current;
```

In `applyRemoveSeatFromGame`, immediately before `setSelectedSeatEntryId(null)`, add:

```tsx
    pendingFocusTargetRef.current = saveOrderButtonRef.current;
```

Attach the ref to the configuration `Save order` button:

```tsx
            <Button
              ref={saveOrderButtonRef}
              disabled={isMutating}
              type="button"
              onClick={saveSeatOrder}
            >
              {isPending ? "Saving..." : "Save order"}
            </Button>
```

When `openSeatManagement` runs, clear any stale focus request before recording the trigger:

```tsx
    pendingFocusTargetRef.current = null;
    managementTriggerRef.current = trigger;
```

- [ ] **Step 5: Run the focused modal and editor tests**

Run:

```bash
pnpm --filter @shadow-cloud/web test -- src/components/manage-seat-modal.test.tsx src/components/seat-order-editor.test.tsx
```

Expected: PASS with all modal and editor tests passing.

- [ ] **Step 6: Commit transition and focus behavior**

```bash
git add apps/web/src/components/seat-order-editor.tsx apps/web/src/components/seat-order-editor.test.tsx
git commit -m "fix(web): preserve seat modal action flow"
```

### Task 3: Verify Regressions, Types, and Responsive Behavior

**Files:**
- Verify: `apps/web/src/components/manage-seat-modal.tsx`
- Verify: `apps/web/src/components/seat-order-editor.tsx`
- Verify: `apps/web/src/components/manage-seat-modal.test.tsx`
- Verify: `apps/web/src/components/seat-order-editor.test.tsx`
- Verify: `apps/web/src/components/campaign-configuration-shell.test.tsx`

- [ ] **Step 1: Run the focused configuration suite**

Run:

```bash
pnpm --filter @shadow-cloud/web test -- src/components/manage-seat-modal.test.tsx src/components/seat-order-editor.test.tsx src/components/campaign-configuration-shell.test.tsx
```

Expected: PASS. The seat modal, seat draft behavior, and configuration shell tests all pass.

- [ ] **Step 2: Run web type checking**

Run:

```bash
pnpm --filter @shadow-cloud/web typecheck
```

Expected: PASS with no TypeScript errors.

- [ ] **Step 3: Run web lint**

Run:

```bash
pnpm --filter @shadow-cloud/web lint
```

Expected: PASS with no ESLint errors or warnings introduced by the modal.

- [ ] **Step 4: Run the complete web test suite**

Run:

```bash
pnpm --filter @shadow-cloud/web test
```

Expected: PASS with every web test file passing.

- [ ] **Step 5: Perform browser verification at desktop and mobile widths**

Start the web app in a background terminal:

```bash
pnpm --filter @shadow-cloud/web dev
```

Open a campaign configuration page with editable seat order and verify at 1280×800 and 375×667:

1. `Manage seat N` opens one centered modal for the correct draft seat.
2. The modal shows only `Manage seat N`, the player name or `[Open]`, action headings, action descriptions, and controls; it contains no status pills, chips, badges, or tags.
3. Long player names and action descriptions wrap without horizontal scrolling.
4. The modal body remains scrollable within the viewport at mobile height.
5. Tab and Shift+Tab stay within the modal; Escape and backdrop click close it.
6. Normal close and `Make active` restore focus to the original trigger.
7. Clear/remove confirmation replaces the management modal rather than stacking over it.
8. Cancelling confirmation reopens the same management modal.
9. Confirming empty-seat removal returns focus to `Save order`.
10. Drag handles and card-presentation inline editing still work after the modal is closed.

Expected: all ten checks pass at both viewport sizes with no console errors.

- [ ] **Step 6: Commit any verification-only corrections**

If browser or automated verification required a correction, stage only the four feature files and commit:

```bash
git add apps/web/src/components/manage-seat-modal.tsx apps/web/src/components/manage-seat-modal.test.tsx apps/web/src/components/seat-order-editor.tsx apps/web/src/components/seat-order-editor.test.tsx
git commit -m "fix(web): polish manage seat modal"
```

If no correction was required, do not create an empty commit.

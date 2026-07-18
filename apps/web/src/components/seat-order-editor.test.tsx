// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ComponentProps } from "react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SeatOrderEditor } from "@/components/seat-order-editor";

const router = { refresh: vi.fn() };

vi.mock("next/navigation", () => ({
  useRouter: () => router,
}));

vi.mock("@/components/terminal-confirmation-modal", () => ({
  TerminalConfirmationModal: ({ confirmation }: { confirmation: unknown }) =>
    confirmation ? <div data-testid="save-confirmation" /> : null,
}));

const players = [
  {
    id: "seat-1",
    userId: "player-1",
    displayName: "Overlord",
    turnOrder: 1,
    isOrganizer: true,
  },
  {
    id: "seat-2",
    userId: "player-2",
    displayName: "Rhea",
    turnOrder: 2,
    isOrganizer: false,
  },
  {
    id: "seat-3",
    userId: null,
    displayName: null,
    turnOrder: 3,
    isOrganizer: false,
  },
];

function renderEditor(
  overrides: Partial<ComponentProps<typeof SeatOrderEditor>> = {},
) {
  return render(
    <SeatOrderEditor
      activePlayerEntryId="seat-1"
      canEdit
      gameNumber={42}
      players={players}
      presentation="configuration"
      {...overrides}
    />,
  );
}

describe("SeatOrderEditor", () => {
  beforeEach(() => {
    router.refresh.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

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
    expect(
      within(occupiedDialog).getByRole("button", { name: "Make active" }),
    ).toBeVisible();
    expect(
      within(occupiedDialog).getByRole("button", { name: "Clear seat" }),
    ).toBeVisible();
    expect(
      within(occupiedDialog).getByRole("button", { name: "Remove seat" }),
    ).toBeVisible();
    expect(within(occupiedDialog).queryByText("Occupied")).toBeNull();
    expect(within(occupiedDialog).queryByText("Not active")).toBeNull();

    await user.click(
      within(occupiedDialog).getByRole("button", { name: "Close" }),
    );
    await user.click(screen.getByRole("button", { name: "Manage seat 3" }));

    const openDialog = screen.getByRole("dialog", { name: "Manage seat 3" });
    expect(within(openDialog).getByText("[Open]")).toBeVisible();
    expect(
      within(openDialog).queryByText("Open", { exact: true }),
    ).toBeNull();
  });

  it("renders an icon-only move control as the rightmost seat button", async () => {
    const user = userEvent.setup();
    renderEditor();

    await user.click(screen.getByRole("button", { name: "Manage seat 2" }));

    const moveButton = screen.getByRole("button", { name: "Move seat 2" });
    const actionGroup = moveButton.parentElement;
    const moveIcon = moveButton.querySelector("svg");

    expect(actionGroup).not.toBeNull();
    expect(moveButton).not.toHaveTextContent("Move");
    expect(moveIcon).toHaveAttribute("aria-hidden", "true");
    expect(within(actionGroup!).getAllByRole("button").at(-1)).toBe(moveButton);
  });

  it("preserves card presentation and renders configuration without card chrome", () => {
    const { rerender } = render(
      <SeatOrderEditor
        activePlayerEntryId="seat-1"
        canEdit
        gameNumber={42}
        players={players}
      />,
    );

    expect(screen.getByRole("heading", { name: "Seat order:" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Edit" })).toBeVisible();

    rerender(
      <SeatOrderEditor
        activePlayerEntryId="seat-1"
        canEdit
        gameNumber={42}
        players={players}
        presentation="configuration"
      />,
    );

    expect(screen.queryByRole("heading", { name: "Seat order:" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    expect(screen.getByRole("button", { name: "Manage seat 1" })).toBeVisible();
    expect(screen.getByTestId("seat-order-configuration")).toHaveClass(
      "min-w-0",
    );
    expect(
      screen
        .getByTestId("seat-order-configuration")
        .querySelector("[data-slot='card']"),
    ).toBeNull();
  });

  it("renders configuration read-only when editing is not allowed", () => {
    renderEditor({ canEdit: false });

    expect(screen.getByText("Overlord")).toBeVisible();
    expect(screen.queryByRole("button", { name: /manage seat/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /save order/i })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
  });

  it("preserves the default card editing flow", async () => {
    const user = userEvent.setup();
    render(
      <SeatOrderEditor
        activePlayerEntryId="seat-1"
        canEdit
        gameNumber={42}
        players={players}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Edit" }));

    expect(screen.getByRole("button", { name: "Cancel" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Save order" })).toBeVisible();
    expect(screen.getAllByRole("button", { name: "Clear seat" })).toHaveLength(
      3,
    );
    expect(screen.getAllByRole("button", { name: "Remove seat" })).toHaveLength(
      3,
    );
  });

  it("keeps a dirty configuration draft editable when presentation changes to card", async () => {
    const user = userEvent.setup();
    const { rerender } = renderEditor();

    await user.click(screen.getByRole("button", { name: "Manage seat 2" }));
    await user.click(screen.getByRole("button", { name: "Make active" }));
    rerender(
      <SeatOrderEditor
        activePlayerEntryId="seat-1"
        canEdit
        gameNumber={42}
        players={players}
        presentation="card"
      />,
    );

    expect(screen.getByRole("button", { name: "Save order" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Active seat" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  });

  it("removes editing controls and clears reported dirty state when permission is lost", async () => {
    const user = userEvent.setup();
    const onDirtyChange = vi.fn();
    const { rerender } = render(
      <SeatOrderEditor
        activePlayerEntryId="seat-1"
        canEdit
        gameNumber={42}
        onDirtyChange={onDirtyChange}
        players={players}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.click(
      screen.getAllByRole("button", { name: "Make active" })[0]!,
    );
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(true));
    rerender(
      <SeatOrderEditor
        activePlayerEntryId="seat-1"
        canEdit={false}
        gameNumber={42}
        onDirtyChange={onDirtyChange}
        players={players}
      />,
    );

    expect(screen.queryByRole("button", { name: /^Move seat/i })).toBeNull();
    expect(screen.queryByRole("button", { name: "Clear seat" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove seat" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save order" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));
  });

  it("closes management and removes configuration controls when permission is lost", async () => {
    const user = userEvent.setup();
    const onDirtyChange = vi.fn();
    const { rerender } = renderEditor({ onDirtyChange });

    await user.click(screen.getByRole("button", { name: "Manage seat 2" }));
    expect(
      screen.getByRole("dialog", { name: "Manage seat 2" }),
    ).toBeVisible();

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

  it("explains active, empty, last-occupied, and unsaved-clear rules", async () => {
    const user = userEvent.setup();
    const { rerender } = renderEditor();

    await user.click(screen.getByRole("button", { name: "Manage seat 1" }));
    let dialog = screen.getByRole("dialog", { name: "Manage seat 1" });
    expect(
      within(dialog).getByRole("button", { name: "Make active" }),
    ).toBeDisabled();
    expect(
      within(dialog).getByText("This seat is already active."),
    ).toBeVisible();
    expect(
      within(dialog).getByRole("button", { name: "Remove seat" }),
    ).toBeDisabled();
    expect(
      within(dialog).getByText("Only empty seats can be removed."),
    ).toBeVisible();

    await user.click(within(dialog).getByRole("button", { name: "Close" }));
    await user.click(screen.getByRole("button", { name: "Manage seat 3" }));
    dialog = screen.getByRole("dialog", { name: "Manage seat 3" });
    expect(
      within(dialog).getByRole("button", { name: "Make active" }),
    ).toBeDisabled();
    expect(
      within(dialog).getByRole("button", { name: "Clear seat" }),
    ).toBeDisabled();
    expect(
      within(dialog).getByRole("button", { name: "Remove seat" }),
    ).toBeEnabled();

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
    expect(
      within(dialog).getByRole("button", { name: "Clear seat" }),
    ).toBeDisabled();
    expect(
      within(dialog).getByText("At least one occupied seat must remain."),
    ).toBeVisible();
  });

  it("transitions to destructive confirmation without stacking overlays", async () => {
    const user = userEvent.setup();
    const onDirtyChange = vi.fn();
    renderEditor({ onDirtyChange });

    await user.click(screen.getByRole("button", { name: "Manage seat 2" }));
    await user.click(
      within(
        screen.getByRole("dialog", { name: "Manage seat 2" }),
      ).getByRole("button", { name: "Clear seat" }),
    );

    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    const confirmationDialog = screen.getByRole("dialog", {
      name: "Confirm seat change",
    });
    expect(confirmationDialog).toBeVisible();
    await waitFor(() =>
      expect(
        within(confirmationDialog).getByRole("button", { name: "Cancel" }),
      ).toHaveFocus(),
    );
    await user.click(
      within(confirmationDialog).getByRole("button", {
        name: "Cancel",
      }),
    );
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(
      screen.getByRole("dialog", { name: "Manage seat 2" }),
    ).toBeVisible();

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

  it("restores focus to the trigger or Save order after the trigger is removed", async () => {
    const user = userEvent.setup();
    renderEditor();
    const manageSeat2 = screen.getByRole("button", { name: "Manage seat 2" });

    await user.click(manageSeat2);
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Close",
      }),
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

  it("reports active changes dirty and Cancel resets the draft and selection", async () => {
    const user = userEvent.setup();
    const onDirtyChange = vi.fn();
    renderEditor({ onDirtyChange });

    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));
    await user.click(screen.getByRole("button", { name: "Manage seat 2" }));
    await user.click(screen.getByRole("button", { name: "Make active" }));
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(true));
    expect(screen.getByText("Seat 2 · Active")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));
    expect(screen.queryByRole("button", { name: "Active seat" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Manage seat 1" }),
    ).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("button", { name: "Save order" })).toBeVisible();
  });

  it("reports removing a seat from a clean draft as dirty", async () => {
    const user = userEvent.setup();
    const onDirtyChange = vi.fn();
    renderEditor({ onDirtyChange });

    await user.click(screen.getByRole("button", { name: "Manage seat 3" }));
    await user.click(screen.getByRole("button", { name: "Remove seat" }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Confirm",
      }),
    );

    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(true));
  });

  it("reorders with the keyboard sensor and reports the draft dirty", async () => {
    const user = userEvent.setup();
    const onDirtyChange = vi.fn();
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
    renderEditor({ onDirtyChange });
    const firstRow = screen.getByText("Overlord").parentElement?.parentElement;
    const firstHandle = screen.getByRole("button", { name: "Move seat 1" });

    expect(firstRow).not.toBeNull();
    expect(firstRow).not.toHaveAttribute("role");
    expect(firstHandle).toHaveAttribute("tabindex", "0");
    firstHandle.focus();
    await user.keyboard(" ");
    await user.keyboard("{ArrowDown}");
    await user.keyboard(" ");

    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(true));
    expect(
      screen.getAllByText(/Seat \d/).map((node) => node.textContent),
    ).toEqual(["Seat 1", "Seat 2 · Overlord · Active", "Seat 3"]);

    await user.click(screen.getByRole("button", { name: "Manage seat 1" }));
    const dialog = screen.getByRole("dialog", { name: "Manage seat 1" });
    expect(within(dialog).getByText("Rhea")).toBeVisible();
    expect(
      within(dialog).getByText("Set seat 1 as the current turn."),
    ).toBeVisible();
  });

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

  it("prevents management from opening while a save is pending", async () => {
    const user = userEvent.setup();
    let resolveRequest!: (response: Response) => void;
    vi.spyOn(globalThis, "fetch").mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveRequest = resolve;
        }),
    );
    renderEditor();

    await user.click(screen.getByRole("button", { name: "Manage seat 2" }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Make active",
      }),
    );
    await user.click(screen.getByRole("button", { name: "Save order" }));

    const manageSeat1 = screen.getByRole("button", { name: "Manage seat 1" });
    expect(manageSeat1).toBeDisabled();
    await user.click(manageSeat1);
    expect(screen.queryByRole("dialog", { name: /manage seat/i })).toBeNull();

    resolveRequest(new Response(null, { status: 204 }));
    await waitFor(() => expect(router.refresh).toHaveBeenCalledOnce());
  });

  it("posts the exact changed seat payload and clears dirty state on success", async () => {
    const user = userEvent.setup();
    const onDirtyChange = vi.fn();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 204 }));
    router.refresh.mockImplementation(() => {
      expect(onDirtyChange).toHaveBeenLastCalledWith(false);
    });
    renderEditor({ onDirtyChange });

    await user.click(screen.getByRole("button", { name: "Manage seat 2" }));
    await user.click(screen.getByRole("button", { name: "Make active" }));
    await user.click(screen.getByRole("button", { name: "Save order" }));

    await waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith("/api/games/42/seat-order", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          seatEntryIds: ["seat-1", "seat-2", "seat-3"],
          clearedSeatEntryIds: [],
          removedSeatEntryIds: [],
          activePlayerEntryId: "seat-2",
        }),
      }),
    );
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));
    expect(screen.getByTestId("save-confirmation")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Active seat" })).toBeNull();
    expect(router.refresh).toHaveBeenCalledOnce();
  });

  it("posts cleared and removed seat arrays from the original props", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 204 }));
    renderEditor();

    await user.click(screen.getByRole("button", { name: "Manage seat 2" }));
    await user.click(screen.getByRole("button", { name: "Clear seat" }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Confirm",
      }),
    );
    await user.click(screen.getByRole("button", { name: "Manage seat 2" }));
    expect(screen.getByRole("button", { name: "Remove seat" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Manage seat 3" }));
    await user.click(screen.getByRole("button", { name: "Remove seat" }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Confirm",
      }),
    );
    await user.click(screen.getByRole("button", { name: "Save order" }));

    await waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/games/42/seat-order",
        expect.objectContaining({
          body: JSON.stringify({
            seatEntryIds: ["seat-1", "seat-2"],
            clearedSeatEntryIds: ["seat-2"],
            removedSeatEntryIds: ["seat-3"],
            activePlayerEntryId: "seat-1",
          }),
        }),
      ),
    );
    const requestBody = JSON.parse(
      String((fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined)?.body),
    ) as {
      clearedSeatEntryIds: string[];
      removedSeatEntryIds: string[];
    };
    expect(
      requestBody.clearedSeatEntryIds.filter((id) =>
        requestBody.removedSeatEntryIds.includes(id),
      ),
    ).toEqual([]);
  });

  it("keeps dirty drafts across prop updates and cancels to the latest props", async () => {
    const user = userEvent.setup();
    const latestPlayers = players.map((player) =>
      player.id === "seat-1"
        ? { ...player, displayName: "Renamed Overlord" }
        : player,
    );
    const { rerender } = renderEditor();

    await user.click(screen.getByRole("button", { name: "Manage seat 2" }));
    await user.click(screen.getByRole("button", { name: "Make active" }));
    rerender(
      <SeatOrderEditor
        activePlayerEntryId="seat-1"
        canEdit
        gameNumber={42}
        players={latestPlayers}
        presentation="configuration"
      />,
    );

    await user.click(screen.getByRole("button", { name: "Manage seat 2" }));
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
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Close",
      }),
    );
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("Renamed Overlord")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Manage seat 1" }));
    expect(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Make active",
      }),
    ).toBeDisabled();
  });

  it("keeps a failed save inline and dirty", async () => {
    const user = userEvent.setup();
    const onDirtyChange = vi.fn();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: "Seat order rejected." }), {
        status: 400,
      }),
    );
    renderEditor({ onDirtyChange });

    await user.click(screen.getByRole("button", { name: "Manage seat 2" }));
    await user.click(screen.getByRole("button", { name: "Make active" }));
    await user.click(screen.getByRole("button", { name: "Save order" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Seat order rejected.",
    );
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    expect(router.refresh).not.toHaveBeenCalled();
  });

  it("keeps a rejected save inline and dirty without an unhandled rejection", async () => {
    const user = userEvent.setup();
    const onDirtyChange = vi.fn();
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("offline"));
    renderEditor({ onDirtyChange });

    await user.click(screen.getByRole("button", { name: "Manage seat 2" }));
    await user.click(screen.getByRole("button", { name: "Make active" }));
    await user.click(screen.getByRole("button", { name: "Save order" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "The seat order update failed.",
    );
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    expect(router.refresh).not.toHaveBeenCalled();
  });
});

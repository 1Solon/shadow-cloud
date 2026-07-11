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

  it("focuses configuration management actions on one selected seat", async () => {
    const user = userEvent.setup();
    renderEditor();

    expect(screen.queryByRole("button", { name: "Clear seat" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove seat" })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Manage seat 2" }));

    expect(
      screen.getByRole("button", { name: "Manage seat 2" }),
    ).toHaveAttribute("aria-current", "true");
    expect(screen.getAllByRole("button", { name: "Make active" })).toHaveLength(
      1,
    );
    expect(screen.getAllByRole("button", { name: "Clear seat" })).toHaveLength(
      1,
    );
    expect(screen.getAllByRole("button", { name: "Remove seat" })).toHaveLength(
      1,
    );

    await user.click(screen.getByRole("button", { name: "Manage seat 3" }));

    expect(
      screen.getByRole("button", { name: "Manage seat 3" }),
    ).toHaveAttribute("aria-current", "true");
    expect(
      screen.getByRole("button", { name: "Manage seat 2" }),
    ).not.toHaveAttribute("aria-current");
    expect(screen.getAllByRole("button", { name: "Remove seat" })).toHaveLength(
      1,
    );
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

  it("preserves active, empty, and last-occupied eligibility rules", async () => {
    const user = userEvent.setup();
    const { rerender } = renderEditor();

    await user.click(screen.getByRole("button", { name: "Manage seat 1" }));
    expect(screen.getByRole("button", { name: "Active seat" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Manage seat 3" }));
    expect(screen.getByRole("button", { name: "Make active" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Clear seat" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Remove seat" })).toBeEnabled();

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
    expect(screen.getByRole("button", { name: "Clear seat" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Remove seat" })).toBeDisabled();
  });

  it("retains selection when confirmation is cancelled and clears it after clear or remove", async () => {
    const user = userEvent.setup();
    const onDirtyChange = vi.fn();
    renderEditor({ onDirtyChange });

    await user.click(screen.getByRole("button", { name: "Manage seat 2" }));
    await user.click(screen.getByRole("button", { name: "Clear seat" }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Cancel",
      }),
    );
    expect(
      screen.getByRole("button", { name: "Manage seat 2" }),
    ).toHaveAttribute("aria-current", "true");

    await user.click(screen.getByRole("button", { name: "Clear seat" }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Confirm",
      }),
    );
    expect(screen.queryByRole("button", { name: "Clear seat" })).toBeNull();
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(true));

    await user.click(screen.getByRole("button", { name: "Manage seat 3" }));
    await user.click(screen.getByRole("button", { name: "Remove seat" }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Confirm",
      }),
    );
    expect(screen.queryByRole("button", { name: "Clear seat" })).toBeNull();
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
    const firstRow = screen.getByText("Overlord").closest("[role='button']");

    expect(firstRow).not.toBeNull();
    (firstRow as HTMLElement).focus();
    await user.keyboard(" ");
    await user.keyboard("{ArrowDown}");
    await user.keyboard(" ");

    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(true));
    expect(
      screen.getAllByText(/Seat \d/).map((node) => node.textContent),
    ).toEqual(["Seat 1", "Seat 2 · Overlord", "Seat 3"]);
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
    expect(screen.getByRole("button", { name: "Active seat" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("Renamed Overlord")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Manage seat 1" }));
    expect(screen.getByRole("button", { name: "Active seat" })).toBeVisible();
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
});

// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import {
  act,
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
import type { SeatOrderSnapshot } from "@/lib/shadow-cloud-api";

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

const baseline = { campaignId: "campaign-1", revision: 7 };

function snapshot(
  overrides: Partial<SeatOrderSnapshot> = {},
): SeatOrderSnapshot {
  return {
    gameId: "campaign-1",
    slug: "campaign-42",
    name: "Campaign 42",
    organizerId: "player-1",
    players,
    activePlayerEntryId: "seat-1",
    activePlayerUserId: "player-1",
    roundNumber: 4,
    seatOrderBaseline: baseline,
    ...overrides,
  };
}

function renderEditor(
  overrides: Partial<ComponentProps<typeof SeatOrderEditor>> = {},
) {
  return render(
    <SeatOrderEditor
      activePlayerEntryId="seat-1"
      canEdit
      gameNumber={42}
      players={players}
      seatOrderBaseline={baseline}
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

  it("keeps the captured roster and baseline through background refresh and further edits", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        Response.json({ error: "Invalid intent" }, { status: 400 }),
      );
    const { rerender } = renderEditor();
    await user.click(screen.getByRole("button", { name: "Manage seat 2" }));
    await user.click(screen.getByRole("button", { name: "Make active" }));
    rerender(
      <SeatOrderEditor
        activePlayerEntryId="seat-1"
        canEdit
        gameNumber={42}
        players={[
          players[0]!,
          { ...players[1]!, userId: null, displayName: null },
          {
            ...players[2]!,
            userId: "replacement",
            displayName: "New occupant",
          },
          { ...players[2]!, id: "seat-4", turnOrder: 4 },
        ]}
        seatOrderBaseline={{ campaignId: "campaign-1", revision: 8 }}
        presentation="configuration"
      />,
    );
    expect(screen.getByText("Rhea")).toBeVisible();
    expect(screen.queryByText("New occupant")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Manage seat 2" }));
    await user.click(screen.getByRole("button", { name: "Clear seat" }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Confirm",
      }),
    );
    await user.click(screen.getByRole("button", { name: "Manage seat 3" }));
    expect(screen.getByRole("button", { name: "Remove seat" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Remove seat" }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Confirm",
      }),
    );
    await user.click(screen.getByRole("button", { name: "Save order" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Save order" })).toBeEnabled(),
    );
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/games/42/seat-order",
      expect.objectContaining({
        body: JSON.stringify({
          seatEntryIds: ["seat-1", "seat-2"],
          clearedSeatEntryIds: ["seat-2"],
          removedSeatEntryIds: ["seat-3"],
          activePlayerEntryId: "seat-1",
          baseline,
        }),
      }),
    );
  });

  it("retains the attempted stale draft and disables saves until an explicit reload succeeds", async () => {
    const user = userEvent.setup();
    const onDirtyChange = vi.fn();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        Response.json(
          { error: "The roster changed.", code: "STALE_SEAT_ORDER" },
          { status: 409 },
        ),
      )
      .mockRejectedValueOnce(new Error("offline"));
    const { rerender } = renderEditor({ onDirtyChange });
    await user.click(screen.getByRole("button", { name: "Manage seat 2" }));
    await user.click(screen.getByRole("button", { name: "Make active" }));
    await user.click(screen.getByRole("button", { name: "Save order" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      /draft.*discard.*load latest/i,
    );
    expect(screen.getByText("Seat 2 · Active")).toBeVisible();
    expect(
      await screen.findByRole("button", { name: "Save order" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
    const reload = screen.getByRole("button", {
      name: "Discard draft and load latest roster",
    });
    await waitFor(() => expect(reload).toHaveFocus());
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(router.refresh).not.toHaveBeenCalled();
    rerender(
      <SeatOrderEditor
        activePlayerEntryId="seat-1"
        canEdit
        gameNumber={42}
        players={players}
        seatOrderBaseline={{ campaignId: "campaign-1", revision: 8 }}
        presentation="configuration"
        onDirtyChange={onDirtyChange}
      />,
    );
    await user.click(reload);

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/load.*failed/i),
    );
    expect(screen.getByText("Seat 2 · Active")).toBeVisible();
    expect(
      await screen.findByRole("button", { name: "Save order" }),
    ).toBeDisabled();
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    expect(fetchSpy).toHaveBeenLastCalledWith("/api/games/42/seat-order", {
      method: "GET",
      cache: "no-store",
    });
  });

  it.each(["GET", "POST"])(
    "rejects a %s snapshot for another campaign without changing the mounted draft",
    async (method) => {
      const user = userEvent.setup();
      const onSnapshotAccepted = vi.fn();
      const onDirtyChange = vi.fn();
      const otherCampaign = snapshot({
        gameId: "campaign-B",
        seatOrderBaseline: { campaignId: "campaign-B", revision: 19 },
        players: [
          { ...players[0]!, id: "seat-B", displayName: "Other campaign lord" },
        ],
        activePlayerEntryId: "seat-B",
      });
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      if (method === "GET") {
        fetchSpy.mockResolvedValueOnce(
          Response.json({ code: "STALE_SEAT_ORDER" }, { status: 409 }),
        );
      }
      fetchSpy.mockResolvedValueOnce(
        Response.json(
          method === "GET" ? otherCampaign : { seatOrder: otherCampaign },
        ),
      );
      renderEditor({ onSnapshotAccepted, onDirtyChange });
      await user.click(screen.getByRole("button", { name: "Manage seat 2" }));
      await user.click(screen.getByRole("button", { name: "Make active" }));
      await user.click(screen.getByRole("button", { name: "Save order" }));
      if (method === "GET") {
        await waitFor(() =>
          expect(
            screen.getByRole("button", {
              name: "Discard draft and load latest roster",
            }),
          ).toBeEnabled(),
        );
        await user.click(
          screen.getByRole("button", {
            name: "Discard draft and load latest roster",
          }),
        );
      }

      expect(
        await screen.findByRole("button", { name: "Save order" }),
      ).toBeDisabled();
      expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
      expect(
        screen.getByRole("button", { name: "Manage seat 2" }),
      ).toBeDisabled();
      expect(
        screen.getByRole("button", { name: "Move seat 2" }),
      ).toBeDisabled();
      expect(screen.getByRole("alert")).toHaveTextContent(
        /different campaign.*original campaign.*campaign list/i,
      );
      expect(screen.getByText("Rhea")).toBeVisible();
      expect(screen.getByText("Seat 2 · Active")).toBeVisible();
      expect(screen.queryByText("Other campaign lord")).toBeNull();
      expect(screen.queryByTestId("save-confirmation")).toBeNull();
      expect(onSnapshotAccepted).not.toHaveBeenCalled();
      expect(onDirtyChange).toHaveBeenLastCalledWith(true);
      expect(router.refresh).not.toHaveBeenCalled();
      expect(
        JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body)),
      ).toMatchObject({
        baseline,
        seatEntryIds: ["seat-1", "seat-2", "seat-3"],
        activePlayerEntryId: "seat-2",
      });
      await user.click(screen.getByRole("button", { name: "Save order" }));
      expect(fetchSpy).toHaveBeenCalledTimes(method === "GET" ? 2 : 1);
    },
  );

  it("accepts reload and successful save snapshots coherently for subsequent edits despite older props", async () => {
    const user = userEvent.setup();
    const latest = snapshot({
      players: players.map((player) =>
        player.id === "seat-2"
          ? { ...player, userId: "player-new", displayName: "New lord" }
          : player,
      ),
      seatOrderBaseline: { campaignId: "campaign-1", revision: 9 },
    });
    const committed = snapshot({
      players: [
        players[0]!,
        { ...players[1]!, userId: null, displayName: null },
        players[2]!,
      ],
      seatOrderBaseline: { campaignId: "campaign-1", revision: 10 },
    });
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        Response.json(
          { error: "Stale", code: "STALE_SEAT_ORDER" },
          { status: 409 },
        ),
      )
      .mockResolvedValueOnce(Response.json(latest))
      .mockResolvedValueOnce(Response.json({ ok: true, seatOrder: committed }))
      .mockResolvedValueOnce(
        Response.json({ error: "Stop here" }, { status: 400 }),
      );
    const { rerender } = renderEditor();
    await user.click(screen.getByRole("button", { name: "Manage seat 2" }));
    await user.click(screen.getByRole("button", { name: "Make active" }));
    await user.click(screen.getByRole("button", { name: "Save order" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", {
          name: "Discard draft and load latest roster",
        }),
      ).toBeEnabled(),
    );
    await user.click(
      await screen.findByRole("button", {
        name: "Discard draft and load latest roster",
      }),
    );
    expect(await screen.findByText("New lord")).toBeVisible();
    expect(screen.queryByText("Rhea")).toBeNull();
    expect(screen.getByText("Seat 1 · Overlord · Active")).toBeVisible();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Save order" })).toHaveFocus(),
    );
    await user.click(screen.getByRole("button", { name: "Manage seat 2" }));
    await user.click(screen.getByRole("button", { name: "Clear seat" }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Confirm",
      }),
    );
    await user.click(screen.getByRole("button", { name: "Save order" }));
    expect(fetchSpy).toHaveBeenNthCalledWith(
      3,
      "/api/games/42/seat-order",
      expect.objectContaining({
        body: JSON.stringify({
          seatEntryIds: ["seat-1", "seat-2", "seat-3"],
          clearedSeatEntryIds: ["seat-2"],
          removedSeatEntryIds: [],
          activePlayerEntryId: "seat-1",
          baseline: { campaignId: "campaign-1", revision: 9 },
        }),
      }),
    );
    await screen.findByTestId("save-confirmation");
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Save order" })).toBeEnabled(),
    );
    rerender(
      <SeatOrderEditor
        activePlayerEntryId="seat-2"
        canEdit
        gameNumber={42}
        players={players}
        seatOrderBaseline={{ campaignId: "campaign-1", revision: 8 }}
        presentation="configuration"
      />,
    );
    await user.click(screen.getByRole("button", { name: "Manage seat 2" }));
    expect(screen.getByRole("button", { name: "Remove seat" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Remove seat" }));
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Confirm",
      }),
    );
    await user.click(screen.getByRole("button", { name: "Save order" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Save order" })).toBeEnabled(),
    );
    expect(fetchSpy).toHaveBeenNthCalledWith(
      4,
      "/api/games/42/seat-order",
      expect.objectContaining({
        body: JSON.stringify({
          seatEntryIds: ["seat-1", "seat-3"],
          clearedSeatEntryIds: [],
          removedSeatEntryIds: ["seat-2"],
          activePlayerEntryId: "seat-1",
          baseline: { campaignId: "campaign-1", revision: 10 },
        }),
      }),
    );
  });

  it.each(["save", "reload"])(
    "revokes local editing and refreshes permissions on a %s 403",
    async (operation) => {
      const user = userEvent.setup();
      const onDirtyChange = vi.fn();
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      if (operation === "reload")
        fetchSpy.mockResolvedValueOnce(
          Response.json({ code: "STALE_SEAT_ORDER" }, { status: 409 }),
        );
      fetchSpy.mockResolvedValueOnce(
        Response.json(
          { error: "Overlord authority required." },
          { status: 403 },
        ),
      );
      renderEditor({ onDirtyChange });
      await user.click(screen.getByRole("button", { name: "Manage seat 2" }));
      await user.click(screen.getByRole("button", { name: "Make active" }));
      await user.click(screen.getByRole("button", { name: "Save order" }));
      if (operation === "reload") {
        await waitFor(() =>
          expect(
            screen.getByRole("button", {
              name: "Discard draft and load latest roster",
            }),
          ).toBeEnabled(),
        );
        await user.click(
          await screen.findByRole("button", {
            name: "Discard draft and load latest roster",
          }),
        );
      }

      await waitFor(() => {
        expect(
          screen.queryByRole("button", { name: /save order|saving/i }),
        ).toBeNull();
        expect(
          screen.queryByRole("button", { name: /manage seat/i }),
        ).toBeNull();
        expect(screen.getByRole("alert")).toHaveTextContent(
          "Overlord authority required.",
        );
        expect(onDirtyChange).toHaveBeenLastCalledWith(false);
      });
      expect(router.refresh).toHaveBeenCalledOnce();
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Overlord authority required.",
      );
      expect(screen.queryByRole("button", { name: "Save order" })).toBeNull();
      expect(screen.queryByRole("button", { name: /manage seat/i })).toBeNull();
      expect(
        screen.queryByRole("button", {
          name: "Discard draft and load latest roster",
        }),
      ).toBeNull();
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(onDirtyChange).toHaveBeenLastCalledWith(false);
    },
  );

  it("discards a draft and closes destructive confirmation on permission loss", async () => {
    const user = userEvent.setup();
    const { rerender } = renderEditor();
    await user.click(screen.getByRole("button", { name: "Manage seat 2" }));
    await user.click(screen.getByRole("button", { name: "Make active" }));
    await user.click(screen.getByRole("button", { name: "Manage seat 2" }));
    await user.click(screen.getByRole("button", { name: "Clear seat" }));
    const props = {
      activePlayerEntryId: "seat-1",
      gameNumber: 42,
      players,
      seatOrderBaseline: baseline,
      presentation: "configuration" as const,
    };
    rerender(<SeatOrderEditor {...props} canEdit={false} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    rerender(<SeatOrderEditor {...props} canEdit />);
    expect(screen.getByText("Seat 1 · Overlord · Active")).toBeVisible();
    expect(screen.queryByText("Seat 2 · Active")).toBeNull();
  });

  it("does not restore a pending save's draft or confirmation after permission is lost", async () => {
    const user = userEvent.setup();
    let resolveRequest!: (response: Response) => void;
    vi.spyOn(globalThis, "fetch").mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRequest = resolve;
        }),
    );
    const { rerender } = renderEditor();
    await user.click(screen.getByRole("button", { name: "Manage seat 2" }));
    await user.click(screen.getByRole("button", { name: "Make active" }));
    await user.click(screen.getByRole("button", { name: "Save order" }));
    rerender(
      <SeatOrderEditor
        activePlayerEntryId="seat-1"
        canEdit={false}
        gameNumber={42}
        players={players}
        seatOrderBaseline={baseline}
        presentation="configuration"
      />,
    );
    await act(async () =>
      resolveRequest(
        Response.json({
          seatOrder: snapshot({
            activePlayerEntryId: "seat-2",
            seatOrderBaseline: { campaignId: "campaign-1", revision: 8 },
          }),
        }),
      ),
    );
    expect(screen.queryByTestId("save-confirmation")).toBeNull();
    expect(screen.queryByRole("button", { name: "Save order" })).toBeNull();
    expect(screen.getByText("Seat 1 · Overlord · Active")).toBeVisible();
  });

  it("does not accept a successful response without a coherent roster and baseline", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(Response.json({ ok: true }))
      .mockResolvedValueOnce(
        Response.json({
          ...snapshot(),
          seatOrderBaseline: { campaignId: "campaign-1", revision: -1 },
        }),
      );
    renderEditor();
    await user.click(screen.getByRole("button", { name: "Manage seat 2" }));
    await user.click(screen.getByRole("button", { name: "Make active" }));
    await user.click(screen.getByRole("button", { name: "Save order" }));
    expect(
      await screen.findByRole("button", { name: "Save order" }),
    ).toBeDisabled();
    expect(screen.queryByTestId("save-confirmation")).toBeNull();
    expect(screen.getByText("Seat 2 · Active")).toBeVisible();
    await user.click(
      screen.getByRole("button", {
        name: "Discard draft and load latest roster",
      }),
    );
    expect(
      await screen.findByRole("button", { name: "Save order" }),
    ).toBeDisabled();
    expect(screen.getByText("Seat 2 · Active")).toBeVisible();
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("never invents a missing initial baseline and requires reload after its rejection", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json(
        {
          error: "Reload the latest roster.",
          code: "SEAT_ORDER_BASELINE_REQUIRED",
        },
        { status: 400 },
      ),
    );
    renderEditor({ seatOrderBaseline: undefined });
    await user.click(screen.getByRole("button", { name: "Save order" }));
    expect(
      JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body)),
    ).not.toHaveProperty("baseline");
    expect(
      await screen.findByRole("button", { name: "Save order" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", {
        name: "Discard draft and load latest roster",
      }),
    ).toBeVisible();
  });

  it("keeps contention distinct from staleness without automatic retry or reload", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json(
        {
          error: "Another write is in progress.",
          code: "TURN_MUTATION_CONFLICT",
        },
        { status: 409 },
      ),
    );
    renderEditor();
    await user.click(screen.getByRole("button", { name: "Save order" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Another write is in progress.",
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Save order" })).toBeEnabled(),
    );
    expect(
      screen.queryByRole("button", {
        name: "Discard draft and load latest roster",
      }),
    ).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("captures a destructive proposal before background refresh can replace its occupant", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        Response.json(
          { error: "Stale", code: "STALE_SEAT_ORDER" },
          { status: 409 },
        ),
      );
    const { rerender } = renderEditor();
    await user.click(screen.getByRole("button", { name: "Manage seat 2" }));
    await user.click(screen.getByRole("button", { name: "Clear seat" }));
    rerender(
      <SeatOrderEditor
        activePlayerEntryId="seat-1"
        canEdit
        gameNumber={42}
        players={players.map((player) =>
          player.id === "seat-2"
            ? { ...player, userId: "replacement", displayName: "New lord" }
            : player,
        )}
        seatOrderBaseline={{ campaignId: "campaign-1", revision: 8 }}
        presentation="configuration"
      />,
    );
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Confirm",
      }),
    );
    await user.click(screen.getByRole("button", { name: "Save order" }));
    expect(
      await screen.findByRole("button", { name: "Save order" }),
    ).toBeDisabled();
    expect(JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body))).toEqual({
      seatEntryIds: ["seat-1", "seat-2", "seat-3"],
      clearedSeatEntryIds: ["seat-2"],
      removedSeatEntryIds: [],
      activePlayerEntryId: "seat-1",
      baseline,
    });
  });

  it("starts a new card edit from the entire displayed snapshot after a successful save", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        Response.json({
          seatOrder: snapshot({
            seatOrderBaseline: { campaignId: "campaign-1", revision: 8 },
          }),
        }),
      )
      .mockResolvedValueOnce(
        Response.json({ error: "Stop here" }, { status: 400 }),
      );
    const { rerender } = renderEditor({ presentation: "card" });
    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.click(screen.getByRole("button", { name: "Save order" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Edit" })).toBeEnabled(),
    );
    rerender(
      <SeatOrderEditor
        activePlayerEntryId="seat-1"
        canEdit
        gameNumber={42}
        players={players}
        seatOrderBaseline={{ campaignId: "campaign-1", revision: 9 }}
        presentation="card"
      />,
    );
    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.click(
      screen.getAllByRole("button", { name: "Make active" })[0]!,
    );
    await user.click(screen.getByRole("button", { name: "Save order" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Save order" })).toBeEnabled(),
    );
    expect(
      JSON.parse(String(fetchSpy.mock.calls[1]?.[1]?.body)).baseline,
    ).toEqual({ campaignId: "campaign-1", revision: 9 });
  });

  it("opens one management modal for the selected configuration seat", async () => {
    const user = userEvent.setup();
    renderEditor();

    expect(screen.queryByRole("dialog", { name: /manage seat/i })).toBeNull();
    expect(screen.queryByRole("button", { name: "Clear seat" })).toBeNull();

    const manageSeat2Button = screen.getByRole("button", {
      name: "Manage seat 2",
    });
    expect(manageSeat2Button).toHaveTextContent(/^Manage$/);

    await user.click(manageSeat2Button);

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
    expect(within(openDialog).queryByText("Open", { exact: true })).toBeNull();
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
        seatOrderBaseline={baseline}
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
        seatOrderBaseline={baseline}
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
        seatOrderBaseline={baseline}
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
        seatOrderBaseline={baseline}
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
        seatOrderBaseline={baseline}
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
        seatOrderBaseline={baseline}
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
    expect(screen.getByRole("dialog", { name: "Manage seat 2" })).toBeVisible();

    rerender(
      <SeatOrderEditor
        activePlayerEntryId="seat-1"
        canEdit={false}
        gameNumber={42}
        onDirtyChange={onDirtyChange}
        players={players}
        seatOrderBaseline={baseline}
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
        seatOrderBaseline={{ campaignId: "campaign-1", revision: 8 }}
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
      within(screen.getByRole("dialog", { name: "Manage seat 2" })).getByRole(
        "button",
        { name: "Clear seat" },
      ),
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

  it("captures the baseline when a keyboard drag starts, before a background refresh and drop", async () => {
    const user = userEvent.setup();
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        const top =
          (Number(this.textContent?.match(/Seat (\d)/)?.[1] ?? 1) - 1) * 100;
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
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        Response.json({ code: "STALE_SEAT_ORDER" }, { status: 409 }),
      );
    const { rerender } = renderEditor();
    screen.getByRole("button", { name: "Move seat 1" }).focus();
    await user.keyboard(" ");
    await user.keyboard("{ArrowDown}");
    rerender(
      <SeatOrderEditor
        canEdit
        gameNumber={42}
        players={players}
        activePlayerEntryId="seat-1"
        seatOrderBaseline={{ campaignId: "campaign-1", revision: 8 }}
        presentation="configuration"
      />,
    );
    await user.keyboard(" ");
    await user.click(screen.getByRole("button", { name: "Save order" }));
    expect(JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body))).toMatchObject(
      {
        seatEntryIds: ["seat-2", "seat-1", "seat-3"],
        baseline,
      },
    );
    expect(
      await screen.findByRole("button", { name: "Save order" }),
    ).toBeDisabled();
  });

  it("captures the roster when management opens before a background occupant replacement", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        Response.json({ code: "STALE_SEAT_ORDER" }, { status: 409 }),
      );
    const { rerender } = renderEditor();
    await user.click(screen.getByRole("button", { name: "Manage seat 2" }));
    rerender(
      <SeatOrderEditor
        canEdit
        gameNumber={42}
        players={players.map((player) =>
          player.id === "seat-2"
            ? { ...player, userId: "replacement", displayName: "New lord" }
            : player,
        )}
        activePlayerEntryId="seat-1"
        seatOrderBaseline={{ campaignId: "campaign-1", revision: 8 }}
        presentation="configuration"
      />,
    );
    expect(within(screen.getByRole("dialog")).getByText("Rhea")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Make active" }));
    await user.click(screen.getByRole("button", { name: "Save order" }));
    expect(
      await screen.findByRole("button", { name: "Save order" }),
    ).toBeDisabled();
    expect(
      JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body)).baseline,
    ).toEqual(baseline);
  });

  it.each(["save", "reload"])(
    "accepts newer coherent props for a clean configuration after %s, but never rolls back to older props",
    async (operation) => {
      const user = userEvent.setup();
      const accepted = snapshot({
        seatOrderBaseline: { campaignId: "campaign-1", revision: 8 },
      });
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      if (operation === "reload") {
        fetchSpy.mockResolvedValueOnce(
          Response.json({ code: "STALE_SEAT_ORDER" }, { status: 409 }),
        );
        fetchSpy.mockResolvedValueOnce(Response.json(accepted));
      } else
        fetchSpy.mockResolvedValueOnce(Response.json({ seatOrder: accepted }));
      fetchSpy.mockResolvedValueOnce(
        Response.json({ code: "STALE_SEAT_ORDER" }, { status: 409 }),
      );
      const { rerender } = renderEditor();
      await user.click(screen.getByRole("button", { name: "Save order" }));
      if (operation === "reload") {
        await waitFor(() =>
          expect(
            screen.getByRole("button", {
              name: "Discard draft and load latest roster",
            }),
          ).toBeEnabled(),
        );
        await user.click(
          screen.getByRole("button", {
            name: "Discard draft and load latest roster",
          }),
        );
      }
      await waitFor(() =>
        expect(
          screen.getByRole("button", { name: "Save order" }),
        ).toBeEnabled(),
      );
      const updatedPlayers = players.map((player) =>
        player.id === "seat-2"
          ? { ...player, userId: "replacement", displayName: "New lord" }
          : player,
      );
      rerender(
        <SeatOrderEditor
          canEdit
          gameNumber={42}
          players={updatedPlayers}
          activePlayerEntryId="seat-1"
          seatOrderBaseline={{ campaignId: "campaign-1", revision: 9 }}
          presentation="configuration"
        />,
      );
      expect(screen.getByText("New lord")).toBeVisible();
      // A slower refresh arriving last cannot undo the accepted newer roster.
      rerender(
        <SeatOrderEditor
          canEdit
          gameNumber={42}
          players={players}
          activePlayerEntryId="seat-1"
          seatOrderBaseline={baseline}
          presentation="configuration"
        />,
      );
      await user.click(screen.getByRole("button", { name: "Manage seat 2" }));
      expect(
        within(screen.getByRole("dialog")).getByText("New lord"),
      ).toBeVisible();
      await user.click(screen.getByRole("button", { name: "Make active" }));
      await user.click(screen.getByRole("button", { name: "Save order" }));
      expect(
        await screen.findByRole("button", { name: "Save order" }),
      ).toBeDisabled();
      expect(
        JSON.parse(String(fetchSpy.mock.calls.at(-1)?.[1]?.body)).baseline,
      ).toEqual({ campaignId: "campaign-1", revision: 9 });
    },
  );

  it.each(["{Escape}", " "])(
    "releases an unchanged keyboard proposal after %j so the next edit uses fresh props",
    async (finishGesture) => {
      const user = userEvent.setup();
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(
          Response.json({ code: "STALE_SEAT_ORDER" }, { status: 409 }),
        );
      const { rerender } = renderEditor();
      screen.getByRole("button", { name: "Move seat 1" }).focus();
      await user.keyboard(" ");
      rerender(
        <SeatOrderEditor
          canEdit
          gameNumber={42}
          players={players}
          activePlayerEntryId="seat-2"
          seatOrderBaseline={{ campaignId: "campaign-1", revision: 8 }}
          presentation="configuration"
        />,
      );
      expect(screen.getByText("Seat 1 · Overlord · Active")).toBeVisible();
      await user.keyboard(finishGesture);
      expect(screen.getByText("Seat 2 · Active")).toBeVisible();
      await user.click(screen.getByRole("button", { name: "Save order" }));
      expect(
        await screen.findByRole("button", { name: "Save order" }),
      ).toBeDisabled();
      expect(
        JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body)).baseline,
      ).toEqual({ campaignId: "campaign-1", revision: 8 });
    },
  );

  it.each(["save", "reload"])(
    "resets a standalone editor on stable campaign change and ignores its old pending %s",
    async (operation) => {
      const user = userEvent.setup();
      let resolveRequest!: (response: Response) => void;
      const onSnapshotAccepted = vi.fn();
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      if (operation === "reload")
        fetchSpy.mockResolvedValueOnce(
          Response.json({ code: "STALE_SEAT_ORDER" }, { status: 409 }),
        );
      fetchSpy.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveRequest = resolve;
          }),
      );
      const { rerender } = renderEditor({ onSnapshotAccepted });
      await user.click(screen.getByRole("button", { name: "Manage seat 2" }));
      await user.click(screen.getByRole("button", { name: "Make active" }));
      await user.click(screen.getByRole("button", { name: "Save order" }));
      if (operation === "reload") {
        await waitFor(() =>
          expect(
            screen.getByRole("button", {
              name: "Discard draft and load latest roster",
            }),
          ).toBeEnabled(),
        );
        await user.click(
          screen.getByRole("button", {
            name: "Discard draft and load latest roster",
          }),
        );
      }
      rerender(
        <SeatOrderEditor
          canEdit
          gameNumber={42}
          players={[
            { ...players[0]!, id: "new-seat", displayName: "Different lord" },
          ]}
          activePlayerEntryId="new-seat"
          seatOrderBaseline={{ campaignId: "campaign-2", revision: 1 }}
          presentation="configuration"
          onSnapshotAccepted={onSnapshotAccepted}
        />,
      );
      expect(screen.getByText("Different lord")).toBeVisible();
      expect(screen.getByRole("button", { name: "Save order" })).toBeEnabled();
      await act(async () =>
        resolveRequest(
          Response.json(
            operation === "reload" ? snapshot() : { seatOrder: snapshot() },
          ),
        ),
      );
      expect(onSnapshotAccepted).not.toHaveBeenCalled();
      expect(router.refresh).not.toHaveBeenCalled();
      expect(screen.queryByTestId("save-confirmation")).toBeNull();
      expect(
        screen.queryByRole("button", {
          name: "Discard draft and load latest roster",
        }),
      ).toBeNull();
      expect(screen.getByText("Different lord")).toBeVisible();
    },
  );

  it("releases a configuration proposal when its final edit is undone", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        Response.json({ code: "STALE_SEAT_ORDER" }, { status: 409 }),
      );
    const { rerender } = renderEditor();
    await user.click(screen.getByRole("button", { name: "Manage seat 2" }));
    await user.click(screen.getByRole("button", { name: "Make active" }));
    rerender(
      <SeatOrderEditor
        canEdit
        gameNumber={42}
        players={players}
        activePlayerEntryId="seat-2"
        seatOrderBaseline={{ campaignId: "campaign-1", revision: 8 }}
        presentation="configuration"
      />,
    );
    await user.click(screen.getByRole("button", { name: "Manage seat 1" }));
    await user.click(screen.getByRole("button", { name: "Make active" }));
    // The proposal is now identical to its original baseline; show the current accepted roster.
    expect(screen.getByText("Seat 2 · Active")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Save order" }));
    expect(
      await screen.findByRole("button", { name: "Save order" }),
    ).toBeDisabled();
    expect(
      JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body)).baseline,
    ).toEqual({ campaignId: "campaign-1", revision: 8 });
  });

  it("preserves a live proposal through same-campaign renumbering", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        Response.json({ code: "STALE_SEAT_ORDER" }, { status: 409 }),
      );
    const { rerender } = renderEditor();
    await user.click(screen.getByRole("button", { name: "Manage seat 2" }));
    rerender(
      <SeatOrderEditor
        canEdit
        gameNumber={84}
        players={players}
        activePlayerEntryId="seat-2"
        seatOrderBaseline={{ campaignId: "campaign-1", revision: 8 }}
        presentation="configuration"
      />,
    );
    expect(screen.getByRole("dialog", { name: "Manage seat 2" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Make active" }));
    await user.click(screen.getByRole("button", { name: "Save order" }));
    expect(
      await screen.findByRole("button", { name: "Save order" }),
    ).toBeDisabled();
    expect(fetchSpy.mock.calls[0]?.[0]).toBe("/api/games/84/seat-order");
    expect(
      JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body)).baseline,
    ).toEqual(baseline);
  });

  it("disables saving on upstream staleness even when the submitted roster is empty", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json(
        {
          code: "STALE_SEAT_ORDER",
          error: "Roster changed. Reload before saving.",
        },
        { status: 409 },
      ),
    );
    renderEditor({ players: [], activePlayerEntryId: null });
    await user.click(screen.getByRole("button", { name: "Save order" }));
    expect(JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body))).toMatchObject(
      { seatEntryIds: [], baseline },
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Roster changed. Reload before saving.",
    );
    expect(
      await screen.findByRole("button", { name: "Save order" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", {
        name: "Discard draft and load latest roster",
      }),
    ).toBeVisible();
  });

  it("does not roll back newer observed authoritative state when a slower save response arrives", async () => {
    const user = userEvent.setup();
    let resolveRequest!: (response: Response) => void;
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveRequest = resolve;
          }),
      )
      .mockResolvedValueOnce(
        Response.json({ code: "STALE_SEAT_ORDER" }, { status: 409 }),
      );
    const { rerender } = renderEditor();
    await user.click(screen.getByRole("button", { name: "Save order" }));
    rerender(
      <SeatOrderEditor
        canEdit
        gameNumber={42}
        players={players}
        activePlayerEntryId="seat-2"
        seatOrderBaseline={{ campaignId: "campaign-1", revision: 10 }}
        presentation="configuration"
      />,
    );
    rerender(
      <SeatOrderEditor
        canEdit
        gameNumber={42}
        players={players}
        activePlayerEntryId="seat-1"
        seatOrderBaseline={baseline}
        presentation="configuration"
      />,
    );
    await act(async () =>
      resolveRequest(
        Response.json({
          seatOrder: snapshot({
            seatOrderBaseline: { campaignId: "campaign-1", revision: 9 },
          }),
        }),
      ),
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Save order" })).toBeEnabled(),
    );
    expect(screen.getByText("Seat 2 · Active")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Save order" }));
    expect(
      await screen.findByRole("button", { name: "Save order" }),
    ).toBeDisabled();
    expect(
      JSON.parse(String(fetchSpy.mock.calls[1]?.[1]?.body)).baseline,
    ).toEqual({ campaignId: "campaign-1", revision: 10 });
  });

  it("opens seat management from the keyboard", async () => {
    const user = userEvent.setup();
    renderEditor();
    const manageSeat = screen.getByRole("button", { name: "Manage seat 2" });

    manageSeat.focus();
    await user.keyboard("{Enter}");

    expect(screen.getByRole("dialog", { name: "Manage seat 2" })).toBeVisible();
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

    resolveRequest(
      Response.json({
        seatOrder: snapshot({
          activePlayerEntryId: "seat-2",
          activePlayerUserId: "player-2",
          seatOrderBaseline: { campaignId: "campaign-1", revision: 8 },
        }),
      }),
    );
    await waitFor(() => expect(router.refresh).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Save order" })).toBeEnabled(),
    );
  });

  it("posts the exact changed seat payload and clears dirty state on success", async () => {
    const user = userEvent.setup();
    const onDirtyChange = vi.fn();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        seatOrder: snapshot({
          activePlayerEntryId: "seat-2",
          activePlayerUserId: "player-2",
          seatOrderBaseline: { campaignId: "campaign-1", revision: 8 },
        }),
      }),
    );
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
          baseline,
        }),
      }),
    );
    await waitFor(() => expect(onDirtyChange).toHaveBeenLastCalledWith(false));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Save order" })).toBeEnabled(),
    );
    expect(screen.getByTestId("save-confirmation")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Active seat" })).toBeNull();
    expect(router.refresh).toHaveBeenCalledOnce();
  });

  it("posts cleared and removed seat arrays from the original props", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      Response.json({
        seatOrder: snapshot({
          players: [
            players[0]!,
            { ...players[1]!, userId: null, displayName: null },
          ],
          seatOrderBaseline: { campaignId: "campaign-1", revision: 8 },
        }),
      }),
    );
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
      expect(screen.getByRole("button", { name: "Save order" })).toBeEnabled(),
    );
    await waitFor(() =>
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/games/42/seat-order",
        expect.objectContaining({
          body: JSON.stringify({
            seatEntryIds: ["seat-1", "seat-2"],
            clearedSeatEntryIds: ["seat-2"],
            removedSeatEntryIds: ["seat-3"],
            activePlayerEntryId: "seat-1",
            baseline,
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
        seatOrderBaseline={baseline}
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
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Save order" })).toBeEnabled(),
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
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Save order" })).toBeEnabled(),
    );
    expect(onDirtyChange).toHaveBeenLastCalledWith(true);
    expect(router.refresh).not.toHaveBeenCalled();
  });
});

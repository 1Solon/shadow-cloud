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
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CampaignDetailsWorkspace } from "@/components/campaign-details-workspace";
import type { SeatOrderSnapshot } from "@/lib/shadow-cloud-api";

const router = { refresh: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const props: ComponentProps<typeof CampaignDetailsWorkspace> = {
  activePlayerEntryId: "seat-1",
  armyCount: "ONE_PER_ZONE",
  canEdit: true,
  seatOrderBaseline: { campaignId: "campaign-1", revision: 7 },
  dlcMode: "NONE",
  gameMode: "TEAMS",
  gameNumber: 42,
  hasAiPlayers: false,
  name: "Campaign 42",
  notes: "Hold the pass.",
  organizerDisplayName: "Overlord",
  playerCount: 2,
  players: [
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
  ],
  roundNumber: 4,
  techLevel: 4,
  turnReminderGraceHours: 12,
  turnReminderRepeatHours: 6,
  turnRemindersEnabled: true,
  turnTargetHours: 24,
  zoneCount: "TWO_ZONE_START",
};

const latest: SeatOrderSnapshot = {
  gameId: "campaign-1",
  slug: "campaign-42",
  name: "Campaign 42",
  organizerId: "player-1",
  players: [
    props.players[0]!,
    { ...props.players[1]!, userId: "replacement", displayName: "New lord" },
  ],
  activePlayerEntryId: "seat-2",
  activePlayerUserId: "replacement",
  roundNumber: 4,
  seatOrderBaseline: { campaignId: "campaign-1", revision: 9 },
};

describe("CampaignDetailsWorkspace Seat Order lifecycle", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    router.refresh.mockReset();
  });

  it.each(["reload", "save"])(
    "retains the accepted %s roster across real section unmounts and renumbering",
    async (operation) => {
      const user = userEvent.setup();
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      if (operation === "reload") {
        fetchSpy.mockResolvedValueOnce(
          Response.json({ code: "STALE_SEAT_ORDER" }, { status: 409 }),
        );
        fetchSpy.mockResolvedValueOnce(Response.json(latest));
      } else
        fetchSpy.mockResolvedValueOnce(Response.json({ seatOrder: latest }));
      fetchSpy.mockResolvedValueOnce(
        Response.json({ code: "STALE_SEAT_ORDER" }, { status: 409 }),
      );
      const { rerender } = render(<CampaignDetailsWorkspace {...props} />);
      await user.click(
        screen.getByRole("button", { name: "Configure campaign" }),
      );
      await user.click(screen.getByRole("button", { name: "Seat Order" }));
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
      expect(screen.getByText("New lord")).toBeVisible();
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "Notes" })).toBeEnabled(),
      );
      await user.click(screen.getByRole("button", { name: "Notes" }));
      expect(screen.queryByRole("button", { name: "Save order" })).toBeNull();
      rerender(<CampaignDetailsWorkspace {...props} gameNumber={84} />);
      await user.click(screen.getByRole("button", { name: "Seat Order" }));
      expect(screen.getByText("New lord")).toBeVisible();
      expect(screen.getByText("Seat 2 · Active")).toBeVisible();
      await user.click(screen.getByRole("button", { name: "Manage seat 1" }));
      await user.click(
        within(screen.getByRole("dialog")).getByRole("button", {
          name: "Make active",
        }),
      );
      await user.click(screen.getByRole("button", { name: "Save order" }));
      expect(
        await screen.findByRole("button", { name: "Save order" }),
      ).toBeDisabled();
      expect(fetchSpy.mock.calls.at(-1)?.[0]).toBe("/api/games/84/seat-order");
      expect(
        JSON.parse(String(fetchSpy.mock.calls.at(-1)?.[1]?.body)),
      ).toMatchObject({
        baseline: { campaignId: "campaign-1", revision: 9 },
        activePlayerEntryId: "seat-1",
      });
    },
  );

  it.each(["reload", "save"])(
    "resets the workspace on a different stable campaign and ignores its previous pending %s",
    async (operation) => {
      const user = userEvent.setup();
      let resolveRequest!: (response: Response) => void;
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
      fetchSpy.mockResolvedValueOnce(
        Response.json({ code: "STALE_SEAT_ORDER" }, { status: 409 }),
      );
      const { rerender } = render(<CampaignDetailsWorkspace {...props} />);
      await user.click(
        screen.getByRole("button", { name: "Configure campaign" }),
      );
      await user.click(screen.getByRole("button", { name: "Seat Order" }));
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
        <CampaignDetailsWorkspace
          {...props}
          name="Different campaign"
          players={[
            {
              ...props.players[0]!,
              id: "new-seat",
              userId: "new-player",
              displayName: "Different lord",
            },
          ]}
          activePlayerEntryId="new-seat"
          seatOrderBaseline={{ campaignId: "campaign-2", revision: 1 }}
        />,
      );
      expect(
        screen.getByRole("button", { name: "Configure campaign" }),
      ).toBeVisible();
      await act(async () =>
        resolveRequest(
          Response.json(
            operation === "reload" ? latest : { seatOrder: latest },
          ),
        ),
      );
      expect(router.refresh).not.toHaveBeenCalled();
      await user.click(
        screen.getByRole("button", { name: "Configure campaign" }),
      );
      await user.click(screen.getByRole("button", { name: "Seat Order" }));
      expect(screen.getByText("Different lord")).toBeVisible();
      expect(screen.queryByText("New lord")).toBeNull();
      expect(
        screen.queryByRole("button", {
          name: "Discard draft and load latest roster",
        }),
      ).toBeNull();
      await user.click(screen.getByRole("button", { name: "Save order" }));
      expect(
        await screen.findByRole("button", { name: "Save order" }),
      ).toBeDisabled();
      expect(
        JSON.parse(String(fetchSpy.mock.calls.at(-1)?.[1]?.body)),
      ).toMatchObject({
        baseline: { campaignId: "campaign-2", revision: 1 },
        seatEntryIds: ["new-seat"],
        activePlayerEntryId: "new-seat",
      });
    },
  );

  it("keeps a clean pending save mounted until its authoritative result is accepted", async () => {
    const user = userEvent.setup();
    let resolveRequest!: (response: Response) => void;
    vi.spyOn(globalThis, "fetch").mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveRequest = resolve;
        }),
    );
    render(<CampaignDetailsWorkspace {...props} />);
    await user.click(
      screen.getByRole("button", { name: "Configure campaign" }),
    );
    await user.click(screen.getByRole("button", { name: "Seat Order" }));
    await user.click(screen.getByRole("button", { name: "Save order" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Notes" })).toBeDisabled(),
    );
    expect(
      screen.getByRole("button", { name: "Exit configuration" }),
    ).toBeDisabled();
    await act(async () => resolveRequest(Response.json({ seatOrder: latest })));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Notes" })).toBeEnabled(),
    );
    await user.click(screen.getByRole("button", { name: "Notes" }));
    await user.click(screen.getByRole("button", { name: "Seat Order" }));
    expect(screen.getByText("New lord")).toBeVisible();
  });

  it("retains an authoritative no-op save snapshot when its revision matches the original props", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      Response.json({
        seatOrder: {
          ...latest,
          players: [
            props.players[0],
            { ...props.players[1]!, displayName: "Renamed lord" },
          ],
          activePlayerEntryId: "seat-1",
          activePlayerUserId: "player-1",
          seatOrderBaseline: props.seatOrderBaseline,
        },
      }),
    );
    render(<CampaignDetailsWorkspace {...props} />);
    await user.click(
      screen.getByRole("button", { name: "Configure campaign" }),
    );
    await user.click(screen.getByRole("button", { name: "Seat Order" }));
    await user.click(screen.getByRole("button", { name: "Save order" }));
    expect(await screen.findByText("Renamed lord")).toBeVisible();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Notes" })).toBeEnabled(),
    );
    await user.click(screen.getByRole("button", { name: "Notes" }));
    await user.click(screen.getByRole("button", { name: "Seat Order" }));
    expect(screen.getByText("Renamed lord")).toBeVisible();
  });
});

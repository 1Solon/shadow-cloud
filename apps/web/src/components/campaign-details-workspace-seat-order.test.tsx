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

const router = { refresh: vi.fn(), push: vi.fn(), replace: vi.fn() };
vi.mock("next/navigation", () => ({ useRouter: () => router }));

const props: ComponentProps<typeof CampaignDetailsWorkspace> = {
  identityReadId: "read-1",
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
    router.push.mockReset();
    router.replace.mockReset();
  });

  for (const invalidation of ["permission loss", "campaign switch"]) {
    it.each([
      "metadata headers",
      "metadata body",
      "transfer headers",
      "transfer body",
      "metadata-only headers",
      "metadata-only body",
    ])(`does not continue pending %s after ${invalidation}`, async (stage) => {
      const user = userEvent.setup();
      const pending = Promise.withResolvers<Response>();
      const pendingBody = Promise.withResolvers<unknown>();
      const isTransfer = stage.startsWith("transfer");
      const metadataOnly = stage.startsWith("metadata-only");
      const bodyPending = stage.endsWith("body");
      const body = isTransfer
        ? { gameId: "campaign-1", gameNumber: 43, organizerId: "player-2" }
        : { gameNumber: 43 };
      const response = Response.json(body);
      const readBody = vi.spyOn(response, "json");
      if (bodyPending) readBody.mockReturnValue(pendingBody.promise);
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      if (isTransfer)
        fetchSpy.mockResolvedValueOnce(Response.json({ gameNumber: 43 }));
      fetchSpy
        .mockReturnValueOnce(
          bodyPending ? Promise.resolve(response) : pending.promise,
        )
        .mockResolvedValue(
          Response.json({
            gameId: "campaign-1",
            gameNumber: 43,
            organizerId: "player-2",
          }),
        );
      const { rerender } = render(<CampaignDetailsWorkspace {...props} />);
      await user.click(
        screen.getByRole("button", { name: "Configure campaign" }),
      );
      await user.clear(screen.getByLabelText("Campaign number"));
      await user.type(screen.getByLabelText("Campaign number"), "43");
      if (!metadataOnly)
        await user.selectOptions(screen.getByLabelText("Overlord"), "seat-2");
      await user.click(screen.getByRole("button", { name: "Save" }));
      if (!metadataOnly)
        await user.click(screen.getByRole("button", { name: "Confirm" }));
      const expectedRequests = isTransfer ? 2 : 1;
      await waitFor(() =>
        expect(fetchSpy).toHaveBeenCalledTimes(expectedRequests),
      );
      if (bodyPending)
        await waitFor(() => expect(readBody).toHaveBeenCalledOnce());
      if (invalidation === "permission loss")
        rerender(<CampaignDetailsWorkspace {...props} canEdit={false} />);
      else
        rerender(
          <CampaignDetailsWorkspace
            {...props}
            seatOrderBaseline={{ campaignId: "other-campaign", revision: 0 }}
            gameNumber={99}
          />,
        );
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
      await act(async () => {
        if (bodyPending) pendingBody.resolve(body);
        else pending.resolve(response);
      });
      expect(fetchSpy).toHaveBeenCalledTimes(expectedRequests);
      expect(router.push).not.toHaveBeenCalled();
      expect(router.replace).not.toHaveBeenCalled();
      expect(router.refresh).not.toHaveBeenCalled();
    });
  }

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

  it("keeps a captured draft while a newer Roster arrives, then retains the newer Roster after a slower save", async () => {
    const user = userEvent.setup();
    const pending = Promise.withResolvers<Response>();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockReturnValueOnce(pending.promise);
    const { rerender } = render(<CampaignDetailsWorkspace {...props} />);
    await user.click(
      screen.getByRole("button", { name: "Configure campaign" }),
    );
    await user.click(screen.getByRole("button", { name: "Seat Order" }));
    await user.click(screen.getByRole("button", { name: "Manage seat 2" }));
    await user.click(screen.getByRole("button", { name: "Make active" }));

    rerender(
      <CampaignDetailsWorkspace
        {...props}
        players={latest.players}
        activePlayerEntryId="seat-1"
        seatOrderBaseline={{ campaignId: "campaign-1", revision: 10 }}
      />,
    );
    expect(screen.getByText("Rhea")).toBeVisible();
    expect(screen.getByText("Seat 2 · Active")).toBeVisible();
    expect(screen.queryByText("New lord")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save order" }));
    expect(JSON.parse(String(fetchSpy.mock.calls[0]?.[1]?.body))).toMatchObject(
      {
        baseline: { campaignId: "campaign-1", revision: 7 },
        activePlayerEntryId: "seat-2",
      },
    );
    await act(async () =>
      pending.resolve(Response.json({ seatOrder: latest })),
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Notes" })).toBeEnabled(),
    );
    expect(screen.getByText("New lord")).toBeVisible();
    expect(screen.getByText("Seat 1 · Overlord · Active")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Notes" }));
    await user.click(screen.getByRole("button", { name: "Seat Order" }));
    expect(screen.getByText("New lord")).toBeVisible();
    fetchSpy.mockResolvedValueOnce(
      Response.json({ code: "STALE_SEAT_ORDER" }, { status: 409 }),
    );
    await user.click(screen.getByRole("button", { name: "Save order" }));
    expect(JSON.parse(String(fetchSpy.mock.calls[1]?.[1]?.body))).toMatchObject(
      {
        baseline: { campaignId: "campaign-1", revision: 10 },
        activePlayerEntryId: "seat-1",
      },
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Save order" })).toBeDisabled(),
    );
  });

  it("does not feed the Accepted Roster into Settings or Briefing", async () => {
    const user = userEvent.setup();
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      Response.json({ seatOrder: latest }),
    );
    render(<CampaignDetailsWorkspace {...props} />);
    await user.click(
      screen.getByRole("button", { name: "Configure campaign" }),
    );
    await user.click(screen.getByRole("button", { name: "Seat Order" }));
    await user.click(screen.getByRole("button", { name: "Save order" }));
    expect(await screen.findByText("New lord")).toBeVisible();
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Identity & Progress" }),
      ).toBeEnabled(),
    );
    await user.click(
      screen.getByRole("button", { name: "Identity & Progress" }),
    );
    expect(screen.getByLabelText("Overlord")).toHaveTextContent("Rhea");
    expect(screen.getByLabelText("Overlord")).not.toHaveTextContent("New lord");
    await user.click(
      screen.getByRole("button", { name: "Exit configuration" }),
    );
    await user.click(screen.getByRole("button", { name: /SEAT ORDER ·/ }));
    expect(screen.getByText("Rhea")).toBeVisible();
    expect(screen.queryByText("New lord")).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Configure campaign" }),
    );
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

// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ComponentProps } from "react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GameMetadataCard,
  parsePositiveSafeWholeHours,
} from "@/components/game-metadata-card";

const router = {
  push: vi.fn(),
  refresh: vi.fn(),
};

vi.mock("next/navigation", () => ({
  useRouter: () => router,
}));

vi.mock("@/components/terminal-confirmation-modal", () => ({
  TerminalConfirmationModal: () => null,
}));

function renderCard() {
  const props = {
    activePlayerDisplayName: "Active lord",
    armyCount: "ONE_PER_ZONE",
    canEdit: true,
    dlcMode: "NONE",
    gameMode: "TEAMS",
    gameNumber: 22,
    hasAiPlayers: false,
    name: "Campaign 22",
    organizerDisplayName: "Overlord",
    players: [
      {
        id: "seat-1",
        userId: "overlord-1",
        displayName: "Overlord",
        turnOrder: 1,
        isOrganizer: true,
      },
    ],
    playerCount: 2,
    roundNumber: 4,
    techLevel: 4,
    turnReminderGraceHours: 12,
    turnReminderRepeatHours: 24,
    turnRemindersEnabled: true,
    turnTargetHours: 24,
    zoneCount: "TWO_ZONE_START",
  };

  return render(
    <GameMetadataCard
      {...(props as ComponentProps<typeof GameMetadataCard>)}
    />,
  );
}

describe("GameMetadataCard turn timing policy", () => {
  beforeEach(() => {
    router.push.mockReset();
    router.refresh.mockReset();
    vi.restoreAllMocks();
  });

  afterEach(cleanup);

  it("shows the campaign timing policy in terminal detail tiles", () => {
    renderCard();

    expect(screen.getByText("Target turn")).toBeInTheDocument();
    expect(screen.getAllByText("24 hours")).toHaveLength(2);
    expect(screen.getByText("Reminder grace")).toBeInTheDocument();
    expect(screen.getByText("12 hours")).toBeInTheDocument();
    expect(screen.getByText("Reminder repeat")).toBeInTheDocument();
    expect(screen.getByText("Turn reminders")).toBeInTheDocument();
    expect(screen.getByText("Enabled")).toBeInTheDocument();
  });

  it("initializes the policy editor from the current policy", async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(screen.getByRole("button", { name: "Edit" }));

    expect(screen.getByLabelText("Target turn hours")).toHaveValue(24);
    expect(screen.getByLabelText("Reminder grace hours")).toHaveValue(12);
    expect(screen.getByLabelText("Reminder repeat hours")).toHaveValue(24);
    expect(screen.getByRole("checkbox", { name: "Enabled" })).toBeChecked();
  });

  it("keeps one policy group surface without per-field tiles", async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(screen.getByRole("button", { name: "Edit" }));

    const group = screen.getByRole("group", { name: "Turn timing policy" });
    const targetLabel = screen.getByLabelText("Target turn hours").closest("label");
    const graceLabel = screen
      .getByLabelText("Reminder grace hours")
      .closest("label");
    const repeatLabel = screen
      .getByLabelText("Reminder repeat hours")
      .closest("label");
    const enabledLabel = screen.getByLabelText("Enabled").closest("label");

    expect(group).toHaveClass("border", "border-orange-400/20");

    for (const label of [targetLabel, graceLabel, repeatLabel, enabledLabel]) {
      expect(label).not.toHaveClass("border", "bg-orange-400/5", "px-4", "py-4");
    }
  });

  it("submits only a changed target policy field", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ gameNumber: 22 }), { status: 200 }),
      );
    renderCard();

    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.clear(screen.getByLabelText("Target turn hours"));
    await user.type(screen.getByLabelText("Target turn hours"), "48");
    await user.click(screen.getByRole("button", { name: "Save details" }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/games/22/metadata",
        expect.objectContaining({
          body: JSON.stringify({ turnTargetHours: 48 }),
        }),
      );
    });
    expect(router.refresh).toHaveBeenCalled();
  });

  it("submits false when disabling reminders", async () => {
    const user = userEvent.setup();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ gameNumber: 22 }), { status: 200 }),
      );
    renderCard();

    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.click(screen.getByRole("checkbox", { name: "Enabled" }));
    await user.click(screen.getByRole("button", { name: "Save details" }));

    await waitFor(() => {
      expect(fetchSpy).toHaveBeenCalledWith(
        "/api/games/22/metadata",
        expect.objectContaining({
          body: JSON.stringify({ turnRemindersEnabled: false }),
        }),
      );
    });
  });

  it.each(["", "0", "-1", "1.5", "1000000001", "9007199254740991"])(
    "rejects an invalid target string without submitting: %s",
    async (value) => {
      const user = userEvent.setup();
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      renderCard();

      await user.click(screen.getByRole("button", { name: "Edit" }));
      await user.clear(screen.getByLabelText("Target turn hours"));
      if (value) {
        await user.type(screen.getByLabelText("Target turn hours"), value);
      }
      await user.click(screen.getByRole("button", { name: "Save details" }));

      expect(screen.getByRole("alert")).toHaveTextContent("Target turn");
      expect(fetchSpy).not.toHaveBeenCalled();
    },
  );

  it.each([
    "",
    "0",
    "-1",
    "1.5",
    "1e3",
    "1000000001",
    "9007199254740991",
    "9007199254740992",
  ])(
    "rejects invalid policy string %s before constructing a request",
    (value) => {
      expect(parsePositiveSafeWholeHours(value, "Target turn")).toEqual(
        expect.objectContaining({ ok: false }),
      );
    },
  );

  it("accepts the maximum supported whole-hour value", () => {
    expect(parsePositiveSafeWholeHours("1000000000", "Target turn")).toEqual({
      ok: true,
      value: 1_000_000_000,
    });
  });

  it.each([400, 401, 403])(
    "keeps a %s policy update failure inline",
    async (status) => {
      const user = userEvent.setup();
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        new Response(JSON.stringify({ error: "Policy update rejected." }), {
          status,
        }),
      );
      renderCard();

      await user.click(screen.getByRole("button", { name: "Edit" }));
      await user.clear(screen.getByLabelText("Target turn hours"));
      await user.type(screen.getByLabelText("Target turn hours"), "48");
      await user.click(screen.getByRole("button", { name: "Save details" }));

      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Policy update rejected.",
      );
      expect(screen.getByLabelText("Target turn hours")).toHaveValue(48);
    },
  );

  it("restores the initial policy when editing is cancelled", async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(screen.getByRole("button", { name: "Edit" }));
    await user.clear(screen.getByLabelText("Target turn hours"));
    await user.type(screen.getByLabelText("Target turn hours"), "48");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Edit" }));

    expect(screen.getByLabelText("Target turn hours")).toHaveValue(24);
  });
});

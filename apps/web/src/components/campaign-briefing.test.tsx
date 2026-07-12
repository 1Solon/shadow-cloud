// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { CampaignBriefing } from "@/components/campaign-briefing";

const props = {
  activePlayerEntryId: "seat-1",
  armyCount: "ONE_PER_ZONE",
  dlcMode: "BOTH",
  gameMode: "FFA_AI",
  hasAiPlayers: true,
  name: "Dust Crown",
  notes: "Hold the **western** pass.",
  organizerDisplayName: "Solon",
  playerCount: 4,
  players: [
    {
      id: "seat-1",
      userId: "user-1",
      displayName: "Solon",
      turnOrder: 1,
      isOrganizer: true,
    },
    {
      id: "seat-2",
      userId: null,
      displayName: null,
      turnOrder: 2,
      isOrganizer: false,
    },
  ],
  techLevel: 4,
  turnReminderGraceHours: 6,
  turnReminderRepeatHours: 3,
  turnRemindersEnabled: true,
  turnTargetHours: 12,
  zoneCount: "TWO_ZONE_START",
};

function renderBriefing(
  overrides: Partial<ComponentProps<typeof CampaignBriefing>> = {},
) {
  return render(<CampaignBriefing {...props} {...overrides} />);
}

afterEach(cleanup);

describe("CampaignBriefing", () => {
  it("renders campaign identity and a human-readable world summary", () => {
    renderBriefing();

    expect(
      screen.getByRole("heading", { name: "CAMPAIGN // BRIEFING" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Dust Crown")).toBeInTheDocument();
    expect(screen.getByText("Overlord · Solon")).toBeInTheDocument();

    const values = screen.getByTestId("campaign-briefing-values");
    expect(values).toHaveClass("grid", "min-w-0", "sm:grid-cols-2");
    expect(within(values).getAllByText("4")).toHaveLength(2);
    for (const value of [
      "Included",
      "Both",
      "FFA+AI",
      "2 Zone Start",
      "1 Army per Zone",
    ]) {
      expect(within(values).getByText(value)).toBeInTheDocument();
    }
  });

  it("keeps active player out of the opening summary and identifies the matching expanded seat", async () => {
    const user = userEvent.setup();
    renderBriefing();

    const values = screen.getByTestId("campaign-briefing-values");
    expect(
      within(values).queryByText(/active player/i),
    ).not.toBeInTheDocument();
    expect(within(values).queryByText(/round/i)).not.toBeInTheDocument();
    expect(within(values).queryByText(/target/i)).not.toBeInTheDocument();
    expect(within(values).queryByText("12")).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "SEAT ORDER · 1/2 SEATS" }),
    );

    const seats = screen.getAllByRole("listitem");
    expect(seats[0]).toHaveTextContent("Active");
    expect(seats[1]).not.toHaveTextContent("Active");
    expect(screen.getAllByText(/Active/)).toHaveLength(1);
  });

  it("starts all disclosures collapsed with inaccessible content", () => {
    renderBriefing();

    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(3);
    for (const button of buttons) {
      expect(button).toHaveAttribute("aria-expanded", "false");
    }
    expect(screen.queryByText("Hold the")).not.toBeInTheDocument();
    expect(screen.queryByText("Reminder grace")).not.toBeInTheDocument();
    expect(screen.queryByText("SEAT 01")).not.toBeInTheDocument();
  });

  it("opens only one disclosure and toggles the open disclosure closed", async () => {
    const user = userEvent.setup();
    renderBriefing();
    const seats = screen.getByRole("button", {
      name: "SEAT ORDER · 1/2 SEATS",
    });
    const notes = screen.getByRole("button", {
      name: "CAMPAIGN NOTES · RECORDED",
    });

    await user.click(seats);
    expect(seats).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("SEAT 01")).toBeInTheDocument();

    await user.click(notes);
    expect(seats).toHaveAttribute("aria-expanded", "false");
    expect(notes).toHaveAttribute("aria-expanded", "true");
    expect(screen.queryByText("SEAT 01")).not.toBeInTheDocument();
    expect(screen.getByText("western")).toBeInTheDocument();

    await user.click(notes);
    expect(notes).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("western")).not.toBeInTheDocument();
  });

  it("counts supplied seats and labels ordered occupied, empty, and Overlord seats", async () => {
    const user = userEvent.setup();
    renderBriefing({
      playerCount: 8,
      players: [props.players[1], props.players[0]],
    });
    await user.click(
      screen.getByRole("button", { name: "SEAT ORDER · 1/2 SEATS" }),
    );

    const seats = screen.getAllByRole("listitem");
    expect(seats).toHaveLength(2);
    expect(seats[0]).toHaveTextContent("SEAT 01");
    expect(seats[0]).toHaveTextContent("Solon");
    expect(seats[0]).toHaveTextContent("Occupied");
    expect(seats[0]).toHaveTextContent("Overlord");
    expect(seats[1]).toHaveTextContent("SEAT 02");
    expect(seats[1]).toHaveTextContent("Empty");
    expect(seats[0]).toHaveTextContent("Active");
  });

  it("renders non-empty campaign notes as Markdown", async () => {
    const user = userEvent.setup();
    renderBriefing();
    await user.click(
      screen.getByRole("button", { name: "CAMPAIGN NOTES · RECORDED" }),
    );

    expect(screen.getByText("western").tagName).toBe("STRONG");
  });

  it("summarizes and explains blank campaign notes", async () => {
    const user = userEvent.setup();
    renderBriefing({ notes: "  \n " });
    const notes = screen.getByRole("button", {
      name: "CAMPAIGN NOTES · EMPTY",
    });
    await user.click(notes);

    expect(screen.getByText("No campaign notes recorded.")).toBeInTheDocument();
  });

  it("shows the complete turn reminders", async () => {
    const user = userEvent.setup();
    renderBriefing();
    await user.click(
      screen.getByRole("button", { name: "TURN REMINDERS · 12H TARGET" }),
    );

    expect(screen.getByText("12 hours")).toBeInTheDocument();
    expect(screen.getByText("Enabled")).toBeInTheDocument();
    expect(screen.getByText("6 hours")).toBeInTheDocument();
    expect(screen.getByText("3 hours")).toBeInTheDocument();
  });

  it("uses Unknown for null and unrecognized configuration values", () => {
    renderBriefing({
      armyCount: "FUTURE_ARMIES",
      dlcMode: null,
      gameMode: "FUTURE_MODE",
      hasAiPlayers: null,
      playerCount: null,
      techLevel: null,
      zoneCount: null,
    });

    const values = screen.getByTestId("campaign-briefing-values");
    expect(within(values).getAllByText("Unknown")).toHaveLength(7);
    expect(within(values).queryByText("FUTURE_ARMIES")).not.toBeInTheDocument();
    expect(within(values).queryByText("FUTURE_MODE")).not.toBeInTheDocument();
  });

  it("uses an Unknown turn summary for an invalid target", async () => {
    const user = userEvent.setup();
    renderBriefing({ turnTargetHours: null });
    await user.click(
      screen.getByRole("button", { name: "TURN REMINDERS · UNKNOWN TARGET" }),
    );

    expect(screen.getByText("Unknown", { selector: "dd" })).toBeInTheDocument();
  });

  it("connects every disclosure button to its stable panel ID", async () => {
    const user = userEvent.setup();
    renderBriefing();

    for (const button of screen.getAllByRole("button")) {
      const panelId = button.getAttribute("aria-controls");
      expect(panelId).toBeTruthy();
      await user.click(button);
      expect(button).toHaveAttribute("aria-expanded", "true");
      expect(document.getElementById(panelId!)).toBeInTheDocument();
      await user.click(button);
      expect(document.getElementById(panelId!)).not.toBeInTheDocument();
    }
  });
});

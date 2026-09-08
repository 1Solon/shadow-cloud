// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TurnTimingHistoryCard } from "@/components/turn-timing-history-card";
import type { GameTurnRecord } from "@/lib/shadow-cloud-api";

function createTurnRecord(
  overrides: Partial<GameTurnRecord> = {},
): GameTurnRecord {
  return {
    id: "turn-1",
    roundNumber: 4,
    gamePlayerId: "seat-1",
    userId: "player-1",
    seatNumber: 1,
    playerDisplayName: "Rhea",
    startedAt: "2026-07-10T10:00:00.000Z",
    endedAt: null,
    completionReason: null,
    reminderCount: 0,
    lastReminderAt: null,
    nextReminderAt: null,
    ...overrides,
  };
}

function renderCard({
  openTurn = null,
  recentCompletedTurns = [],
  initialNow = "2026-07-10T10:01:00.000Z",
  refreshIntervalMs,
}: Partial<React.ComponentProps<typeof TurnTimingHistoryCard>> = {}) {
  return render(
    <TurnTimingHistoryCard
      initialNow={initialNow}
      openTurn={openTurn}
      recentCompletedTurns={recentCompletedTurns}
      refreshIntervalMs={refreshIntervalMs}
    />,
  );
}

describe("TurnTimingHistoryCard", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("renders the current open turn first and refreshes only its duration each minute", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-10T10:01:00.000Z"));

    renderCard({
      openTurn: createTurnRecord(),
      recentCompletedTurns: [
        createTurnRecord({
          id: "closed-turn",
          endedAt: "2026-07-10T10:30:00.000Z",
          completionReason: "SAVE_UPLOADED",
        }),
      ],
    });

    const table = screen.getByRole("table");
    const rows = within(table).getAllByRole("row");
    const rowGroups = within(table).getAllByRole("rowgroup");
    expect(rowGroups).toHaveLength(2);
    expect(rowGroups[0]).toBe(table.querySelector("thead"));
    expect(rowGroups[1]).toBe(table.querySelector("tbody"));
    expect(within(rows[0]).getAllByRole("columnheader")).toHaveLength(6);
    expect(within(rows[1]).getAllByRole("cell")).toHaveLength(6);
    expect(within(rows[2]).getAllByRole("cell")).toHaveLength(6);
    expect(rows[1]).toHaveClass(
      "h-16",
      "border-l-2",
      "border-l-orange-400",
      "bg-orange-400/10",
      "text-orange-100",
    );
    expect(rows[2]).toHaveClass("h-16");
    expect(within(rows[1]).getByText("Current turn")).toBeVisible();
    expect(within(rows[1]).getByText("1m")).toBeVisible();
    expect(within(rows[2]).getByText("30m")).toBeVisible();

    act(() => {
      vi.advanceTimersByTime(60 * 1000);
    });

    expect(within(rows[1]).getByText("2m")).toBeVisible();
    expect(within(rows[2]).getByText("30m")).toBeVisible();
  });

  it("initializes a newly keyed open turn from refreshed server time", () => {
    const { rerender } = render(
      <TurnTimingHistoryCard
        key="no-open-turn"
        initialNow="2026-07-10T10:01:00.000Z"
        openTurn={null}
        recentCompletedTurns={[]}
      />,
    );

    rerender(
      <TurnTimingHistoryCard
        key="turn-2"
        initialNow="2026-07-10T12:00:00.000Z"
        openTurn={createTurnRecord({ id: "turn-2" })}
        recentCompletedTurns={[]}
      />,
    );

    expect(screen.getByText("2h")).toBeVisible();
  });

  it("does not create an interval without an open turn", () => {
    vi.useFakeTimers();
    const setIntervalSpy = vi.spyOn(window, "setInterval");
    const { rerender } = renderCard({
      recentCompletedTurns: [
        createTurnRecord({
          endedAt: "2026-07-10T10:30:00.000Z",
          completionReason: "SAVE_UPLOADED",
        }),
      ],
    });

    expect(setIntervalSpy).not.toHaveBeenCalled();

    rerender(
      <TurnTimingHistoryCard
        initialNow="2026-07-10T10:01:00.000Z"
        openTurn={null}
        recentCompletedTurns={[]}
      />,
    );

    expect(setIntervalSpy).not.toHaveBeenCalled();
  });

  it("cleans up the interval when an open turn disappears", () => {
    vi.useFakeTimers();
    const clearIntervalSpy = vi.spyOn(window, "clearInterval");
    const { rerender } = renderCard({
      openTurn: createTurnRecord(),
    });

    rerender(
      <TurnTimingHistoryCard
        initialNow="2026-07-10T10:01:00.000Z"
        openTurn={null}
        recentCompletedTurns={[]}
      />,
    );

    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
  });

  it("cleans up the interval when an open card unmounts", () => {
    vi.useFakeTimers();
    const clearIntervalSpy = vi.spyOn(window, "clearInterval");
    const { unmount } = renderCard({ openTurn: createTurnRecord() });

    unmount();

    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
  });

  it("renders completion labels and nullable turn snapshots", () => {
    renderCard({
      recentCompletedTurns: [
        createTurnRecord({
          id: "saved",
          endedAt: "2026-07-10T10:01:00.000Z",
          completionReason: "SAVE_UPLOADED",
        }),
        createTurnRecord({
          id: "skipped",
          endedAt: "2026-07-10T10:02:00.000Z",
          completionReason: "SKIPPED",
        }),
        createTurnRecord({
          id: "resigned",
          endedAt: "2026-07-10T10:03:00.000Z",
          completionReason: "RESIGNED",
        }),
        createTurnRecord({
          id: "replaced",
          endedAt: "2026-07-10T10:04:00.000Z",
          completionReason: "REPLACED",
        }),
        createTurnRecord({
          id: "reassigned",
          endedAt: "2026-07-10T10:05:00.000Z",
          completionReason: "REASSIGNED",
          seatNumber: null,
          gamePlayerId: null,
          userId: null,
          playerDisplayName: "Departed player",
          reminderCount: 0,
        }),
      ],
    });

    expect(screen.getByText("Save uploaded")).toBeVisible();
    expect(screen.getByText("Skipped")).toBeVisible();
    expect(screen.getByText("Resigned")).toBeVisible();
    expect(screen.getByText("Replaced")).toBeVisible();
    expect(screen.getByText("Reassigned")).toBeVisible();
    expect(screen.getByText("No seat")).toBeVisible();
    expect(screen.getByText("Departed player")).toBeVisible();
    expect(
      within(
        within(screen.getByRole("table")).getAllByRole("row").at(-1)!,
      ).getByText("0"),
    ).toBeVisible();
  });

  it("limits completed history to 25 rows", () => {
    const completedTurns = Array.from({ length: 26 }, (_, index) =>
      createTurnRecord({
        id: `completed-${index}`,
        endedAt: "2026-07-10T10:01:00.000Z",
        completionReason: "SKIPPED",
      }),
    );

    renderCard({ recentCompletedTurns: completedTurns });

    expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(
      26,
    );
  });

  it("renders an accessible empty state without a table", () => {
    renderCard();

    expect(
      screen.getByText("No turn timings are available yet."),
    ).toHaveAttribute("role", "status");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("uses semantic time, caption, headers, and a focusable horizontal table region", () => {
    renderCard({
      openTurn: createTurnRecord(),
      recentCompletedTurns: [
        createTurnRecord({
          id: "closed-turn",
          endedAt: "2026-07-10T10:30:00.000Z",
          completionReason: "SAVE_UPLOADED",
        }),
      ],
    });

    const table = screen.getByRole("table");
    const region = screen.getByRole("region", {
      name: "Recent turn timing history table",
    });

    expect(region).toHaveAttribute("tabindex", "0");
    expect(region).toHaveClass("overflow-x-auto");
    expect(table).toHaveAttribute("role", "table");
    expect(table.querySelector("thead")).toHaveAttribute("role", "rowgroup");
    expect(table.querySelector("tbody")).toHaveAttribute("role", "rowgroup");
    expect(table.querySelector("thead")).not.toHaveAttribute("aria-hidden");
    expect(table.querySelector("thead")).not.toHaveAttribute("hidden");
    expect(
      Array.from(table.querySelectorAll("tr"), (row) =>
        row.getAttribute("role"),
      ),
    ).toEqual(["row", "row", "row"]);
    expect(
      Array.from(table.querySelectorAll("thead th"), (header) =>
        header.getAttribute("role"),
      ),
    ).toEqual([
      "columnheader",
      "columnheader",
      "columnheader",
      "columnheader",
      "columnheader",
      "columnheader",
    ]);
    expect(
      Array.from(table.querySelectorAll("thead th"), (header) =>
        header.getAttribute("scope"),
      ).every((scope) => scope === "col"),
    ).toBe(true);
    expect(within(table).getByText("Recent turn timing history")).toBe(
      table.querySelector("caption"),
    );
    expect(table).toHaveClass(
      "history-table",
      "history-table--stacked",
      "sm:min-w-[38rem]",
    );
    expect(
      Array.from(table.querySelectorAll("tbody td"), (cell) =>
        cell.getAttribute("data-label"),
      ),
    ).toEqual([
      "Turn",
      "Player",
      "Timeline",
      "Duration",
      "Result",
      "Reminders",
      "Turn",
      "Player",
      "Timeline",
      "Duration",
      "Result",
      "Reminders",
    ]);
    expect(
      within(table).queryByRole("columnheader", { name: "Completed" }),
    ).toBe(null);
    const turnHeader = within(table).getByRole("columnheader", {
      name: "Turn",
    });
    expect(turnHeader).toHaveAttribute("role", "columnheader");
    expect(turnHeader).toHaveAttribute("scope", "col");
    expect(turnHeader.closest("tr")).toHaveClass("h-10");
    expect(
      within(table)
        .getAllByRole("cell")
        .every((cell) => cell.hasAttribute("role")),
    ).toBe(true);

    expect(
      table.querySelector('time[datetime="2026-07-10T10:00:00.000Z"]'),
    ).toBeInTheDocument();
    expect(
      table.querySelector('time[datetime="2026-07-10T10:30:00.000Z"]'),
    ).toBeInTheDocument();
    expect(within(table).getAllByText(/ UTC$/)).toHaveLength(3);
  });

  it("renders Unknown for malformed turn timestamps and durations", () => {
    renderCard({
      openTurn: createTurnRecord({ startedAt: "not-a-timestamp" }),
    });

    expect(screen.getAllByText("Unknown")).toHaveLength(2);
    expect(
      document.querySelector('time[datetime="not-a-timestamp"]'),
    ).not.toBeInTheDocument();
  });
});

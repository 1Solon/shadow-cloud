import { describe, expect, it } from "vitest";
import type { GameTurnRecord } from "@/lib/shadow-cloud-api";
import {
  formatCompletionReason,
  formatTurnDuration,
  formatTurnTimestamp,
  getTurnDurationMs,
} from "@/lib/turn-timing";

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

describe("getTurnDurationMs", () => {
  it("uses endedAt for completed turns", () => {
    expect(
      getTurnDurationMs(
        createTurnRecord({ endedAt: "2026-07-10T11:30:00.000Z" }),
        new Date("2026-07-10T15:00:00.000Z"),
      ),
    ).toBe(90 * 60 * 1000);
  });

  it("uses injected now for an open turn", () => {
    expect(
      getTurnDurationMs(
        createTurnRecord(),
        new Date("2026-07-10T10:45:00.000Z"),
      ),
    ).toBe(45 * 60 * 1000);
  });

  it("clamps negative durations to zero", () => {
    expect(
      getTurnDurationMs(
        createTurnRecord({ startedAt: "2026-07-10T11:00:00.000Z" }),
        new Date("2026-07-10T10:00:00.000Z"),
      ),
    ).toBe(0);
  });

  it("returns null for malformed timestamps", () => {
    expect(
      getTurnDurationMs(
        createTurnRecord({ startedAt: "not-a-timestamp" }),
        new Date("2026-07-10T10:00:00.000Z"),
      ),
    ).toBeNull();
  });
});

describe("formatTurnDuration", () => {
  it.each([
    [59 * 1000, "<1m"],
    [59 * 60 * 1000, "59m"],
    [60 * 60 * 1000, "1h"],
    [24 * 60 * 60 * 1000, "1d"],
  ])("formats %i milliseconds as %s", (milliseconds, expected) => {
    expect(formatTurnDuration(milliseconds)).toBe(expected);
  });

  it("returns Unknown for invalid durations", () => {
    expect(formatTurnDuration(null)).toBe("Unknown");
    expect(formatTurnDuration(Number.NaN)).toBe("Unknown");
    expect(formatTurnDuration(Number.POSITIVE_INFINITY)).toBe("Unknown");
  });
});

describe("formatTurnTimestamp", () => {
  it("uses the real-world US medium date and short UTC time", () => {
    expect(formatTurnTimestamp("2026-07-10T10:30:00.000Z")).toBe(
      "Jul 10, 2026, 10:30 AM UTC",
    );
  });

  it("returns Unknown for malformed timestamps", () => {
    expect(formatTurnTimestamp("not-a-timestamp")).toBe("Unknown");
  });
});

describe("formatCompletionReason", () => {
  it.each([
    ["SAVE_UPLOADED", "Save uploaded"],
    ["SKIPPED", "Skipped"],
    ["RESIGNED", "Resigned"],
    ["REPLACED", "Replaced"],
    ["REASSIGNED", "Reassigned"],
    [null, "In progress"],
  ] as const)("formats %s as %s", (reason, expected) => {
    expect(formatCompletionReason(reason)).toBe(expected);
  });
});

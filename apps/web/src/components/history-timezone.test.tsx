// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, cleanup, render } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { WorldStateHistoryCard } from "./world-state-history-card";
import { TurnTimingHistoryCard } from "./turn-timing-history-card";
import { LocalTimestamp } from "./local-timestamp";

vi.mock("@/components/download-save-button", () => ({
  DownloadSaveButton: () => null,
}));
vi.mock("@/components/replace-save-file-action", () => ({
  ReplaceSaveFileAction: () => null,
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("hydrates UTC server markup into browser-local time without mismatches", async () => {
  const DateTimeFormat = Intl.DateTimeFormat;
  vi.spyOn(Intl, "DateTimeFormat").mockImplementation(
    function (locale, options) {
      return new DateTimeFormat(locale, {
        timeZone: "Australia/Sydney",
        ...options,
      });
    },
  );
  const timestamp = "2026-08-10T23:45:00.000Z";
  const element = <LocalTimestamp timestamp={timestamp} />;
  const container = document.createElement("div");
  container.innerHTML = renderToString(element);
  expect(container.textContent).toBe("Aug 10, 2026, 11:45 PM UTC");
  const onRecoverableError = vi.fn();
  let root: ReturnType<typeof hydrateRoot>;
  await act(async () => {
    root = hydrateRoot(container, element, { onRecoverableError });
  });
  try {
    expect(container.textContent).toBe("Aug 11, 2026, 9:45 AM local");
    expect(container.querySelector("time")).toHaveAttribute(
      "title",
      "Aug 11, 2026, 9:45 AM local",
    );
    expect(onRecoverableError).not.toHaveBeenCalled();
  } finally {
    await act(async () => root.unmount());
  }
});

it("renders an invalid timestamp as Unknown", () => {
  const { container } = render(<LocalTimestamp timestamp="invalid" />);
  expect(container.textContent).toBe("Unknown");
  expect(container.querySelector("time")).toBeNull();
});

it.each(["Australia/Sydney", "America/New_York"])(
  "renders both histories in the browser timezone (%s), including date rollover and DST",
  (timeZone) => {
    const DateTimeFormat = Intl.DateTimeFormat;
    vi.spyOn(Intl, "DateTimeFormat").mockImplementation(
      function (locale, options) {
        return new DateTimeFormat(locale, { timeZone, ...options });
      },
    );
    const startedAt = "2026-08-10T23:45:00.000Z";
    const endedAt = "2026-12-10T01:45:00.000Z";
    const { container } = render(
      <>
        <WorldStateHistoryCard
          currentUserId={null}
          gameNumber={42}
          isShadowOverrideUser={false}
          shadowOverrideEnabled={false}
          fileVersions={[
            {
              id: "save-1",
              originalName: "save.se1",
              uploadedAt: startedAt,
              uploadedById: "player-1",
              uploadedByDisplayName: "Player",
              contentHash: null,
              idempotencyKey: null,
              replacedAt: endedAt,
              replacedByDisplayName: "Player",
            },
          ]}
        />
        <TurnTimingHistoryCard
          initialNow={endedAt}
          openTurn={null}
          recentCompletedTurns={[
            {
              id: "turn-1",
              roundNumber: 1,
              gamePlayerId: "seat-1",
              userId: "player-1",
              seatNumber: 1,
              playerDisplayName: "Player",
              startedAt,
              endedAt,
              completionReason: "SAVE_UPLOADED",
              reminderCount: 0,
              lastReminderAt: null,
              nextReminderAt: null,
            },
          ]}
        />
      </>,
    );
    const times = container.querySelectorAll("time");
    expect(times).toHaveLength(4);
    times.forEach((time, index) => {
      const timestamp = index % 2 === 0 ? startedAt : endedAt;
      const options: Intl.DateTimeFormatOptions =
        index < 2
          ? { dateStyle: "medium", timeStyle: "short" }
          : {
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            };
      expect(time).toHaveAttribute("datetime", timestamp);
      expect(time.textContent).toBe(
        `${new DateTimeFormat("en-US", {
          ...options,
          timeZone,
        }).format(new Date(timestamp))} local`,
      );
    });
  },
);

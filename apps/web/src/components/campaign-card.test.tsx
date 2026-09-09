// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CampaignCard,
  formatRelativeTimestamp,
} from "@/components/campaign-card";
import type { GameListItem } from "@/lib/shadow-cloud-api";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

vi.mock("@/components/download-save-button", () => ({
  DownloadSaveButton: ({
    fileName,
    href,
    label,
  }: {
    fileName: string;
    href: string;
    label?: string;
  }) => (
    <button data-file-name={fileName} data-href={href} type="button">
      {label ?? "Download"}
    </button>
  ),
}));

vi.mock("@/components/save-upload-card", () => ({
  SaveUploadCard: () => <div>Save upload modal</div>,
}));

const game: GameListItem = {
  id: "game-42",
  slug: "dust-crown",
  gameNumber: 42,
  name: "Dust Crown",
  organizerDisplayName: "Solon",
  updatedAt: "2026-07-10T00:00:00.000Z",
  roundNumber: 4,
  activePlayerUserId: "user-1",
  activePlayerDisplayName: "Rhea",
  playerCount: 4,
  filledSeatCount: 4,
  participantUserIds: ["user-1"],
  turnTargetHours: 24,
  turnReminderGraceHours: 12,
  turnReminderRepeatHours: 6,
  turnRemindersEnabled: true,
  currentTurnStartedAt: "2026-07-10T00:00:00.000Z",
  latestSave: {
    id: "file-latest",
    originalName: "42-T4-S1-Rhea.se1",
  },
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  push.mockReset();
});

describe("CampaignCard", () => {
  it("keeps unavailable timing visible and applies the individual view's validity rules", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-10T02:00:00.000Z"));
    const { rerender } = render(<CampaignCard game={game} />);
    for (const turnTargetHours of [
      0,
      -1,
      1.5,
      NaN,
      Infinity,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      rerender(<CampaignCard game={{ ...game, turnTargetHours }} />);
      expect(screen.getByText("2h / Unknown")).toBeVisible();
    }
    for (const currentTurnStartedAt of [null, "invalid-start"]) {
      rerender(<CampaignCard game={{ ...game, currentTurnStartedAt }} />);
      expect(screen.getByText("Unknown / 24h")).toBeVisible();
    }
    rerender(
      <CampaignCard
        game={{ ...game, currentTurnStartedAt: "2026-07-11T00:00:00.000Z" }}
      />,
    );
    expect(screen.getByText("<1m / 24h")).toBeVisible();
  });

  it("shows current turn elapsed / target and refreshes elapsed each minute", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-10T00:59:00.000Z"));
    render(<CampaignCard game={game} />);

    expect(screen.getByText("Elapsed / target")).toBeVisible();
    expect(screen.getByText("59m / 24h")).toBeVisible();
    act(() => vi.advanceTimersByTime(60_000));
    expect(screen.getByText("1h / 24h")).toBeVisible();
  });

  it("places the latest-turn download to the left of the upload action", async () => {
    const user = userEvent.setup();
    render(<CampaignCard currentUserId="user-1" game={game} />);

    const download = screen.getByRole("button", {
      name: "Download latest turn",
    });
    const upload = screen.getByRole("button", { name: "> Upload your turn" });

    expect(download).toHaveAttribute("data-file-name", "42-T4-S1-Rhea.se1");
    expect(download).toHaveAttribute(
      "data-href",
      "/api/games/42/files/file-latest",
    );
    expect(download.compareDocumentPosition(upload)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );

    await user.click(download);
    expect(push).not.toHaveBeenCalled();
  });

  it("disables the download action when the current turn has no save", () => {
    render(
      <CampaignCard
        currentUserId="user-1"
        game={{ ...game, latestSave: null }}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Download latest turn" }),
    ).toBeDisabled();
  });

  it("does not show turn actions to another player", () => {
    render(<CampaignCard currentUserId="user-2" game={game} />);

    expect(
      screen.queryByRole("button", { name: "Download latest turn" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "> Upload your turn" }),
    ).not.toBeInTheDocument();
  });

  it("shows one Overlord value and keeps the exact update timestamp available", () => {
    render(<CampaignCard currentUserId="user-2" game={game} />);

    expect(screen.getAllByText("Overlord", { exact: true })).toHaveLength(1);

    const updated = screen.getByTitle(`Updated ${game.updatedAt}`);
    expect(updated).toHaveAttribute("dateTime", game.updatedAt);
    expect(updated).toHaveAccessibleName(`Updated ${game.updatedAt}`);
  });

  it("formats relative update times from a supplied clock", () => {
    const now = Date.parse("2026-07-10T02:00:00.000Z");

    expect(formatRelativeTimestamp(game.updatedAt, now)).toBe("2 hours ago");
    expect(formatRelativeTimestamp("2026-07-10T02:05:00.000Z", now)).toBe(
      "in 5 minutes",
    );
  });
});

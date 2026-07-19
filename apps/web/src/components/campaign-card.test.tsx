// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CampaignCard } from "@/components/campaign-card";
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
  push.mockReset();
});

describe("CampaignCard", () => {
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
});

// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/upload-save-form", () => ({
  UploadSaveForm: ({
    gameNumber,
    presentation,
  }: {
    gameNumber: number;
    presentation?: string;
  }) => (
    <div
      data-game-number={gameNumber}
      data-presentation={presentation}
      data-testid="upload-save-form"
    />
  ),
}));

vi.mock("@/components/download-save-button", () => ({
  DownloadSaveButton: ({
    className,
    fileName,
    href,
  }: {
    className: string;
    fileName: string;
    href: string;
  }) => (
    <button
      className={className}
      data-file-name={fileName}
      data-href={href}
      data-testid="download-save-button"
    >
      Download
    </button>
  ),
}));

import { TurnCommandCenter } from "@/components/turn-command-center";

const latestSave = {
  id: "file-8",
  originalName: "rhea-round-4.Civ6Save",
  uploadedAt: "2026-07-11T11:45:00.000Z",
  uploadedByDisplayName: "Rhea",
};

const defaultProps: React.ComponentProps<typeof TurnCommandCenter> = {
  activePlayerDisplayName: "Rhea",
  activeSeatNumber: 2,
  canDownloadLatestSave: true,
  currentTurnStartedAt: "2026-07-11T11:01:00.000Z",
  gameNumber: 42,
  initialNow: "2026-07-11T12:00:00.000Z",
  isActivePlayer: true,
  isSignedIn: true,
  latestSave,
  roundNumber: 4,
  turnTargetHours: 24,
};

function renderCommandCenter(
  overrides: Partial<React.ComponentProps<typeof TurnCommandCenter>> = {},
) {
  return render(<TurnCommandCenter {...defaultProps} {...overrides} />);
}

describe("TurnCommandCenter", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("gives the active signed-in player status, metrics, latest save, and controls", () => {
    renderCommandCenter();

    expect(screen.getByText("YOUR TURN")).toBeVisible();
    expect(screen.getByText("Rhea")).toBeVisible();
    expect(screen.getByText("Seat 2")).toBeVisible();
    expect(screen.getByText("Round 4")).toBeVisible();
    expect(screen.getByText("59m / 24h")).toBeVisible();
    expect(screen.getByText(latestSave.originalName)).toBeVisible();
    expect(screen.getByText("Uploaded by Rhea")).toBeVisible();
    expect(screen.getByText("Jul 11, 2026, 11:45 AM UTC")).toBeVisible();

    const download = screen.getByTestId("download-save-button");
    expect(download).toHaveAttribute("data-file-name", latestSave.originalName);
    expect(download).toHaveAttribute("data-href", "/api/games/42/files/file-8");
    expect(download.className).toContain("font-mono");

    const uploader = screen.getByTestId("upload-save-form");
    expect(uploader).toHaveAttribute("data-game-number", "42");
    expect(uploader).toHaveAttribute("data-presentation", "compact");
  });

  it("shows the exact empty-save copy while preserving the active upload action", () => {
    renderCommandCenter({ latestSave: null });

    expect(
      screen.getByText("No save has been uploaded for this campaign yet."),
    ).toBeVisible();
    expect(
      screen.queryByTestId("download-save-button"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("upload-save-form")).toBeVisible();
  });

  it("shows latest-save metadata without a download when access is denied", () => {
    renderCommandCenter({ canDownloadLatestSave: false });

    expect(screen.getByText(latestSave.originalName)).toBeVisible();
    expect(screen.getByText("Uploaded by Rhea")).toBeVisible();
    expect(screen.getByText("Jul 11, 2026, 11:45 AM UTC")).toBeVisible();
    expect(
      screen.queryByTestId("download-save-button"),
    ).not.toBeInTheDocument();
  });

  it("shows a signed-in non-active player the waiting state and public download only", () => {
    renderCommandCenter({ isActivePlayer: false });

    expect(screen.getByText("WAITING")).toBeVisible();
    expect(screen.getByText("Rhea")).toBeVisible();
    expect(screen.getByText("Seat 2")).toBeVisible();
    expect(screen.getByText(/waiting for rhea/i)).toBeVisible();
    expect(screen.getByTestId("download-save-button")).toBeVisible();
    expect(screen.queryByTestId("upload-save-form")).not.toBeInTheDocument();
  });

  it("shows visitors a concise sign-in message and public download only", () => {
    renderCommandCenter({ isSignedIn: false });

    expect(screen.getByText("WAITING")).toBeVisible();
    expect(screen.getByText(/sign in/i)).toBeVisible();
    expect(screen.getByTestId("download-save-button")).toBeVisible();
    expect(screen.queryByTestId("upload-save-form")).not.toBeInTheDocument();
  });

  it("renders nullable seat and start values without throwing", () => {
    renderCommandCenter({ activeSeatNumber: null, currentTurnStartedAt: null });

    expect(screen.getByText("Seat unknown")).toBeVisible();
    expect(screen.getByText("Unknown / 24h")).toBeVisible();
  });

  it("renders malformed time and target values as Unknown without invalid time markup", () => {
    renderCommandCenter({
      currentTurnStartedAt: "invalid-start",
      initialNow: "invalid-now",
      latestSave: { ...latestSave, uploadedAt: "invalid-upload" },
      turnTargetHours: Number.NaN,
    });

    expect(screen.getByText("Unknown / Unknown")).toBeVisible();
    expect(screen.getByText("Unknown")).toBeVisible();
    expect(document.querySelector("time")).not.toBeInTheDocument();
  });

  it.each([
    [0, "zero"],
    [-1, "negative"],
    [1.5, "fractional"],
    [Number.POSITIVE_INFINITY, "infinite"],
    [Number.MAX_SAFE_INTEGER + 1, "unsafe"],
  ])("renders an %s (%s) target as Unknown", (turnTargetHours) => {
    renderCommandCenter({ turnTargetHours });

    expect(screen.getByText("59m / Unknown")).toBeVisible();
  });

  it("does not start a refresh interval for a malformed turn start", () => {
    vi.useFakeTimers();
    const setIntervalSpy = vi.spyOn(window, "setInterval");

    renderCommandCenter({ currentTurnStartedAt: "invalid-start" });

    expect(screen.getByText("Unknown / 24h")).toBeVisible();
    expect(setIntervalSpy).not.toHaveBeenCalled();
  });

  it("clears the refresh interval when a valid turn start becomes null", () => {
    vi.useFakeTimers();
    const clearIntervalSpy = vi.spyOn(window, "clearInterval");
    const { rerender } = renderCommandCenter();

    rerender(
      <TurnCommandCenter {...defaultProps} currentTurnStartedAt={null} />,
    );

    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Unknown / 24h")).toBeVisible();
  });

  it("refreshes elapsed time each minute and clears its interval on unmount", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-11T12:00:00.000Z"));
    const clearIntervalSpy = vi.spyOn(window, "clearInterval");
    const { unmount } = renderCommandCenter();

    expect(screen.getByText("59m / 24h")).toBeVisible();

    act(() => {
      vi.advanceTimersByTime(60 * 1000 - 1);
    });

    expect(screen.getByText("59m / 24h")).toBeVisible();

    act(() => {
      vi.advanceTimersByTime(1);
    });

    expect(screen.getByText("1h / 24h")).toBeVisible();
    unmount();
    expect(clearIntervalSpy).toHaveBeenCalledTimes(1);
  });

  it("uses one terminal panel with a responsive command-center body", () => {
    const { container } = renderCommandCenter();
    const panel = container.firstElementChild;

    expect(panel).toHaveClass(
      "rounded-lg",
      "border",
      "border-orange-400/40",
      "bg-black",
    );
    expect(
      within(panel as HTMLElement).getByTestId("command-center-body"),
    ).toHaveClass("lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]");
    expect(screen.getByRole("region", { name: "Current turn" })).toBe(panel);
    expect(screen.getByRole("heading", { name: "Current turn" })).toHaveClass(
      "sr-only",
    );
  });
});

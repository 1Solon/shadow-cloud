// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/download-save-button", () => ({
  DownloadSaveButton: ({
    fileName,
    href,
  }: {
    className: string;
    fileName: string;
    href: string;
  }) => (
    <button data-file-name={fileName} data-href={href} data-testid="quick-download">
      Download
    </button>
  ),
}));

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

import { TurnCommandCenter } from "@/components/turn-command-center";

const defaultProps: React.ComponentProps<typeof TurnCommandCenter> = {
  activePlayerDisplayName: "Rhea",
  activeSeatNumber: 2,
  currentTurnStartedAt: "2026-07-11T11:01:00.000Z",
  gameNumber: 42,
  initialNow: "2026-07-11T12:00:00.000Z",
  isActivePlayer: true,
  isSignedIn: true,
  latestSave: {
    id: "save-9",
    originalName: "42-T4-S2-Rhea.se1",
  },
  notes: "Hold the **western** pass.",
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

  it("gives the active signed-in player status, metrics, campaign notes, and upload action", () => {
    renderCommandCenter();

    expect(screen.getByText("YOUR TURN")).toBeVisible();
    expect(screen.getByText("Rhea")).toBeVisible();
    expect(screen.getByText("Seat 2")).toBeVisible();
    expect(screen.getByText("Round 4")).toBeVisible();
    expect(screen.getByText("59m / 24h")).toBeVisible();
    expect(screen.getByText("Campaign notes")).toBeVisible();
    expect(screen.getByText("western").tagName).toBe("STRONG");
    expect(screen.getByText("Latest save")).toBeVisible();
    expect(screen.getByText("42-T4-S2-Rhea.se1")).toBeVisible();
    const quickDownload = screen.getByTestId("quick-download");
    expect(quickDownload).toHaveAttribute(
      "data-file-name",
      "42-T4-S2-Rhea.se1",
    );
    expect(quickDownload).toHaveAttribute(
      "data-href",
      "/api/games/42/files/save-9",
    );

    const uploader = screen.getByTestId("upload-save-form");
    expect(uploader).toHaveAttribute("data-game-number", "42");
    expect(uploader).toHaveAttribute("data-presentation", "compact");
  });

  it("omits quick download when there is no save file", () => {
    renderCommandCenter({ latestSave: null });

    expect(screen.queryByText("Latest save")).not.toBeInTheDocument();
    expect(screen.queryByTestId("quick-download")).not.toBeInTheDocument();
    expect(screen.getByTestId("upload-save-form")).toBeVisible();
  });

  it("shows a signed-in non-active player the waiting state without actions", () => {
    renderCommandCenter({ isActivePlayer: false });

    expect(screen.getByText("WAITING")).toBeVisible();
    expect(screen.getByText("Rhea")).toBeVisible();
    expect(screen.getByText("Seat 2")).toBeVisible();
    expect(screen.getByText("Campaign notes")).toBeVisible();
    expect(screen.getByText("western").tagName).toBe("STRONG");
    expect(screen.queryByText(/waiting for rhea/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId("upload-save-form")).not.toBeInTheDocument();
  });

  it("shows visitors the waiting state without actions", () => {
    renderCommandCenter({ isSignedIn: false });

    expect(screen.getByText("WAITING")).toBeVisible();
    expect(screen.getByText("Campaign notes")).toBeVisible();
    expect(screen.getByText("western").tagName).toBe("STRONG");
    expect(
      screen.queryByText(
        "Sign in to participate when the campaign reaches your turn.",
      ),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("upload-save-form")).not.toBeInTheDocument();
  });

  it("shows the campaign notes empty state for whitespace-only notes", () => {
    renderCommandCenter({ notes: "  \n " });

    expect(screen.getByText("Campaign notes")).toBeVisible();
    expect(screen.getByText("No campaign notes recorded.")).toBeVisible();
  });

  it("renders nullable seat and start values without throwing", () => {
    renderCommandCenter({ activeSeatNumber: null, currentTurnStartedAt: null });

    expect(screen.getByText("Seat unknown")).toBeVisible();
    expect(screen.getByText("Unknown / 24h")).toBeVisible();
  });

  it("renders malformed time and target values as Unknown", () => {
    renderCommandCenter({
      currentTurnStartedAt: "invalid-start",
      initialNow: "invalid-now",
      turnTargetHours: Number.NaN,
    });

    expect(screen.getByText("Unknown / Unknown")).toBeVisible();
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

  it("uses a two-column action layout only for the active player", () => {
    const { container, rerender } = renderCommandCenter();
    const panel = container.firstElementChild;
    const body = within(panel as HTMLElement).getByTestId(
      "command-center-body",
    );

    expect(panel).toHaveClass(
      "rounded-lg",
      "border",
      "border-orange-400/40",
      "bg-black",
    );
    expect(body).toHaveClass(
      "grid",
      "lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]",
    );

    rerender(<TurnCommandCenter {...defaultProps} isActivePlayer={false} />);

    expect(body).not.toHaveClass(
      "grid",
      "lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]",
    );
    expect(screen.getByRole("region", { name: "Current turn" })).toBe(panel);
    expect(screen.getByRole("heading", { name: "Current turn" })).toHaveClass(
      "sr-only",
    );
  });
});

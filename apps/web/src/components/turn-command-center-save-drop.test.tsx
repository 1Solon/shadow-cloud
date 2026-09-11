// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TurnCommandCenter } from "@/components/turn-command-center";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }),
}));

const defaultProps = {
  activePlayerDisplayName: "zarohn",
  activeSeatNumber: 4,
  currentTurnStartedAt: null,
  gameNumber: 281,
  initialNow: "2026-09-11T12:00:00.000Z",
  isActivePlayer: true,
  isSignedIn: true,
  latestSave: {
    contentRevision: 1,
    id: "save-9",
    originalName: "281-T9-S4-zarohn.se1",
  },
  notes: "",
  roundNumber: 9,
  saveBaseline: "campaign:9:4",
  turnTargetHours: 24,
};

function renderCommandCenter(
  overrides: Partial<React.ComponentProps<typeof TurnCommandCenter>> = {},
) {
  render(<TurnCommandCenter {...defaultProps} {...overrides} />);
}

describe("TurnCommandCenter save drops", () => {
  afterEach(cleanup);

  it("stages an active player's save dropped beside the dashed upload target", () => {
    renderCommandCenter();
    const save = new File(["save"], "281-T9-S4-complete.se1");

    const accepted = fireEvent.drop(screen.getByText("Latest save"), {
      dataTransfer: { files: [save], types: ["Files"] },
    });

    expect(accepted).toBe(false);
    expect(
      screen.getByRole("button", {
        name: "Selected save file 281-T9-S4-complete.se1",
      }),
    ).toBeInTheDocument();
  });

  it("blocks browser file navigation when it is another lord's turn", () => {
    renderCommandCenter({ isActivePlayer: false });
    const save = new File(["save"], "281-T9-S4-complete.se1");

    const accepted = fireEvent.drop(screen.getByText("Latest save"), {
      dataTransfer: { files: [save], types: ["Files"] },
    });

    expect(accepted).toBe(false);
    expect(screen.getByRole("status")).toHaveTextContent(
      "It is currently zarohn’s turn. Only the active lord can upload this save.",
    );
  });

  it("blocks browser file navigation and prompts guests to sign in", () => {
    renderCommandCenter({ isActivePlayer: false, isSignedIn: false });
    const save = new File(["save"], "281-T9-S4-complete.se1");

    const accepted = fireEvent.drop(screen.getByText("Latest save"), {
      dataTransfer: { files: [save], types: ["Files"] },
    });

    expect(accepted).toBe(false);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Sign in with the Discord account for zarohn to upload this save.",
    );
  });
});

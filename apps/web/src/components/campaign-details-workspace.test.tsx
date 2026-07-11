// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { type ReactNode, useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CampaignDetailsWorkspace } from "@/components/campaign-details-workspace";

const mocks = vi.hoisted(() => ({
  briefing: vi.fn(),
  settings: vi.fn(),
  seatOrder: vi.fn(),
  notes: vi.fn(),
  dirtyCallbacks: [] as Array<(dirty: boolean) => void>,
}));

vi.mock("@/components/campaign-briefing", () => ({
  CampaignBriefing: (props: unknown) => {
    mocks.briefing(props);
    return <div data-testid="briefing" />;
  },
}));

vi.mock("@/components/campaign-configuration-shell", () => ({
  CampaignConfigurationShell: ({
    onExit,
    renderSection,
  }: {
    onExit: () => void;
    renderSection: (
      section: "identity" | "world" | "turn-protocol" | "seat-order" | "notes",
      editorStateProps: { onDirtyChange: (dirty: boolean) => void },
    ) => ReactNode;
  }) => {
    const [activeEditor, setActiveEditor] = useState<ReactNode>(null);
    const [isDirty, setIsDirty] = useState(false);

    return (
      <div data-testid="configuration-shell">
        <button disabled={isDirty} onClick={onExit}>
          Exit mock shell
        </button>
        {isDirty ? <p role="status">Dirty mock editor</p> : null}
        {(
          ["identity", "world", "turn-protocol", "seat-order", "notes"] as const
        ).map((section) => (
          <button
            key={section}
            onClick={() => {
              const onDirtyChange = vi.fn(setIsDirty);
              mocks.dirtyCallbacks.push(onDirtyChange);
              setActiveEditor(renderSection(section, { onDirtyChange }));
            }}
          >
            Open {section}
          </button>
        ))}
        {activeEditor}
      </div>
    );
  },
}));

vi.mock("@/components/campaign-settings-editor", () => ({
  CampaignSettingsEditor: (props: unknown) => {
    mocks.settings(props);
    const { onDirtyChange } = props as {
      onDirtyChange: (dirty: boolean) => void;
    };
    return (
      <div data-testid="settings-editor">
        <button onClick={() => onDirtyChange(true)}>
          Dirty settings draft
        </button>
      </div>
    );
  },
}));

vi.mock("@/components/seat-order-editor", () => ({
  SeatOrderEditor: (props: unknown) => {
    mocks.seatOrder(props);
    return <div data-testid="seat-order-editor" />;
  },
}));

vi.mock("@/components/campaign-notes-editor", () => ({
  CampaignNotesEditor: (props: unknown) => {
    mocks.notes(props);
    return <div data-testid="notes-editor" />;
  },
}));

const props = {
  activePlayerEntryId: "seat-2",
  armyCount: "ONE_PER_ZONE",
  canEdit: true,
  dlcMode: "NONE",
  gameMode: "TEAMS",
  gameNumber: 42,
  hasAiPlayers: false,
  name: "Campaign 42",
  notes: "Hold the pass.",
  organizerDisplayName: "Overlord",
  playerCount: 2,
  players: [
    {
      id: "seat-1",
      userId: "organizer-1",
      displayName: "Overlord",
      turnOrder: 1,
      isOrganizer: true,
    },
    {
      id: "seat-2",
      userId: "player-2",
      displayName: "Rhea",
      turnOrder: 2,
      isOrganizer: false,
    },
  ],
  roundNumber: 4,
  techLevel: 4,
  turnReminderGraceHours: 12,
  turnReminderRepeatHours: 6,
  turnRemindersEnabled: true,
  turnTargetHours: 24,
  zoneCount: "TWO_ZONE_START",
};

describe("CampaignDetailsWorkspace", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    mocks.dirtyCallbacks.length = 0;
  });

  it("shows one briefing surface and one configure action only to editors", () => {
    const { rerender } = render(<CampaignDetailsWorkspace {...props} />);

    expect(screen.getByTestId("campaign-details-workspace")).toContainElement(
      screen.getByTestId("briefing"),
    );
    expect(
      screen.getAllByRole("button", { name: "Configure campaign" }),
    ).toHaveLength(1);
    expect(mocks.briefing).toHaveBeenLastCalledWith(
      expect.objectContaining({
        activePlayerEntryId: props.activePlayerEntryId,
        name: props.name,
        players: props.players,
        notes: props.notes,
      }),
    );

    rerender(<CampaignDetailsWorkspace {...props} canEdit={false} />);
    expect(
      screen.queryByRole("button", { name: "Configure campaign" }),
    ).not.toBeInTheDocument();
  });

  it("opens configuration, hides briefing, and exits back to briefing", () => {
    render(<CampaignDetailsWorkspace {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Configure campaign" }));

    expect(screen.getByTestId("configuration-shell")).toBeInTheDocument();
    expect(screen.queryByTestId("briefing")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Exit mock shell" }));
    expect(screen.getByTestId("briefing")).toBeInTheDocument();
  });

  it.each(["identity", "world", "turn-protocol"] as const)(
    "maps %s to exactly one settings editor with the exact dirty callback",
    (section) => {
      render(<CampaignDetailsWorkspace {...props} />);
      fireEvent.click(
        screen.getByRole("button", { name: "Configure campaign" }),
      );
      fireEvent.click(screen.getByRole("button", { name: `Open ${section}` }));

      expect(screen.getAllByTestId("settings-editor")).toHaveLength(1);
      expect(screen.queryByTestId("seat-order-editor")).not.toBeInTheDocument();
      expect(screen.queryByTestId("notes-editor")).not.toBeInTheDocument();
      expect(mocks.settings).toHaveBeenLastCalledWith({
        armyCount: props.armyCount,
        dlcMode: props.dlcMode,
        gameMode: props.gameMode,
        gameNumber: props.gameNumber,
        hasAiPlayers: props.hasAiPlayers,
        name: props.name,
        organizerDisplayName: props.organizerDisplayName,
        playerCount: props.playerCount,
        players: props.players,
        roundNumber: props.roundNumber,
        section,
        techLevel: props.techLevel,
        turnReminderGraceHours: props.turnReminderGraceHours,
        turnReminderRepeatHours: props.turnReminderRepeatHours,
        turnRemindersEnabled: props.turnRemindersEnabled,
        turnTargetHours: props.turnTargetHours,
        zoneCount: props.zoneCount,
        onDirtyChange: mocks.dirtyCallbacks.at(-1),
      });
    },
  );

  it("maps seat order and notes to their single purpose-built editors", () => {
    render(<CampaignDetailsWorkspace {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Configure campaign" }));

    fireEvent.click(screen.getByRole("button", { name: "Open seat-order" }));
    expect(mocks.seatOrder).toHaveBeenLastCalledWith({
      activePlayerEntryId: props.activePlayerEntryId,
      canEdit: true,
      gameNumber: 42,
      players: props.players,
      presentation: "configuration",
      onDirtyChange: mocks.dirtyCallbacks.at(-1),
    });

    fireEvent.click(screen.getByRole("button", { name: "Open notes" }));
    expect(mocks.notes).toHaveBeenLastCalledWith({
      gameNumber: 42,
      notes: props.notes,
      onDirtyChange: mocks.dirtyCallbacks.at(-1),
    });
  });

  it("immediately returns to briefing when edit permission is lost", () => {
    const { rerender } = render(<CampaignDetailsWorkspace {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Configure campaign" }));
    fireEvent.click(screen.getByRole("button", { name: "Open identity" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Dirty settings draft" }),
    );
    expect(screen.getByRole("status")).toHaveTextContent("Dirty mock editor");
    expect(
      screen.getByRole("button", { name: "Exit mock shell" }),
    ).toBeDisabled();

    rerender(<CampaignDetailsWorkspace {...props} canEdit={false} />);

    expect(screen.getByTestId("briefing")).toBeInTheDocument();
    expect(screen.queryByTestId("configuration-shell")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Configure campaign" }),
    ).not.toBeInTheDocument();
  });
});

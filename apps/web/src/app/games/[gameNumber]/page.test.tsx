import {
  Children,
  isValidElement,
  type ComponentProps,
  type ReactElement,
  type ReactNode,
} from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdministratorActionsCard } from "@/components/administrator-actions-card";
import { CampaignWorkspaceTabs } from "@/components/campaign-workspace-tabs";
import { GameMetadataCard } from "@/components/game-metadata-card";
import { GameNotesCard } from "@/components/game-notes-card";
import { SeatOrderEditor } from "@/components/seat-order-editor";
import { TerminalConfirmationModal } from "@/components/terminal-confirmation-modal";
import { TurnCommandCenter } from "@/components/turn-command-center";
import { TurnTimingHistoryCard } from "@/components/turn-timing-history-card";
import { WorldStateHistoryCard } from "@/components/world-state-history-card";
import type {
  GameDetail,
  GameDetailFileVersion,
  GameTurnRecord,
} from "@/lib/shadow-cloud-api";

const mocks = vi.hoisted(() => ({
  getGameDetail: vi.fn(),
  getServerAuthSession: vi.fn(),
  getShadowOverrideEnabled: vi.fn(),
}));

vi.mock("next/navigation", () => ({ notFound: vi.fn() }));
vi.mock("@/auth", () => ({
  getServerAuthSession: mocks.getServerAuthSession,
}));
vi.mock("@/lib/shadow-override", () => ({
  getShadowOverrideEnabled: mocks.getShadowOverrideEnabled,
}));
vi.mock("@/lib/shadow-cloud-api", () => ({
  getGameDetail: mocks.getGameDetail,
}));

const { default: GameDetailPage } = await import("./page");

type ElementProps = Record<string, unknown>;

function createTurnRecord(
  overrides: Partial<GameTurnRecord> = {},
): GameTurnRecord {
  return {
    id: "turn-2",
    roundNumber: 4,
    gamePlayerId: "seat-2",
    userId: "player-2",
    seatNumber: 2,
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

function createFileVersion(
  overrides: Partial<GameDetailFileVersion> = {},
): GameDetailFileVersion {
  return {
    id: "file-newest",
    originalName: "round-4-newest.Civ6Save",
    uploadedAt: "2026-07-10T11:00:00.000Z",
    uploadedById: "player-2",
    uploadedByDisplayName: "Rhea",
    contentHash: "internal-content-hash",
    idempotencyKey: "internal-idempotency-key",
    replacedAt: "2026-07-10T11:30:00.000Z",
    replacedByDisplayName: "Internal Operator",
    ...overrides,
  };
}

function createGame(overrides: Partial<GameDetail> = {}): GameDetail {
  return {
    id: "game-1",
    gameNumber: 42,
    slug: "campaign-42",
    name: "Campaign 42",
    organizerId: "organizer-1",
    organizerDisplayName: "Overlord",
    playerCount: 2,
    hasAiPlayers: false,
    dlcMode: "NONE",
    gameMode: "TEAMS",
    techLevel: 4,
    zoneCount: "TWO_ZONE_START",
    armyCount: "ONE_PER_ZONE",
    notes: "Hold the western pass.",
    roundNumber: 4,
    activePlayerEntryId: "seat-2",
    activePlayerUserId: "player-2",
    activePlayerDisplayName: "Rhea",
    turnTargetHours: 24,
    turnReminderGraceHours: 12,
    turnReminderRepeatHours: 6,
    turnRemindersEnabled: true,
    currentTurnStartedAt: "2026-07-10T10:05:00.000Z",
    players: [
      {
        id: "seat-2",
        userId: "player-2",
        displayName: "Rhea",
        turnOrder: 2,
        isOrganizer: false,
      },
      {
        id: "seat-1",
        userId: "organizer-1",
        displayName: "Overlord",
        turnOrder: 1,
        isOrganizer: true,
      },
    ],
    fileVersions: [
      createFileVersion(),
      createFileVersion({
        id: "file-older",
        originalName: "round-3.Civ6Save",
        uploadedAt: "2026-07-09T11:00:00.000Z",
      }),
    ],
    openTurn: createTurnRecord(),
    recentCompletedTurns: [
      createTurnRecord({
        id: "turn-1",
        endedAt: "2026-07-09T12:00:00.000Z",
        completionReason: "SAVE_UPLOADED",
      }),
    ],
    ...overrides,
  };
}

function findElementByType(
  node: ReactNode,
  type: ReactElement["type"],
): ReactElement<ElementProps> | null {
  if (!isValidElement(node)) {
    return null;
  }

  const element = node as ReactElement<{ children?: ReactNode }>;

  if (element.type === type) {
    return element;
  }

  let match: ReactElement<ElementProps> | null = null;

  Children.forEach(element.props.children, (child) => {
    if (!match) {
      match = findElementByType(child, type);
    }
  });

  return match;
}

function elementChildren(node: ReactNode): ReactElement<ElementProps>[] {
  if (!isValidElement(node)) {
    return [];
  }

  const elements: ReactElement<ElementProps>[] = [];

  Children.forEach(
    (node as ReactElement<{ children?: ReactNode }>).props.children,
    (child) => {
      if (isValidElement(child)) {
        elements.push(child as ReactElement<ElementProps>);
      }
    },
  );

  return elements;
}

async function renderPage({
  game = createGame(),
  session = { user: { id: "player-2", isShadowOverride: false } },
  shadowOverrideEnabled = false,
  searchParams = {},
}: {
  game?: GameDetail;
  session?: { user: { id: string; isShadowOverride: boolean } } | null;
  shadowOverrideEnabled?: boolean;
  searchParams?: { metadata?: string; upload?: string; message?: string };
} = {}) {
  mocks.getGameDetail.mockResolvedValue(game);
  mocks.getServerAuthSession.mockResolvedValue(session);
  mocks.getShadowOverrideEnabled.mockResolvedValue(shadowOverrideEnabled);

  return GameDetailPage({
    params: Promise.resolve({ gameNumber: "42" }),
    searchParams: Promise.resolve(searchParams),
  });
}

describe("GameDetailPage workspace composition", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("derives the current-turn command center from the active seat and newest save", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-10T12:00:00.000Z"));

    const page = await renderPage();
    const command = findElementByType(page, TurnCommandCenter) as ReactElement<
      ComponentProps<typeof TurnCommandCenter>
    >;

    expect(command.key).toBe("turn-2");
    expect(command.props).toMatchObject({
      activePlayerDisplayName: "Rhea",
      activeSeatNumber: 2,
      canDownloadLatestSave: true,
      currentTurnStartedAt: "2026-07-10T10:05:00.000Z",
      gameNumber: 42,
      initialNow: "2026-07-10T12:00:00.000Z",
      isActivePlayer: true,
      isSignedIn: true,
      roundNumber: 4,
      turnTargetHours: 24,
    });
    expect(command.props.latestSave).toEqual({
      id: "file-newest",
      originalName: "round-4-newest.Civ6Save",
      uploadedAt: "2026-07-10T11:00:00.000Z",
      uploadedByDisplayName: "Rhea",
    });
  });

  it("puts world state before turn timing in Activity and preserves timing refresh props", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-10T12:00:00.000Z"));

    const page = await renderPage();
    const workspace = findElementByType(
      page,
      CampaignWorkspaceTabs,
    ) as ReactElement<ComponentProps<typeof CampaignWorkspaceTabs>>;
    const activityChildren = elementChildren(workspace.props.activity);

    expect(activityChildren.map((child) => child.type)).toEqual([
      WorldStateHistoryCard,
      TurnTimingHistoryCard,
    ]);
    expect(activityChildren[1].key).toBe("turn-2");
    expect(activityChildren[1].props.initialNow).toBe(
      "2026-07-10T12:00:00.000Z",
    );
  });

  it("groups seat order and notes in a two-column Campaign row before metadata", async () => {
    const page = await renderPage();
    const workspace = findElementByType(
      page,
      CampaignWorkspaceTabs,
    ) as ReactElement<ComponentProps<typeof CampaignWorkspaceTabs>>;
    const campaignChildren = elementChildren(workspace.props.campaign);
    const campaignRow = campaignChildren[0];

    expect(campaignChildren.map((child) => child.type)).toEqual([
      "div",
      GameMetadataCard,
    ]);
    expect(campaignRow.props.className).toBe(
      "grid min-w-0 gap-6 xl:grid-cols-2",
    );
    expect(elementChildren(campaignRow).map((child) => child.type)).toEqual([
      SeatOrderEditor,
      GameNotesCard,
    ]);
  });

  it.each([
    [true, true, true],
    [true, false, false],
    [false, true, false],
    [false, false, false],
  ])(
    "sets Administration only for override user=%s with override enabled=%s",
    async (isShadowOverride, shadowOverrideEnabled, expected) => {
      const page = await renderPage({
        session: { user: { id: "admin-1", isShadowOverride } },
        shadowOverrideEnabled,
      });
      const workspace = findElementByType(
        page,
        CampaignWorkspaceTabs,
      ) as ReactElement<ComponentProps<typeof CampaignWorkspaceTabs>>;

      expect(
        findElementByType(
          workspace.props.administration,
          AdministratorActionsCard,
        ) !== null,
      ).toBe(expected);
    },
  );

  it("lets the organizer edit campaign data without exposing Administration", async () => {
    const page = await renderPage({
      session: {
        user: { id: "organizer-1", isShadowOverride: false },
      },
    });
    const workspace = findElementByType(
      page,
      CampaignWorkspaceTabs,
    ) as ReactElement<ComponentProps<typeof CampaignWorkspaceTabs>>;
    const seatOrder = findElementByType(
      workspace.props.campaign,
      SeatOrderEditor,
    );
    const notes = findElementByType(workspace.props.campaign, GameNotesCard);
    const metadata = findElementByType(
      workspace.props.campaign,
      GameMetadataCard,
    );

    expect(seatOrder?.props.canEdit).toBe(true);
    expect(notes?.props.canEdit).toBe(true);
    expect(metadata?.props.canEdit).toBe(true);
    expect(workspace.props.administration).toBeUndefined();
  });

  it("preserves replacement authorization props on world history", async () => {
    const page = await renderPage({
      session: { user: { id: "admin-1", isShadowOverride: true } },
      shadowOverrideEnabled: true,
    });
    const workspace = findElementByType(
      page,
      CampaignWorkspaceTabs,
    ) as ReactElement<ComponentProps<typeof CampaignWorkspaceTabs>>;
    const worldHistory = findElementByType(
      workspace.props.activity,
      WorldStateHistoryCard,
    );

    expect(worldHistory?.props).toMatchObject({
      currentUserId: "admin-1",
      fileVersions: expect.arrayContaining([
        expect.objectContaining({ id: "file-newest" }),
        expect.objectContaining({ id: "file-older" }),
      ]),
      gameNumber: 42,
      isShadowOverrideUser: true,
      shadowOverrideEnabled: true,
    });
  });

  it("keeps the latest save downloadable for signed-out visitors", async () => {
    const page = await renderPage({ session: null });
    const command = findElementByType(page, TurnCommandCenter);

    expect(command?.props).toMatchObject({
      canDownloadLatestSave: true,
      isActivePlayer: false,
      isSignedIn: false,
    });
    expect(command?.props.latestSave).toEqual({
      id: "file-newest",
      originalName: "round-4-newest.Civ6Save",
      uploadedAt: "2026-07-10T11:00:00.000Z",
      uploadedByDisplayName: "Rhea",
    });
  });

  it("disables latest-save download when no file version exists", async () => {
    const page = await renderPage({ game: createGame({ fileVersions: [] }) });
    const command = findElementByType(page, TurnCommandCenter);

    expect(command?.props.latestSave).toBeNull();
    expect(command?.props.canDownloadLatestSave).toBe(false);
  });

  it("falls back to the open turn seat when the active player entry is missing", async () => {
    const page = await renderPage({
      game: createGame({
        activePlayerEntryId: "missing-seat",
        openTurn: createTurnRecord({ seatNumber: 7 }),
      }),
    });
    const command = findElementByType(page, TurnCommandCenter);

    expect(command?.props.activeSeatNumber).toBe(7);
  });

  it("uses the no-open-turn key and open-turn start fallback", async () => {
    const noOpenPage = await renderPage({
      game: createGame({ currentTurnStartedAt: null, openTurn: null }),
    });
    const fallbackPage = await renderPage({
      game: createGame({ currentTurnStartedAt: null }),
    });
    const noOpenWorkspace = findElementByType(
      noOpenPage,
      CampaignWorkspaceTabs,
    ) as ReactElement<ComponentProps<typeof CampaignWorkspaceTabs>>;

    expect(findElementByType(noOpenPage, TurnCommandCenter)?.key).toBe(
      "no-open-turn",
    );
    expect(
      findElementByType(noOpenWorkspace.props.activity, TurnTimingHistoryCard)
        ?.key,
    ).toBe("no-open-turn");
    expect(
      findElementByType(fallbackPage, TurnCommandCenter)?.props
        .currentTurnStartedAt,
    ).toBe("2026-07-10T10:00:00.000Z");
  });

  it("keeps the upload error immediately before the command center", async () => {
    const page = await renderPage({
      searchParams: { upload: "error", message: "disk%20full" },
    });
    const rootChildren = elementChildren(page);

    expect(rootChildren[0].type).toBe(TerminalConfirmationModal);
    expect(rootChildren[1].type).toBe("div");
    expect(rootChildren[1].props.children).toBe("disk full");
    expect(rootChildren[2].type).toBe(TurnCommandCenter);
  });

  it("keeps the exact root spacing classes", async () => {
    const page = await renderPage();

    expect(page.props.className).toBe("flex flex-col gap-8 pb-6");
  });
});

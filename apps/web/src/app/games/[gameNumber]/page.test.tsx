import {
  Children,
  isValidElement,
  type ComponentProps,
  type ReactElement,
  type ReactNode,
} from "react";
import { describe, expect, it, vi } from "vitest";
import { TurnTimingHistoryCard } from "@/components/turn-timing-history-card";
import type { GameDetail, GameTurnRecord } from "@/lib/shadow-cloud-api";

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
    notes: null,
    roundNumber: 4,
    activePlayerEntryId: "seat-1",
    activePlayerUserId: "player-1",
    activePlayerDisplayName: "Rhea",
    turnTargetHours: 24,
    turnReminderGraceHours: 12,
    turnReminderRepeatHours: 6,
    turnRemindersEnabled: true,
    currentTurnStartedAt: null,
    players: [],
    fileVersions: [],
    openTurn: null,
    recentCompletedTurns: [],
    ...overrides,
  };
}

function findElementByType(
  node: ReactNode,
  type: ReactElement["type"],
): ReactElement | null {
  if (!isValidElement(node)) {
    return null;
  }

  const element = node as ReactElement<{ children?: ReactNode }>;

  if (element.type === type) {
    return element;
  }

  let match: ReactElement | null = null;

  Children.forEach(element.props.children, (child) => {
    if (match) {
      return;
    }

    match = findElementByType(child, type);

    if (match) {
      return;
    }
  });

  return match;
}

describe("GameDetailPage turn timing history", () => {
  it("keys a newly open turn and passes its refreshed server time", async () => {
    vi.useFakeTimers();
    mocks.getServerAuthSession.mockResolvedValue(null);
    mocks.getShadowOverrideEnabled.mockResolvedValue(false);
    mocks.getGameDetail
      .mockResolvedValueOnce(createGame())
      .mockResolvedValueOnce(
        createGame({ openTurn: createTurnRecord({ id: "turn-2" }) }),
      );

    vi.setSystemTime(new Date("2026-07-10T10:01:00.000Z"));
    const noOpenPage = await GameDetailPage({
      params: Promise.resolve({ gameNumber: "42" }),
      searchParams: Promise.resolve({}),
    });

    vi.setSystemTime(new Date("2026-07-10T12:00:00.000Z"));
    const openPage = await GameDetailPage({
      params: Promise.resolve({ gameNumber: "42" }),
      searchParams: Promise.resolve({}),
    });

    const noOpenCard = findElementByType(noOpenPage, TurnTimingHistoryCard);
    const openCard = findElementByType(
      openPage,
      TurnTimingHistoryCard,
    ) as ReactElement<ComponentProps<typeof TurnTimingHistoryCard>> | null;

    expect(noOpenCard?.key).toBe("no-open-turn");
    expect(openCard?.key).toBe("turn-2");
    expect(openCard?.props.initialNow).toBe("2026-07-10T12:00:00.000Z");
  });
});

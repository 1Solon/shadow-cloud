// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CampaignList } from "./campaign-list";
import type { GameListItem } from "@/lib/shadow-cloud-api";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
});

const base: GameListItem = {
  id: "long",
  slug: "long",
  gameNumber: 1,
  name: "Long",
  organizerDisplayName: "Overlord",
  updatedAt: "2026-07-12T00:00:00Z",
  roundNumber: 1,
  activePlayerUserId: null,
  activePlayerDisplayName: "Unassigned",
  playerCount: 2,
  filledSeatCount: 0,
  participantUserIds: [],
  latestSave: null,
  turnTargetHours: 48,
  turnReminderGraceHours: 12,
  turnReminderRepeatHours: 6,
  turnRemindersEnabled: true,
  currentTurnStartedAt: "2026-07-09T00:00:00Z",
};
const campaigns = [
  base,
  {
    ...base,
    id: "unknown",
    gameNumber: 2,
    name: "Unknown",
    currentTurnStartedAt: null,
    turnTargetHours: NaN,
  },
  {
    ...base,
    id: "short",
    gameNumber: 3,
    name: "Short",
    currentTurnStartedAt: "2026-07-10T00:00:00Z",
    turnTargetHours: 2,
    updatedAt: "2026-07-11T00:00:00Z",
  },
];

it.each([false, true])(
  "offers exactly Name, Turn (Oldest), Turn (Newest), defaulting to newest starts (extended controls: %s)",
  async (hasExtendedControls) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-07-11T00:00:00Z"));
    // Radix scrolls the focused option; jsdom has no scrolling layout.
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: vi.fn(),
    });
    render(
      <CampaignList
        campaigns={campaigns}
        title="ACTIVE CAMPAIGNS"
        emptyTitle="Empty"
        emptyDescription="No campaigns"
        hasExtendedControls={hasExtendedControls}
      />,
    );
    const order = () =>
      screen
        .getAllByRole("link")
        .map((card) => within(card).getByText(/^\d : \w+$/).textContent);
    expect(order()).toEqual(["3 : Short", "1 : Long", "2 : Unknown"]);
    expect(screen.getByText("Unknown / Unknown")).toBeVisible();
    expect(screen.getByText("2d / 48h")).toBeVisible();
    expect(screen.getByText("1d / 2h")).toBeVisible();
    const sort = screen.getByRole("combobox", {
      name: "Sort active campaigns",
    });
    expect(sort).toHaveTextContent("Turn (Newest)");
    for (const [label, expected] of [
      ["Name", ["1 : Long", "3 : Short", "2 : Unknown"]],
      ["Turn (Oldest)", ["1 : Long", "3 : Short", "2 : Unknown"]],
      ["Turn (Newest)", ["3 : Short", "1 : Long", "2 : Unknown"]],
    ] as const) {
      fireEvent.keyDown(sort, { key: "ArrowDown" });
      expect(
        (await screen.findAllByRole("option")).map(
          (option) => option.textContent,
        ),
      ).toEqual(["Name", "Turn (Oldest)", "Turn (Newest)"]);
      fireEvent.click(await screen.findByRole("option", { name: label }));
      expect(order()).toEqual(expected);
    }
    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "Unknown" },
    });
    expect(order()).toEqual(["2 : Unknown"]);
    if (hasExtendedControls) {
      const filter = screen.getByRole("combobox", {
        name: "Filter active campaigns by turn status",
      });
      fireEvent.keyDown(filter, { key: "ArrowDown" });
      fireEvent.click(
        await screen.findByRole("option", { name: "Your turn only" }),
      );
      expect(screen.queryAllByRole("link")).toHaveLength(0);
      expect(screen.getByText("No campaigns match your search")).toBeVisible();
      fireEvent.keyDown(filter, { key: "ArrowDown" });
      fireEvent.click(
        await screen.findByRole("option", { name: "Waiting on others" }),
      );
      expect(order()).toEqual(["2 : Unknown"]);
    }
  },
);

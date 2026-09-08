// @vitest-environment jsdom

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useAcceptedRoster } from "./accepted-roster";

const observed = {
  players: [
    {
      id: "seat-1",
      userId: "lord-1",
      displayName: "Overlord",
      isOrganizer: true,
      turnOrder: 1,
    },
  ],
  activePlayerEntryId: "seat-1",
  seatOrderBaseline: { campaignId: "campaign-1", revision: 7 },
};

describe("Accepted Roster", () => {
  it("retains a newer accepted Roster against old page observations and slower responses", () => {
    const { result, rerender } = renderHook(useAcceptedRoster, {
      initialProps: observed,
    });
    act(() => {
      expect(
        result.current.accept({
          ...observed,
          gameId: "campaign-1",
          players: [{ ...observed.players[0]!, displayName: "New name" }],
          seatOrderBaseline: { campaignId: "campaign-1", revision: 10 },
        }),
      ).toBeNull();
    });
    rerender({ ...observed, players: [...observed.players] });
    act(() => {
      expect(
        result.current.accept({
          ...observed,
          gameId: "campaign-1",
          seatOrderBaseline: { campaignId: "campaign-1", revision: 9 },
        }),
      ).toBeNull();
    });
    expect(result.current.current.seatOrderBaseline.revision).toBe(10);
    expect(result.current.current.players[0]?.displayName).toBe("New name");
  });
});

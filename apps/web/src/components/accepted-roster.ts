"use client";

import { useState } from "react";
import type { SeatOrderSnapshot } from "@/lib/shadow-cloud-api";

export type AcceptedRoster = Pick<
  SeatOrderSnapshot,
  "players" | "activePlayerEntryId" | "seatOrderBaseline"
>;

type RosterSnapshot = AcceptedRoster & Pick<SeatOrderSnapshot, "gameId">;

export type AcceptedRosterOwner = {
  current: AcceptedRoster;
  accept: (snapshot: RosterSnapshot | null | undefined) => string | null;
};

// Mount at stable Campaign identity scope, above Seat Order section navigation.
// The editor owns request lifetimes and its captured draft, never reconciliation.
export function useAcceptedRoster(
  observed: AcceptedRoster,
): AcceptedRosterOwner {
  const [current, setCurrent] = useState(observed);
  const [previousPlayers, setPreviousPlayers] = useState(observed.players);
  const incomingPlayersChanged = previousPlayers !== observed.players;
  if (incomingPlayersChanged) setPreviousPlayers(observed.players);

  if (
    observed.seatOrderBaseline &&
    observed.seatOrderBaseline.campaignId ===
      current.seatOrderBaseline?.campaignId &&
    observed.seatOrderBaseline.revision >= current.seatOrderBaseline.revision &&
    (incomingPlayersChanged ||
      observed.seatOrderBaseline.revision !==
        current.seatOrderBaseline.revision)
  ) {
    setCurrent(observed);
  }

  function accept(snapshot: RosterSnapshot | null | undefined) {
    if (
      !snapshot ||
      !Array.isArray(snapshot.players) ||
      !(
        snapshot.activePlayerEntryId === null ||
        typeof snapshot.activePlayerEntryId === "string"
      ) ||
      typeof snapshot.seatOrderBaseline?.campaignId !== "string" ||
      snapshot.seatOrderBaseline.campaignId.trim().length === 0 ||
      snapshot.seatOrderBaseline.campaignId !== snapshot.gameId ||
      !Number.isSafeInteger(snapshot.seatOrderBaseline.revision) ||
      snapshot.seatOrderBaseline.revision < 0
    ) {
      return "Loading the latest roster failed. Try again.";
    }
    if (snapshot.gameId !== observed.seatOrderBaseline?.campaignId) {
      return "The returned roster belongs to a different campaign. Open the original campaign from the campaign list before editing.";
    }
    setCurrent((latest) =>
      latest.seatOrderBaseline &&
      latest.seatOrderBaseline.revision > snapshot.seatOrderBaseline.revision
        ? latest
        : {
            players: snapshot.players,
            activePlayerEntryId: snapshot.activePlayerEntryId,
            seatOrderBaseline: snapshot.seatOrderBaseline,
          },
    );
    // A valid slower response may finish its draft without rolling authority back.
    return null;
  }

  return { current, accept };
}

"use client";

import { useEffect, useState } from "react";
import { LocalTimestamp } from "@/components/local-timestamp";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  formatCompletionReason,
  formatTurnDuration,
  getTurnDurationMs,
} from "@/lib/turn-timing";
import type { GameTurnRecord } from "@/lib/shadow-cloud-api";

const defaultRefreshIntervalMs = 60 * 1000;
const maxCompletedTurns = 25;

type TurnTimingHistoryCardProps = {
  openTurn: GameTurnRecord | null;
  recentCompletedTurns: GameTurnRecord[];
  initialNow: string;
  refreshIntervalMs?: number;
};

function TurnTimingHistoryRow({
  record,
  isOpen,
  now,
}: {
  record: GameTurnRecord;
  isOpen: boolean;
  now: Date;
}) {
  return (
    <tr
      className={
        isOpen
          ? "h-16 border-b border-orange-400/30 border-l-2 border-l-orange-400 bg-orange-400/10 text-orange-100"
          : "h-16 border-b border-orange-400/20 bg-orange-400/5 text-orange-200"
      }
      role="row"
    >
      <td
        className="px-3 py-2 align-top sm:px-4 sm:py-3"
        data-label="Turn"
        role="cell"
      >
        <span className="block font-medium">Round {record.roundNumber}</span>
        <span className="mt-1 block text-xs text-orange-300/70">
          {record.seatNumber == null ? "No seat" : `Seat ${record.seatNumber}`}
        </span>
      </td>
      <td
        className="break-words px-3 py-2 align-top sm:px-4 sm:py-3"
        data-label="Player"
        role="cell"
      >
        {record.playerDisplayName}
      </td>
      <td
        className="px-3 py-2 align-top sm:px-4 sm:py-3"
        data-label="Timeline"
        role="cell"
      >
        <div className="space-y-1">
          <div>
            <span className="mr-2 text-[0.6rem] uppercase tracking-[0.14em] text-orange-300/60">
              Started
            </span>
            <LocalTimestamp compact timestamp={record.startedAt} />
          </div>
          <div>
            <span className="mr-2 text-[0.6rem] uppercase tracking-[0.14em] text-orange-300/60">
              {record.endedAt ? "Completed" : "Status"}
            </span>
            {record.endedAt ? (
              <LocalTimestamp compact timestamp={record.endedAt} />
            ) : (
              "In progress"
            )}
          </div>
        </div>
      </td>
      <td
        className="px-3 py-2 align-top font-medium sm:px-4 sm:py-3"
        data-label="Duration"
        role="cell"
      >
        {formatTurnDuration(getTurnDurationMs(record, now))}
      </td>
      <td
        className="break-words px-3 py-2 align-top sm:px-4 sm:py-3"
        data-label="Result"
        role="cell"
      >
        {isOpen
          ? "Current turn"
          : formatCompletionReason(record.completionReason)}
      </td>
      <td
        className="px-3 py-2 align-top sm:px-4 sm:py-3"
        data-label="Reminders"
        role="cell"
      >
        {record.reminderCount}
      </td>
    </tr>
  );
}

export function TurnTimingHistoryCard({
  openTurn,
  recentCompletedTurns,
  initialNow,
  refreshIntervalMs = defaultRefreshIntervalMs,
}: TurnTimingHistoryCardProps) {
  const [now, setNow] = useState(() => new Date(initialNow));
  const completedTurns = recentCompletedTurns.slice(0, maxCompletedTurns);
  const hasTurns = openTurn !== null || completedTurns.length > 0;

  useEffect(() => {
    if (!openTurn) {
      return;
    }

    const interval = window.setInterval(() => {
      setNow(new Date());
    }, refreshIntervalMs);

    return () => {
      window.clearInterval(interval);
    };
  }, [openTurn, refreshIntervalMs]);

  return (
    <Card className="overflow-hidden">
      <CardHeader className="p-4 sm:p-5">
        <CardTitle>Turn timings:</CardTitle>
        <CardDescription>
          See how long the current and previous turns have taken.
        </CardDescription>
      </CardHeader>
      <CardContent className="p-4 pt-0 sm:p-5 sm:pt-0">
        {hasTurns ? (
          <div
            aria-label="Recent turn timing history table"
            className="overflow-x-auto rounded-lg border border-orange-400/20"
            role="region"
            tabIndex={0}
          >
            <table
              className="history-table history-table--stacked w-full text-left text-xs font-mono sm:min-w-[38rem] sm:text-sm"
              role="table"
            >
              <caption className="sr-only">Recent turn timing history</caption>
              <thead
                className="border-b border-orange-400/30 bg-orange-400/10 text-xs uppercase tracking-[0.18em] text-orange-300/80"
                role="rowgroup"
              >
                <tr className="h-10" role="row">
                  <th
                    className="px-3 py-2 sm:px-4 sm:py-3"
                    role="columnheader"
                    scope="col"
                  >
                    Turn
                  </th>
                  <th
                    className="px-3 py-2 sm:px-4 sm:py-3"
                    role="columnheader"
                    scope="col"
                  >
                    Player
                  </th>
                  <th
                    className="px-3 py-2 sm:px-4 sm:py-3"
                    role="columnheader"
                    scope="col"
                  >
                    Timeline
                  </th>
                  <th
                    className="px-3 py-2 sm:px-4 sm:py-3"
                    role="columnheader"
                    scope="col"
                  >
                    Duration
                  </th>
                  <th
                    className="px-3 py-2 sm:px-4 sm:py-3"
                    role="columnheader"
                    scope="col"
                  >
                    Result
                  </th>
                  <th
                    className="px-3 py-2 sm:px-4 sm:py-3"
                    role="columnheader"
                    scope="col"
                  >
                    Reminders
                  </th>
                </tr>
              </thead>
              <tbody role="rowgroup">
                {openTurn ? (
                  <TurnTimingHistoryRow isOpen now={now} record={openTurn} />
                ) : null}
                {completedTurns.map((turn) => (
                  <TurnTimingHistoryRow
                    key={turn.id}
                    isOpen={false}
                    now={now}
                    record={turn}
                  />
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div
            className="rounded-lg border border-orange-400/20 bg-orange-400/5 px-4 py-4 text-sm font-mono text-orange-300"
            role="status"
          >
            No turn timings are available yet.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

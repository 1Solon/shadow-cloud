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
import {
  padNumber,
  tableCell,
  tableCurrentRow,
  tableHead,
  tableHeaderCell,
  tableRow,
} from "@/lib/terminal-styles";
import { cn } from "@/lib/utils";

const defaultRefreshIntervalMs = 60 * 1000;
const maxCompletedTurns = 25;

type TurnTimingHistoryCardProps = {
  openTurn: GameTurnRecord | null;
  recentCompletedTurns: GameTurnRecord[];
  initialNow: string;
  refreshIntervalMs?: number;
};

function EmptyCell() {
  return (
    <>
      <span aria-hidden="true" className="text-terminal-300/50">
        —
      </span>
      <span className="sr-only">None</span>
    </>
  );
}

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
    <tr className={cn(tableRow, isOpen && tableCurrentRow)} role="row">
      <td
        className={cn(tableCell, "tabular-nums")}
        data-label="Round"
        role="cell"
      >
        {isOpen ? <span className="sr-only">Current turn</span> : null}
        {padNumber(record.roundNumber)}
      </td>
      <td
        className={cn(tableCell, "break-words")}
        data-label="Player"
        role="cell"
      >
        {record.playerDisplayName}
        <span className="block text-xs text-terminal-300/70">
          {record.seatNumber == null ? "No seat" : `Seat ${record.seatNumber}`}
        </span>
      </td>
      <td
        className={cn(tableCell, "whitespace-nowrap")}
        data-label="Started"
        role="cell"
      >
        <LocalTimestamp compact timestamp={record.startedAt} />
      </td>
      <td
        className={cn(tableCell, "whitespace-nowrap")}
        data-label="Ended"
        role="cell"
      >
        {record.endedAt ? (
          <LocalTimestamp compact timestamp={record.endedAt} />
        ) : (
          <EmptyCell />
        )}
      </td>
      <td
        className={cn(tableCell, "tabular-nums")}
        data-label="Duration"
        role="cell"
      >
        {formatTurnDuration(getTurnDurationMs(record, now))}
      </td>
      <td
        className={cn(tableCell, "break-words")}
        data-label="Result"
        role="cell"
      >
        {isOpen ? (
          <EmptyCell />
        ) : (
          formatCompletionReason(record.completionReason)
        )}
      </td>
      <td
        className={cn(tableCell, "tabular-nums")}
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
        <CardTitle>Turn timings</CardTitle>
        <CardDescription>
          See how long the current and previous turns have taken.
        </CardDescription>
      </CardHeader>
      <CardContent
        className={hasTurns ? "p-0 sm:p-0" : "p-4 pt-0 sm:p-5 sm:pt-0"}
      >
        {hasTurns ? (
          <div
            aria-label="Recent turn timing history table"
            className="overflow-x-auto"
            role="region"
            tabIndex={0}
          >
            <table
              className="history-table history-table--stacked w-full text-left font-mono text-sm sm:min-w-[48rem]"
              role="table"
            >
              <caption className="sr-only">Recent turn timing history</caption>
              <thead className={tableHead} role="rowgroup">
                <tr role="row">
                  <th
                    className={tableHeaderCell}
                    role="columnheader"
                    scope="col"
                  >
                    Round
                  </th>
                  <th
                    className={tableHeaderCell}
                    role="columnheader"
                    scope="col"
                  >
                    Player
                  </th>
                  <th
                    className={tableHeaderCell}
                    role="columnheader"
                    scope="col"
                  >
                    Started
                  </th>
                  <th
                    className={tableHeaderCell}
                    role="columnheader"
                    scope="col"
                  >
                    Ended
                  </th>
                  <th
                    className={tableHeaderCell}
                    role="columnheader"
                    scope="col"
                  >
                    Duration
                  </th>
                  <th
                    className={tableHeaderCell}
                    role="columnheader"
                    scope="col"
                  >
                    Result
                  </th>
                  <th
                    className={tableHeaderCell}
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
            className="rounded-md border border-terminal-400/20 bg-terminal-400/5 px-4 py-4 font-mono text-sm text-terminal-300"
            role="status"
          >
            No turn timings are available yet.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

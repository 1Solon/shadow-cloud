"use client";

import { useEffect, useState } from "react";
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
  formatTurnTimestamp,
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
          ? "border-b border-orange-400 bg-orange-400 text-black"
          : "border-b border-orange-400/20 bg-orange-400/5 text-orange-200"
      }
    >
      <td className="px-4 py-3 font-medium">{record.roundNumber}</td>
      <td className="px-4 py-3">
        {record.seatNumber == null ? "No seat" : `Seat ${record.seatNumber}`}
      </td>
      <td className="px-4 py-3">{record.playerDisplayName}</td>
      <td className="px-4 py-3">
        <time dateTime={record.startedAt}>
          {formatTurnTimestamp(record.startedAt)}
        </time>
      </td>
      <td className="px-4 py-3">
        {record.endedAt ? (
          <time dateTime={record.endedAt}>
            {formatTurnTimestamp(record.endedAt)}
          </time>
        ) : (
          "In progress"
        )}
      </td>
      <td className="px-4 py-3 font-medium">
        {formatTurnDuration(getTurnDurationMs(record, now))}
      </td>
      <td className="px-4 py-3">
        {isOpen
          ? "Current turn: In progress"
          : formatCompletionReason(record.completionReason)}
      </td>
      <td className="px-4 py-3">{record.reminderCount}</td>
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
      <CardHeader>
        <CardTitle>Recent turn timing:</CardTitle>
        <CardDescription>
          Current and recently completed turn timing snapshots.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {hasTurns ? (
          <div
            aria-label="Recent turn timing history table"
            className="overflow-x-auto rounded-lg border border-orange-400/20"
            role="region"
            tabIndex={0}
          >
            <table className="min-w-[64rem] w-full text-left text-sm font-mono">
              <caption className="sr-only">Recent turn timing history</caption>
              <thead className="border-b border-orange-400/30 bg-orange-400/10 text-xs uppercase tracking-[0.18em] text-orange-300/80">
                <tr>
                  <th className="px-4 py-3" scope="col">
                    Round
                  </th>
                  <th className="px-4 py-3" scope="col">
                    Seat
                  </th>
                  <th className="px-4 py-3" scope="col">
                    Player
                  </th>
                  <th className="px-4 py-3" scope="col">
                    Started
                  </th>
                  <th className="px-4 py-3" scope="col">
                    Completed
                  </th>
                  <th className="px-4 py-3" scope="col">
                    Duration
                  </th>
                  <th className="px-4 py-3" scope="col">
                    Result
                  </th>
                  <th className="px-4 py-3" scope="col">
                    Reminders
                  </th>
                </tr>
              </thead>
              <tbody>
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
            No turn timing history is available yet.
          </div>
        )}
      </CardContent>
    </Card>
  );
}

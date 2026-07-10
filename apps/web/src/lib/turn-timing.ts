import type {
  GameTurnRecord,
  TurnCompletionReason,
} from "@/lib/shadow-cloud-api";

const minuteMs = 60 * 1000;
const hourMs = 60 * minuteMs;
const dayMs = 24 * hourMs;

export function getTurnDurationMs(
  record: Pick<GameTurnRecord, "startedAt" | "endedAt">,
  now: Date,
): number {
  const completedAt = record.endedAt ? new Date(record.endedAt) : now;

  return Math.max(
    0,
    completedAt.getTime() - new Date(record.startedAt).getTime(),
  );
}

export function formatTurnDuration(milliseconds: number): string {
  const duration = Math.max(0, milliseconds);

  if (duration < minuteMs) {
    return "<1m";
  }

  if (duration < hourMs) {
    return `${Math.floor(duration / minuteMs)}m`;
  }

  if (duration < dayMs) {
    return `${Math.floor(duration / hourMs)}h`;
  }

  return `${Math.floor(duration / dayMs)}d`;
}

export function formatTurnTimestamp(timestamp: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(timestamp));
}

export function formatCompletionReason(
  reason: TurnCompletionReason | null,
): string {
  switch (reason) {
    case "SAVE_UPLOADED":
      return "Save uploaded";
    case "SKIPPED":
      return "Skipped";
    case "RESIGNED":
      return "Resigned";
    case "REPLACED":
      return "Replaced";
    case "REASSIGNED":
      return "Reassigned";
    case null:
      return "In progress";
  }
}

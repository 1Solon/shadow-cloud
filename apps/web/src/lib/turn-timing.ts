import type {
  GameTurnRecord,
  TurnCompletionReason,
} from "@/lib/shadow-cloud-api";

const minuteMs = 60 * 1000;
const hourMs = 60 * minuteMs;
const dayMs = 24 * hourMs;
const turnTimestampFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "UTC",
});

export function getTurnDurationMs(
  record: Pick<GameTurnRecord, "startedAt" | "endedAt">,
  now: Date,
): number | null {
  const startedAt = new Date(record.startedAt);
  const completedAt = record.endedAt ? new Date(record.endedAt) : now;

  if (
    Number.isNaN(startedAt.getTime()) ||
    Number.isNaN(completedAt.getTime())
  ) {
    return null;
  }

  return Math.max(0, completedAt.getTime() - startedAt.getTime());
}

export function formatTurnDuration(milliseconds: number | null): string {
  if (milliseconds == null || !Number.isFinite(milliseconds)) {
    return "Unknown";
  }

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
  const date = new Date(timestamp);

  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }

  return `${turnTimestampFormatter.format(date)} UTC`;
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

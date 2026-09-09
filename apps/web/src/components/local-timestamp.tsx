"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

export function LocalTimestamp({
  timestamp,
  compact = false,
}: {
  timestamp: string;
  compact?: boolean;
}) {
  // Match server HTML during hydration; only the browser knows local time.
  const isClient = useSyncExternalStore(
    subscribe,
    getClientSnapshot,
    getServerSnapshot,
  );
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "Unknown";

  const zoneOptions = isClient ? {} : { timeZone: "UTC" };
  const suffix = isClient ? "local" : "UTC";
  const full = new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    ...zoneOptions,
  }).format(date);
  const text = compact
    ? new Intl.DateTimeFormat("en-US", {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        ...zoneOptions,
      }).format(date)
    : full;

  return (
    <time dateTime={timestamp} title={`${full} ${suffix}`}>
      {text} {suffix}
    </time>
  );
}

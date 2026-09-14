/** Formats session-entry timestamps for picker metadata. */

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

/** Format an ISO timestamp as a compact age or short calendar date. */
export function formatAgo(iso: string, now: Date = new Date()): string {
  const elapsedMs = Math.max(0, now.getTime() - new Date(iso).getTime());

  if (elapsedMs < MINUTE_MS) return "just now";
  if (elapsedMs < HOUR_MS) return `${Math.floor(elapsedMs / MINUTE_MS)}m ago`;
  if (elapsedMs < DAY_MS) return `${Math.floor(elapsedMs / HOUR_MS)}h ago`;
  if (elapsedMs < 7 * DAY_MS) return `${Math.floor(elapsedMs / DAY_MS)}d ago`;

  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
  }).format(new Date(iso));
}

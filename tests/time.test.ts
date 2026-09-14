/** Covers every relative-time threshold shown in the slice pickers. */

import { formatAgo } from "../src/time.js";
import { describe, expect, it } from "vitest";

const NOW = new Date("2026-03-10T12:00:00.000Z");

function ago(milliseconds: number): string {
  return new Date(NOW.getTime() - milliseconds).toISOString();
}

describe("formatAgo", () => {
  it.each([
    [59_000, "just now"],
    [60_000, "1m ago"],
    [59 * 60_000, "59m ago"],
    [60 * 60_000, "1h ago"],
    [23 * 60 * 60_000, "23h ago"],
    [24 * 60 * 60_000, "1d ago"],
    [6 * 24 * 60 * 60_000, "6d ago"],
  ])("formats an age of %i milliseconds as %s", (elapsed, expected) => {
    expect(formatAgo(ago(elapsed), NOW)).toBe(expected);
  });

  it("uses a short calendar date at seven days", () => {
    expect(formatAgo(ago(7 * 24 * 60 * 60_000), NOW)).toBe("Mar 3");
  });

  it("does not show a negative age for a future timestamp", () => {
    expect(formatAgo(new Date(NOW.getTime() + 1_000).toISOString(), NOW)).toBe(
      "just now",
    );
  });
});

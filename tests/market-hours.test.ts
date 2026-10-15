import { describe, expect, it } from "vitest";
import { marketStatus, opensLabel, untilLabel } from "@/lib/market-hours";

const at = (s: string) => new Date(s);

describe("market hours", () => {
  it("is open 9:30am–4pm New York time on a weekday", () => {
    expect(marketStatus(at("2026-10-14T15:00:00Z"))).toEqual({ open: true, next: at("2026-10-14T20:00:00Z") }); // 11am EDT
    expect(marketStatus(at("2026-10-14T13:00:00Z"))).toEqual({ open: false, next: at("2026-10-14T13:30:00Z") }); // 9am
    expect(marketStatus(at("2026-10-14T20:00:00Z"))).toEqual({ open: false, next: at("2026-10-15T13:30:00Z") }); // 4pm sharp
  });

  it("skips weekends and holidays, and closes early on half days", () => {
    expect(marketStatus(at("2026-10-16T21:00:00Z")).next).toEqual(at("2026-10-19T13:30:00Z")); // Fri evening → Mon
    expect(marketStatus(at("2026-11-25T22:00:00Z")).next).toEqual(at("2026-11-27T14:30:00Z")); // Thanksgiving skipped, EST
    expect(marketStatus(at("2026-11-27T17:00:00Z"))).toEqual({ open: true, next: at("2026-11-27T18:00:00Z") }); // 1pm close
    expect(marketStatus(at("2026-11-27T18:30:00Z")).open).toBe(false);
  });

  it("labels the countdown and the next open", () => {
    expect(untilLabel(134 * 60_000)).toBe("2h 14m");
    expect(untilLabel(120 * 60_000)).toBe("2h");
    expect(untilLabel(45 * 60_000 - 1)).toBe("45m");
    const now = at("2026-10-16T21:00:00Z");
    // On the Pacific clock by default.
    expect(opensLabel(marketStatus(now).next, now)).toBe("Mon 6:30 AM");
    const tonight = at("2026-10-14T22:00:00Z");
    expect(opensLabel(marketStatus(tonight).next, tonight)).toBe("tomorrow 6:30 AM");
    const early = at("2026-10-14T12:00:00Z");
    expect(opensLabel(marketStatus(early).next, early)).toBe("6:30 AM");
    // 10pm Pacific is already the next day in New York: "tomorrow" follows the Pacific date.
    const late = at("2026-10-15T05:00:00Z");
    expect(opensLabel(marketStatus(late).next, late)).toBe("tomorrow 6:30 AM");
    expect(opensLabel(marketStatus(late).next, late, "America/New_York")).toBe("9:30 AM");
  });
});

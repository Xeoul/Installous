import { describe, expect, it } from "vitest";
import { buildAlert, digestDue, weekKey } from "@/lib/alerts";
import { fundView, stepFund, type FundState } from "@/lib/fund";
import type { Pick } from "@/lib/portfolio";
import { pick, universe } from "./factories";

// Times in UTC; New York is UTC-4 in October.
const FRI_EVENING = new Date("2026-10-02T21:00:00Z"); // Fri 5:00pm ET
const FRI_MIDDAY = new Date("2026-10-02T16:00:00Z"); // Fri noon ET
const SATURDAY = new Date("2026-10-03T15:00:00Z");
const TUESDAY = new Date("2026-10-06T15:00:00Z");

describe("weekKey and digestDue", () => {
  it("keys a week by its Friday", () => {
    expect(weekKey(TUESDAY)).toBe("2026-10-09");
    expect(weekKey(FRI_EVENING)).toBe("2026-10-02");
  });

  it("is due after Friday's close and over the weekend, once per week", () => {
    expect(digestDue(FRI_MIDDAY, null)).toBe(false);
    expect(digestDue(FRI_EVENING, null)).toBe(true);
    expect(digestDue(SATURDAY, null)).toBe(true);
    expect(digestDue(SATURDAY, "2026-10-02")).toBe(false); // already sent for that week
    expect(digestDue(TUESDAY, "2026-10-02")).toBe(false);
  });
});

const fundOn = (picks = universe()) => {
  const state = stepFund(null, { picks, benchmarkPrice: 500, marketDate: "2026-09-29", now: new Date(0) }).state;
  return { state, view: fundView(state, picks) };
};
const input = (view = fundOn().view, now = TUESDAY, picks = universe()) => ({ fund: view, picks, now, fundUrl: "https://example.com/fund/" });

describe("buildAlert", () => {
  it("sends a welcome alert on the first run without re-announcing old trades", () => {
    const { state, alert } = buildAlert(null, input());
    expect(alert?.title).toBe("Installous alerts are on");
    expect(state.tradesReported).toBe(10);
  });

  it("doesn't follow the welcome with an empty digest the same weekend", () => {
    const first = buildAlert(null, input(fundOn().view, SATURDAY)).state;
    expect(buildAlert(first, input(fundOn().view, new Date(SATURDAY.getTime() + 3_600_000))).alert).toBeNull();
  });

  it("stays quiet when nothing happened", () => {
    const first = buildAlert(null, input()).state;
    expect(buildAlert(first, input()).alert).toBeNull();
  });

  it("announces new trades once, with their reasons", () => {
    const { state: fund0 } = fundOn();
    const prev = buildAlert(null, input(fundView(fund0, universe()))).state;
    const picks = universe();
    picks[0] = pick("T01", 40); // forces a sell at the next rebalance
    const next: FundState = stepFund(fund0, { picks, benchmarkPrice: 505, marketDate: "2026-10-06", now: new Date(0) }).state;
    const { state, alert } = buildAlert(prev, input(fundView(next, picks), TUESDAY, picks));
    expect(alert?.title).toMatch(/^Installous: 2 AI Fund trades/);
    expect(alert?.body).toContain("🔴 Sell | **T01**");
    expect(alert?.body).toContain("below the 45 Hold line");
    expect(buildAlert(state, input(fundView(next, picks), TUESDAY, picks)).alert).toBeNull();
  });

  it("sends a weekly digest with movers and rating changes", () => {
    const prev = buildAlert(null, input()).state;
    const picks: Pick[] = universe().map((p) => ({ ...p, price: p.ticker === "T05" ? 120 : 100 }));
    picks[1] = pick("T02", 50); // Strong Buy → Hold
    const { state, alert } = buildAlert(prev, input(fundOn().view, FRI_EVENING, picks));
    expect(alert?.title).toMatch(/weekly digest \(2026-10-02\)$/);
    expect(alert?.body).toContain("**T05** +20.00%");
    expect(alert?.body).toContain("**T02**: Strong Buy → Hold");
    expect(state.lastDigestWeek).toBe("2026-10-02");
    // Saturday's run doesn't send it again.
    expect(buildAlert(state, input(fundOn().view, SATURDAY, picks)).alert).toBeNull();
  });
});

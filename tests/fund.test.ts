import { describe, expect, it } from "vitest";
import { daysBetween, FUND_RULES, fundView, nyDate, stepFund, type FundState } from "@/lib/fund";
import type { Pick } from "@/lib/portfolio";
import { pick, universe } from "./factories";

const run = (prev: FundState | null, picks: Pick[], marketDate: string, spy = 500) =>
  stepFund(prev, { picks, benchmarkPrice: spy, marketDate, now: new Date("2026-01-01T00:00:00Z") });

const tickers = (s: FundState) => s.positions.map((p) => p.ticker).sort();

describe("date helpers", () => {
  it("counts days between dates", () => {
    expect(daysBetween("2026-09-29", "2026-10-06")).toBe(7);
    expect(daysBetween("2026-12-31", "2027-01-01")).toBe(1);
  });

  it("uses New York dates", () => {
    // 02:00 UTC is still the previous evening in New York.
    expect(nyDate(new Date("2026-10-01T02:00:00Z"))).toBe("2026-09-30");
  });
});

describe("first run", () => {
  const { state, trades } = run(null, universe(), "2026-09-29");

  it("buys the top 10 at equal weight", () => {
    expect(tickers(state)).toEqual(["T01", "T02", "T03", "T04", "T05", "T06", "T07", "T08", "T09", "T10"]);
    expect(trades).toHaveLength(10);
    for (const t of trades) {
      expect(t.side).toBe("buy");
      expect(t.value).toBeCloseTo(FUND_RULES.startCash / FUND_RULES.holdings, 0);
      expect(t.reason).toMatch(/^New pick: #\d+ with score \d+/);
    }
  });

  it("invests nearly all its cash and records the first point", () => {
    expect(state.cash).toBeGreaterThanOrEqual(0);
    expect(state.cash).toBeLessThan(1);
    expect(state.history).toHaveLength(1);
    expect(state.history[0].benchmark).toBe(FUND_RULES.startCash);
    // Only the simulated trading cost is lost.
    expect(state.history[0].equity).toBeCloseTo(FUND_RULES.startCash * (1 - FUND_RULES.slippage), 0);
  });

  it("is deterministic", () => {
    expect(run(null, universe(), "2026-09-29")).toEqual(run(null, universe(), "2026-09-29"));
  });
});

describe("between rebalances", () => {
  const first = run(null, universe(), "2026-09-29").state;

  it("doesn't trade before 7 days have passed", () => {
    const { trades } = run(first, universe(), "2026-10-02");
    expect(trades).toHaveLength(0);
  });

  it("overwrites the same day's point instead of adding one", () => {
    const again = run(first, universe(), "2026-09-29", 510).state;
    expect(again.history).toHaveLength(1);
    expect(again.history[0].benchmark).toBe(102_000);
  });

  it("adds one point per new market day", () => {
    const next = run(first, universe(), "2026-09-30").state;
    expect(next.history.map((p) => p.date)).toEqual(["2026-09-29", "2026-09-30"]);
  });

  it("tracks the benchmark from the starting price", () => {
    const next = run(first, universe(), "2026-09-30", 550).state;
    expect(next.history[1].benchmark).toBe(110_000);
  });
});

describe("weekly rebalance", () => {
  const first = run(null, universe(), "2026-09-29").state;

  it("makes no trades when nothing changed", () => {
    expect(run(first, universe(), "2026-10-06").trades).toHaveLength(0);
  });

  it("sells a holding whose score falls below Hold and buys the next best", () => {
    const picks = universe();
    picks[2] = pick("T03", 40);
    const { state, trades } = run(first, picks, "2026-10-06");
    const sell = trades.find((t) => t.side === "sell")!;
    expect(sell.ticker).toBe("T03");
    expect(sell.reason).toContain("below the 45 Hold line");
    expect(tickers(state)).not.toContain("T03");
    expect(tickers(state)).toContain("T11");
    expect(state.positions).toHaveLength(10);
  });

  it("keeps a holding that slips but stays within the top 15", () => {
    const picks = universe();
    picks[0] = pick("T01", 64); // falls to about #14
    const { state } = run(first, picks, "2026-10-06");
    expect(tickers(state)).toContain("T01");
  });

  it("sells a holding that falls outside the top 15", () => {
    const picks = universe();
    picks[0] = pick("T01", 50); // last place among 20
    const { trades } = run(first, picks, "2026-10-06");
    expect(trades.find((t) => t.ticker === "T01")?.reason).toMatch(/outside the top 15/);
  });

  it("trims a holding that grew far above its target weight", () => {
    const picks = universe();
    picks[0] = pick("T01", 90, 300); // tripled
    const { state, trades } = run(first, picks, "2026-10-06");
    const trim = trades.find((t) => t.ticker === "T01" && t.side === "sell");
    expect(trim?.reason).toMatch(/^Trimmed back to equal weight/);
    const view = fundView(state, picks);
    expect(view.holdings.find((h) => h.ticker === "T01")!.weight).toBeCloseTo(10, 0);
  });

  it("never spends more cash than it has", () => {
    const picks = universe().map((p, i) => pick(p.ticker, i < 5 ? 30 : (p.overall ?? 0), 100 + i * 7));
    const { state } = run(first, picks, "2026-10-06");
    expect(state.cash).toBeGreaterThanOrEqual(0);
  });

  it("holds cash when fewer than 10 stocks qualify", () => {
    const picks = universe().map((p, i) => pick(p.ticker, i < 4 ? 80 : 40));
    const { state } = run(null, picks, "2026-09-29");
    expect(state.positions).toHaveLength(4);
    expect(state.cash).toBeCloseTo(60_000, -2);
  });
});

describe("fundView", () => {
  it("reports returns against the benchmark and the next rebalance", () => {
    const first = run(null, universe(), "2026-09-29").state;
    const later = run(first, universe().map((p) => ({ ...p, price: 110 })), "2026-10-01", 505).state;
    const view = fundView(later, universe().map((p) => ({ ...p, price: 110 })));
    expect(view.returnPercent).toBeCloseTo(9.95, 1);
    expect(view.benchmarkReturnPercent).toBe(1);
    expect(view.nextRebalance).toBe("2026-10-06");
    expect(view.trades[0].date).toBe("2026-09-29"); // newest first
    expect(view.holdings.reduce((a, h) => a + h.weight, 0)).toBeCloseTo(100, 0);
  });
});

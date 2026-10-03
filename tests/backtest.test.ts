import { describe, expect, it } from "vitest";
import { runBacktest, type DailyClose } from "@/lib/backtest";

// ~2 years of weekdays.
const dates: string[] = [];
for (let d = Date.UTC(2023, 0, 2); dates.length < 520; d += 86_400_000) {
  const wd = new Date(d).getUTCDay();
  if (wd !== 0 && wd !== 6) dates.push(new Date(d).toISOString().slice(0, 10));
}
const series = (f: (i: number) => number): DailyClose[] => dates.map((date, i) => ({ date, close: f(i) }));

// 12 stocks: S01 rises fastest, S12 falls; SPY drifts up slowly.
const input = {
  series: Object.fromEntries(
    Array.from({ length: 12 }, (_, k) => [`S${String(k + 1).padStart(2, "0")}`, series((i) => 100 * (1 + (0.0012 - k * 0.0002)) ** i)]),
  ),
  names: {},
  benchmark: series((i) => 400 * 1.0003 ** i),
  startDate: dates[300],
};

describe("runBacktest", () => {
  const { state, view } = runBacktest(input, new Date(0));

  it("starts once there's a year of lookback and runs to the last day", () => {
    expect(view.startDate).toBe(dates[300]);
    expect(view.endDate).toBe(dates[dates.length - 1]);
  });

  it("holds the strongest momentum stocks and avoids the falling ones", () => {
    const held = state.positions.map((p) => p.ticker);
    expect(held).toContain("S01");
    expect(held).not.toContain("S12");
  });

  it("beats a slowly rising benchmark when its picks rise faster", () => {
    expect(view.stats.fund.totalReturnPercent).toBeGreaterThan(view.stats.benchmark.totalReturnPercent);
  });

  it("includes the equal-weight control starting from the same cash", () => {
    expect(view.history[0].universe).toBeCloseTo(state.startCash, -1);
    expect(view.stats.universe.totalReturnPercent).toBeGreaterThan(0);
  });

  it("never trades on a price it couldn't have known yet", () => {
    // From a rebalance day on, S12 (the worst performer) jumps 10x. The fund decides with
    // the previous close, so it can't buy S12 on the day of the jump, only at a later rebalance.
    const rebalanceDay = state.trades.find((t) => t.date > dates[400])!.date;
    const jump = dates.indexOf(rebalanceDay);
    const spiked = {
      ...input,
      series: { ...input.series, S12: input.series.S12.map((p, i) => (i >= jump ? { ...p, close: p.close * 10 } : p)) },
    };
    const r = runBacktest(spiked, new Date(0));
    const s12Buys = r.state.trades.filter((t) => t.ticker === "S12" && t.side === "buy");
    expect(s12Buys.length).toBeGreaterThan(0); // momentum does pick it up later...
    expect(s12Buys.every((t) => t.date > rebalanceDay)).toBe(true); // ...but never on the day itself
  });

  it("marks partial years", () => {
    expect(view.years[0].partial).toBe(true);
    expect(view.years[view.years.length - 1].partial).toBe(true);
  });
});

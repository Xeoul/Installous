import { describe, expect, it } from "vitest";
import type { FundTrade } from "@/lib/fund";
import { perfStats, tradeStats } from "@/lib/fund-stats";

const day = (i: number) => new Date(Date.UTC(2024, 0, 1) + i * 86_400_000).toISOString().slice(0, 10);

describe("perfStats", () => {
  it("measures total return and the deepest fall from a peak", () => {
    const s = perfStats([100, 120, 90, 110].map((value, i) => ({ date: day(i), value })));
    expect(s.totalReturnPercent).toBe(10);
    expect(s.maxDrawdownPercent).toBe(-25); // 120 → 90
    expect(s.cagrPercent).toBeNull(); // under a year
  });

  it("annualizes over a full year", () => {
    const s = perfStats([
      { date: "2023-01-01", value: 100 },
      { date: "2025-01-01", value: 121 },
    ]);
    expect(s.cagrPercent).toBeCloseTo(10, 0);
  });

  it("reports no volatility for a flat line and none for short histories", () => {
    const flat = perfStats(Array.from({ length: 30 }, (_, i) => ({ date: day(i), value: 100 })));
    expect(flat.volatilityPercent).toBe(0);
    expect(perfStats([{ date: day(0), value: 1 }]).volatilityPercent).toBeNull();
  });
});

const trade = (date: string, ticker: string, side: "buy" | "sell", shares: number, price: number): FundTrade => ({
  date, ticker, name: ticker, side, shares, price, value: shares * price, reason: "",
});

describe("tradeStats", () => {
  const trades = [
    trade("2024-01-01", "WIN", "buy", 10, 100),
    trade("2024-01-01", "LOSE", "buy", 10, 100),
    trade("2024-01-01", "HOLD", "buy", 10, 100),
    trade("2024-01-11", "WIN", "sell", 5, 150), // trim
    trade("2024-01-21", "WIN", "sell", 5, 130), // exit: proceeds 1400 on 1000
    trade("2024-01-31", "LOSE", "sell", 10, 80), // exit: 800 on 1000
  ];
  const s = tradeStats(trades, new Map([["HOLD", 200]]), "2024-02-10");

  it("turns the log into round trips", () => {
    expect(s.trades).toBe(6);
    expect(s.closedPositions).toBe(2);
    expect(s.winRatePercent).toBe(50);
    expect(s.avgHoldingDays).toBe(25); // 20 and 30 days
  });

  it("finds the best and worst positions, including open ones", () => {
    expect(s.best).toMatchObject({ ticker: "HOLD", returnPercent: 100, open: true, days: 40 });
    expect(s.worst).toMatchObject({ ticker: "LOSE", returnPercent: -20, open: false });
  });
});

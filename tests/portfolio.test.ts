import { describe, expect, it } from "vitest";
import { computePortfolio, mergeHolding, toPick } from "@/lib/portfolio";
import { scoreStock } from "@/lib/scoring";
import { fundamentals } from "./factories";

describe("mergeHolding", () => {
  it("adds a new position", () => {
    expect(mergeHolding([], "AAPL", 10, 150)).toEqual([{ ticker: "AAPL", shares: 10, costBasis: 150 }]);
  });

  it("re-averages the cost basis when buying more", () => {
    const [h] = mergeHolding([{ ticker: "AAPL", shares: 10, costBasis: 100 }], "AAPL", 10, 200);
    expect(h.shares).toBe(20);
    expect(h.costBasis).toBe(150);
  });
});

describe("computePortfolio", () => {
  const quotes = {
    AAPL: { ticker: "AAPL", name: "Apple", price: 200, change: 2, changePercent: 1 },
    MSFT: { ticker: "MSFT", name: "Microsoft", price: 100, change: -1, changePercent: -1 },
  };

  it("totals value, cost and gain, and computes weights", () => {
    const p = computePortfolio(
      [
        { ticker: "AAPL", shares: 10, costBasis: 100 },
        { ticker: "MSFT", shares: 20, costBasis: 100 },
      ],
      quotes,
      ["AAPL"],
    );
    expect(p.totalValue).toBe(4000);
    expect(p.totalCost).toBe(3000);
    expect(p.totalGain).toBe(1000);
    expect(p.totalGainPercent).toBeCloseTo(33.33, 2);
    expect(p.holdings.map((h) => h.weightPercent)).toEqual([50, 50]);
    expect(p.holdings[0].gainPercent).toBe(100);
  });

  it("handles a holding with no quote", () => {
    const p = computePortfolio([{ ticker: "ZZZZ", shares: 5, costBasis: 10 }], quotes, []);
    expect(p.holdings[0].value).toBeNull();
    expect(p.totalValue).toBe(0);
  });
});

describe("toPick", () => {
  it("flattens a scored stock and marks watchlist membership", () => {
    const f = fundamentals({ ticker: "AAPL", name: "Apple", price: 200, forwardPE: 20, returnOnEquity: 0.3, revenueGrowth: 0.1 });
    const p = toPick(f, scoreStock(f), ["AAPL"]);
    expect(p).toMatchObject({ ticker: "AAPL", name: "Apple", price: 200, onWatchlist: true });
    expect(Object.keys(p.factors)).toEqual(["value", "quality", "growth", "momentum", "sentiment"]);
  });
});

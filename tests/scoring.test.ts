import { describe, expect, it } from "vitest";
import { ratingFor, scoreStock } from "@/lib/scoring";
import { fundamentals } from "./factories";

describe("ratingFor", () => {
  it("maps scores to rating bands", () => {
    expect(ratingFor(null)).toBe("N/A");
    expect(ratingFor(72)).toBe("Strong Buy");
    expect(ratingFor(71)).toBe("Buy");
    expect(ratingFor(60)).toBe("Buy");
    expect(ratingFor(45)).toBe("Hold");
    expect(ratingFor(33)).toBe("Weak");
    expect(ratingFor(32)).toBe("Avoid");
  });
});

describe("scoreStock", () => {
  const strong = fundamentals({
    price: 120, fiftyDayAverage: 110, twoHundredDayAverage: 100, fiftyTwoWeekHigh: 121, fiftyTwoWeekLow: 80,
    fiftyTwoWeekChangePercent: 40, forwardPE: 12, trailingPE: 15, pegRatio: 0.9, enterpriseToEbitda: 7, priceToSales: 2,
    returnOnEquity: 0.3, operatingMargins: 0.3, profitMargins: 0.25, debtToEquity: 20, freeCashflow: 1e9,
    revenueGrowth: 0.3, earningsGrowth: 0.4, analystRatingMean: 1.5, analystCount: 30, targetMeanPrice: 156,
  });

  it("gives a strong company a Strong Buy", () => {
    const s = scoreStock(strong);
    expect(s.overall).toBeGreaterThanOrEqual(90);
    expect(s.rating).toBe("Strong Buy");
    expect(s.factors.map((f) => f.key)).toEqual(["value", "quality", "growth", "momentum", "sentiment"]);
  });

  it("keeps every factor score within 0-100", () => {
    const extreme = fundamentals({ forwardPE: 500, returnOnEquity: 5, revenueGrowth: -3, analystRatingMean: 5, analystCount: 3, price: 1, targetMeanPrice: 100 });
    for (const f of scoreStock(extreme).factors) {
      if (f.score !== null) {
        expect(f.score).toBeGreaterThanOrEqual(0);
        expect(f.score).toBeLessThanOrEqual(100);
      }
    }
  });

  it("scores a loss-making company's P/E as poor value", () => {
    const s = scoreStock(fundamentals({ forwardPE: -10 }));
    expect(s.factors.find((f) => f.key === "value")?.score).toBe(0);
  });

  it("withholds an overall score when too little data is available", () => {
    // Only sentiment (15% of the weight) has data.
    const s = scoreStock(fundamentals({ analystRatingMean: 1.2, analystCount: 10 }));
    expect(s.overall).toBeNull();
    expect(s.rating).toBe("N/A");
  });

  it("ignores analyst ratings when no analysts cover the stock", () => {
    const s = scoreStock(fundamentals({ analystRatingMean: 1, analystCount: 0 }));
    expect(s.factors.find((f) => f.key === "sentiment")?.score).toBeNull();
  });
});

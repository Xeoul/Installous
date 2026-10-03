import type { Fundamentals } from "@/lib/market";
import type { Pick } from "@/lib/portfolio";
import { ratingFor } from "@/lib/scoring";

export function fundamentals(overrides: Partial<Fundamentals> = {}): Fundamentals {
  const blank = Object.fromEntries(
    [
      "price", "change", "changePercent", "marketCap", "volume", "fiftyDayAverage", "twoHundredDayAverage",
      "fiftyTwoWeekHigh", "fiftyTwoWeekLow", "fiftyTwoWeekChangePercent", "trailingPE", "forwardPE", "pegRatio",
      "priceToBook", "priceToSales", "enterpriseToEbitda", "dividendYield", "beta", "revenueGrowth",
      "earningsGrowth", "grossMargins", "operatingMargins", "profitMargins", "returnOnEquity", "returnOnAssets",
      "debtToEquity", "currentRatio", "freeCashflow", "analystRating", "analystRatingMean", "analystCount",
      "targetMeanPrice",
    ].map((k) => [k, null]),
  );
  return { ticker: "TEST", name: "Test Corp", ...blank, ...overrides } as Fundamentals;
}

/** A pick with a given score and price; factor scores default to the overall score. */
export function pick(ticker: string, overall: number | null, price: number | null = 100): Pick {
  const f = overall;
  return {
    ticker,
    name: `${ticker} Inc.`,
    sector: "Technology",
    price,
    changePercent: 0,
    marketCap: 1e11,
    overall,
    rating: ratingFor(overall),
    factors: { value: f, quality: f, growth: f, momentum: f, sentiment: f },
    onWatchlist: false,
  };
}

/** 20 picks scored 90, 88, 86, ... so rank = index + 1. */
export function universe(): Pick[] {
  return Array.from({ length: 20 }, (_, i) => pick(`T${String(i + 1).padStart(2, "0")}`, 90 - i * 2));
}

// Pure portfolio and picks shaping, shared by the API routes, the demo data
// script and the static demo (which computes these in the browser).
import type { Fundamentals, Quote } from "./market";
import type { FactorKey, Rating, StockScore } from "./scoring";
import type { Holding } from "./store";

export interface PortfolioRow {
  ticker: string;
  name: string;
  shares: number;
  costBasis: number;
  price: number | null;
  dayChangePercent: number | null;
  value: number | null;
  gain: number | null;
  gainPercent: number | null;
  weightPercent: number | null;
}

export interface PortfolioSnapshot {
  holdings: PortfolioRow[];
  totalValue: number;
  totalCost: number;
  totalGain: number;
  totalGainPercent: number | null;
  watchlist: string[];
}

export function computePortfolio(
  holdings: Holding[],
  quotes: Record<string, Quote>,
  watchlist: string[],
): PortfolioSnapshot {
  const rows = holdings.map((h) => {
    const price = quotes[h.ticker]?.price ?? null;
    const value = price === null ? null : price * h.shares;
    const cost = h.costBasis * h.shares;
    return {
      ticker: h.ticker,
      name: quotes[h.ticker]?.name ?? h.ticker,
      shares: h.shares,
      costBasis: h.costBasis,
      price,
      dayChangePercent: quotes[h.ticker]?.changePercent ?? null,
      value,
      gain: value === null ? null : value - cost,
      gainPercent: value === null || cost === 0 ? null : (value / cost - 1) * 100,
    };
  });
  const totalValue = rows.reduce((a, r) => a + (r.value ?? 0), 0);
  const totalCost = holdings.reduce((a, h) => a + h.costBasis * h.shares, 0);
  return {
    holdings: rows.map((r) => ({
      ...r,
      weightPercent: totalValue > 0 && r.value !== null ? (r.value / totalValue) * 100 : null,
    })),
    totalValue,
    totalCost,
    totalGain: totalValue - totalCost,
    totalGainPercent: totalCost > 0 ? (totalValue / totalCost - 1) * 100 : null,
    watchlist,
  };
}

/** Buying more of an existing holding re-averages the cost basis. */
export function mergeHolding(holdings: Holding[], ticker: string, shares: number, price: number): Holding[] {
  const existing = holdings.find((h) => h.ticker === ticker);
  if (!existing) return [...holdings, { ticker, shares, costBasis: price }];
  const totalShares = existing.shares + shares;
  return holdings.map((h) =>
    h.ticker === ticker
      ? { ticker, shares: totalShares, costBasis: (h.costBasis * h.shares + price * shares) / totalShares }
      : h,
  );
}

export interface Pick {
  ticker: string;
  name: string;
  sector: string | null;
  price: number | null;
  changePercent: number | null;
  marketCap: number | null;
  overall: number | null;
  rating: Rating;
  factors: Record<FactorKey, number | null>;
  onWatchlist: boolean;
}

export function toPick(f: Fundamentals, score: StockScore, watchlist: string[]): Pick {
  return {
    ticker: f.ticker,
    name: f.name,
    sector: f.sector ?? null,
    price: f.price,
    changePercent: f.changePercent,
    marketCap: f.marketCap,
    overall: score.overall,
    rating: score.rating,
    factors: Object.fromEntries(score.factors.map((x) => [x.key, x.score])) as Record<FactorKey, number | null>,
    onWatchlist: watchlist.includes(f.ticker),
  };
}

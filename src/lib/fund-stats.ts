// Performance and trading statistics for a fund's value history and trade
// log. Used by both the live AI Fund and its backtest.
import type { FundTrade } from "./fund";

export interface PerfStats {
  totalReturnPercent: number;
  /** Annualized return; null for histories shorter than a year, where it would mislead. */
  cagrPercent: number | null;
  /** Largest fall from a previous peak, as a negative percent. */
  maxDrawdownPercent: number;
  /** Annualized standard deviation of daily returns; null with too few points. */
  volatilityPercent: number | null;
}

export interface PositionResult {
  ticker: string;
  name: string;
  returnPercent: number;
  open: boolean;
  days: number;
}

export interface TradeStats {
  trades: number;
  closedPositions: number;
  /** Share of closed positions that made money. */
  winRatePercent: number | null;
  avgHoldingDays: number | null;
  best: PositionResult | null;
  worst: PositionResult | null;
}

const round = (x: number, d = 2) => Math.round(x * 10 ** d) / 10 ** d;
const dayMs = 86_400_000;
const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / dayMs);

export function perfStats(points: { date: string; value: number }[]): PerfStats {
  if (points.length === 0) return { totalReturnPercent: 0, cagrPercent: null, maxDrawdownPercent: 0, volatilityPercent: null };
  const first = points[0];
  const last = points[points.length - 1];
  const total = last.value / first.value - 1;
  const spanDays = days(first.date, last.date);

  let peak = first.value;
  let maxDd = 0;
  for (const p of points) {
    peak = Math.max(peak, p.value);
    maxDd = Math.min(maxDd, p.value / peak - 1);
  }

  let volatility: number | null = null;
  if (points.length >= 20) {
    const rets = points.slice(1).map((p, i) => p.value / points[i].value - 1);
    const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
    const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
    // Sampling frequency from the data itself (daily points ~252/yr, weekly ~52/yr).
    const perYear = spanDays > 0 ? rets.length / (spanDays / 365.25) : 252;
    volatility = round(Math.sqrt(variance * perYear) * 100);
  }

  return {
    totalReturnPercent: round(total * 100),
    cagrPercent: spanDays >= 365 ? round(((1 + total) ** (365.25 / spanDays) - 1) * 100) : null,
    maxDrawdownPercent: round(maxDd * 100),
    volatilityPercent: volatility,
  };
}

/**
 * Replay the trade log into round trips (first buy to full exit). Open
 * positions are valued at `prices` (falling back to the last trade price).
 */
export function tradeStats(trades: FundTrade[], prices: Map<string, number>, asOf: string): TradeStats {
  interface Lot {
    name: string;
    shares: number;
    cost: number; // total cash spent buying, this round trip
    proceeds: number; // total cash received selling, this round trip
    opened: string;
    lastPrice: number;
  }
  const open = new Map<string, Lot>();
  const results: PositionResult[] = [];

  for (const t of trades) {
    let lot = open.get(t.ticker);
    if (!lot) {
      if (t.side === "sell") continue; // can't happen for a well-formed log
      lot = { name: t.name, shares: 0, cost: 0, proceeds: 0, opened: t.date, lastPrice: t.price };
      open.set(t.ticker, lot);
    }
    lot.lastPrice = t.price;
    if (t.side === "buy") {
      lot.shares += t.shares;
      lot.cost += t.value;
    } else {
      lot.shares -= t.shares;
      lot.proceeds += t.value;
      if (lot.shares <= 1e-6) {
        results.push({
          ticker: t.ticker,
          name: lot.name,
          returnPercent: round((lot.proceeds / lot.cost - 1) * 100),
          open: false,
          days: days(lot.opened, t.date),
        });
        open.delete(t.ticker);
      }
    }
  }

  const closed = [...results];
  for (const [ticker, lot] of open) {
    const value = lot.shares * (prices.get(ticker) ?? lot.lastPrice);
    results.push({
      ticker,
      name: lot.name,
      returnPercent: round(((value + lot.proceeds) / lot.cost - 1) * 100),
      open: true,
      days: days(lot.opened, asOf),
    });
  }

  const sorted = [...results].sort((a, b) => b.returnPercent - a.returnPercent);
  return {
    trades: trades.length,
    closedPositions: closed.length,
    winRatePercent: closed.length ? round((closed.filter((r) => r.returnPercent > 0).length / closed.length) * 100, 1) : null,
    avgHoldingDays: closed.length ? Math.round(closed.reduce((a, r) => a + r.days, 0) / closed.length) : null,
    best: sorted[0] ?? null,
    worst: sorted.length > 1 ? sorted[sorted.length - 1] : null,
  };
}

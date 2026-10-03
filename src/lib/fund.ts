// The AI Fund: a rules-only paper portfolio driven by the Installous score.
// Pure logic (no I/O) so the same code runs in the scheduled job and in tests;
// scripts/fund.ts loads prices, calls stepFund, and saves the result.
import { perfStats, tradeStats, type PerfStats, type TradeStats } from "./fund-stats";
import type { Pick } from "./portfolio";
import type { Rating } from "./scoring";

export const FUND_RULES = {
  startCash: 100_000,
  /** How many stocks the fund holds, each at an equal weight. */
  holdings: 10,
  /** A holding is kept while it ranks this high or better... */
  keepRank: 15,
  /** ...and its overall score stays at or above this (the Hold line). */
  minScore: 45,
  rebalanceDays: 7,
  /** Simulated cost of crossing the spread, applied to every fill. */
  slippage: 0.0005,
  /** Only trim or top up a holding once it drifts this far from its target weight (fraction of the fund). */
  driftBand: 0.02,
  /** Smallest trade the fund will place. */
  minTrade: 250,
  benchmark: "SPY",
} as const;

export interface FundPosition {
  ticker: string;
  name: string;
  shares: number;
  costBasis: number; // average cost per share
  openedAt: string; // YYYY-MM-DD
}

export interface FundTrade {
  date: string;
  ticker: string;
  name: string;
  side: "buy" | "sell";
  shares: number;
  price: number;
  value: number;
  reason: string;
}

export interface FundPoint {
  date: string;
  equity: number;
  benchmark: number; // SPY bought with the same starting cash on day one
}

export interface FundState {
  version: 1;
  startDate: string;
  startCash: number;
  benchmarkStartPrice: number;
  cash: number;
  positions: FundPosition[];
  lastRebalance: string | null;
  history: FundPoint[];
  trades: FundTrade[];
  updatedAt: string;
}

export interface FundInput {
  picks: Pick[];
  benchmarkPrice: number;
  /** The exchange date the prices belong to (YYYY-MM-DD, New York time). */
  marketDate: string;
  now: Date;
}

/** Days from a to b, both YYYY-MM-DD. */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

export function nyDate(t: Date): string {
  return t.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
}

const round = (x: number, d = 2) => Math.round(x * 10 ** d) / 10 ** d;

function topFactors(p: Pick): string {
  return Object.entries(p.factors)
    .filter((e): e is [string, number] => e[1] !== null)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([k, v]) => `${k} ${v}`)
    .join(", ");
}

function equityOf(state: FundState, prices: Map<string, number>): number {
  return state.cash + state.positions.reduce((a, p) => a + p.shares * (prices.get(p.ticker) ?? p.costBasis), 0);
}

/** Pick the target holdings and sell/buy toward equal weight. Mutates `s`. */
function rebalance(s: FundState, input: FundInput, prices: Map<string, number>) {
  const R = FUND_RULES;
  const date = input.marketDate;
  const ranked = input.picks
    .filter((p) => p.overall !== null && p.price !== null)
    .sort((a, b) => (b.overall ?? 0) - (a.overall ?? 0));
  const rankOf = new Map(ranked.map((p, i) => [p.ticker, i + 1]));
  const pickOf = new Map(ranked.map((p) => [p.ticker, p]));

  const kept = s.positions
    .filter((pos) => {
      const rank = rankOf.get(pos.ticker);
      const p = pickOf.get(pos.ticker);
      return rank !== undefined && rank <= R.keepRank && (p?.overall ?? 0) >= R.minScore;
    })
    .map((pos) => pos.ticker);
  const targets = [...kept];
  for (const p of ranked) {
    if (targets.length >= R.holdings) break;
    if ((p.overall ?? 0) < R.minScore) break;
    if (!targets.includes(p.ticker)) targets.push(p.ticker);
  }

  const trade = (pos: FundPosition, side: "buy" | "sell", shares: number, reason: string) => {
    const mid = prices.get(pos.ticker)!;
    const price = side === "buy" ? mid * (1 + R.slippage) : mid * (1 - R.slippage);
    const value = shares * price;
    s.cash += side === "buy" ? -value : value;
    s.trades.push({ date, ticker: pos.ticker, name: pos.name, side, shares: round(shares, 4), price: round(price), value: round(value), reason });
  };

  // Sells first, so their cash can fund the buys.
  for (const pos of [...s.positions]) {
    if (targets.includes(pos.ticker)) continue;
    if (!prices.has(pos.ticker)) continue; // no price today; try again next rebalance
    const rank = rankOf.get(pos.ticker);
    const p = pickOf.get(pos.ticker);
    const reason =
      !p || rank === undefined
        ? "No longer scored, so sold"
        : (p.overall ?? 0) < R.minScore
          ? `Score fell to ${p.overall} (${p.rating}), below the ${R.minScore} Hold line`
          : `Fell to #${rank} (score ${p.overall}), outside the top ${R.keepRank}`;
    trade(pos, "sell", pos.shares, reason);
    s.positions = s.positions.filter((x) => x !== pos);
  }

  const equity = equityOf(s, prices);
  const targetValue = equity / R.holdings; // unfilled slots stay in cash

  // Trim overweight holdings, then add to underweight ones and open new positions.
  const plans = targets.map((ticker) => {
    const pos = s.positions.find((x) => x.ticker === ticker);
    const value = pos ? pos.shares * prices.get(ticker)! : 0;
    return { ticker, pos, diff: targetValue - value, value };
  });
  const band = Math.max(R.minTrade, equity * R.driftBand);
  for (const plan of plans.filter((x) => x.pos && x.diff < -band)) {
    const pos = plan.pos!;
    const shares = -plan.diff / prices.get(pos.ticker)!;
    trade(pos, "sell", shares, `Trimmed back to equal weight (${((plan.value / equity) * 100).toFixed(1)}% → ${100 / R.holdings}%)`);
    pos.shares -= shares;
  }
  const buy = (plan: (typeof plans)[number]) => {
    const p = pickOf.get(plan.ticker)!;
    const mid = prices.get(plan.ticker)!;
    const spend = Math.min(plan.diff, s.cash);
    if (spend < R.minTrade) return;
    const shares = spend / (mid * (1 + R.slippage));
    let pos = plan.pos;
    const reason = pos
      ? `Topped up to equal weight (${((plan.value / equity) * 100).toFixed(1)}% → ${100 / R.holdings}%)`
      : `New pick: #${rankOf.get(plan.ticker)} with score ${p.overall} (${p.rating}); strongest on ${topFactors(p)}`;
    if (!pos) {
      pos = { ticker: plan.ticker, name: p.name, shares: 0, costBasis: 0, openedAt: date };
      s.positions.push(pos);
    }
    const fill = mid * (1 + R.slippage);
    pos.costBasis = (pos.costBasis * pos.shares + fill * shares) / (pos.shares + shares);
    pos.shares += shares;
    trade(pos, "buy", shares, reason);
    plan.diff -= spend;
  };
  // New picks first, then holdings that drifted well below target.
  for (const plan of plans.filter((x) => !x.pos && x.diff > R.minTrade)) buy(plan);
  for (const plan of plans.filter((x) => x.pos && x.diff > band)) buy(plan);
  // If sells left a meaningful amount of cash idle, put it into the most underweight holdings.
  if (s.cash > band) {
    for (const plan of plans.filter((x) => x.diff > R.minTrade).sort((a, b) => b.diff - a.diff)) buy(plan);
  }
  s.lastRebalance = date;
}

/**
 * Advance the fund to `input.marketDate`: start it on the first run,
 * rebalance when one is due, and record today's value against the benchmark.
 * Returns a new state and the trades made in this step.
 */
export function stepFund(prev: FundState | null, input: FundInput): { state: FundState; trades: FundTrade[] } {
  const R = FUND_RULES;
  const s: FundState = prev
    ? structuredClone(prev)
    : {
        version: 1,
        startDate: input.marketDate,
        startCash: R.startCash,
        benchmarkStartPrice: input.benchmarkPrice,
        cash: R.startCash,
        positions: [],
        lastRebalance: null,
        history: [],
        trades: [],
        updatedAt: input.now.toISOString(),
      };
  const tradesBefore = s.trades.length;
  const prices = new Map(
    input.picks.filter((p) => p.price !== null).map((p) => [p.ticker, p.price as number]),
  );

  const due = s.lastRebalance === null || daysBetween(s.lastRebalance, input.marketDate) >= R.rebalanceDays;
  if (due) rebalance(s, input, prices);

  // One point per market day; later runs on the same day overwrite it.
  const point: FundPoint = {
    date: input.marketDate,
    equity: round(equityOf(s, prices)),
    benchmark: round((s.startCash * input.benchmarkPrice) / s.benchmarkStartPrice),
  };
  const last = s.history[s.history.length - 1];
  if (last?.date === point.date) s.history[s.history.length - 1] = point;
  else if (!last || last.date < point.date) s.history.push(point);

  s.cash = round(s.cash);
  s.updatedAt = input.now.toISOString();
  return { state: s, trades: s.trades.slice(tradesBefore) };
}

// ---------------------------------------------------------------------------
// What the Fund page shows

export interface FundHoldingView {
  ticker: string;
  name: string;
  shares: number;
  costBasis: number;
  price: number | null;
  value: number;
  weight: number; // percent of fund
  gainPercent: number | null;
  score: number | null;
  rating: Rating | null;
  openedAt: string;
}

export interface FundView {
  rules: typeof FUND_RULES;
  startDate: string;
  asOf: string;
  updatedAt: string;
  equity: number;
  cash: number;
  returnPercent: number;
  benchmarkValue: number;
  benchmarkReturnPercent: number;
  lastRebalance: string | null;
  nextRebalance: string | null;
  holdings: FundHoldingView[];
  history: FundPoint[];
  trades: FundTrade[]; // newest first
  stats: { fund: PerfStats; benchmark: PerfStats; trading: TradeStats };
}

export function fundView(s: FundState, picks: Pick[]): FundView {
  const pickOf = new Map(picks.map((p) => [p.ticker, p]));
  const holdings = s.positions.map((pos) => {
    const p = pickOf.get(pos.ticker);
    const price = p?.price ?? null;
    const value = pos.shares * (price ?? pos.costBasis);
    return {
      ticker: pos.ticker,
      name: pos.name,
      shares: round(pos.shares, 4),
      costBasis: round(pos.costBasis),
      price,
      value: round(value),
      weight: 0,
      gainPercent: price === null ? null : round((price / pos.costBasis - 1) * 100),
      score: p?.overall ?? null,
      rating: p?.rating ?? null,
      openedAt: pos.openedAt,
    };
  });
  const equity = s.cash + holdings.reduce((a, h) => a + h.value, 0);
  for (const h of holdings) h.weight = round((h.value / equity) * 100);
  holdings.sort((a, b) => b.value - a.value);

  const last = s.history[s.history.length - 1];
  const next = s.lastRebalance
    ? new Date(Date.parse(`${s.lastRebalance}T00:00:00Z`) + FUND_RULES.rebalanceDays * 86_400_000).toISOString().slice(0, 10)
    : null;
  return {
    rules: FUND_RULES,
    startDate: s.startDate,
    asOf: last?.date ?? s.startDate,
    updatedAt: s.updatedAt,
    equity: round(equity),
    cash: s.cash,
    returnPercent: round((equity / s.startCash - 1) * 100),
    benchmarkValue: last?.benchmark ?? s.startCash,
    benchmarkReturnPercent: round(((last?.benchmark ?? s.startCash) / s.startCash - 1) * 100),
    lastRebalance: s.lastRebalance,
    nextRebalance: next,
    holdings,
    history: s.history,
    trades: [...s.trades].reverse(),
    stats: {
      fund: perfStats(s.history.map((p) => ({ date: p.date, value: p.equity }))),
      benchmark: perfStats(s.history.map((p) => ({ date: p.date, value: p.benchmark }))),
      trading: tradeStats(
        s.trades,
        new Map(picks.filter((p) => p.price !== null).map((p) => [p.ticker, p.price as number])),
        last?.date ?? s.startDate,
      ),
    },
  };
}

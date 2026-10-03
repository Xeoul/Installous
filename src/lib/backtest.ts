// Backtest of the AI Fund's rules on historical prices.
//
// Free data only has *today's* fundamentals, so scoring past dates with
// them would leak the future. The backtest therefore ranks stocks by the
// Installous momentum factor alone, which can be rebuilt exactly from past
// prices, and runs it through the real fund engine (stepFund). Each day's
// ranking uses prices up to the previous close; trades fill at that day's close.
import { FUND_RULES, stepFund, type FundPoint, type FundState } from "./fund";
import { perfStats, tradeStats, type PerfStats, type TradeStats } from "./fund-stats";
import type { Pick } from "./portfolio";
import { momentumScore, ratingFor } from "./scoring";

export interface DailyClose {
  date: string; // YYYY-MM-DD, exchange time
  close: number;
}

export interface BacktestInput {
  /** Daily closes per ticker; needs about a year of history before `startDate`. */
  series: Record<string, DailyClose[]>;
  names: Record<string, string>;
  benchmark: DailyClose[];
  startDate: string;
}

export interface YearReturn {
  year: number;
  /** True for the first and last years, which the backtest only partly covers. */
  partial: boolean;
  fundPercent: number;
  benchmarkPercent: number;
  universePercent: number;
}

/** A backtest day: the fund, SPY, and the same stocks bought equally and held. */
export interface BacktestPoint extends FundPoint {
  universe: number;
}

export interface BacktestView {
  rules: typeof FUND_RULES;
  factor: "momentum";
  startDate: string;
  endDate: string;
  universeSize: number;
  /** Weekly points for the chart (full daily history is used for the stats). */
  history: BacktestPoint[];
  stats: { fund: PerfStats; benchmark: PerfStats; universe: PerfStats; trading: TradeStats };
  years: YearReturn[];
  generatedAt: string;
}

/** Trading days of lookback the 52-week factors need. */
const LOOKBACK = 253;

const round = (x: number, d = 2) => Math.round(x * 10 ** d) / 10 ** d;

export function runBacktest(input: BacktestInput, now = new Date()): { state: FundState; view: BacktestView } {
  const calendar = input.benchmark.map((b) => b.date);
  const tickers = Object.keys(input.series);

  // Align every ticker to the benchmark's calendar: null until it starts
  // trading, then carry the last close forward over any missing day.
  const aligned: Record<string, (number | null)[]> = {};
  for (const t of tickers) {
    const byDate = new Map(input.series[t].map((p) => [p.date, p.close]));
    let last: number | null = null;
    aligned[t] = calendar.map((d) => {
      last = byDate.get(d) ?? last;
      return last;
    });
  }

  const startIndex = calendar.findIndex((d) => d >= input.startDate);
  if (startIndex < 0) throw new Error("Backtest start date is after the last price");

  let state: FundState | null = null;
  for (let i = Math.max(startIndex, LOOKBACK + 1); i < calendar.length; i++) {
    const picks: Pick[] = [];
    for (const t of tickers) {
      const closes = aligned[t];
      const today = closes[i];
      const window = closes.slice(i - LOOKBACK, i); // up to yesterday's close
      if (today === null || window.some((c) => c === null)) continue;
      const w = window as number[];
      const yesterday = w[w.length - 1];
      const avg = (n: number) => w.slice(-n).reduce((a, b) => a + b, 0) / n;
      const year = w.slice(-252);
      const momentum = momentumScore({
        price: yesterday,
        fiftyDayAverage: avg(50),
        twoHundredDayAverage: avg(200),
        fiftyTwoWeekHigh: Math.max(...year),
        fiftyTwoWeekLow: Math.min(...year),
        fiftyTwoWeekChangePercent: (yesterday / w[0] - 1) * 100,
      }).score;
      picks.push({
        ticker: t,
        name: input.names[t] ?? t,
        sector: null,
        price: today,
        changePercent: null,
        marketCap: null,
        overall: momentum,
        rating: ratingFor(momentum),
        factors: { value: null, quality: null, growth: null, momentum, sentiment: null },
        onWatchlist: false,
      });
    }
    if (picks.length === 0) continue;
    state = stepFund(state, {
      picks,
      benchmarkPrice: input.benchmark[i].close,
      marketDate: calendar[i],
      now,
    }).state;
  }
  if (!state) throw new Error("Not enough price history to run the backtest");

  // Control: the same universe bought in equal amounts on day one and held.
  // It shows how much of the result comes from the stock list itself, which
  // is today's large caps, chosen with hindsight.
  const firstIndex = calendar.indexOf(state.history[0].date);
  const holdings = tickers
    .filter((t) => aligned[t][firstIndex] !== null)
    .map((t) => ({ t, shares: state!.startCash / aligned[t][firstIndex]! }));
  const perStock = holdings.length;
  const universeOn = (i: number) =>
    holdings.reduce((a, x) => a + (x.shares * (aligned[x.t][i] ?? aligned[x.t][firstIndex]!)) / perStock, 0);
  const h: BacktestPoint[] = state.history.map((p) => ({ ...p, universe: round(universeOn(calendar.indexOf(p.date))) }));
  const lastPrices = new Map(tickers.map((t) => [t, aligned[t][calendar.length - 1]]).filter((e): e is [string, number] => e[1] !== null));

  // Calendar-year returns, chaining from the previous year's last point.
  const years: YearReturn[] = [];
  let prev = h[0];
  for (let k = 0; k < h.length; k++) {
    const p = h[k];
    const isYearEnd = k === h.length - 1 || h[k + 1].date.slice(0, 4) !== p.date.slice(0, 4);
    if (!isYearEnd) continue;
    years.push({
      year: Number(p.date.slice(0, 4)),
      partial: (years.length === 0 && h[0].date.slice(5) > "01-07") || (k === h.length - 1 && p.date.slice(5) < "12-24"),
      fundPercent: round((p.equity / prev.equity - 1) * 100),
      benchmarkPercent: round((p.benchmark / prev.benchmark - 1) * 100),
      universePercent: round((p.universe / prev.universe - 1) * 100),
    });
    prev = p;
  }

  const weekly = h.filter((_, k) => k % 5 === 0 || k === h.length - 1);
  return {
    state,
    view: {
      rules: FUND_RULES,
      factor: "momentum",
      startDate: h[0].date,
      endDate: h[h.length - 1].date,
      universeSize: tickers.length,
      history: weekly,
      stats: {
        fund: perfStats(h.map((p) => ({ date: p.date, value: p.equity }))),
        benchmark: perfStats(h.map((p) => ({ date: p.date, value: p.benchmark }))),
        universe: perfStats(h.map((p) => ({ date: p.date, value: p.universe }))),
        trading: tradeStats(state.trades, lastPrices, h[h.length - 1].date),
      },
      years,
      generatedAt: now.toISOString(),
    },
  };
}

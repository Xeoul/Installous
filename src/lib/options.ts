// Paper-tests S&P 500 iron condors over historical daily data, with either a
// fixed size or martingale sizing (double the size after every loss, back to
// the base size after a win). Real historical option prices aren't free, so
// each option is priced with Black-Scholes using the VIX as its volatility.
// That's an estimate: it ignores skew and intraday moves, and real fills
// differ. It's good enough to show how a strategy and its sizing behave over
// calm years and crashes.
import { perfStats, type PerfStats } from "./fund-stats";

/** One trading day of the S&P 500 index with that day's VIX close. */
export interface IndexBar {
  date: string;
  open: number;
  close: number;
  vix: number;
}

export type Sizing = "fixed" | "martingale";

export interface CondorRules {
  /** Calendar days to expiration; 0 opens at the open and settles at the close. */
  dte: number;
  /** Delta of the short put and short call, e.g. 0.1. */
  shortDelta: number;
  /** Distance between each short strike and its long wing, in index points. */
  width: number;
  /** Close early once this share of the credit is kept (0.5 = 50%); null holds to expiry. */
  takeProfit: number | null;
  /** Close early once the loss reaches this multiple of the credit; null holds to expiry. */
  stopLoss: number | null;
  /** Contracts per trade at the base size. */
  contracts: number;
  startCash: number;
  sizing: Sizing;
  /** Martingale only: after this many doublings in a row, give up and reset to the base size. null = never. */
  maxDoublings: number | null;
  /** Commission per contract per leg, in dollars. */
  feePerLeg: number;
  /** Price given up per two-leg spread each time you trade it, in index points. */
  slippage: number;
}

export const DEFAULT_RULES: CondorRules = {
  dte: 0,
  shortDelta: 0.1,
  width: 10,
  takeProfit: null,
  stopLoss: null,
  contracts: 1,
  startCash: 25_000,
  sizing: "martingale",
  maxDoublings: null,
  feePerLeg: 0.65,
  slippage: 0.05,
};

export interface Condor {
  putLong: number;
  putShort: number;
  callShort: number;
  callLong: number;
  /** Credit received per share, after slippage. */
  credit: number;
}

export interface CondorTrade extends Condor {
  opened: string;
  closed: string;
  spot: number;
  vix: number;
  contracts: number;
  /** Losses in a row before this trade (what the martingale doubled for). */
  streak: number;
  /** True when the size the rules asked for was more than the account could cover. */
  capped: boolean;
  exit: "expired" | "profit" | "stop";
  pnl: number;
  equityAfter: number;
}

export interface CondorStats extends PerfStats {
  finalEquity: number;
  trades: number;
  winRatePercent: number | null;
  avgWin: number | null;
  avgLoss: number | null;
  longestLosingStreak: number;
  largestPosition: number;
  worstTrade: number | null;
  /** Date the account could no longer afford one contract, if it happened. */
  bust: string | null;
}

export interface CondorResult {
  rules: CondorRules;
  curve: { date: string; equity: number }[];
  trades: CondorTrade[];
  stats: CondorStats;
}

const RATE = 0.03; // flat risk-free rate; small effect on short-dated options
const YEAR = 252; // trading days
const STRIKE_STEP = 5;
const MULTIPLIER = 100;
const MIN_CREDIT = 0.1; // skip days when the condor would pay less than this
// Roughly a quarter of the index's daily price variance is the overnight gap,
// so a same-day option opened at the open only faces the remaining ~75%.
const OPEN_TO_CLOSE = 0.75 / YEAR;

// ---------------------------------------------------------------------------
// Black-Scholes

/** Standard normal CDF (Zelen & Severo, error < 7.5e-8). */
export function normCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp((-x * x) / 2);
  const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? 1 - p : p;
}

/** Inverse standard normal CDF (Acklam, relative error < 1.2e-9). */
export function normInv(p: number): number {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const lo = 0.02425;
  if (p < lo) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > 1 - lo) return -normInv(1 - p);
  const q = p - 0.5;
  const r = q * q;
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

/** European option price per share. `t` in years, `vol` as a fraction. */
export function bsPrice(kind: "call" | "put", spot: number, strike: number, t: number, vol: number): number {
  if (t <= 0 || vol <= 0) return Math.max(0, kind === "call" ? spot - strike : strike - spot);
  const sd = vol * Math.sqrt(t);
  const d1 = (Math.log(spot / strike) + (RATE + (vol * vol) / 2) * t) / sd;
  const d2 = d1 - sd;
  const df = Math.exp(-RATE * t);
  return kind === "call" ? spot * normCdf(d1) - strike * df * normCdf(d2) : strike * df * normCdf(-d2) - spot * normCdf(-d1);
}

/** The strike whose option has the given delta (absolute value). */
function strikeForDelta(kind: "call" | "put", spot: number, delta: number, t: number, vol: number): number {
  const d1 = kind === "call" ? normInv(delta) : normInv(1 - delta);
  const sd = vol * Math.sqrt(t);
  return spot * Math.exp(-d1 * sd + (RATE + (vol * vol) / 2) * t);
}

/** What it costs to buy the condor back (per share, before slippage). */
export function condorValue(c: Omit<Condor, "credit">, spot: number, t: number, vol: number): number {
  const puts = bsPrice("put", spot, c.putShort, t, vol) - bsPrice("put", spot, c.putLong, t, vol);
  const calls = bsPrice("call", spot, c.callShort, t, vol) - bsPrice("call", spot, c.callLong, t, vol);
  return Math.max(0, puts) + Math.max(0, calls);
}

/** Pick strikes by delta and price the condor. */
export function buildCondor(spot: number, t: number, vol: number, rules: Pick<CondorRules, "shortDelta" | "width" | "slippage">): Condor {
  const width = Math.max(STRIKE_STEP, Math.round(rules.width / STRIKE_STEP) * STRIKE_STEP);
  const putShort = Math.floor(strikeForDelta("put", spot, rules.shortDelta, t, vol) / STRIKE_STEP) * STRIKE_STEP;
  const callShort = Math.ceil(strikeForDelta("call", spot, rules.shortDelta, t, vol) / STRIKE_STEP) * STRIKE_STEP;
  const strikes = { putLong: putShort - width, putShort, callShort, callLong: callShort + width };
  // Selling two spreads, so slippage twice.
  const credit = condorValue(strikes, spot, t, vol) - 2 * rules.slippage;
  return { ...strikes, credit };
}

/** Index points per share owed at expiration. */
export function settlement(c: Omit<Condor, "credit">, spot: number): number {
  const width = c.putShort - c.putLong;
  return Math.min(width, Math.max(0, c.putShort - spot)) + Math.min(width, Math.max(0, spot - c.callShort));
}

// ---------------------------------------------------------------------------
// Simulation

const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Index of the expiry bar: the last trading day on or before `dte` calendar days out (at least the next day). */
function expiryIndex(bars: IndexBar[], i: number, dte: number): number | null {
  if (i + 1 >= bars.length) return null;
  const last = addDays(bars[i].date, dte);
  let e = i + 1;
  while (e + 1 < bars.length && bars[e + 1].date <= last) e++;
  // Ran out of data before the real expiry: can't finish this trade.
  if (e === bars.length - 1 && bars[e].date < last && addDays(bars[e].date, 4) < last) return null;
  return e;
}

/** How many contracts to trade next. */
export function sizeFor(rules: CondorRules, streak: number): { contracts: number; streak: number } {
  if (rules.sizing === "fixed") return { contracts: rules.contracts, streak };
  if (rules.maxDoublings !== null && streak > rules.maxDoublings) return { contracts: rules.contracts, streak: 0 };
  return { contracts: rules.contracts * 2 ** streak, streak };
}

export function simulateCondors(bars: IndexBar[], rules: CondorRules): CondorResult {
  const trades: CondorTrade[] = [];
  const curve: { date: string; equity: number }[] = [];
  let equity = rules.startCash;
  let streak = 0;
  let bust: string | null = null;
  const fees = (contracts: number) => 4 * rules.feePerLeg * contracts;

  const settle = (t: Omit<CondorTrade, "pnl" | "equityAfter" | "closed" | "exit">, closed: string, exit: CondorTrade["exit"], perShare: number, closeFees: number) => {
    const pnl = perShare * MULTIPLIER * t.contracts - fees(t.contracts) - closeFees;
    equity += pnl;
    trades.push({ ...t, closed, exit, pnl, equityAfter: equity });
    streak = pnl < 0 ? streak + 1 : 0;
  };

  /** Size a new trade, or report the account can't afford one. */
  const open = (date: string, spot: number, vix: number, condor: Condor) => {
    const next = sizeFor(rules, streak);
    streak = next.streak;
    const margin = (condor.putShort - condor.putLong - condor.credit) * MULTIPLIER + fees(1);
    const affordable = Math.floor(equity / margin);
    if (affordable < 1) {
      bust = date;
      return null;
    }
    const contracts = Math.min(next.contracts, affordable);
    return { ...condor, opened: date, spot, vix, contracts, streak, capped: contracts < next.contracts };
  };

  if (rules.dte === 0) {
    // Same-day condors: open at the open (priced with the VIX known at the open,
    // i.e. yesterday's close) and settle at the close.
    for (let i = 1; i < bars.length && !bust; i++) {
      const bar = bars[i];
      const vol = bars[i - 1].vix / 100;
      const condor = buildCondor(bar.open, OPEN_TO_CLOSE, vol, rules);
      if (condor.credit >= MIN_CREDIT) {
        const t = open(bar.date, bar.open, bars[i - 1].vix, condor);
        if (t) settle(t, bar.date, "expired", t.credit - settlement(t, bar.close), 0);
      }
      curve.push({ date: bar.date, equity });
    }
  } else {
    let i = 0;
    curve.push({ date: bars[0].date, equity });
    while (i < bars.length - 1 && !bust) {
      const e = expiryIndex(bars, i, rules.dte);
      if (e === null) break;
      const vol = bars[i].vix / 100;
      const condor = buildCondor(bars[i].close, (e - i) / YEAR, vol, rules);
      const t = condor.credit >= MIN_CREDIT ? open(bars[i].date, bars[i].close, bars[i].vix, condor) : null;
      if (!t) {
        i++;
        curve.push({ date: bars[i].date, equity });
        continue;
      }
      // Mark the open trade at each close until it's closed or expires.
      let j = i + 1;
      for (; j <= e; j++) {
        const bar = bars[j];
        if (j === e) {
          settle(t, bar.date, "expired", t.credit - settlement(t, bar.close), 0);
          curve.push({ date: bar.date, equity });
          break;
        }
        const cost = condorValue(t, bar.close, (e - j) / YEAR, bar.vix / 100) + 2 * rules.slippage;
        const kept = t.credit - cost;
        const exit = rules.takeProfit !== null && kept >= rules.takeProfit * t.credit
          ? "profit"
          : rules.stopLoss !== null && -kept >= rules.stopLoss * t.credit
            ? "stop"
            : null;
        if (exit) {
          settle(t, bar.date, exit, kept, fees(t.contracts));
          curve.push({ date: bar.date, equity });
          break;
        }
        curve.push({ date: bar.date, equity: equity + kept * MULTIPLIER * t.contracts - fees(t.contracts) });
      }
      // The next condor opens at the close of the day this one ended.
      i = Math.min(j, e);
    }
  }

  return { rules, curve, trades, stats: statsFor(rules, curve, trades, bust) };
}

function statsFor(rules: CondorRules, curve: CondorResult["curve"], trades: CondorTrade[], bust: string | null): CondorStats {
  const wins = trades.filter((t) => t.pnl >= 0);
  const losses = trades.filter((t) => t.pnl < 0);
  let run = 0;
  let longest = 0;
  for (const t of trades) {
    run = t.pnl < 0 ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  const avg = (xs: CondorTrade[]) => (xs.length ? Math.round(xs.reduce((a, t) => a + t.pnl, 0) / xs.length) : null);
  const points = curve.map((p) => ({ date: p.date, value: Math.max(p.equity, 0.01) }));
  return {
    ...perfStats(points.length ? points : [{ date: "", value: rules.startCash }]),
    finalEquity: Math.round((curve.at(-1)?.equity ?? rules.startCash) * 100) / 100,
    trades: trades.length,
    winRatePercent: trades.length ? Math.round((wins.length / trades.length) * 1000) / 10 : null,
    avgWin: avg(wins),
    avgLoss: avg(losses),
    longestLosingStreak: longest,
    largestPosition: trades.reduce((m, t) => Math.max(m, t.contracts), 0),
    worstTrade: trades.length ? Math.round(Math.min(...trades.map((t) => t.pnl))) : null,
    bust,
  };
}

/**
 * The martingale ladder: what each loss in a row asks you to bet next, and
 * how much you've lost by then if every trade loses its maximum.
 */
export function doublingLadder(condor: Condor, rules: Pick<CondorRules, "contracts" | "startCash" | "feePerLeg">, winRate: number | null, trades: number) {
  const maxLoss = (condor.putShort - condor.putLong - condor.credit) * MULTIPLIER + 4 * rules.feePerLeg;
  const rows: { losses: number; contracts: number; atRisk: number; lostSoFar: number; affordable: boolean; chance: number | null; expected: number | null }[] = [];
  let lost = 0;
  for (let k = 0; k <= 12; k++) {
    const contracts = rules.contracts * 2 ** k;
    const atRisk = contracts * maxLoss;
    const q = winRate === null ? null : 1 - winRate / 100;
    rows.push({
      losses: k,
      contracts,
      atRisk,
      lostSoFar: lost,
      affordable: atRisk + lost <= rules.startCash,
      chance: q === null ? null : q ** k,
      // Rough count of times you'd hit k losses in a row over this many trades.
      expected: q === null || k === 0 ? null : trades * (1 - q) * q ** k,
    });
    lost += atRisk;
    if (lost > rules.startCash * 4) break;
  }
  return rows;
}

/** The condor these rules would open next, priced from the latest close and VIX. */
export function nextCondor(bars: IndexBar[], rules: CondorRules): { date: string; spot: number; vix: number; condor: Condor } | null {
  const last = bars.at(-1);
  if (!last) return null;
  const t = rules.dte === 0 ? OPEN_TO_CLOSE : Math.max(1, Math.round((rules.dte * 5) / 7)) / YEAR;
  return { date: last.date, spot: last.close, vix: last.vix, condor: buildCondor(last.close, t, last.vix / 100, rules) };
}

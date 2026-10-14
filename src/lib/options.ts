// Paper-tests SPY (S&P 500 ETF) iron condors over historical daily data, with
// either a fixed size or martingale sizing (a level ladder such as 1, 3, 6
// contracts, or doubling after every loss; back to the start after a win). Real historical option prices aren't free, so
// each option is priced with Black-Scholes using the VIX as its volatility.
// That's an estimate: it ignores skew and intraday moves, and real fills
// differ. It's good enough to show how a strategy and its sizing behave over
// calm years and crashes.
import { perfStats, type PerfStats } from "./fund-stats";

/** One trading day of SPY with that day's VIX close. */
export interface IndexBar {
  date: string;
  open: number;
  close: number;
  vix: number;
}

/**
 * IndexBar[] in a compact, columnar form for the wire: about a third the size
 * as JSON (dates become day gaps from the first bar).
 */
export interface PackedBars {
  start: string;
  gaps: number[];
  open: number[];
  close: number[];
  vix: number[];
}

const DAY_MS = 86_400_000;

export function packBars(bars: IndexBar[]): PackedBars {
  const ms = bars.map((b) => Date.parse(`${b.date}T00:00:00Z`));
  return {
    start: bars[0]?.date ?? "",
    gaps: ms.map((t, i) => (i === 0 ? 0 : Math.round((t - ms[i - 1]) / DAY_MS))),
    open: bars.map((b) => b.open),
    close: bars.map((b) => b.close),
    vix: bars.map((b) => b.vix),
  };
}

export function unpackBars(p: PackedBars): IndexBar[] {
  let t = Date.parse(`${p.start}T00:00:00Z`);
  return p.gaps.map((gap, i) => {
    t += gap * DAY_MS;
    return { date: new Date(t).toISOString().slice(0, 10), open: p.open[i], close: p.close[i], vix: p.vix[i] };
  });
}

export type Sizing = "fixed" | "martingale";

export interface CondorRules {
  /** Calendar days to expiration; 0 opens at the open and settles at the close. */
  dte: number;
  /** Delta of the short put and short call, e.g. 0.1 (ignored with evenMoney). */
  shortDelta: number;
  /**
   * Place the short strikes so the credit is about half the wing width: a win
   * pays about what a loss costs (e.g. $4 wings, ~$2 credit: +$200 / -$200).
   */
  evenMoney: boolean;
  /** Distance between each short strike and its long wing, in dollars. */
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
  /**
   * Martingale steps as contract counts per level, e.g. [1, 2, 5, 10, 25]: a
   * loss moves up a level, any win goes back to the first, and a loss on the
   * last level starts over. null doubles the base size after each loss instead.
   */
  levels: number[] | null;
  /** Fees per contract per leg, in dollars (commission-free brokers still pass on small regulatory fees). */
  feePerLeg: number;
  /** Price given up per two-leg spread each time you trade it, in dollars per share. */
  slippage: number;
  /**
   * Options priced at this share of the VIX (1 = at the VIX). Very short-dated
   * options often trade below the VIX, so lower values stress-test the edge.
   */
  ivScale: number;
}

export const DEFAULT_RULES: CondorRules = {
  dte: 1,
  shortDelta: 0.1,
  evenMoney: true,
  width: 4,
  takeProfit: null,
  stopLoss: null,
  contracts: 1,
  startCash: 25_000,
  sizing: "martingale",
  maxDoublings: null,
  levels: [1, 3, 6],
  feePerLeg: 0.04,
  slippage: 0.01,
  ivScale: 1,
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
const STRIKE_STEP = 1; // SPY strikes are $1 apart
const MULTIPLIER = 100;
const MIN_CREDIT = 0.05; // skip days when the condor would pay less than this
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
function condorValue(c: Omit<Condor, "credit">, spot: number, t: number, vol: number): number {
  const puts = bsPrice("put", spot, c.putShort, t, vol) - bsPrice("put", spot, c.putLong, t, vol);
  const calls = bsPrice("call", spot, c.callShort, t, vol) - bsPrice("call", spot, c.callLong, t, vol);
  return Math.max(0, puts) + Math.max(0, calls);
}

/** Pick strikes (by delta, or for an even-money payoff) and price the condor. */
export function buildCondor(
  spot: number,
  t: number,
  vol: number,
  rules: Pick<CondorRules, "shortDelta" | "width" | "slippage"> & { evenMoney?: boolean },
): Condor {
  const width = Math.max(STRIKE_STEP, Math.round(rules.width / STRIKE_STEP) * STRIKE_STEP);
  const price = (putShort: number, callShort: number): Condor => {
    const strikes = { putLong: putShort - width, putShort, callShort, callLong: callShort + width };
    // Selling two spreads, so slippage twice.
    return { ...strikes, credit: condorValue(strikes, spot, t, vol) - 2 * rules.slippage };
  };
  if (rules.evenMoney) {
    // Step the short strikes out from the money until the credit is closest to half the width.
    const target = width / 2;
    let best = price(Math.floor(spot / STRIKE_STEP) * STRIKE_STEP, Math.ceil(spot / STRIKE_STEP) * STRIKE_STEP);
    for (let d = STRIKE_STEP; d <= spot * 0.2; d += STRIKE_STEP) {
      const c = price(Math.floor((spot - d) / STRIKE_STEP) * STRIKE_STEP, Math.ceil((spot + d) / STRIKE_STEP) * STRIKE_STEP);
      if (Math.abs(c.credit - target) < Math.abs(best.credit - target)) best = c;
      if (c.credit < target) break; // credits only shrink from here
    }
    return best;
  }
  const putShort = Math.floor(strikeForDelta("put", spot, rules.shortDelta, t, vol) / STRIKE_STEP) * STRIKE_STEP;
  const callShort = Math.ceil(strikeForDelta("call", spot, rules.shortDelta, t, vol) / STRIKE_STEP) * STRIKE_STEP;
  return price(putShort, callShort);
}

/** Dollars per share owed at expiration. */
export function settlement(c: Omit<Condor, "credit">, spot: number): number {
  return (
    Math.min(c.putShort - c.putLong, Math.max(0, c.putShort - spot)) +
    Math.min(c.callLong - c.callShort, Math.max(0, spot - c.callShort))
  );
}

/** The most a condor can lose per share: its wider wing, less the credit. */
export const maxLossPerShare = (c: Condor) => Math.max(c.putShort - c.putLong, c.callLong - c.callShort) - c.credit;

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
export function sizeFor(
  rules: Pick<CondorRules, "sizing" | "contracts" | "maxDoublings"> & { levels?: number[] | null },
  streak: number,
): { contracts: number; streak: number } {
  if (rules.sizing === "fixed") return { contracts: rules.contracts, streak };
  if (rules.levels?.length) {
    // Past the last level: start over at the first.
    const s = streak >= rules.levels.length ? 0 : streak;
    return { contracts: rules.levels[s], streak: s };
  }
  if (rules.maxDoublings !== null && streak > rules.maxDoublings) return { contracts: rules.contracts, streak: 0 };
  return { contracts: rules.contracts * 2 ** streak, streak };
}

/** One condor in a plan: when it opened and closed, its strikes, and what it made per share. */
export interface PlannedTrade {
  opened: string;
  closed: string;
  spot: number;
  vix: number;
  condor: Condor;
  exit: CondorTrade["exit"];
  /** Per share at the close, before fees: credit less what was owed, or less the cost to buy it back early. */
  perShare: number;
}

/**
 * The strategy's trades, independent of position size: each day either nothing
 * happens, a condor opens, an open condor is marked at the close, or it closes.
 * Sizing never changes which trades happen (only how many contracts, or a stop
 * when the account can't cover one), so one plan serves every sizing rule.
 */
export type PlanEvent =
  | { kind: "idle"; date: string }
  | { kind: "open"; trade: PlannedTrade }
  | { kind: "mark"; date: string; kept: number }
  | { kind: "close"; date: string };

export interface TradePlan {
  start: string;
  events: PlanEvent[];
}

export function planTrades(
  bars: IndexBar[],
  rules: Pick<CondorRules, "dte" | "shortDelta" | "evenMoney" | "width" | "slippage" | "takeProfit" | "stopLoss"> & { ivScale?: number },
): TradePlan {
  const events: PlanEvent[] = [];
  const iv = (bar: IndexBar) => (bar.vix / 100) * (rules.ivScale ?? 1);
  if (rules.dte === 0) {
    // Same-day condors: open at the open (priced with the VIX known at the open,
    // i.e. yesterday's close) and settle at the close.
    for (let i = 1; i < bars.length; i++) {
      const bar = bars[i];
      const condor = buildCondor(bar.open, OPEN_TO_CLOSE, iv(bars[i - 1]), rules);
      if (condor.credit < MIN_CREDIT) {
        events.push({ kind: "idle", date: bar.date });
        continue;
      }
      const perShare = condor.credit - settlement(condor, bar.close);
      events.push({ kind: "open", trade: { opened: bar.date, closed: bar.date, spot: bar.open, vix: bars[i - 1].vix, condor, exit: "expired", perShare } });
      events.push({ kind: "close", date: bar.date });
    }
    return { start: bars[1]?.date ?? bars[0]?.date ?? "", events };
  }

  let i = 0;
  while (i < bars.length - 1) {
    const e = expiryIndex(bars, i, rules.dte);
    if (e === null) break;
    const condor = buildCondor(bars[i].close, (e - i) / YEAR, iv(bars[i]), rules);
    if (condor.credit < MIN_CREDIT) {
      i++;
      events.push({ kind: "idle", date: bars[i].date });
      continue;
    }
    const trade: PlannedTrade = { opened: bars[i].date, closed: bars[e].date, spot: bars[i].close, vix: bars[i].vix, condor, exit: "expired", perShare: 0 };
    events.push({ kind: "open", trade });
    // Mark the condor at each close until it's closed early or expires.
    let j = i + 1;
    for (; j <= e; j++) {
      const bar = bars[j];
      if (j === e) {
        trade.perShare = condor.credit - settlement(condor, bar.close);
        events.push({ kind: "close", date: bar.date });
        break;
      }
      const kept = condor.credit - (condorValue(condor, bar.close, (e - j) / YEAR, iv(bar)) + 2 * rules.slippage);
      const exit =
        rules.takeProfit !== null && kept >= rules.takeProfit * condor.credit
          ? "profit"
          : rules.stopLoss !== null && -kept >= rules.stopLoss * condor.credit
            ? "stop"
            : null;
      if (exit) {
        Object.assign(trade, { closed: bar.date, exit, perShare: kept });
        events.push({ kind: "close", date: bar.date });
        break;
      }
      events.push({ kind: "mark", date: bar.date, kept });
    }
    // The next condor opens at the close of the day this one ended.
    i = Math.min(j, e);
  }
  return { start: bars[0]?.date ?? "", events };
}

/** Run a plan with a sizing rule: contracts per trade, the equity curve, and the stats. */
export function sizePlan(plan: TradePlan, rules: CondorRules): CondorResult {
  const trades: CondorTrade[] = [];
  const curve: { date: string; equity: number }[] = rules.dte === 0 ? [] : [{ date: plan.start, equity: rules.startCash }];
  let equity = rules.startCash;
  let streak = 0;
  let bust: string | null = null;
  let open: Omit<CondorTrade, "pnl" | "equityAfter" | "closed" | "exit"> | null = null;
  let planned: PlannedTrade | null = null;
  const fees = (contracts: number) => 4 * rules.feePerLeg * contracts;

  for (const ev of plan.events) {
    if (ev.kind === "idle") {
      curve.push({ date: ev.date, equity });
    } else if (ev.kind === "open") {
      const next = sizeFor(rules, streak);
      streak = next.streak;
      const margin = maxLossPerShare(ev.trade.condor) * MULTIPLIER + fees(1);
      const affordable = Math.floor(equity / margin);
      if (affordable < 1) {
        bust = ev.trade.opened;
        curve.push({ date: ev.trade.opened, equity });
        break;
      }
      const contracts = Math.min(next.contracts, affordable);
      planned = ev.trade;
      open = { ...ev.trade.condor, opened: ev.trade.opened, spot: ev.trade.spot, vix: ev.trade.vix, contracts, streak, capped: contracts < next.contracts };
    } else if (ev.kind === "mark" && open) {
      curve.push({ date: ev.date, equity: equity + ev.kept * MULTIPLIER * open.contracts - fees(open.contracts) });
    } else if (ev.kind === "close" && open && planned) {
      // Closing early means buying the condor back: a second round of fees.
      const pnl = planned.perShare * MULTIPLIER * open.contracts - fees(open.contracts) * (planned.exit === "expired" ? 1 : 2);
      equity += pnl;
      trades.push({ ...open, closed: planned.closed, exit: planned.exit, pnl, equityAfter: equity });
      streak = pnl < 0 ? streak + 1 : 0;
      curve.push({ date: ev.date, equity });
      open = null;
      planned = null;
    }
  }
  return { rules, curve, trades, stats: statsFor(rules, curve, trades, bust) };
}

export function simulateCondors(bars: IndexBar[], rules: CondorRules): CondorResult {
  return sizePlan(planTrades(bars, rules), rules);
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
export function doublingLadder(condor: Condor, rules: Pick<CondorRules, "contracts" | "startCash" | "feePerLeg"> & { levels?: number[] | null }) {
  const maxLoss = maxLossPerShare(condor) * MULTIPLIER + 4 * rules.feePerLeg;
  const steps = rules.levels?.length ? rules.levels.length - 1 : 12;
  const rows: { losses: number; contracts: number; atRisk: number; lostSoFar: number; affordable: boolean }[] = [];
  let lost = 0;
  for (let k = 0; k <= steps; k++) {
    const contracts = rules.levels?.length ? rules.levels[k] : rules.contracts * 2 ** k;
    const atRisk = contracts * maxLoss;
    rows.push({ losses: k, contracts, atRisk, lostSoFar: lost, affordable: atRisk + lost <= rules.startCash });
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
  return { date: last.date, spot: last.close, vix: last.vix, condor: buildCondor(last.close, t, (last.vix / 100) * (rules.ivScale ?? 1), rules) };
}

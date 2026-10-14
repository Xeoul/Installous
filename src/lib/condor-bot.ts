// A live paper-trading bot for SPY iron condors, run the way the strategy is
// traded by hand: in the last minutes of each trading day, check whether the
// condor expiring today is a win or a loss, set the next size from the level
// ladder (a loss moves up a level, any win goes back to level 1), and open the
// next condor expiring the next trading day. Each condor is held to expiration
// and settled at SPY's official close. It skips days when a big release (Fed
// decision, CPI, jobs report) lands while the condor would be open.
//
// Fills use real (possibly delayed) Yahoo Finance quotes. The condor workflow
// runs stepBot a few times in the last half hour of the session and after the
// close; the state is saved on the fund-data branch.
import { fmtWeekday, nyDate } from "./dates";
import { newsOn, NEWS_CALENDAR_ENDS } from "./news-days";
import { maxLossPerShare, normCdf, settlement } from "./options";

export interface BotRules {
  ticker: string;
  /** Trading days until expiration: 0 = same day, 1 = the next trading day. */
  expiryDays: number;
  /** Short strikes placed so the credit is about half the wing width (win ≈ loss). */
  evenMoney: boolean;
  /** Target delta of the short strikes when not evenMoney. */
  shortDelta: number;
  /** Dollars between each short strike and its long wing. */
  width: number;
  /** Contracts at each level; a loss on the last level starts over at the first. */
  levels: number[];
  startCash: number;
  feePerLeg: number;
  /** Given up per two-leg spread vs the mid price, in dollars per share. */
  slippage: number;
  /** New York time window for opening the next condor, minutes after midnight. */
  openFrom: number;
  openUntil: number;
  /** Skip the day if the condor pays less than this per share. */
  minCredit: number;
  /** Don't hold a condor through a Fed decision, CPI or jobs report. */
  skipNews: boolean;
  /** Symbol for the underlying's price and closes when it differs from the options symbol (^GSPC for ^SPX). */
  quoteTicker?: string;
  /** Distance between listed strikes (SPX: 5, SPY: 1). */
  strikeStep?: number;
  /** Display name ("SPX"). */
  name?: string;
}

/** The symbol to stream and settle the bot's underlying from. */
export const botQuoteTicker = (r: Pick<BotRules, "ticker" | "quoteTicker">) => r.quoteTicker ?? r.ticker;
/** The underlying's display name. */
export const botName = (r: Pick<BotRules, "ticker" | "name">) => r.name ?? r.ticker.replace(/^\^/, "");

export const BOT_RULES: BotRules = {
  // S&P 500 index options (cash-settled at the 4pm close), priced off the index itself.
  ticker: "^SPX",
  quoteTicker: "^GSPC",
  name: "SPX",
  strikeStep: 5,
  expiryDays: 1,
  evenMoney: true,
  shortDelta: 0.1,
  // 5-point wings with ~$2.50 credit: about +$250 on a win, -$250 on a full loss, per condor.
  width: 5,
  levels: [1, 3, 6],
  startCash: 25_000,
  feePerLeg: 0.04,
  slippage: 0.01,
  openFrom: 15 * 60 + 25,
  openUntil: 15 * 60 + 58,
  minCredit: 1.5,
  skipNews: true,
};

export interface ChainLeg {
  strike: number;
  bid: number;
  ask: number;
}

export interface Chain {
  /** Expiration date (YYYY-MM-DD). */
  expiry: string;
  spot: number;
  /** Whether the regular session is open right now (false after an early close on a half day). */
  marketOpen: boolean;
  puts: ChainLeg[];
  calls: ChainLeg[];
}

export interface BotTrade {
  /** Day the trade opened. */
  date: string;
  /** Expiration (and settlement) day. */
  expiry: string;
  openedAt: string;
  spot: number;
  putLong: number;
  putShort: number;
  callShort: number;
  callLong: number;
  /** Credit per share after slippage. */
  credit: number;
  contracts: number;
  /** Level index (0 = level 1) this trade was sized at. */
  level: number;
  /** Losses in a row before this trade (kept for older trades' display). */
  streak?: number;
  capped: boolean;
  /** Set when the next trade was sized from this one's result shortly before its close. */
  rolled?: { at: string; spot: number; pnl: number };
  /** Filled in when the trade settles. */
  close?: number;
  pnl?: number;
  equityAfter?: number;
}

export interface BotState {
  version: 3;
  startDate: string;
  rules: BotRules;
  equity: number;
  /** Level index the next trade will use (0 = level 1). */
  level: number;
  /** Losses in a row. */
  streak: number;
  bust: string | null;
  /** The newest open condor. */
  open: BotTrade | null;
  /** The previous condor, expiring today, after the next one was opened (until its official close). */
  settling: BotTrade | null;
  /** Settled trades, newest first. */
  trades: BotTrade[];
  history: { date: string; equity: number }[];
  /** Why the bot didn't trade on its last attempt, if it didn't. */
  note: string | null;
  updatedAt: string;
}

export interface BotInput {
  now: Date;
  /** The chain for the expiration the rules trade, or null (weekend, holiday, outage). */
  chain: Chain | null;
  /** SPY's official daily closes by date. */
  closes: Record<string, number>;
}

const MULTIPLIER = 100;
const CLOSE_FINAL = 16 * 60 + 5; // by 4:05pm ET the day's close is in

export { nyDate };
export function nyMinutes(d: Date): number {
  const [h, m] = d.toLocaleTimeString("en-GB", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).split(":");
  return Number(h) * 60 + Number(m);
}

const fees = (rules: BotRules, contracts: number) => 4 * rules.feePerLeg * contracts;
const mid = (l: ChainLeg) => (l.bid + l.ask) / 2;

/**
 * The market's expected move to the close, as a standard deviation in
 * dollars-per-dollar (sigma times root-t), read from the at-the-money
 * straddle: an ATM straddle is worth about 0.8 standard deviations. More
 * reliable than per-option implied volatilities, which go stale.
 */
export function impliedMove(chain: Chain): number | null {
  const quoted = (legs: ChainLeg[]) => new Map(legs.filter((l) => l.bid > 0 && l.ask >= l.bid).map((l) => [l.strike, l]));
  const puts = quoted(chain.puts);
  const calls = quoted(chain.calls);
  const atm = [...calls.keys()].filter((k) => puts.has(k)).sort((a, b) => Math.abs(a - chain.spot) - Math.abs(b - chain.spot))[0];
  if (atm === undefined) return null;
  const straddle = mid(calls.get(atm)!) + mid(puts.get(atm)!);
  return straddle / (Math.sqrt(2 / Math.PI) * chain.spot);
}

/** Delta of a strike for a given expected move (flat volatility, rates ignored for a same-day option). */
function deltaAt(kind: "put" | "call", spot: number, strike: number, sd: number): number {
  const d1 = Math.log(spot / strike) / sd + sd / 2;
  return kind === "call" ? normCdf(d1) : 1 - normCdf(d1);
}

/** The short strike nearest the target delta without going closer to the money, and its long wing. */
function pickSide(kind: "put" | "call", legs: ChainLeg[], spot: number, sd: number, rules: BotRules) {
  const quoted = legs.filter((l) => l.ask > 0 && l.bid >= 0 && l.ask >= l.bid);
  const short = quoted
    .filter((l) => (kind === "put" ? l.strike < spot : l.strike > spot) && l.bid > 0 && deltaAt(kind, spot, l.strike, sd) <= rules.shortDelta)
    // Closest to the money among those at or under the target delta.
    .sort((a, b) => (kind === "put" ? b.strike - a.strike : a.strike - b.strike))[0];
  if (!short) return null;
  const wingStrike = kind === "put" ? short.strike - rules.width : short.strike + rules.width;
  // The exact wing, or the nearest quoted strike beyond it.
  const long = quoted
    .filter((l) => (kind === "put" ? l.strike <= wingStrike : l.strike >= wingStrike))
    .sort((a, b) => Math.abs(a.strike - wingStrike) - Math.abs(b.strike - wingStrike))[0];
  if (!long) return null;
  return { short, long };
}

/** Quoted legs by strike. */
const byStrike = (legs: ChainLeg[]) => new Map(legs.filter((l) => l.ask > 0 && l.bid >= 0 && l.ask >= l.bid).map((l) => [l.strike, l]));

/**
 * Step the short strikes out from the money until the credit is closest to
 * half the wing width, so a win pays about what a full loss costs.
 */
function evenMoneyCondor(chain: Chain, rules: BotRules) {
  const puts = byStrike(chain.puts);
  const calls = byStrike(chain.calls);
  const target = rules.width / 2;
  const step = rules.strikeStep ?? 1;
  const atOrBelow = Math.floor(chain.spot / step) * step;
  const atOrAbove = Math.ceil(chain.spot / step) * step;
  let best: { put: { short: ChainLeg; long: ChainLeg }; call: { short: ChainLeg; long: ChainLeg }; credit: number } | null = null;
  for (let d = 0; d <= 40; d++) {
    const ps = puts.get(atOrBelow - d * step);
    const cs = calls.get(atOrAbove + d * step);
    const pl = ps && puts.get(ps.strike - rules.width);
    const cl = cs && calls.get(cs.strike + rules.width);
    if (!ps || !cs || !pl || !cl || ps.bid <= 0 || cs.bid <= 0) continue;
    const credit = mid(ps) - mid(pl) + mid(cs) - mid(cl) - 2 * rules.slippage;
    if (credit >= rules.width) continue; // impossible: stale or crossed quotes
    if (!best || Math.abs(credit - target) < Math.abs(best.credit - target)) best = { put: { short: ps, long: pl }, call: { short: cs, long: cl }, credit };
    if (credit < target) break;
  }
  return best;
}

/** Choose the condor from the chain and price it at the mids, less slippage. */
export function condorFromChain(chain: Chain, rules: BotRules) {
  let put, call;
  if (rules.evenMoney) {
    const best = evenMoneyCondor(chain, rules);
    if (!best) return null;
    ({ put, call } = best);
  } else {
    const sd = impliedMove(chain);
    if (!sd) return null;
    put = pickSide("put", chain.puts, chain.spot, sd, rules);
    call = pickSide("call", chain.calls, chain.spot, sd, rules);
  }
  if (!put || !call) return null;
  const credit = mid(put.short) - mid(put.long) + mid(call.short) - mid(call.long) - 2 * rules.slippage;
  // A condor can't pay more than its widest wing; quotes saying so are stale.
  if (credit >= Math.max(put.short.strike - put.long.strike, call.long.strike - call.short.strike)) return null;
  return {
    putLong: put.long.strike,
    putShort: put.short.strike,
    callShort: call.short.strike,
    callLong: call.long.strike,
    credit: Math.round(credit * 10000) / 10000,
  };
}

export function newBotState(now: Date, rules: BotRules = BOT_RULES): BotState {
  return {
    version: 3,
    startDate: nyDate(now),
    rules,
    equity: rules.startCash,
    level: 0,
    streak: 0,
    bust: null,
    open: null,
    settling: null,
    trades: [],
    history: [{ date: nyDate(now), equity: rules.startCash }],
    note: null,
    updatedAt: now.toISOString(),
  };
}

/** The level after a result: any win goes back to level 1, a loss moves up (past the top, start over). */
export const nextLevel = (level: number, pnl: number, levels: number[]) => (pnl >= 0 || level + 1 >= levels.length ? 0 : level + 1);

/** P/L of a condor settling at `price`, after fees. */
export function pnlAt(t: Pick<BotTrade, "putLong" | "putShort" | "callShort" | "callLong" | "credit" | "contracts">, price: number, feePerLeg: number) {
  return Math.round(((t.credit - settlement(t, price)) * MULTIPLIER * t.contracts - fees({ feePerLeg } as BotRules, t.contracts)) * 100) / 100;
}


/** Bring a saved state from an earlier version onto the current rules. */
function upgrade(state: BotState): BotState {
  const v = state.version as number;
  if (v === 3) return state;
  const legacy = state as unknown as { open?: BotTrade | null; streak?: number };
  return {
    ...state,
    version: 3,
    rules: BOT_RULES,
    level: 0,
    streak: legacy.streak ?? 0,
    open: legacy.open ? { ...legacy.open, expiry: legacy.open.expiry ?? legacy.open.date, level: 0 } : null,
    settling: null,
  };
}

/** Advance the bot: settle at the official close, then (late in the session) roll into the next condor. */
export function stepBot(prev: BotState | null, input: BotInput): { state: BotState; events: string[] } {
  const state = upgrade(prev ? structuredClone(prev) : newBotState(input.now));
  const rules = state.rules;
  const events: string[] = [];
  const today = nyDate(input.now);
  const minutes = nyMinutes(input.now);

  // 1. Settle condors at the official close on their expiration day. (During
  // that session Yahoo's daily "close" is just the latest price, so wait for 4:05.)
  for (const slot of ["settling", "open"] as const) {
    const t = state[slot];
    const close = t ? input.closes[t.expiry] : undefined;
    if (!t || close === undefined || !(t.expiry < today || (t.expiry === today && minutes >= CLOSE_FINAL))) continue;
    const pnl = pnlAt(t, close, rules.feePerLeg);
    state.equity = Math.round((state.equity + pnl) * 100) / 100;
    // A rolled trade already set the next level from its result near the close.
    if (!t.rolled) {
      state.level = nextLevel(state.level, pnl, rules.levels);
      state.streak = pnl < 0 ? state.streak + 1 : 0;
    }
    state.trades.unshift({ ...t, close, pnl, equityAfter: state.equity });
    state[slot] = null;
    const last = state.history.at(-1);
    if (last?.date === t.expiry) last.equity = state.equity;
    else state.history.push({ date: t.expiry, equity: state.equity });
    events.push(`Settled ${t.expiry}: SPY closed ${close}, ${pnl >= 0 ? "kept" : "lost"} $${Math.abs(pnl).toFixed(2)} on ${t.contracts}×`);
  }

  // 2. In the last minutes of the session, roll into the next condor.
  const inWindow = minutes >= rules.openFrom && minutes <= rules.openUntil;
  // One condor a day: never open another once today's is on the books,
  // whether it's still open, settling or already settled.
  const openedToday = [state.open, state.settling, state.trades[0]].some((t) => t?.date === today);
  const chain = input.chain;
  if (inWindow && !openedToday && !state.bust && chain?.marketOpen) {
    // The expiring condor's expected result, for sizing: from this roll, or
    // from an earlier step today that rolled it but didn't open (a skip).
    let projected = state.settling?.rolled && state.settling.expiry === today ? state.settling.rolled.pnl : 0;
    // An older condor still waiting on its close (a missing quote) holds the
    // settling slot; keep today's open until it clears rather than drop it.
    if (state.open && state.open.expiry === today && !state.settling) {
      // Today's condor is all but settled: size the next one from where SPY is now.
      projected = pnlAt(state.open, chain.spot, rules.feePerLeg);
      state.level = nextLevel(state.level, projected, rules.levels);
      state.streak = projected < 0 ? state.streak + 1 : 0;
      state.settling = { ...state.open, rolled: { at: input.now.toISOString(), spot: chain.spot, pnl: projected } };
      state.open = null;
      events.push(`Rolled ${today}: SPY ${chain.spot}, projected ${projected >= 0 ? "+" : "-"}$${Math.abs(projected).toFixed(0)} → level ${state.level + 1}`);
    }

    const news = rules.skipNews ? newsOn(chain.expiry) : [];
    const rightExpiry = rules.expiryDays === 0 ? chain.expiry === today : chain.expiry > today;
    if (state.open) {
      state.note = null; // still holding an earlier condor (it expires later), so wait
    } else if (!rightExpiry) {
      state.note = rules.expiryDays === 0 ? "No same-day options to trade." : "No next-day options to trade.";
    } else if (news.length) {
      state.note = `Skipped: ${news.join(" and ")} on ${fmtWeekday(chain.expiry)}, while the condor would be open.`;
      events.push(state.note);
    } else {
      const condor = condorFromChain(chain, rules);
      if (!condor) {
        state.note = "Couldn't find quoted strikes for the condor.";
      } else if (condor.credit < rules.minCredit) {
        state.note = `Skipped: the condor paid only $${(condor.credit * MULTIPLIER).toFixed(0)} (minimum $${(rules.minCredit * MULTIPLIER).toFixed(0)}).`;
        events.push(state.note);
      } else {
        const wanted = rules.levels[state.level] ?? rules.levels[0];
        const margin = maxLossPerShare(condor) * MULTIPLIER + fees(rules, 1);
        // Cash after today's condor settles, roughly.
        const affordable = margin > 0 ? Math.floor((state.equity + projected) / margin) : 0;
        if (affordable < 1) {
          state.bust = today;
          state.note = "Bust: the account can't cover one more condor.";
          events.push(state.note);
        } else {
          const contracts = Math.min(wanted, affordable);
          state.open = {
            date: today,
            expiry: chain.expiry,
            openedAt: input.now.toISOString(),
            spot: chain.spot,
            ...condor,
            contracts,
            level: state.level,
            streak: state.streak,
            capped: contracts < wanted,
          };
          state.note = null;
          events.push(
            `Opened ${today} (expires ${chain.expiry}) at level ${state.level + 1}: ${condor.putLong}/${condor.putShort}p ${condor.callShort}/${condor.callLong}c for $${(condor.credit * MULTIPLIER).toFixed(0)} × ${contracts}`,
          );
        }
      }
    }
  } else if (inWindow && !openedToday && chain && !chain.marketOpen) {
    state.note = "The market isn't open.";
  }

  if (today > NEWS_CALENDAR_ENDS && rules.skipNews) state.note = `${state.note ?? ""} The news calendar ends ${NEWS_CALENDAR_ENDS}; add next year's dates.`.trim();
  state.updatedAt = input.now.toISOString();
  return { state, events };
}

// A live paper-trading bot: every trading day it sells one same-day SPY iron
// condor at real quoted prices, sizes it by the martingale (double after a
// loss, back to the base size after a win), and settles it at SPY's official
// close. The scheduled workflow calls stepBot every 30 minutes during market
// hours; the state is saved on the fund-data branch like the AI Fund's.
import { maxLossPerShare, normCdf, settlement, sizeFor } from "./options";

export interface BotRules {
  ticker: string;
  shortDelta: number;
  /** Dollars between each short strike and its long wing. */
  width: number;
  contracts: number;
  startCash: number;
  maxDoublings: number | null;
  feePerLeg: number;
  /** Given up per two-leg spread vs the mid price, in dollars per share. */
  slippage: number;
  /** New York time window for opening the day's trade, minutes after midnight. */
  openFrom: number;
  openUntil: number;
  /** Skip the day if the condor pays less than this per share. */
  minCredit: number;
}

export const BOT_RULES: BotRules = {
  ticker: "SPY",
  shortDelta: 0.1,
  width: 2,
  contracts: 1,
  startCash: 25_000,
  maxDoublings: null,
  feePerLeg: 0.04,
  slippage: 0.01,
  openFrom: 9 * 60 + 45,
  openUntil: 15 * 60 + 30,
  minCredit: 0.05,
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
  puts: ChainLeg[];
  calls: ChainLeg[];
}

export interface BotTrade {
  date: string;
  openedAt: string;
  spot: number;
  putLong: number;
  putShort: number;
  callShort: number;
  callLong: number;
  /** Credit per share after slippage. */
  credit: number;
  contracts: number;
  streak: number;
  capped: boolean;
  /** Filled in when the trade settles. */
  close?: number;
  pnl?: number;
  equityAfter?: number;
}

export interface BotState {
  version: 1;
  startDate: string;
  rules: BotRules;
  equity: number;
  streak: number;
  bust: string | null;
  open: BotTrade | null;
  /** Settled trades, newest first. */
  trades: BotTrade[];
  history: { date: string; equity: number }[];
  /** Why the bot didn't trade on its last attempt, if it didn't. */
  note: string | null;
  updatedAt: string;
}

export interface BotInput {
  now: Date;
  /** Today's same-day chain, or null when there isn't one (weekend, holiday, outage). */
  chain: Chain | null;
  /** SPY's official daily closes by date. */
  closes: Record<string, number>;
}

const MULTIPLIER = 100;
const CLOSE_FINAL = 16 * 60 + 15; // by 4:15pm ET the day's close is final

export const nyDate = (d: Date) => d.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
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

/** Choose today's condor from the chain and price it at the mids, less slippage. */
export function condorFromChain(chain: Chain, rules: BotRules) {
  const sd = impliedMove(chain);
  if (!sd) return null;
  const put = pickSide("put", chain.puts, chain.spot, sd, rules);
  const call = pickSide("call", chain.calls, chain.spot, sd, rules);
  if (!put || !call) return null;
  const credit = mid(put.short) - mid(put.long) + mid(call.short) - mid(call.long) - 2 * rules.slippage;
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
    version: 1,
    startDate: nyDate(now),
    rules,
    equity: rules.startCash,
    streak: 0,
    bust: null,
    open: null,
    trades: [],
    history: [{ date: nyDate(now), equity: rules.startCash }],
    note: null,
    updatedAt: now.toISOString(),
  };
}

/** Advance the bot: settle a finished trade, then open today's if it's time. */
export function stepBot(prev: BotState | null, input: BotInput): { state: BotState; events: string[] } {
  const state: BotState = prev ? structuredClone(prev) : newBotState(input.now);
  const rules = state.rules;
  const events: string[] = [];
  const today = nyDate(input.now);
  const minutes = nyMinutes(input.now);

  // 1. Settle at the official close of the trade's day.
  const open = state.open;
  const close = open ? input.closes[open.date] : undefined;
  if (open && close !== undefined && (open.date < today || minutes >= CLOSE_FINAL)) {
    const owed = settlement(open, close);
    const pnl = Math.round(((open.credit - owed) * MULTIPLIER * open.contracts - fees(rules, open.contracts)) * 100) / 100;
    state.equity = Math.round((state.equity + pnl) * 100) / 100;
    state.streak = pnl < 0 ? state.streak + 1 : 0;
    state.trades.unshift({ ...open, close, pnl, equityAfter: state.equity });
    state.open = null;
    const last = state.history.at(-1);
    if (last?.date === open.date) last.equity = state.equity;
    else state.history.push({ date: open.date, equity: state.equity });
    events.push(`Settled ${open.date}: SPY closed ${close}, ${pnl >= 0 ? "kept" : "lost"} $${Math.abs(pnl).toFixed(2)} on ${open.contracts}×`);
  }

  // 2. Open today's trade.
  const tradedToday = state.open?.date === today || state.trades[0]?.date === today;
  const inWindow = minutes >= rules.openFrom && minutes <= rules.openUntil;
  if (!state.open && !state.bust && !tradedToday && inWindow) {
    const chain = input.chain;
    if (!chain || chain.expiry !== today) {
      state.note = "No same-day options to trade.";
    } else {
      const condor = condorFromChain(chain, rules);
      if (!condor) {
        state.note = "Couldn't find quoted strikes for the condor.";
      } else if (condor.credit < rules.minCredit) {
        state.note = `Skipped: the condor paid only $${(condor.credit * MULTIPLIER).toFixed(0)}.`;
      } else {
        const sizing = sizeFor({ ...rules, sizing: "martingale" }, state.streak);
        state.streak = sizing.streak;
        const margin = maxLossPerShare(condor) * MULTIPLIER + fees(rules, 1);
        const affordable = Math.floor(state.equity / margin);
        if (affordable < 1) {
          state.bust = today;
          state.note = "Bust: the account can't cover one more condor.";
          events.push(state.note);
        } else {
          const contracts = Math.min(sizing.contracts, affordable);
          state.open = {
            date: today,
            openedAt: input.now.toISOString(),
            spot: chain.spot,
            ...condor,
            contracts,
            streak: state.streak,
            capped: contracts < sizing.contracts,
          };
          state.note = null;
          events.push(
            `Opened ${today}: ${condor.putLong}/${condor.putShort}p ${condor.callShort}/${condor.callLong}c for $${(condor.credit * MULTIPLIER).toFixed(0)} × ${contracts}`,
          );
        }
      }
    }
  }

  state.updatedAt = input.now.toISOString();
  return { state, events };
}

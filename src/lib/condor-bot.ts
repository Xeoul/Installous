// A live paper-trading bot: it sells a SPY iron condor at real quoted prices,
// holds it to expiration (the next trading day by default), settles it at
// SPY's official close, and sizes each trade by the martingale (double after
// a loss, back to the base size after a win). One trade at a time, so each
// size follows the last result. The scheduled workflow calls stepBot every
// 30 minutes during market hours; the state is saved on the fund-data branch
// like the AI Fund's.
import { maxLossPerShare, normCdf, settlement, sizeFor } from "./options";

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
  expiryDays: 1,
  evenMoney: true,
  shortDelta: 0.1,
  // $4 wings with ~$2 credit: about +$200 on a win, -$200 on a full loss, per condor.
  width: 4,
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
  streak: number;
  capped: boolean;
  /** Filled in when the trade settles. */
  close?: number;
  pnl?: number;
  equityAfter?: number;
}

export interface BotState {
  version: 2;
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
  /** The chain for the expiration the rules trade, or null (weekend, holiday, outage). */
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
  let best: { put: { short: ChainLeg; long: ChainLeg }; call: { short: ChainLeg; long: ChainLeg }; credit: number } | null = null;
  for (let d = 0; d <= 40; d++) {
    const ps = puts.get(Math.floor(chain.spot) - d);
    const cs = calls.get(Math.ceil(chain.spot) + d);
    const pl = ps && puts.get(ps.strike - rules.width);
    const cl = cs && calls.get(cs.strike + rules.width);
    if (!ps || !cs || !pl || !cl || ps.bid <= 0 || cs.bid <= 0) continue;
    const credit = mid(ps) - mid(pl) + mid(cs) - mid(cl) - 2 * rules.slippage;
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
    version: 2,
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
  // Version 1 traded same-day 10-delta condors; carry the account over to the current rules.
  if ((state.version as number) !== 2) {
    state.version = 2;
    state.rules = BOT_RULES;
  }
  const rules = state.rules;
  const events: string[] = [];
  const today = nyDate(input.now);
  const minutes = nyMinutes(input.now);

  // 1. Settle at the official close on the expiration day. (During that
  // session Yahoo's daily "close" is just the latest price, so wait for 4:15.)
  const open = state.open;
  const expiry = open ? (open.expiry ?? open.date) : "";
  const close = open ? input.closes[expiry] : undefined;
  if (open && close !== undefined && (expiry < today || (expiry === today && minutes >= CLOSE_FINAL))) {
    const owed = settlement(open, close);
    const pnl = Math.round(((open.credit - owed) * MULTIPLIER * open.contracts - fees(rules, open.contracts)) * 100) / 100;
    state.equity = Math.round((state.equity + pnl) * 100) / 100;
    state.streak = pnl < 0 ? state.streak + 1 : 0;
    state.trades.unshift({ ...open, expiry, close, pnl, equityAfter: state.equity });
    state.open = null;
    const last = state.history.at(-1);
    if (last?.date === expiry) last.equity = state.equity;
    else state.history.push({ date: expiry, equity: state.equity });
    events.push(`Settled ${expiry}: SPY closed ${close}, ${pnl >= 0 ? "kept" : "lost"} $${Math.abs(pnl).toFixed(2)} on ${open.contracts}×`);
  }

  // 2. Open the next trade (one at a time, so a trade that settles today means the next opens tomorrow).
  const tradedToday = state.open?.date === today || state.trades[0]?.date === today || state.trades[0]?.expiry === today;
  const inWindow = minutes >= rules.openFrom && minutes <= rules.openUntil;
  if (!state.open && !state.bust && !tradedToday && inWindow) {
    const chain = input.chain;
    const rightExpiry = chain && (rules.expiryDays === 0 ? chain.expiry === today : chain.expiry > today);
    if (!chain || !rightExpiry) {
      state.note = rules.expiryDays === 0 ? "No same-day options to trade." : "No next-day options to trade.";
    } else if (!chain.marketOpen) {
      state.note = "The market isn't open.";
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
            expiry: chain.expiry,
            openedAt: input.now.toISOString(),
            spot: chain.spot,
            ...condor,
            contracts,
            streak: state.streak,
            capped: contracts < sizing.contracts,
          };
          state.note = null;
          events.push(
            `Opened ${today} (expires ${chain.expiry}): ${condor.putLong}/${condor.putShort}p ${condor.callShort}/${condor.callLong}c for $${(condor.credit * MULTIPLIER).toFixed(0)} × ${contracts}`,
          );
        }
      }
    }
  }

  state.updatedAt = input.now.toISOString();
  return { state, events };
}

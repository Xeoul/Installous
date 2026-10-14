// Live view of the condor bot's positions, the way a brokerage app shows an
// open options trade: each leg marked at the current SPY price, the
// position's profit or loss if closed now, and where the next order stands.
// Quotes for the legs aren't streamed, so they're estimated with
// Black-Scholes at the volatility implied by the credit the bot collected.
import type { BotState, BotTrade } from "./condor-bot";
import { nyDate } from "./dates";
import { bsPrice, settlement } from "./options";

const HOUR = 3_600_000;
const YEAR_MS = 365 * 24 * HOUR;

/** 4:00pm New York time on `date` (YYYY-MM-DD), whichever UTC offset is in force. */
export function nyClose(date: string): Date {
  for (const off of ["-04:00", "-05:00"]) {
    const d = new Date(`${date}T16:00:00${off}`);
    if (d.toLocaleTimeString("en-GB", { timeZone: "America/New_York", hour: "2-digit", hourCycle: "h23" }) === "16") return d;
  }
  return new Date(`${date}T20:00:00Z`);
}

/** Years from `now` to the condor's 4:00pm expiry (zero once it has passed). */
export const yearsLeft = (t: Pick<BotTrade, "expiry">, now: Date) => Math.max(0, (nyClose(t.expiry).getTime() - now.getTime()) / YEAR_MS);

type Legs = Pick<BotTrade, "putLong" | "putShort" | "callShort" | "callLong">;

/** What it costs to buy the condor back, per share, at `spot` with `years` left. */
export function condorValue(t: Legs, spot: number, years: number, vol: number): number {
  if (years <= 0) return settlement(t, spot);
  return (
    bsPrice("put", spot, t.putShort, years, vol) -
    bsPrice("put", spot, t.putLong, years, vol) +
    bsPrice("call", spot, t.callShort, years, vol) -
    bsPrice("call", spot, t.callLong, years, vol)
  );
}

/**
 * The volatility at which the condor was worth what the bot was paid for it
 * when it opened (its credit plus the slippage given up on the fill).
 */
export function impliedVol(t: BotTrade, slippage: number): number {
  const target = t.credit + 2 * slippage;
  const years = Math.max(yearsLeft(t, new Date(t.openedAt)), 1 / (365 * 24));
  let lo = 0.01;
  let hi = 3;
  // The condor's value rises with volatility over this range, so bisect.
  if (condorValue(t, t.spot, years, hi) < target) return hi;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (condorValue(t, t.spot, years, mid) < target) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export interface LegMark {
  action: "Sell" | "Buy";
  kind: "Put" | "Call";
  strike: number;
  /** Estimated price per share now. */
  price: number;
}

export interface Mark {
  /** Profit or loss if the condor were bought back now, after fees. */
  pnl: number;
  /** That profit as a percent of the most the condor can make (its credit). */
  pctOfMax: number;
  /** Profit or loss if SPY settled here at expiry. */
  atExpiry: number;
  legs: LegMark[];
}

/** Mark an open condor at `spot`, `now`. */
export function markCondor(t: BotTrade, spot: number, now: Date, vol: number, feePerLeg: number): Mark {
  const years = yearsLeft(t, now);
  const price = (kind: "put" | "call", strike: number) => bsPrice(kind, spot, strike, years, vol);
  const value = condorValue(t, spot, years, vol);
  const fees = 4 * feePerLeg * t.contracts;
  const pnl = (t.credit - value) * 100 * t.contracts - fees;
  return {
    pnl,
    pctOfMax: (pnl / (t.credit * 100 * t.contracts)) * 100,
    atExpiry: (t.credit - settlement(t, spot)) * 100 * t.contracts - fees,
    legs: [
      { action: "Buy", kind: "Put", strike: t.putLong, price: price("put", t.putLong) },
      { action: "Sell", kind: "Put", strike: t.putShort, price: price("put", t.putShort) },
      { action: "Sell", kind: "Call", strike: t.callShort, price: price("call", t.callShort) },
      { action: "Buy", kind: "Call", strike: t.callLong, price: price("call", t.callLong) },
    ],
  };
}

/** Profit or loss at expiry across a range of SPY prices, for the payoff chart. */
export function payoff(t: BotTrade, feePerLeg: number, points = 81): { spot: number; pnl: number }[] {
  const lo = t.putLong - (t.putShort - t.putLong);
  const hi = t.callLong + (t.callLong - t.callShort);
  const fees = 4 * feePerLeg * t.contracts;
  return Array.from({ length: points }, (_, i) => {
    const spot = lo + ((hi - lo) * i) / (points - 1);
    return { spot, pnl: (t.credit - settlement(t, spot)) * 100 * t.contracts - fees };
  });
}

export type OrderPhase =
  | { phase: "waiting"; at: Date } // before today's order window
  | { phase: "working" } // in the window, order not confirmed yet
  | { phase: "filled"; trade: BotTrade } // today's condor is on the books
  | { phase: "skipped"; note: string } // today's trade was skipped
  | { phase: "closed" }; // weekend, after the window, or the bot is bust

const minutesNY = (d: Date) => {
  const [h, m] = d.toLocaleTimeString("en-GB", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).split(":");
  return Number(h) * 60 + Number(m);
};
const weekdayNY = (d: Date) => d.toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "short" });

/** Where today's order stands. */
export function orderPhase(bot: BotState, now: Date): OrderPhase {
  const today = nyDate(now);
  const opened = [bot.open, bot.settling, bot.trades[0]].find((t) => t?.date === today);
  if (opened) return { phase: "filled", trade: opened };
  if (bot.bust || ["Sat", "Sun"].includes(weekdayNY(now))) return { phase: "closed" };
  if (bot.note?.startsWith("Skipped") && nyDate(new Date(bot.updatedAt)) === today) return { phase: "skipped", note: bot.note };
  const m = minutesNY(now);
  // The bot steps at 3:27pm and checks again until 3:58pm.
  if (m < bot.rules.openFrom) return { phase: "waiting", at: new Date(nyClose(today).getTime() - (16 * 60 - 15 * 60 - 27) * 60_000) };
  if (m <= bot.rules.openUntil + 10) return { phase: "working" };
  return { phase: "closed" };
}

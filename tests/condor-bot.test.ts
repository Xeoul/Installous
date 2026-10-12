import { describe, expect, it } from "vitest";
import { BOT_RULES, condorFromChain, impliedMove, newBotState, nyMinutes, stepBot, type BotState, type Chain } from "@/lib/condor-bot";
import { bsPrice } from "@/lib/options";

// October is EDT (UTC-4): 14:00Z is 10:00am in New York.
const at = (date: string, time: string) => new Date(`${date}T${time}:00-04:00`);

/** A same-day chain around `spot`, priced by Black-Scholes at 15% vol, a cent either side of fair. */
function chain(expiry: string, spot = 500): Chain {
  const t = 4 / 6.5 / 252;
  const strikes = Array.from({ length: 41 }, (_, i) => spot - 20 + i);
  const leg = (kind: "put" | "call", strike: number) => {
    const fair = bsPrice(kind, spot, strike, t, 0.15);
    return { strike, bid: Math.max(0, fair - 0.01), ask: fair + 0.01 };
  };
  return { expiry, spot, puts: strikes.map((k) => leg("put", k)), calls: strikes.map((k) => leg("call", k)) };
}

const start = (equity = BOT_RULES.startCash): BotState => ({ ...newBotState(at("2026-10-12", "09:00")), equity });

describe("condorFromChain", () => {
  it("reads the expected move from the at-the-money straddle", () => {
    const sd = 0.15 * Math.sqrt(4 / 6.5 / 252);
    expect(impliedMove(chain("2026-10-13"))).toBeCloseTo(sd, 3);
  });

  it("sells strikes at or under the target delta with wings one width out", () => {
    const c = condorFromChain(chain("2026-10-13"), BOT_RULES)!;
    expect(c.putShort).toBeLessThan(500);
    expect(c.callShort).toBeGreaterThan(500);
    expect(c.putShort - c.putLong).toBe(BOT_RULES.width);
    expect(c.callLong - c.callShort).toBe(BOT_RULES.width);
    expect(c.credit).toBeGreaterThan(0);
  });
});

describe("stepBot", () => {
  it("knows New York time", () => {
    expect(nyMinutes(at("2026-10-13", "09:45"))).toBe(9 * 60 + 45);
  });

  it("opens one trade a day, only inside the window and only with a same-day chain", () => {
    const early = stepBot(start(), { now: at("2026-10-13", "09:35"), chain: chain("2026-10-13"), closes: {} });
    expect(early.state.open).toBeNull();
    const wrongExpiry = stepBot(start(), { now: at("2026-10-13", "10:00"), chain: chain("2026-10-14"), closes: {} });
    expect(wrongExpiry.state.open).toBeNull();
    expect(wrongExpiry.state.note).toMatch(/No same-day/);

    const opened = stepBot(start(), { now: at("2026-10-13", "10:00"), chain: chain("2026-10-13"), closes: {} });
    expect(opened.state.open).toMatchObject({ date: "2026-10-13", contracts: 1, streak: 0 });
    const again = stepBot(opened.state, { now: at("2026-10-13", "10:30"), chain: chain("2026-10-13"), closes: {} });
    expect(again.state.open).toEqual(opened.state.open);
  });

  it("waits for the official close, then doubles after a loss and resets after a win", () => {
    let s = stepBot(start(), { now: at("2026-10-13", "10:00"), chain: chain("2026-10-13"), closes: {} }).state;
    const { putShort } = s.open!;
    // During the session Yahoo's "close" is just the latest price: don't settle on it.
    s = stepBot(s, { now: at("2026-10-13", "15:45"), chain: null, closes: { "2026-10-13": putShort - 5 } }).state;
    expect(s.open).not.toBeNull();

    s = stepBot(s, { now: at("2026-10-13", "16:30"), chain: null, closes: { "2026-10-13": putShort - 5 } }).state;
    expect(s.open).toBeNull();
    expect(s.trades[0].pnl).toBeLessThan(0);
    expect(s.streak).toBe(1);
    expect(s.equity).toBeCloseTo(BOT_RULES.startCash + s.trades[0].pnl!, 2);

    // Missed the evening run? The next morning settles it; here the next trade is doubled.
    s = stepBot(s, { now: at("2026-10-14", "10:00"), chain: chain("2026-10-14"), closes: {} }).state;
    expect(s.open).toMatchObject({ contracts: 2, streak: 1 });
    s = stepBot(s, { now: at("2026-10-15", "10:00"), chain: chain("2026-10-15"), closes: { "2026-10-14": 500 } }).state;
    expect(s.trades[0].pnl).toBeGreaterThan(0);
    expect(s.open).toMatchObject({ date: "2026-10-15", contracts: 1, streak: 0 });
    expect(s.history.map((h) => h.date)).toEqual(["2026-10-12", "2026-10-13", "2026-10-14"]);
  });

  it("goes all-in when it can't afford the doubled size, and bust when it can't afford one", () => {
    const poor = { ...start(500), streak: 4 };
    const s = stepBot(poor, { now: at("2026-10-13", "10:00"), chain: chain("2026-10-13"), closes: {} }).state;
    expect(s.open).toMatchObject({ contracts: 2, capped: true });

    const broke = stepBot(start(50), { now: at("2026-10-13", "10:00"), chain: chain("2026-10-13"), closes: {} }).state;
    expect(broke.bust).toBe("2026-10-13");
    expect(broke.open).toBeNull();
  });
});

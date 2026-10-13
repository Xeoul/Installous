import { describe, expect, it } from "vitest";
import { BOT_RULES, condorFromChain, impliedMove, newBotState, nyMinutes, stepBot, type BotState, type Chain } from "@/lib/condor-bot";
import { bsPrice } from "@/lib/options";

// October is EDT (UTC-4): 14:00Z is 10:00am in New York.
const at = (date: string, time: string) => new Date(`${date}T${time}:00-04:00`);

/** A chain around `spot`, priced by Black-Scholes at 15% vol over `days` trading days, a cent either side of fair. */
function chain(expiry: string, spot = 500, days = 1.7): Chain {
  const t = days / 252;
  const strikes = Array.from({ length: 61 }, (_, i) => spot - 30 + i);
  const leg = (kind: "put" | "call", strike: number) => {
    const fair = bsPrice(kind, spot, strike, t, 0.15);
    return { strike, bid: Math.max(0, fair - 0.01), ask: fair + 0.01 };
  };
  return { expiry, spot, marketOpen: true, puts: strikes.map((k) => leg("put", k)), calls: strikes.map((k) => leg("call", k)) };
}

const start = (equity = BOT_RULES.startCash): BotState => ({ ...newBotState(at("2026-10-12", "09:00")), equity });
const step = (s: BotState, date: string, time: string, c: Chain | null, closes: Record<string, number> = {}) =>
  stepBot(s, { now: at(date, time), chain: c, closes }).state;

describe("condorFromChain", () => {
  it("reads the expected move from the at-the-money straddle", () => {
    expect(impliedMove(chain("2026-10-14", 500, 1))).toBeCloseTo(0.15 * Math.sqrt(1 / 252), 3);
  });

  it("places even-money strikes: credit about half the wing width", () => {
    const c = condorFromChain(chain("2026-10-14"), BOT_RULES)!;
    expect(c.putShort - c.putLong).toBe(4);
    expect(c.callLong - c.callShort).toBe(4);
    expect(c.putShort).toBeLessThan(500);
    expect(c.callShort).toBeGreaterThan(500);
    expect(Math.abs(c.credit - 2)).toBeLessThan(0.35);
  });

  it("can still pick strikes by delta", () => {
    const c = condorFromChain(chain("2026-10-14"), { ...BOT_RULES, evenMoney: false, shortDelta: 0.1, width: 2 })!;
    expect(c.credit).toBeLessThan(1);
    expect(c.callShort - 500).toBeGreaterThan(5);
  });
});

describe("stepBot", () => {
  it("knows New York time", () => {
    expect(nyMinutes(at("2026-10-13", "09:45"))).toBe(9 * 60 + 45);
  });

  it("opens a next-day condor inside the window, only while the market is open", () => {
    expect(step(start(), "2026-10-13", "09:35", chain("2026-10-14")).open).toBeNull();
    const sameDay = stepBot(start(), { now: at("2026-10-13", "10:00"), chain: chain("2026-10-13"), closes: {} }).state;
    expect(sameDay.open).toBeNull();
    expect(sameDay.note).toMatch(/next-day/);
    // A half day: options still listed after the 1pm close.
    expect(step(start(), "2026-11-27", "13:30", { ...chain("2026-11-30"), marketOpen: false }).open).toBeNull();

    const s = step(start(), "2026-10-13", "10:00", chain("2026-10-14"));
    expect(s.open).toMatchObject({ date: "2026-10-13", expiry: "2026-10-14", contracts: 1, streak: 0 });
  });

  it("holds to the next day's official close, then sizes the next trade by the result", () => {
    let s = step(start(), "2026-10-13", "10:00", chain("2026-10-14"));
    const { putShort } = s.open!;
    const crash = { "2026-10-13": 500, "2026-10-14": putShort - 10 };

    // The expiration day: no new trade while this one is open, and no settling on the intraday "close".
    s = step(s, "2026-10-14", "10:00", chain("2026-10-15"), crash);
    expect(s.open?.date).toBe("2026-10-13");
    s = step(s, "2026-10-14", "15:45", chain("2026-10-15"), crash);
    expect(s.trades).toHaveLength(0);

    // After the close it settles as a full loss (about -$200 on one condor).
    s = step(s, "2026-10-14", "16:30", null, crash);
    expect(s.open).toBeNull();
    expect(s.trades[0]).toMatchObject({ expiry: "2026-10-14", close: putShort - 10 });
    expect(s.trades[0].pnl).toBeLessThan(-150);
    expect(s.trades[0].pnl).toBeGreaterThan(-250);
    expect(s.streak).toBe(1);
    expect(s.history.at(-1)).toEqual({ date: "2026-10-14", equity: s.equity });

    // Next morning: doubled.
    s = step(s, "2026-10-15", "10:00", chain("2026-10-16"), crash);
    expect(s.open).toMatchObject({ contracts: 2, streak: 1, expiry: "2026-10-16" });

    // Settles as a win the next morning if the evening run was missed, then back to one.
    s = step(s, "2026-10-19", "10:00", chain("2026-10-20"), { ...crash, "2026-10-16": 500 });
    expect(s.trades[0].pnl).toBeGreaterThan(300);
    expect(s.open).toMatchObject({ date: "2026-10-19", contracts: 1, streak: 0 });
  });

  it("goes all-in when it can't afford the doubled size, and bust when it can't afford one", () => {
    const s = step({ ...start(500), streak: 4 }, "2026-10-13", "10:00", chain("2026-10-14"));
    expect(s.open).toMatchObject({ contracts: 2, capped: true });
    const broke = step(start(150), "2026-10-13", "10:00", chain("2026-10-14"));
    expect(broke.bust).toBe("2026-10-13");
    expect(broke.open).toBeNull();
  });

  it("moves a saved version-1 account onto the current rules", () => {
    const v1 = { ...start(), version: 1, rules: { ...BOT_RULES, expiryDays: undefined, evenMoney: undefined, width: 2 } } as unknown as BotState;
    const s = step(v1, "2026-10-13", "10:00", chain("2026-10-14"));
    expect(s.version).toBe(2);
    expect(s.rules).toEqual(BOT_RULES);
    expect(s.open?.expiry).toBe("2026-10-14");
  });
});

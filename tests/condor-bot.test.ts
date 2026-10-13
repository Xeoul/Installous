import { describe, expect, it } from "vitest";
import {
  BOT_RULES,
  condorFromChain,
  impliedMove,
  newBotState,
  nextLevel,
  nyMinutes,
  pnlAt,
  stepBot,
  type BotState,
  type Chain,
} from "@/lib/condor-bot";
import { newsOn, upcomingNews } from "@/lib/news-days";
import { bsPrice } from "@/lib/options";

// October is EDT (UTC-4): 14:00Z is 10:00am in New York.
const at = (date: string, time: string) => new Date(`${date}T${time}:00-04:00`);

/** A chain around `spot`, priced by Black-Scholes at 15% vol over `days` trading days, a cent either side of fair. */
function chain(expiry: string, spot = 500, days = 1): Chain {
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

describe("levels", () => {
  it("go up a level on a loss, back to level 1 on any win, and start over past the top", () => {
    const L = [1, 2, 5, 10, 25];
    expect(nextLevel(0, -200, L)).toBe(1);
    expect(nextLevel(3, -200, L)).toBe(4);
    expect(nextLevel(4, -200, L)).toBe(0);
    expect(nextLevel(3, 5, L)).toBe(0);
    expect(nextLevel(2, 0, L)).toBe(0);
  });
});

describe("news days", () => {
  it("knows the scheduled releases", () => {
    expect(newsOn("2026-10-28")).toEqual(["FOMC"]);
    expect(newsOn("2026-11-06")).toEqual(["Jobs report"]);
    expect(newsOn("2026-11-10")).toEqual(["CPI"]);
    expect(newsOn("2026-10-29")).toEqual([]);
    expect(upcomingNews("2026-10-13", 2).map((n) => n.date)).toEqual(["2026-10-28", "2026-11-06"]);
  });
});

describe("stepBot", () => {
  it("knows New York time", () => {
    expect(nyMinutes(at("2026-10-13", "15:45"))).toBe(15 * 60 + 45);
  });

  it("opens only in the last half hour, with a next-day chain, while the market is open", () => {
    expect(step(start(), "2026-10-13", "10:00", chain("2026-10-14")).open).toBeNull();
    expect(step(start(), "2026-10-13", "15:59", chain("2026-10-14")).open).toBeNull();
    const sameDay = step(start(), "2026-10-13", "15:40", chain("2026-10-13"));
    expect(sameDay.open).toBeNull();
    expect(sameDay.note).toMatch(/next-day/);
    expect(step(start(), "2026-11-27", "15:40", { ...chain("2026-11-30"), marketOpen: false }).open).toBeNull();

    const s = step(start(), "2026-10-13", "15:40", chain("2026-10-14"));
    expect(s.open).toMatchObject({ date: "2026-10-13", expiry: "2026-10-14", contracts: 1, level: 0 });
    // Only one new condor a day.
    expect(step(s, "2026-10-13", "15:50", chain("2026-10-14")).open).toEqual(s.open);
  });

  it("trades daily: rolls into the next condor near the close, sized from the expiring one's result", () => {
    let s = step(start(), "2026-10-13", "15:40", chain("2026-10-14"));
    const first = s.open!;

    // Next day near the close SPY is far below the put wing: a full loss, so level 2.
    const down = first.putLong - 5;
    s = step(s, "2026-10-14", "15:40", chain("2026-10-15", down));
    expect(s.settling).toMatchObject({ expiry: "2026-10-14", rolled: { spot: down } });
    expect(s.settling!.rolled!.pnl).toBeLessThan(-150);
    expect(s.open).toMatchObject({ date: "2026-10-14", expiry: "2026-10-15", level: 1, contracts: 2 });

    // The official close books the loss without moving the level again.
    s = step(s, "2026-10-14", "16:30", null, { "2026-10-14": down });
    expect(s.settling).toBeNull();
    expect(s.trades[0]).toMatchObject({ expiry: "2026-10-14", close: down });
    expect(s.trades[0].pnl).toBeCloseTo(pnlAt(first, down, BOT_RULES.feePerLeg), 2);
    expect(s.level).toBe(1);
    expect(s.equity).toBeCloseTo(BOT_RULES.startCash + s.trades[0].pnl!, 2);

    // Next day SPY sits between the short strikes: a win, back to level 1.
    const mid = (s.open!.putShort + s.open!.callShort) / 2;
    s = step(s, "2026-10-15", "15:45", chain("2026-10-16", mid));
    expect(s.settling!.rolled!.pnl).toBeGreaterThan(300);
    expect(s.open).toMatchObject({ level: 0, contracts: 1 });
  });

  it("climbs the ladder 1, 2, 5, 10, 25 and starts over after a loss on level 5", () => {
    let s = start(1_000_000);
    const sizes: number[] = [];
    const days = ["2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-19", "2026-10-20", "2026-10-21"];
    for (let i = 0; i < days.length - 1; i++) {
      // Each day near the close, SPY is far below the expiring condor: every trade loses.
      const spot = s.open ? s.open.putLong - 5 : 500;
      s = step(s, days[i], "15:40", chain(days[i + 1], spot));
      sizes.push(s.open!.contracts);
    }
    expect(sizes).toEqual([1, 2, 5, 10, 25, 1]);
  });

  it("settles from the official close when a late run was missed, and sets the level from it", () => {
    let s = step(start(), "2026-10-13", "15:40", chain("2026-10-14"));
    const { putLong } = s.open!;
    // No late run on the 14th; the morning of the 15th settles it.
    s = step(s, "2026-10-15", "10:00", null, { "2026-10-14": putLong - 5 });
    expect(s.open).toBeNull();
    expect(s.trades[0].pnl).toBeLessThan(0);
    expect(s.level).toBe(1);
    s = step(s, "2026-10-15", "15:40", chain("2026-10-16"));
    expect(s.open).toMatchObject({ contracts: 2, level: 1 });
  });

  it("skips a day when a Fed decision, CPI or jobs report would land while the condor is open", () => {
    const s = stepBot(start(), { now: at("2026-10-27", "15:40"), chain: chain("2026-10-28"), closes: {} });
    expect(s.state.open).toBeNull();
    expect(s.state.note).toMatch(/FOMC/);
    expect(s.state.level).toBe(0);
    // With the skip off, it trades.
    expect(step({ ...start(), rules: { ...BOT_RULES, skipNews: false } }, "2026-10-27", "15:40", chain("2026-10-28")).open).not.toBeNull();
  });

  it("skips a day when the condor pays under the minimum credit", () => {
    const s = step({ ...start(), rules: { ...BOT_RULES, minCredit: 3 } }, "2026-10-13", "15:40", chain("2026-10-14"));
    expect(s.open).toBeNull();
    expect(s.note).toMatch(/minimum/);
  });

  it("goes all-in when it can't afford the level's size, and bust when it can't afford one", () => {
    const s = step({ ...start(500), level: 3 }, "2026-10-13", "15:40", chain("2026-10-14"));
    expect(s.open).toMatchObject({ contracts: 2, capped: true });
    const broke = step(start(150), "2026-10-13", "15:40", chain("2026-10-14"));
    expect(broke.bust).toBe("2026-10-13");
  });

  it("moves an older saved account onto the current rules", () => {
    const v2 = { ...start(), version: 2, rules: { ...BOT_RULES, levels: undefined, contracts: 1 }, level: undefined, settling: undefined } as unknown as BotState;
    const s = step(v2, "2026-10-13", "15:40", chain("2026-10-14"));
    expect(s.version).toBe(3);
    expect(s.rules).toEqual(BOT_RULES);
    expect(s.open).toMatchObject({ level: 0, expiry: "2026-10-14" });
  });
});

import { describe, expect, it } from "vitest";
import {
  BOT_RULES as LIVE_RULES,
  condorFromChain,
  impliedMove,
  newBotState,
  nextLevel,
  nyMinutes,
  pnlAt,
  stepBot,
  type BotRules,
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

// The logic tests run on SPY-style rules ($1 strikes, $4 wings) with synthetic chains around 500;
// the live SPX rules get their own test.
const BOT_RULES: BotRules = { ...LIVE_RULES, ticker: "SPY", quoteTicker: undefined, name: undefined, strikeStep: 1, width: 4 };
const start = (equity = BOT_RULES.startCash): BotState => ({ ...newBotState(at("2026-10-12", "09:00"), BOT_RULES), equity });
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

  it("never prices a condor above its wing width from stale quotes", () => {
    // Stale at-the-money quotes: the only condor on offer "pays" more than the $4 wing.
    const q = (strike: number, bid: number, ask: number) => ({ strike, bid, ask });
    const bad: Chain = {
      expiry: "2026-10-14",
      spot: 500,
      marketOpen: true,
      puts: [q(496, 0.1, 0.2), q(500, 3, 3.2)],
      calls: [q(500, 3, 3.2), q(504, 0.1, 0.2)],
    };
    expect(condorFromChain(bad, BOT_RULES)).toBeNull();
    expect(condorFromChain(bad, { ...BOT_RULES, evenMoney: false })).toBeNull();
    // So the bot skips the day instead of calling itself bust.
    const s = step(start(), "2026-10-13", "15:40", bad);
    expect(s.bust).toBeNull();
    expect(s.open).toBeNull();
  });

  it("picks SPX strikes on its 5-point grid, about half the wing width", () => {
    const spot = 7703.6;
    const t = 1 / 252;
    const strikes = Array.from({ length: 41 }, (_, i) => 7600 + i * 5);
    const leg = (kind: "put" | "call", k: number) => {
      const fair = bsPrice(kind, spot, k, t, 0.15);
      return { strike: k, bid: Math.max(0, fair - 0.05), ask: fair + 0.05 };
    };
    const c = condorFromChain({ expiry: "2026-10-15", spot, marketOpen: true, puts: strikes.map((k) => leg("put", k)), calls: strikes.map((k) => leg("call", k)) }, LIVE_RULES)!;
    for (const k of [c.putLong, c.putShort, c.callShort, c.callLong]) expect(k % 5).toBe(0);
    expect(c.putShort - c.putLong).toBe(5);
    expect(c.callLong - c.callShort).toBe(5);
    expect(c.credit).toBeGreaterThan(1.5);
    expect(c.credit).toBeLessThan(3.5);
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

  it("opens only right after the close, with a next-day chain, while index options trade", () => {
    expect(step(start(), "2026-10-13", "10:00", chain("2026-10-14")).open).toBeNull();
    expect(step(start(), "2026-10-13", "15:40", chain("2026-10-14")).open).toBeNull(); // before the close: never
    expect(step(start(), "2026-10-13", "16:15", chain("2026-10-14")).open).toBeNull(); // index options have stopped
    const sameDay = step(start(), "2026-10-13", "16:06", chain("2026-10-13"));
    expect(sameDay.open).toBeNull();
    expect(sameDay.note).toMatch(/next-day/);
    expect(step(start(), "2026-10-13", "16:06", { ...chain("2026-10-14"), marketOpen: false }).open).toBeNull();

    const s = step(start(), "2026-10-13", "16:06", chain("2026-10-14"));
    expect(s.open).toMatchObject({ date: "2026-10-13", expiry: "2026-10-14", contracts: 1, level: 0 });
    // Only one new condor a day.
    expect(step(s, "2026-10-13", "16:10", chain("2026-10-14")).open).toEqual(s.open);
  });

  it("settles today's condor at the close first, then sizes the next one from that real result", () => {
    let s = step(start(), "2026-10-13", "16:06", chain("2026-10-14"));
    const first = s.open!;

    // Before the close nothing happens: no guess at the result.
    s = step(s, "2026-10-14", "15:40", chain("2026-10-15"));
    expect(s.open).toEqual(first);
    expect(s.trades).toHaveLength(0);

    // At the close SPX is far below the put wing: a full loss, so the next condor is level 2.
    const down = first.putLong - 5;
    s = step(s, "2026-10-14", "16:06", chain("2026-10-15", down), { "2026-10-14": down });
    expect(s.trades[0]).toMatchObject({ expiry: "2026-10-14", close: down });
    expect(s.trades[0].pnl).toBeCloseTo(pnlAt(first, down, BOT_RULES.feePerLeg), 2);
    expect(s.open).toMatchObject({ date: "2026-10-14", expiry: "2026-10-15", level: 1, contracts: 3 });
    expect(s.equity).toBeCloseTo(BOT_RULES.startCash + s.trades[0].pnl!, 2);

    // Next day SPX closes between the short strikes: a win, back to level 1.
    const mid = (s.open!.putShort + s.open!.callShort) / 2;
    s = step(s, "2026-10-15", "16:06", chain("2026-10-16", mid), { "2026-10-14": down, "2026-10-15": mid });
    expect(s.trades[0].pnl).toBeGreaterThan(300);
    expect(s.open).toMatchObject({ level: 0, contracts: 1 });
  });

  it("waits to open until today's condor has settled", () => {
    let s = step(start(), "2026-10-13", "16:06", chain("2026-10-14"));
    // The close isn't in yet at 4:06: wait rather than guess.
    s = step(s, "2026-10-14", "16:06", chain("2026-10-15"));
    expect(s.open).toMatchObject({ expiry: "2026-10-14" });
    expect(s.note).toMatch(/Waiting for today's close/);
    // At 4:08 it settles and opens.
    s = step(s, "2026-10-14", "16:08", chain("2026-10-15"), { "2026-10-14": 500 });
    expect(s.trades).toMatchObject([{ expiry: "2026-10-14" }]);
    expect(s.open).toMatchObject({ date: "2026-10-14", expiry: "2026-10-15" });
  });

  it("corrects the ladder when an older early roll guessed wrong", () => {
    // Saved state from the old rules: at 3:27 the expiring condor looked like a win, so the next opened at level 1.
    let s = step(start(), "2026-10-13", "16:06", chain("2026-10-14"));
    const expiring = { ...s.open!, rolled: { at: "", spot: 500, pnl: 200 } };
    const next = { ...s.open!, date: "2026-10-14", expiry: "2026-10-15" };
    s = { ...s, settling: expiring, open: next, level: 0 };
    // It closes below the put wing: a loss after all.
    s = step(s, "2026-10-14", "16:06", null, { "2026-10-14": expiring.putLong - 5 });
    expect(s.trades[0].pnl).toBeLessThan(0);
    expect(s.level).toBe(1);
    expect(s.open).toMatchObject({ expiry: "2026-10-15", level: 1 });
    // A win after that drops back to level 1; a guess that was right changes nothing.
    const right = step({ ...s, settling: { ...expiring, rolled: { at: "", spot: 500, pnl: -200 } }, open: next, level: 1, trades: [] }, "2026-10-14", "16:06", null, {
      "2026-10-14": expiring.putLong - 5,
    });
    expect(right.level).toBe(1);
  });

  it("opens exactly one condor a day, sized by its level, however often it runs", () => {
    const days = ["2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23"];
    const ladder = BOT_RULES.levels;
    let s = start(1_000_000);
    const closes: Record<string, number> = {};
    for (let i = 0; i < days.length - 1; i++) {
      // Lose on even days and win on odd ones, so the level moves both ways.
      const expiring = s.open;
      const spot = !expiring ? 500 : i % 2 ? (expiring.putShort + expiring.callShort) / 2 : expiring.putLong - 5;
      // Every step of the real schedule, twice over (duplicate runs); the close arrives at 4:05.
      for (const time of ["10:30", "15:40", "16:06", "16:06", "16:08", "16:10", "16:12", "16:14", "16:20", "16:35", "16:50"]) {
        const settled = time >= "16:05" ? { ...closes, [days[i]]: spot } : closes;
        s = step(s, days[i], time, chain(days[i + 1], spot), settled);
      }
      closes[days[i]] = spot;
    }
    const all = [...s.trades, ...(s.settling ? [s.settling] : []), ...(s.open ? [s.open] : [])];
    const perDay = all.map((t) => t.date);
    expect(perDay).toHaveLength(days.length - 1);
    expect(new Set(perDay).size).toBe(perDay.length);
    for (const t of all) expect(t.contracts).toBe(ladder[t.level]);
    // The first opens at level 1; then each loss climbs the ladder and each win drops back to level 1.
    expect([...s.trades].reverse().map((t) => t.contracts)).toEqual([1, 1, 3, 1, 3, 1, 3]);
  });

  it("settles at the 4:06pm step, once the close is in, and not before 4:05", () => {
    let s = step(start(), "2026-10-13", "16:06", chain("2026-10-14"));
    // Yahoo's "close" at 4:04 can still be a pre-close price: wait.
    s = step(s, "2026-10-14", "16:04", null, { "2026-10-14": 500 });
    expect(s.open).toMatchObject({ expiry: "2026-10-14" });
    expect(s.trades).toHaveLength(0);
    s = step(s, "2026-10-14", "16:06", null, { "2026-10-14": 500 });
    expect(s.trades).toMatchObject([{ expiry: "2026-10-14", close: 500 }]);
    expect(s.trades[0].pnl).toBeGreaterThan(0);
    // Later retry steps change nothing.
    const again = step(s, "2026-10-14", "16:20", null, { "2026-10-14": 500 });
    expect(again.trades).toEqual(s.trades);
    expect(again.equity).toBe(s.equity);
  });

  it("trades only on market days: never on weekends, holidays or half days", () => {
    // Even if a quote claims the market is open, the NYSE calendar has the last word.
    const opened = (date: string, expiry: string) => step(start(), date, "16:06", chain(expiry)).open !== null;
    expect(opened("2026-10-16", "2026-10-19")).toBe(true); // a Friday: opens, expiring Monday
    expect(opened("2026-10-17", "2026-10-19")).toBe(false); // Saturday
    expect(opened("2026-10-18", "2026-10-19")).toBe(false); // Sunday
    // November is EST (UTC-5): 21:06Z is 4:06pm in New York.
    const est = (date: string, expiry: string) => stepBot(start(), { now: new Date(`${date}T21:06:00Z`), chain: chain(expiry), closes: {} }).state;
    expect(est("2026-11-25", "2026-11-27").open).not.toBeNull(); // the day before: a normal day, trades
    expect(est("2026-11-26", "2026-11-27").open).toBeNull(); // Thanksgiving
    expect(est("2026-11-26", "2026-11-27").note).toBe("The market isn't open.");
    expect(est("2026-11-27", "2026-11-30").open).toBeNull(); // half day: options stopped at 1:15pm
  });

  it("holds a Friday condor over the weekend and settles it Monday", () => {
    let s = step(start(), "2026-10-16", "16:06", chain("2026-10-19"));
    expect(s.open).toMatchObject({ date: "2026-10-16", expiry: "2026-10-19" });
    // Weekend steps change nothing.
    s = step(s, "2026-10-17", "16:06", null, { "2026-10-16": 500 });
    expect(s.open).toMatchObject({ expiry: "2026-10-19" });
    expect(s.trades).toHaveLength(0);
    // Monday after the close: settles Monday's condor, then opens Tuesday's.
    s = step(s, "2026-10-19", "16:06", chain("2026-10-20"), { "2026-10-16": 500, "2026-10-19": 500 });
    expect(s.trades).toMatchObject([{ date: "2026-10-16", expiry: "2026-10-19", close: 500 }]);
    expect(s.open).toMatchObject({ date: "2026-10-19", expiry: "2026-10-20" });
  });

  it("climbs the ladder 1, 3, 6 and starts over after a loss on level 3", () => {
    let s = start(1_000_000);
    const sizes: number[] = [];
    const days = ["2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-19", "2026-10-20", "2026-10-21"];
    const closes: Record<string, number> = {};
    for (let i = 0; i < days.length - 1; i++) {
      // Each day near the close, SPY is far below the expiring condor and closes there: every trade loses.
      const spot = s.open ? s.open.putLong - 5 : 500;
      closes[days[i]] = spot;
      s = step(s, days[i], "16:06", chain(days[i + 1], spot), closes);
      sizes.push(s.open!.contracts);
    }
    expect(sizes).toEqual([1, 3, 6, 1, 3, 6]);
    // Every settled condor is on the record: each settles before the next opens.
    expect(s.trades).toHaveLength(days.length - 2);
  });

  it("settles from the official close when a late run was missed, and sets the level from it", () => {
    let s = step(start(), "2026-10-13", "16:06", chain("2026-10-14"));
    const { putLong } = s.open!;
    // No late run on the 14th; the morning of the 15th settles it.
    s = step(s, "2026-10-15", "10:00", null, { "2026-10-14": putLong - 5 });
    expect(s.open).toBeNull();
    expect(s.trades[0].pnl).toBeLessThan(0);
    expect(s.level).toBe(1);
    s = step(s, "2026-10-15", "16:06", chain("2026-10-16"));
    expect(s.open).toMatchObject({ contracts: 3, level: 1 });
  });

  it("skips a day when a Fed decision, CPI or jobs report would land while the condor is open", () => {
    const s = stepBot(start(), { now: at("2026-10-27", "16:06"), chain: chain("2026-10-28"), closes: {} });
    expect(s.state.open).toBeNull();
    expect(s.state.note).toMatch(/FOMC/);
    expect(s.state.level).toBe(0);
    // With the skip off, it trades.
    expect(step({ ...start(), rules: { ...BOT_RULES, skipNews: false } }, "2026-10-27", "16:06", chain("2026-10-28")).open).not.toBeNull();
  });

  it("skips a day when the condor pays under the minimum credit", () => {
    const s = step({ ...start(), rules: { ...BOT_RULES, minCredit: 3 } }, "2026-10-13", "16:06", chain("2026-10-14"));
    expect(s.open).toBeNull();
    expect(s.note).toMatch(/minimum/);
  });

  it("goes all-in when it can't afford the level's size, and bust when it can't afford one", () => {
    const s = step({ ...start(500), level: 2 }, "2026-10-13", "16:06", chain("2026-10-14"));
    expect(s.open).toMatchObject({ contracts: 2, capped: true });
    const broke = step(start(150), "2026-10-13", "16:06", chain("2026-10-14"));
    expect(broke.bust).toBe("2026-10-13");
  });

  it("moves an older saved account onto the current rules", () => {
    const v2 = { ...start(), version: 2, rules: { ...BOT_RULES, levels: undefined, contracts: 1 }, level: undefined, settling: undefined } as unknown as BotState;
    const s = step(v2, "2026-10-13", "16:06", chain("2026-10-14"));
    expect(s.version).toBe(3);
    expect(s.rules).toEqual(LIVE_RULES);
    expect(s.open).toMatchObject({ level: 0, expiry: "2026-10-14" });
  });
});

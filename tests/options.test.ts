import { describe, expect, it } from "vitest";
import {
  bsPrice,
  buildCondor,
  DEFAULT_RULES,
  doublingLadder,
  normCdf,
  normInv,
  packBars,
  planTrades,
  settlement,
  sizePlan,
  unpackBars,
  simulateCondors,
  sizeFor,
  type CondorRules,
  type CondorTrade,
  type IndexBar,
} from "@/lib/options";

/** Trading days from 2024-01-02 (weekdays only) with the given closes; open = previous close. */
function bars(closes: number[], vix = 20): IndexBar[] {
  const out: IndexBar[] = [];
  let d = Date.UTC(2024, 0, 2);
  for (const [i, close] of closes.entries()) {
    while ([0, 6].includes(new Date(d).getUTCDay())) d += 86_400_000;
    out.push({ date: new Date(d).toISOString().slice(0, 10), open: i ? closes[i - 1] : close, close, vix });
    d += 86_400_000;
  }
  return out;
}

// Delta-placed strikes unless a test says otherwise.
const rules = (r: Partial<CondorRules> = {}): CondorRules => ({ ...DEFAULT_RULES, evenMoney: false, levels: null, feePerLeg: 0, slippage: 0, ...r });

describe("pricing", () => {
  it("normal CDF and its inverse agree", () => {
    for (const p of [0.01, 0.1, 0.5, 0.84, 0.99]) expect(normCdf(normInv(p))).toBeCloseTo(p, 6);
    expect(normCdf(0)).toBeCloseTo(0.5, 7);
  });

  it("satisfies put-call parity", () => {
    const [s, k, t, v] = [5000, 5100, 30 / 252, 0.2];
    const parity = bsPrice("call", s, k, t, v) - bsPrice("put", s, k, t, v);
    expect(parity).toBeCloseTo(s - k * Math.exp(-0.03 * t), 6);
  });

  it("places short strikes on either side of the market, wings one width out", () => {
    const c = buildCondor(500, 7 / 252, 0.2, { shortDelta: 0.1, width: 3, slippage: 0 });
    expect(c.putShort).toBeLessThan(500);
    expect(c.callShort).toBeGreaterThan(500);
    expect(c.putShort - c.putLong).toBe(3);
    expect(c.callLong - c.callShort).toBe(3);
    expect(Number.isInteger(c.putShort)).toBe(true);
    expect(c.credit).toBeGreaterThan(0);
    expect(c.credit).toBeLessThan(3);
  });

  it("places even-money strikes so the credit is about half the width", () => {
    const c = buildCondor(500, 1 / 252, 0.15, { shortDelta: 0.1, width: 4, slippage: 0.01, evenMoney: true });
    expect(c.putShort - c.putLong).toBe(4);
    expect(Math.abs(c.credit - 2)).toBeLessThan(0.3);
    expect(c.putShort).toBeLessThan(500);
    expect(c.callShort).toBeGreaterThan(500);
  });

  it("settles between zero and the wing width", () => {
    const c = { putLong: 4900, putShort: 4950, callShort: 5050, callLong: 5100 };
    expect(settlement(c, 5000)).toBe(0);
    expect(settlement(c, 4930)).toBe(20);
    expect(settlement(c, 4000)).toBe(50);
    expect(settlement(c, 5075)).toBe(25);
  });
});

describe("sizing", () => {
  it("doubles after each loss and resets past the limit", () => {
    const r = rules({ sizing: "martingale", contracts: 1, maxDoublings: 2 });
    expect(sizeFor(r, 0).contracts).toBe(1);
    expect(sizeFor(r, 2).contracts).toBe(4);
    expect(sizeFor(r, 3)).toEqual({ contracts: 1, streak: 0 });
    expect(sizeFor(rules({ sizing: "fixed", contracts: 2 }), 5).contracts).toBe(2);
  });

  it("walks the level ladder and starts over after the last level", () => {
    const r = rules({ sizing: "martingale", levels: [1, 2, 5, 10, 25] });
    expect([0, 1, 2, 3, 4].map((k) => sizeFor(r, k).contracts)).toEqual([1, 2, 5, 10, 25]);
    expect(sizeFor(r, 5)).toEqual({ contracts: 1, streak: 0 });
  });

  it("levels: one win at the next level more than recovers the losses before it (at even money)", () => {
    const levels = [1, 2, 5, 10, 25];
    for (let k = 1; k < levels.length; k++) {
      const lost = levels.slice(0, k).reduce((a, b) => a + b, 0);
      expect(levels[k]).toBeGreaterThan(lost);
    }
  });
});

describe("simulateCondors", () => {
  it("keeps the credit on quiet days", () => {
    const r = simulateCondors(bars(Array(30).fill(500)), rules({ dte: 0, sizing: "fixed" }));
    expect(r.trades.length).toBe(29);
    expect(r.trades.every((t) => t.pnl > 0)).toBe(true);
    expect(r.stats.finalEquity).toBeGreaterThan(DEFAULT_RULES.startCash);
  });

  it("only uses information available when each trade opens", () => {
    // A crash on the last day can't change the strikes chosen that morning.
    const calm = bars([...Array(10).fill(500)]);
    const crash = bars([...Array(9).fill(500), 400]).map((b, i) => (i === 9 ? { ...b, vix: 60 } : b));
    const a = simulateCondors(calm, rules({ dte: 0 })).trades.at(-1)!;
    const b = simulateCondors(crash, rules({ dte: 0 })).trades.at(-1)!;
    expect([b.putShort, b.callShort, b.credit]).toEqual([a.putShort, a.callShort, a.credit]);
    expect(b.pnl).toBeLessThan(0);
  });

  it("goes bust under martingale when losses keep coming", () => {
    // The market falls 3% every day, so every same-day condor loses its maximum.
    const closes = Array.from({ length: 40 }, (_, i) => 500 * 0.97 ** i);
    const mart = simulateCondors(bars(closes), rules({ dte: 0, sizing: "martingale", startCash: 25_000 }));
    const fixed = simulateCondors(bars(closes), rules({ dte: 0, sizing: "fixed", startCash: 25_000 }));
    expect(mart.stats.bust).not.toBeNull();
    expect(mart.trades.map((t) => t.contracts).slice(0, 4)).toEqual([1, 2, 4, 8]);
    expect(mart.trades.at(-1)!.capped).toBe(true);
    expect(fixed.trades.length).toBeGreaterThan(mart.trades.length);
  });

  it("sizing changes only the contracts: both accounts take the same trades", () => {
    // Calm days with a big move every fifth day, so some condors lose.
    const closes = Array.from({ length: 80 }, (_, i) => 500 + (i % 5 === 4 ? (i % 10 === 4 ? 20 : -20) : 0));
    const plan = planTrades(bars(closes), rules({ dte: 1, evenMoney: true, width: 4 }));
    const fixed = sizePlan(plan, rules({ dte: 1, sizing: "fixed" }));
    const mart = sizePlan(plan, rules({ dte: 1, sizing: "martingale", levels: [1, 2, 5, 10, 25], startCash: 1_000_000 }));
    const key = (t: CondorTrade) => [t.opened, t.closed, t.putShort, t.callShort, t.credit].join();
    expect(mart.trades.map(key)).toEqual(fixed.trades.map(key));
    expect(fixed.trades.every((t) => t.contracts === 1)).toBe(true);
    expect(mart.trades.some((t) => t.contracts > 1)).toBe(true);
    // Per contract, the results match.
    mart.trades.forEach((t, i) => expect(t.pnl / t.contracts).toBeCloseTo(fixed.trades[i].pnl, 6));
  });

  it("cheaper option prices mean less credit for the same strikes", () => {
    const b = bars(Array(30).fill(500));
    const credit = (ivScale: number) =>
      planTrades(b, { ...rules({ dte: 1 }), ivScale }).events.reduce((sum, e) => sum + (e.kind === "open" ? e.trade.condor.credit : 0), 0);
    expect(credit(0.8)).toBeLessThan(credit(1));
  });

  it("takes profit early on multi-day trades", () => {
    const r = simulateCondors(bars(Array(60).fill(500)), rules({ dte: 30, takeProfit: 0.5, sizing: "fixed" }));
    expect(r.trades.length).toBeGreaterThan(1);
    expect(r.trades.some((t) => t.exit === "profit")).toBe(true);
    expect(r.trades.every((t) => t.pnl > 0)).toBe(true);
  });

  it("closes at a stop when the market runs through a short strike", () => {
    const closes = [...Array(5).fill(500), ...Array.from({ length: 30 }, (_, i) => 500 - 4 * (i + 1))];
    const r = simulateCondors(bars(closes), rules({ dte: 30, stopLoss: 2, sizing: "fixed" }));
    expect(r.trades[0].exit).toBe("stop");
    expect(r.trades[0].pnl).toBeLessThan(0);
  });
});

describe("packBars", () => {
  it("round-trips bars through the compact wire format, across weekends and holidays", () => {
    const b: IndexBar[] = [
      { date: "2026-10-09", open: 1, close: 2, vix: 15 },
      { date: "2026-10-12", open: 2, close: 3, vix: 16 },
      { date: "2026-11-27", open: 3, close: 4, vix: 17.5 },
      { date: "2027-03-15", open: 4, close: 5, vix: 18 }, // across a DST change
    ];
    expect(unpackBars(JSON.parse(JSON.stringify(packBars(b))))).toEqual(b);
  });
});

describe("doublingLadder", () => {
  it("shows when the next bet outgrows the account", () => {
    const condor = { putLong: 4940, putShort: 4950, callShort: 5050, callLong: 5060, credit: 0.5 };
    const rows = doublingLadder(condor, { contracts: 1, startCash: 10_000, feePerLeg: 0, levels: null });
    expect(rows[0]).toMatchObject({ losses: 0, contracts: 1, atRisk: 950, lostSoFar: 0, affordable: true });
    expect(rows[3]).toMatchObject({ contracts: 8, atRisk: 7600, lostSoFar: 950 * 7, affordable: false });
    const lv = doublingLadder(condor, { contracts: 1, startCash: 10_000, feePerLeg: 0, levels: [1, 2, 5, 10, 25] });
    expect(lv.map((r) => r.contracts)).toEqual([1, 2, 5, 10, 25]);
  });
});

import { describe, expect, it } from "vitest";
import { BOT_RULES, newBotState, type BotTrade } from "@/lib/condor-bot";
import { condorValue, impliedVol, markCondor, nyClose, orderPhase, payoff, yearsLeft } from "@/lib/condor-live";

const trade: BotTrade = {
  date: "2026-10-14",
  expiry: "2026-10-15",
  openedAt: "2026-10-14T19:27:00Z",
  spot: 778,
  putLong: 773,
  putShort: 777,
  callShort: 779,
  callLong: 783,
  credit: 1.92,
  contracts: 2,
  level: 1,
  streak: 1,
  capped: false,
};
const at = (s: string) => new Date(s);

describe("condor live marks", () => {
  it("knows 4pm New York in daylight and standard time", () => {
    expect(nyClose("2026-10-15").toISOString()).toBe("2026-10-15T20:00:00.000Z");
    expect(nyClose("2026-12-15").toISOString()).toBe("2026-12-15T21:00:00.000Z");
    expect(yearsLeft(trade, at("2026-10-15T20:30:00Z"))).toBe(0);
  });

  it("backs out the volatility that priced the condor at its credit", () => {
    const vol = impliedVol(trade, BOT_RULES.slippage);
    const years = yearsLeft(trade, at(trade.openedAt));
    expect(condorValue(trade, trade.spot, years, vol)).toBeCloseTo(trade.credit + 2 * BOT_RULES.slippage, 3);
    expect(vol).toBeGreaterThan(0.03);
    expect(vol).toBeLessThan(1);
  });

  it("marks the position: about break-even at the open, the full credit at expiry inside the shorts", () => {
    const vol = impliedVol(trade, BOT_RULES.slippage);
    const fees = 4 * BOT_RULES.feePerLeg * trade.contracts;
    const open = markCondor(trade, trade.spot, at(trade.openedAt), vol, BOT_RULES.feePerLeg);
    // Just the slippage and fees given up on the fill.
    expect(open.pnl).toBeCloseTo(-2 * BOT_RULES.slippage * 100 * trade.contracts - fees, 0);
    expect(open.legs.map((l) => `${l.action} ${l.strike} ${l.kind}`)).toEqual(["Buy 773 Put", "Sell 777 Put", "Sell 779 Call", "Buy 783 Call"]);

    const expired = markCondor(trade, 778, at("2026-10-15T20:00:00Z"), vol, BOT_RULES.feePerLeg);
    expect(expired.pnl).toBeCloseTo(384 - fees, 6);
    expect(expired.pctOfMax).toBeCloseTo(((384 - fees) / 384) * 100, 6);

    // Next morning, SPY well below the put wing: close to the full loss.
    const down = markCondor(trade, 760, at("2026-10-15T14:00:00Z"), vol, BOT_RULES.feePerLeg);
    expect(down.pnl).toBeLessThan(-350);
    expect(down.atExpiry).toBeCloseTo((1.92 - 4) * 200 - fees, 6);
  });

  it("draws the payoff: the full credit between the shorts, the full loss past the wings", () => {
    const p = payoff(trade, 0);
    expect(p[0].pnl).toBeCloseTo((1.92 - 4) * 200, 6);
    expect(p.at(-1)!.pnl).toBeCloseTo((1.92 - 4) * 200, 6);
    expect(Math.max(...p.map((x) => x.pnl))).toBeCloseTo(384, 6);
  });
});

describe("order phase", () => {
  const bot = () => newBotState(at("2026-10-13T13:00:00Z"));
  it("counts down to the 3:27pm order, works it in the window, then shows the fill", () => {
    const before = orderPhase(bot(), at("2026-10-14T17:00:00Z"));
    expect(before).toEqual({ phase: "waiting", at: at("2026-10-14T19:27:00Z") });
    expect(orderPhase(bot(), at("2026-10-14T19:30:00Z")).phase).toBe("working");
    expect(orderPhase({ ...bot(), open: trade }, at("2026-10-14T19:40:00Z"))).toMatchObject({ phase: "filled", trade });
    expect(orderPhase(bot(), at("2026-10-14T21:00:00Z")).phase).toBe("closed");
    expect(orderPhase(bot(), at("2026-10-17T19:30:00Z")).phase).toBe("closed"); // Saturday
    const skipped = { ...bot(), note: "Skipped: FOMC on Wed, Oct 28, while the condor would be open.", updatedAt: "2026-10-27T19:27:00Z" };
    expect(orderPhase(skipped, at("2026-10-27T19:40:00Z")).phase).toBe("skipped");
  });
});

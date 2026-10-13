import { describe, expect, it } from "vitest";
import { BOT_RULES, newBotState, type BotTrade } from "@/lib/condor-bot";
import { FUND_RULES, type FundView } from "@/lib/fund";
import { liveBot, liveFund, livePortfolio } from "@/lib/live/valuations";
import type { PortfolioSnapshot } from "@/lib/portfolio";

const fund = {
  rules: FUND_RULES,
  cash: 1000,
  equity: 101_000,
  benchmarkValue: 100_500,
  benchmarkStartPrice: 500,
  holdings: [
    { ticker: "AAA", shares: 100, price: 500, value: 50_000 },
    { ticker: "BBB", shares: 200, price: 250, value: 50_000 },
  ],
} as unknown as FundView;

describe("liveFund", () => {
  it("re-prices holdings that have a live price and keeps the rest", () => {
    const v = liveFund(fund, { AAA: 510 });
    expect(v.live).toBe(true);
    expect(v.equity).toBe(1000 + 100 * 510 + 50_000);
    expect(v.returnPercent).toBeCloseTo((102_000 / FUND_RULES.startCash - 1) * 100, 2);
  });

  it("re-prices the S&P 500 line from SPY when the start price is published", () => {
    expect(liveFund(fund, {}, 505).benchmarkReturnPercent).toBeCloseTo(1, 6);
    // Older published views without the start price keep the published value.
    const old = { ...fund, benchmarkStartPrice: undefined } as FundView;
    expect(liveFund(old, {}, 505).benchmarkReturnPercent).toBeCloseTo(0.5, 6);
    expect(liveFund(fund, {}).live).toBe(false);
  });
});

describe("liveBot", () => {
  const condor = (contracts: number): BotTrade => ({
    date: "2026-10-13", expiry: "2026-10-14", openedAt: "", spot: 500,
    putLong: 492, putShort: 496, callShort: 504, callLong: 508, credit: 2, contracts, level: 0, capped: false,
  });

  it("adds what the open condors would pay if they settled at SPY now", () => {
    const bot = { ...newBotState(new Date()), open: condor(2), settling: condor(1) };
    const win = liveBot(bot, 500); // between the shorts: full credit, less fees
    expect(win.live).toBe(true);
    expect(win.unsettled).toBeCloseTo(3 * 200 - 4 * BOT_RULES.feePerLeg * 3, 2);
    const loss = liveBot(bot, 480); // below the put wing: full loss
    expect(loss.unsettled).toBeCloseTo(3 * -200 - 4 * BOT_RULES.feePerLeg * 3, 2);
  });

  it("is just the account when nothing is open or there's no price", () => {
    const bot = newBotState(new Date());
    expect(liveBot(bot, 500)).toEqual({ live: false, equity: bot.equity, unsettled: 0 });
    expect(liveBot({ ...bot, open: condor(1) }, undefined).live).toBe(false);
  });
});

describe("livePortfolio", () => {
  it("values holdings at live prices and carries today's change", () => {
    const p = {
      totalCost: 900,
      holdings: [{ ticker: "AAA", shares: 10, price: 100, dayChangePercent: 25 }],
    } as unknown as PortfolioSnapshot;
    const v = livePortfolio(p, { AAA: 110 });
    expect(v.value).toBe(1100);
    expect(v.day).toBe(1100 - 800); // previous close was 100 / 1.25 = 80
    expect(v.gain).toBe(200);
  });
});

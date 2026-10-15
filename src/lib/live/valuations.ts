// Re-price the published AI Fund, the condor bot and your portfolio at live
// streamed prices, so their headline numbers tick like a stock price does.
// Pure functions: the hook that feeds them prices lives in the components.
import { pnlAt, type BotState } from "../condor-bot";
import { impliedVol, markCondor } from "../condor-live";
import type { FundView } from "../fund";
import type { PortfolioSnapshot } from "../portfolio";

/** Live prices by ticker; missing tickers keep their published price. */
export type LivePrices = Record<string, number | undefined>;

const round2 = (x: number) => Math.round(x * 100) / 100;

/** The fund at live prices: cash plus every holding's shares at its latest price. */
export function liveFund(fund: FundView, prices: LivePrices, spy?: number) {
  let live = false;
  const equity = fund.holdings.reduce((sum, h) => {
    const p = prices[h.ticker];
    if (p !== undefined) live = true;
    return sum + (p !== undefined ? h.shares * p : h.value);
  }, fund.cash);
  const start = fund.rules.startCash;
  // The S&P 500 line is SPY bought with the same starting cash.
  const benchmark = spy !== undefined && fund.benchmarkStartPrice ? (start * spy) / fund.benchmarkStartPrice : fund.benchmarkValue;
  return {
    live,
    equity: round2(equity),
    returnPercent: round2((equity / start - 1) * 100),
    benchmarkReturnPercent: round2((benchmark / start - 1) * 100),
  };
}

/**
 * The bot's account with its open condors valued at the index price `spy`:
 * bought back at `now` (their live mark, which moves with every tick), or
 * without `now`, settled at that price.
 */
export function liveBot(bot: BotState, spy: number | undefined, now?: Date) {
  const open = [bot.settling, bot.open].filter((t) => t !== null && t !== undefined);
  if (spy === undefined || open.length === 0) return { live: false, equity: bot.equity, unsettled: 0 };
  const { feePerLeg, slippage } = bot.rules;
  const unsettled = open.reduce((sum, t) => sum + (now ? markCondor(t, spy, now, impliedVol(t, slippage), feePerLeg).pnl : pnlAt(t, spy, feePerLeg)), 0);
  return { live: true, equity: round2(bot.equity + unsettled), unsettled: round2(unsettled) };
}

/** Your holdings at live prices, with today's change. */
export function livePortfolio(p: PortfolioSnapshot, prices: LivePrices) {
  let live = false;
  let value = 0;
  let day = 0;
  for (const h of p.holdings) {
    const lp = prices[h.ticker];
    if (lp !== undefined) live = true;
    const price = lp ?? h.price;
    if (price === null) continue;
    const v = h.shares * price;
    value += v;
    // Day change from the published quote's change, carried to the live price.
    if (h.price !== null && h.dayChangePercent !== null) day += v - (h.shares * h.price) / (1 + h.dayChangePercent / 100);
  }
  const gain = value - p.totalCost;
  return { live, value: round2(value), day: round2(day), dayPercent: value - day ? round2((day / (value - day)) * 100) : null, gain: round2(gain) };
}

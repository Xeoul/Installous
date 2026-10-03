// Backtest the AI Fund's rules over the last 5 years and publish the result
// for the Fund page (public/demo-data/backtest.json). See src/lib/backtest.ts
// for what it can and can't measure.
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { runBacktest, type DailyClose } from "../src/lib/backtest";
import { FUND_RULES } from "../src/lib/fund";
import { getDailyCloses, getQuotes } from "../src/lib/market";
import { DEFAULT_UNIVERSE } from "../src/lib/universe";

const YEARS = 5;
const OUT = path.join("public", "demo-data", "backtest.json");

async function main() {
  const started = Date.now();
  // An extra ~1.3 years of history feeds the 52-week factors on day one.
  const fetchYears = YEARS + 1.3;
  const benchmark = await getDailyCloses(FUND_RULES.benchmark, fetchYears);

  const series: Record<string, DailyClose[]> = {};
  const queue = [...DEFAULT_UNIVERSE];
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (queue.length) {
        const t = queue.shift()!;
        try {
          series[t] = await getDailyCloses(t, fetchYears);
        } catch (err) {
          console.warn(`skipped ${t}: ${(err as Error).message}`);
        }
      }
    }),
  );
  if (Object.keys(series).length < DEFAULT_UNIVERSE.length * 0.8) throw new Error("Too few tickers loaded for the backtest");

  const quotes = await getQuotes(Object.keys(series));
  const names = Object.fromEntries(Object.entries(quotes).map(([t, q]) => [t, q.name]));
  const start = new Date(Date.now() - YEARS * 365.25 * 86_400_000).toISOString().slice(0, 10);
  const { view } = runBacktest({ series, names, benchmark, startDate: start });

  await mkdir(path.dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(view));
  const f = view.stats.fund;
  const b = view.stats.benchmark;
  const u = view.stats.universe;
  console.log(
    `Backtest ${view.startDate} → ${view.endDate} over ${view.universeSize} stocks in ${((Date.now() - started) / 1000).toFixed(0)}s: ` +
      `fund ${f.totalReturnPercent}% (CAGR ${f.cagrPercent}%, max drawdown ${f.maxDrawdownPercent}%) vs ` +
      `SPY ${b.totalReturnPercent}% (CAGR ${b.cagrPercent}%) vs same stocks held ${u.totalReturnPercent}% (CAGR ${u.cagrPercent}%); ` +
      `${view.stats.trading.trades} trades`,
  );
  for (const y of view.years)
    console.log(`  ${y.year}${y.partial ? "*" : ""}: fund ${y.fundPercent}%  SPY ${y.benchmarkPercent}%  same stocks ${y.universePercent}%`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

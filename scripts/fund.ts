// Advance the AI Fund one step: load its saved state, rebalance if due,
// record today's value, save the state, and publish the view the Fund page
// reads. Run after `npm run demo:data`, which provides today's scores.
//
//   FUND_DIR   where fund.json (the fund's state) lives. The deploy workflow
//              points this at a checkout of the `fund-data` branch.
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { FUND_RULES, fundView, nyDate, stepFund, type FundState } from "../src/lib/fund";
import { getQuotes } from "../src/lib/market";
import type { Pick } from "../src/lib/portfolio";

const FUND_DIR = process.env.FUND_DIR ?? path.join("data", "fund");
const STATE_FILE = path.join(FUND_DIR, "fund.json");
const PICKS_FILE = path.join("public", "demo-data", "picks.json");
const VIEW_FILE = path.join("public", "demo-data", "fund.json");

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

async function main() {
  const picks = await readJson<Pick[]>(PICKS_FILE);
  if (!picks?.length) throw new Error(`${PICKS_FILE} is missing. Run \`npm run demo:data\` first.`);

  const quotes = await getQuotes([FUND_RULES.benchmark]);
  const spy = quotes[FUND_RULES.benchmark];
  if (!spy?.price || !spy.marketTime) throw new Error("Couldn't load the benchmark price");

  const prev = await readJson<FundState>(STATE_FILE);
  const now = new Date();
  const { state, trades } = stepFund(prev, {
    picks,
    benchmarkPrice: spy.price,
    marketDate: nyDate(new Date(spy.marketTime)),
    now,
  });

  await mkdir(FUND_DIR, { recursive: true });
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2) + "\n");
  await mkdir(path.dirname(VIEW_FILE), { recursive: true });
  const view = fundView(state, picks);
  await writeFile(VIEW_FILE, JSON.stringify(view));

  console.log(
    `${prev ? "Updated" : "Started"} fund for ${view.asOf}: $${view.equity.toFixed(2)} ` +
      `(${view.returnPercent >= 0 ? "+" : ""}${view.returnPercent}% vs SPY ${view.benchmarkReturnPercent >= 0 ? "+" : ""}${view.benchmarkReturnPercent}%)`,
  );
  for (const t of trades) console.log(`  ${t.side.toUpperCase()} ${t.shares} ${t.ticker} @ ${t.price}: ${t.reason}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

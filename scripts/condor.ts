// Advance the SPY condor bot one step: settle yesterday's or today's trade
// at the official close, and open today's same-day iron condor at real
// quotes once the market has been open a few minutes. The deploy workflow
// runs this every 30 minutes during market hours.
//
//   FUND_DIR   where condor.json (the bot's state) lives; the workflow points
//              this at a checkout of the `fund-data` branch.
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { BOT_RULES, stepBot, type BotState, type Chain } from "../src/lib/condor-bot";
import { getDailyCloses, getNearestChain } from "../src/lib/market";

const FUND_DIR = process.env.FUND_DIR ?? path.join("data", "fund");
const STATE_FILE = path.join(FUND_DIR, "condor.json");
const VIEW_FILE = path.join("public", "demo-data", "condor.json");

async function readState(): Promise<BotState | null> {
  try {
    return JSON.parse(await readFile(STATE_FILE, "utf8")) as BotState;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

async function main() {
  const prev = await readState();
  let chain: Chain | null = null;
  try {
    chain = await getNearestChain(BOT_RULES.ticker);
  } catch (err) {
    console.warn(`No option chain: ${(err as Error).message}`);
  }
  const closes = Object.fromEntries((await getDailyCloses(BOT_RULES.ticker, 0.1)).map((c) => [c.date, Math.round(c.close * 100) / 100]));

  const { state, events } = stepBot(prev, { now: new Date(), chain, closes });

  await mkdir(FUND_DIR, { recursive: true });
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2) + "\n");
  await mkdir(path.dirname(VIEW_FILE), { recursive: true });
  await writeFile(VIEW_FILE, JSON.stringify(state));

  console.log(`Condor bot: $${state.equity.toFixed(2)}, ${state.streak} loss(es) in a row${state.bust ? `, BUST ${state.bust}` : ""}`);
  for (const e of events) console.log(`  ${e}`);
  if (state.note) console.log(`  ${state.note}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

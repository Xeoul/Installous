// Advance the SPX condor bot one step: settle its trade at the official close
// on the expiration day, and open the next iron condor at real quotes once
// in the last half hour of the session. scripts/condor-session.sh runs this
// several times a day from the condor workflow.
//
//   FUND_DIR   where condor.json (the bot's state) lives; the workflow points
//              this at a checkout of the `fund-data` branch.
//   NTFY_TOPIC phone notifications for opens, settlements and skips (scripts/notify.ts)
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";
import { BOT_RULES, botQuoteTicker, nyDate, stepBot, type BotState, type Chain } from "../src/lib/condor-bot";
import { getChain, getDailyCloses } from "../src/lib/market";
import { condorNotifications } from "../src/lib/notifications";
import { notify } from "./notify";

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
  // The live bot always trades the current rules (e.g. a new contract ladder);
  // a level past the end of a shorter ladder starts over at level 1.
  if (prev) {
    // A switch of underlying (SPY → SPX): a condor still open on the old one
    // can't be priced or settled on the new one, so it's cancelled unfilled
    // (paper money) and the bot trades the new underlying from here on.
    if (prev.rules.ticker !== BOT_RULES.ticker && (prev.open || prev.settling)) {
      console.log(`Cancelling open ${prev.rules.ticker} condors: the bot now trades ${BOT_RULES.ticker}`);
      prev.open = null;
      prev.settling = null;
    }
    prev.rules = { ...BOT_RULES };
    if (prev.level >= BOT_RULES.levels.length) prev.level = 0;
  }
  const now = new Date();
  const today = nyDate(now);
  // Same-day: today's expiration. Next-day: the first one after today.
  const from = BOT_RULES.expiryDays === 0 ? today : new Date(Date.parse(`${today}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  let chain: Chain | null = null;
  try {
    chain = await getChain(BOT_RULES.ticker, from);
  } catch (err) {
    console.warn(`No option chain: ${(err as Error).message}`);
  }
  const closes = Object.fromEntries((await getDailyCloses(botQuoteTicker(BOT_RULES), 0.1)).map((c) => [c.date, Math.round(c.close * 100) / 100]));

  const { state, events } = stepBot(prev, { now, chain, closes });

  await mkdir(FUND_DIR, { recursive: true });
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2) + "\n");
  await mkdir(path.dirname(VIEW_FILE), { recursive: true });
  await writeFile(VIEW_FILE, JSON.stringify(state));

  // Saved first, so a step that's re-run never notifies twice.
  for (const n of condorNotifications(prev, state)) await notify(n);

  console.log(`Condor bot: $${state.equity.toFixed(2)}, ${state.streak} loss(es) in a row${state.bust ? `, BUST ${state.bust}` : ""}`);
  for (const e of events) console.log(`  ${e}`);
  if (state.note) console.log(`  ${state.note}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

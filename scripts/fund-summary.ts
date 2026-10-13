// After the close, send the AI Fund's day as a phone notification: today's
// change in dollars and percent, its total since the start and the S&P 500's.
// Prices its holdings at today's official closes (read-only: the deploy
// workflow owns the fund's state). Sends once a day, remembered in
// notify.json beside the fund's state.
//
//   FUND_DIR   checkout of the fund-data branch (fund.json, notify.json)
//   NTFY_TOPIC where to send it (scripts/notify.ts)
import { readFile, writeFile } from "fs/promises";
import path from "path";
import { nyDate, type FundState } from "../src/lib/fund";
import { getDailyCloses } from "../src/lib/market";
import { fundNotification } from "../src/lib/notifications";
import { notify } from "./notify";

const FUND_DIR = process.env.FUND_DIR ?? path.join("data", "fund");
const MARK_FILE = path.join(FUND_DIR, "notify.json");
const AFTER_CLOSE = 16 * 60 + 15;

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

async function main() {
  const now = new Date();
  const today = nyDate(now);
  const [h, m] = now.toLocaleTimeString("en-GB", { timeZone: "America/New_York", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).split(":");
  if (Number(h) * 60 + Number(m) < AFTER_CLOSE) return;
  const mark = (await readJson<{ fund?: string }>(MARK_FILE)) ?? {};
  if (mark.fund === today) return;
  const fund = await readJson<FundState>(path.join(FUND_DIR, "fund.json"));
  if (!fund) return;

  // No SPY bar for today: the market was closed.
  const spyBars = await getDailyCloses("SPY", 0.05);
  const spy = spyBars.at(-1);
  const prevSpy = spyBars.at(-2);
  if (!spy || spy.date !== today || !prevSpy) return console.log("Fund summary: no session today.");

  let equity = fund.cash;
  for (const p of fund.positions) {
    const bar = (await getDailyCloses(p.ticker, 0.05).catch(() => [])).at(-1);
    equity += p.shares * (bar?.date === today ? bar.close : (p.lastPrice ?? p.costBasis));
  }
  const prev = fund.history.filter((x) => x.date < today).at(-1);
  await notify(
    fundNotification({
      date: today,
      startDate: fund.startDate,
      startCash: fund.startCash,
      equity: Math.round(equity * 100) / 100,
      prevEquity: prev?.equity ?? fund.startCash,
      spy: spy.close,
      prevSpy: prevSpy.close,
      spyStart: fund.benchmarkStartPrice,
      trades: fund.trades.filter((t) => t.date === today),
    }),
  );
  await writeFile(MARK_FILE, JSON.stringify({ ...mark, fund: today }, null, 2) + "\n");
}

main().catch((err) => {
  // A failed summary never stops the bot.
  console.warn(`Fund summary failed: ${(err as Error).message}`);
});

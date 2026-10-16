// Save the S&P 500's latest session (5-minute bars) beside the condor bot's
// state, so the site's live index chart draws the whole day the moment it
// opens. scripts/condor-session.sh refreshes it every few minutes while the
// market is open.
//
//   FUND_DIR   where to write spx-1d.json (a checkout of the fund-data branch)
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { getHistory } from "../src/lib/market";

const FUND_DIR = process.env.FUND_DIR ?? path.join("data", "fund");

getHistory("^GSPC", "1d")
  .then(async (day) => {
    await mkdir(FUND_DIR, { recursive: true });
    await writeFile(path.join(FUND_DIR, "spx-1d.json"), JSON.stringify(day));
    console.log(`S&P 500: ${day.points.length} bars, last ${day.points.at(-1)?.close.toFixed(2)}`);
  })
  .catch((err) => {
    console.warn(`S&P 500 bars: ${(err as Error).message}`);
    process.exit(1);
  });

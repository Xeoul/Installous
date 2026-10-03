// Decide whether this run should alert the repo owner and, if so, write the
// issue title and body for the workflow to post. Run after `npm run fund`.
//
//   FUND_DIR     holds alerts.json (what's already been sent), next to fund.json
//   ALERT_DIR    where alert-title.txt and alert-body.md are written (default: .)
import { mkdir, readFile, rm, writeFile } from "fs/promises";
import path from "path";
import { buildAlert, type AlertState } from "../src/lib/alerts";
import type { FundView } from "../src/lib/fund";
import type { Pick } from "../src/lib/portfolio";

const FUND_DIR = process.env.FUND_DIR ?? path.join("data", "fund");
const ALERT_DIR = process.env.ALERT_DIR ?? ".";
const STATE_FILE = path.join(FUND_DIR, "alerts.json");
const FUND_URL = process.env.FUND_URL ?? "https://xeoul.github.io/Installous/fund/";

async function readJson<T>(file: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

async function main() {
  const fund = await readJson<FundView>(path.join("public", "demo-data", "fund.json"));
  const picks = await readJson<Pick[]>(path.join("public", "demo-data", "picks.json"));
  if (!fund || !picks) throw new Error("Run `npm run demo:data` and `npm run fund` first.");

  const { state, alert } = buildAlert(await readJson<AlertState>(STATE_FILE), { fund, picks, now: new Date(), fundUrl: FUND_URL });
  await mkdir(FUND_DIR, { recursive: true });
  await writeFile(STATE_FILE, JSON.stringify(state, null, 2) + "\n");

  const titleFile = path.join(ALERT_DIR, "alert-title.txt");
  const bodyFile = path.join(ALERT_DIR, "alert-body.md");
  if (alert) {
    await writeFile(titleFile, alert.title);
    await writeFile(bodyFile, alert.body);
    console.log(`Alert: ${alert.title}`);
  } else {
    await rm(titleFile, { force: true });
    await rm(bodyFile, { force: true });
    console.log("No alert this run");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
